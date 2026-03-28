import { app, BrowserWindow, globalShortcut, clipboard, screen, ipcMain, Tray, Menu, nativeImage, desktopCapturer } from 'electron'
import * as path from 'path'
import Store from 'electron-store'
import { exec } from 'child_process'
import { promisify } from 'util'
import axios from 'axios'

const execAsync = promisify(exec)
const screenshotDesktop = require('screenshot-desktop')

const store = new Store()

// 保存原始 console 函数，防止递归
const originalLog = console.log.bind(console)
const originalError = console.error.bind(console)

// 防止在关闭时写入已关闭的 stdout 导致 EPIPE 错误
let isShuttingDown = false

const safeLog = (...args: any[]) => {
  if (!isShuttingDown) {
    try {
      originalLog(...args)
    } catch {
      // 忽略写入已关闭 stdout 的错误
    }
  }
}

const safeError = (...args: any[]) => {
  if (!isShuttingDown) {
    try {
      originalError(...args)
    } catch {
      // 忽略写入已关闭 stderr 的错误
    }
  }
}

interface Settings {
  shortcut: string
  apiProvider: 'google' | 'openai'
  openaiApiKey: string
  openaiApiUrl: string
  openaiAuthHeaderName?: string
  openaiAuthPrefix?: string
  openaiModel: string
  // 截图翻译相关设置
  screenshotShortcut?: string
  enableScreenshotTranslation?: boolean
  visionModel?: string
}

interface WindowBounds {
  x?: number
  y?: number
  width: number
  height: number
}

interface UiState {
  sourceText: string
  targetText: string
  error: string
  showSettings: boolean
}

const DEFAULT_SETTINGS: Settings = {
  shortcut: 'CommandOrControl+Alt+T',
  apiProvider: 'google',
  openaiApiKey: '',
  openaiApiUrl: 'https://api.openai.com/v1',
  openaiAuthHeaderName: 'Authorization',
  openaiAuthPrefix: 'Bearer',
  openaiModel: 'gpt-3.5-turbo',
  // 截图翻译相关设置
  screenshotShortcut: 'CommandOrControl+Alt+S',
  enableScreenshotTranslation: false,
  visionModel: 'gpt-4o',
}

const DEFAULT_WINDOW_BOUNDS: WindowBounds = {
  width: 1600,
  height: 640,
}

const LEGACY_WINDOW_BOUNDS_MAX = {
  width: 520,
  height: 320,
}

const DEFAULT_UI_STATE: UiState = {
  sourceText: '',
  targetText: '',
  error: '',
  showSettings: false,
}

const MIN_WINDOW_WIDTH = 320
const MIN_WINDOW_HEIGHT = 200

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let selectionWindows: BrowserWindow[] = []
let currentShortcut = DEFAULT_SETTINGS.shortcut
let currentScreenshotShortcut = DEFAULT_SETTINGS.screenshotShortcut || ''
let shouldSaveResize = true  // 控制 resize 事件是否保存窗口大小
let blurTimeout: any = null  // blur 延迟隐藏的定时器（模块级，供 showWindowAtCursor 清除）
let lastShortcutTriggeredAt = 0
let lastShowTime = 0         // 窗口最后显示时间，用于 blur 保护期
let isTranslating = false    // 翻译操作进行中，禁止自动隐藏

const SHORTCUT_DEBOUNCE_MS = 350

// 选区矩形接口
interface Rectangle {
  x: number
  y: number
  width: number
  height: number
}

function closeSelectionWindows() {
  selectionWindows.forEach(window => {
    if (!window.isDestroyed()) {
      window.close()
    }
  })
  selectionWindows = []
}

// 模拟 Ctrl+C 复制选中的文字（仅 Windows）
async function simulateCopy() {
  if (process.platform !== 'win32') {
    return
  }

  try {
    // 使用 PowerShell 模拟 Ctrl+C
    await execAsync('powershell -WindowStyle Hidden -Command "$wshell = New-Object -ComObject WScript.Shell; $wshell.SendKeys(\'^c\')"')
    // 等待复制操作完成
    await new Promise(resolve => setTimeout(resolve, 50))
  } catch (error) {
    safeError('Failed to simulate copy:', error)
  }
}

// 创建选区窗口，让用户选择截图区域
function createSelectionWindow(): Promise<Rectangle | null> {
  return new Promise((resolve) => {
    closeSelectionWindows()

    const displays = screen.getAllDisplays()

    selectionWindows = displays.map((display, index) => {
      const overlayWindow = new BrowserWindow({
        x: display.bounds.x,
        y: display.bounds.y,
        width: display.bounds.width,
        height: display.bounds.height,
        transparent: true,
        frame: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        webPreferences: {
          nodeIntegration: true,
          contextIsolation: false,
        },
      })

      overlayWindow.loadFile(path.join(__dirname, '../src/selection.html'))
      overlayWindow.setAlwaysOnTop(true, 'screen-saver')
      if (index === 0) {
        overlayWindow.focus()
      }

      return overlayWindow
    })

    // 监听选区完成事件
    ipcMain.once('selection-complete', (_event, rect: Rectangle) => {
      closeSelectionWindows()
      resolve(rect)
    })

    // 监听取消事件
    ipcMain.once('selection-cancelled', () => {
      closeSelectionWindows()
      resolve(null)
    })
  })
}

// 根据选区截图
async function captureScreenArea(area: Rectangle): Promise<Buffer> {
  const targetDisplay = screen.getDisplayMatching({
    x: area.x,
    y: area.y,
    width: area.width,
    height: area.height,
  })

  if (process.platform === 'win32') {
    const displays = await screenshotDesktop.listDisplays()
    const targetTopLeft = screen.dipToScreenPoint({
      x: area.x,
      y: area.y,
    })
    const targetBottomRight = screen.dipToScreenPoint({
      x: area.x + area.width,
      y: area.y + area.height,
    })
    const screenshotDisplay = displays.find((display: any) => {
      const horizontalOverlap = Math.min(targetBottomRight.x, display.left + display.width) - Math.max(targetTopLeft.x, display.left)
      const verticalOverlap = Math.min(targetBottomRight.y, display.top + display.height) - Math.max(targetTopLeft.y, display.top)
      return horizontalOverlap > 0 && verticalOverlap > 0
    }) || displays.find((display: any) => {
      const expectedLeft = Math.round(targetDisplay.bounds.x * targetDisplay.scaleFactor)
      const expectedTop = Math.round(targetDisplay.bounds.y * targetDisplay.scaleFactor)
      return Math.abs(display.left - expectedLeft) < 4 && Math.abs(display.top - expectedTop) < 4
    }) || displays[0]

    if (!screenshotDisplay) {
      throw new Error('无法匹配截图显示器')
    }

    safeLog('Using screenshot-desktop display:', {
      electronDisplayId: targetDisplay.id,
      electronBounds: targetDisplay.bounds,
      electronScaleFactor: targetDisplay.scaleFactor,
      screenshotDisplay,
      targetTopLeft,
      targetBottomRight,
    })

    const screenBuffer = await screenshotDesktop({
      screen: screenshotDisplay.id,
      format: 'png',
    })

    const image = nativeImage.createFromBuffer(screenBuffer)
    const cropX = Math.max(0, targetTopLeft.x - screenshotDisplay.left)
    const cropY = Math.max(0, targetTopLeft.y - screenshotDisplay.top)
    const cropWidth = Math.min(targetBottomRight.x - targetTopLeft.x, image.getSize().width - cropX)
    const cropHeight = Math.min(targetBottomRight.y - targetTopLeft.y, image.getSize().height - cropY)

    if (cropWidth <= 0 || cropHeight <= 0) {
      throw new Error('截图区域无效')
    }

    return image.crop({
      x: cropX,
      y: cropY,
      width: cropWidth,
      height: cropHeight,
    }).toPNG()
  }

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: targetDisplay.bounds.width,
      height: targetDisplay.bounds.height,
    }
  })

  if (sources.length === 0) {
    throw new Error('无法获取屏幕源')
  }

  const targetSource = sources.find(source =>
    source.display_id === String(targetDisplay.id) ||
    source.id.includes(String(targetDisplay.id))
  ) || sources[0]

  safeLog('Using display for screenshot:', {
    displayId: targetDisplay.id,
    bounds: targetDisplay.bounds,
    sourceId: targetSource.id,
    sourceDisplayId: targetSource.display_id,
  })

  const cropX = Math.max(0, area.x - targetDisplay.bounds.x)
  const cropY = Math.max(0, area.y - targetDisplay.bounds.y)
  const cropWidth = Math.min(area.width, targetDisplay.bounds.width - cropX)
  const cropHeight = Math.min(area.height, targetDisplay.bounds.height - cropY)

  const image = nativeImage.createFromBuffer(targetSource.thumbnail.toPNG())

  // 裁剪出选区
  const croppedImage = image.crop({
    x: cropX,
    y: cropY,
    width: cropWidth,
    height: cropHeight
  })

  return croppedImage.toPNG()
}

// 处理截图翻译快捷键
async function handleScreenshotTranslation() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return
  }

  isTranslating = true  // 翻译操作开始，禁止自动隐藏

  // 隐藏主窗口
  if (mainWindow.isVisible()) {
    mainWindow.hide()
  }

  try {
    let imageBuffer: Buffer | null = null
    const selection = await createSelectionWindow()

    if (!selection) {
      isTranslating = false
      if (mainWindow && !mainWindow.isVisible()) {
        mainWindow.show()
        mainWindow.focus()
      }
      return
    }

    safeLog('Capturing screen area:', selection)
    imageBuffer = await captureScreenArea(selection)

    if (!imageBuffer) {
      isTranslating = false
      if (mainWindow && !mainWindow.isVisible()) {
        mainWindow.show()
        mainWindow.focus()
      }
      return
    }

    safeLog('Screenshot captured, size:', imageBuffer.length)

    // 获取当前设置
    const settings = getSettings()
    safeLog('Current settings - apiProvider:', settings.apiProvider, 'openaiApiKey:', settings.openaiApiKey ? 'configured' : 'missing')

    // 先发送加载状态到渲染进程，再显示窗口，避免旧内容闪现
    mainWindow?.webContents.send('screenshot-translation-status', '正在识别文字...')
    showWindowAtCursor(true)

    // 调用图片翻译API
    const translatedText = await translateImage(imageBuffer, settings)
    safeLog('Translation result:', translatedText)

    // 发送翻译结果到渲染进程
    mainWindow?.webContents.send('screenshot-translation-result', translatedText)
  } catch (error) {
    safeError('Screenshot translation failed:', error)
    showWindowAtCursor(true)
    mainWindow?.webContents.send('screenshot-translation-error', error instanceof Error ? error.message : '翻译失败')
  } finally {
    isTranslating = false
  }
}

function normalizeChatCompletionsUrl(apiUrl: string): string {
  const normalized = apiUrl.trim().replace(/\/$/, '')

  if (/\/chat\/completions$/i.test(normalized)) {
    return normalized
  }

  return `${normalized}/chat/completions`
}

function normalizeSettings(settings?: Partial<Settings>): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...(settings || {}),
  }
}

function buildAuthHeaders(settings: Settings): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  const token = settings.openaiApiKey?.trim()
  const headerName = settings.openaiAuthHeaderName?.trim()
  const prefix = settings.openaiAuthPrefix?.trim()

  if (token && headerName) {
    headers[headerName] = prefix ? `${prefix} ${token}` : token
  }

  return headers
}

// 图片翻译函数（主进程中实现）
async function translateImage(imageBuffer: Buffer, settings: Settings): Promise<string> {
  safeLog('translateImage called - apiProvider:', settings.apiProvider, 'type:', typeof settings.apiProvider)

  if (!settings.openaiApiUrl?.trim()) {
    throw new Error('请配置 OpenAI 兼容接口地址')
  }

  const base64Image = imageBuffer.toString('base64')
  const requestUrl = normalizeChatCompletionsUrl(settings.openaiApiUrl)
  const headers = buildAuthHeaders(settings)

  safeLog('Screenshot translation request URL:', requestUrl)
  safeLog('Screenshot translation auth header:', settings.openaiAuthHeaderName || '(none)', 'prefix:', settings.openaiAuthPrefix || '(none)', 'token:', settings.openaiApiKey ? 'configured' : 'missing')

  const response = await axios.post(
    requestUrl,
    {
      model: settings.visionModel || 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Detect whether the main text in this image is primarily English or Chinese. Translate English into natural Simplified Chinese, and Chinese into natural English. Return only the translation. If there is no clear Chinese or English text, return "No text detected".'
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/png;base64,${base64Image}`
              }
            }
          ]
        }
      ],
      max_tokens: 500
    },
    {
      headers,
      timeout: 30000
    }
  )

  if (response.data.error) {
    throw new Error(`API 错误: ${response.data.error.message}`)
  }

  const result = response.data.choices?.[0]?.message?.content?.trim() || '翻译失败'

  // 处理可能的多模态响应格式
  if (result.includes('No text detected')) {
    return '未检测到文字'
  }

  return result
}

// 注册截图翻译快捷键
function registerScreenshotShortcut(shortcut: string): boolean {
  // 先注销之前的快捷键
  if (currentScreenshotShortcut) {
    globalShortcut.unregister(currentScreenshotShortcut)
  }

  if (!shortcut) {
    return true
  }

  const result = globalShortcut.register(shortcut, async () => {
    const settings = getSettings()

    if (!settings.enableScreenshotTranslation) {
      safeLog('Screenshot translation is disabled')
      return
    }

    await handleScreenshotTranslation()
  })

  if (result) {
    currentScreenshotShortcut = shortcut
    safeLog('Screenshot shortcut registered successfully:', shortcut)
  } else {
    safeError('Failed to register screenshot shortcut:', shortcut)
  }

  return result
}

// 单实例锁：确保只运行一个应用实例
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  isShuttingDown = true
  safeLog('Another instance is already running, quitting...')
  app.quit()
} else {
  // 第二个实例尝试启动时，聚焦到第一个实例的窗口（只在主实例上注册）
  app.on('second-instance', (_event, _commandLine, _workingDirectory) => {
    safeLog('Second instance detected, focusing main window')
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow()
    } else {
      if (mainWindow.isMinimized()) {
        mainWindow.restore()
      }
      if (!mainWindow.isVisible()) {
        showWindowAtCursor()
      } else {
        mainWindow.focus()
      }
    }
  })
}

// 自动检测是否为开发环境
const isDev = process.env.NODE_ENV === 'development' ||
              process.defaultApp ||
              /node_modules[/\\]electron[/\\]/.test(process.execPath)

// 获取设置
function getSettings(): Settings {
  const savedSettings = store.get('settings') as Partial<Settings> | undefined
  return normalizeSettings(savedSettings)
}

// 保存设置
function saveSettings(settings: Settings): void {
  store.set('settings', normalizeSettings(settings))
}

function getWindowBounds(): WindowBounds {
  const savedBounds = store.get('windowBounds') as WindowBounds | undefined

  if (!savedBounds) {
    return DEFAULT_WINDOW_BOUNDS
  }

  const looksLikeLegacyDefaultSize =
    (savedBounds.width || 0) <= LEGACY_WINDOW_BOUNDS_MAX.width &&
    (savedBounds.height || 0) <= LEGACY_WINDOW_BOUNDS_MAX.height

  if (looksLikeLegacyDefaultSize) {
    return DEFAULT_WINDOW_BOUNDS
  }

  return savedBounds
}

function saveWindowBounds(bounds: WindowBounds): void {
  store.set('windowBounds', bounds)
}

function getCenteredWindowPosition(width: number, height: number) {
  const primaryDisplay = screen.getPrimaryDisplay()
  const { workArea } = primaryDisplay

  return {
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
  }
}

function getDisplayForWindowBounds(bounds: WindowBounds) {
  if (typeof bounds.x !== 'number' || typeof bounds.y !== 'number') {
    return null
  }

  return screen.getDisplayNearestPoint({
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
  })
}

function getUiState(): UiState {
  const savedUiState = store.get('uiState') as Partial<UiState> | undefined
  return {
    ...DEFAULT_UI_STATE,
    ...(savedUiState || {}),
  }
}

function saveUiState(state: UiState): void {
  store.set('uiState', {
    ...DEFAULT_UI_STATE,
    ...(state || {}),
  })
}

function normalizeWindowBounds(bounds: WindowBounds): WindowBounds {
  const display = getDisplayForWindowBounds(bounds) || screen.getPrimaryDisplay()
  const { workArea } = display
  const maxWidth = Math.max(MIN_WINDOW_WIDTH, workArea.width - 80)
  const maxHeight = Math.max(MIN_WINDOW_HEIGHT, workArea.height - 80)
  const width = Math.min(maxWidth, Math.max(MIN_WINDOW_WIDTH, Math.round(bounds.width || DEFAULT_WINDOW_BOUNDS.width)))
  const height = Math.min(maxHeight, Math.max(MIN_WINDOW_HEIGHT, Math.round(bounds.height || DEFAULT_WINDOW_BOUNDS.height)))

  if (typeof bounds.x !== 'number' || typeof bounds.y !== 'number') {
    return { width, height }
  }

  const maxX = Math.max(workArea.x, workArea.x + workArea.width - width)
  const maxY = Math.max(workArea.y, workArea.y + workArea.height - height)

  return {
    x: Math.min(maxX, Math.max(workArea.x, Math.round(bounds.x))),
    y: Math.min(maxY, Math.max(workArea.y, Math.round(bounds.y))),
    width,
    height,
  }
}

function saveCurrentWindowBounds() {
  if (!mainWindow) {
    return
  }

  const { x, y, width, height } = normalizeWindowBounds(mainWindow.getBounds())
  saveWindowBounds({ x, y, width, height })
}

function createDefaultTrayIcon() {
  const svg = `
    <svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
      <rect x="4" y="4" width="24" height="24" rx="8" fill="#60A5FA"/>
      <rect x="9" y="11" width="14" height="3" rx="1.5" fill="white"/>
      <rect x="9" y="17" width="10" height="3" rx="1.5" fill="white"/>
      <circle cx="23.5" cy="19.5" r="2.5" fill="#DBEAFE"/>
    </svg>
  `.trim()

  return nativeImage
    .createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`)
    .resize({ width: 16, height: 16 })
}

function shouldHandleShortcutTrigger(): boolean {
  const now = Date.now()

  if (now - lastShortcutTriggeredAt < SHORTCUT_DEBOUNCE_MS) {
    safeLog('Shortcut ignored due to debounce window')
    return false
  }

  lastShortcutTriggeredAt = now
  return true
}

// 注册快捷键
function registerShortcut(shortcut: string): boolean {
  // 先注销之前的快捷键
  if (currentShortcut) {
    globalShortcut.unregister(currentShortcut)
  }

  const result = globalShortcut.register(shortcut, async () => {
    if (!shouldHandleShortcutTrigger()) {
      return
    }

    isTranslating = true  // 翻译操作开始，禁止自动隐藏

    // 先模拟 Ctrl+C 复制选中的文字
    await simulateCopy()

    // 等待一小段时间确保复制完成
    await new Promise(resolve => setTimeout(resolve, 100))

    const selectedText = clipboard.readText()
    safeLog('Shortcut triggered, clipboard text:', selectedText)

    // 先发送翻译内容到渲染进程，再显示窗口，避免旧内容闪现
    if (mainWindow && selectedText) {
      mainWindow.webContents.send('translate-shortcut', selectedText)
    }

    showWindowAtCursor(true)

    // 延迟重置标志，给用户充足时间查看翻译结果
    setTimeout(() => {
      isTranslating = false
      safeLog('[DEBUG] isTranslating reset to false')
    }, 10000)
  })

  if (result) {
    currentShortcut = shortcut
    safeLog('Shortcut registered successfully:', shortcut)
  } else {
    safeError('Failed to register shortcut:', shortcut)
    // 恢复之前的快捷键
    if (currentShortcut) {
      globalShortcut.register(currentShortcut, async () => {
        if (!shouldHandleShortcutTrigger()) {
          return
        }

        isTranslating = true

        await simulateCopy()
        await new Promise(resolve => setTimeout(resolve, 100))

        const selectedText = clipboard.readText()
        if (mainWindow && selectedText) {
          mainWindow.webContents.send('translate-shortcut', selectedText)
        }
        showWindowAtCursor(true)

        setTimeout(() => {
          isTranslating = false
        }, 500)
      })
    }
  }

  return result
}

function createWindow() {
  const windowBounds = normalizeWindowBounds(getWindowBounds())
  saveWindowBounds(windowBounds)

  mainWindow = new BrowserWindow({
    width: windowBounds.width,
    height: windowBounds.height,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: true,  // 使用原生 resize
    alwaysOnTop: true,
    skipTaskbar: false,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    icon: path.join(__dirname, '../assets/icon.png'),
  })

  if (isDev) {
    const tryLoad = async (urls: string[]): Promise<boolean> => {
      for (const url of urls) {
        try {
          if (mainWindow) {
            await mainWindow.loadURL(url)
            safeLog(`Development mode: loaded from ${url}`)
            return true
          }
        } catch {
          // 继续尝试下一个 URL
        }
      }
      return false
    }

    tryLoad(['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175', 'http://localhost:5176'])
      .then(success => {
        if (!success && mainWindow) {
          safeError('Failed to load from any Vite dev server port')
        }
      })
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.once('ready-to-show', () => {
    if (mainWindow) {
      // 禁用 resize 保存，防止窗口初始化时的抖动被保存
      shouldSaveResize = false

      const { width, height } = mainWindow.getBounds()
      const savedBounds = normalizeWindowBounds(getWindowBounds())
      const initialPosition = typeof savedBounds.x === 'number' && typeof savedBounds.y === 'number'
        ? { x: savedBounds.x, y: savedBounds.y }
        : getCenteredWindowPosition(width, height)

      mainWindow.setPosition(initialPosition.x, initialPosition.y)
      mainWindow.show()
      mainWindow.focus()
      lastShowTime = Date.now()
      saveCurrentWindowBounds()

      safeLog('Window shown at initial position:', { x: initialPosition.x, y: initialPosition.y })

      // 延迟恢复 resize 保存，确保窗口完全稳定
      setTimeout(() => {
        shouldSaveResize = true
      }, 500)
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // 调试日志：追踪窗口显示/隐藏
  mainWindow.on('show', () => {
    safeLog('[DEBUG] window SHOW event', new Error().stack?.split('\n').slice(1, 4).join('\n'))
  })
  mainWindow.on('hide', () => {
    safeLog('[DEBUG] window HIDE event', new Error().stack?.split('\n').slice(1, 4).join('\n'))
  })

  mainWindow.on('resize', () => {
    if (mainWindow && shouldSaveResize) {
      saveCurrentWindowBounds()
    }
  })

  mainWindow.on('move', () => {
    if (mainWindow && shouldSaveResize) {
      saveCurrentWindowBounds()
    }
  })

  // 点击窗口外部时隐藏窗口（延迟检查，避免误触发）
  mainWindow.on('blur', () => {
    safeLog('[DEBUG] window BLUR event, isVisible:', mainWindow?.isVisible(), 'isTranslating:', isTranslating)
    if (isTranslating) {
      safeLog('[DEBUG] BLUR ignored: translation in progress')
      return
    }
    if (mainWindow && mainWindow.isVisible()) {
      // 延迟隐藏，给窗口重新获得焦点的机会
      blurTimeout = setTimeout(() => {
        safeLog('[DEBUG] blur timeout fired, isFocused:', mainWindow?.isFocused(), 'isVisible:', mainWindow?.isVisible(), 'isTranslating:', isTranslating)
        if (mainWindow && !mainWindow.isFocused() && mainWindow.isVisible() && !isTranslating) {
          mainWindow.hide()
        }
      }, 150)
    }
  })

  mainWindow.on('focus', () => {
    safeLog('[DEBUG] window FOCUS event')
    // 如果窗口重新获得焦点，取消隐藏
    if (blurTimeout) {
      clearTimeout(blurTimeout)
      blurTimeout = null
    }
  })

  safeLog('Window created')
}

function showWindowAtCursor(resultMode = false) {
  if (!mainWindow) {
    safeLog('No main window exists')
    return
  }

  // 禁用 resize 保存，防止窗口显示时的抖动被保存
  shouldSaveResize = false

  // 清除可能存在的 blur 隐藏定时器，防止窗口刚显示就被隐藏导致闪动
  if (blurTimeout) {
    clearTimeout(blurTimeout)
    blurTimeout = null
  }

  // 获取当前窗口实际大小（不强制重置，保留用户调整的尺寸）
  const currentBounds = normalizeWindowBounds(mainWindow.getBounds())
  const width = currentBounds.width
  const height = currentBounds.height

  const cursorPos = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursorPos)

  safeLog('Shortcut triggered, cursor position:', cursorPos)

  let x = currentBounds.x
  let y = currentBounds.y

  if (typeof x !== 'number' || typeof y !== 'number') {
    x = cursorPos.x + 15
    y = cursorPos.y + 15

    const { bounds: screenBounds } = display

    if (x + width > screenBounds.x + screenBounds.width) {
      x = cursorPos.x - width - 15
    }

    if (y + height > screenBounds.y + screenBounds.height) {
      y = cursorPos.y - height - 15
    }

    x = Math.round(Math.max(screenBounds.x, x))
    y = Math.round(Math.max(screenBounds.y, y))
  }

  mainWindow.setPosition(x, y)

  // 先通知渲染进程切换模式，再显示窗口，避免旧内容闪现
  mainWindow.webContents.send('window-mode-changed', resultMode ? 'result' : 'input')

  mainWindow.show()
  mainWindow.focus()
  lastShowTime = Date.now()  // 记录显示时间，blur 保护期内不自动隐藏
  saveCurrentWindowBounds()

  safeLog('Window shown at cursor position:', { x, y, width, height, mode: resultMode ? 'result' : 'input' })

  // 延迟恢复 resize 保存，确保窗口完全稳定
  setTimeout(() => {
    shouldSaveResize = true
  }, 500)
}

// 创建系统托盘图标
function createTray() {
  const iconPath = path.join(__dirname, '../assets/tray-icon.png')

  let trayIcon
  try {
    trayIcon = nativeImage.createFromPath(iconPath)
    if (trayIcon.isEmpty()) {
      trayIcon = createDefaultTrayIcon()
    }
  } catch {
    trayIcon = createDefaultTrayIcon()
  }

  tray = new Tray(trayIcon)

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示/隐藏窗口',
      click: () => {
        if (mainWindow) {
          if (mainWindow.isVisible()) {
            saveCurrentWindowBounds()
            mainWindow.hide()
          } else {
            showWindowAtCursor()
          }
        }
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isShuttingDown = true
        app.quit()
      }
    }
  ])

  tray.setToolTip('中英翻译助手')
  tray.setContextMenu(contextMenu)

  // 单击托盘图标显示/隐藏窗口
  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        saveCurrentWindowBounds()
        mainWindow.hide()
      } else {
        showWindowAtCursor()
      }
    }
  })
}

// 只有在获取到单实例锁时才初始化应用
if (gotTheLock) {
  app.whenReady().then(() => {
    safeLog('App ready, creating window...')
    createWindow()
    createTray()

    // 注册初始快捷键
    const settings = getSettings()
    registerShortcut(settings.shortcut)

    // 注册截图翻译快捷键
    if (settings.enableScreenshotTranslation && settings.screenshotShortcut) {
      registerScreenshotShortcut(settings.screenshotShortcut)
    }

    // IPC: 获取设置
    ipcMain.handle('get-settings', () => {
      return getSettings()
    })

    ipcMain.handle('get-ui-state', () => {
      return getUiState()
    })

    // IPC: 保存设置
    ipcMain.handle('save-settings', (_event, newSettings: Settings) => {
      saveSettings(newSettings)

      // 重新注册快捷键
      if (newSettings.shortcut !== currentShortcut) {
        registerShortcut(newSettings.shortcut)
      }

      // 重新注册截图翻译快捷键
      if (newSettings.enableScreenshotTranslation && newSettings.screenshotShortcut) {
        if (newSettings.screenshotShortcut !== currentScreenshotShortcut) {
          registerScreenshotShortcut(newSettings.screenshotShortcut)
        }
      } else {
        // 如果禁用了截图翻译，注销快捷键
        if (currentScreenshotShortcut) {
          globalShortcut.unregister(currentScreenshotShortcut)
          currentScreenshotShortcut = ''
        }
      }

      return { success: true }
    })

    ipcMain.handle('save-ui-state', (_event, nextUiState: UiState) => {
      saveUiState(nextUiState)
      return { success: true }
    })

    ipcMain.on('close-window', () => {
      safeLog('[DEBUG] close-window IPC received, isTranslating:', isTranslating, 'timeSinceShow:', Date.now() - lastShowTime, 'ms')
      if (isTranslating) {
        safeLog('[DEBUG] close-window ignored: translation in progress')
        return
      }
      // 启动/显示后短时间内的 close-window 忽略，防止闪动
      if (Date.now() - lastShowTime < 500) {
        safeLog('[DEBUG] close-window ignored: within show grace period')
        return
      }
      if (mainWindow) {
        saveCurrentWindowBounds()
        mainWindow.hide()
      }
    })

    ipcMain.on('show-window', () => {
      showWindowAtCursor()
    })

    // IPC: 设置窗口大小（自定义缩放手柄）
    ipcMain.on('set-window-size', (_event, data: { width: number; height: number }) => {
      if (mainWindow && typeof data?.width === 'number' && typeof data?.height === 'number') {
        const nextWidth = Math.max(MIN_WINDOW_WIDTH, Math.round(data.width))
        const nextHeight = Math.max(MIN_WINDOW_HEIGHT, Math.round(data.height))
        const [currentWidth, currentHeight] = mainWindow.getSize()
        safeLog('set-window-size:', { received: data, current: [currentWidth, currentHeight], next: [nextWidth, nextHeight] })
        mainWindow.setSize(nextWidth, nextHeight)
        saveCurrentWindowBounds()
      }
    })
  })
}

app.on('window-all-closed', () => {
  // 在 Windows 和 Linux 上，关闭所有窗口时不退出应用，而是保留托盘图标
  // 在 macOS 上，即使没有窗口也保持应用运行
  if (process.platform === 'darwin') {
    // macOS 特殊处理
  }
  // 不退出应用，保留托盘图标
})

app.on('will-quit', () => {
  isShuttingDown = true
  globalShortcut.unregisterAll()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

import { app, BrowserWindow, globalShortcut, clipboard, screen, ipcMain, Tray, Menu, nativeImage } from 'electron'
import * as path from 'path'
import Store from 'electron-store'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

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
  openaiModel: string
}

interface WindowBounds {
  width: number
  height: number
}

const DEFAULT_SETTINGS: Settings = {
  shortcut: 'CommandOrControl+Alt+T',
  apiProvider: 'google',
  openaiApiKey: '',
  openaiApiUrl: 'https://api.openai.com/v1',
  openaiModel: 'gpt-3.5-turbo',
}

const DEFAULT_WINDOW_BOUNDS: WindowBounds = {
  width: 420,
  height: 260,
}

const MIN_WINDOW_WIDTH = 320
const MIN_WINDOW_HEIGHT = 200

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let currentShortcut = DEFAULT_SETTINGS.shortcut
let shouldSaveResize = true  // 控制 resize 事件是否保存窗口大小
let lastShortcutTriggeredAt = 0

const SHORTCUT_DEBOUNCE_MS = 350

// 模拟 Ctrl+C 复制选中的文字（仅 Windows）
async function simulateCopy() {
  if (process.platform !== 'win32') {
    return
  }

  try {
    // 使用 PowerShell 模拟 Ctrl+C
    await execAsync('powershell -Command "$wshell = New-Object -ComObject WScript.Shell; $wshell.SendKeys(\'^c\')"')
    // 等待复制操作完成
    await new Promise(resolve => setTimeout(resolve, 50))
  } catch (error) {
    safeError('Failed to simulate copy:', error)
  }
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
  return store.get('settings', DEFAULT_SETTINGS) as Settings
}

// 保存设置
function saveSettings(settings: Settings): void {
  store.set('settings', settings)
}

function getWindowBounds(): WindowBounds {
  return store.get('windowBounds', DEFAULT_WINDOW_BOUNDS) as WindowBounds
}

function saveWindowBounds(bounds: WindowBounds): void {
  store.set('windowBounds', bounds)
}

function normalizeWindowBounds(bounds: WindowBounds): WindowBounds {
  const { workAreaSize } = screen.getPrimaryDisplay()
  const maxWidth = Math.max(MIN_WINDOW_WIDTH, workAreaSize.width - 80)
  const maxHeight = Math.max(MIN_WINDOW_HEIGHT, workAreaSize.height - 80)

  return {
    width: Math.min(maxWidth, Math.max(MIN_WINDOW_WIDTH, Math.round(bounds.width || DEFAULT_WINDOW_BOUNDS.width))),
    height: Math.min(maxHeight, Math.max(MIN_WINDOW_HEIGHT, Math.round(bounds.height || DEFAULT_WINDOW_BOUNDS.height))),
  }
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

    // 先模拟 Ctrl+C 复制选中的文字
    await simulateCopy()

    // 等待一小段时间确保复制完成
    await new Promise(resolve => setTimeout(resolve, 100))

    const selectedText = clipboard.readText()
    safeLog('Shortcut triggered, clipboard text:', selectedText)

    showWindowAtCursor()

    if (mainWindow && selectedText) {
      mainWindow.webContents.send('translate-shortcut', selectedText)
    }
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

        // 先模拟 Ctrl+C 复制选中的文字
        await simulateCopy()

        // 等待一小段时间确保复制完成
        await new Promise(resolve => setTimeout(resolve, 100))

        const selectedText = clipboard.readText()
        showWindowAtCursor()
        if (mainWindow && selectedText) {
          mainWindow.webContents.send('translate-shortcut', selectedText)
        }
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

      const primaryDisplay = screen.getPrimaryDisplay()
      const { bounds: screenBounds } = primaryDisplay
      const { width, height } = mainWindow.getBounds()

      const x = Math.round(screenBounds.x + (screenBounds.width - width) / 2)
      const y = Math.round(screenBounds.y + (screenBounds.height - height) / 2)

      mainWindow.setPosition(x, y)
      mainWindow.show()
      mainWindow.focus()

      safeLog('Window shown at PRIMARY screen center:', { x, y })

      // 延迟恢复 resize 保存，确保窗口完全稳定
      setTimeout(() => {
        shouldSaveResize = true
      }, 500)
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.on('resize', () => {
    if (mainWindow && shouldSaveResize) {
      const [width, height] = mainWindow.getSize()
      saveWindowBounds({ width, height })
    }
  })

  safeLog('Window created')
}

function showWindowAtCursor() {
  if (!mainWindow) {
    safeLog('No main window exists')
    return
  }

  // 禁用 resize 保存，防止窗口显示时的抖动被保存
  shouldSaveResize = false

  // 每次打开窗口时，重置到理想尺寸
  const idealWidth = 420
  const idealHeight = 260
  mainWindow.setSize(idealWidth, idealHeight)

  const cursorPos = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursorPos)

  safeLog('Shortcut triggered, cursor position:', cursorPos)

  let x = cursorPos.x + 15
  let y = cursorPos.y + 15

  const { bounds: screenBounds } = display

  if (x + idealWidth > screenBounds.x + screenBounds.width) {
    x = cursorPos.x - idealWidth - 15
  }

  if (y + idealHeight > screenBounds.y + screenBounds.height) {
    y = cursorPos.y - idealHeight - 15
  }

  x = Math.round(Math.max(screenBounds.x, x))
  y = Math.round(Math.max(screenBounds.y, y))

  mainWindow.setPosition(x, y)
  mainWindow.show()
  mainWindow.focus()

  safeLog('Window shown at cursor position:', { x, y })

  // 更新保存的窗口边界
  saveWindowBounds({ width: idealWidth, height: idealHeight })

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

    // IPC: 获取设置
    ipcMain.handle('get-settings', () => {
      return getSettings()
    })

    // IPC: 保存设置
    ipcMain.handle('save-settings', (_event, newSettings: Settings) => {
      saveSettings(newSettings)

      // 重新注册快捷键
      if (newSettings.shortcut !== currentShortcut) {
        registerShortcut(newSettings.shortcut)
      }

      return { success: true }
    })

    ipcMain.on('close-window', () => {
      if (mainWindow) {
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
        saveWindowBounds({ width: nextWidth, height: nextHeight })
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

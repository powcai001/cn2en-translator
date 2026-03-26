import { app, BrowserWindow, globalShortcut, clipboard, screen, ipcMain, Tray, Menu, nativeImage } from 'electron'
import * as path from 'path'
import Store from 'electron-store'

const store = new Store()

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
  width: 360,
  height: 220,
}

const MIN_WINDOW_WIDTH = 320
const MIN_WINDOW_HEIGHT = 200

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let currentShortcut = DEFAULT_SETTINGS.shortcut

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

// 注册快捷键
function registerShortcut(shortcut: string): boolean {
  // 先注销之前的快捷键
  if (currentShortcut) {
    globalShortcut.unregister(currentShortcut)
  }

  const result = globalShortcut.register(shortcut, () => {
    const selectedText = clipboard.readText()
    console.log('Shortcut triggered, clipboard text:', selectedText)

    showWindowAtCursor()

    if (mainWindow && selectedText) {
      mainWindow.webContents.send('translate-shortcut', selectedText)
    }
  })

  if (result) {
    currentShortcut = shortcut
    console.log('Shortcut registered successfully:', shortcut)
  } else {
    console.error('Failed to register shortcut:', shortcut)
    // 恢复之前的快捷键
    if (currentShortcut) {
      globalShortcut.register(currentShortcut, () => {
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
  const windowBounds = getWindowBounds()

  mainWindow = new BrowserWindow({
    width: windowBounds.width,
    height: windowBounds.height,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    frame: false,
    transparent: true,
    resizable: true,
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
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
    console.log('Development mode: loading from http://localhost:5173')
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.once('ready-to-show', () => {
    if (mainWindow) {
      const primaryDisplay = screen.getPrimaryDisplay()
      const { bounds: screenBounds } = primaryDisplay
      const { width, height } = mainWindow.getBounds()

      const x = screenBounds.x + (screenBounds.width - width) / 2
      const y = screenBounds.y + (screenBounds.height - height) / 2

      mainWindow.setPosition(x, y)
      mainWindow.show()
      mainWindow.focus()

      console.log('Window shown at PRIMARY screen center:', { x, y })
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.on('resize', () => {
    if (mainWindow) {
      const [width, height] = mainWindow.getSize()
      saveWindowBounds({ width, height })
    }
  })

  console.log('Window created')
}

function showWindowAtCursor() {
  if (!mainWindow) {
    console.log('No main window exists')
    return
  }

  const cursorPos = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursorPos)

  console.log('Shortcut triggered, cursor position:', cursorPos)

  let x = cursorPos.x + 15
  let y = cursorPos.y + 15

  const { width, height } = mainWindow.getBounds()
  const { bounds: screenBounds } = display

  if (x + width > screenBounds.x + screenBounds.width) {
    x = cursorPos.x - width - 15
  }

  if (y + height > screenBounds.y + screenBounds.height) {
    y = cursorPos.y - height - 15
  }

  x = Math.max(screenBounds.x, x)
  y = Math.max(screenBounds.y, y)

  mainWindow.setPosition(x, y)
  mainWindow.show()
  mainWindow.focus()

  console.log('Window shown at cursor position:', { x, y })
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

app.whenReady().then(() => {
  console.log('App ready, creating window...')
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

  // 拖动窗口相关
  let dragStartPos: { x: number; y: number } | null = null

  ipcMain.on('window-drag-start', (_event, posX: number, posY: number) => {
    if (mainWindow) {
      dragStartPos = { x: posX, y: posY }
    }
  })

  ipcMain.on('window-drag-move', (_event, posX: number, posY: number) => {
    if (mainWindow && dragStartPos) {
      const [currentX, currentY] = mainWindow.getPosition()
      const deltaX = posX - dragStartPos.x
      const deltaY = posY - dragStartPos.y
      mainWindow.setPosition(currentX + deltaX, currentY + deltaY)
      dragStartPos = { x: posX, y: posY }
    }
  })

  ipcMain.on('window-drag-end', () => {
    dragStartPos = null
  })

  ipcMain.on('close-window', () => {
    if (mainWindow) {
      mainWindow.hide()
    }
  })

  ipcMain.on('show-window', () => {
    showWindowAtCursor()
  })

  ipcMain.on('set-window-size', (_event, width: number, height: number) => {
    if (mainWindow) {
      const nextWidth = Math.max(MIN_WINDOW_WIDTH, Math.round(width))
      const nextHeight = Math.max(MIN_WINDOW_HEIGHT, Math.round(height))
      mainWindow.setSize(nextWidth, nextHeight)
      saveWindowBounds({ width: nextWidth, height: nextHeight })
    }
  })
})

app.on('window-all-closed', () => {
  // 在 Windows 和 Linux 上，关闭所有窗口时不退出应用，而是保留托盘图标
  // 在 macOS 上，即使没有窗口也保持应用运行
  if (process.platform === 'darwin') {
    // macOS 特殊处理
  }
  // 不退出应用，保留托盘图标
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

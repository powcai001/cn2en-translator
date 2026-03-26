import { app, BrowserWindow, globalShortcut, clipboard, screen, ipcMain } from 'electron'
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

const DEFAULT_SETTINGS: Settings = {
  shortcut: 'CommandOrControl+Alt+T',
  apiProvider: 'google',
  openaiApiKey: '',
  openaiApiUrl: 'https://api.openai.com/v1',
  openaiModel: 'gpt-3.5-turbo',
}

let mainWindow: BrowserWindow | null = null
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
  mainWindow = new BrowserWindow({
    width: 360,
    height: 200,
    frame: false,
    transparent: true,
    resizable: false,
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

      const x = screenBounds.x + (screenBounds.width - 360) / 2
      const y = screenBounds.y + (screenBounds.height - 200) / 2

      mainWindow.setPosition(x, y)
      mainWindow.show()
      mainWindow.focus()

      console.log('Window shown at PRIMARY screen center:', { x, y })
    }
  })

  mainWindow.on('blur', () => {
    if (mainWindow && !mainWindow.isDevToolsOpened()) {
      mainWindow.hide()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
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

app.whenReady().then(() => {
  console.log('App ready, creating window...')
  createWindow()

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
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

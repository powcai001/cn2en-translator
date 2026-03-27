import { useState, useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { translate } from './api/translate'
import './App.css'

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

const DEFAULT_UI_STATE: UiState = {
  sourceText: '',
  targetText: '',
  error: '',
  showSettings: false,
}

const getIpcRenderer = () => {
  const electron = (window as any).require?.('electron')
  return electron?.ipcRenderer
}

function App() {
  const [sourceText, setSourceText] = useState('')
  const [targetText, setTargetText] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [shortcutHint, setShortcutHint] = useState('Ctrl+Alt+T')
  const [isRecording, setIsRecording] = useState(false)
  const [isRecordingScreenshot, setIsRecordingScreenshot] = useState(false)
  const hasRestoredUiState = useRef(false)

  // 加载设置和界面状态
  useEffect(() => {
    const ipcRenderer = getIpcRenderer()
    if (ipcRenderer) {
      Promise.all([
        ipcRenderer.invoke('get-settings'),
        ipcRenderer.invoke('get-ui-state')
      ]).then(([loadedSettings, loadedUiState]: [Settings, UiState]) => {
        if (loadedSettings) {
          setSettings(loadedSettings)
          setShortcutHint(formatShortcut(loadedSettings.shortcut))
        }

        if (loadedUiState) {
          setSourceText(loadedUiState.sourceText || DEFAULT_UI_STATE.sourceText)
          setTargetText(loadedUiState.targetText || DEFAULT_UI_STATE.targetText)
          setError(loadedUiState.error || DEFAULT_UI_STATE.error)
          setShowSettings(Boolean(loadedUiState.showSettings))
        }
      }).finally(() => {
        hasRestoredUiState.current = true
      })
    }
  }, [])

  // 持久化界面状态
  useEffect(() => {
    const ipcRenderer = getIpcRenderer()
    if (!ipcRenderer || !hasRestoredUiState.current) {
      return
    }

    const timer = window.setTimeout(() => {
      ipcRenderer.invoke('save-ui-state', {
        sourceText,
        targetText,
        error,
        showSettings,
      } satisfies UiState)
    }, 150)

    return () => {
      window.clearTimeout(timer)
    }
  }, [sourceText, targetText, error, showSettings])

  // 监听来自主进程的快捷键事件
  useEffect(() => {
    const ipcRenderer = getIpcRenderer()
    if (ipcRenderer) {
      const handleTranslateShortcut = (_: any, text: string) => {
        setSourceText(text)
        setTargetText('')
        setError('')
        if (text && text.trim()) {
          handleTranslate(text)
        }
      }

      const handleScreenshotStatus = (_: any, statusText: string) => {
        setSourceText('')
        setTargetText(statusText)
        setError('')
        setIsLoading(true)
      }

      const handleScreenshotResult = (_: any, resultText: string) => {
        setSourceText('')
        setTargetText(resultText)
        setError('')
        setIsLoading(false)
      }

      const handleScreenshotError = (_: any, errorMessage: string) => {
        setError(errorMessage || '截图翻译失败')
        setTargetText('')
        setIsLoading(false)
      }

      ipcRenderer.on('translate-shortcut', handleTranslateShortcut)
      ipcRenderer.on('screenshot-translation-status', handleScreenshotStatus)
      ipcRenderer.on('screenshot-translation-result', handleScreenshotResult)
      ipcRenderer.on('screenshot-translation-error', handleScreenshotError)

      return () => {
        ipcRenderer.removeListener('translate-shortcut', handleTranslateShortcut)
        ipcRenderer.removeListener('screenshot-translation-status', handleScreenshotStatus)
        ipcRenderer.removeListener('screenshot-translation-result', handleScreenshotResult)
        ipcRenderer.removeListener('screenshot-translation-error', handleScreenshotError)
      }
    }
  }, [settings])

  // ESC 键关闭窗口
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !showSettings) {
        closeWindow()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [showSettings])

  const formatShortcut = (shortcut: string): string => {
    return shortcut
      .replace('CommandOrControl+', 'Ctrl+')
      .replace('Command+', 'Cmd+')
      .replace('Control+', 'Ctrl+')
      .replace('Alt+', 'Alt+')
      .replace('Shift+', 'Shift+')
  }

  const handleTranslate = async (text?: string) => {
    const inputText = text || sourceText
    if (!inputText.trim()) {
      setError('请输入要翻译的中文或英文内容')
      return
    }

    setIsLoading(true)
    setError('')

    try {
      const result = await translate(inputText, settings)
      setTargetText(result)
    } catch (err) {
      setError('翻译失败，请检查网络连接')
      console.error(err)
    } finally {
      setIsLoading(false)
    }
  }

  const copyResult = () => {
    navigator.clipboard.writeText(targetText)
    const btn = document.querySelector('.copy-btn')
    if (btn) {
      const originalText = btn.textContent
      btn.textContent = '已复制'
      setTimeout(() => {
        if (btn) btn.textContent = originalText
      }, 1500)
    }
  }

  const closeWindow = () => {
    console.log('Close button clicked')
    const ipcRenderer = getIpcRenderer()
    if (ipcRenderer) {
      console.log('Sending close-window IPC message')
      ipcRenderer.send('close-window')
    } else {
      console.log('IPC renderer not available')
    }
  }

  const openSettings = () => {
    setShowSettings(true)
  }

  const saveSettings = async () => {
    const ipcRenderer = getIpcRenderer()
    if (ipcRenderer) {
      await ipcRenderer.invoke('save-settings', settings)
      setShortcutHint(formatShortcut(settings.shortcut))
      setShowSettings(false)
    }
  }

  const handleShortcutChange = (e: ReactKeyboardEvent) => {
    e.preventDefault()
    e.stopPropagation()

    const keys: string[] = []
    if (e.ctrlKey) keys.push(isMac() ? 'Command' : 'Control')
    if (e.altKey) keys.push('Alt')
    if (e.shiftKey) keys.push('Shift')
    if (e.metaKey) keys.push('Command')

    // 主键
    const mainKey = e.key
    if (mainKey && !['Control', 'Alt', 'Shift', 'Meta'].includes(mainKey)) {
      keys.push(mainKey.toUpperCase())
    }

    if (keys.length >= 2) {
      const newShortcut = keys.join('+')
      setSettings({ ...settings, shortcut: newShortcut })
      setIsRecording(false)
    }
  }

  const handleScreenshotShortcutChange = (e: ReactKeyboardEvent) => {
    e.preventDefault()
    e.stopPropagation()

    const keys: string[] = []
    if (e.ctrlKey) keys.push(isMac() ? 'Command' : 'Control')
    if (e.altKey) keys.push('Alt')
    if (e.shiftKey) keys.push('Shift')
    if (e.metaKey) keys.push('Command')

    // 主键
    const mainKey = e.key
    if (mainKey && !['Control', 'Alt', 'Shift', 'Meta'].includes(mainKey)) {
      keys.push(mainKey.toUpperCase())
    }

    if (keys.length >= 2) {
      const newShortcut = keys.join('+')
      setSettings({ ...settings, screenshotShortcut: newShortcut })
      setIsRecordingScreenshot(false)
    }
  }

  const isMac = () => navigator.platform.toUpperCase().indexOf('MAC') >= 0

  const startRecording = () => {
    setIsRecording(true)
  }

  const startRecordingScreenshot = () => {
    setIsRecordingScreenshot(true)
  }

  const shouldShowApiSettings = settings.apiProvider === 'openai' || settings.enableScreenshotTranslation

  return (
    <>
      <div className="app">
        <div className="title-bar">
          <span className="title">双向翻译</span>
          <span className="shortcut-hint">{shortcutHint}</span>
          <button className="close-btn" onClick={closeWindow}>
            ✕
          </button>
        </div>

        <div className="content">
          <div className="input-section">
            <textarea
              className="input-textarea"
              value={sourceText}
              onChange={(e: any) => setSourceText(e.target.value)}
              placeholder="输入中文或英文..."
              rows={1}
              autoFocus
            />
          </div>

          <div className="action-section">
            <button
              className="translate-btn"
              onClick={() => handleTranslate()}
              disabled={isLoading || !sourceText.trim()}
            >
              {isLoading ? '翻译中...' : '翻译'}
            </button>
          </div>

          <div className="output-section">
            <textarea
              className="output-textarea"
              value={targetText}
              readOnly
              placeholder="翻译结果"
              rows={1}
            />
            {targetText && (
              <button className="copy-btn" onClick={copyResult}>
                复制
              </button>
            )}
          </div>

          {error && <div className="error">{error}</div>}
        </div>

        <button className="settings-btn" onClick={openSettings} title="打开设置">
          ⚙
        </button>
      </div>

      {showSettings && (
        <div className="settings-modal" onMouseDown={(e: any) => e.stopPropagation()}>
          <div className="settings-panel">
            <div className="settings-header">
              <span className="settings-title">设置</span>
              <button className="close-btn" onClick={() => setShowSettings(false)}>
                ✕
              </button>
            </div>

            <div className="settings-content">
              <div className="settings-group">
                <label className="settings-label">快捷键</label>
                <div className="shortcut-recorder">
                  <div
                    className={`shortcut-display ${isRecording ? 'recording' : ''}`}
                    tabIndex={0}
                    onKeyDown={handleShortcutChange}
                  >
                    {isRecording ? '按下快捷键...' : formatShortcut(settings.shortcut)}
                  </div>
                  <button
                    className="settings-btn-secondary"
                    onClick={isRecording ? () => setIsRecording(false) : startRecording}
                  >
                    {isRecording ? '取消' : '录制'}
                  </button>
                </div>
              </div>

              <div className="settings-group">
                <label className="settings-label">翻译服务</label>
                <select
                  className="settings-select"
                  value={settings.apiProvider}
                  onChange={(e: any) => setSettings({ ...settings, apiProvider: e.target.value as 'google' | 'openai' })}
                >
                  <option value="google">Google 翻译（免费）</option>
                  <option value="openai">OpenAI API</option>
                </select>
              </div>

              {shouldShowApiSettings && (
                <>
                  <div className="settings-group">
                    <label className="settings-label">接口地址</label>
                    <input
                      type="text"
                      className="settings-input"
                      value={settings.openaiApiUrl}
                      onChange={(e: any) => setSettings({ ...settings, openaiApiUrl: e.target.value })}
                      placeholder="http://127.0.0.1:8080/v1"
                    />
                  </div>

                  <div className="settings-group">
                    <label className="settings-label">凭证 / Token</label>
                    <input
                      type="password"
                      className="settings-input"
                      value={settings.openaiApiKey}
                      onChange={(e: any) => setSettings({ ...settings, openaiApiKey: e.target.value })}
                      placeholder="留空表示不发送鉴权头"
                    />
                  </div>

                  <div className="settings-group">
                    <label className="settings-label">鉴权头名称</label>
                    <input
                      type="text"
                      className="settings-input"
                      value={settings.openaiAuthHeaderName || ''}
                      onChange={(e: any) => setSettings({ ...settings, openaiAuthHeaderName: e.target.value })}
                      placeholder="Authorization 或 api-key"
                    />
                  </div>

                  <div className="settings-group">
                    <label className="settings-label">鉴权前缀</label>
                    <input
                      type="text"
                      className="settings-input"
                      value={settings.openaiAuthPrefix || ''}
                      onChange={(e: any) => setSettings({ ...settings, openaiAuthPrefix: e.target.value })}
                      placeholder="Bearer，可留空"
                    />
                  </div>

                  {settings.apiProvider === 'openai' && (
                    <div className="settings-group">
                      <label className="settings-label">文本模型</label>
                      <input
                        type="text"
                        className="settings-input"
                        value={settings.openaiModel}
                        onChange={(e: any) => setSettings({ ...settings, openaiModel: e.target.value })}
                        placeholder="gpt-3.5-turbo"
                      />
                    </div>
                  )}
                </>
              )}

              <div className="settings-group">
                <label className="settings-label">截图翻译</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <input
                    type="checkbox"
                    id="enable-screenshot"
                    checked={settings.enableScreenshotTranslation || false}
                    onChange={(e: any) => setSettings({ ...settings, enableScreenshotTranslation: e.target.checked })}
                  />
                  <label htmlFor="enable-screenshot" style={{ fontSize: '13px' }}>启用截图翻译（支持 OpenAI 兼容接口）</label>
                </div>
              </div>

              {settings.enableScreenshotTranslation && (
                <>
                  <div className="settings-group">
                    <label className="settings-label">截图快捷键</label>
                    <div className="shortcut-recorder">
                      <div
                        className={`shortcut-display ${isRecordingScreenshot ? 'recording' : ''}`}
                        tabIndex={0}
                        onKeyDown={handleScreenshotShortcutChange}
                      >
                        {isRecordingScreenshot ? '按下快捷键...' : formatShortcut(settings.screenshotShortcut || 'CommandOrControl+Alt+S')}
                      </div>
                      <button
                        className="settings-btn-secondary"
                        onClick={isRecordingScreenshot ? () => setIsRecordingScreenshot(false) : startRecordingScreenshot}
                      >
                        {isRecordingScreenshot ? '取消' : '录制'}
                      </button>
                    </div>
                  </div>

                  <div className="settings-group">
                    <label className="settings-label">视觉模型</label>
                    <select
                      className="settings-select"
                      value={settings.visionModel || 'gpt-4o'}
                      onChange={(e: any) => setSettings({ ...settings, visionModel: e.target.value })}
                    >
                      <option value="gpt-5.4">GPT-5.4（本地）</option>
                      <option value="gpt-4o">GPT-4o</option>
                      <option value="gpt-4-vision-preview">GPT-4 Vision Preview</option>
                      <option value="gpt-4-turbo">GPT-4 Turbo</option>
                    </select>
                  </div>
                </>
              )}
            </div>

            <div className="settings-footer">
              <button className="settings-btn-secondary" onClick={() => setShowSettings(false)}>
                取消
              </button>
              <button className="settings-btn-primary" onClick={saveSettings}>
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default App

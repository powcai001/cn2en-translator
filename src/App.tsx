import { useState, useEffect, useRef } from 'react'
import { translate } from './api/translate'
import './App.css'

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

  // 加载设置
  useEffect(() => {
    const ipcRenderer = getIpcRenderer()
    if (ipcRenderer) {
      ipcRenderer.invoke('get-settings').then((loadedSettings: Settings) => {
        if (loadedSettings) {
          setSettings(loadedSettings)
          setShortcutHint(formatShortcut(loadedSettings.shortcut))
        }
      })
    }
  }, [])

  // 监听来自主进程的快捷键事件
  useEffect(() => {
    const ipcRenderer = getIpcRenderer()
    if (ipcRenderer) {
      const handler = (_: any, text: string) => {
        setSourceText(text)
        setError('')
        if (text && text.trim()) {
          handleTranslate(text)
        }
      }
      ipcRenderer.on('translate-shortcut', handler)
      return () => {
        ipcRenderer.removeListener('translate-shortcut', handler)
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
      setError('请输入要翻译的中文内容')
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

  const handleShortcutChange = (e: React.KeyboardEvent) => {
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

  const isMac = () => navigator.platform.toUpperCase().indexOf('MAC') >= 0

  const startRecording = () => {
    setIsRecording(true)
  }

  return (
    <>
      <div className="app">
        <div className="title-bar">
          <span className="title">中英翻译</span>
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
              onChange={(e) => setSourceText(e.target.value)}
              placeholder="输入中文..."
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
        <div className="settings-modal" onMouseDown={(e) => e.stopPropagation()}>
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
                  onChange={(e) => setSettings({ ...settings, apiProvider: e.target.value as 'google' | 'openai' })}
                >
                  <option value="google">Google 翻译（免费）</option>
                  <option value="openai">OpenAI API</option>
                </select>
              </div>

              {settings.apiProvider === 'openai' && (
                <>
                  <div className="settings-group">
                    <label className="settings-label">API 地址</label>
                    <input
                      type="text"
                      className="settings-input"
                      value={settings.openaiApiUrl}
                      onChange={(e) => setSettings({ ...settings, openaiApiUrl: e.target.value })}
                      placeholder="https://api.openai.com/v1"
                    />
                  </div>

                  <div className="settings-group">
                    <label className="settings-label">API Key</label>
                    <input
                      type="password"
                      className="settings-input"
                      value={settings.openaiApiKey}
                      onChange={(e) => setSettings({ ...settings, openaiApiKey: e.target.value })}
                      placeholder="sk-..."
                    />
                  </div>

                  <div className="settings-group">
                    <label className="settings-label">模型</label>
                    <input
                      type="text"
                      className="settings-input"
                      value={settings.openaiModel}
                      onChange={(e) => setSettings({ ...settings, openaiModel: e.target.value })}
                      placeholder="gpt-3.5-turbo"
                    />
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

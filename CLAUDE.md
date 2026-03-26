# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Electron + React + TypeScript desktop application for Chinese-to-English translation. Uses Vite for bundling with `vite-plugin-electron` handling main process compilation.

## Development Commands

```bash
npm install              # Install dependencies
npm run electron:dev     # Start development with hot reload (Vite dev server on :5173 + Electron)
npm run electron:build   # Build for production (runs tsc + vite build + electron-builder)
npm run dev              # Run Vite dev server only (for UI-only development)
npm run build            # Build renderer process only (TypeScript + Vite)
```

## Architecture

### Electron Process Structure
- **Main process**: `electron/main.ts` - Creates BrowserWindow, registers global shortcuts
- **Renderer process**: React app in `src/` - User interface

### IPC Communication
Global shortcut (Ctrl+Shift+T) flow:
1. Main process captures clipboard text via `clipboard.readText()`
2. Sends to renderer via `webContents.send('translate-shortcut', text)`
3. Renderer listens via `ipcRenderer.on('translate-shortcut', handler)`
4. Note: `contextIsolation: false` and `nodeIntegration: true` are enabled for direct IPC access
5. Window is restored and focused if minimized when shortcut is triggered

### Development Workflow
`npm run electron:dev` uses `concurrently` to:
- Start Vite dev server on port 5173
- Wait for server to be ready (via `wait-on`)
- Launch Electron and load from dev server
- Auto-open DevTools in development mode

### Translation Layer (`src/api/translate.ts`)
Two-tier fallback system:
1. **Primary**: Google Translate (free, no auth) - `googleTranslate()` - 10 second timeout
2. **Fallback**: Baidu Translate API (requires keys) - `baiduTranslate()`

Baidu API credentials via environment variables:
- `VITE_BAIDU_APP_ID`
- `VITE_BAIDU_SECRET_KEY`

Uses MD5 signature generation for Baidu API authentication (`crypto` module required at runtime).

### Environment Setup
Create `.env` file in project root for Baidu API configuration:
```
VITE_BAIDU_APP_ID=your_app_id
VITE_BAIDU_SECRET_KEY=your_secret_key
```
Note: Environment variables must be prefixed with `VITE_` to be accessible in renderer process.

### Build Configuration
- **Target**: NSIS installer for Windows (`electron-builder`)
- **Output**: `dist/` directory
- **Icons**: `assets/icon.ico` (Windows), `assets/icon.png` (other platforms)
- **User settings**: Configurable installation directory (one-click disabled)

### TypeScript Configuration
- `strict: true` with `noUnusedLocals` and `noUnusedParameters` enabled
- Both `src/` and `electron/` directories are included in compilation

# Repository Guidelines

## Project Structure & Module Organization
This repository is an Electron desktop app built with React, TypeScript, and Vite.

- `src/` — renderer code and UI
  - `App.tsx` holds the main translator interface
  - `api/translate.ts` contains Google/Baidu translation logic
  - `App.css` stores renderer styles
- `electron/main.ts` — Electron main process, window setup, global shortcut, clipboard flow
- `dist-electron/` — generated Electron build output
- `package.json` — scripts, dependencies, and Electron Builder config
- `README.md` / `CLAUDE.md` — setup and architecture notes

Keep renderer-only code in `src/` and OS/window/shortcut logic in `electron/`.

## Build, Test, and Development Commands
- `npm install` — install project dependencies
- `npm run dev` — start the Vite renderer only
- `npm run electron:dev` — run Vite and Electron together for local development
- `npm run build` — type-check and build the renderer bundle
- `npm run electron:build` — create a production desktop package with Electron Builder
- `npm run preview` — preview the built renderer locally

## Coding Style & Naming Conventions
- Use TypeScript and functional React components.
- Follow the existing style: 2-space indentation, semicolon-free statements, single quotes.
- Use `camelCase` for variables/functions, `PascalCase` for React components, and clear verb-based handler names such as `handleTranslate`.
- Keep API helpers in `src/api/` and avoid mixing Electron APIs directly into UI code unless IPC is required.

## Testing Guidelines
There is currently no automated test suite configured. Before opening a PR:
- run `npm run build` to catch TypeScript and bundling issues
- manually verify translation, clipboard copy, and the `Ctrl+Shift+T` shortcut via `npm run electron:dev`

If you add tests, place them beside the module or under a future `tests/` folder and name them `*.test.ts` or `*.test.tsx`.

## Commit & Pull Request Guidelines
Git history is not available in this checkout, so follow a simple Conventional Commit style such as `feat: add Baidu API fallback` or `fix: handle empty clipboard input`.

Pull requests should include:
- a short summary of the change
- steps to test locally
- linked issue/task if applicable
- screenshots or screen recordings for UI changes

## Security & Configuration Tips
Store API credentials in `.env`, not in source files. Current optional variables are `VITE_BAIDU_APP_ID` and `VITE_BAIDU_SECRET_KEY`.

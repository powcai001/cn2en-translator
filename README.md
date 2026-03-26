# 中英翻译助手

一个基于 Electron 的桌面翻译工具，支持中文一键翻译成英文。

## 功能特点

- 实时中英翻译
- 全局快捷键支持 (Ctrl+Shift+T)
- 简洁美观的界面
- 一键复制翻译结果

## 安装依赖

```bash
npm install
```

## 开发模式运行

```bash
npm run electron:dev
```

## 打包构建

```bash
npm run electron:build
```

## 翻译API配置

项目默认使用 Google Translate 免费API，无需配置即可使用。

如需使用百度翻译API（更稳定）：

1. 访问 https://fanyi-api.baidu.com/ 申请API密钥
2. 创建 `.env` 文件：

```
VITE_BAIDU_APP_ID=你的APP_ID
VITE_BAIDU_SECRET_KEY=你的密钥
```

## 快捷键

- **Ctrl+Shift+T**: 复制文本后按下，自动填充并翻译

## 技术栈

- Electron
- React + TypeScript
- Vite
- Axios

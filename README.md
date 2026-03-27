# 中英翻译助手

一个基于 Electron 的桌面翻译工具，支持中文一键翻译成英文。

## 功能特点

- 实时中英翻译
- 全局快捷键支持 (Ctrl+Shift+T)
- 简洁美观的界面
- 一键复制翻译结果

## 下载与安装 (GitHub Releases)

发布后，用户可在 GitHub 仓库的 Releases 页面下载对应系统安装包：

- 仓库主页: https://github.com/powcai001/cn2en-translator
- Releases: https://github.com/powcai001/cn2en-translator/releases

### Windows

1. 在 Releases 下载 `.exe` 安装包
2. 双击运行安装程序
3. 安装完成后从开始菜单启动应用

### macOS

1. 在 Releases 下载 `.dmg` (或 `.zip`) 安装包
2. 打开后将应用拖入 `Applications`
3. 首次启动若被系统拦截，请在系统设置中允许打开

### Linux

按发布产物类型选择：

- `.AppImage`: 下载后执行 `chmod +x 文件名.AppImage`，再运行
- `.deb`: Ubuntu/Debian 可双击安装或使用 `sudo dpkg -i 文件名.deb`
- `.rpm`: Fedora/CentOS 可使用 `sudo rpm -i 文件名.rpm`

## 开发者从源码运行

### 1) 克隆项目

```bash
git clone https://github.com/powcai001/cn2en-translator.git
cd cn2en-translator
```

### 2) 安装依赖

```bash
npm install
```

### 3) 开发模式运行 (Electron + Vite)

```bash
npm run electron:dev
```

如果只想运行前端页面 (不启动 Electron)：

```bash
npm run dev
```

## 构建与发布

### 本地打包

```bash
npm run electron:build
```

打包完成后，安装包通常位于 `dist/` 或 `release/` (取决于构建配置)。

### 发布到 GitHub

1. 进入仓库的 Releases 页面
2. 点击 "Draft a new release"
3. 填写版本号和更新说明
4. 上传各系统安装包 (`.exe` / `.dmg` / `.AppImage` / `.deb` / `.rpm`)
5. 发布 Release

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

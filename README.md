# 中英翻译助手

一款简洁高效的桌面翻译工具，支持划词翻译和截图翻译，让您的工作更加便捷。

## 主要功能

### 划词翻译
- 选中文本后按快捷键，自动识别并翻译
- 智能检测中英文，自动双向翻译
- 翻译结果直接显示，无需点击

### 截图翻译
- 截图识别图片中的文字并翻译
- 支持 OpenAI 兼容接口（如 GPT-4o、GPT-4 Vision）
- 自动识别文字语言并翻译

### 手动翻译
- 输入文本进行翻译
- 支持中英互译

### 快捷操作
- 按 `C` 键快速复制翻译结果
- 按 `ESC` 键或点击窗口外部关闭窗口
- 可自定义快捷键

### 多种翻译API
- **Google Translate** - 免费使用，无需配置
- **OpenAI 兼容接口** - 支持自定义接口地址、鉴权方式

## 下载与安装

前往 [GitHub Releases](https://github.com/powcai001/cn2en-translator/releases) 下载对应系统的安装包。

### Windows
下载 `.exe` 安装包，双击运行安装

### macOS
下载 `.dmg` 文件，打开后拖入 Applications 文件夹

### Linux
- `.AppImage`: 下载后添加执行权限 `chmod +x 文件名.AppImage` 运行
- `.deb`: Ubuntu/Debian 使用 `sudo dpkg -i 文件名.deb` 安装
- `.rpm`: Fedora/CentOS 使用 `sudo rpm -i 文件名.rpm` 安装

## 使用指南

### 默认快捷键
- **划词翻译**: `Ctrl+Alt+T` (macOS: `Cmd+Alt+T`)
- **截图翻译**: `Ctrl+Alt+S` (macOS: `Cmd+Alt+S`)

### 截图翻译配置
截图翻译需要配置 OpenAI 兼容接口：

1. 点击右下角设置按钮 ⚙
2. 启用"截图翻译"
3. 配置接口地址、API密钥等信息
4. 选择视觉模型（如 GPT-4o）

### 窗口操作
- 窗口大小可手动调整，会自动记住
- 点击窗口外部或按 `ESC` 关闭窗口
- 按 `C` 快速复制翻译结果

## 开发者指南

### 从源码运行

```bash
# 克隆项目
git clone https://github.com/powcai001/cn2en-translator.git
cd cn2en-translator

# 安装依赖
npm install

# 开发模式运行
npm run electron:dev

# 仅运行前端
npm run dev
```

### 构建打包

```bash
npm run electron:build
```

## 技术栈

- **Electron** - 跨平台桌面应用框架
- **React + TypeScript** - 前端框架
- **Vite** - 构建工具
- **Electron Store** - 配置持久化

## 许可证

MIT License

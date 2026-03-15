# vue-llm

一个基于 Vue 3 + Vite + Pinia 的本地 AI 对话练习项目，支持 DeepSeek 流式输出、会话历史管理与 Web Speech API 语音输入。

## 功能

- DeepSeek 流式对话：fetch + ReadableStream 读取增量输出，支持中断生成
- 会话管理：新建/切换/重命名/删除/清空，支持搜索
- 历史持久化：Pinia persistedstate（刷新后可恢复）
- 长列表优化：vue-virtual-scroller 虚拟渲染消息列表
- 语音输入：Web Speech API 语音转写

## 技术栈

- Vue 3 + Vite
- Pinia（pinia-plugin-persistedstate）
- Element Plus
- vue-virtual-scroller
- Web Speech API

## 快速开始

### 1) 安装依赖

```bash
npm install
```

### 2) 配置环境变量

复制 `.env.example` 为 `.env.local`，并填入你的 DeepSeek Key：

```bash
# .env.local
VITE_DEEPSEEK_API_KEY=your_api_key_here
```

注意：`.env.local` 会被忽略，不会提交到仓库。

### 3) 启动开发服务

```bash
npm run dev
```

## 构建

```bash
npm run build
```

## License

MIT

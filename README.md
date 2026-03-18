# WeCom AI Bot Long Connection Plugin (Node.js)

这是一个基于企业微信智能机器人长连接（WebSocket）协议开发的 Node.js 核心插件。它提供了轻量级、零重度依赖的封装，旨在帮助开发者快速将 AI Agent 后端接入企业微信生态。

## 核心特性

- **稳定长连接**：基于原生 WebSocket 实现，包含自动连接、身份订阅（`aibot_subscribe`）、心跳保活（Ping/Pong）及断线自动重连机制。
- **全消息类型支持**：接收文本（Text）、图片（Image）、文件（File）、语音（Voice）、视频（Video）及图文混排（Mixed）消息。
- **事件流驱动**：处理进入会话（`enter_chat`）、卡片点击交互（`template_card_event`）、用户反馈及连接异常等事件。
- **灵活的回复机制**：
  - **流式回复 (Streaming)**：原生支持逐字/逐段下发 AI 生成内容，对齐 OpenClaw 标准。
  - **模板卡片回复**：支持通过流式容器下发交互式卡片，提供更强的兼容性。
  - **欢迎语系统**：针对首次入会话场景的专属回复接口。
- **主动推送能力**：无需依赖用户触发，可主动向用户或群聊推送 Markdown/模板卡片等消息。
- **高性能素材管理**：
  - **分片上传**：支持 Init -> Chunk -> Finish 三步法分片上传临时素材。
  - **安全解密**：内置 AES-256-CBC 算法，用于解密企微加密的多媒体资源。

## 核心架构与业务解耦

本项目实现了“底层通信”与“业务逻辑”的深度解耦。开发者只需复用 `src/wecom-bot.js` 即可快速集成。

### 1. 核心 SDK：`wecom-bot.js` (重点复用)

这是项目的核心插件，封装了所有复杂的长连接协议细节，可直接拷贝到任何 Node.js 项目中使用：

- **连接与保活**：自动处理 WebSocket 握手、身份订阅、心跳（Ping/Pong）及断线自动重连。
- **安全与多媒体**：内置 AES-256-CBC 算法自动解密企微多媒体素材，支持复杂的分片上传（Init-Chunk-Finish）逻辑。
- **接口封装**：将原始 JSON 协议简化为 `respondStreamMsg`、`uploadMedia` 等易用 API，并通过事件驱动（EventEmitter）分发消息。

### 2. 参考实现：`mock-agent.js`

演示了如何基于上述 SDK 对接后端 agent，涵盖了各类消息的支持：

- **文本交互**：演示了基础对话、**流式逐字下发**、**交互式按钮卡片**。
- **多媒体闭环**：
  - **语音**：接收并展示企微端自动转写的文字内容。
  - **图片/文件/视频**：演示了“接收加密链接 -> 下载 -> 解密 -> 存盘 -> 重传 -> 回发”的完整闭环。
- **事件响应**：处理**用户进入会话**（发送欢迎语）及**卡片按钮点击**（动态更新卡片内容）。
- **主动推送**：演示如何在非对话触发场景下，异步向用户推送消息。

### 3. 如何开发自己的 AI Agent

你只需引用 `wecom-bot.js` 并订阅事件，即可将精力集中在 AI 逻辑上：

```javascript
const WeComAIBot = require('./src/wecom-bot');
const bot = new WeComAIBot({ botId: '...', secret: '...' });

bot.on('message', async (body, reqId) => {
  // 1. 识别消息类型 (text, image, file, voice, video)
  if (body.msgtype === 'text') {
    const userPrompt = body.text.content;
    // 2. 接入你的 AI 逻辑并回传 (以流式为例)
    bot.respondStreamMsg(reqId, "思考中...", "sid_001", false);
    bot.respondStreamMsg(reqId, "这是 AI 的回答。", "sid_001", true);
  }
});

bot.connect();
```

## 技术规范与限制 (重要)

根据企业微信官方文档，使用本插件时请务必遵守以下频率与技术限制：

### 1. 消息发送频率限制

- **30 条 / 分钟**
- **1000 条 / 小时**

### 2. 媒体上传限制

- **30 次 / 分钟**
- **1000 条 / 小时**
- **文件有效期**：上传成功的素材 `media_id` 有效期为 **3 天**。
- **会话有效期**：初始化上传后，需在 **30 分钟** 内完成所有分片上传。

### 3. 超时控制

- **响应时效**：收到进入会话或卡片点击事件后，必须在 **5 秒** 内发送回复。
- **流式时效**：一条流式消息从首次下发开始，必须在 **6 分钟** 内完成所有更新并设置 `finish=true`。
- **下载链接**：接收消息中的媒体 URL 有效期仅为 **5 分钟**。

### 4. 连接限制

- 每个机器人同一时间只能保持 **1 个** 有效长连接。新连接建立时，旧连接将被服务端自动踢掉（断开）。

## 快速开始

### 1. 安装

```bash
npm install
```

### 2. 配置环境变量 (`.env`)

在根目录创建 `.env` 文件：

```env
BOT_ID=你的机器人ID
SECRET=你的长连接专用密钥
```

### 3. 运行测试 Agent

项目内置了一个 `MockAgent`，用于演示各项功能：

```bash
npm start
```

您可以尝试以下测试场景：

- **流式回复**：发送包含“流式”或“stream”的消息。
- **模板卡片**：发送包含“卡片”或“card”的消息，点击按钮可测试**卡片动态更新**。
- **主动推送**：发送包含“推送”的消息，机器人将在 5 秒后主动向您推送一条 Markdown 消息。
- **欢迎语**：在手机端或电脑端点击**进入机器人会话**，测试 `enter_chat` 事件触发。
- **多媒体消息**：尝试发送**图片、文件、语音或视频**，测试非文本消息的初步接收响应。
- **普通文本**：发送任意其他文字，测试基础的消息回显（Echo）。

## 核心接口说明 (`src/wecom-bot.js`)

- `bot.connect()`: 启动长连接并完成认证。
- `bot.respondStreamMsg(reqId, content, streamId, finish)`: 以流式包装发送回复（推荐）。
- `bot.respondWelcomeMsg(reqId, text)`: 回复欢迎语。
- `bot.sendMsg(chatId, chatType, msgType, content)`: 主动推送消息。
- `bot.uploadMedia(type, filename, buffer)`: 执行分片上传。

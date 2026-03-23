# wxwork-contract-bot

企业微信合同管理 AI 机器人。

这个项目把 3 层能力组合在一起：

- 企业微信智能机器人长连接通道
- 基于 `ai` SDK 的通用 Agent 执行循环
- 面向合同台账的本地 MCP 服务与文件归档能力

机器人可以在企业微信里接收文本和附件，结合角色提示词、附件解析和合同管理工具，完成合同归档、补充附件、更新字段、查询详情、检索即将到期合同等操作。

## 主要能力

- 企业微信长连接接入，支持消息监听、欢迎语、流式状态更新
- Agent 多步执行，支持工具调用、会话记忆、角色提示词
- 通过 MCP 管理合同数据，不直接绕过数据库和归档目录
- 支持合同文件归档、元数据更新、检索、到期查询、归档标记
- 支持附件文本读取，对 PDF / DOCX / PPTX / XLS / XLSX 可通过 MarkItDown 提取文本
- 可选启用 MarkItDown OCR 插件，对扫描版 PDF 做额外识别
- 具备基础测试覆盖，包含 Agent、MCP、通道和文件回传相关场景

## 项目结构

```text
.
├─ index.js               # 程序入口
├─ app.js                 # 配置处理、Agent/Channel 装配、消息分发
├─ config.json            # 项目主配置
├─ agent/                 # Agent 核心、会话、工具装配、角色加载
├─ channel/wxwork/        # 企业微信通道适配器
├─ contract-mcp/          # 合同管理 MCP 服务、工具、仓储实现
├─ roles/contract-manager/# 合同管理员角色提示词
├─ skills/                # Agent 技能目录
├─ markitdown/            # 附件解析依赖安装与运行时封装
├─ data/                  # 会话数据库等本地数据
├─ storage/               # 临时文件与合同文件存储
└─ tests/                 # 测试
```

## 运行要求

- Node.js 18+
- Windows 环境下已验证过主要流程
- 企业微信智能机器人长连接配置
- 可用的大模型兼容 API
- 如果要解析 Office / PDF 附件，需要可用的 Python 环境用于 MarkItDown

## 安装

```bash
npm install
```

安装完成后会自动执行：

```bash
npm run markitdown:install
```

如果自动安装失败，也可以手动执行上面的命令重新安装 MarkItDown 依赖。

如果需要识别扫描版 PDF，安装时还会一并装上 `markitdown-ocr` 与 `openai` Python 依赖。

## 环境变量

在项目根目录创建 `.env`：

```env
BOT_ID=企业微信机器人ID
SECRET=企业微信长连接密钥
OPENAI_API_KEY=你的模型服务密钥

# 可选
OPENAI_BASE_URL=https://api.zetatechs.com/v1
MODEL_NAME=qwen3.5-plus
DEBUG=true
```

说明：

- `BOT_ID`、`SECRET` 用于企业微信长连接通道
- `OPENAI_API_KEY` 用于 Agent 调用模型
- `OPENAI_BASE_URL` 会覆盖 `config.json` 中的模型服务地址
- `MODEL_NAME` 会覆盖 `config.json` 中的模型名
- `DEBUG=true` 会打开通道调试输出

## 配置说明

主配置文件为 [config.json](./config.json)。

当前配置里几个关键部分如下：

- `agent`
  - 模型、工具调用策略、最大步骤数
  - 会话数据库路径 `agent.sessionDb`
  - 技能目录 `agent.skillsDir`
  - 角色提示词目录 `agent.rolePromptDir`
  - MCP 服务列表 `agent.mcpServers`
  - 附件文本提取配置 `agent.attachmentExtraction`
- `contractMcp`
  - `libraryRoot`：合同库根目录
  - `allowedExtensions`：允许归档的文件类型
  - `maxFileSizeMb`：单文件大小限制
  - `defaultSearchLimit`：默认查询上限
- `channel`
  - 当前默认为 `wxwork`
  - `streamingResponse` 控制是否启用流式回复
- `storage`
  - `tempDir`：通道下载附件和处理临时文件目录

注意：

- 当前仓库里的 `contractMcp.libraryRoot` 默认指向一个局域网共享目录，落地部署前通常需要改成你自己的实际路径。
- 若不希望将合同归档到共享盘，可以直接改为本机绝对路径。

## 启动

```bash
npm start
```

启动链路：

1. [index.js](./index.js) 读取并标准化配置
2. [app.js](./app.js) 初始化 Agent 和通道
3. Agent 启动时预检严格 MCP 服务
4. 企业微信通道建立长连接并开始接收消息

启动成功后会输出当前通道类型。

## 测试

```bash
npm test
```

测试入口为 [tests/run.js](./tests/run.js)，会顺序执行：

- 配置处理测试
- 合同 MCP 配置与服务测试
- Agent 会话、角色、工具与 MCP 集成测试
- 企业微信通道、回调队列、流式状态、文件回传测试

## 合同管理 MCP 能力

本项目内置了一个本地 stdio MCP 服务：[contract-mcp/server.js](./contract-mcp/server.js)。

它提供以下合同管理能力：

- `contract_validate`：校验归档数据是否完整
- `contract_create`：创建合同并导入文件
- `contract_update`：更新合同元数据
- `contract_attach_files`：给已有合同补充附件
- `contract_search`：按关键字、甲乙方、日期、金额、状态检索
- `contract_get`：读取单个合同详情、附件、事件记录
- `contract_list_expiring`：查询即将到期合同
- `contract_archive`：将合同标记为已归档

合同服务的持久化方式：

- SQLite 保存合同元数据、文件记录和审计事件
- 合同文件保存到 `storageRoot/contracts/<contractId>/files/`
- 每个合同目录会额外生成一份 `metadata.json` 快照

## Agent 工作方式

合同机器人角色定义在：

- [roles/contract-manager/01-role.md](./roles/contract-manager/01-role.md)
- [roles/contract-manager/02-workflow.md](./roles/contract-manager/02-workflow.md)

这个角色的约束重点是：

- 先识别任务类型，再决定调用什么工具
- 缺字段时继续追问，不编造
- 字段与文件内容冲突时先核实
- 查询尽量返回结构化摘要
- 不绕过合同管理 MCP 伪造结果

## 附件处理

收到用户附件后，Agent 不会把它们当普通本地文本文件直接读取，而是通过附件工具做安全处理：

- `inspectAttachment`：查看附件元数据和预览
- `readAttachmentText`：按需提取有限长度文本

支持通过 MarkItDown 提取文本的格式由 `config.json` 中的 `supportedExtensions` 控制，当前默认包括：

- `.pdf`
- `.docx`
- `.pptx`
- `.xls`
- `.xlsx`

如果你要支持扫描版 PDF，需要额外把 OCR 参数配到 `agent.attachmentExtraction.markitdown`。推荐把 Agent 对话模型与 OCR 模型分开配置，避免共用同一组 `OPENAI_*` 环境变量。

当前配置支持保留多套 OCR 配置并自由切换：

- `llm`：兼容旧版的单套 OCR 配置，作为默认回退链路
- `llmProfiles`：可选的多套 OCR profile
- `activeLlmProfile`：当前启用的 profile 名称；命中时会覆盖 `llm`

实际推荐写法是只维护 `llmProfiles` 和 `activeLlmProfile`。`llm` 现在仅为了兼容旧配置保留，不建议在新配置里继续重复维护一份。

仓库默认同时保留了两条链路：

- `legacy-openai-compatible`：之前的 OpenAI-compatible OCR 配置
- `qwen-vl-flash`：新的 `qwen3-vl-flash` OCR 配置，按阿里百炼 OpenAI 兼容接口调用，并使用文档推荐的 `qwenvl markdown` 提示词做版面 OCR

示例：

```json
{
  "agent": {
    "attachmentExtraction": {
      "markitdown": {
        "enabled": true,
        "command": "{runner}",
        "args": [
          "./markitdown/runner.py",
          "--use-plugins",
          "--llm-client",
          "{llmClient}",
          "--llm-model",
          "{llmModel}",
          "--llm-base-url",
          "{llmBaseURL}",
          "--llm-prompt",
          "{llmPrompt}",
          "{input}"
        ],
        "supportedExtensions": [".pdf", ".docx", ".pptx", ".xls", ".xlsx"],
        "activeLlmProfile": "qwen-vl-flash",
        "llmProfiles": {
          "legacy-openai-compatible": {
            "client": "openai",
            "model": "gemini-3.1-flash-lite-preview",
            "baseURL": "https://api.zetatechs.com/v1",
            "apiKeyEnv": "MARKITDOWN_OCR_OPENAI_API_KEY",
            "prompt": "Extract all text from this image. Return ONLY the extracted text, maintaining the original layout and order. Do not add any commentary or description."
          },
          "qwen-vl-flash": {
            "client": "qwen",
            "model": "qwen3-vl-flash",
            "baseURL": "https://dashscope.aliyuncs.com/compatible-mode/v1",
            "apiKeyEnv": "DASHSCOPE_API_KEY",
            "prompt": "qwenvl markdown"
          }
        }
      }
    }
  }
}
```

对应的 `.env` 里按你启用的 profile 提供密钥：

```env
MARKITDOWN_OCR_OPENAI_API_KEY=your-openai-compatible-ocr-key
DASHSCOPE_API_KEY=your-dashscope-key
```

说明：

- Agent 仍然继续使用 `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `MODEL_NAME`
- `activeLlmProfile` 命中某个 profile 时，会优先使用该 profile；如果没命中，则回退到 `llm`
- `legacy-openai-compatible` 会把 `MARKITDOWN_OCR_OPENAI_API_KEY` 映射成 OCR 子进程里的 `OPENAI_API_KEY`
- `qwen-vl-flash` 会把 `DASHSCOPE_API_KEY` 映射成 OCR 子进程里的 `OPENAI_API_KEY`
- `client: "qwen"` 会自动走百炼兼容地址 `https://dashscope.aliyuncs.com/compatible-mode/v1`，如果你手动填了 `markitdown.llm.baseURL`，则优先使用你填的地址
- `client: "qwen"` 且未手动指定 prompt 时，会默认使用文档推荐的 `qwenvl markdown`
- 切换 OCR 模型时通常只需要改 `activeLlmProfile`，例如切到旧链路时改成 `legacy-openai-compatible`
- 仓库内固定了一份 OCR 测试样例 PDF：`tests/test_data/markitdown-ocr-scan-sample.pdf`
- 需要验证真实 OCR 时，运行 `npm run test:markitdown-ocr`；这个测试默认会拆成单页逐页调用并输出每页结果
- 如果要测试整份 PDF、输出 runner 分环节计时并保存完整 OCR 结果，运行 `npm run test:markitdown-ocr:full`
- 整份 PDF 测试报告默认写到 `storage/temp/markitdown-ocr-full-report.txt`

## 典型使用场景

- 用户在企业微信里发送合同文件并要求“帮我归档这份合同”
- 用户补发附件并要求“把这个补充协议挂到 CT20260320-001”
- 用户查询“帮我找一下和某客户签过的合同”
- 用户询问“未来 30 天有哪些合同要到期”

## 相关文件

- 程序装配入口：[app.js](./app.js)
- Agent 核心：[agent/index.js](./agent/index.js)
- 运行时工具装配：[agent/tools/index.js](./agent/tools/index.js)
- 合同服务实现：[contract-mcp/service.js](./contract-mcp/service.js)
- 企业微信通道说明：[channel/wxwork/README.md](./channel/wxwork/README.md)

## 后续可补充

如果你准备把这个仓库交给别人使用，建议下一步再补两类文档：

- 一份示例 `config.example.json` 或 `.env.example`
- 一份从企业微信后台创建机器人到联调成功的部署手册

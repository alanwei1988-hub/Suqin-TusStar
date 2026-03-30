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
├─ roles/suqin/          # 苏秦（AI员工）角色提示词
│  ├─ 01-role.md        # 身份定位与公司背景
│  └─ 02-workflow.md    # 通用业务流程规范
├─ skills/                # Agent 技能目录
├─ markitdown/            # 附件解析依赖安装与运行时封装
├─ data/                  # 会话数据库等本地数据
├─ storage/               # 临时文件、用户隔离空间与合同文件存储
└─ tests/                 # 测试
```

多用户运行时会在 `storage/users/` 下为每个 `userId` 建独立目录，默认结构如下：

```text
storage/
└─ users/
   └─ <encodeURIComponent(userId)>/
      ├─ workspace/       # 当前用户的持久工作区；readFile/writeFile/sendFile 只允许访问这里
      ├─ attachments/     # 当前用户从通道下载下来的原始附件
      ├─ data/            # 当前用户专属数据，如附件提取缓存库
      ├─ config.json      # 当前用户配置覆盖文件；不存在则完全使用全局配置
      ├─ skills/          # 当前用户自定义 skills；同名时覆盖全局 skills
      └─ roles/           # 当前用户自定义角色提示词；同相对路径时覆盖全局 roles
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
  - 模型思考控制 `agent.thinking`
  - 长期记忆控制 `agent.memory`
  - 工具超时配置 `agent.toolTimeouts`
  - 会话数据库路径 `agent.sessionDb`
  - 技能目录 `agent.skillsDir`
  - 角色提示词目录 `agent.rolePromptDir`
  - MCP 服务列表 `agent.mcpServers`
  - 附件文本提取配置 `agent.attachmentExtraction`
- `contractMcp`
  - `libraryRoot`：真实 NAS 合同目录根路径
  - `dbPath`：可选；若不填写，默认使用 `libraryRoot/合同归档.db`
  - `archiveIdPrefix`：正式归档记录编号前缀
  - `allowedExtensions`：允许归档的文件类型
  - `maxFileSizeMb`：单文件大小限制
  - `defaultSearchLimit`：默认查询上限
- `channel`
  - 当前默认为 `wxwork`
  - `streamingResponse` 控制是否启用流式回复
- `storage`
  - `tempDir`：通道下载附件和处理临时文件目录
  - `userRootDir`：多用户隔离根目录，默认是 `./storage/users`

注意：

- 当前仓库里的 `contractMcp.libraryRoot` 默认指向测试用目录 `storage/已签署协议电子档`，落地部署前通常需要改成真实 NAS 路径。
- 若不希望将合同归档到共享盘，可以直接改为本机绝对路径。

### 用户隔离与覆盖规则

运行时会先加载全局 `config.json`，再尝试读取当前用户目录下的 `storage/users/<userId编码>/config.json` 进行覆盖。

- 没有用户配置：完全使用全局配置
- 用户配置里只写一部分：只覆盖那一部分，其他项继续沿用全局配置
- `skills`：优先加载用户目录 `skills/`，同名 skill 会覆盖全局 skill；没找到再回退到项目根目录 `skills/`
- `roles`：优先加载用户目录 `roles/`，同相对路径提示词会覆盖全局角色；没找到再回退到项目根目录 `roles/`
- `workspaceDir`：运行时自动切到当前用户的 `workspace/`
- `attachmentExtraction.markitdown.cache.dbPath`：默认自动落到当前用户的 `data/attachment-extraction-cache.db`
  - `memory`：支持在全局或用户配置里覆盖长期记忆参数
- `mcp`、模型、工具超时等其他 agent 配置：用户配置里写了就覆盖，没写就继续用全局

一个最小的用户覆盖配置示例：

```json
{
  "agent": {
    "model": "qwen3.5-plus",
    "mcpServers": [],
    "toolTimeouts": {
      "mcpToolTimeoutMs": 20000
    }
  }
}
```

`agent.memory` 可用参数：

- `reflectionIntervalTurns`：每多少个用户轮次触发一次后台异步 memory reflection
- `dialogueLimit`：前台 `updateMemory` 和后台 reflection 送给 memory-LLM 的最近对话条数上限，只保留 user/assistant，不含 tool
- `asyncReflectionEnabled`：是否启用后台异步 reflection

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

## 多用户实际运行行为

当前版本的多用户行为刻意保持简单：

- 队列按 `userId` 串行，而不是按群聊或频道串行
- 同一个用户连续发多条消息时，会按顺序一条一条处理，避免会话上下文和工具操作互相打架
- 不同用户之间互不排队，可以并发处理
- 会话历史仍按 `userId` 隔离保存
- 每个用户看到和能操作的本地文件范围，只是自己的 `workspace/` 和本次消息带来的附件

对共享 NAS 的影响是：

- 合同正式归档入口仍然是同一个共享 NAS `contractMcp.libraryRoot`
- 但归档工具会强制注入当前请求的 `userId`、来源渠道和来源消息 ID
- 所以归档结果仍然进入同一个 NAS，但能区分是谁发起的操作，而不是所有人都混成匿名来源

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

- `contract_list_directory`：查看真实 NAS 目录结构
- `contract_find_directories`：按关键字查相似目录
- `contract_preview_archive`：正式归档前预览将写入数据库/目录的重要字段、未填写字段、拟文件名
- `contract_archive`：正式归档入口，在上传人确认拟归档字段后完成 NAS 落档和数据库写入
- `contract_get_archive_record`：读取数据库中的单条正式归档记录
- `contract_search_archive_records`：检索 Agent 归档数据库中的正式归档记录，仅覆盖通过 Agent 正式归档过的合同
- `contract_search`：直接检索 NAS 目录中的物理合同文件，包含人工手动复制进入目录但未写入 Agent 归档数据库的文件

合同服务的持久化方式：

- 合同文件直接存放在真实 NAS 目录，NAS 目录是全量物理文件视图
- Agent 正式归档记录写入 `libraryRoot` 下的 SQLite 数据库，默认文件名为 `合同归档.db`，它不是全量主档案库，只覆盖通过 Agent 正式归档的记录
- 一条 `archive_records` 可以关联多条 `archive_files`，适合同时归档 Word、PDF、扫描版、补充附件或多个版本
- Excel 台账继续由人工维护，但不再是 Agent 默认归档链路的一部分

## Agent 工作方式

苏秦（AI 员工）角色定义在：

- [roles/suqin/01-role.md](./roles/suqin/01-role.md)
- [roles/suqin/02-workflow.md](./roles/suqin/02-workflow.md)

这个角色的核心约束是：

- **意图驱动**：先识别业务意图（如合同、算力、咨询等），再激活对应专业技能（Skill）。
- **确认机制**：所有产生物理影响或数据变更的操作（如归档、修改记录），必须先预览并由用户确认。
- **专业交付**：使用 Markdown 表格结构化展示数据，保持专业且亲和的沟通风格。
- **业务深度**：不只是执行指令，而是站在启迪创业孵化器的业务视角，提供有洞察力的辅助建议。
- 不伪造目录状态、归档结果、数据库状态或台账状态

再补一条和用户工作区有关的行为约束：

- Agent 的 `bash` 工具运行在沙箱里，沙箱根目录就是当前用户 `workspace/` 的镜像，不是宿主机真实 shell
- `bash` 在沙箱里新建或修改的文件默认只对当前这次运行可见，不会直接持久写回宿主机
- 如果要把结果真正保存到用户目录，并且后续可被 `readFile` / `sendFile` 看到，Agent 应该使用 `writeFile`
- `writeFile` 只允许写入当前用户 `workspace/` 内的路径
- `readFile` 只读取 `workspace/` 和配置过的只读共享目录，不直接读取用户附件
- `sendFile` 可以发送 `workspace/` 内文件，也可以直接发送当前会话附件和配置过的只读共享目录文件

## 附件处理

收到用户附件后，Agent 不会把它们当普通本地文本文件直接读取，而是通过附件工具做安全处理：

- `inspectAttachment`：查看附件元数据和预览
- `readAttachmentText`：按需提取有限长度文本

附件在本地的默认落点是当前用户目录下的 `storage/users/<userId编码>/attachments/`。这些附件和 `workspace/` 是分开的：

- `attachments/` 保存用户原始上传件
- `workspace/` 保存 Agent 需要长期保留、编辑或回传给用户的工作产物
- 如果用户只是要求“把原图/原文件发回去”，Agent 可以直接对 `attachment://...` 调用 `sendFile`，不需要先 stage 到 `workspace/`

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
- `thinking`：每个模型各自的 thinking / reasoning 控制

实际推荐写法是只维护 `llmProfiles` 和 `activeLlmProfile`。`llm` 现在仅为了兼容旧配置保留，不建议在新配置里继续重复维护一份。

仓库默认同时保留了两条链路：

- `legacy-openai-compatible`：之前的 OpenAI-compatible OCR 配置
- `qwen-vl-flash`：新的 `qwen3-vl-flash` OCR 配置，按阿里百炼 OpenAI 兼容接口调用，并使用文档推荐的 `qwenvl markdown` 提示词做版面 OCR

示例：

```json
{
  "agent": {
    "thinking": {
      "enabled": false,
      "reasoningEffort": "low",
      "textVerbosity": "low"
    },
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
            "prompt": "qwenvl markdown",
            "thinking": {
              "enabled": false
            }
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
- `agent.thinking` 用于主对话模型；`markitdown.llm.thinking` 和 `markitdown.llmProfiles.<name>.thinking` 用于各 OCR 模型
- `thinking.enabled` 会透传成 `enable_thinking`
- `thinking.reasoningEffort` 会透传成 `reasoning_effort`
- `thinking.textVerbosity` 会透传成 `verbosity`
- `thinking.budgetTokens` 会透传成 `budget_tokens`
- `thinking.extraBody` 会原样并入请求体，便于兼容不同供应商的扩展字段
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
- 合同服务实现：[contract-mcp/nas-service.js](./contract-mcp/nas-service.js)
- 企业微信通道说明：[channel/wxwork/README.md](./channel/wxwork/README.md)

## 后续可补充

如果你准备把这个仓库交给别人使用，建议下一步再补两类文档：

- 一份示例 `config.example.json` 或 `.env.example`
- 一份从企业微信后台创建机器人到联调成功的部署手册

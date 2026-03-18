# 合同管理 AI 员工方案设计 (Vercel AI SDK 架构)

## 1. 核心哲学 (Philosophy)
本项目的核心是打造一个**“胶囊化 (Capsule)”**、**“解耦 (Decoupled)”**且具备**“内驱力 (Proactivity)”**的 AI 员工。

- **解耦**：Agent Core 与通讯渠道 (WxWork) 完全分离。渠道仅负责消息翻译和文件中转。
- **胶囊化**：所有能力自包含在项目目录中，通过本地存储 (SQLite) 和本地文件系统运作，具备可复制性。
- **Skills 驱动**：拒绝硬编码业务工具。通过 Markdown 指令动态扩展 Agent 能力。

---

## 2. 架构组件 (Components)

### A. 大脑中枢 (Agent Core)
基于 **Vercel AI SDK** 构建。负责处理多轮对话循环、工具调度和模型交互。
- **核心函数**：`generateText` 或 `ToolLoopAgent`。
- **配置参考**：
    - 模型接入：使用 `createOpenAICompatible` 接入自定义 OpenAI 兼容模型。
    - **参考文档**：`docs/vercel-ai-sdk/content/providers/02-openai-compatible-providers/index.mdx`
    - 工具定义：使用 `tool()` 函数配合 Zod 进行严格参数校验。
    - **参考文档**：`docs/vercel-ai-sdk/content/docs/03-ai-sdk-core/15-tools-and-tool-calling.mdx`

### B. 原子工具集 (Base Tools)
Agent 拥有的基本“手脚”，不涉及具体业务逻辑：
1. **readFile**: 读取本地文件。
2. **bash**: 执行终端命令（用于文件移动、重命名、运行解析脚本）。
3. **listDir**: 扫描目录发现新文件。
4. **loadSkill**: 核心工具，用于读取 `/skills` 目录下的 Markdown 指令。
- **参考实现**：`docs/vercel-ai-sdk/content/cookbook/00-guides/06-agent-skills.mdx` 中的 Step 4 & 5。

### C. 业务技能库 (Agent Skills)
业务逻辑存放处。每个技能（如 `contract-manager`）包含：
- `SKILL.md`: 结构化的 Markdown 指令，告诉 Agent 如何处理合同（识别、归档规范、路径命名规则）。
- `scripts/`: 该技能依赖的辅助脚本（如 Python OCR 提取器）。
- **设计模式**：采用“渐进式披露 (Progressive Disclosure)”，初始仅将技能名和描述放入 System Prompt，模型按需调用 `loadSkill`。
- **参考文档**：`docs/vercel-ai-sdk/content/cookbook/00-guides/06-agent-skills.mdx`

---

## 3. 关键业务流程 (Business Logic)

### 归档流程 (Archive Flow)
1. **感知**：企微收到文件，下载至临时目录，发送路径给 Agent。
2. **激活**：模型判断任务属于合同归档，调用 `loadSkill('contract-manager')`。
3. **处理**：模型根据指令运行 `bash` 调用 OCR 脚本提取合同元数据。
4. **确认**：通过企微询问用户确认提取信息。
5. **执行**：用户确认后，模型运行 `bash (mv)` 移动文件至指定归档路径。

### 主动性与内驱力 (Proactivity)
引入 **Tick (心跳) 循环**：
- 周期性触发不带用户消息的 `generateText` 调用。
- 注入特殊系统指令：“检查待处理目录，检查数据库到期合同”。
- **参考文档**：`docs/vercel-ai-sdk/content/docs/03-agents/04-loop-control.mdx` (理解 Step 和 Loop 控制)。

---

## 4. 多用户会话管理 (Session Management)
- **存储**：使用本地单文件数据库 **SQLite**。
- **路由**：基于企微 `FromUserName` (userId) 路由消息历史。
- **逻辑**：读取消息数组 -> 调用 `generateText` -> 更新并存回消息数组。
- **参考文档**：`docs/vercel-ai-sdk/content/docs/03-ai-sdk-core/05-generating-text.mdx` (查看 lifecycle callbacks 如 `onStepFinish` 用于保存状态)。

---

## 5. 开发目录规范
- `/channel/wxwork`: 企微 API 对接逻辑。
- `/core`: Agent 大脑逻辑、工具定义、会话管理。
- `/skills`: 业务技能包 (SKILL.md + scripts)。
- `/data`: SQLite 数据库文件。
- `/storage`: 模拟本地/挂载存储根目录。

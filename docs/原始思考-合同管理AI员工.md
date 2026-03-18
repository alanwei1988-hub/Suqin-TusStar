2026-03-17
> 提醒一下我自己：先不要过多纠结技术路线。用户不在乎你用的什么技术，你先想办法把效果攒出来就行。
- 功能
	- 合同归档：大家手机上把合同发给agent（openclaw？），它自动发送给远端，远端Agent归档到NAS。大家可以通过询问，获取想要的合同。
	- 提醒到期：合同到期自动提醒。
	- 看板：网站查看合同，包括（名称，甲方乙方，有效期和签署日期，金额）。
- 我能想到的是把合同管理功能变成一个MCP，让大家的openclaw安装？远端有没有必要接入飞书表格？
- 本地agent软件的需求：
	- 一个可以处理本地文件、支持mcp、skill的本地agent终端，而且最好还能接入飞书这类IM渠道。最好要开源，要支持多家模型。openclaw就是缺失了一个桌面端，能在IM里直接指挥agent固然方便，但是需要严肃地进行工作的时候，它缺乏了多会话切换等基础功能。我不知道现在有哪款软件是符合这个需求的。claude desktop、cowork 这类肯定可以，但我不知道能不能接入其它模型，而且得有anthropic账户？国内大厂、国内外开源社区，也许有一些解决方案？
	- miromind 调研结果：[](https://dr.miromind.ai/share/8c11f77a-0a48-4f07-8d02-9808ddd69d0c)。
	- **winclaw** 怎么样？下载下来尝试了一下。没什么特别的，就是openclaw的桌面端。
	- claude cowork 没订阅不能用。
	- 国内的这种桌面端Agent：阶跃AI 桌面版、昆仑天工 Skywork 桌面版、腾讯 WorkBuddy、阿里 QoderWork、Minimax Agent 桌面版
- 我想到，可能openclaw不是适合企业的最佳形态，因为它是1对1的个人agent。更适合企业的是：一个公司只用在一台电脑上部署一个类似openclaw的东西，员工不需要自己部署agent，只需要通过聊天软件和它交流。也就是把建模从1对1变成1对多。
	- 我听说有一个团队版openclaw，是用的这个思路吗？[](https://mp.weixin.qq.com/s/gMxJQqX8O3Qy88h_TrYiDw)
		- 可能相关的项目：clawith、hiclaw
		- 不过我觉得不一定要借用现成项目，因为大家都还在早期，说不定我按照自己的思路攒出来的更好。
	- 之前我提到过 agent 的胶囊形态，就是把一个封装的很好的 agent 就投放到一台有个人或公司资料的电脑或服务器上，给它配上必要的tool、skill、mcp，可复制、可销毁，支持通过IM指挥它，这样可能最方便。当前，人们想要在个人或公司环境里new一个agent，部署是个大问题。
		- 那么针对合同管理的这个case，就是公司新弄一台专门的电脑，连上公司的内网wifi，这个agent就部署在这台电脑上，拥有和真人一样的操作权限（不方便agent操作的，比如浏览器操作，可以做一些agent-friendly适配），并通过IM和其它员工通信。
		- 说到底，就是越向真人的工作形态靠拢，就越容易融入人类的组织和工作中。

小红书分享下我的看法：[小红书帖子](小红书帖子.md)
AI 建议：[AI建议：如何打造一个企微AI员工](AI建议：如何打造一个企微AI员工.md)

看一下企微自建应用（应该可以满足和企业成员的交互），以及市场上有没有已经成熟的对接好agent的企微自建应用。

Agent DIY
[AI建议：如何打造一个企微AI员工](AI建议：如何打造一个企微AI员工.md) 里面讨论了从对接IM渠道、调用agent引擎到部署到独立电脑上的全流程。
这是一个DIY的过程，重点是从一堆原料（Agent引擎、调度器、企微API、外挂工具）组装出“超级跑车”，没有一样东西是自己造的，重点是组装起来。openclaw做的也是组装的事情，现在，我需要自己体验一遍。
本质上，我是想要体验真正把LLM转化成生产力的魔法，体会AI究竟能在多大程度上渗透进我们的工作生活。
其中最重要的无疑是微型 agent 引擎  [知乎](https://www.zhihu.com/question/12886054016/answer/2010771219314664108)：
- [ ] 看下这些agent引擎：
- PydanticAI
- Smolagents (HuggingFace 出品)
- OpenAI Swarm
- Claude Agent SDK
- Vercel AI SDK
- Google ADK
- AWS Strands Agents
- pi-mono(Pi)：OpenClaw 底层框架 [](https://yunpan.plus/t/13179-1-1) [](https://lucumr.pocoo.org/2026/1/31/pi/)
- LangChain、LangGraph

---
2026-03-18
今天的计划：
- 打通企微机器人的通信。
- 部署一个本地agent（可以先用 goose 这种来代替，不用直接上DIY轻量引擎）。
发送消息、机器人收到并处理任务-返回结果，这个打通。
然后再考虑让agent去操作nas。

pi-mono：[](https://yunpan.plus/t/13179-1-1)
- 极简：只有read write edit bash（足以闭环）。
- 可扩展（extension可以把状态写入会话）。
- 工程质量高，稳定。
- 无MCP支持：不是去下载一个现成的，而是让它自己写一个。

- [ ] 了解一下同类团队版openclaw是怎么做的：clawith、hiclaw

研究打通：[企微机器人](../企微机器人.md)

gemini-cli，shell中文乱码解决方案：
[Gemini cli 部分乱码，有佬知道怎么回事吗？ - #5，来自 bin8494 - 开发调优 - LINUX DO](https://linux.do/t/topic/1508954/5)

右键文件夹空白处，菜单里没有vscode。修改注册表HKEY_CLASSES_ROOT\Directory\Background\shell，里面添加 VSCode。

已经搞定了企微机器人，现在我要开始研究在电脑上放什么 agent，怎么部署。对于这个我还真是一头迷雾，没有经验。我要的是那种可以被集成到系统里的 agent，比如 Goose CLI，但我也没试过，不知道它的能力、性能怎么样。昨天还找了一些其它的 agent 引擎（见上）。
这个时候就要搬出来我对“胶囊” agent的期待：一个封装完好，可以快速创建、复制、销毁的 agent。目前可能支持 CLI 调用的 agent 符合这个条件（new一个process来运行agent命令）？我还不太清楚能不能满足我的需求。
我对这个 agent 的要求是：
- 内置会话管理。但是目前的agent大多数是针对单一用户，我的这个是要管理多人会话的（1个agent回复企业多人的请求），所以要允许修改引入这种机制。
- 内置工具、MCP、skill等机制，开箱即用，不用我做太多定制。
另外，我理解应该有：
- 一个主线程，是用来接待企微成员发来的消息的，负责针对每一条消息拉取一个agent来进行回复和响应（单一用户多条消息入队列，依次答复）。
- 多个人可能都在向这个agent发号施令，它不应该都直接按照员工的指令直接去做（那种是私人agent，处理的都是自己的东西不打紧），否则可能引起冲突。也许应该是前台主线程唤起的agent就负责接客和向后台提交任务，然后后面有一个线程（工作员工agent）是用来把守电脑，比如大家都在想存合同，那么都提到它这里，它来负责处理。这么设计好吗？复杂了吗？
- 然后，可能后台要跑一些常驻的工作线程，用来检查和整理工作空间、主动给用户发通知，可能有的功能要用到这个。
关键是，agent会产生和多个用户的对话，对会话要做用户隔离的记录。
可以从拟人的角度思考，一个agent应该怎么设计，它应该有哪些行为特征。我不希望就是把它当成一个被调用的原子函数。
我要的不是设计思想，要的是清晰地弄明白程序流转。

- LangGraph 循环是状态驱动的，每一步都基于State在节点间跳转。
- Claude Code 循环是上下文驱动的，每轮依赖LLM通过上下文自主判断下一步。
我要的是后者这种 Agent。

- [ ] 看到了一个Agent框架，ElizaOS，号称可以用来打造 autonomous AI，以去中心化为标签（发了个币），给的例子里有 web3&DeFi，可以用来交易，去年火起来，可以了解下。
	- [Overview - ElizaOS Documentation](https://docs.elizaos.ai/)
	- [GitHub - elizaOS/eliza: Autonomous agents for everyone · GitHub](https://github.com/elizaOS/eliza?tab=readme-ov-file)

不用局限在合同管理和合同工具，事实上我不会去单独写一个合同相关的tool。其实是，用户和我的企微机器人聊天，然后让它去干活，它掌握一台单独的电脑，能做的就是文件操作、bash、代码操作等。

和 google ai studio 的交流：[](https://aistudio.google.com/prompts/1_KjEDTQ1aEOZdeEdZRGOyqjNBiIISRUl)。
它给我推荐了 Vercel AI SDK，你调用 generateText，它就可以多步执行然后返回结果。这个函数是无状态的，给它的上下文由你自己管理和组装，它帮你做的是：
- **【核心】封装了多轮调用循环**。对用户的一个请求，进行多轮工具调用、模型请求，直到完成。
- 工具参数JSON格式校验等。
- 多家供应商的模型切换。
- 多步执行过程可以通过onStepFinish钩子监听。
- 多模态（图片、文件）处理适配。

题外话：
我有点讨厌现在这种 Agent SDK。这类所谓的 Agent，本质上只不过是封装了 LLM 的 function，只能对你的消息做出响应。它完全缺乏对一个 “个体” 的建模。
一个真正的 “个体” 应该拥有自己的 state（类似人的生命特征、记忆等），身处环境之中，能够响应各种事件，而来自通讯软件的消息，只是其中一种事件而已。
更重要的是，它需要具备**内驱力**。环境中的各种刺激与反馈，除了内容本身，都还应该附带奖励信号；而内驱力，就是指它在**没有任何环境刺激**的时候，也会**主动去找事情做、去获取奖励**。
当前的环境事件对 Agent 来说，就只是 token 而已。它们也许会在 LLM 内部激活某些类似奖励的神经回路，让它更倾向于输出更 “正确” 的回答，但这种奖励信号**并不会影响下一次的行为**，因为 LLM 的参数并没有改变。
所以必须想办法维护一个奖励信号，并让 Agent 在没有任何事件刺激时，能够运行**反思循环**，主动采取能获取奖励的行动。
> 我把这段感想发给 google ai studio 之后，它再次向我推荐了elizaOS。

From trigger-based（触发式） to Tick-based Event Loop（心跳/帧循环式）
- 时间每流逝1s，Agent 的内部状态会自动更新。
- 环境的变化都会作为事件流入它的事件队列（人类发送的消息、天气的变化、系统中某个指标的波动）。
- Agent 在每一个 Tick 有权决定是行动还是等待。

一步步来吧，先做被动响应式的远程agent（单用户，然后拓展到多用户），熟悉下 vercel ai sdk 这类东西，实现合同管理的功能。然后再考虑包装和建模一个真正的”员工“个体。

问题：
- vercel ai sdk 和 goose 这种 agent 的区别是？
	- 前者是agent core（上下文和工具要自己注入），后者是封装完整的agent。
- vercel 支不支持 tool、skills、mcp 等这些东西？我需要能扩展它的能力。
	- 不提供任何tool，但是可以通过mcp（mcp to tool）：
		- @modelcontextprotocol/server-filesystem：文件读写
		- @modelcontextprotocol/server-bash：bash。
	- skill 必须自己去加载、披露，表现为tools里增加一个loadSkillTool，system prompt里增加一个${skillsMenu}。参考：[vercel-ai-sdk接入skills](snippets/vercel-ai-sdk接入skills.md)。

看起来vercel-ai-sdk不错，它的核心就是封装了多轮调用循环，原始LLM是一问一答，而它是用户问一句后，它做多步再回复。**这么看来，什么是 agent-core？对用户问题进行多轮调用再回复的能力，就是 agent-core。**
把这个接入企微，snippet参考 [演示企微对接vercel-ai agent](snippets/演示企微对接vercel-ai%20agent.md)。

现在我希望gemini cli上面的接入思路，然后认真地按照vercel-ai-sdk（我也不熟悉）文档的使用方法，来把vercel agent接入。
怎么让gemini cli可以接入文档作为参考？
- 要么下载下来 @docs/
- 要么 @url。

vercel ai sdk：
- 文档：[AI SDK by Vercel](https://ai-sdk.dev/docs)
- 仓库：[GitHub - vercel/ai](https://github.com/vercel/ai)

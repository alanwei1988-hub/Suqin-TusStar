# Targeted Scholar Interview Question Guide

Use this guide to generate a tailored interview question list for a technical manager speaking with a scholar about research commercialization.

The source reference is a general project-interview framework. Do not copy its title or background by default. Preserve the useful flow, then personalize the questions with the skill's analysis outputs.

Default posture: write for a technical manager who is responsible for commercialization analysis and project design, but may not be deep in the scholar's technical field. The interview should help them decide what to do next, not prove technical mastery.

## Inputs

Use these artifacts before drafting questions:

- `Paper Browser`: numbered papers, plain-language explanations, application scenarios, commercial relevance.
- `Directions`: research clusters, representative papers, core capability, limits.
- `Timeline`: key nodes and recent pivots.
- `Deep Dives`: user hypotheses, evidence judgments, rewritten product framing.
- `Commercialization`: target customers, product forms, build-vs-buy risk, readiness.
- `Benchmarks`: domestic and international commercial-company peers, adjacent platform products, open-source substitutes, or explicit white spaces.

## Output principles

- Write for an entry-level technical manager preparing a 45-60 minute scholar interview.
- Make the question spine commercial and operational, not technical. Use the analysis to ask about customer pain, demand evidence, resource gaps, maturity, company design, operating role, governance, and next-step consulting actions.
- Make questions natural, respectful, and conversational; avoid sounding like an audit checklist.
- Prefer plain Chinese unless the user asks for another language.
- Use technical terms only when they come from the scholar's papers; pair them with plain-language framing and move technical details into follow-up prompts when possible.
- Each major section should include why the question matters and what answer signals to listen for.
- Do not overclaim product readiness. Ask questions that reveal maturity, ownership, customer pull, and missing proof.
- Mark each question as `Must ask`, `If time`, or `Optional`.
- Avoid question wording that assumes the manager already understands a named algorithm, benchmark, architecture, or paper. Prefer "这类成果解决的客户问题是什么" over "某某算法离工程产品还有哪些接口缺口".

## Business-manager-first framing

When converting technical analysis into interview questions:

- Lead with the business diagnosis: who has the pain, why now, who pays, what proof exists, what is missing?
- Ask technology questions only to judge maturity, defensibility, cost, deployment burden, or resource needs.
- Translate paper clusters into buyer-readable phrases such as "企业数据问答的可靠性", "向量检索性能优化", "智算中心算力利用率优化", or "隐私合规审计".
- Keep paper numbers, system names, and technical keywords in `Analysis Basis` or `Follow-up Prompt`, unless the scholar is already using that term in conversation.
- Use the interview to learn whether the scholar has a commercialization plan, not to interrogate whether the manager understands the technology.

Prefer these main modules in generated deliverables:

- 商业机会与研究主线
- 目标客户、场景与付费意愿
- 需求证据与资源缺口
- 技术成熟度与工程化距离
- IP、权属与转化路径
- 产品形态、公司设计与商业模式
- 团队角色、经营投入与外部合伙人
- 资金、政策、试点与渠道资源
- 运营治理、合规与学校协同
- 风险、阻碍与下一步咨询动作
- 收尾确认

Use technical modules only when the user explicitly asks for a technical diligence interview.

## Recommended sections

### 1. Warm-up and research overview

Goal: let the scholar explain the work in their own words and reveal whether they frame it as technology-first or customer/problem-first.

Question patterns:

- "如果用三五句话向非本领域的人介绍，您最希望别人理解这项研究解决了什么问题？"
- "在我们梳理的几个方向中，您认为最有可能走向产业应用的是哪一个？为什么？"
- "这些成果之间是一个连续路线，还是几个相对独立的项目？"

### 2. Demand, customer, and resource diagnosis

Goal: understand whether there is a real buyer, budget, pilot resource, and urgent pain before going deep into technical details.

Question patterns:

- "如果只能先验证一个最可能落地的场景，您会优先选择哪类客户、哪类问题？他们为什么现在必须解决？"
- "这些方向里，哪些已经有企业、政府部门、医院、金融机构、AI 平台或产业方主动表达过需求？他们具体关心成本、效率、合规、收入，还是风险？"
- "客户愿意为哪种交付付费：完整产品、核心组件、评测报告、数据/规则库、试点项目，还是专家咨询服务？"
- "如果我们要在 3-6 个月内做一个商业验证，最缺的是客户试点、真实数据、工程团队、算力、行业渠道、政策资源，还是资金？"

### 3. Technology maturity and engineering distance

Goal: understand whether the result is a paper prototype, reusable component, deployed system, or product-ready capability.

Question patterns:

- "这项成果目前更接近论文验证、可复现实验系统、工程原型，还是已经在真实场景试过？"
- "从现在的成果到稳定交付给客户，中间最大的工程化缺口是什么？"
- "如果外部团队想复现或绕过这项能力，主要难点在哪里：算法、数据、系统工程、场景经验，还是团队 know-how？"
- "代表论文里的评测条件和真实客户环境之间，您觉得差距最大的是哪一块？"

### 4. IP, ownership, and transfer path

Goal: surface potential blockers in university ownership, patents, software copyright, open-source code, data rights, and future company IP entry.

Question patterns:

- "这些成果目前是否已有专利、软著、开源代码或校内成果登记？哪些是已经明确归属的？"
- "如果未来成立公司或授权给企业，您倾向于转让、许可、作价入股，还是以服务/联合开发方式推进？"
- "是否已经和学校技术转移部门沟通过权属、赋权或转化流程？"

### 5. Market and application scenario

Goal: test whether the technology connects to a concrete buyer, budget, scenario, and urgent pain.

Question patterns:

- "如果只能选一个最可能先落地的应用场景，您会选哪里？对应的第一批付费客户可能是谁？"
- "我们从论文中看到的应用可能包括【填入分析得到的场景】。您觉得哪一个最接近真实需求？哪一个只是远期可能？"
- "目前有没有企业、政府部门、医院、金融机构、AI 平台、交易所或其他产业方表达过明确需求？他们的反馈是什么？"
- "客户愿意付费买的是完整平台、核心组件、评测报告、数据/规则库，还是专家服务？"

### 6. Commercialization mode, company design, and productization

Goal: distinguish product, component, assessment service, data asset, consulting, custom project, and the kind of company or operating model that could carry the work.

Question patterns:

- "如果把这项研究变成业务，您觉得第一版产品最小可交付形态是什么？"
- "哪些部分客户大概率会自建？哪些部分他们更可能采购外部专业能力或第三方评测？"
- "和我们整理的国内外对标公司相比，您的成果最可能形成差异化的地方在哪里？"
- "这项技术是更适合做标准化产品，还是更适合以项目制/咨询制切入？"

Additional business-manager questions to include when relevant:

- "和我们整理的国内外商业化公司对标或空白相比，您的成果最可能形成差异化的地方在哪里？"
- "如果围绕这些成果设计一家公司，第一阶段更像产品公司、技术授权公司、行业解决方案公司，还是咨询/评测服务公司？为什么？"
- "公司早期最关键的治理问题是什么：学校授权、教师兼职/持股、学生参与、客户数据合规、收入分配，还是研发优先级？"

### 7. Team, roles, and operating commitment

Goal: clarify who will drive commercialization and what roles are missing.

Question patterns:

- "如果要推进转化，您更倾向于自己牵头创业、技术许可、和成熟企业合作，还是交给学生/外部团队来做？"
- "如果成立公司，CEO 或商业负责人是否已有候选人？您本人更适合担任科学家、技术负责人、顾问，还是经营者？"
- "团队目前最缺的是工程化、销售、行业 BD、产品经理、合规资源，还是资金？"

### 8. Funding, policy, and resources

Goal: understand financial gap, non-dilutive funding, government/park resources, pilot resources, and time horizon.

Question patterns:

- "这个阶段如果推进到可验证的商业样机或试点，大概需要多少资金和多长时间？主要花在哪些事情上？"
- "是否接触过投资机构、产业基金、政府引导基金、园区政策或企业联合研发资源？"
- "哪一种资源对现在最有帮助：客户试点、工程团队、融资辅导、政策申报、算力/数据、合规咨询，还是产业渠道？"

### 9. Operating governance, risks, blockers, and help needed

Goal: identify the highest-risk blocker, operating/governance constraints, and turn the interview into an actionable follow-up plan.

Question patterns:

- "您觉得这个方向从论文到商业化，当前最不确定的一件事是什么？"
- "最大的阻碍更像是技术成熟度、真实需求、客户信任、学校审批、团队投入，还是商业模式？"
- "如果我们后续只能优先帮一件事，您最希望是什么？"

Additional governance and next-step questions to include when relevant:

- "如果后续进入试点或公司化阶段，哪些事项需要提前设定规则：数据边界、学校审批、学生权益、客户交付责任、保密、成果署名，还是利润分配？"
- "您希望外部技术经理人/顾问团队下一步帮您形成什么：一页纸商业判断、试点客户清单、公司设立方案、融资材料、IP 路径，还是产品路线图？"

### 10. Closeout

Goal: confirm understanding and set up the next deliverable.

Question patterns:

- "我复述一下我的理解：这项成果的核心能力是【填入】，最可能的早期场景是【填入】，当前最大缺口是【填入】。这样理解准确吗？"
- "还有哪些成果或限制，是我们从论文和公开资料里看不到、但做商业化判断时必须知道的？"
- "我们后续会把访谈内容整理成一页纸建议或更新版商业化分析，有没有哪些内容需要保密或避免写入对外材料？"

## Recommended table fields

Use these fields in Excel or Word:

- Section
- Priority
- Question
- Follow-up Prompt
- Why Ask This
- Analysis Basis
- Expected Signal
- Related Paper # or Direction
- Notes During Interview

For non-specialist technical-manager deliverables, prefer these labels when space allows:

- Module
- Priority
- Main Question
- Plain-language Follow-up
- Commercialization Purpose
- Evidence From Analysis
- Expected Signal / Decision Use
- Related Direction or Paper #
- Notes During Interview

## Tailoring rules

- For each top research direction, include at least one question that references the direction's core capability and likely application.
- For each high-commercial-relevance paper, include at least one business scenario, maturity, resource, or productization question; do not make named technical artifacts the headline unless necessary.
- For each user-selected deep dive, include one question testing whether the commercial hypothesis matches the scholar's own intent.
- For each recommended business opportunity, include one build-vs-buy or first-customer question.
- For each major uncertainty, include one risk or missing-evidence question.
- Convert technical claims into plain-language business checks. Example: instead of "HARP/HAPT 的调度器接口还缺什么", ask "如果要服务智算中心或私有化大模型团队，这类异构算力优化成果离真实交付还差哪些资源和验证？"

## Quality check

Before finalizing, verify:

- The list can fit a 45-60 minute interview.
- The first questions are easy and non-confrontational.
- Sensitive questions about IP, role commitment, valuation, and equity are phrased gently.
- Every section has a practical purpose.
- At least half of the questions are visibly customized to the scholar's actual research, not generic technology-transfer questions.
- A non-specialist technical manager can ask the main questions without first understanding the paper's algorithms.

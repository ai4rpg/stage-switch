# Agent Note: 阶段切换协作状态

Status: implemented

> 本设计决策记录是在 DeepSeek Harness 工作区中开发该插件时撰写的，保留于此以说明出处。它不存在于官方 deepseek-harness 仓库中。

[English](DESIGN.md) | 中文

## 问题

长周期工作需要显式的阶段边界：规划阶段、实现阶段、验证阶段。没有机制时，模型会在一次对话中在任务之间漂移，用户没有结构化的决策点，已结束阶段累积的历史会在其余工作中持续消耗上下文 token。

[计划模式](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/plan/plan-mode/README.md) 用一个持久的 `plan/mode` 状态、一个经评审的退出工具和步骤边界应用解决了一次转变（规划 → 执行）。通用的阶段切换需要同样的骨架——记录到日志的状态、稳定的切换工具、用户评审、边界应用——外加计划模式刻意没有的两样东西：*解耦的触发条件*（谁判定当前阶段已完成）和*上下文重置*（已结束阶段的历史不应再消耗 token）。

## 决策

### 本包：`@ai4rpg/dsh-stage-switch`

本包独立开发与发布，构建与发布均针对 npm 上的 `@deepseek-ai/dsh-*` 包：与 plan mode 一样，是通过 session、prompt、tool 与 interaction seam 贡献的、记录到日志的按 agent 协作状态。持久事实是每次进入都会追加的阶段提示消息——`Current stage: <name>` 或交接提示 `Stage switched to <name>` 两种 `user/message`，其 `source.summary` 由 `foldStage(events)` 折叠，空日志值取配置的 `initial` 阶段。`ctx.stage.current(session)` 读取当前状态。

### 解耦的判定器 seam

`registerEligibility(predicate)` 注册同步的 `(agent) => boolean` 判定器；只要任一判定器返回 true，`stage:policy` 切换引导上下文就贡献，没有任何注册时永不贡献。同步是契约：运行时上下文快照同步组装。需要异步信号的部署方在自己的代码中预计算一个同步标志。

### 阶段提示是对话消息，绝不是提示词 section

当前阶段永不在系统提示词中：新会话在第一个被接受的 step 收到初始阶段提示，每次切换把新阶段的提示（`Current stage: <name>` 加上该阶段的 `instruction`）作为对话消息追加——仅对最后一个请求头描述另一阶段的用户驱动切换加前置的用户切换通知。子代会话跳过初始阶段提示：父会话已经派发了任务，注入配置的初始阶段（通常是 `route`，其指令让模型调用 `goto_stage`）会让子代死锁——`goto_stage` 的评审在子代上下文里没有用户可应答。因此切换不改变任何请求前缀，永不使 provider 的缓存前缀失效；阶段提示是普通的只追加对话增长。这与 plan mode 形成对比：其 `plan:policy` 是提示词 section，因为 plan 的布尔状态翻转很罕见，而阶段切换按设计会反复发生，所以反复发生的变化属于对话尾部。`stage:policy` 引导是运行时上下文贡献而非提示词 section；其模板可引用 `{{stage_current}}`/`{{stage_targets}}`，因为运行时上下文投影仅在其渲染文本变化时追加快照。

### `goto_stage` 工具与经评审的切换

`goto_stage` 在每个阶段都保持注册，保证跨切换的请求工具目录稳定。其执行路径校验调用 agent、已配置的目标阶段与交接内容（需要时），在评审前通过 `ctx.fs` 写入交接文档，并通过 user-questions seam 以通用问题提交切换——问题携带 `stage-review` 问题 id、不带呈现意图：harness 的 `stage-review` 意图尚未进入已发布的 `dsh-user-questions` 版本，评审按通用流程渲染；待其发布后再为专用 UI 附加该意图。只有恰好一个不带自定义文本的 `Approve` 选择才算同意；任何其他回答都是携带反馈的失败调用，被放弃的评审点名用户接手。批准记录一个静默的 pending 切换，在下一个被接受的 in-turn pre-step 应用，因此当前工具批次保持其阶段上下文，切换由工具结果叙述。

### 按 token 阈值区分完整与轻量切换

`minHandoffTokens`（可选）通过 `ctx.tokenMeter` 表面测量选择切换形态。达到或超过阈值时，切换是**完整**的：交接必填、写入文档、归档历史。低于阈值时，切换是**轻量**的：交接可选、不写文件、不归档——切换只改变阶段，其追加的阶段提示告诉模型下一阶段要做什么。配置了阈值时组合中需要 token-meter 服务，缺失时 `goto_stage` 调用大声失败。

模型从不自行判断形态：它无法测量 token，若 schema 写"完整切换必填"，它就会在每次调用时都起草交接——轻量切换上纯属浪费。因此工具 schema 只携带交接指导的索引（`handoff` 可选，且说明"除非工具要求否则省略"），由插件在调用时实测决定。完整切换缺 `handoff` 会被拒绝，拒绝信息给出要遵循的交接模板——这是渐进式披露点，模板借鉴压缩引擎的 checkpoint 结构（固定小节、简洁 bullet、空节写 "(none)"、保留精确路径/命令/标识符、用户纠正），但面向目标阶段前瞻，并带一条规则：交接只包含目标阶段所需，不复述整个对话、不复制已落盘内容（精确路径已由保真规则保证，因此引用既有文档就是给出其路径）——模型随后带文档重试；于是交接总是在看到模板之后才写，而轻量切换永不索取，模型多写的 handoff 会被静默忽略。拒绝发生在评审之前，失败调用无用户可见副作用。

### 边界冲刷归档模型可见表面

下一个被接受的 in-turn pre-step 会追加新阶段的提示消息（其 notice summary 即已提交的阶段记录）；完整形态下，它先用 `surfaceOp: { op: 'replace', start, end }` 把整个模型可见 surface 替换为一条携带交接指针与新阶段提示的消息——与 compaction checkpoint 使用相同的 surface 替换。append-only 日志为人类转录保留已归档历史；只有派生的模型历史被遮蔽，本次 step 自身的用户消息落在提示之后。替换先于记录消息的 append，因此替换失败时已记录的阶段与 pending 切换都保持不变——观察不到半应用的切换。

### 持久化的 full-transition 标记（`output.presentationMeta`）

工具的规范 `value` 刻意不从 `tool/result` 事件中持久化（事件只携带渲染后的 `content` 与工具私有 `meta`），因此下游相位机无法仅凭事件区分完整与轻量切换。`goto_stage` 的 output 因此把一个 `presentationMeta` 投影到持久化的 `tool/result` 事件上：被批准的**完整**切换（value 携带 `handoffPath`）戳记 `meta: { fullTransition: true }`，**轻量**切换（无 `handoffPath`）戳记为无损 JSON 的空操作 `meta: null`，而被拒绝/取消的评审走 isError 分支、永远不到达成功路径，不带任何 `meta`。相位机以 `meta?.fullTransition === true` 为键（`null` 或缺失字段都不满足），这样不需耦合渲染文案或单独的事件，就能把下一个请求降为极简目录一轮——即携带 notice 的请求。`null` 是无损 JSON 空操作，因为 `presentationMeta` 在每个成功的顶层调用上都运行且必须返回无损 JSON（`undefined` 不是无损）；消费方永远不读轻量标记。

### `/stage` 命令对标 plan mode 的直接入口

组合了 `ctx.commands` 时，本包注册 `/stage [stage|message]`。裸 `/stage` 读取当前阶段与阶段列表，不触碰状态。`/stage <name>` 是直接的用户切换：校验目标后，在空闲会话上立即应用，或在轮次中排队到下一个被接受的 in-turn pre-step（同一个 `pendingTransitions` 边界）；仅当最后一个请求头描述的是另一阶段时才叙述切换。阶段名之后的后缀会作为普通用户消息送入切换后阶段的上下文，对标 `/plan <message>`。手动切换按定义就是轻量切换——用户拥有这次变更，因此不写交接文档、不归档历史——这正是命令完全跳过评审、而不是委托给 `goto_stage` 的原因。

### 提示词文案单一 JSON 事实源，承载格式留在代码

本包自带的用户可见文案--`goto_stage` 工具描述与参数提示、评审对话框(问题、标签、选项描述)、工具结果与呈现卡片文案、边界/交接 notice、`/stage` 命令文案、失败信息--都集中在 `src/prompts.json`,即唯一可编辑事实源。`src/prompts.ts` 在模块加载时读取它,并叠加在嵌入兜底(`src/prompts.defaults.ts`,由 JSON 重新生成)之上,因此没有 JSON 的过期安装会回退到与包历代完全一致的文案。`{name}` 占位符由 `formatPrompt` 插值。承载格式刻意留在代码,因为 fold 与提示注入路径要解析它们:阶段提示正文前缀(`Current stage: <name>`)、`source.summary` 的 notice 形态(`Current stage: <name>` / `Stage switched to <name>`)、`stage-review` 问题 id。文案直接在 `src/prompts.json` 里改；`prebuild`/`pretest` 钩子会跑 `scripts/sync-prompts.mjs` 重生成嵌入兜底；手工只改其一而不重新生成，会被"加载的 JSON 叠加必须等于嵌入兜底"的包测试抓住。行为测试从不内嵌文案：期望一律从生效提示词（`stageSwitchPrompts` + `formatPrompt`）推导，因此改文案只改 prompts——测试继续钉住接线，即配置的文案确实到达工具 schema、评审对话框、notice 与命令输出。

额外的中文评审弹窗覆盖层通过 `src/prompts.zh.json` 提供（仅 `review.*` 8 条键值）。这是 sync-prompts 脚本不处理的第二事实源：`scripts/apply-zh.mjs` 在安装后将中文文案深度合并到已装 `src/prompts.json` 中（重装/升级后需重跑），其他所有键保持英文。`src/prompts.zh.json` 在运行时是无源的——没有任何代码读取它——直到合并写入加载器读取的 JSON 文件。这使源树保持英文（上述钉住测试仍然成立），并将语言切换限制在已装副本上，后者在 `file:`、npm 和 GitHub release 安装时均有效。

### 与 plan mode 共享的边界语义

用户的 `/stage` 选择在空闲会话上立即提交，在轮次中冲刷到下一个被接受的 in-turn pre-step，对标 plan mode 的 `set()`；经评审的 `goto_stage` 切换总是源于 turn 内部并以相同方式冲刷。在 turn 的最后一次被接受的 pre-step 之后选择的变更（切换）是进程局部的，若进程在另一次被接受的 in-turn pre-step 之前退出则会丢失——plan mode 记录了同样的限制。

## 备选方案

**通用命名模式注册表。** 与简化 plan mode 时相同的理由拒绝：每个包只有一个已交付的协作状态，第二个消费者应该从两个具体案例建立共享 seam，而不是从臆测出发。

**按阶段过滤工具或在循环中强制阶段边界。** 拒绝：阶段提示词是引导。沙箱模式与审批策略独立强制限制，且都不读写阶段状态。

**为下一阶段 fork 一个新 session。** 拒绝：agent 在创建时绑定其 session，对话中途切换需要核心循环改动；surface 替换已经在不改变身份的情况下把已结束历史移出模型视野。

**只把交接存为 session 事件。** 拒绝：交接必须作为用户与模型都能打开的可读工件存续；通过 `ctx.fs` 写入的工作区文件就是那个工件。

**通过审批 seam 或散文评审。** 与 plan mode 相同的理由拒绝：切换不是权限决策，需要精确的交接工件与修正性自由文本，并且必须有一个记录到日志的工具调用作为其结构化转换。

## 验证

- 单元测试（手搭的 `ctx.plugin(...)` 套件）覆盖配置校验、阶段折叠（notice summary 及其优先级）、提示词文案单一事实源钉住、策略上下文渲染与变量、判定器注册与移除、`goto_stage` schema 与校验链、持久化 full-transition 标记、评审回答规则与失败模式、呈现、token 阈值决策、交接路径按会话隔离与 sandbox policy 戳记、归档形态，以及 fiber 移除时 `stage:policy` 的清理。
- 真实 Loader 组合套件通过 `@deepseek-ai/cordis-plugin-loader` 启动测试专用的 `cordis.yml`——只 mock 文件系统后端与评审回答——钉住产品可见接线：三注册表贡献（service、tool、command）、仅一次的初始阶段提示注入、从交接写入经评审与边界冲刷到持久化 `Stage switched to <stage>` notice 的完整 `goto_stage` 切换、`/stage` 空闲提交，以及干净卸载。
- 评审弧与 surface 替换用真实 `Session` 与内存文件系统后端做包级测试；组装应用转录与专用 `stage-review` Web 渲染器属于延后工作。

## 后果

阶段切换保持软性引导与人工评审的转换：模型提议、用户同意、已结束历史在下一边界停止消耗 token。判定是部署方拥有的 seam，而非内置策略。实现复用了 plan mode 的边界机制但不共享其状态；两个包仍是独立插件。

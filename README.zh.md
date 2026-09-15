# @ai4rpg/dsh-stage-switch

`@ai4rpg/dsh-stage-switch` 的独立仓库，一个为 DeepSeek Harness agent harness（[deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)）开发的阶段协作插件。设计决策记录见 [docs/DESIGN.zh.md](docs/DESIGN.zh.md)。

[English](README.md) | 中文

按 agent（智能体）分别记录到日志的阶段协作状态：部署方配置的阶段提示词、一个把关切换引导的判定器 seam、写入工作区的交接文档，以及经用户评审的 `goto_stage` 切换——批准后将模型可见历史归档。

## 持久状态

阶段记录搭载在每次阶段进入都会追加的 stage-switch 插件消息上——阶段提示（`Current stage: <name>`）或交接提示（`Stage switched to <name>`），都是官方 harness 事件目录已知的普通 `user/message`。`foldStage(events)` 返回最后一条记录的阶段，无记录时为 `undefined`；服务在第一条记录之前折叠到配置的 `initial` 阶段（默认第一个阶段），因此 resume、fork 与 compaction 直接从会话日志恢复阶段。UI 通过 `session/event` 观察已提交的切换。
`ctx.stage.current(session)` 读取当前阶段。已评审的切换保持 pending，在下一个被接受的 in-turn pre-step 应用，因此当前工具批次保持其阶段上下文，切换由工具结果自身叙述。

## 判定器 seam

`ctx.stage.registerEligibility(predicate)` 注册一个同步的 `(agent) => boolean` 判定器；只要任一已注册判定器对组装中的 agent 返回 true，切换引导上下文就贡献，没有任何注册时永不贡献。判定器必须同步，因为运行时上下文快照同步组装；需要异步信号的部署方应预先计算一个同步标志。注册返回 effect disposer。

## 阶段提示与运行时上下文

当前阶段**绝不是系统提示词 section**：新会话在首个请求收到初始阶段提示，每次切换把新阶段的提示作为对话消息追加——`Current stage: <name>` 加上该阶段的 `instruction`——因此切换阶段不改变任何请求前缀，永不使 provider 的缓存前缀失效。**子代会话跳过初始阶段提示**：父会话已经派发了任务，注入配置的初始阶段（通常是 `route`，其指令让模型调用 `goto_stage`）会让子代死锁——`goto_stage` 的评审在子代上下文里没有用户可应答。子代仍通过正常投影继承 `{{stage_current}}`/`{{stage_targets}}` 和 `stage:policy`（没有判定器时这些投影为空）。`stage:policy`（order 116）是运行时上下文贡献，而非提示词 section：仅在判定器为 true 时渲染配置的 `section` 模板，运行时上下文投影仅在其渲染文本变化时追加快照。模板可引用 `{{stage_current}}` 与 `{{stage_targets}}` 变量；改变它们的阶段切换追加一条快照，仍不破坏缓存前缀。

## `goto_stage` 工具

`goto_stage` 在每个阶段都保持注册，因此切换绝不改变请求工具目录。其执行路径要求调用 agent、一个已配置且不同于当前阶段的目标阶段，以及可用的评审 seam；任何失败都留在当前阶段。

未配置 `minHandoffTokens`、或表面 token 测量值达到阈值时，切换是**完整**的：要求非空的 `handoff` markdown 文档，通过 `ctx.fs` 写入会话 cwd 下的 `<handoffDir>/<会话 id>/<stage>.md`（默认 `handoff/`，按会话分子目录）——按会话分目录让共享同一工作区的会话互不覆盖彼此的交接文档，写入携带会话级 sandbox policy（其工作区根即会话 cwd），受限后端按会话工作区栅栏、与工具层一致，绝不落到部署级进程 cwd 兜底——并以文档作为 `detail` 提交评审。只有恰好一个不带自定义文本的 `Approve` 选择才算同意；任何其他回答都是携带用户反馈的失败调用，被放弃的评审（`ASK_CANCELLED`）会告诉模型留在当前阶段等待。

模型从不自行判断切换是否完整：工具 schema 只携带交接指导的索引（`handoff` 参数说明"除非工具要求否则省略"），因此小对话不花任何交接 token。插件在调用时实测——完整切换缺 `handoff` 会被拒绝，拒绝信息里给出要遵循的交接模板，模型带文档重试；轻量切换则永不索取。轻量切换上模型多写的 handoff 会被忽略、不落盘。

低于阈值时切换是**轻量**的：`handoff` 可选、不写任何文件，评审是不带意图或 detail 的通用确认。无论哪种形态，批准都会记录一个静默的 pending 切换，在下一个被接受的 in-turn pre-step 应用。

## `/stage` 命令

组合了 `ctx.commands` 时，本包注册 `/stage [stage|message]`。裸 `/stage` 显示当前阶段与已配置的阶段列表，不触碰状态。`/stage <name>` 是直接的用户切换：校验目标后，在空闲会话上立即应用，或在轮次中排队到下一个被接受的 in-turn pre-step，并追加新阶段的提示（仅当最后一个请求头描述的是另一阶段时才带用户切换通知前缀）。阶段名之后的任何文本都会作为普通用户消息通过 `agent.steer()` 送入切换后阶段的上下文，对标 `/plan <message>`。手动切换是**轻量**切换：永不写交接文档、永不归档历史——用户拥有这次变更，追加的阶段提示会告诉模型新阶段的用途。

## 边界冲刷

下一个被接受的 in-turn pre-step 会追加目标阶段的提示消息——该消息的 notice summary 就是已提交的阶段记录。完整形态下，它先把会话系统提示之后的模型可见 surface 替换为一条提示——`Stage switched to <stage>. The previous conversation was archived. Read the handoff document at <path> before continuing.` 后接新阶段提示——与 compaction checkpoint 使用相同的 surface 替换。append-only 日志为人类转录保留完整历史；只有模型可见 surface 被遮蔽，本次 step 自身的用户消息落在提示之后。替换失败时，已记录的阶段保持不变、切换保持 pending，因此观察不到半应用的切换。

## 配置

```yaml
- id: stage-switch
  name: '@ai4rpg/dsh-stage-switch'
  config:
    stages:
      - name: explore
        instruction: Explore the problem space and present a plan.
      - name: implement
        instruction: Implement the approved plan.
      - name: verify
        instruction: Verify the implementation with tests.
    section: |
      The current stage is complete. Call goto_stage to switch to a later
      stage, submitting a handoff document with completed work, user
      requirements, and discussion results.
    handoffDir: handoff
    initial: explore
    minHandoffTokens: 4000
```

`stages` 必填、非空、名称唯一；名称必须匹配 `[a-z][a-z0-9_-]*`，以保证交接文件名安全。每份交接文档落在会话 cwd 下的 `<handoffDir>/<会话 id>/<stage>.md`——按会话分目录让共享同一工作区的会话互不覆盖彼此的文档。`section` 必填且非空。`handoffDir` 默认 `handoff`；`initial` 默认第一个阶段且必须命名已配置的阶段；`minHandoffTokens` 可选且必须非负。未知 key 在加载时失败。

配置了 `minHandoffTokens` 时，组合中需要 `@deepseek-ai/dsh-token-meter`；缺失时 `goto_stage` 调用会大声失败。

## 提示词文案

本包自带的所有用户可见文案——`goto_stage` 工具描述及其参数提示、切换评审对话框（问题、标签、选项描述）、工具结果与呈现卡片文案、边界/交接 notice、`/stage` 命令文案、失败信息——都集中在**一个可编辑事实源** `src/prompts.json`。`src/prompts.ts` 在模块加载时读取它，并叠加在 `src/prompts.defaults.ts`（由 JSON 重新生成的嵌入兜底）之上；没有 JSON 的过期安装（未重装前）会回退到与包历代完全一致的兜底文案。

模板可引用 `{name}` 占位符，由 `formatPrompt` 插值——例如 `review.fullQuestion: "Approve switching to stage \"{stage}\" and archiving the conversation?"`。

**刻意不进** prompts.json 的是 fold 与提示注入路径解析的承载格式：

- 阶段提示正文前缀 `Current stage: <name>`（叙述前缀 *"The user switched this session to stage …"* 是可编辑文案）；
- `source.summary` 的 notice 形态（`Current stage: <name>` / `Stage switched to <name>`）；
- `stage-review` 问题 id。

编辑流程（在本仓库下运行）：

```sh
node scripts/sync-prompts.mjs                 # 从 src/prompts.json 重生成 src/prompts.defaults.ts
npm run build                                # prebuild 钩子自动跑 sync-prompts.mjs，再 tsc 编译 lib/
```

直接手改 `src/prompts.json` 后跑 `npm run build`（`prebuild` 钩子自动重生成 `src/prompts.defaults.ts`）；`npm run test` 也通过 `pretest` 重生成。然后在部署处重装本包。直接手改 `src/prompts.json` 再跑 `node scripts/sync-prompts.mjs` 效果相同。

### 中文评审弹窗覆盖（可选）

本包带一份中文评审弹窗文案覆盖层（`src/prompts.zh.json`，8 条键值）。安装后对已装副本执行：

```sh
node node_modules/@ai4rpg/dsh-stage-switch/scripts/apply-zh.mjs
```

该脚本将中文评审文案深度合并到已装的 `src/prompts.json` 中，其他用户可见文案（工具描述、提示消息、错误信息、命令文本等）保持英文。内嵌兜底（`lib/prompts.defaults.js`）不受影响——安装包丢失 JSON 文件时仍回退到英文。

回退方法：重装包（`dsh plugin remove + add` 或 `pnpm install`/`npm install`），恢复英文 `src/prompts.json`。**每次重装或升级后重新运行该脚本**。

## 模型体验

### 阶段引导交付

#### 模型看到什么

新会话的首个请求把初始阶段提示作为对话消息携带；每次切换把新阶段的提示（`Current stage: <name>` 加上该阶段的 `instruction`）作为又一条消息追加。**子代会话跳过此初始提示**——父会话已经派发了任务，初始阶段（通常是 `route`，其指令让模型调用 `goto_stage`）会让子代死锁，因为 `goto_stage` 的评审在子代上下文里没有用户可应答。系统提示词永不包含当前阶段。当某判定器为 true 时，部署方的 `section` 模板在 order 116 贡献给运行时上下文快照；若它引用 `{{stage_current}}` 或 `{{stage_targets}}`，则组装时插值为当前阶段。

##### 配置示例

```markdown
Current stage: explore
Explore the problem space and present a plan.
```

#### Token 影响

初始阶段提示只在首个请求花费一次 instruction 的 token；每个切换后的阶段提示作为对话消息再花费一次。子代会话两者都不花——它跳过初始提示，也不切换阶段。`stage:policy` 仅在判定器为 true 时花费模板的 token，付在运行时上下文快照中而非系统提示词。

#### KV Cache 影响

阶段提示是只追加的对话增长：切换阶段追加一条消息且不改变任何请求前缀，因此 provider 的缓存前缀在每次切换后仍可复用。`stage:policy` 每次请求都重新渲染，但投影仅在其文本变化时追加快照（可切换状态翻转，或改变阶段名变量的切换）；缓存的系统提示词前缀永不被触碰。工具目录永不改变。

### 人工命令

#### 模型看到什么

`/stage` 及其终端结果不进模型历史。`/stage <name>` 切换会追加新阶段的提示，仅在最后一个请求头描述的是另一阶段时带前置的用户切换通知；仅确认当前阶段的切换不追加任何内容。阶段名之后的非空后缀会通过 `agent.steer()` 成为切换后阶段上下文中的一条修剪过的用户文本块。

#### Token 影响

裸 `/stage` 与无后缀的 `/stage <name>` 除追加的阶段提示（及可选切换通知）外不增加历史 token；带后缀的消息与单独提交该文本花费相同的历史 token。

#### KV Cache 影响

阶段提示与可选用户块都是只追加的对话增长；可复用请求前缀保持不变。

### 切换工具

#### 模型看到什么

`goto_stage` schema 在每个阶段都可用；在当前阶段规则之外的执行会带着修正原因失败。已批准的完整切换返回 `{ approved: true, stage, handoffPath }`，并渲染指明文档的确认文本；轻量切换返回 `{ approved: true, stage }`。拒绝仍是携带评审反馈的失败调用，被放弃的评审是点名用户接手的失败调用。

#### Token 影响

稳定 schema 按 ToolRuntime 模式计费，每个交接参数与评审结果留在对话历史中。

#### KV Cache 影响

阶段切换不改变工具目录；交接参数与评审结果正常扩展对话。

## 已知限制与延后工作

- 在下一个被接受的 in-turn pre-step 应用的已评审切换，若进程在此之前退出则会丢失；UI 需要重新应用。
- 轻量切换（低于 `minHandoffTokens`）不会归档对话，因此之后的完整切换会替换一段更长的累积历史。
- 被拒绝或被放弃的评审会让已写入的交接文档留在原处；它是用户可删除的可见草稿。
- 评审在通用问题流程上呈现。DeepSeek Harness monorepo 的 `stage-review` 呈现意图尚未出现在已发布的 `dsh-user-questions` 版本中；发布后，本包的未来版本可以附加它以支持专用 UI。
- 阶段提示词是引导而非强制；除非部署方另行配置沙箱与审批控制，模型可能在其之外行动。

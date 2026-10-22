# @ai4rpg/dsh-stage-switch

`@ai4rpg/dsh-stage-switch` 是为 DeepSeek Harness agent harness（[deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)）提供的可选阶段协作插件。设计决策记录见 [docs/DESIGN.zh.md](docs/DESIGN.zh.md)。

[English](README.md) | 中文

本插件按 agent（智能体）分别记录阶段协作状态到日志，包括部署方配置的阶段提示词、一个把关切换引导的判定器 seam、写入工作区的交接文档，以及经用户评审的 `goto_stage` 切换——批准后将模型可见历史归档。

## 持久状态

每次阶段进入都会追加一条持久 notice：阶段提示（`Current stage: <name>`）或已评审的切换通知（`Stage switched to <name>`）。最后一条 notice 就是当前阶段，因此 resume、fork 与 compaction 都能恢复它；更早版本写入的记录经 harness 转换后仍可读取。

`session/event` 报告已提交的切换。Host 还向侧栏发布阶段视图，因此 UI 无需重扫日志；没有阶段记录的会话看到标签页空状态。

`ctx.stage.current(session)` 读取当前阶段。已评审的切换保持 pending，在下一个被接受的 in-turn pre-step 应用，因此当前工具批次保持其阶段上下文，切换由工具结果自身叙述。

## 判定器 seam

`ctx.stage.registerEligibility(predicate)` 注册一个同步的 `(agent) => boolean` 判定器；只要任一已注册判定器对组装中的 agent 返回 true，切换引导上下文就贡献，没有任何注册时永不贡献。判定器必须同步，因为运行时上下文快照同步组装；需要异步信号的部署方应预先计算一个同步标志。注册返回 effect disposer。

## 阶段提示与运行时上下文

当前阶段**绝不是系统提示词 section**：新会话在首个请求收到初始阶段提示，每次切换把新阶段的提示作为对话消息添加——`Current stage: <name>` 加上该阶段的 `instruction`——因此切换阶段不改变任何请求前缀。若你在使用某个阶段之前就切走、随后再次切换，这个未使用阶段的提示不会出现在模型看到的内容里；append-only 日志仍保留它供审计。**子代会话跳过初始阶段提示**：父会话已经派发了任务，注入配置的初始阶段（通常是 `route`，其指令让模型调用 `goto_stage`）会让子代死锁——`goto_stage` 的评审在子代上下文里没有用户可应答。子代仍通过正常投影继承 `{{stage_current}}`/`{{stage_targets}}` 和 `stage:policy`。`stage:policy` 是运行时上下文贡献，而非提示词 section：仅在判定器为 true 时渲染配置的 `section` 模板，模板可引用 `{{stage_current}}` 与 `{{stage_targets}}` 变量。

```markdown
Current stage: explore
Explore the problem space and present a plan.
```

## `goto_stage` 工具

`goto_stage` 在每个阶段都保持注册，因此切换绝不改变请求工具目录。其执行路径要求调用 agent、一个已配置且不同于当前阶段的目标阶段，以及可用的评审 seam；任何失败都留在当前阶段。

未配置 `minHandoffTokens`、或表面 token 测量值达到阈值时，切换是**完整**的：要求非空的 `handoff` markdown 文档，通过 `ctx.fs` 写入会话 cwd 下的 `<handoffDir>/<会话 id>/<stage>.md`（默认 `handoff/`，按会话分子目录）——按会话分目录让共享同一工作区的会话互不覆盖彼此的交接文档，写入携带会话级 sandbox policy（其工作区根即会话 cwd），受限后端按会话工作区栅栏、与工具层一致，绝不落到部署级进程 cwd 兜底——并以文档作为 `detail` 提交评审。只有恰好一个不带自定义文本的 `Approve` 选择才算同意；任何其他回答都是携带用户反馈的失败调用，被放弃的评审（`ASK_CANCELLED`）会告诉模型留在当前阶段等待。

模型从不自行判断切换是否完整：工具 schema 只携带交接指导的索引（`handoff` 参数说明"除非工具要求否则省略"），因此小对话不花任何交接 token。插件在调用时实测——完整切换缺 `handoff` 会被拒绝，拒绝信息里给出要遵循的交接模板，模型带文档重试；轻量切换则永不索取。轻量切换上模型多写的 handoff 会被忽略、不落盘。

低于阈值时切换是**轻量**的：`handoff` 可选、不写任何文件，评审是不带意图或 detail 的通用确认。无论哪种形态，批准都会记录一个静默的 pending 切换，在下一个被接受的 in-turn pre-step 应用。

## `/stage` 命令

组合了 `ctx.commands` 时，本包注册 `/stage [stage|message]`。裸 `/stage` 显示当前阶段与已配置的阶段列表，不触碰状态。`/stage <name>` 是直接的用户切换：校验目标后，在空闲会话上立即应用，或在轮次中排队到下一个被接受的 in-turn pre-step，并添加新阶段的提示（仅当最后一个请求头描述的是另一阶段时才带用户切换通知前缀）；选择当前阶段不做任何改动。阶段名之后的任何文本都会作为普通用户消息通过 `agent.steer()` 送入切换后阶段的上下文，对标 `/plan <message>`。手动切换是**轻量**切换：永不写交接文档、永不归档历史——用户拥有这次变更，阶段提示会告诉模型新阶段的用途。

## 边界冲刷

下一个被接受的 in-turn pre-step 会追加目标阶段的提示消息——该消息的 notice summary 就是已提交的阶段记录。完整形态下，它先把会话系统提示之后的模型可见 surface 替换为一条提示——`Stage switched to <stage>. The previous conversation was archived. Read the handoff document at <path> before continuing.` 后接新阶段提示——与 compaction checkpoint 使用相同的 surface 替换。append-only 日志为人类转录保留完整历史；只有模型可见 surface 被遮蔽，本次 step 自身的用户消息落在提示之后。替换失败时，已记录的阶段保持不变、切换保持 pending，因此观察不到半应用的切换。

## 配置

```yaml
- id: stage-switch
  name: '@ai4rpg/dsh-stage-switch'
  config:
    stages:
      - name: explore
        alias: 探索
        instruction: Explore the problem space and present a plan.
      - name: implement
        alias: 实现
        instruction: Implement the approved plan.
      - name: verify
        alias: 验证
        instruction: Verify the implementation with tests.
    section: |
      The current stage is complete. Call goto_stage to switch to a later
      stage, submitting a handoff document with completed work, user
      requirements, and discussion results.
    handoffDir: handoff
    initial: explore
    minHandoffTokens: 4000
```

`stages` 必填、非空、名称唯一；名称必须匹配 `[a-z][a-z0-9_-]*`，以保证交接文件名安全。阶段还可声明可选的 `alias`——显示用标签（例如本地化名称），最长 60 个字符。别名只用于显示：`name` 始终是日志、`/stage`、`goto_stage` 以及所有模型可见面的持久化身份，侧栏在配置了别名时显示别名。每份交接文档落在会话 cwd 下的 `<handoffDir>/<会话 id>/<stage>.md`——按会话分目录让共享同一工作区的会话互不覆盖彼此的文档。`section` 必填且非空。`handoffDir` 默认 `handoff`；`initial` 默认第一个阶段且必须命名已配置的阶段；`minHandoffTokens` 可选且必须非负；`language` 选择评审弹窗语言——`en`（默认）或 `zh`，即中文评审弹窗词典（见下文）。未知 key 在加载时失败。

配置了 `minHandoffTokens` 时，组合中需要 `@deepseek-ai/dsh-token-meter`；缺失时 `goto_stage` 调用会大声失败。服务还需要 `@deepseek-ai/dsh-session-projection` 才能向侧栏发布阶段状态——harness 的 base bundle 已挂载它，因此标准组合天然具备；缺失时激活阶段即大声失败。

本包声明 `engines.dsh`（`>=0.2.0-rc.2 <0.3.0-0`）作为 DSH 兼容门禁。DSH 的 app-boot 与 plugin-manager 优先使用该区间而不是 dsh `peerDependencies`；peers 仍保留在 manifest 中，因为 Loader 的 profile resolution 要用这些名字把本插件的宿主包 import 路由到安装副本。dsh peer 区间同时接受 0.2.0 线与 0.2.1 预发布线，因此任一条线上的宿主都能通过 npm 的 peer 检查。兼容性以 engine 区间为准，而不是 peer 区间；超出该区间的 dsh 安装不受支持。

## 提示词文案

本包自带的所有用户可见文案——`goto_stage` 工具描述及其参数提示、切换评审对话框（问题、标签、选项描述）、工具结果与呈现卡片文案、边界/交接 notice、`/stage` 命令文案、失败信息——都集中在**一个可编辑事实源** `src/prompts.json`。`src/prompts.ts` 在模块加载时读取它，并叠加在 `src/prompts.defaults.ts`（由 JSON 重新生成的嵌入兜底）之上；没有 JSON 的过期安装（未重装前）会回退到与包历代完全一致的兜底文案。

模板可引用 `{name}` 占位符，由 `formatPrompt` 插值——例如 `review.fullQuestion: "Approve switching to stage \"{stage}\" and archiving the conversation?"`。

以下承载格式**刻意不进** prompts.json，因为 fold 与提示注入路径会解析它们：

- 阶段提示正文前缀 `Current stage: <name>`（叙述前缀 *"The user switched this session to stage …"* 是可编辑文案）；
- `source.summary` 的 notice 形态（`Current stage: <name>` / `Stage switched to <name>`）；
- `stage-review` 问题 id。

编辑流程（在本仓库下运行）：

```sh
node scripts/sync-prompts.mjs                 # 从 src/prompts.json 重生成 src/prompts.defaults.ts
npm run build                                # prebuild 钩子自动跑 sync-prompts.mjs，再 tsc 编译 lib/
```

直接手改 `src/prompts.json` 后跑 `npm run build`（`prebuild` 钩子自动重生成 `src/prompts.defaults.ts`）；`npm run test` 也通过 `pretest` 重生成。然后在部署处重装本包。直接手改 `src/prompts.json` 再跑 `node scripts/sync-prompts.mjs` 效果相同。

### 中文评审弹窗文案

本包带一份中文评审弹窗文案覆盖层（`src/prompts.zh.json`，8 条键值）；其他用户可见文案（工具描述、提示消息、错误信息、命令文本等）保持英文。

**优先使用部署声明式路径：** 在插件行上设置 `language: zh`——服务在构造时解析中文词典，因此该选择存在于组合中（挂载本插件的同一份 patch 里），每次重装都保留，且无需任何安装后脚本：

```yaml
- id: stage-switch
  name: '@ai4rpg/dsh-stage-switch'
  config:
    language: zh
    # ...stages、section 及其余配置
```

**无法编辑组合时，改用文件级路径（旧法）：** 把覆盖层合并到已装副本。

```sh
node node_modules/@ai4rpg/dsh-stage-switch/scripts/apply-zh.mjs
```

该脚本将中文评审文案深度合并到已装的 `src/prompts.json` 中。内嵌兜底（`lib/prompts.defaults.js`）不受影响——安装包丢失 JSON 文件时仍回退到英文。回退文件级合并：重装包（`dsh plugin remove + add`），恢复英文 `src/prompts.json`。**每次重装或升级后重新运行该脚本**——或改用配置路径，它没有这一步。

## 模型与缓存影响

- 系统提示词永不包含当前阶段：阶段提示是对话消息。切换会把新提示加到对话尾部，因此可复用请求前缀与工具目录保持稳定。未使用的中转阶段提示会被替换，模型看不到它。
- 初始阶段提示每个会话只花费一次 instruction 的 token；每次切换再为新的 instruction 花费一次。以这种方式被替换的提示不留下长期模型可见 token，append-only 日志仍保留审计记录。
- `/stage` 及其结果不进模型历史；后缀会作为普通用户消息送入。交接参数与评审结果正常扩展对话。
- 子代会话跳过初始阶段提示，也不切换阶段。
- `stage:policy` 是运行时上下文，不是系统提示词 section；仅在判定器为 true 时贡献。

## 已知限制与延后工作

- 在下一个被接受的 in-turn pre-step 应用的已评审切换，若进程在此之前退出则会丢失；UI 需要重新应用。
- 轻量切换（低于 `minHandoffTokens`）不会归档对话，因此之后的完整切换会替换一段更长的累积历史。
- 被拒绝或被放弃的评审会让已写入的交接文档留在原处；它是用户可删除的可见草稿。
- 评审在通用问题流程上呈现。DeepSeek Harness monorepo 的 `stage-review` 呈现意图尚未出现在已发布的 `dsh-user-questions` 版本中；发布后，本包的未来版本可以附加它以支持专用 UI。
- 阶段提示词是引导而非强制；除非部署方另行配置沙箱与审批控制，模型可能在其之外行动。

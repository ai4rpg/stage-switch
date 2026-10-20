# @ai4rpg/dsh-ui-sidebar-stage

[English](README.md) | 中文

本包提供 dsh Web 客户端右侧栏的**阶段标签页**：以 Atlas 式视图展示运行 `@ai4rpg/dsh-stage-switch` 的会话当前处于阶段旅程的哪里、每个阶段花了多少，以及下一步能去哪里。

## 工作原理

- **本包是纯 UI 插件。** host 半是惰性 `apply()`；浏览器半向右侧栏注册一个 `stage` 标签页类型（page 类型、extension 带、guide 入口），正文挂进 keyed `sidebar.right.pane.tab` 席位。
- **标签页优先读 Host 的 stage wire view，读不到时回退到事件窗口。** 当 runtime 挂载了 stage-switch、其 `stage` projection 带客户端 wire view 且该会话已有阶段记录时，标签页直接渲染 Host 提供的完整阶段数据：带 instruction 的阶段目录、已记录的旅程、以及每阶段的消息/工具/token/错误计数。这个值不可用时（旧宿主、runtime 里没有挂载 stage-switch 的预设，或会话还没到第一个被接受的 step），标签页自行折叠会话绑定的事件窗口——只显示访问过的阶段，计数与 instruction 在客户端解析。空闲与恢复会话看到同样的视图；依旧零 Host RPC。
- **持久阶段记录是激活门槛。** `stage` projection key 是 runtime 全局的：只要某个已挂载的 agent 预设包含 stage-switch，该 runtime 里每个会话的快照都会带上它——包括运行其他预设的会话。插件在会话第一个被接受的 step 写入阶段记录（初始 stage prompt），所以以这条记录为门槛，才能避免标签页、标题和胶囊把别的预设的阶段工作流呈现出来；在记录落地前，三个表面与「宿主没有该能力」时的表现完全一致。
- **标签页的 Atlas 视图以当前阶段为中心。** hero 由带阶段目录序号的轨道环、阶段标签（配置了显示别名时用别名，否则用名称）与 instruction、停留时长，以及可选的上下文压力 gauge 组成。指标行显示当前阶段的消息、工具调用与 token。下方是旅程：过去的访问、脉冲的当前节点；目录已知时还会把未来阶段画成空心、仍可切换的节点。文案走客户端 locale 字典；亮暗主题与 reduced-motion 都处理了。
- **两个环境化表面让阶段在标签页之外也保持可见。** 会话的 wire view 激活（存在且带阶段记录）时，标签页的实时标题跟随当前阶段（阶段标签 + 身份色点），消息输入框上方出现一个紧凑的阶段胶囊（标签、停留时长、live 脉冲；点击打开阶段标签页）。阶段若配置了显示别名，这些表面显示别名；持久化名称保留在标签页标题的 tooltip 中。两者读同一个 wire 值；该值缺失时，标题回退到类型名，胶囊不渲染。与标签页不同，它们不携带 fold，所以常驻胶囊不会扫描事件窗口。
- **标签页内可以直接切换阶段。** 命令面板（`⌘K` / `Ctrl K`，或「切换阶段」按钮）在目录已知时列出完整目录，回退时列出访问过的阶段，支持搜索（同时匹配名称与显示别名）、键盘导航，以及直接输入自定义阶段名（host 的 `[a-z][a-z0-9_-]*` 语法）。带别名的行显示别名，并把持久化名称作为提示。过去/未来的旅程节点可以一键切换。每次选择都通过会话绑定的 command 面提交 `/stage <name>`——与聊天输入执行的是同一条命令。命令执行期间选择挂起；成功但尚未在下一回合边界落地的请求显示「已请求」，而不是假装已经切过去；失败显示命令自己的错误信息。
- **客户端折叠契约与 Host 保持同步。** 测试会把客户端的折叠契约副本（producer kinds + summary 正则）与 `@ai4rpg/dsh-stage-switch` 导出的 `STAGE_SOURCE_KINDS` / `STAGE_SUMMARY` 对齐；wire 值类型以 type-only 方式从同一 workspace 源码导入，浏览器 bundle 永远不 require Host 插件。

## 部署

标签页模块从 **host 层行**加载——预设作用域的行永远不会被扫进浏览器 roster。tavern 预设 bundle 插入该行（active）；无预设部署在 tavern-stages 的 host 补丁里列出它（与其余行一起 disabled，需要时一起启用）。

尚无阶段记录的会话显示标签页的空状态；如果该会话的预设从未挂载 stage-switch，尝试切换会得到命令的不可用提示。本包声明 `engines.dsh`（`>=0.2.0-rc.2 <0.3.0-0`），DSH 会在加载前拒绝不兼容的运行时；本包没有 peerDependencies。

## 开发

```sh
npm run typecheck
npm test
npm run build
```

`npm run build` 产出两半：惰性 ESM host 入口（`lib/index.js`）与浏览器闭包工厂 bundle（`lib/client.js`，`window.__ModuleLoader__.load({ id, factory })`，模块表基线 specifier 保持 external）。bundle 测试钉住该产物形状。标签页的样式是随插件 fiber 安装、随其销毁移除的 scoped `<style data-ui-sidebar-stage-styles>` 元素（闭包 bundle 没有 CSS pipeline），所有选择器都带 `ui-stage-` 前缀。

可选的 `npm run test:integration` 会把插件挂上本地 dsh 源码 checkout 的**生产** slot 机器（真 SlotRegistry/renderer、真会话 fixture）。需要与本包 devDependencies 同版本线的 dsh checkout（版本漂移时直接报错），其余场合（含 CI）一律跳过——默认套件保持自足。

> `@ai4rpg/dsh-stage-switch` 开发依赖为 `^0.2.0`，即本包折叠契约所钉的那次发布。Atlas 与环境化表面用的 wire view 类型是 stage-switch 0.2.1 的新增内容；新安装该区间会解析到该发布，发布顺序也是 stage-switch 先行。在本仓库内，workspace 会把该名字解析到兄弟包源码（因此钉住测试不需要构建顺序）；从 npm 安装则拿到同一区间的已发布版本。改动这个钉住关系意味着本包要发新版本——两者契约耦合，必须一起动。

## 许可

MIT。

# @ai4rpg/dsh-ui-sidebar-stage

[English](README.md) | 中文

dsh Web 客户端右侧栏的**阶段 tab**：显示运行 `@ai4rpg/dsh-stage-switch` 的会话的当前阶段与切换历史。

## 工作原理

- **纯 UI 插件。** host 半是惰性 `apply()`；浏览器半向右侧栏注册一个 `stage` tab 类型（page 类型、extension 带、guide 入口），正文挂进 keyed `sidebar.right.pane.tab` 席位。
- **零 Host RPC。** 阶段记录是持久化 `user/message` 通知（`source.kind` 为 `stage-switch` / `plugin:stage-switch`，summary 为 `Current stage: X` / `Stage switched to X`），会话视图本就在渲染它们。tab 从会话绑定的事件窗口客户端折叠，空闲与恢复会话和运行中会话看到同样的视图。
- **契约钉住。** 客户端的折叠契约副本（producer kinds + summary 正则）由测试钉在 `@ai4rpg/dsh-stage-switch` 导出的 `STAGE_SOURCE_KINDS` / `STAGE_SUMMARY` 上。
- **可直接在 tab 内切换阶段。** 当前阶段的胶囊本身就是控件：一个手写的下拉菜单（沿用面板官方菜单语言——lg 圆角的浮层底色加背景模糊、hover 填充的行、当前行尾部对勾、18px 会翻转的箭头；primitives 的 `Menu` 在外部仓库中无法导入类型），其取值是折叠出的当前阶段，可选项是本会话**已记录**过的阶段——阶段目录是预设自有的 Host 数据、没有客户端通道，所以 tab 从不臆测它。选中一个阶段会通过会话绑定的 command 面提交 `/stage <name>`（与聊天输入执行的是同一条命令）；命令执行期间该选择保持挂起，随后切换追加的持久记录经折叠重新渲染 tab（在开回合中发起的切换会在边界排队，因此取值会在冲刷落地前如实停在仍在生效的阶段上）。切换到本会话从未进入过的阶段仍留在聊天里：`/stage <name>` 或模型的 `goto_stage`。stage-switch 未挂载时命令返回 `matched: false`，tab 显示其不可用提示。

## 部署

tab 模块从 **host 层行**加载——预设作用域的行永远不会被扫进浏览器 roster。tavern 预设 bundle 插入该行（active）；无预设部署在 tavern-stages 的 host 补丁里列出它（与其余行一起 disabled、一起翻转）。

预设不挂 stage-switch 的会话只显示空态（尝试切换则给出不可用提示）。

## 开发

```sh
npm run typecheck
npm test
npm run build
```

`npm run build` 产出两半：惰性 ESM host 入口（`lib/index.js`）与浏览器闭包工厂 bundle（`lib/client.js`，`window.__ModuleLoader__.load({ id, factory })`，模块表基线 specifier 保持 external）。bundle 测试钉住该产物形状。

可选的 `npm run test:integration` 会把插件挂上本地 dsh 源码 checkout 的**生产** slot 机器（真 SlotRegistry/renderer、真会话 fixture）。需要与本包 devDependencies 同版本线的 dsh checkout（守卫在漂移时响亮失败），其余场合（含 CI）一律跳过——默认套件保持自足。

> `@ai4rpg/dsh-stage-switch` 开发依赖为 `^0.2.0`，即本包折叠契约所钉的那次发布。在本仓库内，workspace 会把该名字解析到兄弟包源码（因此钉住测试不需要构建顺序）；从 npm 安装则拿到同一区间的已发布版本。改动这个钉住关系意味着本包要发新版本——两者契约耦合，必须一起动。

## 许可

MIT。

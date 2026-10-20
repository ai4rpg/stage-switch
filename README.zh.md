# stage-switch

[English](README.md) | 中文

本仓库为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 提供阶段协作：把长任务拆成若干命名阶段，各自带一条指令与可选的显示别名。模型通过 `goto_stage` 工具请求切换——由用户评审，完整切换会写交接文档并归档此前的对话；用户也可以用 `/stage` 直接切换。每次切换都是会话日志里的持久记录，恢复、分叉或压缩后的会话都能找回自己的阶段。

本仓库是一个 npm workspace，发布两个包：

| 包 | 目录 | 是什么 |
|---|---|---|
| [`@ai4rpg/dsh-stage-switch`](stage-switch/README.zh.md) | `stage-switch/` | 阶段协作插件：按 agent 记录到日志的阶段状态、带用户评审切换的 `goto_stage` 工具、交接文档，以及 `/stage` 命令。 |
| [`@ai4rpg/dsh-ui-sidebar-stage`](ui-sidebar-stage/README.zh.md) | `ui-sidebar-stage/` | Web 客户端右侧栏的**阶段标签页**：Atlas 式的当前阶段 hero、阶段旅程、每阶段计数与命令面板（配置了显示别名的阶段显示别名），另有实时标签页标题与输入框上方的阶段胶囊。会话有阶段记录后优先读 Host stage projection 的 wire view，否则回退到会话持久阶段记录的客户端折叠。 |

两个包分开发布，是因为它们挂载在 harness 的不同层——插件挂载在预设作用域行，标签页挂载在宿主层行——但共享同一条历史与同一个锁文件。每个包有自己的 README（安装、配置、部署）与 npm 身份；插件的决策记录在 [`stage-switch/docs/DESIGN.zh.md`](stage-switch/docs/DESIGN.zh.md)。

## 开发

```sh
npm install          # 工作区安装（hoisted：@deepseek-ai/* 只有单份副本）
npm run typecheck    # 两个包
npm test             # 两个包
npm run build        # 两个包
```

根脚本聚合各包脚本；单包按 workspace 名运行，例如 `npm test -w stage-switch`。sidebar 包另有一个可选命令 `npm run test:integration -w ui-sidebar-stage`，需要本地 dsh 源码 checkout——详见其 README。

## 许可

MIT。每个包各自带一份 `LICENSE` 文件。

# stage-switch

[English](README.md) | 中文

面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的阶段协作：把长任务拆成若干命名阶段，各自带一条指令。模型通过 `goto_stage` 工具请求切换——由用户评审，完整切换会写交接文档并归档此前的对话；用户也可以用 `/stage` 直接切换。每次切换都是会话日志里的持久记录，恢复、分叉或压缩后的会话都能找回自己的阶段。

本仓库是一个 npm workspace，发布两个包：

| 包 | 目录 | 是什么 |
|---|---|---|
| [`@ai4rpg/dsh-stage-switch`](stage-switch/README.zh.md) | `stage-switch/` | 阶段协作插件：按 agent 记录到日志的阶段状态、带用户评审切换的 `goto_stage` 工具、交接文档，以及 `/stage` 命令。 |
| [`@ai4rpg/dsh-ui-sidebar-stage`](ui-sidebar-stage/README.zh.md) | `ui-sidebar-stage/` | Web 客户端右侧栏的**阶段 tab**：当前阶段、切换历史与切换控件——全部从会话的持久阶段记录在客户端折叠得出。 |

两个包分开发布，是因为它们挂在 harness 的不同层——插件挂预设作用域行，tab 挂宿主层行——但共享同一条历史与同一个锁文件。每个包有自己的 README（安装、配置、部署）与 npm 身份；插件的决策记录在 [`stage-switch/docs/DESIGN.zh.md`](stage-switch/docs/DESIGN.zh.md)。

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

# stage-switch

English | [中文](README.zh.md)

This workspace provides stage collaboration for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): it splits a long-running task into named stages, each with its own instruction and optional display alias. The model requests switches through the `goto_stage` tool — reviewed by the user, with a handoff document and archived history on a full transition — and the user can switch directly with `/stage`. Every switch is a durable session-log record, so resumed, forked, or compacted sessions recover their stage.

This repository is one npm workspace publishing two packages:

| Package | Directory | What it is |
|---|---|---|
| [`@ai4rpg/dsh-stage-switch`](stage-switch/README.md) | `stage-switch/` | The stage-collaboration plugin: logged per-agent stage state, the `goto_stage` tool with its user-reviewed transition, the handoff document, and the `/stage` command. |
| [`@ai4rpg/dsh-ui-sidebar-stage`](ui-sidebar-stage/README.md) | `ui-sidebar-stage/` | The right-Sidebar **stage tab** of the Web client: an Atlas-style current-stage hero, the stage journey, per-stage counters, and a command palette, plus a live tab title and a composer stage pill. It uses stage-switch's stage view when available and otherwise works from the session log. |

They publish separately because they mount in different parts of the harness — the plugin per preset, the tab in the client shell — but share one history and one lockfile. Each package keeps its own README (installation, configuration, deployment) and npm identity; the plugin's decision record is [`stage-switch/docs/DESIGN.md`](stage-switch/docs/DESIGN.md).

## Development

```sh
npm install          # workspace install (hoisted: single @deepseek-ai/* copies)
npm run typecheck    # both packages
npm test             # both packages
npm run build        # both packages
```

The root scripts aggregate the per-package scripts; run one package by workspace name, e.g. `npm test -w stage-switch`. The sidebar package has one opt-in extra, `npm run test:integration -w ui-sidebar-stage`, which needs a local dsh source checkout — see its README.

## License

MIT. Each package carries its own `LICENSE` file.

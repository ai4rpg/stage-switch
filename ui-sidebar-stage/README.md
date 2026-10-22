# @ai4rpg/dsh-ui-sidebar-stage

English | [中文](README.zh.md)

This package provides the **stage tab** for the dsh Web client's right Sidebar: an Atlas-style view of where a session is in its stage journey, what each stage cost, and where it can go next — for sessions that run `@ai4rpg/dsh-stage-switch`.

## How it works

- **The package is a pure UI plugin.** It registers the Stage tab in the right Sidebar, plus the tab's live title and the ambient pill above the composer. It has no Host half of its own and makes no RPC calls.
- **It uses the Host stage view when available, and falls back to the session event window.** With stage-switch mounted and a stage record in this session, the tab shows the Host's catalog, journey, and counters; otherwise it folds the loaded session window client-side. Idle and resumed sessions look the same.
- **Only sessions that use stage-switch show the tab.** A session with no stage record gets the empty state, even when another preset in the same runtime mounts the plugin.
- **The Atlas view centers on the current stage.** The hero shows the catalog index, label/alias, instruction, active time in stage, and an optional context-pressure gauge. The clock counts turn time and pauses while the session is idle. Metrics show the current stage's messages, tool calls, and tokens. Below them, the journey lists visits, the current node, and future nodes for catalog stages **not yet visited**. A visited stage moves to the switchable history rows above; the palette always lists the full route. Every recorded visit stays visible, and the journey scrolls inside the tab so a long history never pushes the hero, metrics, or switch button out of the pane; on a pane too short for the fixed blocks, the tab itself scrolls so the switch button stays reachable. Bilingual copy, themes, and reduced-motion preferences are supported.
- **Ambient surfaces keep the stage visible.** The tab title shows the current label and identity dot; a compact pill above the composer shows the label, active time, and live state, and opens the tab when clicked. Both read the same Host view; without it, the title falls back to the default label and the pill disappears.
- **Switch from the tab.** The palette (`⌘K` / `Ctrl K`, or the Switch stage button) lists the full catalog when known (the visited stages in the fallback), supports search and keyboard navigation, and accepts a custom stage name. Every pick submits `/stage <name>` through the session's command face. A queued switch shows a "requested" note until it lands; a failure shows the command's own message.

## Deployment

The tab module loads from a **host-plane row** — preset-scoped rows are never scanned into the browser roster. The tavern preset bundle inserts the row (active); a no-preset deployment lists it in the tavern-stages host patch (disabled with the rest, flipped on together).

A session with no stage record shows the tab's empty state; if its preset never mounted stage-switch, a switch attempt returns the command's unavailable message. The package declares `engines.dsh` (`>=0.2.0-rc.2 <0.3.0-0`) so DSH refuses an incompatible runtime before loading it; it has no peer dependencies.

## Development

```sh
npm run typecheck
npm test
npm run build
```

`npm run build` emits the host entry and the browser closure bundle.

An optional `npm run test:integration` mounts the plugin through the **production** slot machinery of a local dsh source checkout (real SlotRegistry/renderer, real session fixtures). It needs a dsh checkout on the same version line as this package's devDependencies (a guard fails loudly on drift) and is skipped everywhere else — including CI — so the default suite stays self-contained.

> The `@ai4rpg/dsh-stage-switch` devDependency is `^0.2.0`, the release this package is built against. Newer stage-switch releases add fields compatibly, and the tab keeps a fallback for older hosts. Inside this repository the workspace resolves the name to the sibling source; a published install resolves the same range from the registry. Release stage-switch first; changing the pin requires a new sidebar release.

## License

MIT.

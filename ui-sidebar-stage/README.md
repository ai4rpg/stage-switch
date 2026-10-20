# @ai4rpg/dsh-ui-sidebar-stage

English | [中文](README.zh.md)

This package provides the **stage tab** for the dsh Web client's right Sidebar: an Atlas-style view of where a session is in its stage journey, what each stage cost, and where it can go next — for sessions that run `@ai4rpg/dsh-stage-switch`.

## How it works

- **The package is a pure UI plugin.** The host half is an inert `apply()`; the browser half registers one `stage` tab type (page type, extension band, guide entry) into the right Sidebar and its body into the keyed `sidebar.right.pane.tab` seat.
- **The tab prefers the Host stage wire view and falls back to the event window.** When the runtime mounts stage-switch with its client-visible `stage` projection **and the session has recorded a stage**, the tab renders the Host's complete stage view: the configured stage catalog with instructions, the recorded journey, and per-stage message / tool / token / error counters. When that value is unavailable (an older host, a runtime with no mounted preset that includes stage-switch, or a session that has not reached its first accepted step), the tab folds the session binding's event window itself — visited stages only, with the same counters and instructions parsed client-side. Idle and resumed sessions show the same view; there is still zero Host RPC.
- **The durable record is the activation gate.** The `stage` projection key is runtime-global: in a deployment where any mounted agent preset includes stage-switch, every session's snapshot carries it, including sessions running another preset. The plugin writes a stage record at the session's first accepted step (the initial stage prompt), so requiring that record is what keeps the tab, title, and pill from presenting another preset's stage workflow; before that record exists, the surfaces degrade exactly like a host without the capability.
- **The tab's Atlas view centers on the current stage.** The hero shows a live orbit ring with the stage's catalog index, the stage label (its configured display alias when present, otherwise its name) and instruction, time in stage, and an optional context-pressure gauge. A metrics row shows the current stage's messages, tool calls, and tokens. Below it, the journey renders past visits, the pulsing current node, and — when the catalog is known — future stages as hollow, still-switchable nodes. Bilingual copy rides the client locale dictionaries; light/dark themes and reduced-motion preferences are honoured.
- **Two ambient surfaces keep the stage visible outside the tab.** When the session's wire view is activated (present and carrying a stage record), the tab chip's live title follows the current stage (label plus its identity dot), and a compact stage pill sits above the message composer (label, time in stage, live pulse; click opens the stage tab). A stage's configured display alias is what these surfaces show; the durable name stays in the chip's tooltip. Both read the same wire value; when it is absent, the title falls back to the type label and the pill renders nothing. Unlike the tab, neither carries a fold, so an always-mounted pill never scans the event window.
- **The tab can switch stages directly.** A command palette (`⌘K` / `Ctrl K`, or the Switch stage button) offers the full catalog when known (the visited stages in the fallback), search (matching names and display aliases), keyboard navigation, and a field for typing a custom stage name (the host's `[a-z][a-z0-9_-]*` grammar). An aliased row shows the alias with the durable name as its hint. Past and future journey nodes are one-click switches. Every pick submits `/stage <name>` through the session binding's command face — the same command the chat input runs. The pick is held while the command runs; a successful request that has not yet landed at the next turn boundary shows a "requested" note rather than pretending the switch already happened, and a failure shows the command's own message.
- **The client fold contract is pinned against the Host.** A test checks the client copy of the fold contract (producer kinds + summary regex) against `@ai4rpg/dsh-stage-switch`'s exported `STAGE_SOURCE_KINDS` / `STAGE_SUMMARY`; the wire value type is imported type-only from the same workspace source, so the browser bundle never requires the Host plugin.

## Deployment

The tab module loads from a **host-plane row** — preset-scoped rows are never scanned into the browser roster. The tavern preset bundle inserts the row (active); a no-preset deployment lists it in the tavern-stages host patch (disabled with the rest, flipped on together).

A session with no stage record shows the tab's empty state; if its preset never mounted stage-switch, a switch attempt returns the command's unavailable message. The package declares `engines.dsh` (`>=0.2.0-rc.2 <0.3.0-0`) so DSH refuses an incompatible runtime before loading it; it has no peer dependencies.

## Development

```sh
npm run typecheck
npm test
npm run build
```

`npm run build` emits both halves: the inert ESM host entry (`lib/index.js`) and the browser closure-factory bundle (`lib/client.js`, `window.__ModuleLoader__.load({ id, factory })` with module-table baseline specifiers external). The bundle test pins that artifact shape. The tab's stylesheet is a scoped `<style data-ui-sidebar-stage-styles>` element installed with the plugin fiber (the closure bundle has no CSS pipeline), and every selector is prefixed `ui-stage-`.

An optional `npm run test:integration` mounts the plugin through the **production** slot machinery of a local dsh source checkout (real SlotRegistry/renderer, real session fixtures). It needs a dsh checkout on the same version line as this package's devDependencies (a guard fails loudly on drift) and is skipped everywhere else — including CI — so the default suite stays self-contained.

> The `@ai4rpg/dsh-stage-switch` devDependency is `^0.2.0`, the release this package's fold contract is pinned against. The wire-view types used by the Atlas and ambient surfaces are additive in stage-switch 0.2.1; a fresh install of the range resolves that release, and the release order publishes stage-switch first. Inside this repository the workspace resolves the name to the sibling source (so the pin test needs no build ordering); a published install gets the same range from the registry. Changing the pin means releasing a new version of this package — the two are contract-coupled, so they move together.

## License

MIT.

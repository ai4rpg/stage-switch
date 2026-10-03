# @ai4rpg/dsh-ui-sidebar-stage

English | [中文](README.zh.md)

The **stage tab** for the dsh Web client's right Sidebar: it shows the current
stage of a session that runs `@ai4rpg/dsh-stage-switch`, plus its transition
history.

## How it works

- **A pure UI plugin.** The host half is an inert `apply()`; the browser half
  registers one `stage` tab type (page type, extension band, guide entry) into
  the right Sidebar and its body into the keyed `sidebar.right.pane.tab` seat.
- **Zero Host RPC.** Stage records are durable `user/message` notices
  (`source.kind` `stage-switch` / `plugin:stage-switch`, summary
  `Current stage: X` / `Stage switched to X`) that the conversation already
  renders. The tab folds them client-side from the session binding's event
  window, so idle and resumed sessions show the same view a running one does.
- **Contract-pinned.** The client copy of the fold contract (producer kinds +
  summary regex) is pinned by test against `@ai4rpg/dsh-stage-switch`'s
  exported `STAGE_SOURCE_KINDS` / `STAGE_SUMMARY`.
- **Stage switching from the tab.** The current-stage capsule IS the
  control: a hand-rolled dropdown (the pane's official menu language —
  surface fill with backdrop blur on the lg radius, hover-fill rows, the
  trailing check on the current row, an 18px flipping chevron; the
  primitives `Menu` itself is not importable for types from an external
  repo) whose value is the folded current stage and whose options are the
  stages this session has **recorded** — the stage catalog is preset-owned
  Host data with no client channel, so the tab never guesses it. Picking a
  stage submits `/stage <name>` through the session binding's command face
  (the same command the chat input runs); the pick is held while the command
  runs, then the durable record the switch appends re-renders the tab through
  the fold (a switch issued during an open turn queues at the boundary, so
  the value honestly parks on the stage still in force until the flush
  lands). Switching to a stage the session has never entered stays in the
  chat: `/stage <name>` or the model's `goto_stage`. When stage-switch is
  not mounted, the command answers `matched: false` and the tab shows its
  unavailable line.

## Deployment

The tab module loads from a **host-plane row** — preset-scoped rows are never
scanned into the browser roster. The tavern preset bundle inserts the row
(active); a no-preset deployment lists it in the tavern-stages host patch
(disabled with the rest, flipped on together).

Sessions whose preset does not mount stage-switch simply show the tab's empty
state (and a switch attempt answers the unavailable line).

## Development

```sh
npm run typecheck
npm test
npm run build
```

`npm run build` emits both halves: the inert ESM host entry (`lib/index.js`)
and the browser closure-factory bundle (`lib/client.js`,
`window.__ModuleLoader__.load({ id, factory })` with module-table baseline
specifiers external). The bundle test pins that artifact shape.

An optional `npm run test:integration` mounts the plugin through the
**production** slot machinery of a local dsh source checkout (real
SlotRegistry/renderer, real session fixtures). It needs a dsh checkout on
the same version line as this package's devDependencies (a guard fails loud
on drift) and is skipped everywhere else — including CI — so the default
suite stays self-contained.

> The `@ai4rpg/dsh-stage-switch` devDependency is `^0.2.0`, the release this
> package's fold contract is pinned against. Inside this repository the workspace
> resolves that name to the sibling source (so the pin test needs no build
> ordering); a published install gets the same range from the registry. Changing
> the pin means releasing a new version of this package — the two are
> contract-coupled, so they move together.

## License

MIT.

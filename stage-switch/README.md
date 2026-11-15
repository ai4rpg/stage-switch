# @ai4rpg/dsh-stage-switch

`@ai4rpg/dsh-stage-switch` is an optional stage-collaboration plugin developed for the DeepSeek Harness agent harness ([deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)). The design decision record is [docs/DESIGN.md](docs/DESIGN.md).

English | [中文](README.zh.md)

The plugin keeps logged, per-agent stage collaboration state with deployment-owned stage instructions, an eligibility seam that gates switch guidance, a handoff document written to the workspace, and a user-reviewed `goto_stage` transition that archives the model-visible history on approval.

## Durable state

Every stage entry appends a durable notice: the stage prompt (`Current stage: <name>`) or the reviewed transition notice (`Stage switched to <name>`). The last notice is the current stage, so resume, fork, and compaction recover it; records from earlier releases are converted by the harness and still read.

`session/event` reports committed switches. The Host also publishes the stage view used by the sidebar, so the UI does not rescan the log; a session with no stage record sees the tab's empty state.

`ctx.stage.current(session)` reads the stage in force. A reviewed transition is held pending and applied at the next accepted in-turn pre-step, so the current tool batch keeps its stage context and the tool result itself narrates the switch.

## Eligibility seam

`ctx.stage.registerEligibility(predicate)` registers a synchronous `(agent) => boolean` predicate; the switch-guidance context contributes while ANY registered predicate returns true for the assembly's agent, and never contributes with none registered. Predicates must be synchronous because the runtime-context snapshot assembles synchronously; deployments needing asynchronous signals precompute a synchronous flag. Registration returns an effect disposer.

## Stage prompts and runtime context

The current stage is **never a system-prompt section**: a fresh session receives the initial stage prompt on its first request, and every switch adds the new stage prompt as a conversation message — `Current stage: <name>` plus that stage's `instruction` — so switching stages changes no request prefix. If you switch away before using a stage and then switch again, that unused stage's prompt is left out of what the model sees; the append-only log keeps it for audit. **A subagent session skips the initial stage prompt**: the parent already routed its task, so injecting the configured initial stage (often `route`, whose instruction tells the model to call `goto_stage`) would deadlock the child — `goto_stage`'s review has no user to answer in a subagent context. The child still inherits `{{stage_current}}`/`{{stage_targets}}` and `stage:policy` through the normal projection. `stage:policy` is a runtime-context contribution, not a prompt section: it renders the configured `section` template only while a predicate is true, and it may reference the `{{stage_current}}` and `{{stage_targets}}` variables.

```markdown
Current stage: explore
Explore the problem space and present a plan.
```

## The `goto_stage` tool

`goto_stage` stays registered in every stage, so switching never changes the request tool catalog. Its execute path requires a calling agent, a configured target stage other than the current one, and a reviewable seam; every failure stays in the current stage.

A transition is **full** when no `minHandoffTokens` is configured, or when the surface token measurement is at or above it. A full transition requires a non-empty `handoff` markdown document, writes it to `<handoffDir>/<session id>/<stage>.md` under the session cwd (default `handoff/`, per-session subdirectory) through `ctx.fs` — the per-session directory keeps sessions sharing one workspace from overwriting each other's documents, and the write carries the session's standing sandbox policy (its workspace root is the session cwd), so a confining backend fences the write against the session workspace exactly as the tool layers do, never the deployment's process-cwd fallback — and presents the review with the document as `detail`. Only exactly one `Approve` selection with no custom text consents; every other answer is a failed call carrying the user's feedback, and a dismissed review (`ASK_CANCELLED`) tells the model to stay in the current stage and wait.

The model never decides whether a switch is full: the tool schema carries only an index to the handoff guidance (the `handoff` parameter says to omit it unless the tool asks), so a small conversation costs no handoff tokens. The plugin measures at call time — a full transition without a `handoff` is rejected with the handoff template to follow, and the model retries with the document; a light transition never requests one. A handoff provided anyway on a light switch is ignored, not written.

Below the threshold a transition is **light**: `handoff` is optional, nothing is written, and the review is a generic confirm without intent or detail. Either way, approval records a silent pending transition applied at the next accepted in-turn pre-step.

## The `/stage` command

When `ctx.commands` is composed, the package registers `/stage [stage|message]`. Bare `/stage` shows the current stage and the configured stage list without touching state. `/stage <name>` is a direct user switch: it validates the target, applies it immediately on an idle session or queues it for the next accepted in-turn pre-step during a turn, and adds the new stage's prompt (with a user-switch notice only when the last request header described a different stage); selecting the current stage does nothing. Any text after the stage name is steered as an ordinary user message into the switched stage's context, mirroring `/plan <message>`. A manual switch is a **light** transition: it never writes a handoff document and never archives history — the user owns the change, and the stage prompt tells the model what the new stage is for.

## The boundary flush

The next accepted in-turn pre-step appends the target stage's prompt message — that message's notice summary is the committed stage record. In the full shape it first replaces the model-visible surface behind the session's system prompt with one notice — `Stage switched to <stage>. The previous conversation was archived. Read the handoff document at <path> before continuing.` followed by the new stage prompt — using the same surface replacement as compaction checkpoints. The append-only log retains the full history for the human transcript; only the model-visible surface is shadowed, and the step's own user messages land after the notice. A failed replacement leaves the logged stage untouched and the transition pending, so no half-applied switch is observable.

## Configuration

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

`stages` is required, non-empty, and name-unique; names must match `[a-z][a-z0-9_-]*` so handoff file names stay safe. A stage may also declare an optional `alias` — a display label such as a localization, at most 60 characters. The alias is display-only: `name` stays the durable identity in the log, `/stage`, `goto_stage`, and every model-facing surface, while the sidebar shows the alias where configured. Each handoff document lands in `<handoffDir>/<session id>/<stage>.md` under the session cwd — the per-session directory keeps sessions that share a workspace from overwriting each other's documents. `section` is required and non-empty. `handoffDir` defaults to `handoff`; `initial` defaults to the first stage and must name a configured stage; `minHandoffTokens` is optional and must be non-negative; `language` selects the review-dialog language — `en` (default) or `zh`, the Chinese review-dialog dictionary (see below). Unknown keys fail at load.

A configured `minHandoffTokens` requires `@deepseek-ai/dsh-token-meter` in the composition; a `goto_stage` call fails loud when it is missing. The service also requires `@deepseek-ai/dsh-session-projection` to publish stage state to the sidebar — the harness's base bundle mounts it, so standard compositions already provide it; activation fails loud without it.

The package requires Node.js `>=24.9.0` and declares `engines.dsh` (`>=0.2.2-rc.3 <0.3.0-0`) as its DSH compatibility gate. DSH prefers that range over the `peerDependencies`; the peers (`^0.2.2-rc.3`) remain in the manifest because the Loader's profile resolution uses their names to route host-package imports to the installation copy. This release uses the rc.2+ projection-handle API; its Zod pin matches rc.3's `4.6.6` because projection schema types cross the package boundary. A dsh installation outside the engine range is unsupported.

## Prompt copy

All user-facing copy this package ships — the `goto_stage` tool description and its parameter hints, the transition-review dialog (question, labels, option descriptions), the tool-result and present-card texts, the boundary/handoff notices, the `/stage` command texts, and the failure messages — lives in ONE editable source, `src/prompts.json`. `src/prompts.ts` reads it at module load and overlays it on the embedded defaults in `src/prompts.defaults.ts` (regenerated from the JSON); a stale install without the JSON keeps working with the exact strings the package always shipped.

Templates may reference `{name}` placeholders, interpolated by `formatPrompt` — e.g. `review.fullQuestion: "Approve switching to stage \"{stage}\" and archiving the conversation?"`.

The load-bearing formats below are deliberately **not** in prompts.json, because the fold and prompt-injection paths parse them:

- the stage-prompt body prefix `Current stage: <name>` (the narrator prefix *"The user switched this session to stage …"* IS editable copy);
- the `source.summary` notice shapes (`Current stage: <name>` / `Stage switched to <name>`);
- the `stage-review` question id.

Edit flow (run in this repo):

```sh
node scripts/sync-prompts.mjs                 # regenerate src/prompts.defaults.ts from src/prompts.json
npm run build                                # prebuild runs sync-prompts.mjs, then tsc compiles lib/
```

Edit `src/prompts.json` directly, then `npm run build` (the `prebuild` script regenerates `src/prompts.defaults.ts` automatically). `npm run test` also regenerates it via `pretest`. Then reinstall the package where it is deployed. Hand-editing `src/prompts.json` then running `node scripts/sync-prompts.mjs` works the same.

### Chinese review-dialog strings

The package ships a Chinese overlay for the `review.*` dialog strings (`src/prompts.zh.json`, 8 keys); all other user-facing copy (tool descriptions, notices, error messages, command texts) stays English.

**Prefer the deployment-declared route:** set `language: zh` on the plugin row — the service resolves the Chinese dictionary at construction, so the choice lives in the composition (the same patch that mounts the plugin), survives every reinstall, and needs no post-install script:

```yaml
- id: stage-switch
  name: '@ai4rpg/dsh-stage-switch'
  config:
    language: zh
    # ...stages, section, and the rest
```

**Use the file-level route (legacy) only when the composition cannot be edited:** merge the overlay into the installed copy instead:

```sh
node node_modules/@ai4rpg/dsh-stage-switch/scripts/apply-zh.mjs
```

This deep-merges the Chinese review strings over the installed `src/prompts.json`. The embedded fallback (`lib/prompts.defaults.js`) is unchanged — a stale install that loses the JSON still falls back to English. To revert the file-level merge: reinstall the package (`dsh plugin remove + add`), which restores the English `src/prompts.json`. **Re-run the script after every reinstall or upgrade** that resets the installed copy — or switch to the config route, which has no such step.

## Model and cache effects

- The system prompt never contains the current stage: stage prompts are conversation messages. A switch adds the new prompt at the conversation tail, so the reusable request prefix and the tool catalog stay stable. An unused detour's prompt is replaced, so the model does not see it.
- The initial stage prompt costs its instruction's tokens once per session; each switch costs the new instruction once as a conversation message. A prompt dropped this way leaves no lasting model-visible tokens, while the append-only log keeps the audit record.
- `/stage` and its result stay outside model history; a suffix is steered as an ordinary user message. Handoff arguments and review results extend the conversation normally.
- A subagent skips the initial stage prompt and does not switch stages.
- `stage:policy` is runtime context rather than a system-prompt section; it contributes only while an eligibility predicate is true.

## Known Limitations and Deferred Work

- A reviewed transition applied at the next accepted in-turn pre-step is lost if the process exits before one; the UI must reapply it.
- A light transition (below `minHandoffTokens`) does not archive the conversation, so a later full transition replaces a longer accumulated history.
- A rejected or dismissed review leaves the written handoff document in place; it is a visible draft the user may delete.
- The review is presented on the generic question flow. The DeepSeek Harness monorepo's `stage-review` presentation intent is not yet in a published `dsh-user-questions` release; when it lands, a future release of this package can attach it for specialized UIs.
- The stage instruction is guidance, not enforcement; the model may act outside it unless the deployment configures sandbox and approval controls.

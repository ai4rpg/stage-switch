# Agent Note: Stage-switch collaboration state

Status: implemented

> This design decision record was authored while developing the plugin in the DeepSeek Harness working tree and is kept here for provenance. It does not exist in the official deepseek-harness repository.

English | [中文](DESIGN.zh.md)

## Problem

Long-horizon work needs explicit stage boundaries: a planning stage, an implementation stage, a verification stage. Without a mechanism, the model drifts between tasks within one conversation, the user has no structured decision point, and the accumulated history of a finished stage costs context tokens for the rest of the work.

[Plan mode](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/plan/plan-mode/README.md) solves one transition (planning → execution) with a durable `plan/mode` state, a reviewed exit tool, and step-boundary application. A general stage switch needs the same skeleton — logged state, a stable transition tool, user review, boundary-applied switching — plus two things plan mode deliberately lacks: a *decoupled trigger* (who decides the current stage is done) and a *context reset* (the finished stage's history should stop costing tokens).

## Decision

### The package: `@ai4rpg/dsh-stage-switch`

The package is developed and published standalone against the npm `@deepseek-ai/dsh-*` packages: like plan mode, it is a logged per-agent collaboration state contributed through the session, prompt, tool, and interaction seams. The durable fact is the stage notice every entry appends — the stage prompt or handoff notice `user/message`, whose `source.summary` (`Current stage: <name>` / `Stage switched to <name>`) is folded by `foldStage(events)` with the configured `initial` stage as the empty-log value. `ctx.stage.current(session)` reads the state in force.

### Decoupled eligibility seam

`registerEligibility(predicate)` registers synchronous `(agent) => boolean` predicates; the `stage:policy` switch-guidance context contributes while ANY predicate returns true, and never contributes with none registered. Synchrony is a contract: the runtime-context snapshot assembles synchronously. Deployments needing asynchronous signals precompute a synchronous flag in their own code.

### Stage prompts are conversation messages, never a prompt section

The current stage never lives in the system prompt: a fresh session receives the initial stage prompt on its first accepted step, and every switch appends the new stage's prompt (`Current stage: <name>` plus the stage's `instruction`) as a conversation message — with a leading user-switch notice only for a user-driven switch whose last request header described the other stage. A subagent session skips the initial stage prompt: the parent already routed its task, and the initial stage (often `route`, whose instruction tells the model to call `goto_stage`) would deadlock the child, since `goto_stage`'s review has no user to answer in a subagent context. Switching therefore changes no request prefix and never invalidates the provider's cached prefix; the stage prompts are ordinary append-only conversation growth. This contrasts with plan mode, whose `plan:policy` is a prompt section: plan mode's boolean state flips are rare, while stage switches recur by design, so the recurring change belongs in the conversation tail. The `stage:policy` guidance is a runtime-context contribution rather than a prompt section; its template may reference `{{stage_current}}`/`{{stage_targets}}` because the runtime-context projection appends a snapshot only when the rendered text changes.

### The `goto_stage` tool and the reviewed transition

`goto_stage` stays registered in every stage, keeping the request tool catalog stable across switches. Its execute path validates the calling agent, the configured target, and the handoff (when required), writes the handoff document through `ctx.fs` before the review, and presents the transition over the user-questions seam as a generic question carrying the `stage-review` question id, with no presentation intent — the harness's `stage-review` intent is not yet in a published `dsh-user-questions` release, so the review renders the generic flow; attaching the intent for specialized UIs is deferred until it ships. Exactly one `Approve` selection with no custom text consents; every other answer is a failed call carrying feedback, and a dismissed review names the user's takeover. Approval records a silent pending transition applied at the next accepted in-turn pre-step, so the current tool batch keeps its stage context and the tool result narrates the switch.

### Full vs light transitions by token threshold

`minHandoffTokens` (optional) selects the transition shape from the `ctx.tokenMeter` surface measurement. At or above the threshold, a transition is **full**: handoff required, document written, history archived. Below it, a transition is **light**: handoff optional, nothing written, nothing archived — the switch only changes the stage, whose appended stage prompt tells the model what the next stage is for. A configured threshold requires the token-meter service in the composition and fails loud on a `goto_stage` call when it is missing.

The model never decides the shape: it cannot measure tokens, so a schema that said "required for a full transition" made it draft a handoff on every call — pure waste on light switches. The tool schema therefore carries only an index to the handoff guidance (`handoff` is optional and says to omit it unless the tool asks), and the plugin resolves the shape at call time. A full transition without a `handoff` is rejected with the handoff template to follow — the progressive-disclosure point, modeled on the compaction engine's checkpoint structure (fixed sections, terse bullets, "(none)" for empty, exact paths/commands/identifiers, user corrections) but forward-looking for the target stage, with a rule that the handoff includes only what the target stage needs and never restates the conversation or duplicates file-recorded content (exact paths are already guaranteed by the fidelity rule, so a reference to an existing document is its path) — and the model retries with the document; the handoff is then always written after seeing the template, while a light transition never requests one and silently ignores a handoff the model provided anyway. The rejection happens before the review, so the failed call has no user-visible side effect.

### The boundary flush archives the model-visible surface

The next accepted in-turn pre-step appends the new stage's prompt message (its notice summary is the committed record) and, in the full shape, first replaces the whole model-visible surface with one notice carrying the handoff pointer and the new stage prompt using `surfaceOp: { op: 'replace', start, end }` — the same surface replacement compaction checkpoints use. The append-only log retains the archived history for the human transcript; only the derived model history is shadowed, and the step's own user messages land after the notice. The replacement precedes the record append so a failed replacement leaves both the logged stage and the pending transition untouched — no half-applied switch is observable.

### The durable full-transition marker (`output.presentationMeta`)

The tool's canonical `value` is deliberately omitted from durable events (the `tool/result` event carries the rendered `content` and the tool-private `meta`, never the value), so a downstream phase machine cannot tell a full from a light transition from the event alone. The `goto_stage` output therefore projects a `presentationMeta` onto the durable `tool/result` event: an approved **full** transition (value carries `handoffPath`) stamps `meta: { fullTransition: true }`, while a **light** transition (no `handoffPath`) stamps the lossless JSON no-op `meta: null`, and a rejected or dismissed review never reaches the success path and carries no `meta` at all. A phase machine keys on `meta?.fullTransition === true` (never satisfied by `null` or an absent field) to demote the next request to a minimal catalog for one round — the notice-carrying request — without coupling to the rendered tool text or a separate event. `null` is the lossless no-op because `presentationMeta` runs on every successful top-level call and must return lossless JSON (`undefined` is not lossless); the consumer never reads the light marker.

### The `/stage` command mirrors plan mode's direct entry

When `ctx.commands` is composed, the package registers `/stage [stage|message]`. Bare `/stage` reads the current stage and the stage list without touching state. `/stage <name>` is a direct user switch: it validates the target, applies it immediately on an idle session or queues it for the next accepted in-turn pre-step during a turn (the same `pendingTransitions` boundary), and narrates the switch only when the last request header described a different stage. A suffix after the stage name is steered as an ordinary user message into the switched stage's context, mirroring `/plan <message>`. A manual switch is light by definition — the user owns the change, so no handoff document is written and no history is archived — which is why the command skips the review entirely instead of delegating to `goto_stage`.

### Prompt copy is one JSON source, formats stay in code

The package's own user-facing copy — the `goto_stage` tool description and parameter hints, the review dialog (question, labels, option descriptions), the tool-result and present-card texts, the boundary/handoff notices, the `/stage` command texts, and the failure messages — lives in `src/prompts.json`, the single editable source. `src/prompts.ts` reads it at module load and overlays it on embedded defaults (`src/prompts.defaults.ts`, regenerated from the JSON), so a stale install without the JSON keeps working with the exact strings the package always shipped. `{name}` placeholders interpolate through `formatPrompt`. Load-bearing formats stay in code because the fold and prompt-injection paths parse them: the stage-prompt body prefix (`Current stage: <name>`), the `source.summary` notice shapes (`Current stage: <name>` / `Stage switched to <name>`), and the `stage-review` question id. Copy is edited directly in `src/prompts.json`; the `prebuild`/`pretest` npm scripts run `scripts/sync-prompts.mjs` to regenerate the embedded defaults, so a hand edit to either without regenerating is caught by the package test that pins the loaded overlay to the embedded defaults. The behavioral tests never embed the copy: expectations are derived from the effective prompts (`stageSwitchPrompts` + `formatPrompt`), so a copy edit changes prompts only — the tests keep pinning the wiring, that the configured copy reaches the tool schema, review dialog, notices, and command outputs.

A Chinese review-dialog overlay ships as `src/prompts.zh.json` (the 8 `review.*` strings only). It is a second fact source the sync scripts do NOT regenerate: `scripts/apply-zh.mjs` deep-merges it over the installed `src/prompts.json` after install (run again after every reinstall/upgrade), leaving every other key in English. `src/prompts.zh.json` is inert at runtime — nothing reads it — until the merge writes it into the JSON the loader reads. This keeps the source tree English (the pin test above still holds) and confines the language switch to the installed copy, where it survives `file:`, npm, and GitHub-release installs alike.

### Boundary semantics shared with plan mode

A user `/stage` selection commits immediately on an idle session and flushes at the next accepted in-turn pre-step during a turn, mirroring plan mode's `set()`; a reviewed `goto_stage` transition always originates inside a turn and flushes the same way. A change selected after the turn's final accepted pre-step is process-local and lost if the process exits before another accepted in-turn pre-step — the same limitation plan mode records.

## Alternatives considered

**A generic named-mode registry.** Rejected by the same argument that simplified plan mode: there is one shipped collaboration state per package, and a second consumer would establish the shared seam from two concrete cases, not from speculation.

**Filtering tools per stage or enforcing stage boundaries in the loop.** Rejected: stage instructions are guidance. Sandbox mode and approval policy enforce restrictions independently, and neither reads or writes stage state.

**Forking a new session for the next stage.** Rejected: agents bind to their session at creation, so a mid-conversation switch would require core loop changes; surface replacement already removes the finished history from the model's view without changing identity.

**Storing the handoff only as a session event.** Rejected: the handoff must survive as a readable artifact the user and the model can open; a workspace file written through `ctx.fs` is that artifact.

**Review through the approval seam or prose.** Rejected with the same rationale as plan mode: a transition is not a permission decision, needs the exact handoff artifact and corrective free text, and must have a logged tool call as its structured transition.

## Verification

- Unit tests (hand-built `ctx.plugin(...)` suites) cover config validation, the stage fold (notice summaries and their precedence), the prompt-copy single-source pin, policy-context rendering and variables, eligibility registration and disposal, the `goto_stage` schema and validation chain, the durable full-transition marker, review answer rules and failure modes, presentation, the token-threshold decision, handoff path scoping and the sandbox-policy stamp, the archive shape, and the `stage:policy` cleanup on fiber dispose.
- A real Loader composition suite boots a test-only `cordis.yml` through `@deepseek-ai/cordis-plugin-loader` — mocking only the filesystem backend and the review answer — and pins the product-visible wiring: the three-registry contribution (service, tool, command), the once-only initial-stage prompt injection, the full `goto_stage` transition from handoff write through review and boundary flush to the durable `Stage switched to <stage>` notice, the `/stage` idle commit, and clean unload.
- The review arc and the surface replacement are package-tested with a real `Session` and an in-memory filesystem backend; the assembled-application transcript and a dedicated `stage-review` Web renderer are deferred work.

## Consequences

Stage switching stays soft guidance with a human-reviewed transition: the model proposes, the user consents, and the finished history stops costing tokens at the next boundary. Eligibility is a deployment-owned seam rather than a built-in policy. The implementation reuses plan mode's boundary machinery without sharing its state; the two packages remain independent plugins.

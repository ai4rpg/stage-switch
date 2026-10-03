/**
 * Stage switching is logged per-agent collaboration state: the current stage
 * is recorded durably on the stage-switch plugin message every stage entry
 * appends, each entry also appends the stage's instruction as a conversation
 * message (never a system-prompt section), and `goto_stage` presents a
 * transition for user review — writing a handoff
 * document and clearing the model-visible history on approval when the
 * conversation exceeds a token threshold, or switching without a handoff when
 * it does not.
 *
 * The state in force is maintained by the `stage` session-projection unit
 * (the last stage record wins — the unit applies the same per-event fold as
 * the exported {@link foldStage}), so reads advance over new events instead
 * of rescanning history, and resume and fork restore the state through the
 * framework's projection lifecycle. A reviewed transition remains pending
 * until the next accepted
 * in-turn pre-step: the step appends the stage prompt message and, in the
 * full-transition shape, replaces the whole model-visible surface with one
 * handoff notice before the step's own messages. The transition tool stays
 * registered in every stage, so switching appends only conversation messages,
 * never the request tool catalog.
 *
 * Eligibility is a decoupled seam: deployments register synchronous
 * predicates through {@link StageController.registerEligibility}, and the
 * switch guidance context contributes only while at least one predicate is
 * true. The per-stage instruction travels as a conversation message at every
 * stage entry, so the model always knows the current stage's task.
 *
 * @module @ai4rpg/dsh-stage-switch
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { z } from 'zod'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContextFormed, MessageSource } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent, SessionSeq, UserMessage } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type { TokenMeter } from '@deepseek-ai/dsh-token-meter'
import { UserQuestionError } from '@deepseek-ai/dsh-user-questions'
import type { UserQuestionService } from '@deepseek-ai/dsh-user-questions'
import { formatPrompt, resolveStageSwitchPrompts, type StageSwitchLanguage, type StageSwitchPrompts } from './prompts.ts'
// Type-only edge: resolves `ctx.commands` for the optional command child.
import type {} from '@deepseek-ai/dsh-commands'

declare module '@deepseek-ai/cordis' {
  interface Context {
    stage: StageController
  }
}

/**
 * Stage records are producer-owned user messages: their `kind` names this
 * plugin. The shared `{ kind: 'plugin', plugin }` wrapper is retired in
 * session format V4; both current and migrated kinds are declared because a
 * durable log can carry either. New writes use `stage-switch`; the V3→V4
 * session migration names this plugin's released records
 * `plugin:stage-switch` (the prefix it gives a producer it does not know), so
 * a resumed session still folds to its recorded stage. `ContextFormed` is the
 * shared form mixin — stage records are `notice`s carrying a summary.
 */
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'stage-switch': { kind: 'stage-switch' } & ContextFormed
    'plugin:stage-switch': { kind: 'plugin:stage-switch' } & ContextFormed
  }
}

/**
 * The `stage` projection key this package owns on the session-projection
 * seam: a host-only unit with no client wire view. The sidebar client
 * package folds the durable records itself by design (zero RPC, and it must
 * keep working on sessions whose composition never mounted this plugin), so
 * nothing here publishes a wire value.
 */
declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    stage: StageProjectionState
  }
}

/** The model-facing transition tool's name. It stays registered in every stage. */
export const GOTO_STAGE = 'goto_stage'

/** One configured stage: a name plus the instruction the model sees while in it. */
export interface StageDefinition {
  /** Stage name; must match `[a-z][a-z0-9_-]*` so handoff file names stay safe. */
  name: string
  /** The stage's task instruction, appended as the stage-prompt body at every stage entry. */
  instruction: string
}

/** Deployment-owned stage-switch configuration. */
export interface StageConfig {
  /** The ordered stage definitions. Non-empty; names unique. */
  stages: StageDefinition[]
  /**
   * Switch-guidance template contributed as the `stage:policy`
   * runtime-context entry while at least one eligibility predicate is true.
   * May reference `{{stage_current}}` and `{{stage_targets}}`; the entry
   * re-renders each request, but the runtime-context projection appends a
   * snapshot only when its text changes.
   */
  section: string
  /**
   * Directory (relative to the session cwd) for handoff documents. Defaults
   * to `handoff`. Each document lands in a per-session subdirectory —
   * `<handoffDir>/<session id>/<stage>.md` — so sessions sharing one
   * workspace never overwrite each other's handoffs.
   */
  handoffDir?: string
  /** The stage a fresh session starts in. Defaults to the first stage. */
  initial?: string
  /**
   * Minimum heuristic surface tokens for a full transition. Below it a
   * `goto_stage` call switches without a handoff document and without
   * clearing the conversation. Omit to always require the full transition.
   */
  minHandoffTokens?: number
  /**
   * The language the user-facing copy renders in: `en` (default, the source
   * tree's language) or `zh` (the Chinese review-dialog overlay). Declared by
   * the deployment in the composition — the same patch that mounts this
   * plugin — so the choice survives reinstalls and needs no post-install
   * script (the file-level `scripts/apply-zh.mjs` merge remains available).
   */
  language?: StageSwitchLanguage
}

/** The review question's id, echoed in the answer this tool reads. */
const REVIEW_ID = 'stage-review'

/**
 * The user-facing copy (goto_stage tool description, review dialog, notices,
 * /stage texts) lives in `src/prompts.json` — the single editable source —
 * overlaid on the embedded defaults by `./prompts.ts`. Only load-bearing
 * formats stay in code: the stage-prompt body (`Current stage: <name>`), the
 * `source.summary` shapes {@link stageFromEvent} folds, and this review id.
 */

/** Stage names must be safe as handoff file names. */
const STAGE_NAME = /^[a-z][a-z0-9_-]*$/u

/**
 * One filesystem-safe directory segment naming the handoff's session, so
 * sessions sharing a workspace never overwrite each other's documents.
 * Harness-minted session ids are already slug-shaped; the sanitization
 * guards deployments that mint arbitrary ids (a result of `''`, `.`, or
 * `..` would otherwise hollow out or escape the handoff directory).
 */
function sessionSegment(id: string): string {
  const sanitized = id.replace(/[^a-zA-Z0-9._-]/gu, '-')
  return sanitized === '' || sanitized === '.' || sanitized === '..' ? 'session' : sanitized
}

/** A pending stage change awaiting the next accepted in-turn pre-step. */
interface PendingTransition {
  /** Target stage. */
  stage: string
  /** Written handoff document path; `undefined` for a handoff-free switch. */
  handoffPath: string | undefined
  /**
   * Whether the step should narrate the switch to the model: true for a user
   * `/stage` selection, false for an approved `goto_stage` call whose result
   * already narrates the transition.
   */
  narrate: boolean
}

/**
 * Validate deployment-owned stage configuration. Empty, malformed, or
 * unknown fields fail at plugin load rather than being ignored.
 *
 * @param config Raw plugin config.
 * @returns A detached validated config.
 */
export function resolveConfig(config: StageConfig): StageConfig {
  const stages = (config as Partial<StageConfig>).stages
  if (!Array.isArray(stages) || stages.length === 0) {
    throw new Error('StageConfig needs a non-empty `stages` array')
  }
  const names = new Set<string>()
  const validatedStages: StageDefinition[] = []
  for (const definition of stages) {
    const { name, instruction } = definition as Partial<StageDefinition>
    if (typeof name !== 'string' || !STAGE_NAME.test(name)) {
      throw new Error(`StageConfig stage name must match ${String(STAGE_NAME)}, got ${JSON.stringify(name)}`)
    }
    if (names.has(name)) {
      throw new Error(`StageConfig has duplicate stage "${name}"`)
    }
    names.add(name)
    if (typeof instruction !== 'string' || instruction.trim() === '') {
      throw new Error(`StageConfig stage "${name}" needs a non-empty string \`instruction\``)
    }
    validatedStages.push({ name, instruction })
  }
  const section = (config as Partial<StageConfig>).section
  if (typeof section !== 'string' || section.trim() === '') {
    throw new Error('StageConfig needs a non-empty string `section`')
  }
  const handoffDir = (config as Partial<StageConfig>).handoffDir
  if (handoffDir !== undefined && (typeof handoffDir !== 'string' || handoffDir.trim() === '')) {
    throw new Error('StageConfig `handoffDir` must be a non-empty string when supplied')
  }
  const initial = (config as Partial<StageConfig>).initial
  if (initial !== undefined && !names.has(initial)) {
    throw new Error(`StageConfig \`initial\` must name a configured stage, got "${initial}"`)
  }
  const minHandoffTokens = (config as Partial<StageConfig>).minHandoffTokens
  if (minHandoffTokens !== undefined
    && (!Number.isFinite(minHandoffTokens) || minHandoffTokens < 0)) {
    throw new Error('StageConfig `minHandoffTokens` must be a non-negative finite number when supplied')
  }
  const language = (config as Partial<StageConfig>).language
  if (language !== undefined && language !== 'en' && language !== 'zh') {
    throw new Error(`StageConfig \`language\` must be "en" or "zh", got ${JSON.stringify(language)}`)
  }
  const unknown = Object.keys(config).filter(key => ![
    'stages', 'section', 'handoffDir', 'initial', 'minHandoffTokens', 'language',
  ].includes(key))
  if (unknown.length > 0) {
    throw new Error(`StageConfig has unknown key(s) ${unknown.join(', ')}`)
  }
  return {
    stages: validatedStages,
    section,
    ...handoffDir === undefined ? {} : { handoffDir },
    ...initial === undefined ? {} : { initial },
    ...minHandoffTokens === undefined ? {} : { minHandoffTokens },
    ...language === undefined ? {} : { language },
  }
}

/**
 * Whether a stage has been selected after the first `end` events. The last
 * stage record wins (see {@link stageFromEvent}); a prefix with none has no
 * selected stage (the service folds to the configured initial stage).
 *
 * @param events The session log or any prefix of it.
 * @param end Fold `events[0, end)`; defaults to the whole log.
 * @returns The stage in force, or `undefined` before the first selection.
 */
export function foldStage(events: readonly SessionEvent[], end = events.length): string | undefined {
  let stage: string | undefined
  let index = 0
  for (const event of events) {
    if (index >= end) break
    index++
    stage = stageFromEvent(event) ?? stage
  }
  return stage
}

/** Summary shapes the two stage-switch message producers stamp; the captured
 * name matches the `StageDefinition` name grammar, so a hand-edited or foreign
 * summary cannot smuggle in a bogus stage. Exported with the source kinds as
 * the fold contract shared with the sidebar client package. */
export const STAGE_SUMMARY = /^(?:Current stage: |Stage switched to )([a-z][a-z0-9_-]*)$/

/**
 * Producer kinds a stage record can carry. `stage-switch` is what every new
 * write uses; `plugin:stage-switch` is what the V3→V4 session migration makes
 * of this plugin's released records, so a resumed old session still folds to
 * its recorded stage (see the module augmentation above). Exported as the
 * cross-package fold contract: the sidebar client package pins its browser
 * copy against this source of truth.
 */
export const STAGE_SOURCE_KINDS: ReadonlySet<string> = new Set(['stage-switch', 'plugin:stage-switch'])

/** The `notice` summary a stage record carries, or undefined for any other message. */
function stageSummaryOf(source: MessageSource): string | undefined {
  if (!STAGE_SOURCE_KINDS.has(source.kind)) return undefined
  const formed = source as { form?: string; summary?: unknown }
  if (formed.form !== 'notice' || typeof formed.summary !== 'string') return undefined
  return formed.summary
}

/**
 * The stage one log entry records, or `undefined` when it records none.
 *
 * The stage record is the plugin message that EVERY stage entry appends —
 * the stage prompt (`Current stage: <name>`) or the handoff notice
 * (`Stage switched to <name>`) — both plain `user/message` events the stock
 * harness catalog already knows, so a reader without this plugin loads the
 * log without complaint.
 */
function stageFromEvent(event: SessionEvent): string | undefined {
  if (event.type !== 'user/message') return undefined
  const summary = stageSummaryOf(event.data.source)
  if (summary === undefined) return undefined
  return STAGE_SUMMARY.exec(summary)?.[1]
}

/** Plain-JSON checkpoint schema for the `stage` projection unit. */
const stageProjectionStateSchema = z.object({
  stage: z.string().nullable(),
  stageAtLastHeader: z.string().nullable(),
  openTurn: z.boolean(),
  hasStagePrompt: z.boolean(),
  headSeq: z.number().int().nonnegative().nullable(),
  headIsSystem: z.boolean(),
}).strict()

/** Whether one event is a stage prompt message (any stage entry). */
function isStagePromptEvent(event: SessionEvent): boolean {
  if (event.type !== 'user/message') return false
  if (!STAGE_SOURCE_KINDS.has(event.data.source.kind)) return false
  return event.data.content
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
    .map(block => block.text)
    .join('')
    .includes('Current stage:')
}

/**
 * Surface node 0 after one committed event. An append fills only an empty
 * surface; a replacement shadows the head exactly when its declared range
 * starts there (the harness locates ranges by node position, so
 * `startSeq === headSeq` is precisely "the range covers node 0"); every other
 * event leaves the head's position alone. Once node 0 is a `system/message`
 * it stays one — the harness permits rewriting it only with another
 * `system/message` over exactly that node.
 */
function surfaceHeadAfter(
  state: StageProjectionState,
  event: SessionEvent,
): { headSeq: number | null; headIsSystem: boolean } {
  const op = event.surfaceOp
  if (op === undefined) return { headSeq: state.headSeq, headIsSystem: state.headIsSystem }
  const becomesHead = op === 'append'
    ? state.headSeq === null
    : op.startSeq === state.headSeq
  if (!becomesHead) return { headSeq: state.headSeq, headIsSystem: state.headIsSystem }
  return { headSeq: event.seq, headIsSystem: event.type === 'system/message' }
}

/**
 * The `stage` projection unit: the pure fold the framework drives eagerly
 * over committed events. It applies the same per-event record logic as the
 * exported {@link foldStage} (plus the header watermark, the open-turn flag,
 * the stage-prompt flag, and the surface head), so the unit and the exported
 * fold cannot disagree on what a record means. An event that changes
 * nothing returns the same state reference — the unit contract that keeps
 * downstream work at zero.
 */
const stageProjectionDefinition: ProjectionDefinition<'stage'> = {
  key: 'stage',
  stateVersion: 1,
  stateSchema: stageProjectionStateSchema,
  init: () => ({
    stage: null,
    stageAtLastHeader: null,
    openTurn: false,
    hasStagePrompt: false,
    headSeq: null,
    headIsSystem: false,
  }),
  apply: (state, event) => {
    const stage = stageFromEvent(event) ?? state.stage
    const stageAtLastHeader = event.type === 'request/header' ? stage : state.stageAtLastHeader
    const openTurn = event.type === 'turn/start' ? true : event.type === 'turn/end' ? false : state.openTurn
    const hasStagePrompt = state.hasStagePrompt || isStagePromptEvent(event)
    const head = surfaceHeadAfter(state, event)
    if (stage === state.stage && stageAtLastHeader === state.stageAtLastHeader
      && openTurn === state.openTurn && hasStagePrompt === state.hasStagePrompt
      && head.headSeq === state.headSeq && head.headIsSystem === state.headIsSystem) return state
    return { stage, stageAtLastHeader, openTurn, hasStagePrompt, ...head }
  },
}

/**
 * Whether the session is a subagent child (origin 'subagent' or a positive
 * delegation depth). A subagent is a fresh log the parent dispatched a task
 * into; its stage is already routed by the parent (the parent's stage at
 * dispatch time owns the task). The initial stage prompt injected into a
 * fresh session is the configured `initial` stage, whose instruction is the
 * route stage's "classify the request and call goto_stage to jump to the
 * stage that owns it" for deployments that start from route. A subagent that
 * follows that instruction calls `goto_stage`, whose review dialog has no
 * user to answer in the child session, so the call aborts and the subagent
 * deadlocks. Subagent sessions therefore skip the initial route injection
 * entirely — the subagent already knows its task from its prompt and its
 * skill's workflow, not from a stage prompt.
 */
function isSubagentSession(session: Session): boolean {
  const header = session.header
  return header.origin === 'subagent' || (header.delegationDepth ?? 0) > 0
}

/**
 * The session's standing sandbox policy, for mutations this plugin makes
 * through `ctx.fs` — the same per-call resolution the tool layers perform. A
 * confining backend (`dsh-fs-sandbox`) fences by the CALL's policy: without
 * one it falls back to the deployment's process-cwd workspace root and
 * denies a handoff write that lands inside the session's own workspace.
 * Returns undefined when no sandbox-policy service is composed (unsandboxed
 * backends ignore the argument).
 */
function sessionSandboxPolicy(ctx: Context, session: Session): SandboxExecutionPolicy | undefined {
  // The optional service is read through cordis's dynamic accessor: the
  // sandbox-policy plugin is not a dependency of this package, so the
  // composition decides whether it is present (unsandboxed backends ignore
  // the argument). The type-only import above types the lookup.
  return ctx.get('sandboxPolicy')?.resolve({ session })
}

/**
 * Everything the service reads off the session log, maintained as one
 * session-projection unit so no read scans history. The harness deprecated
 * the synchronous whole-log readers (`Session.snapshotEvents()` and friends)
 * because the storage direction stops retaining the complete event sequence
 * in memory, and the projection seam is the sanctioned replacement: the
 * framework drives `apply` over committed events and checkpoints the state
 * (the base bundle's projection cache), so reads cost O(new events) and a
 * resumed session refolds at most a tail. All fields are plain JSON — the
 * persisted-cache precondition.
 */
interface StageProjectionState {
  /** The stage in force (the last stage record), or `null` before the first. */
  stage: string | null
  /** The stage in force at the last `request/header`, or `null` before the first header. */
  stageAtLastHeader: string | null
  /** Whether the log holds an opened turn without its closing `turn/end`. */
  openTurn: boolean
  /** Whether the log already carries a stage prompt message (any stage entry). */
  hasStagePrompt: boolean
  /** Seq of surface node 0, or `null` while the surface is empty. */
  headSeq: number | null
  /** Whether surface node 0 is a `system/message` — the protected head. */
  headIsSystem: boolean
}

/**
 * `ctx.stage`: owns the logged stage state, the per-stage prompt messages
 * and eligibility guidance context, the eligibility seam, and the stable
 * `goto_stage` tool. Reviewed transitions flush at the next accepted
 * in-turn pre-step; UIs observe committed switches through `session/event`.
 * The `stage` projection unit is the framework-owned read state; the log
 * stays the durable record.
 */
export class StageController extends Service {
  static inject = ['tools', 'systemPrompt', 'sessionProjections']

  /** Validated stage definitions indexed by name. */
  private readonly stages: readonly StageDefinition[]
  private readonly instructionByStage: ReadonlyMap<string, string>
  /** Stage a fresh session folds to before the first stage record. */
  private readonly initial: string
  /** The switch-guidance template rendered while a predicate is true. */
  private readonly section: string
  private readonly handoffDir: string
  private readonly minHandoffTokens: number | undefined
  /** The user-facing copy this instance renders, resolved from its `language` config. */
  private readonly prompts: StageSwitchPrompts

  /** Registered synchronous eligibility predicates; ANY true enables switching. */
  private readonly eligibility = new Set<(agent: Agent) => boolean>()
  /** Reviewed transitions awaiting the next accepted in-turn pre-step. */
  private readonly pendingTransitions = new WeakMap<Session, PendingTransition>()

  constructor(ctx: Context, config: StageConfig) {
    super(ctx, 'stage')
    const resolved = resolveConfig(config)
    this.stages = Object.freeze([...resolved.stages])
    this.instructionByStage = new Map(resolved.stages.map(definition => [definition.name, definition.instruction]))
    const firstStage = resolved.stages[0]
    if (firstStage === undefined) {
      // resolveConfig rejects an empty stages list, so this guards only a
      // future refactor that bypasses it.
      throw new Error('unreachable: StageConfig needs at least one stage')
    }
    this.initial = resolved.initial ?? firstStage.name
    this.section = resolved.section
    this.handoffDir = resolved.handoffDir ?? 'handoff'
    this.minHandoffTokens = resolved.minHandoffTokens
    this.prompts = resolveStageSwitchPrompts(resolved.language ?? 'en')
    // The read state: one host-only projection unit the framework drives
    // eagerly over committed events (see {@link StageProjectionState}).
    // Registration is effect-scoped on this service's fiber, so an HMR
    // disposal removes the key; {@link projectionOf} makes an absent key a
    // loud failure, never a silent default.
    ctx.sessionProjections.register(stageProjectionDefinition)
    let disposed = false
    // Pre-step is outside Session.append publication, so it can append the
    // stage prompt message inside an open turn without re-entering the
    // session. A failed append remains pending for a later accepted in-turn
    // pre-step, and policy cannot block the step. The system prompt never
    // carries the current stage — the stage prompt is appended to the
    // conversation at each entry, so switching changes no request prefix.
    ctx.on('agent/pre-step', async (
      { agent, signal },
      next,
    ): Promise<PreStepDecision> => {
      const decision = await next()
      if (decision.kind === 'reject' || signal.aborted) return decision
      const session = agent.session
      const pending = this.pendingTransitions.get(session)
      if (pending !== undefined) {
        try {
          this.onBoundary(session, pending)
        } catch (error) {
          // ERROR level: the plugin logger is not part of the session
          // transcript, so a silent failure keeps the stage stuck with no
          // trace anywhere a user can see it. The pending transition stays
          // queued, so the next accepted pre-step retries the boundary.
          ctx.logger.error('dsh-stage-switch: failed to apply stage transition at step start: %o', error)
          return decision
        }
        return decision
      }
      // A fresh session has no stage prompt yet: the initial stage's prompt
      // rides the first accepted step so the model knows its stage from the
      // very first request without a live prompt section. A subagent session
      // skips this: the parent already routed its task, so the initial route
      // instruction ("classify the request and call goto_stage") is at best
      // redundant and at worst deadlocks the child when its goto_stage review
      // has no user to answer. See isSubagentSession above.
      if (!this.projectionOf(session).hasStagePrompt && !isSubagentSession(session)) {
        return { ...decision, messages: [...decision.messages, this.stagePromptMessage(this.initial, false)] }
      }
      return decision
    })
    ctx.effect(() => () => { disposed = true }, 'dsh-stage-switch: close service lifetime')

    // The switch guidance contributes to the runtime-context snapshot only
    // while a deployment predicate is true. As a context rather than a prompt
    // section, it lands after retained history; the projection appends a
    // snapshot only when its rendered text changes, so an eligibility flip or
    // a stage switch that changes the guidance appends one message and never
    // breaks the cached system-prompt prefix.
    ctx.systemPrompt.context({
      name: 'stage:policy',
      order: 116,
      text: (context) => {
        if (context.agent === undefined) return ''
        return this.isEligible(context.agent) ? this.section : ''
      },
    })

    ctx.systemPrompt.variable('stage_current', context =>
      context.agent === undefined ? undefined : this.current(context.agent.session))
    ctx.systemPrompt.variable('stage_targets', (context) => {
      if (context.agent === undefined) return undefined
      const current = this.current(context.agent.session)
      return this.stages
        .map(definition => definition.name)
        .filter(name => name !== current)
        .join(', ')
    })

    ctx.tools.register(defineTool({
      name: GOTO_STAGE,
      description: this.prompts.gotoTool.description,
      parameters: {
        stage: { type: 'string', required: true, description: this.prompts.gotoTool.stageParam },
        handoff: {
          type: 'string',
          description: this.prompts.gotoTool.handoffParam,
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            approved: { type: 'boolean', const: true, required: true },
            stage: { type: 'string', required: true },
            handoffPath: { type: 'string' },
          },
        },
        render: (_args, value) => [{
          type: 'text',
          text: formatPrompt(this.prompts.toolResult.approved, { stage: value.stage })
            + (value.handoffPath === undefined
              ? ''
              : formatPrompt(this.prompts.toolResult.handoffPath, { path: value.handoffPath })),
        }],
        // A durable, model-invisible marker that a full transition was
        // approved and applied. `meta` rides the tool/result event (the
        // canonical value is deliberately omitted from durable events, so the
        // shape — value.handoffPath present vs absent — is the only signal a
        // full vs light transition leaves behind). A deployment phase machine
        // may read it to demote the next request to a minimal bootstrap
        // catalog for one round — the notice-carrying request — then a first
        // reply in the new stage re-promotes. Nothing in this package reads
        // it, but the key stays: it is part of the durable tool/result shape,
        // and dropping it would break an external reader for no benefit.
        // Light transitions, rejected reviews, and dismissed reviews take
        // other paths (no handoffPath, or the tool errors), so they carry no
        // `fullTransition` signal. `null` is the lossless no-op for the light
        // path: the value must be JSON-serializable (the tool/result event
        // validates every field), so a `return undefined` would throw at
        // projection time. The consumer keys on
        // `meta?.fullTransition === true`, which `null` never satisfies.
        presentationMeta: (_args, value) =>
          typeof value === 'object' && value !== null && 'handoffPath' in value
            ? { fullTransition: true }
            : null,
      },
      execute: async (args, exec) => {
        const agent = exec.agent
        if (agent === undefined) {
          throw new Error(`${GOTO_STAGE} requires a calling agent (no session to switch)`)
        }
        const current = this.current(agent.session)
        if (!this.instructionByStage.has(args.stage)) {
          throw new Error(formatPrompt(this.prompts.errors.notConfigured,
            { stage: args.stage, stages: this.stageNames }))
        }
        if (args.stage === current) {
          throw new Error(formatPrompt(this.prompts.errors.alreadyCurrent, { stage: args.stage }))
        }
        const interaction: UserQuestionService | undefined = this.ctx.get('userQuestions')
        if (interaction === undefined) {
          throw new Error(this.prompts.errors.noUserQuestions)
        }
        const full = this.requiresHandoff(agent.session)
        let handoff: string | undefined
        let handoffPath: string | undefined
        if (full) {
          if (typeof args.handoff !== 'string' || args.handoff.trim() === '') {
            throw new Error(this.prompts.errors.requiresHandoff)
          }
          handoff = args.handoff
          handoffPath = await this.writeHandoff(agent, args.stage, handoff, exec.signal)
        }
        const questions = full && handoff !== undefined
          ? [{
            id: REVIEW_ID,
            header: this.prompts.review.header,
            question: formatPrompt(this.prompts.review.fullQuestion, { stage: args.stage }),
            detail: handoff,
            options: [
              { label: this.prompts.review.approveLabel, description: this.prompts.review.fullApproveDescription },
              { label: this.prompts.review.keepStageLabel, description: this.prompts.review.keepStageDescription },
            ],
            // The `stage-review` presentation intent from the DeepSeek Harness
            // monorepo is not yet in a published dsh-user-questions release;
            // every current UI renders the generic flow for it anyway, so the
            // review is presented without an intent and behaves identically.
          }]
          : [{
            id: REVIEW_ID,
            header: this.prompts.review.header,
            question: formatPrompt(this.prompts.review.lightQuestion, { stage: args.stage }),
            options: [
              { label: this.prompts.review.approveLabel, description: this.prompts.review.lightApproveDescription },
              { label: this.prompts.review.keepStageLabel, description: this.prompts.review.keepStageDescription },
            ],
          }]
        const answer = await interaction.ask({
          questions,
          agent,
          signal: exec.signal,
        }).catch((cause: unknown) => {
          // A dismissed review is not a failed one: the user took the turn
          // back to say something the two options do not cover. Say so,
          // because the generic channel message names ask_user_question,
          // which the model never called. An abort (turn cancel, provider
          // teardown) keeps its own message — there is no user to wait for.
          if (cause instanceof UserQuestionError && cause.code === 'ASK_CANCELLED') {
            throw new Error(this.prompts.errors.dismissed)
          }
          throw cause
        })
        // A review may outlive this plugin fiber. Without its pre-step listener,
        // an approved transition could never be applied, so fail and stay put.
        if (disposed) {
          throw new Error('the stage-switch service was reloaded while the transition was under review; present the transition again')
        }
        const reviewItems = answer.answers.filter(entry => entry.id === REVIEW_ID)
        const item = reviewItems.length === 1 ? reviewItems[0] : undefined
        if (item?.selected.length !== 1 || item.selected[0] !== this.prompts.review.approveLabel || item.custom !== undefined) {
          const feedback = item?.custom ?? ''
          throw new Error(feedback === ''
            ? this.prompts.errors.keepPlanning
            : formatPrompt(this.prompts.errors.keepPlanningFeedback, { feedback }))
        }
        // Keep the current stage for the rest of this assistant tool batch. The
        // transition is applied at the next accepted in-turn pre-step, before
        // its request assembly. The tool result narrates the switch, so the
        // flush adds no second notice.
        this.pendingTransitions.set(agent.session, { stage: args.stage, handoffPath, narrate: false })
        return {
          approved: true,
          stage: args.stage,
          ...handoffPath === undefined ? {} : { handoffPath },
        }
      },
      presentCall: args => ({
        card: 'generic',
        title: formatPrompt(this.prompts.present.callTitle, { stage: args.stage }),
        kind: 'other',
        content: [{ type: 'text', text: args.handoff ?? formatPrompt(this.prompts.present.lightCallContent, { stage: args.stage }) }],
      }),
      presentResult: (_args, result) => ({
        card: 'generic',
        title: this.prompts.present.resultTitle,
        content: result.content,
      }),
    }))

    // The command child activates only when a command registry is composed.
    ctx.inject(['commands'], (commandCtx) => {
      commandCtx.commands.register({
        name: 'stage',
        description: this.prompts.command.description,
        input: { hint: '[stage|message]' },
        handler: ({ agent, rawInput }) => {
          const message = rawInput.trim()
          if (message === '') {
            return {
              kind: 'success',
              text: formatPrompt(this.prompts.command.current,
                { stage: this.current(agent.session), stages: this.stageNames }),
            }
          }
          const [target, ...rest] = message.split(/\s+/)
          if (target === undefined || !this.instructionByStage.has(target)) {
            return {
              kind: 'error',
              text: formatPrompt(this.prompts.command.unknown,
                { target: target ?? '', stages: this.stageNames }),
            }
          }
          const trailing = rest.join(' ').trim()
          const outcome = this.set(agent, target)
          if (trailing !== '') {
            agent.steer(createUserMessage({
              content: [{ type: 'text', text: trailing }],
              source: { kind: 'user' },
            }))
          }
          const alreadyCurrent = outcome === 'noop'
          return {
            kind: 'success',
            text: alreadyCurrent
              ? formatPrompt(this.prompts.command.alreadyCurrent, { target })
              : outcome === 'committed'
                ? formatPrompt(this.prompts.command.switched, { target })
                : formatPrompt(this.prompts.command.queued, { target }),
          }
        },
      })
    })
  }

  /** The configured stage names, sorted for stable diagnostics. */
  private get stageNames(): string {
    return [...this.instructionByStage.keys()].sort().join(', ')
  }

  /**
   * The session's `stage` projection state. The unit is registered for the
   * service's whole lifetime, so an absent key means the registry lost the
   * registration (a reload race): the projection seam's mandatory-reader
   * rule — fail loud, never degrade to a default.
   */
  private projectionOf(session: Session): StageProjectionState {
    const state = this.ctx.sessionProjections.stateOf(session, 'stage')
    if (state === undefined) {
      throw new Error('dsh-stage-switch: the stage projection unit is not registered')
    }
    return state
  }

  /**
   * Register one transition-eligibility predicate. The switch-guidance context
   * contributes while ANY registered predicate returns true for the
   * assembly's agent; with none registered it never contributes. Predicates
   * must be synchronous because the runtime-context snapshot assembles
   * synchronously; deployments needing asynchronous signals precompute a
   * synchronous flag.
   *
   * @param predicate - true when the current stage may be switched.
   * @returns the effect disposer that unregisters the predicate.
   */
  registerEligibility(predicate: (agent: Agent) => boolean): () => void {
    if (typeof predicate !== 'function') {
      throw new TypeError('stage eligibility predicate must be a function')
    }
    this.eligibility.add(predicate)
    // The registry is effect-scoped: plugin disposal removes the predicate
    // even when the caller never runs the returned disposer.
    this.ctx.effect(() => () => { this.eligibility.delete(predicate) }, 'stage.registerEligibility()')
    return () => { this.eligibility.delete(predicate) }
  }

  /**
   * Read the logged stage, folding to the configured initial stage before the
   * first stage record.
   *
   * @param session The session to read.
   * @returns The stage in force.
   */
  current(session: Session): string {
    return this.projectionOf(session).stage ?? this.initial
  }

  /**
   * Select the stage for a user `/stage` command. Between turns the change
   * appends immediately because no in-turn pre-step will run until another
   * prompt starts a turn. During an open turn the selection remains pending
   * until the next accepted in-turn pre-step. Selecting the current stage is a
   * no-op.
   *
   * @param agent The agent to switch.
   * @param stage The target stage.
   * @returns what happened: `committed` (logged now), `queued` (awaiting the
   * next accepted in-turn pre-step), or `noop` (already in that stage).
   */
  set(agent: Agent, stage: string): 'committed' | 'queued' | 'noop' {
    const session = agent.session
    if (stage === this.current(session)) return 'noop'
    if (this.projectionOf(session).openTurn) {
      this.pendingTransitions.set(session, { stage, handoffPath: undefined, narrate: true })
      return 'queued'
    }
    // No open turn: commit now. The stage prompt message IS the committed
    // record (foldStage reads its notice summary), so the pending selection
    // is deleted only after the durable append succeeds — a failed write
    // leaves it retryable, not dropped. No separate log-only event is
    // written: an event type outside the stock harness's known-event catalog
    // would make a reader without this plugin refuse the whole log.
    this.pendingTransitions.delete(session)
    const narrate = this.shouldNarrate(session, stage)
    session.append('user/message', this.stagePromptMessage(stage, narrate), { surfaceOp: 'append' })
    return 'committed'
  }

  /** Whether a user-driven switch should narrate because the last header described the other stage. */
  private shouldNarrate(session: Session, stage: string): boolean {
    // Before the first stage record the model was told the initial stage, so
    // the header-stage fold falls back to it.
    return (this.projectionOf(session).stageAtLastHeader ?? this.initial) !== stage
  }

  /**
   * Build the stage prompt message appended at every stage entry: the initial
   * stage on a fresh session, and the new stage at every switch. The prompt
   * lives in the conversation history, never in the system prompt, so stage
   * switching changes no request prefix.
   *
   * @param stage The entered stage.
   * @param narrate Prepend a user-switch notice when the last header described the other stage.
   * @returns The stage prompt message.
   */
  private stagePromptMessage(stage: string, narrate: boolean): UserMessage {
    const body = this.stagePromptText(stage)
    const text = narrate ? formatPrompt(this.prompts.notice.userSwitchPrefix, { stage }) + body : body
    return createUserMessage({
      content: [{ type: 'text', text }],
      // The summary is the short account a UI can show on a collapsed row.
      source: { kind: 'stage-switch', form: 'notice', summary: `Current stage: ${stage}` },
    })
  }

  /** Whether any registered predicate allows a transition for this agent. */
  private isEligible(agent: Agent): boolean {
    for (const predicate of this.eligibility) {
      if (predicate(agent)) return true
    }
    return false
  }

  /**
   * Whether this conversation needs the full transition (handoff document and
   * history archive). Without a configured threshold every transition is full;
   * with one, the surface token measurement decides.
   *
   * @param session The session to measure.
   * @returns true for a full transition.
   */
  private requiresHandoff(session: Session): boolean {
    if (this.minHandoffTokens === undefined) return true
    const meter: TokenMeter | undefined = this.ctx.get('tokenMeter')
    if (meter === undefined) {
      throw new Error(this.prompts.errors.missingTokenMeter)
    }
    return meter.measure(session).surfaceTokens >= this.minHandoffTokens
  }

  /**
   * Write the handoff document under the session cwd and return its process
   * path, so the notice and the tool result name a file the model can open.
   * The per-session subdirectory (`<handoffDir>/<session id>/<stage>.md`)
   * keeps sessions sharing one workspace from overwriting each other.
   *
   * @param agent The calling agent whose session id and cwd anchor the document.
   * @param stage The target stage naming the file.
   * @param handoff The full document text.
   * @param signal Cancellation signal.
   * @returns The written document's absolute path.
   */
  private async writeHandoff(
    agent: Agent,
    stage: string,
    handoff: string,
    signal: AbortSignal,
  ): Promise<string> {
    const fs: FileSystem | undefined = this.ctx.get('fs')
    if (fs === undefined) {
      throw new Error(this.prompts.errors.noFs)
    }
    const cwd = agent.session.header.cwd
    const relative = `${this.handoffDir}/${sessionSegment(agent.session.id)}/${stage}.md`
    const target = await fs.resolve(relative, { ...cwd === undefined ? {} : { cwd }, signal })
    await fs.writeText(target, handoff, undefined, signal, sessionSandboxPolicy(this.ctx, agent.session))
    return fs.processPath(target)
  }

  /** Apply one reviewed transition at the accepted in-turn boundary. */
  private onBoundary(session: Session, pending: PendingTransition): void {
    // The full shape replaces the model-visible surface first: a failed
    // replacement leaves the logged stage untouched and the transition
    // pending, so no half-applied switch is observable. Either shape's
    // message carries the stage notice summary foldStage reads — that
    // message is the committed record; no separate log-only event exists
    // (see set()).
    if (pending.handoffPath !== undefined) {
      this.replaceWithHandoffNotice(session, pending.stage, pending.handoffPath)
    } else {
      const narrate = pending.narrate && this.shouldNarrate(session, pending.stage)
      session.append('user/message', this.stagePromptMessage(pending.stage, narrate), { surfaceOp: 'append' })
    }
    // Delete only after the message append succeeds so a later accepted
    // in-turn pre-step can retry a failed durable write.
    this.pendingTransitions.delete(session)
  }

  /**
   * Replace every current surface node with one notice carrying the handoff
   * pointer and the new stage prompt, so the model sees the archived
   * conversation as a single instruction to read the document and knows its
   * new stage. The append-only log retains the full history for the human
   * transcript; only the model-visible surface is shadowed.
   *
   * The head node is excluded (see {@link surfaceShadowRange}): a `system
   * /message` at node 0 is protected by the harness and would reject this
   * notice, losing the approved transition silently.
   */
  private replaceWithHandoffNotice(session: Session, stage: string, handoffPath: string): void {
    const nodes = [...session.surface.nodes]
    const text = `${formatPrompt(this.prompts.notice.handoffReplaced, { stage, path: handoffPath })}\n\n${this.stagePromptText(stage)}`
    const message = createUserMessage({
      content: [{ type: 'text', text }],
      // The summary is the short account a UI can show on a collapsed row.
      source: { kind: 'stage-switch', form: 'notice', summary: `Stage switched to ${stage}` },
    })
    const range = this.surfaceShadowRange(session, nodes)
    const first = range[0]
    const last = range[range.length - 1]
    if (first === undefined || last === undefined) {
      // Nothing shadowable — an empty surface, or a surface holding only the
      // protected head — so the notice appends instead of replacing.
      session.append('user/message', message, { surfaceOp: 'append' })
      return
    }
    session.append('user/message', message, {
      surfaceOp: { op: 'replace', startSeq: first, endSeq: last },
      sourceEventSeqs: range,
    })
  }

  /**
   * The surface nodes a handoff notice may shadow: the whole surface, minus a
   * protected `system/message` head.
   *
   * Every real deployment appends the system prompt as node 0 at session
   * start, and the harness (`surface.ts` `assertSystemHeadRewrite`) only
   * permits a `system/message` to rewrite exactly that node — a plain
   * `user/message` notice covering it throws. The replacement is not
   * catchable from here, so the pending transition retried every pre-step and
   * the switch never landed (the stage stayed on the old one). The head is
   * the session prompt, not archived history, so keeping it is the correct
   * shape: the notice replaces the body, the same shape compaction's replace
   * uses, which the harness accepts.
   *
   * Returns an empty range when there is nothing to shadow — an empty
   * surface, or a head-only surface — and the caller appends instead.
   */
  private surfaceShadowRange(session: Session, nodes: readonly SessionSeq[]): SessionSeq[] {
    const head = nodes[0]
    if (head === undefined) return []
    return this.projectionOf(session).headIsSystem ? nodes.slice(1) : [...nodes]
  }

  /** The stage-prompt body text for one stage (instruction when configured). */
  private stagePromptText(stage: string): string {
    const instruction = this.instructionByStage.get(stage)
    return instruction === undefined ? `Current stage: ${stage}` : `Current stage: ${stage}\n${instruction}`
  }
}

export default StageController

import { describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt, { renderContextSnapshot } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { Session, SessionId, type UserMessage } from '@deepseek-ai/dsh-session'
import AgentRegistry, { agentEvents, type Agent } from '@deepseek-ai/dsh-agent'
import { createScope } from '@deepseek-ai/dsh-scope'
import UserQuestionService, {
  UserQuestionError, type AskUserQuestionRequest,
} from '@deepseek-ai/dsh-user-questions'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import type { FsWriteOutcome } from '@deepseek-ai/dsh-fs'
import SessionProjection from '@deepseek-ai/dsh-session-projection'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import StageController, { GOTO_STAGE, foldStage, resolveConfig } from '../src/index.ts'
import type { StageConfig } from '../src/index.ts'
import { stageSwitchPrompts, formatPrompt } from '../src/prompts.ts'
import { DEFAULT_STAGE_SWITCH_PROMPTS } from '../src/prompts.defaults.ts'
import {
  APPROVE_LABEL, KEEP_LABEL, MemoryFs, STAGE_CONFIG,
  assembleFor, boundary, openTurn, promptTexts,
} from './helpers/shared.ts'

/**
 * In-memory sandbox-policy service: resolves the per-session standing policy
 * the way the harness service does — the SESSION cwd as the workspace-write
 * root — and records every resolution for assertions.
 */
class MemorySandboxPolicy extends Service {
  static readonly requests: Array<{ session?: Session }> = []

  static policyFor(session?: Session): { mode: string; workspaceRoot: string; sessionId?: unknown } {
    return {
      mode: 'workspace-write',
      workspaceRoot: session?.header.cwd ?? '/process-cwd',
      ...session === undefined ? {} : { sessionId: session.id },
    }
  }

  constructor(ctx: Context) {
    super(ctx, 'sandboxPolicy')
  }

  resolve(request: { session?: Session } = {}): { mode: string; workspaceRoot: string; sessionId?: unknown } {
    MemorySandboxPolicy.requests.push(request)
    return MemorySandboxPolicy.policyFor(request.session)
  }
}

async function agentWithSession(
  ctx: Context,
  id = 'agent-1',
  { owner, cwd, origin, delegationDepth }: { owner?: Agent; cwd?: string; origin?: 'subagent'; delegationDepth?: number } = {},
): Promise<Agent & { session: Session }> {
  const base = Session.create(SessionId(id))
  const header = { ...base.header, ...cwd === undefined ? {} : { cwd } }
  if (origin !== undefined) header.origin = origin
  if (delegationDepth !== undefined) header.delegationDepth = delegationDepth
  const session = Session.create(SessionId(id), undefined, header)
  const agent = {
    id: SessionId(id),
    session,
    options: {},
    inject(message: UserMessage) {
      session.append('user/message', message, { surfaceOp: 'append' })
    },
  } as unknown as Agent & { session: Session }
  let scoped!: Context
  await ctx.plugin(Object.assign((inner: Context) => { scoped = createScope(inner, agent).ctx }, {
    inject: ['tools'],
  }))
  ;(agent as { ctx?: Context }).ctx = scoped
  const agents = ctx.get('agents')
  if (agents === undefined) {
    ctx.emit('agent/created', { agent })
  } else {
    agents.enter(agent, owner)
    agents.announce(agent)
  }
  return agent
}

async function setup(config: StageConfig = STAGE_CONFIG): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(StageController, config)
  return ctx
}

let callCounter = 0
function callStage(ctx: Context, name: string, agent: Agent | undefined, args: Record<string, unknown>) {
  return ctx.tools.execute({
    callId: ToolCallId(`call-${++callCounter}`),
    name,
    arguments: args,
    signal: new AbortController().signal,
    ...agent ? { agent } : {},
  })
}

function setupWithReview(config: StageConfig = STAGE_CONFIG, answer?: { selected: string[]; custom?: string }) {
  return {
    async run(): Promise<{ ctx: Context; agent: Agent & { session: Session }; asked: AskUserQuestionRequest[] }> {
      const ctx = await setup(config)
      await ctx.plugin(AgentRegistry)
      await ctx.plugin(UserQuestionService)
      const asked: AskUserQuestionRequest[] = []
      if (answer !== undefined) {
        ctx.on('user-questions/request', (request) => {
          asked.push(request)
          return Promise.resolve({ answers: [{ id: 'stage-review', ...answer }] })
        })
      }
      const agent = await agentWithSession(ctx, 'agent-1', { cwd: '/workspace' })
      return { ctx, agent, asked }
    },
  }
}

/**
 * The model-facing text of a failed `goto_stage` call: the tool layer prefixes
 * the thrown message with `Error: `. Expectations for copy that lives in
 * `src/prompts.json` are derived from `stageSwitchPrompts` (plus `formatPrompt`
 * for placeholders), so editing prompts never forces a test edit — the tests
 * pin the wiring, and the `prompt single source` suite pins the JSON↔defaults
 * regeneration.
 */
function toolError(prompt: string): string {
  return `Error: ${prompt}`
}

describe('prompt single source', () => {
  it('pins the loaded src/prompts.json overlay to the embedded defaults', () => {
    // scripts/sync-prompts.mjs regenerates src/prompts.defaults.ts from
    // src/prompts.json (run automatically by the prebuild/pretest hooks). A hand edit
    // to either without regenerating must fail here: the JSON is the single
    // editable source, and the embedded copy is what a stale install (no JSON
    // yet) falls back to.
    expect(stageSwitchPrompts).toEqual(DEFAULT_STAGE_SWITCH_PROMPTS)
  })
})

describe('resolveConfig', () => {
  it('accepts a complete valid configuration', () => {
    expect(resolveConfig(STAGE_CONFIG)).toEqual(STAGE_CONFIG)
  })

  it('accepts optional fields', () => {
    const config = {
      ...STAGE_CONFIG,
      handoffDir: 'docs/handoffs',
      initial: 'implement',
      minHandoffTokens: 500,
    }
    expect(resolveConfig(config)).toEqual(config)
  })

  it('rejects a missing or empty stages list', () => {
    expect(() => resolveConfig({ ...STAGE_CONFIG, stages: [] as never }))
      .toThrow('non-empty `stages`')
    expect(() => resolveConfig({ ...STAGE_CONFIG, stages: undefined as never }))
      .toThrow('non-empty `stages`')
  })

  it('rejects duplicate stage names', () => {
    expect(() => resolveConfig({
      ...STAGE_CONFIG,
      stages: [
        { name: 'explore', instruction: 'Explore the problem space and write a plan.' },
        { name: 'explore', instruction: 'Explore the problem space and write a plan.' },
      ],
    })).toThrow('duplicate stage "explore"')
  })

  it('rejects stage names that are unsafe as file names', () => {
    for (const name of ['Implement', 'stage 2', 'a/b', ''] as const) {
      expect(() => resolveConfig({
        ...STAGE_CONFIG,
        stages: [{ name, instruction: 'x' }],
      })).toThrow('must match')
    }
  })

  it('rejects an empty stage instruction', () => {
    expect(() => resolveConfig({
      ...STAGE_CONFIG,
      stages: [{ name: 'explore', instruction: '  ' }],
    })).toThrow('non-empty string `instruction`')
  })

  it('rejects an empty switch-guidance section', () => {
    expect(() => resolveConfig({ ...STAGE_CONFIG, section: '' }))
      .toThrow('non-empty string `section`')
  })

  it('rejects an initial stage outside the list', () => {
    expect(() => resolveConfig({ ...STAGE_CONFIG, initial: 'ghost' }))
      .toThrow('must name a configured stage')
  })

  it('rejects a negative token threshold', () => {
    expect(() => resolveConfig({ ...STAGE_CONFIG, minHandoffTokens: -1 }))
      .toThrow('non-negative finite number')
  })

  it('rejects unknown keys', () => {
    expect(() => resolveConfig({ ...STAGE_CONFIG, modes: [] } as never))
      .toThrow('unknown key(s) modes')
  })
})

describe('foldStage', () => {
  it('folds to undefined before the first stage record', () => {
    const session = Session.create(SessionId('empty'))
    expect(foldStage(session.snapshotEvents())).toBeUndefined()
  })

  it('honors the end prefix', () => {
    const session = Session.create(SessionId('prefix'))
    appendStageNotice(session, 'Current stage: explore')
    appendStageNotice(session, 'Current stage: implement')
    expect(foldStage(session.snapshotEvents(), 1)).toBe('explore')
  })

  /** One stage-switch notice message as every stage entry appends. */
  function appendStageNotice(session: Session, summary: string): void {
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: summary }],
      source: { kind: 'plugin', plugin: 'stage-switch', form: 'notice', summary },
    }), { surfaceOp: 'append' })
  }

  it('folds from the stage-switch notice summaries', () => {
    const session = Session.create(SessionId('notice-fold'))
    appendStageNotice(session, 'Current stage: explore')
    appendStageNotice(session, 'Current stage: implement')
    expect(foldStage(session.snapshotEvents())).toBe('implement')
  })

  it('folds from the handoff notice summary', () => {
    const session = Session.create(SessionId('handoff-fold'))
    appendStageNotice(session, 'Current stage: explore')
    appendStageNotice(session, 'Stage switched to verify')
    expect(foldStage(session.snapshotEvents())).toBe('verify')
  })

  it('ignores foreign plugin notices, plain user messages, and malformed summaries', () => {
    const session = Session.create(SessionId('foreign-fold'))
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'hi' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'spoof' }],
      source: { kind: 'plugin', plugin: 'other-plugin', form: 'notice', summary: 'Current stage: ghost' },
    }), { surfaceOp: 'append' })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'spoof' }],
      source: { kind: 'plugin', plugin: 'stage-switch', form: 'notice', summary: 'Stage switched to NOT A STAGE' },
    }), { surfaceOp: 'append' })
    expect(foldStage(session.snapshotEvents())).toBeUndefined()
  })
})

describe('stage prompt messages', () => {
  // The initial-injection happy path (first accepted pre-step carries the
  // stage prompt once; later boundaries never repeat it) lives in the
  // composition boot test; these cases pin the branches around it.
  it('a rejected first proposal does not inject the initial prompt', async () => {
    const ctx = await setup()
    const agent = await agentWithSession(ctx, 'prompt-rejected')
    const events = agentEvents(ctx, agent)
    const message = createUserMessage({
      content: [{ type: 'text', text: 'probe' }],
      source: { kind: 'user' },
    })
    const signal = new AbortController().signal
    const decision = await events.waterfall(
      'agent/pre-step',
      { messages: [message], turn: 1, step: 1, signal },
      () => Promise.resolve({ kind: 'reject' as const }),
    )
    expect(decision.kind).toBe('reject')
    expect(promptTexts(agent)).toEqual([])
  })

  it('a user switch flush appends the new stage prompt with the switch notice', async () => {
    const ctx = await setup()
    const agent = await agentWithSession(ctx, 'prompt-switched')
    openTurn(agent.session)
    // The header describes the initial stage, so the switch is narrated.
    agent.session.append('request/header', {
      header: { config: { provider: 'test', model: 'test-model' } },
      reason: 'initial',
    })
    expect(ctx.stage.set(agent, 'implement')).toBe('queued')
    await boundary(ctx, agent, 'step-start')
    const texts = promptTexts(agent)
    expect(texts).toContain(
      formatPrompt(stageSwitchPrompts.notice.userSwitchPrefix, { stage: 'implement' })
      + 'Current stage: implement\nImplement the approved plan.',
    )
  })

  it('a stage prompt for a stage no longer configured drops the instruction', async () => {
    const ctx = await setup()
    const agent = await agentWithSession(ctx, 'prompt-ghost')
    openTurn(agent.session)
    expect(ctx.stage.set(agent, 'retired')).toBe('queued')
    await boundary(ctx, agent, 'step-start')
    const texts = promptTexts(agent)
    expect(texts.some(text => text.includes('Current stage: retired'))).toBe(true)
    expect(texts.some(text => text.includes('Current stage: retired\n'))).toBe(false)
  })

  it('does not inject the initial stage prompt for a subagent session (origin=subagent)', async () => {
    const ctx = await setup()
    const agent = await agentWithSession(ctx, 'subagent-origin', { origin: 'subagent', delegationDepth: 1 })
    await boundary(ctx, agent, 'pre-step')
    // A subagent session is a fresh log the parent already routed; the
    // initial route instruction ("classify and call goto_stage") would
    // deadlock the child (no user to answer goto_stage's review), so the
    // initial stage prompt is skipped entirely.
    const stagePrompts = promptTexts(agent).filter(text => text.startsWith('Current stage:'))
    expect(stagePrompts).toHaveLength(0)
  })

  it('does not inject the initial stage prompt for a subagent session (delegationDepth>0 only)', async () => {
    // An older session log may lack the `origin` field; delegationDepth > 0
    // is the durable fallback signal (persisted so a resumed child keeps its
    // depth). A depth without origin still skips the route injection.
    const ctx = await setup()
    const agent = await agentWithSession(ctx, 'subagent-depth', { delegationDepth: 2 })
    await boundary(ctx, agent, 'pre-step')
    expect(promptTexts(agent).filter(text => text.startsWith('Current stage:'))).toHaveLength(0)
  })

  it('injects the initial stage prompt for a top-level session (regression)', async () => {
    // A top-level session (no origin, no delegationDepth) still gets the
    // initial stage prompt on its first accepted step.
    const ctx = await setup()
    const agent = await agentWithSession(ctx, 'top-level')
    await boundary(ctx, agent, 'pre-step')
    const stagePrompts = promptTexts(agent).filter(text => text.startsWith('Current stage:'))
    expect(stagePrompts).toEqual(['Current stage: explore\nExplore the problem space and write a plan.'])
  })

  it('stage:policy contributes empty text without an eligibility predicate', async () => {
    const ctx = await setup()
    const agent = await agentWithSession(ctx, 'policy-none')
    const assembly = await assembleFor(ctx, agent)
    expect(assembly.contexts.find(context => context.name === 'stage:policy')?.text).toBe('')
  })

  it('stage:policy contributes the guidance while a predicate is true', async () => {
    const ctx = await setup()
    const agent = await agentWithSession(ctx, 'policy-true')
    ctx.stage.registerEligibility(() => true)
    const assembly = await assembleFor(ctx, agent)
    expect(assembly.contexts.find(context => context.name === 'stage:policy')?.text)
      .toBe(STAGE_CONFIG.section)
  })

  it('ANY of several predicates enables the guidance; disposal removes it', async () => {
    const ctx = await setup()
    const agent = await agentWithSession(ctx, 'policy-any')
    const disposeFalse = ctx.stage.registerEligibility(() => false)
    const disposeTrue = ctx.stage.registerEligibility(() => true)
    const withTrue = await assembleFor(ctx, agent)
    expect(withTrue.contexts.find(context => context.name === 'stage:policy')?.text)
      .toBe(STAGE_CONFIG.section)
    disposeTrue()
    const onlyFalse = await assembleFor(ctx, agent)
    expect(onlyFalse.contexts.find(context => context.name === 'stage:policy')?.text).toBe('')
    disposeFalse()
  })

  it('stage:policy joins the runtime-context snapshot while a predicate is true', async () => {
    const ctx = await setup()
    const agent = await agentWithSession(ctx, 'policy-snapshot')
    ctx.stage.registerEligibility(() => true)
    const assembly = await assembleFor(ctx, agent)
    expect(renderContextSnapshot(assembly)).toContain(STAGE_CONFIG.section)
  })

  it('the system prompt never carries a stage section', async () => {
    const ctx = await setup()
    const agent = await agentWithSession(ctx, 'no-section')
    const assembly = await assembleFor(ctx, agent)
    const sectionNames = assembly.sections.map(section => section.name)
    expect(sectionNames).not.toContain('stage:context')
    expect(sectionNames).not.toContain('stage:policy')
  })

  it('exposes stage_current and stage_targets variables', async () => {
    const ctx = await setup()
    const agent = await agentWithSession(ctx, 'variables')
    const assembly = await assembleFor(ctx, agent)
    expect(assembly.variables['stage_current']).toBe('explore')
    expect(assembly.variables['stage_targets']).toBe('implement, verify')
  })
})

describe('goto_stage registration', () => {
  it('registers the tool with stage and optional handoff parameters', async () => {
    const ctx = await setup()
    const schema = ctx.tools.schemas().find(entry => entry.name === GOTO_STAGE)
    expect(schema?.description).toBe(stageSwitchPrompts.gotoTool.description)
    const parameters = schema?.parameters as { required?: string[]; properties?: Record<string, unknown> }
    expect(Object.keys(parameters.properties ?? {})).toEqual(['stage', 'handoff'])
    expect(parameters.required).toEqual(['stage'])
    // Progressive disclosure: the schema carries only an index to the handoff
    // template — the template itself lives in the full-transition rejection,
    // never in the per-request schema (no markdown headings in the index).
    const handoff = parameters.properties?.handoff as { type?: string; description?: string } | undefined
    expect(handoff?.type).toBe('string')
    expect(handoff?.description).toBe(stageSwitchPrompts.gotoTool.handoffParam)
    expect(stageSwitchPrompts.gotoTool.handoffParam).not.toContain('##')
  })
})

describe('goto_stage validation', () => {
  it('rejects an agent-less call', async () => {
    const ctx = await setup()
    const result = await callStage(ctx, GOTO_STAGE, undefined, { stage: 'implement', handoff: '# Handoff' })
    expect(result.isError).toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: 'Error: goto_stage requires a calling agent (no session to switch)' }])
  })

  it('rejects a target outside the configured stages', async () => {
    const ctx = await setup()
    const agent = await agentWithSession(ctx)
    const result = await callStage(ctx, GOTO_STAGE, agent, { stage: 'ghost', handoff: '# Handoff' })
    expect(result.isError).toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: toolError(formatPrompt(stageSwitchPrompts.errors.notConfigured, { stage: 'ghost', stages: 'explore, implement, verify' })) }])
  })

  it('rejects switching to the current stage', async () => {
    const ctx = await setup()
    const agent = await agentWithSession(ctx)
    const result = await callStage(ctx, GOTO_STAGE, agent, { stage: 'explore', handoff: '# Handoff' })
    expect(result.isError).toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: toolError(formatPrompt(stageSwitchPrompts.errors.alreadyCurrent, { stage: 'explore' })) }])
  })

  it('rejects a missing handoff in the full transition before asking the reviewer', async () => {
    const ctx = await setup()
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(UserQuestionService)
    const ask = vi.fn()
    ctx.on('user-questions/request', ask as never)
    const agent = await agentWithSession(ctx)
    const result = await callStage(ctx, GOTO_STAGE, agent, { stage: 'implement' })
    expect(result.isError).toBe(true)
    // The rejection is the progressive-disclosure point for the full-switch
    // guidance: it carries exactly the configured handoff template.
    expect(result.content).toEqual([{ type: 'text', text: toolError(stageSwitchPrompts.errors.requiresHandoff) }])
    expect(ask).not.toHaveBeenCalled()
    expect(foldStage(agent.session.snapshotEvents())).toBeUndefined()
  })

  it('degrades to the manual switch when no user-questions seam is composed', async () => {
    const ctx = await setup()
    const agent = await agentWithSession(ctx)
    const result = await callStage(ctx, GOTO_STAGE, agent, { stage: 'implement', handoff: '# Handoff' })
    expect(result.isError).toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: toolError(stageSwitchPrompts.errors.noUserQuestions) }])
  })

  it('degrades when no filesystem service is composed', async () => {
    const ctx = await setup()
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(UserQuestionService)
    ctx.on('user-questions/request', vi.fn() as never)
    const agent = await agentWithSession(ctx)
    const result = await callStage(ctx, GOTO_STAGE, agent, { stage: 'implement', handoff: '# Handoff' })
    expect(result.isError).toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: toolError(stageSwitchPrompts.errors.noFs) }])
  })

  it('fails the call when the handoff write throws', async () => {
    const ctx = await setup()
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(UserQuestionService)
    class FailingFs extends MemoryFs {
      override async writeText(): Promise<FsWriteOutcome> {
        throw new Error('disk full')
      }
    }
    await ctx.plugin(FailingFs)
    ctx.on('user-questions/request', vi.fn() as never)
    const agent = await agentWithSession(ctx)
    const result = await callStage(ctx, GOTO_STAGE, agent, { stage: 'implement', handoff: '# Handoff' })
    expect(result.isError).toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: 'Error: disk full' }])
    expect(foldStage(agent.session.snapshotEvents())).toBeUndefined()
  })
})

describe('goto_stage presentationMeta (full-transition marker)', () => {
  // The tool/result event carries the presentation payload (the canonical
  // `value` is deliberately omitted from durable events), so the only
  // durable signal that an approved goto_stage was a FULL transition (handoff
  // written, history archived) is the presentationMeta projection. A
  // deployment phase machine reads `meta.fullTransition` to demote the next
  // request to a minimal bootstrap catalog for one round; light transitions
  // and rejected/dismissed reviews must NOT carry it. The three paths split
  // naturally: full => value.handoffPath present => meta.fullTransition true;
  // light => no handoffPath => meta null (the lossless JSON no-op, since the
  // tool/result event validates every field and `undefined` is not lossless);
  // error paths never reach createSuccessResult and carry no meta at all.

  it('stamps the full-transition marker on an approved full transition', async () => {
    const { ctx, agent } = await setupWithReview(undefined, { selected: [APPROVE_LABEL] }).run()
    await ctx.plugin(MemoryFs)
    openTurn(agent.session)
    const result = await callStage(ctx, GOTO_STAGE, agent, {
      stage: 'implement',
      handoff: '# Implement\n\n- Completed: exploration',
    })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected approved transition')
    // The presentationMeta projector runs on top-level calls (exec.parent
    // undefined) and full transitions carry a handoffPath, so the result meta
    // marks the transition as full for the phase machine to read.
    expect((result as { meta?: unknown }).meta).toEqual({ fullTransition: true })
  })

  it('stamps no marker on a light transition (no handoffPath)', async () => {
    const THRESHOLD = { ...STAGE_CONFIG, minHandoffTokens: 100 }
    const ctx = await setup(THRESHOLD)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(UserQuestionService)
    await ctx.plugin(MemoryFs)
    await ctx.plugin(SessionProjection)
    await ctx.plugin(TokenMeter)
    ctx.on('user-questions/request', () => Promise.resolve({
      answers: [{ id: 'stage-review', selected: [APPROVE_LABEL] }],
    }))
    const agent = await agentWithSession(ctx, 'light-meta', { cwd: '/workspace' })
    openTurn(agent.session)
    // Below the threshold a transition is light: no handoff, no archive, and
    // the value has no handoffPath, so the presentationMeta projector returns
    // the lossless no-op (null). The phase machine must not demote on a
    // light switch; it keys on meta?.fullTransition === true, which null
    // never satisfies.
    agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'short' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    const result = await callStage(ctx, GOTO_STAGE, agent, { stage: 'implement' })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected light transition')
    expect((result as { value: { handoffPath?: string } }).value.handoffPath).toBeUndefined()
    expect((result as { meta?: unknown }).meta).toBe(null)
  })

  it('stamps no marker on a rejected review (isError, no meta)', async () => {
    const { ctx, agent } = await setupWithReview(undefined, { selected: [KEEP_LABEL] }).run()
    await ctx.plugin(MemoryFs)
    const result = await callStage(ctx, GOTO_STAGE, agent, { stage: 'implement', handoff: '# Handoff' })
    expect(result.isError).toBe(true)
    // Error results bypass createSuccessResult, so presentationMeta never runs
    // and the result carries no meta at all — a rejected review cannot demote.
    expect('meta' in result).toBe(false)
    expect((result as { meta?: unknown }).meta).toBeUndefined()
  })

  it('stamps no marker on a dismissed review (isError, no meta)', async () => {
    const ctx = await setup()
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(UserQuestionService)
    await ctx.plugin(MemoryFs)
    ctx.on('user-questions/request', () =>
      Promise.reject(new UserQuestionError('cancelled', 'ASK_CANCELLED')))
    const agent = await agentWithSession(ctx, 'dismissed-meta', { cwd: '/workspace' })
    const result = await callStage(ctx, GOTO_STAGE, agent, { stage: 'implement', handoff: '# Handoff' })
    expect(result.isError).toBe(true)
    expect('meta' in result).toBe(false)
    expect((result as { meta?: unknown }).meta).toBeUndefined()
  })
})

describe('goto_stage full transition', () => {
  // The full arc (handoff write → review → boundary flush → durable notice →
  // fold) is pinned by the composition transition test; these two keep the
  // queued-state contract it cannot see.
  it('the full-transition review carries no stage-review presentation intent (standalone build)', async () => {
    const { ctx, agent, asked } = await setupWithReview(undefined, { selected: [APPROVE_LABEL] }).run()
    await ctx.plugin(MemoryFs)
    openTurn(agent.session)
    const result = await callStage(ctx, GOTO_STAGE, agent, { stage: 'implement', handoff: '# Implement\n\n- Completed: exploration' })
    // Load-bearing guard: a failed call never asks the review, which would
    // make the assertion below vacuous.
    expect(result.isError).toBe(false)
    // No published dsh-user-questions carries the stage-review union, so the
    // standalone build sends the review on the generic question flow; the
    // light path pins the same in the token-threshold suite.
    expect(asked[0]?.questions[0]?.intent).toBeUndefined()
  })

  it('a queued full transition leaves the derived surface empty before the boundary flush', async () => {
    const { ctx, agent } = await setupWithReview(undefined, { selected: [APPROVE_LABEL] }).run()
    await ctx.plugin(MemoryFs)
    openTurn(agent.session)
    const result = await callStage(ctx, GOTO_STAGE, agent, { stage: 'implement', handoff: '# Implement\n\n- Completed: exploration' })
    // Load-bearing guard: a failed call also leaves the surface empty, which
    // would make the assertion below vacuous.
    expect(result.isError).toBe(false)
    // Between approval and the boundary flush the transition exists only as
    // queued durable intent: nothing reaches the model-visible surface.
    expect(agent.session.deriveMessages().length).toBe(0)
  })

  it('scopes handoffs per session so sessions sharing a workspace never collide', async () => {
    const ctx = await setup()
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(UserQuestionService)
    await ctx.plugin(MemoryFs)
    ctx.on('user-questions/request', () => Promise.resolve({
      answers: [{ id: 'stage-review', selected: [APPROVE_LABEL] }],
    }))
    const first = await agentWithSession(ctx, 'session-aaa', { cwd: '/workspace' })
    const second = await agentWithSession(ctx, 'session-bbb', { cwd: '/workspace' })
    openTurn(first.session)
    openTurn(second.session)
    const firstResult = await callStage(ctx, GOTO_STAGE, first, { stage: 'implement', handoff: '# First' })
    const secondResult = await callStage(ctx, GOTO_STAGE, second, { stage: 'implement', handoff: '# Second' })
    expect(firstResult.isError).toBe(false)
    expect(secondResult.isError).toBe(false)
    const fs = ctx.get('fs') as MemoryFs
    expect(fs.writes).toEqual([
      { path: '/workspace/handoff/session-aaa/implement.md', content: '# First' },
      { path: '/workspace/handoff/session-bbb/implement.md', content: '# Second' },
    ])
  })

  it('sanitizes the session id into a safe directory segment', async () => {
    const ctx = await setup()
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(UserQuestionService)
    await ctx.plugin(MemoryFs)
    ctx.on('user-questions/request', () => Promise.resolve({
      answers: [{ id: 'stage-review', selected: [APPROVE_LABEL] }],
    }))
    const agent = await agentWithSession(ctx, 'odd id/../x', { cwd: '/workspace' })
    openTurn(agent.session)
    const result = await callStage(ctx, GOTO_STAGE, agent, { stage: 'implement', handoff: '# Odd' })
    expect(result.isError).toBe(false)
    const fs = ctx.get('fs') as MemoryFs
    expect(fs.writes).toEqual([{ path: '/workspace/handoff/odd-id-..-x/implement.md', content: '# Odd' }])
  })

  it('stamps the handoff write with the session sandbox policy, not the deployment fallback', async () => {
    const { ctx, agent } = await setupWithReview(undefined, { selected: [APPROVE_LABEL] }).run()
    await ctx.plugin(MemoryFs)
    await ctx.plugin(MemorySandboxPolicy)
    MemorySandboxPolicy.requests.length = 0
    openTurn(agent.session)
    const result = await callStage(ctx, GOTO_STAGE, agent, {
      stage: 'implement',
      handoff: '# Implement\n\n- Completed: exploration\n- Requirements: policy probe',
    })
    expect(result.isError).toBe(false)
    // The write carried the per-session policy the service resolved: its
    // workspace root is the SESSION cwd (/workspace), the boundary a
    // confining backend fences by. Without the per-call policy the backend
    // falls back to the deployment's process-cwd root and denies the write
    // (the live goto_stage "file access denied under workspace-write mode").
    const fs = ctx.get('fs') as MemoryFs
    expect(fs.policies).toEqual([MemorySandboxPolicy.policyFor(agent.session)])
    expect(MemorySandboxPolicy.requests).toEqual([{ session: agent.session }])
  })

  it('archives the previous surface so the model sees only the notice', async () => {
    const { ctx, agent } = await setupWithReview(undefined, { selected: [APPROVE_LABEL] }).run()
    await ctx.plugin(MemoryFs)
    openTurn(agent.session)
    agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'old work' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'more old work' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    await callStage(ctx, GOTO_STAGE, agent, { stage: 'verify', handoff: '# Verify\n\ncheck it' })
    expect(agent.session.deriveMessages()).toHaveLength(2)
    await boundary(ctx, agent, 'step-start')
    const texts = promptTexts(agent)
    expect(texts).toHaveLength(2)
    expect(texts[0]).toContain(formatPrompt(stageSwitchPrompts.notice.handoffReplaced, {
      stage: 'verify',
      path: '/workspace/handoff/agent-1/verify.md',
    }))
    expect(texts[1]).toBe('boundary probe')
    // The durable log retains the archived history for the human transcript.
    const archived = agent.session.snapshotEvents().filter(event =>
      event.type === 'user/message' && event.data.content.some(
        (block: { type: string; text?: string }) => block.type === 'text' && block.text === 'old work'))
    expect(archived).toHaveLength(1)
  })

  it('records a full transition on the handoff notice alone', async () => {
    const { ctx, agent } = await setupWithReview(undefined, { selected: [APPROVE_LABEL] }).run()
    await ctx.plugin(MemoryFs)
    openTurn(agent.session)
    const result = await callStage(ctx, GOTO_STAGE, agent, {
      stage: 'implement',
      handoff: '# Implement\n\n- Completed: exploration',
    })
    expect(result.isError).toBe(false)
    expect(foldStage(agent.session.snapshotEvents())).toBeUndefined()
    await boundary(ctx, agent, 'step-start')
    // The boundary flush writes the handoff notice (summary `Stage switched to
    // <stage>`): the fold restores the stage for resume/fork from the notice alone.
    expect(foldStage(agent.session.snapshotEvents())).toBe('implement')
  })

  it('the review answer must be exactly one Approve without custom text', async () => {
    const { ctx, agent } = await setupWithReview(undefined, { selected: [KEEP_LABEL], custom: 'revisit the handoff' }).run()
    await ctx.plugin(MemoryFs)
    const result = await callStage(ctx, GOTO_STAGE, agent, { stage: 'implement', handoff: '# Handoff' })
    expect(result.isError).toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: toolError(formatPrompt(stageSwitchPrompts.errors.keepPlanningFeedback, { feedback: 'revisit the handoff' })) }])
    expect(foldStage(agent.session.snapshotEvents())).toBeUndefined()
  })

  it('a dismissed review names the user takeover', async () => {
    const ctx = await setup()
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(UserQuestionService)
    await ctx.plugin(MemoryFs)
    ctx.on('user-questions/request', () =>
      Promise.reject(new UserQuestionError(
        'the user cancelled ask_user_question', 'ASK_CANCELLED')))
    const agent = await agentWithSession(ctx)
    const result = await callStage(ctx, GOTO_STAGE, agent, { stage: 'implement', handoff: '# Handoff' })
    expect(result.isError).toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: toolError(stageSwitchPrompts.errors.dismissed) }])
    expect(foldStage(agent.session.snapshotEvents())).toBeUndefined()
  })

  it('fails the call when the plugin is disposed while the review awaits', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const fiber = await ctx.plugin(StageController, STAGE_CONFIG)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(UserQuestionService)
    await ctx.plugin(MemoryFs)
    let answer!: (value: { answers: { id: string; selected: string[] }[] }) => void
    ctx.on('user-questions/request', () => new Promise((resolve) => { answer = resolve }))
    const agent = await agentWithSession(ctx)
    const pending = callStage(ctx, GOTO_STAGE, agent, { stage: 'implement', handoff: '# Handoff' })
    await new Promise(resolve => setImmediate(resolve))
    await fiber.dispose()
    answer({ answers: [{ id: 'stage-review', selected: [APPROVE_LABEL] }] })
    const result = await pending
    expect(result.isError).toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: 'Error: the stage-switch service was reloaded while the transition was under review; present the transition again' }])
    expect(foldStage(agent.session.snapshotEvents())).toBeUndefined()
  })
})

describe('goto_stage token-threshold transitions', () => {
  const THRESHOLD_CONFIG = { ...STAGE_CONFIG, minHandoffTokens: 100 }

  async function setupThreshold(answer: { selected: string[] }) {
    const ctx = await setup(THRESHOLD_CONFIG)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(UserQuestionService)
    await ctx.plugin(MemoryFs)
    await ctx.plugin(SessionProjection)
    await ctx.plugin(TokenMeter)
    const asked: AskUserQuestionRequest[] = []
    ctx.on('user-questions/request', (request) => {
      asked.push(request)
      return Promise.resolve({ answers: [{ id: 'stage-review', ...answer }] })
    })
    const agent = await agentWithSession(ctx, 'agent-1', { cwd: '/workspace' })
    return { ctx, agent, asked }
  }

  it('full transition when the surface is at or above the threshold', async () => {
    const { ctx, agent, asked } = await setupThreshold({ selected: [APPROVE_LABEL] })
    openTurn(agent.session)
    // A long message prices well above the 100-token threshold.
    agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'long conversation '.repeat(60) }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    const result = await callStage(ctx, GOTO_STAGE, agent, { stage: 'implement', handoff: '# Handoff\n\nhandoff text' })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected approved transition')
    expect((result.value as { handoffPath: string }).handoffPath).toBe('/workspace/handoff/agent-1/implement.md')
    // The full review carried the handoff detail (the standalone build omits
    // the stage-review presentation intent; see the boundary test above).
    expect(asked[0]?.questions[0]?.detail).toBe('# Handoff\n\nhandoff text')
    await boundary(ctx, agent, 'step-start')
    expect(promptTexts(agent)[0]).toContain(formatPrompt(stageSwitchPrompts.notice.handoffReplaced, {
      stage: 'implement',
      path: '/workspace/handoff/agent-1/implement.md',
    }))
  })

  it('light transition below the threshold: no handoff, no archive, stage only', async () => {
    const { ctx, agent, asked } = await setupThreshold({ selected: [APPROVE_LABEL] })
    openTurn(agent.session)
    agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'short' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    const result = await callStage(ctx, GOTO_STAGE, agent, { stage: 'implement' })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected approved transition')
    expect(result.value).toEqual({ approved: true, stage: 'implement' })
    // No handoff was written and the review stayed generic (no intent/detail).
    const fs = ctx.get('fs') as MemoryFs
    expect(fs.writes).toEqual([])
    expect(asked[0]?.questions[0]?.intent).toBeUndefined()
    expect(asked[0]?.questions[0]?.detail).toBeUndefined()
    await boundary(ctx, agent, 'step-start')
    // Stage switched; the conversation history is retained.
    expect(foldStage(agent.session.snapshotEvents())).toBe('implement')
    const texts = promptTexts(agent)
    expect(texts[0]).toBe('short')
    expect(texts.at(-1)).toBe('boundary probe')
    expect(texts.some(text => text.includes('archived'))).toBe(false)
  })

  it('rejects a full transition without a handoff, then succeeds on the retry with one', async () => {
    const { ctx, agent, asked } = await setupThreshold({ selected: [APPROVE_LABEL] })
    openTurn(agent.session)
    // A long message prices well above the 100-token threshold.
    agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'long conversation '.repeat(60) }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    // First call omits the handoff: rejected with the template, no review
    // asked, nothing written — the model then retries with the document.
    const rejected = await callStage(ctx, GOTO_STAGE, agent, { stage: 'implement' })
    expect(rejected.isError).toBe(true)
    expect(rejected.content).toEqual([{ type: 'text', text: toolError(stageSwitchPrompts.errors.requiresHandoff) }])
    const fs = ctx.get('fs') as MemoryFs
    expect(fs.writes).toEqual([])
    expect(asked).toHaveLength(0)
    // Retry with the handoff: approved, written, and reviewed once.
    const retried = await callStage(ctx, GOTO_STAGE, agent, { stage: 'implement', handoff: '# Implement\n\n- Completed: exploration' })
    expect(retried.isError).toBe(false)
    if (retried.isError) throw new Error('expected approved retry')
    expect((retried.value as { handoffPath: string }).handoffPath).toBe('/workspace/handoff/agent-1/implement.md')
    expect(fs.writes).toEqual([{ path: '/workspace/handoff/agent-1/implement.md', content: '# Implement\n\n- Completed: exploration' }])
    expect(asked).toHaveLength(1)
  })

  it('discards a provided handoff on a light transition without writing it', async () => {
    const { ctx, agent, asked } = await setupThreshold({ selected: [APPROVE_LABEL] })
    openTurn(agent.session)
    agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'short' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    const result = await callStage(ctx, GOTO_STAGE, agent, { stage: 'implement', handoff: '# Unneeded handoff' })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected approved transition')
    expect(result.value).toEqual({ approved: true, stage: 'implement' })
    const fs = ctx.get('fs') as MemoryFs
    expect(fs.writes).toEqual([])
    expect(asked[0]?.questions[0]?.detail).toBeUndefined()
  })

  it('a configured threshold requires the token-meter service', async () => {
    const ctx = await setup(THRESHOLD_CONFIG)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(UserQuestionService)
    ctx.on('user-questions/request', vi.fn() as never)
    const agent = await agentWithSession(ctx)
    const result = await callStage(ctx, GOTO_STAGE, agent, { stage: 'implement', handoff: '# Handoff' })
    expect(result.isError).toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: toolError(stageSwitchPrompts.errors.missingTokenMeter) }])
  })
})

describe('goto_stage presentation', () => {
  it('presents the call as a generic card titled by the target stage', async () => {
    const ctx = await setup()
    const def = ctx.tools.get(GOTO_STAGE)!
    expect(def.presentCall?.({ stage: 'implement', handoff: '# Handoff\n\nwork' })).toEqual({
      card: 'generic',
      title: formatPrompt(stageSwitchPrompts.present.callTitle, { stage: 'implement' }),
      kind: 'other',
      content: [{ type: 'text', text: '# Handoff\n\nwork' }],
    })
    expect(def.presentCall?.({ stage: 'implement' })).toEqual({
      card: 'generic',
      title: formatPrompt(stageSwitchPrompts.present.callTitle, { stage: 'implement' }),
      kind: 'other',
      content: [{ type: 'text', text: formatPrompt(stageSwitchPrompts.present.lightCallContent, { stage: 'implement' }) }],
    })
  })

  it('presents the result as a generic transition card', async () => {
    const ctx = await setup()
    const def = ctx.tools.get(GOTO_STAGE)!
    const content = [{ type: 'text' as const, text: 'ok' }]
    expect(def.presentResult?.({ stage: 'implement' }, { content, isError: false })).toEqual({
      card: 'generic',
      title: stageSwitchPrompts.present.resultTitle,
      content,
    })
  })
})

describe('stage command', () => {
  async function commandSetup() {
    const ctx = await setup()
    await ctx.plugin(CommandRuntime)
    await new Promise(resolve => setImmediate(resolve))
    const signal = new AbortController().signal
    const agent = await agentWithSession(ctx, 'command-agent')
    const steer = vi.fn()
    ;(agent as unknown as { steer: typeof steer }).steer = steer
    return { ctx, agent, signal, steer }
  }

  function runCommand(ctx: Context, agent: Agent & { session: Session }, line: string, signal: AbortSignal) {
    // [] = no image attachments.
    return ctx.commands.execute(agent, line, [], signal)
  }

  it('shows the current stage and the stage list', async () => {
    const { ctx, agent, signal } = await commandSetup()
    agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Current stage: implement' }],
      source: { kind: 'plugin', plugin: 'stage-switch', form: 'notice', summary: 'Current stage: implement' },
    }), { surfaceOp: 'append' })
    const result = await runCommand(ctx, agent, '/stage', signal)
    expect(result?.result).toEqual({
      kind: 'success',
      text: formatPrompt(stageSwitchPrompts.command.current, { stage: 'implement', stages: 'explore, implement, verify' }),
    })
    expect(foldStage(agent.session.snapshotEvents())).toBe('implement')
  })

  it('commits the notice summary as the record', async () => {
    const { ctx, agent, signal } = await commandSetup()
    await runCommand(ctx, agent, '/stage implement', signal)
    const notices = agent.session.snapshotEvents()
      .filter(event => event.type === 'user/message')
      .map(event => event.data.source)
      .filter(source => source.kind === 'plugin' && source.plugin === 'stage-switch')
    expect(notices).toEqual([
      expect.objectContaining({ form: 'notice', summary: 'Current stage: implement' }),
    ])
  })

  it('switching to the current stage is a no-op', async () => {
    const { ctx, agent, signal } = await commandSetup()
    expect((await runCommand(ctx, agent, '/stage explore', signal))?.result)
      .toEqual({ kind: 'success', text: formatPrompt(stageSwitchPrompts.command.alreadyCurrent, { target: 'explore' }) })
    expect(foldStage(agent.session.snapshotEvents())).toBeUndefined()
  })

  it('rejects an unknown stage with the stage list', async () => {
    const { ctx, agent, signal } = await commandSetup()
    const result = await runCommand(ctx, agent, '/stage ghost', signal)
    expect(result?.result).toEqual({
      kind: 'error',
      text: formatPrompt(stageSwitchPrompts.command.unknown, { target: 'ghost', stages: 'explore, implement, verify' }),
    })
    expect(foldStage(agent.session.snapshotEvents())).toBeUndefined()
  })

  it('queues a mid-turn selection and flushes it with a switch notice at the boundary', async () => {
    const { ctx, agent, signal } = await commandSetup()
    openTurn(agent.session)
    agent.session.append('request/header', {
      header: { config: { provider: 'test', model: 'test-model' } },
      reason: 'initial',
    })
    expect((await runCommand(ctx, agent, '/stage implement', signal))?.result)
      .toEqual({ kind: 'success', text: formatPrompt(stageSwitchPrompts.command.queued, { target: 'implement' }) })
    expect(foldStage(agent.session.snapshotEvents())).toBeUndefined()
    await boundary(ctx, agent, 'step-start')
    expect(foldStage(agent.session.snapshotEvents())).toBe('implement')
    // The boundary appended the stage prompt with the user-switch notice
    // because the last header described the other stage.
    const notices = agent.session.snapshotEvents()
      .filter(event => event.type === 'user/message' && event.data.source.kind === 'plugin')
      .map(event => (event.data as { content: { type: string; text?: string }[] }).content.map(block => block.text ?? '').join(''))
    expect(notices).toEqual([
      formatPrompt(stageSwitchPrompts.notice.userSwitchPrefix, { stage: 'implement' })
      + 'Current stage: implement\nImplement the approved plan.',
    ])
  })

  it('narrates nothing for an approved tool transition — the tool result is the narration', async () => {
    const ctx = await setup()
    await ctx.plugin(CommandRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(UserQuestionService)
    await ctx.plugin(MemoryFs)
    ctx.on('user-questions/request', () => Promise.resolve({
      answers: [{ id: 'stage-review', selected: [APPROVE_LABEL] }],
    }))
    const agent = await agentWithSession(ctx, 'command-tool-narrate', { cwd: '/workspace' })
    openTurn(agent.session)
    agent.session.append('request/header', {
      header: { config: { provider: 'test', model: 'test-model' } },
      reason: 'initial',
    })
    const result = await callStage(ctx, GOTO_STAGE, agent, { stage: 'implement', handoff: '# Handoff' })
    expect(result.isError).toBe(false)
    await boundary(ctx, agent, 'step-start')
    expect(foldStage(agent.session.snapshotEvents())).toBe('implement')
    // Only the handoff notice exists; no user-switch narration was injected
    // because the tool result already narrates the transition.
    const texts = agent.session.snapshotEvents()
      .filter(event => event.type === 'user/message' && event.data.source.kind === 'plugin')
      .map(event => (event.data as { content: { type: string; text?: string }[] }).content.map(block => block.text ?? '').join(''))
    expect(texts.some(text => text.includes(formatPrompt(stageSwitchPrompts.notice.userSwitchPrefix, { stage: 'implement' })))).toBe(false)
    expect(texts.some(text => text.includes(formatPrompt(stageSwitchPrompts.notice.handoffReplaced, {
      stage: 'implement',
      path: '/workspace/handoff/command-tool-narrate/implement.md',
    })))).toBe(true)
  })

  it('steers a trailing message into the switched stage context', async () => {
    const { ctx, agent, signal, steer } = await commandSetup()
    expect((await runCommand(ctx, agent, '/stage implement focus on the resume path', signal))?.result)
      .toEqual({ kind: 'success', text: formatPrompt(stageSwitchPrompts.command.switched, { target: 'implement' }) })
    expect(steer).toHaveBeenCalledWith(expect.objectContaining({
      content: [{ type: 'text', text: 'focus on the resume path' }],
      source: { kind: 'user' },
    }))
  })

  it('steers a trailing message even when the target is already current', async () => {
    const { ctx, agent, signal, steer } = await commandSetup()
    expect((await runCommand(ctx, agent, '/stage explore keep exploring', signal))?.result)
      .toEqual({ kind: 'success', text: formatPrompt(stageSwitchPrompts.command.alreadyCurrent, { target: 'explore' }) })
    expect(steer).toHaveBeenCalledWith(expect.objectContaining({
      content: [{ type: 'text', text: 'keep exploring' }],
      source: { kind: 'user' },
    }))
  })
})

describe('HMR disposal', () => {
  // Scoped to what the composition unload test cannot see —
  // tests/loader-composition.spec.ts owns the service/tool/command removal
  // and the post-disposal listener check. Here: the stage:policy context
  // must leave the system-prompt assembly when the plugin fiber is disposed.
  it('unregisters the stage:policy context with the plugin fiber', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const fiber = await ctx.plugin(StageController, STAGE_CONFIG)
    const agent = await agentWithSession(ctx, 'disposed-recovery')
    const before = await assembleFor(ctx, agent)
    expect(before.contexts.map(context => context.name)).toContain('stage:policy')

    await fiber.dispose()
    const after = await assembleFor(ctx, agent)
    expect(after.contexts.map(context => context.name)).not.toContain('stage:policy')
  })
})

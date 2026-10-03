// Real-composition test per the DeepSeek Harness testing policy
// (<dsh-root>/docs/testing.md): a product-visible plugin needs a non-unit
// REAL-composition test — boot a test-only cordis.yml through the Loader,
// mock only external services or nondeterministic inputs, and assert
// model-visible request/log, durable state, or user-visible output.
//
// What is real here: the Loader/Include pair parses and mounts every entry of
// the cordis.yml; session, session-projection, system-prompt, tools, agent
// registry, user questions, commands, and token-meter are the shipping
// plugins; stage-switch loads exactly as a deployment loads it. What stands
// in for the outside world: the filesystem backend (MemoryFs) and the review
// answers (a user-questions answerer listener — a human is the
// nondeterministic input). Each session also starts the way the agent loop
// starts one — the mounted system-prompt plugin assembles the prompt and it
// enters the surface as the protected `system/message` head — so the
// full-transition replace is pinned against the head shape every deployment
// has. Only the node append itself is synthesized; the in-process boot has no
// app/process leg.
//
// The specifier→module resolution is pinned to already-imported source
// modules via `loader.internal.import` (the testing policy's source plane:
// bare imports resolve to src, never through package exports to built lib/,
// so a stale artifact cannot load a second copy of module singletons).
// Hand-built `ctx.plugin(...)` suites remain the unit tier; this file covers
// the composition tier and pins only the product-visible wiring between them.

import { writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Loader } from '@deepseek-ai/cordis-plugin-loader'
import { Include } from '@deepseek-ai/cordis-plugin-include'
import '@deepseek-ai/cordis-plugin-loader'
import '@deepseek-ai/cordis-plugin-include'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session } from '@deepseek-ai/dsh-session'
import SessionProjection from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import UserQuestionService, { type AskUserQuestionRequest } from '@deepseek-ai/dsh-user-questions'
import { assertV4RowAdmission } from '@deepseek-ai/dsh-session-format-v3-to-v4'
import StageController, { GOTO_STAGE, foldStage } from '../src/index.ts'
import { stageSwitchPrompts, formatPrompt, resolveStageSwitchPrompts } from '../src/prompts.ts'

/** The Chinese dictionary the zh composition case expects, derived from the same resolver the service uses. */
const ZH = resolveStageSwitchPrompts('zh')
import {
  APPROVE_LABEL, MemoryFs, STAGE_CONFIG, STAGE_FIRST, STAGE_NAMES, STAGE_SECOND, STAGE_THIRD, TEST_STAGES,
  assembleFor, boundary, openTurn, promptTexts, stageInstruction, stageNoticeSummaries,
} from './helpers/shared.ts'
import {
  appendSystemHead, makeAgent, mkdtemp, rm, tmpdir, join,
} from './helpers/loader-composition.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

const STAGE_ROWS = TEST_STAGES
  .map(stage => `      - name: ${stage.name}\n        instruction: ${JSON.stringify(stage.instruction)}`)
  .join('\n')

async function loadComposition(
  extraStageConfig: readonly string[] = [],
): Promise<{ ctx: Context; agent: Agent & { session: Session } }> {
  root = await mkdtemp(join(tmpdir(), 'stage-switch-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: 'test:memory-fs'",
    "- name: '@deepseek-ai/dsh-session'",
    "- name: '@deepseek-ai/dsh-session-projection'",
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-token-meter'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@deepseek-ai/dsh-agent'",
    "- name: '@deepseek-ai/dsh-user-questions'",
    "- name: '@deepseek-ai/dsh-commands'",
    "- id: stage-switch",
    "  name: '@ai4rpg/dsh-stage-switch'",
    '  config:',
    '    stages:',
    STAGE_ROWS,
    `    section: ${JSON.stringify(STAGE_CONFIG.section)}`,
    ...extraStageConfig,
    '',
  ].join('\n'))

  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader, {})
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['test:memory-fs', MemoryFs],
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-session-projection', SessionProjection],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-token-meter', TokenMeter],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-user-questions', UserQuestionService],
    ['@deepseek-ai/dsh-commands', CommandRuntime],
    ['@ai4rpg/dsh-stage-switch', StageController],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await context.loader.await()

  const agent = makeAgent(context, 'agent-1', '/workspace')
  // The command child (`ctx.inject(['commands'])`) settles during boot; poll
  // briefly instead of guessing a tick count.
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (context.commands.list(agent).some(command => command.name === 'stage')) break
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  // Every real session leads with the system prompt, so every case here does.
  await appendSystemHead(context, agent)
  return { ctx: context, agent }
}

let callCounter = 0
function callStage(ctx: Context, name: string, agent: Agent, args: Record<string, unknown>) {
  return ctx.tools.execute({
    callId: ToolCallId(`loader-call-${++callCounter}`),
    name,
    arguments: args,
    signal: new AbortController().signal,
    agent,
  })
}

describe('real Loader composition through cordis.yml', () => {
  it('boots the plugin, contributes to all three registries, and injects the initial stage prompt once', { timeout: 60_000 }, async () => {
    const { ctx, agent } = await loadComposition()

    // The composition provides the service, the model-visible tool, and the
    // user-facing command — the three registries the plugin contributes to.
    expect(ctx.get('stage')).toBeInstanceOf(StageController)
    expect(ctx.tools.get(GOTO_STAGE)).toBeDefined()
    // Exactly one command contribution (no other mounted plugin adds
    // commands), so the unload test's post-disposal `toEqual([])` pins removal
    // against a real baseline — the hand-built `removes the contributed
    // command` unit case's exact-list pin, merged here.
    expect(ctx.commands.list(agent).map(command => command.name)).toEqual(['stage'])

    // The initial stage prompt rides the first accepted pre-step as a durable
    // stage-switch notice — the single record the fold reads on resume.
    await boundary(ctx, agent, 'pre-step')
    expect(promptTexts(agent).filter(text => text.startsWith('Current stage:')))
      .toEqual([`Current stage: ${STAGE_FIRST}\n${stageInstruction(STAGE_FIRST)}`])
    expect(stageNoticeSummaries(agent.session)).toEqual([`Current stage: ${STAGE_FIRST}`])
    expect(foldStage(agent.session.snapshotEvents())).toBe(STAGE_FIRST)

    // The read path is the session-projection seam: the service's reads go
    // through the registered `stage` unit (the harness deprecated the
    // synchronous whole-log readers), so the composition pins that the unit
    // is live and carries the folded state the service reads.
    expect(ctx.sessionProjections.stateOf(agent.session, 'stage'))
      .toMatchObject({ stage: STAGE_FIRST, hasStagePrompt: true })

    // Model-visible request variables name the folded stage and the targets.
    const assembly = await assembleFor(ctx, agent)
    expect(assembly.variables['stage_current']).toBe(STAGE_FIRST)
    expect(assembly.variables['stage_targets']).toBe(STAGE_NAMES.slice(1).join(', '))

    // The second boundary carries no prompt: the log already has one.
    await boundary(ctx, agent, 'pre-step')
    expect(promptTexts(agent).filter(text => text.startsWith('Current stage:'))).toHaveLength(1)
  })

  it('reviews goto_stage, writes the handoff, and records the switch durably at the boundary', { timeout: 60_000 }, async () => {
    const { ctx, agent } = await loadComposition()
    const asked: AskUserQuestionRequest[] = []
    ctx.on('user-questions/request', (request) => {
      asked.push(request)
      return Promise.resolve({ answers: [{ id: 'stage-review', selected: [APPROVE_LABEL] }] })
    })

    // The session leads with the system prompt the loop appends at session
    // start: the protected head the full-transition replace must skip.
    expect(agent.session.surface.nodes).toHaveLength(1)
    const headText = promptTexts(agent)[0]
    expect(headText).toBeDefined()
    openTurn(agent.session)
    // The turn's user message is already on the surface when the model calls
    // goto_stage, so the replace shadows a real body behind the head.
    agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'old work' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    const handoff = '# Implement\n\n- Completed: exploration'
    const result = await callStage(ctx, GOTO_STAGE, agent, { stage: STAGE_SECOND, handoff })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected approved transition')
    expect(result.value).toMatchObject({ approved: true, stage: STAGE_SECOND })
    expect((result.value as { handoffPath: string }).handoffPath).toBe(`/workspace/handoff/agent-1/${STAGE_SECOND}.md`)

    // The handoff document reached the fs service before the review, byte-exact.
    const fs = ctx.get('fs') as MemoryFs
    expect(fs.writes).toEqual([{ path: `/workspace/handoff/agent-1/${STAGE_SECOND}.md`, content: handoff }])

    // The review went through the real user-questions seam, addressed to the
    // calling agent, carrying the handoff as detail.
    expect(asked).toHaveLength(1)
    expect(asked[0]?.agent).toBe(agent)
    expect(asked[0]?.questions[0]).toMatchObject({
      header: stageSwitchPrompts.review.header,
      detail: handoff,
    })
    expect(asked[0]?.questions[0]?.options?.map(option => option.label)).toEqual([
      stageSwitchPrompts.review.approveLabel,
      stageSwitchPrompts.review.keepStageLabel,
    ])

    // The switch is boundary-applied, not immediate.
    expect(foldStage(agent.session.snapshotEvents())).toBeUndefined()
    await boundary(ctx, agent, 'step-start')
    expect(foldStage(agent.session.snapshotEvents())).toBe(STAGE_SECOND)
    expect(stageNoticeSummaries(agent.session)).toContain(`Stage switched to ${STAGE_SECOND}`)
    const texts = promptTexts(agent)
    // The protected head survived in front of the notice, and only the body
    // was shadowed: a replace range covering node 0 throws in the harness and
    // the approved transition would never land.
    expect(texts[0]).toBe(headText)
    expect(texts[1]).toContain(formatPrompt(stageSwitchPrompts.notice.handoffReplaced, {
      stage: STAGE_SECOND,
      path: `/workspace/handoff/agent-1/${STAGE_SECOND}.md`,
    }))
    // The step's own user message lands after the handoff notice.
    expect(texts.at(-1)).toBe('boundary probe')
    expect(agent.session.surface.nodes).toHaveLength(3)
    // The archived body stays in the durable log for the human transcript.
    expect(agent.session.snapshotEvents().some(event =>
      event.type === 'user/message' && event.data.content.some(
        (block: { type: string; text?: string }) => block.type === 'text' && block.text === 'old work'))).toBe(true)
  })

  it('writes durable stage records that native V4 row admission accepts', { timeout: 60_000 }, async () => {
    // Session format V4 refuses the retired shared `{ kind: 'plugin', plugin }`
    // source wrapper at the persistence writer, so a stage record the in-memory
    // Session accepts can still fail in every real deployment. This case feeds
    // the records of every producer path through the shipping V4 admission and
    // pins both directions: our producer-owned kind is admitted, the retired
    // wrapper is refused.
    const { ctx, agent } = await loadComposition()
    ctx.on('user-questions/request', () => Promise.resolve({
      answers: [{ id: 'stage-review', selected: [APPROVE_LABEL] }],
    }))
    await boundary(ctx, agent, 'pre-step')
    await ctx.commands.execute(agent, `/stage ${STAGE_THIRD}`, [], new AbortController().signal)
    openTurn(agent.session)
    await callStage(ctx, GOTO_STAGE, agent, { stage: STAGE_SECOND, handoff: '# Handoff' })
    await boundary(ctx, agent, 'step-start')

    const messages = agent.session.snapshotEvents()
      .flatMap(event => event.type === 'user/message' ? [event.data] : [])
    expect(stageNoticeSummaries(agent.session)).toHaveLength(3)
    for (const message of messages) {
      expect(() => assertV4RowAdmission({ type: 'user/message', data: message })).not.toThrow()
    }
    expect(() => assertV4RowAdmission({
      type: 'user/message',
      data: {
        id: 'legacy-shape',
        content: [{ type: 'text', text: `Current stage: ${STAGE_FIRST}` }],
        source: { kind: 'plugin', plugin: 'stage-switch', form: 'notice', summary: `Current stage: ${STAGE_FIRST}` },
      },
    })).toThrow(/producer-owned source kind/)
  })

  it('appends the handoff notice when the surface holds only the system prompt', { timeout: 60_000 }, async () => {
    const { ctx, agent } = await loadComposition()
    ctx.on('user-questions/request', () => Promise.resolve({
      answers: [{ id: 'stage-review', selected: [APPROVE_LABEL] }],
    }))

    const headText = promptTexts(agent)[0]
    expect(headText).toBeDefined()
    // No turn message yet, so there is no body to shadow: the notice appends
    // behind the protected head instead of replacing it.
    expect(agent.session.surface.nodes).toHaveLength(1)
    openTurn(agent.session)
    const result = await callStage(ctx, GOTO_STAGE, agent, {
      stage: STAGE_SECOND,
      handoff: '# Implement\n\n- Completed: exploration',
    })
    expect(result.isError).toBe(false)
    await boundary(ctx, agent, 'step-start')
    expect(foldStage(agent.session.snapshotEvents())).toBe(STAGE_SECOND)
    const texts = promptTexts(agent)
    expect(texts[0]).toBe(headText)
    expect(texts[1]).toContain(formatPrompt(stageSwitchPrompts.notice.handoffReplaced, {
      stage: STAGE_SECOND,
      path: `/workspace/handoff/agent-1/${STAGE_SECOND}.md`,
    }))
    expect(texts.at(-1)).toBe('boundary probe')
    expect(agent.session.surface.nodes).toHaveLength(3)
  })

  it('switches an idle session immediately through the real command runtime', { timeout: 60_000 }, async () => {
    const { ctx, agent } = await loadComposition()
    const result = await ctx.commands.execute(agent, `/stage ${STAGE_SECOND}`, [], new AbortController().signal)
    expect(result?.result).toEqual({
      kind: 'success',
      text: formatPrompt(stageSwitchPrompts.command.switched, { target: STAGE_SECOND }),
    })
    // The idle commit writes the durable notice the fold reads on resume.
    expect(foldStage(agent.session.snapshotEvents())).toBe(STAGE_SECOND)
    expect(stageNoticeSummaries(agent.session)).toEqual([`Current stage: ${STAGE_SECOND}`])
  })

  it('renders the review dialog in Chinese when the row config declares language: zh', { timeout: 60_000 }, async () => {
    // The deployment-declared language route: the composition's row config
    // picks the zh dictionary at construction — no install-time merge, and
    // the choice survives reinstalls because it lives in the composition.
    const { ctx, agent } = await loadComposition(['    language: zh'])
    const asked: AskUserQuestionRequest[] = []
    ctx.on('user-questions/request', (request) => {
      asked.push(request)
      return Promise.resolve({ answers: [{ id: 'stage-review', selected: [ZH.review.approveLabel] }] })
    })
    openTurn(agent.session)
    const result = await callStage(ctx, GOTO_STAGE, agent, { stage: STAGE_SECOND, handoff: '# 交接' })
    expect(result.isError).toBe(false)
    expect(asked).toHaveLength(1)
    expect(asked[0]?.questions[0]?.header).toBe(ZH.review.header)
    expect(asked[0]?.questions[0]?.question)
      .toBe(formatPrompt(ZH.review.fullQuestion, { stage: STAGE_SECOND }))
    expect(asked[0]?.questions[0]?.detail).toBe('# 交接')
    expect(asked[0]?.questions[0]?.options?.map(option => option.label))
      .toEqual([ZH.review.approveLabel, ZH.review.keepStageLabel])
    // The switch still lands: the boundary flush records the new stage.
    await boundary(ctx, agent, 'step-start')
    expect(foldStage(agent.session.snapshotEvents())).toBe(STAGE_SECOND)
  })

  it('unloads cleanly: disposing the plugin fiber removes the service, the tool, and the command', { timeout: 60_000 }, async () => {
    const { ctx, agent } = await loadComposition()
    await boundary(ctx, agent, 'pre-step')
    expect(stageNoticeSummaries(agent.session)).toHaveLength(1)

    // The disposal leg of a loader HMR reload: dispose every running fiber of
    // the stage-switch plugin (the same unload cordis runs when the entry
    // reloads), then assert the contributions are gone.
    const runtime = ctx.registry.get(StageController)
    expect(runtime).toBeDefined()
    const fibers = [...runtime!.fibers]
    expect(fibers).not.toHaveLength(0)
    await Promise.all(fibers.map(fiber => fiber.dispose()))
    expect(ctx.get('stage')).toBeUndefined()
    expect(ctx.tools.get(GOTO_STAGE)).toBeUndefined()
    expect(ctx.commands.list(agent)).toEqual([])

    // After disposal the pre-step listener is gone: no stage-switch message is
    // appended for the session, and the fold stays where the record left it.
    await boundary(ctx, agent, 'step-start')
    expect(stageNoticeSummaries(agent.session)).toHaveLength(1)
    expect(foldStage(agent.session.snapshotEvents())).toBe(STAGE_FIRST)
    // The projection registration was effect-scoped on the plugin's fiber:
    // disposal removes the key (capability absence, not a stale read path).
    expect(ctx.sessionProjections.stateOf(agent.session, 'stage')).toBeUndefined()
  })
})

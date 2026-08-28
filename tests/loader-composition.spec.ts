// Real-composition test per the DeepSeek Harness testing policy
// (<dsh-root>/docs/testing.md): a product-visible plugin needs a non-unit
// REAL-composition test — boot a test-only cordis.yml through the Loader,
// mock only external services or nondeterministic inputs, and assert
// model-visible request/log, durable state, or user-visible output.
//
// What is real here: the Loader/Include pair parses and mounts every entry of
// the cordis.yml; session, system-prompt, tools, agent registry, user
// questions, commands, and token-meter are the shipping plugins; stage-switch
// loads exactly as a deployment loads it. What stands in for the outside
// world: the filesystem backend (MemoryFs) and the review answers (a mock
// user-questions provider — a human is the nondeterministic input).
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
import { CallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import UserQuestionService, { type AskUserQuestionRequest } from '@deepseek-ai/dsh-user-questions'
import StageController, { GOTO_STAGE, foldStage } from '../src/index.ts'
import { stageSwitchPrompts, formatPrompt } from '../src/prompts.ts'
import {
  APPROVE_LABEL, MemoryFs, STAGE_CONFIG, TEST_STAGES,
  assembleFor, boundary, openTurn, promptTexts, stageNoticeSummaries,
} from './helpers/shared.ts'
import { makeAgent, mkdtemp, rm, tmpdir, join } from './helpers/loader-composition.ts'

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

async function loadComposition(): Promise<{ ctx: Context; agent: Agent & { session: Session } }> {
  root = await mkdtemp(join(tmpdir(), 'stage-switch-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: 'test:memory-fs'",
    "- name: '@deepseek-ai/dsh-session'",
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
    '',
  ].join('\n'))

  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader, {})
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['test:memory-fs', MemoryFs],
    ['@deepseek-ai/dsh-session', SessionStore],
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
  return { ctx: context, agent }
}

let callCounter = 0
function callStage(ctx: Context, name: string, agent: Agent, args: Record<string, unknown>) {
  return ctx.tools.execute({
    callId: CallId(`loader-call-${++callCounter}`),
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
      .toEqual(['Current stage: explore\nExplore the problem space and write a plan.'])
    expect(stageNoticeSummaries(agent.session)).toEqual(['Current stage: explore'])
    expect(foldStage(agent.session.events)).toBe('explore')

    // Model-visible request variables name the folded stage and the targets.
    const assembly = await assembleFor(ctx, agent)
    expect(assembly.variables['stage_current']).toBe('explore')
    expect(assembly.variables['stage_targets']).toBe('implement, verify')

    // The second boundary carries no prompt: the log already has one.
    await boundary(ctx, agent, 'pre-step')
    expect(promptTexts(agent).filter(text => text.startsWith('Current stage:'))).toHaveLength(1)
  })

  it('reviews goto_stage, writes the handoff, and records the switch durably at the boundary', { timeout: 60_000 }, async () => {
    const { ctx, agent } = await loadComposition()
    const asked: AskUserQuestionRequest[] = []
    ctx.userQuestions.registerProvider({
      ask: (request) => {
        asked.push(request)
        return Promise.resolve({ answers: [{ id: 'stage-review', selected: [APPROVE_LABEL] }] })
      },
    })

    openTurn(agent.session)
    const handoff = '# Implement\n\n- Completed: exploration'
    const result = await callStage(ctx, GOTO_STAGE, agent, { stage: 'implement', handoff })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected approved transition')
    expect(result.value).toMatchObject({ approved: true, stage: 'implement' })
    expect((result.value as { handoffPath: string }).handoffPath).toBe('/workspace/handoff/agent-1/implement.md')

    // The handoff document reached the fs service before the review, byte-exact.
    const fs = ctx.get('fs') as MemoryFs
    expect(fs.writes).toEqual([{ path: '/workspace/handoff/agent-1/implement.md', content: handoff }])

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
    expect(foldStage(agent.session.events)).toBeUndefined()
    await boundary(ctx, agent, 'step-start')
    expect(foldStage(agent.session.events)).toBe('implement')
    expect(stageNoticeSummaries(agent.session)).toContain('Stage switched to implement')
    const texts = promptTexts(agent)
    expect(texts[0]).toContain(formatPrompt(stageSwitchPrompts.notice.handoffReplaced, {
      stage: 'implement',
      path: '/workspace/handoff/agent-1/implement.md',
    }))
    // The step's own user message lands after the handoff notice.
    expect(texts.at(-1)).toBe('boundary probe')
  })

  it('switches an idle session immediately through the real command runtime', { timeout: 60_000 }, async () => {
    const { ctx, agent } = await loadComposition()
    const result = await ctx.commands.execute(agent, '/stage implement', [], new AbortController().signal)
    expect(result?.result).toEqual({
      kind: 'success',
      text: formatPrompt(stageSwitchPrompts.command.switched, { target: 'implement' }),
    })
    // The idle commit writes the durable notice the fold reads on resume.
    expect(foldStage(agent.session.events)).toBe('implement')
    expect(stageNoticeSummaries(agent.session)).toEqual(['Current stage: implement'])
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
    expect(foldStage(agent.session.events)).toBe('explore')
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import { createScope } from '@deepseek-ai/dsh-scope'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import SessionProjection, { type ProjectionHandle } from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as NativeExecutor from '@deepseek-ai/dsh-tool-executor-native'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import StageController, { GOTO_STAGE, type StageConfig } from '../src/index.ts'
import { makeAgent } from './helpers/loader-composition.ts'
import { STAGE_CONFIG, STAGE_FIRST, STAGE_SECOND, STAGE_THIRD, assembleFor, boundary } from './helpers/shared.ts'

const contexts: Context[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

async function host(): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjection)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(NativeExecutor)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(AgentRegistry)
  return ctx
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

function observeStage() {
  let service!: StageController
  class ObservedStage extends StageController {
    constructor(ctx: Context, config: StageConfig) {
      super(ctx, config)
      service = this
    }
  }
  return { plugin: ObservedStage, service: () => service }
}

describe('stage projection ready lifetime', () => {
  it('withholds every dependent callback and consumer until registration resolves', async () => {
    const ctx = await host()
    const agent = makeAgent(ctx, 'stage-ready', '/workspace')
    const entered = deferred()
    const release = deferred()
    const register = SessionProjection.prototype.register
    const spy = vi.spyOn(SessionProjection.prototype, 'register').mockImplementationOnce(async function (this: SessionProjection, ...args) {
      // Keep the real registration and its fiber ownership, delaying only its
      // asynchronous ready handoff (a nondeterministic activation boundary).
      const handle = await Reflect.apply(register, this, args)
      entered.resolve()
      await release.promise
      return handle
    })
    const observed = observeStage()
    const fiber = ctx.plugin(observed.plugin, STAGE_CONFIG)
    await entered.promise
    try {
      expect(ctx.get('stage')).toBeUndefined()
      expect(ctx.tools.get(GOTO_STAGE)).toBeUndefined()
      expect(ctx.commands.list(agent)).toEqual([])
      expect(() => observed.service().current(agent.session)).toThrow('not initialized')
      expect(() => observed.service().set(agent, STAGE_SECOND)).toThrow('not initialized')
      expect(() => observed.service().registerEligibility(() => true)).toThrow('not initialized')
      const assembly = await assembleFor(ctx, agent)
      expect(assembly.variables).not.toHaveProperty('stage_current')
      expect(assembly.contexts.map(context => context.name)).not.toContain('stage:policy')
      await boundary(ctx, agent, 'pre-step')
      expect(agent.session.deriveMessages().some(message => message.source.kind === 'stage-switch')).toBe(false)
    } finally {
      release.resolve()
      spy.mockRestore()
    }
    await fiber
    expect(ctx.get('stage')).toBeInstanceOf(StageController)
    expect(ctx.stage.current(agent.session)).toBe(STAGE_FIRST)
    expect(ctx.tools.get(GOTO_STAGE)).toBeDefined()
    // The optional command child is owned by initialization, too.
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(ctx.commands.list(agent).map(command => command.name)).toEqual(['stage'])
    await boundary(ctx, agent, 'pre-step')
    expect(agent.session.deriveMessages().filter(message => message.source.kind === 'stage-switch')).toHaveLength(1)
  })

  it('rejects activation without publishing consumers when registration fails', async () => {
    const ctx = await host()
    const agent = makeAgent(ctx, 'stage-rejected', '/workspace')
    const observed = observeStage()
    const failure = new Error('projection registration refused')
    vi.spyOn(SessionProjection.prototype, 'register').mockRejectedValueOnce(failure)
    const fiber = ctx.plugin(observed.plugin, STAGE_CONFIG)
    await expect(Promise.resolve(fiber)).rejects.toThrow('projection registration refused')
    expect(ctx.get('stage')).toBeUndefined()
    expect(ctx.tools.get(GOTO_STAGE)).toBeUndefined()
    expect(ctx.commands.list(agent)).toEqual([])
    expect((await assembleFor(ctx, agent)).variables).not.toHaveProperty('stage_current')
    await boundary(ctx, agent, 'pre-step')
    expect(agent.session.deriveMessages().some(message => message.source.kind === 'stage-switch')).toBe(false)
    expect(() => observed.service().current(agent.session)).toThrow(/not initialized|disposed/)
  })

  it('keeps a shared stage unit until the final owner releases, but invalidates each service', async () => {
    const ctx = await host()
    const firstOwner = createScope(ctx, {})
    const secondOwner = createScope(ctx, {})
    // Distinct preset-like contribution scopes and isolated service names,
    // sharing the host projection registry just as eager preset owners do.
    const firstFiber = await firstOwner.ctx.isolate('stage').plugin(StageController, STAGE_CONFIG)
    const secondFiber = await secondOwner.ctx.isolate('stage').plugin(StageController, STAGE_CONFIG)
    const first = firstFiber.ctx.stage
    const second = secondFiber.ctx.stage
    const agent = makeAgent(ctx, 'stage-owners', '/workspace')
    first.set(agent, STAGE_SECOND)
    expect(second.current(agent.session)).toBe(STAGE_SECOND)
    await firstOwner.dispose()
    expect(() => first.current(agent.session)).toThrow('disposed')
    expect(() => first.set(agent, STAGE_THIRD)).toThrow('disposed')
    expect(() => first.registerEligibility(() => true)).toThrow('disposed')
    second.set(agent, STAGE_THIRD)
    expect(second.current(agent.session)).toBe(STAGE_THIRD)
    expect(ctx.sessionProjections.snapshot(agent.session).values.stage?.stage).toBe(STAGE_THIRD)
    await secondOwner.dispose()
    expect(() => second.current(agent.session)).toThrow('disposed')
    expect(ctx.sessionProjections.snapshot(agent.session).values.stage).toBeUndefined()
  })

  it('restores the same checkpoint and tail through a newly activated service', async () => {
    const ctx = await host()
    const fiber = await ctx.plugin(StageController, STAGE_CONFIG)
    const agent = makeAgent(ctx, 'stage-cold', '/workspace')
    ctx.stage.set(agent, STAGE_SECOND)
    const checkpoint = ctx.sessionProjections.checkpoint(agent.session)
    expect(checkpoint.stage?.ver).toBe(3)
    agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'work after checkpoint' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    ctx.stage.set(agent, STAGE_THIRD)
    const expected = ctx.sessionProjections.snapshot(agent.session).values.stage
    const events = agent.session.snapshotEvents()
    await fiber.dispose()
    await ctx.plugin(StageController, STAGE_CONFIG)
    const floor = ctx.sessionProjections.restoreFloor(checkpoint)
    expect(floor).toBeDefined()
    if (floor === undefined) throw new Error('expected a restore floor')
    const restored = ctx.sessionProjections.restore(checkpoint, events.filter(event => event.seq >= floor), floor,
      agent.session.header, agent.session.inheritedEventCount)
    expect(restored.snapshot.values.stage).toEqual(expected)
    const cold = Session.create(agent.session.id, events, agent.session.header)
    ctx.sessionProjections.hydrate(cold, checkpoint, events.filter(event => event.seq >= floor), floor)
    expect(ctx.stage.current(cold)).toBe(STAGE_THIRD)
    expect(ctx.sessionProjections.snapshot(cold).values.stage).toEqual(expected)
    // A stale version refolds from the complete durable log, not a guessed default.
    const stale = { stage: { ...checkpoint.stage!, ver: 0 } }
    expect(ctx.sessionProjections.restore(stale, events, SessionLogOffset(0), cold.header, cold.inheritedEventCount)
      .snapshot.values.stage).toEqual(expected)
  })
})

describe('independently registered retained handles', () => {
  it('observes a rejected callable registration as a native Promise', async () => {
    const ctx = await host()
    const registration = ctx.sessionProjections.register({
      key: 'stage-lifecycle-invalid', stateVersion: -1, stateSchema: z.number(), init: () => 0, apply: state => state,
    })
    await expect(Promise.resolve(registration)).rejects.toThrow('stateVersion must be a non-negative integer')
  })

  it('retains on-demand reads after final release without keeping a live registration', async () => {
    const ctx = await host()
    const first = ctx.plugin(() => {})
    const second = ctx.plugin(() => {})
    await Promise.all([first.await(), second.await()])
    const definition = {
      key: 'stage-lifecycle-fixture', stateVersion: 1, stateSchema: z.number(), init: () => 0,
      apply: (state: number) => state + 1,
    }
    let firstHandle!: ProjectionHandle<number>
    let secondHandle!: ProjectionHandle<number>
    await first.ctx.plugin({
      inject: ['sessionProjections'],
      async apply(inner: Context) { firstHandle = await inner.sessionProjections.register(definition) },
    })
    await second.ctx.plugin({
      inject: ['sessionProjections'],
      async apply(inner: Context) { secondHandle = await inner.sessionProjections.register(definition) },
    })
    const session = Session.create(SessionId('retained-handle'))
    expect(firstHandle.stateOf(session)).toBe(0)
    await first.dispose()
    expect(ctx.sessionProjections.checkpoint(session)[definition.key]?.val).toBe(0)
    await secondHandle.dispose()
    expect(ctx.sessionProjections.restore({}, [], SessionLogOffset(0), session.header, session.inheritedEventCount)
      .checkpoint).not.toHaveProperty(definition.key)
    session.append('turn/start', { turn: 1 })
    expect(firstHandle.stateOf(session)).toBe(1)
    expect(secondHandle.readerFor(session)()).toBe(1)
    expect(ctx.sessionProjections.checkpoint(session)[definition.key]?.val).toBe(1)
    await second.dispose()
  })
})

/**
 * The plugin's registrations, and their removal when the plugin goes.
 *
 * The Cordis composition is real (a live fiber with the module's own inject
 * list and apply body, disposed through the unload cascade); the
 * sidebarRightTabs, slots, locale, and sessions faces are recorders, because
 * the published browser-bundle classes behind them are not Node-importable —
 * what matters here is what was handed to them: one type registration, one
 * dictionary registration, and one body seat under the type's id whose
 * per-session inject face carries the stage view source.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { STAGE_ID, STAGE_KIND } from '../src/client/definition.tsx'
import { apply, inject } from '../src/client/index.tsx'
import { apply as hostApply } from '../src/index.ts'
import { StageBody } from '../src/client/StageBody.tsx'
import { StageTitle } from '../src/client/StageTitle.tsx'
import { StageDock } from '../src/client/StageDock.tsx'
import { en, zh } from '../src/client/locales.ts'
import { STAGE_NAMES } from './helpers.ts'

interface Recorded {
  name: string
  key?: string
  id?: string
  order?: number
  locale?: string
  inject?: unknown
  component: unknown
}

async function boot() {
  const ctx = new Context()
  const types: Array<Record<string, unknown>> = []
  const tabs = {
    register: vi.fn((definition: Record<string, unknown>) => {
      types.push(definition)
      return () => { types.splice(types.indexOf(definition), 1) }
    }),
  }
  const registered: Recorded[] = []
  const slots = {
    inject: vi.fn((_name: string, register: () => () => void) => register()),
    register: vi.fn((options: Omit<Recorded, 'component'>, component: unknown) => {
      const entry: Recorded = { ...options, component }
      registered.push(entry)
      return () => { registered.splice(registered.indexOf(entry), 1) }
    }),
  }
  const dictionaries = new Map<string, unknown>()
  const locale = {
    bind: vi.fn(() => (key: string) => key),
    register: vi.fn((ns: string, dicts: unknown) => {
      dictionaries.set(ns, dicts)
      return () => { dictionaries.delete(ns) }
    }),
  }
  const sessions = { binding: vi.fn() }
  const sidebarRight = { openTabIn: vi.fn() }
  ctx.provide('sidebarRightTabs', tabs as never)
  ctx.provide('sidebarRight', sidebarRight as never)
  ctx.provide('slots', slots as never)
  ctx.provide('locale', locale as never)
  ctx.provide('sessions', sessions as never)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { types, registered, dictionaries, fiber, sessions, sidebarRight }
}

describe('ui-sidebar-stage apply', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('registers the type, its dictionaries, the body, the live title, and the composer dock', async () => {
    const { types, registered, dictionaries } = await boot()
    const definition = types[0] as Record<string, unknown>
    expect(definition.id).toBe(STAGE_ID)
    expect(definition.kind).toBe(STAGE_KIND)
    expect(definition.priority).toBe('extension')
    const guide = definition.guide as Array<Record<string, unknown>>
    expect(guide).toHaveLength(1)
    expect(dictionaries.get('sidebarStage')).toEqual({ zh, en })
    // The body and live title are keyed by the implementation's id, not the
    // kind; the dock is a list entry under the kind.
    const body = registered.find(entry => entry.name === 'sidebar.right.pane.tab')
    const title = registered.find(entry => entry.name === 'sidebar.right.pane.tab.title')
    const dock = registered.find(entry => entry.name === 'conversation.input.dock')
    expect(body?.key).toBe(STAGE_ID)
    expect(body?.locale).toBe('sidebarStage')
    expect(body?.component).toBe(StageBody)
    expect(typeof body?.inject).toBe('function')
    expect(title?.key).toBe(STAGE_ID)
    expect(title?.locale).toBe('sidebarStage')
    expect(title?.component).toBe(StageTitle)
    expect(dock?.id).toBe(STAGE_KIND)
    expect(dock?.order).toBe(20)
    expect(dock?.locale).toBe('sidebarStage')
    expect(dock?.component).toBe(StageDock)
  })

  it('opens the stage tab from the composer dock', async () => {
    const { registered, sidebarRight } = await boot()
    const dock = registered.find(entry => entry.name === 'conversation.input.dock')
    const face = dock?.inject as (sessionId: string) => { openStage: () => void }
    face('s-1').openStage()
    expect(sidebarRight.openTabIn).toHaveBeenCalledWith('s-1', STAGE_KIND)
  })

  it('builds the stage view source and the switch action per session in the inject face', async () => {
    const { registered, sessions } = await boot()
    const body = registered.find(entry => entry.name === 'sidebar.right.pane.tab')
    const injectFace = body?.inject as (sessionId: string) => {
      hooks: { stage: unknown }
      switchStage: (stage: string) => Promise<unknown>
    }
    sessions.binding.mockReturnValue({ eventSource: { getSnapshot: () => ({ entries: [] }), subscribe: () => () => {} } })
    const face = injectFace('s-1')
    const stage = face.hooks.stage as { getSnapshot: () => { records: unknown[] }, subscribe: (listener: () => void) => () => void }
    // Lazy attach: the binding is borrowed on the first subscriber, not on face creation.
    expect(sessions.binding).not.toHaveBeenCalled()
    const unsubscribe = stage.subscribe(() => {})
    expect(sessions.binding).toHaveBeenCalledWith('s-1')
    expect(stage.getSnapshot().records).toEqual([])
    unsubscribe()
    // The switch action submits `/stage <name>` through the same binding's
    // command face; the placeholder command mock answers `matched: true`.
    sessions.binding.mockReturnValue({
      eventSource: { getSnapshot: () => ({ entries: [] }), subscribe: () => () => {} },
      session: { command: (line: string) => Promise.resolve({ ok: true, value: { matched: line.startsWith('/stage ') } }) },
    })
    await expect(face.switchStage(STAGE_NAMES.target)).resolves.toEqual({ ok: true })
  })

  it('takes every registration back when the plugin is disposed', async () => {
    const { types, registered, dictionaries, fiber } = await boot()
    await fiber.dispose()
    expect(types).toEqual([])
    expect(registered).toEqual([])
    expect(dictionaries.size).toBe(0)
  })
})

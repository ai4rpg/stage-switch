/**
 * Workspace integration: this package's client plugin mounted through the
 * PRODUCTION slot machinery of a local dsh source checkout.
 *
 * Opt-in via `npm run test:integration` (sets DSH_WORKSPACE_INTEGRATION and
 * runs under `vitest.workspace.config.ts`, whose aliases resolve every
 * `@deepseek-ai/*` to the checkout). Skipped everywhere else: the default
 * `npm test` never activates this layer, and the published
 * `dsh-client-test-runtime` cannot serve it (its lib imports workspace-only
 * `src/*` paths — see AGENTS.md).
 *
 * What this layer adds over the self-contained specs: the real SlotRegistry
 * and renderer (not recorders) synthesizing the `useStage` hook prop from the
 * registration's inject face, the real locale seat, a real session scope, and
 * a live event-window update re-rendering the body.
 */
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { STAGE_NAMES } from './helpers.ts'
import own from '../package.json' with { type: 'json' }
import { HARNESS_ROOT as HARNESS } from './workspace-root.ts'
const active = process.env.DSH_WORKSPACE_INTEGRATION === '1' && existsSync(`${HARNESS}/tsconfig.base.json`)

describe.skipIf(!active)('workspace integration over the dsh source checkout', () => {
  it('renders the stage tab body through the production slot system with a live session', async () => {
    // Drift guard: the checkout must sit on the same dsh line this package's
    // devDependencies pin (read from package.json, so a dependency bump moves
    // the guard with it). A checkout that moved on (git pull) fails loud
    // here instead of silently testing a different dsh than the one this
    // package ships against — the one benefit a git submodule would have
    // bought, at none of its weight.
    const ownDeps = (own as { devDependencies: Record<string, string> }).devDependencies
    const line = /^\^(\d+\.\d+)/.exec(ownDeps['@deepseek-ai/dsh-client-locale'] ?? '')?.[1]
    const checkout = JSON.parse(readFileSync(`${HARNESS}/package.json`, 'utf8')) as { version?: string }
    if (line === undefined || !checkout.version?.startsWith(`${line}.`)) {
      throw new Error(
        `workspace integration: the dsh checkout at ${HARNESS} is ${checkout.version ?? 'unknown'},`
        + ` expected the ${line ?? '?'} line this package's devDependencies pin.`
        + ' Point DSH_HARNESS_ROOT at a matching checkout, or update the devDependencies and this guard together.',
      )
    }

    const { SlotTestRuntime } = await import('@deepseek-ai/dsh-client-test-runtime')
    const { LocaleRuntime } = await import('@deepseek-ai/dsh-client-locale/client')
    const { STAGE_ID } = await import('../src/client/definition.tsx')
    const { en } = await import('../src/client/locales.ts')
    const { apply, inject } = await import('../src/client/index.tsx')
    type SessionEventLikeEntry = import('@deepseek-ai/dsh-api-session-controller/client').SessionEventLikeEntry

    const stageEntry = (seq: number, summary: string): Extract<SessionEventLikeEntry, { type: 'event' }> => ({
      type: 'event',
      event: {
        type: 'user/message',
        seq,
        time: 1_700_000_000_000 + seq,
        data: {
          id: `m-${seq}`,
          content: [{ type: 'text', text: 'x' }],
          source: { kind: 'stage-switch', form: 'notice', summary },
        },
      } as never,
    })

    const runtime = await SlotTestRuntime.create()
    try {
      // The runtime provides slots/sessions; the tab registry is
      // ui-sidebar-right's service, which the runtime does not carry. Locale
      // uses the real runtime + installLocale (the official pattern), so the
      // renderer synthesizes the real `t` seat from this package's dictionary.
      runtime.ctx.provide('sidebarRightTabs', { register: () => () => {} })
      const locale = new LocaleRuntime(runtime.ctx)
      runtime.ctx.provide('locale', locale)
      runtime.slots.installLocale(locale)

      const handle = await runtime.mount({ inject: [...inject], apply })
      // The declared inject face (tabInfo hooks) is ui-sidebar-right's; this
      // suite exercises only this package's own face, so the declaration is
      // cast to the runtime's children contract.
      await runtime.declare({ 'sidebar.right.pane.tab': { kind: 'keyed', scope: 'session' } } as never)
      const sessionId = await runtime.sessions.add({ id: 's-stage' })
      const reference = runtime.sessions.retain(sessionId)
      await reference.ready
      await runtime.sessions.replaceEvents(sessionId, [
        stageEntry(1, `Current stage: ${STAGE_NAMES.first}`),
        stageEntry(2, `Stage switched to ${STAGE_NAMES.second}`),
      ])

      const view = runtime.renderSlot('sidebar.right.pane.tab', {}, { session: reference, entryKey: STAGE_ID })
      expect(view.container.querySelector('[data-stage-current]')?.textContent).toBe(STAGE_NAMES.second)
      expect([...view.container.querySelectorAll('[data-stage-history] li')].map(item => item.textContent))
        .toEqual([`${en.entered} ${STAGE_NAMES.first}`, `${en.switched} ${STAGE_NAMES.second}`])

      // Live update: a new stage record re-renders the body.
      await runtime.sessions.appendEvent(sessionId, stageEntry(3, `Stage switched to ${STAGE_NAMES.third}`))
      expect(view.container.querySelector('[data-stage-current]')?.textContent).toBe(STAGE_NAMES.third)

      await handle.dispose()
    } finally {
      await runtime.dispose()
    }
  })
})

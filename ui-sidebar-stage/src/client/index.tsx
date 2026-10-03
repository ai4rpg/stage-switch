/**
 * Browser half: register `stage` as a right-Sidebar tab type.
 *
 * The public two-stage path, unmodified: the type into `ctx.sidebarRightTabs`,
 * the body into the keyed `sidebar.right.pane.tab` seat under the type's id.
 * The per-session inject face carries one `hooks` compartment — `stage` —
 * which the slot runtime renders as the body's `useStage` selector prop.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { STAGE_ID, stageDefinition } from './definition.tsx'
import { StageBody } from './StageBody.tsx'
import { createStageSource } from './store.ts'
import { en, NS, zh } from './locales.ts'

export type { StageRecord } from './fold.ts'
export type { StageView } from './store.ts'
export type { StageBodyProps } from './StageBody.tsx'

/** Required browser services: the tab registry, the slots seat, the session bindings, and copy. */
export const inject = ['slots', 'locale', 'sidebarRightTabs', 'sessions']

/**
 * Client plugin body: register the type, its dictionaries, and its body seat.
 * @param ctx - client root context carrying the registry, the slots, and the session service.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-sidebar-stage: dictionaries')
  ctx.effect(() => ctx.sidebarRightTabs.register(stageDefinition(t)), 'ui-sidebar-stage: stage type')
  const sessions = ctx.sessions
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    {
      name: 'sidebar.right.pane.tab',
      key: STAGE_ID,
      locale: NS,
      inject: (sessionId: SessionId) => ({ hooks: { stage: createStageSource(sessions, sessionId) } }),
    },
    StageBody,
  )), 'ui-sidebar-stage: stage tab body')
}

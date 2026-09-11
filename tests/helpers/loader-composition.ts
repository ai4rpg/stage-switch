// Shared infrastructure for the real Loader composition spec
// (tests/loader-composition.spec.ts). The composition boots a test-only
// cordis.yml through @deepseek-ai/cordis-plugin-loader + cordis-plugin-include;
// what stands in for the outside world: the filesystem backend (MemoryFs) and
// the review answers (a user-questions answerer listener — a human is the
// nondeterministic input); everything else is the real shipping plugin.
//
// Tier-specific pieces stay here: makeAgent registers a real agent on the
// context (the composition exercises the registered-agent path). Fixtures and
// session projections shared with the unit tier live in tests/helpers/shared.ts.

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'

export { mkdtemp, rm, tmpdir, join }

export function makeAgent(ctx: Context, id: string, cwd: string): Agent {
  const session = ctx.sessions.create(SessionId(id), { meta: { cwd } })
  const scope = ctx.plugin(() => {})
  const value: Agent = {
    id: SessionId(id),
    options: {},
    session,
    inbox: {
      nextTurn: [],
      nextStep: [],
      splice() {},
      claimed() {},
    } as never,
    ctx: scope.ctx,
    status: 'idle',
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject: () => {},
    cancel: () => {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  ctx.agents.register(value)
  return value
}

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
import { createSystemMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { assembleFor } from './shared.ts'

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

/**
 * Start the session the way the agent loop starts one: the mounted
 * dsh-system-prompt plugin assembles the prompt for the agent, and the
 * rendered text enters the surface as the protected `system/message` head.
 * Every deployment's surface therefore leads with a system node, which the
 * harness protects against any rewrite but a `system/message` over exactly
 * that node — the composition cases must see that shape or they cannot catch
 * a replace that covers it. Only the node append itself is synthesized: the
 * in-process boot has no app/process leg.
 */
export async function appendSystemHead(ctx: Context, agent: Agent): Promise<void> {
  agent.session.append('system/message', {
    turn: 0,
    step: 1,
    message: createSystemMessage(renderPrompt(await assembleFor(ctx, agent)), '@deepseek-ai/dsh-system-prompt'),
  }, { surfaceOp: 'append' })
}

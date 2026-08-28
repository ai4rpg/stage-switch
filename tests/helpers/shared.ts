// Shared fixtures and session projections for the two test tiers: the
// hand-built `ctx.plugin(...)` unit suite (tests/stage-switch.spec.ts) and
// the real Loader composition suite (tests/loader-composition.spec.ts).
// Both tiers assert on the same fixtures and drive the same session
// projections; keeping them here instead of duplicated inline means the two
// tiers cannot drift apart when a dependency (dsh-fs, dsh-session) changes.
//
// Tier-specific setup deliberately stays in the tier files: agentWithSession
// (unit: header variants, scoped ctx) and makeAgent (composition: a real
// registered agent) are NOT interchangeable and must not be unified here.

import { isAbsolute, join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { agentEvents, type Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, type UserMessage } from '@deepseek-ai/dsh-session'
import { FileSystem, FsTargetKey, FsVersion } from '@deepseek-ai/dsh-fs'
import type { FsTarget, FsWriteIntent, FsWriteOutcome } from '@deepseek-ai/dsh-fs'
import type { StageConfig, StageDefinition } from '../../src/index.ts'
import { stageSwitchPrompts } from '../../src/prompts.ts'

export const TEST_STAGES: StageDefinition[] = [
  { name: 'explore', instruction: 'Explore the problem space and write a plan.' },
  { name: 'implement', instruction: 'Implement the approved plan.' },
  { name: 'verify', instruction: 'Verify the implementation with tests.' },
]
export const STAGE_CONFIG = {
  stages: TEST_STAGES,
  section: 'The current stage is complete. Call goto_stage to switch to a target stage.',
} satisfies StageConfig

/**
 * Review answers the test harness submits. Derived from the configured labels
 * (single editable source in `src/prompts.json`) so a copy edit never breaks
 * the answer fixtures: the review only consents on an exact label match.
 */
export const APPROVE_LABEL = stageSwitchPrompts.review.approveLabel
export const KEEP_LABEL = stageSwitchPrompts.review.keepStageLabel

/** In-memory filesystem backend: records every handoff write for assertions. */
export class MemoryFs extends FileSystem {
  readonly writes: Array<{ path: string; content: string }> = []
  /** The per-call sandbox policy each write carried (undefined = omitted). */
  readonly policies: unknown[] = []
  private readonly files = new Map<string, string>()

  async resolve(path: string, opts?: { cwd?: string }): Promise<FsTarget> {
    const absolute = isAbsolute(path) ? path : join(opts?.cwd ?? '/', path)
    return { targetKey: FsTargetKey(`key:${absolute}`), displayPath: absolute }
  }

  processPath(target: FsTarget): string {
    return target.displayPath
  }

  fileUrl(target: FsTarget): string {
    return `file://${target.displayPath}`
  }

  contains(parent: FsTarget, child: FsTarget): boolean {
    return child.displayPath.startsWith(parent.displayPath)
  }

  async stat(): Promise<undefined> {
    return undefined
  }

  async lstat(): Promise<undefined> {
    return undefined
  }

  async readText(target: FsTarget): Promise<string> {
    const content = this.files.get(target.displayPath)
    if (content === undefined) throw new Error(`no such file: ${target.displayPath}`)
    return content
  }

  async streamText(): Promise<AsyncIterable<string>> {
    return (async function* () {})()
  }

  async readBytes(): Promise<Uint8Array> {
    return new Uint8Array()
  }

  async listDir(): Promise<[]> {
    return []
  }

  async writeText(
    target: FsTarget,
    content: string,
    _expected?: FsWriteIntent,
    _signal?: AbortSignal,
    sandboxPolicy?: unknown,
  ): Promise<FsWriteOutcome> {
    const before = this.files.get(target.displayPath) ?? null
    this.files.set(target.displayPath, content)
    this.writes.push({ path: target.displayPath, content })
    this.policies.push(sandboxPolicy)
    return {
      operation: before === null ? 'create' : 'update',
      version: FsVersion(`v${this.writes.length}`),
      before,
      after: content,
    }
  }

  async editText(): Promise<never> {
    throw new Error('editText is not used by stage-switch tests')
  }
}

/** Open a turn so a reviewed transition queues for the boundary flush. */
export function openTurn(session: Session, turn = 0): void {
  session.append('turn/start', { turn })
}

/**
 * Dispatch pre-step processing like the agent loop does, and optionally commit
 * the following step/start event (the boundary flush). The loop appends every
 * entered message after step/start; the stage prompt rides
 * `decision.messages` (its probe is the claimed input, which must land after
 * the handoff notice), so the entered messages are appended in order here.
 */
export async function boundary(
  ctx: Context,
  agent: Agent & { session: Session },
  type: 'pre-step' | 'step-start',
): Promise<void> {
  const events = agentEvents(ctx, agent)
  const message = createUserMessage({
    content: [{ type: 'text', text: 'boundary probe' }],
    source: { kind: 'user' },
  })
  const signal = new AbortController().signal
  const decision = await events.waterfall(
    'agent/pre-step',
    { messages: [message], turn: 1, step: 1, signal },
    () => Promise.resolve({ kind: 'enter' as const, messages: [message] }),
  )
  if (decision.kind === 'enter') {
    for (const message of decision.messages) {
      agent.session.append('user/message', message, { surfaceOp: 'append' })
    }
  }
  if (type === 'step-start') {
    const event = agent.session.append('step/start', { turn: 1, step: 1 })
    ctx.emit('session/event', agent.session, event)
  }
}

/** Assemble exactly as the loop does: the agent is both subject and scope. */
export async function assembleFor(ctx: Context, agent: Agent) {
  return ctx.systemPrompt.assemble({ agent, scope: agent })
}

/** The model-facing text blocks of every derived message, in log order. */
export function promptTexts(agent: Agent & { session: Session }): string[] {
  return agent.session.deriveMessages()
    .map(message => message.content
      .filter(block => block.type === 'text')
      .map(block => (block as { text?: string }).text ?? '')
      .join(''))
    .filter(text => text.length > 0)
}

/** The `summary` of every durable stage-switch notice, in append order. */
export function stageNoticeSummaries(session: Session): string[] {
  return session.events
    .filter(event => event.type === 'user/message')
    .map(event => event.data as UserMessage)
    .filter(message => message.source.kind === 'plugin' && message.source.plugin === 'stage-switch')
    .map(message => (message.source as { summary?: string }).summary ?? '')
}

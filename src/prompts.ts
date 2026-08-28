/**
 * Prompt loader: reads `src/prompts.json` (the single editable source for
 * stage-switch user-facing copy) and overlays it on the embedded defaults.
 *
 * The JSON is resolved relative to the module so both the source tree
 * (`src/prompts.ts` → sibling `prompts.json`) and the built package
 * (`lib/prompts.js` → `../src/prompts.json`, `src` ships in `files`) find it.
 * When no JSON is present — a stale installed copy before reinstall — the
 * embedded {@link DEFAULT_STAGE_SWITCH_PROMPTS} keep the plugin fully
 * functional with the exact strings it always shipped.
 *
 * @module @ai4rpg/dsh-stage-switch/prompts
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_STAGE_SWITCH_PROMPTS, type StageSwitchPrompts } from './prompts.defaults.ts'

function deepMerge(base: unknown, overlay: unknown): unknown {
  if (typeof base !== 'object' || base === null || Array.isArray(base)) return overlay
  if (typeof overlay !== 'object' || overlay === null || Array.isArray(overlay)) return overlay
  const out: Record<string, unknown> = { ...base as Record<string, unknown> }
  for (const [key, value] of Object.entries(overlay as Record<string, unknown>)) {
    out[key] = deepMerge(out[key], value)
  }
  return out
}

/** Candidate JSON paths, in preference order (source tree first). */
function promptJsonCandidates(): string[] {
  const here = dirname(fileURLToPath(import.meta.url))
  return [
    join(here, 'prompts.json'),
    join(here, '..', 'src', 'prompts.json'),
  ]
}

/**
 * Read the effective prompts: the embedded defaults overlaid with
 * `src/prompts.json` when it is readable. The JSON wins on every key it
 * carries, so a complete JSON fully replaces the defaults.
 */
export function readStageSwitchPrompts(): StageSwitchPrompts {
  for (const candidate of promptJsonCandidates()) {
    try {
      const overlay = JSON.parse(readFileSync(candidate, 'utf8')) as unknown
      return deepMerge(DEFAULT_STAGE_SWITCH_PROMPTS, overlay) as StageSwitchPrompts
    } catch {
      // Try the next candidate; with none readable the defaults stand.
    }
  }
  return DEFAULT_STAGE_SWITCH_PROMPTS
}

/** The effective prompts for this process, read once at module load. */
export const stageSwitchPrompts: StageSwitchPrompts = readStageSwitchPrompts()

/** Substitute `{name}` placeholders with the given values (unmatched kept). */
export function formatPrompt(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match)
}

export type { StageSwitchPrompts } from './prompts.defaults.ts'

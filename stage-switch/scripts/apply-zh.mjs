#!/usr/bin/env node
/**
 * Apply the Chinese review-dialog overlay to the installed package's
 * `src/prompts.json`. Run AFTER `dsh plugin add` (and again after any
 * reinstall/upgrade that resets `src/prompts.json` to English):
 *
 *   node node_modules/\@ai4rpg/dsh-stage-switch/scripts/apply-zh.mjs
 *
 * Merges `src/prompts.zh.json` (review.* only) over `src/prompts.json` using
 * the same deepMerge as `src/prompts.ts`, so every key except `review.*` stays
 * as the English package default. The embedded fallback
 * (`lib/prompts.defaults.js`) is untouched — a stale install that loses the
 * JSON still falls back to English.
 *
 * To revert: reinstall the package (`dsh plugin remove + add` or
 * `pnpm install`/`npm install`), which restores the English `src/prompts.json`.
 *
 * @module scripts/apply-zh
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/** Recursively merge `overlay` into `base` (same algorithm as src/prompts.ts). */
export function deepMerge(base, overlay) {
  if (typeof base !== 'object' || base === null || Array.isArray(base)) return overlay
  if (typeof overlay !== 'object' || overlay === null || Array.isArray(overlay)) return overlay
  const out = { ...base }
  for (const [key, value] of Object.entries(overlay)) {
    out[key] = deepMerge(out[key], value)
  }
  return out
}

/**
 * Apply the Chinese review overlay to the installed package at `root`.
 * `root` must be the package root (parent of `src/`).
 *
 * @returns {object|null} The merged prompts object, or `null` when the overlay
 *   or the source JSON is missing (nothing applied).
 */
export function applyZh(root = join(here, '..')) {
  const srcDir = join(root, 'src')
  const enPath = join(srcDir, 'prompts.json')
  const zhPath = join(srcDir, 'prompts.zh.json')

  if (!existsSync(enPath)) {
    console.error(`apply-zh: ${enPath} not found — nothing to merge into.`)
    return null
  }
  if (!existsSync(zhPath)) {
    console.error(`apply-zh: ${zhPath} not found — the Chinese overlay is missing. Nothing applied.`)
    return null
  }

  const en = JSON.parse(readFileSync(enPath, 'utf8'))
  const zh = JSON.parse(readFileSync(zhPath, 'utf8'))
  const merged = deepMerge(en, zh)

  // Write to a temp file then rename to break any pnpm hardlink (file: install
  // with install-links=true copies via hardlink; writing in place would mutate
  // the source tree's copy). renameSync replaces the target atomically with a
  // new inode, leaving the other hardlink (source tree) untouched.
  const tmp = `${enPath}.zh-apply-tmp`
  writeFileSync(tmp, `${JSON.stringify(merged, null, 2)}\n`)
  renameSync(tmp, enPath)

  const header = merged.review?.header
  console.log(`apply-zh: merged src/prompts.zh.json (review.*) over ${enPath}`)
  console.log(`  review.header: ${header ?? '(missing)'}`)
  return merged
}

// CLI entry point: run when this file is the main module.
// Match the same pattern as scripts/sync-prompts.mjs for consistency.
if (import.meta.url === `file://${process.argv[1]}`) {
  applyZh()
}
/**
 * Type declarations for `scripts/apply-zh.mjs` (a plain-JS ESM script).
 * Used by tests/apply-zh.spec.ts.  The script itself is intentionally
 * untyped to stay runnable by plain Node without a build step.
 *
 * @module scripts/apply-zh
 */

/** Recursively merge `overlay` into `base` (same algorithm as src/prompts.ts). */
export function deepMerge(base: unknown, overlay: unknown): unknown

/**
 * Apply the Chinese review overlay to the installed package at `root`.
 * Returns the merged prompts object, or `null` when the overlay or the
 * source JSON is missing (nothing applied).
 */
export function applyZh(root?: string): Record<string, unknown> | null

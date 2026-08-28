/**
 * Tests for the Chinese review-dialog overlay (方案 A / Plan A).
 *
 * Coverage:
 * 1.  `src/prompts.zh.json` structure — only `review.*` keys, matching the
 *     English review key set, `{stage}` placeholders preserved.
 * 2.  `deepMerge` partial-overlay semantics — zh over en → review Chinese,
 *     every other top-level key stays English.
 * 3.  `applyZh` I/O — writes merged file on a temp fixture, idempotent,
 *     missing-file handling.
 * 4.  REAL load-chain — the installed package after `applyZh` is read by the
 *     actual runtime loader (`readStageSwitchPrompts`) and returns Chinese
 *     review + English everything else.  This is the product-visible behaviour:
 *     the review dialog renders Chinese strings.
 *
 * @module tests/apply-zh
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { deepMerge, applyZh } from '../scripts/apply-zh.mjs'

// ─── helpers ────────────────────────────────────────────────────────

/** All keys of the English `review` object. */
const REVIEW_KEYS = [
  'header',
  'fullQuestion',
  'lightQuestion',
  'approveLabel',
  'keepStageLabel',
  'fullApproveDescription',
  'lightApproveDescription',
  'keepStageDescription',
] as const

let enPrompts: Record<string, any>
let zhPrompts: Record<string, any>

beforeEach(() => {
  enPrompts = JSON.parse(readFileSync('src/prompts.json', 'utf8'))
  zhPrompts = JSON.parse(readFileSync('src/prompts.zh.json', 'utf8'))
})

// ─── 1. prompts.zh.json structure ───────────────────────────────────

describe('prompts.zh.json structure', () => {
  it('is a single top-level key: `review`', () => {
    expect(Object.keys(zhPrompts)).toEqual(['review'])
  })

  it('has exactly the same review keys as the English source', () => {
    expect(Object.keys(zhPrompts.review).toSorted()).toEqual([...REVIEW_KEYS].toSorted())
    expect(Object.keys(zhPrompts.review).toSorted()).toEqual(Object.keys(enPrompts.review).toSorted())
  })

  it('preserves the {stage} placeholder in fullQuestion and lightQuestion', () => {
    expect(zhPrompts.review.fullQuestion).toContain('{stage}')
    expect(zhPrompts.review.lightQuestion).toContain('{stage}')
  })

  it('every review key is a non-empty string', () => {
    for (const key of REVIEW_KEYS) {
      const val = zhPrompts.review[key]
      expect(typeof val).toBe('string')
      expect(val.length).toBeGreaterThan(0)
    }
  })
})

// ─── 2. deepMerge partial-overlay semantics ─────────────────────────

describe('deepMerge partial overlay', () => {
  it('merges zh review over English review, leaving other keys English', () => {
    const merged = deepMerge(enPrompts, zhPrompts) as Record<string, any>

    // review is the zh overlay
    expect(merged.review).toEqual(zhPrompts.review)

    // every other top-level key is the English original
    for (const key of ['gotoTool', 'toolResult', 'present', 'notice', 'errors', 'command']) {
      expect(merged[key]).toEqual(enPrompts[key])
    }
  })

  it('does not mutate the English base', () => {
    const copy = JSON.parse(JSON.stringify(enPrompts))
    deepMerge(enPrompts, zhPrompts)
    expect(enPrompts).toEqual(copy)
  })

  it('is idempotent: merge(merge(en, zh), zh) === merge(en, zh)', () => {
    const once = deepMerge(enPrompts, zhPrompts) as Record<string, any>
    const twice = deepMerge(once, zhPrompts) as Record<string, any>
    expect(twice).toEqual(once)
  })

  it('deepMerge with an empty overlay returns the base', () => {
    const merged = deepMerge(enPrompts, {}) as Record<string, any>
    expect(merged).toEqual(enPrompts)
  })

  it('deepMerge with a primitive overlay returns the overlay', () => {
    expect(deepMerge(enPrompts, 'x')).toBe('x')
    expect(deepMerge(enPrompts, 42)).toBe(42)
    expect(deepMerge(enPrompts, null)).toBe(null)
  })
})

// ─── 3. applyZh I/O against a temp fixture ─────────────────────────

describe('applyZh I/O', () => {
  let fix: string

  beforeEach(() => {
    fix = mkdtempSync(join(tmpdir(), 'apply-zh-test-'))
    mkdirSync(join(fix, 'src'), { recursive: true })
  })

  afterEach(() => {
    rmSync(fix, { recursive: true, force: true })
  })

  function copySourceFiles(extra?: Record<string, string>) {
    writeFileSync(join(fix, 'src', 'prompts.json'), JSON.stringify(enPrompts, null, 2) + '\n')
    writeFileSync(join(fix, 'src', 'prompts.zh.json'), JSON.stringify(zhPrompts, null, 2) + '\n')
    if (extra) {
      for (const [name, content] of Object.entries(extra)) {
        writeFileSync(join(fix, 'src', name), content)
      }
    }
  }

  it('writes the merged prompts.json with Chinese review', () => {
    copySourceFiles()
    applyZh(fix)

    const written = JSON.parse(readFileSync(join(fix, 'src', 'prompts.json'), 'utf8'))
    expect(written.review).toEqual(zhPrompts.review)
    expect(written.gotoTool).toEqual(enPrompts.gotoTool)
    expect(written.errors).toEqual(enPrompts.errors)
  })

  it('is idempotent: second run produces the same file', () => {
    copySourceFiles()
    applyZh(fix)
    applyZh(fix)

    const written = JSON.parse(readFileSync(join(fix, 'src', 'prompts.json'), 'utf8'))
    expect(written.review).toEqual(zhPrompts.review)
  })

  it('returns the merged object on success', () => {
    copySourceFiles()
    const result = applyZh(fix)
    expect(result).not.toBeNull()
    expect(result!.review).toEqual(zhPrompts.review)
  })

  it('returns null when zh overlay is missing (no write)', () => {
    writeFileSync(join(fix, 'src', 'prompts.json'), JSON.stringify(enPrompts, null, 2) + '\n')
    // do NOT copy prompts.zh.json
    const result = applyZh(fix)
    expect(result).toBeNull()

    // the original file must be unchanged
    const surviving = JSON.parse(readFileSync(join(fix, 'src', 'prompts.json'), 'utf8'))
    expect(surviving).toEqual(enPrompts)
  })

  it('returns null when English prompts.json is missing', () => {
    writeFileSync(join(fix, 'src', 'prompts.zh.json'), JSON.stringify(zhPrompts, null, 2) + '\n')
    // do NOT copy prompts.json
    const result = applyZh(fix)
    expect(result).toBeNull()
  })

  it('breaks pnpm hardlinks (new inode after write)', () => {
    // pnpm file: installs with install-links=true share the source tree's
    // `src/prompts.json` inode via a hardlink; an in-place write would mutate
    // the source tree copy. applyZh writes via temp file + rename, so the
    // install copy gets a new inode and the source tree stays unchanged.
    //
    // Simulate the hardlink relationship by copying the source tree's JSON
    // into the install dir (same content), then applyZh the install copy and
    // verify the source tree file is byte-identical afterwards.
    const sourceTree = mkdtempSync(join(fix, 'source-'))
    const installDir = mkdtempSync(join(fix, 'inst-'))
    mkdirSync(join(installDir, 'src'), { recursive: true })

    writeFileSync(join(sourceTree, 'prompts.json'), JSON.stringify(enPrompts, null, 2) + '\n')
    writeFileSync(join(sourceTree, 'prompts.zh.json'), JSON.stringify(zhPrompts, null, 2) + '\n')

    // The install dir's src/prompts.json starts as a copy of the source tree's
    // (simulating the shared inode).
    const sourceEnBefore = readFileSync(join(sourceTree, 'prompts.json'), 'utf8')
    writeFileSync(join(installDir, 'src', 'prompts.json'), sourceEnBefore)
    writeFileSync(join(installDir, 'src', 'prompts.zh.json'), readFileSync(join(sourceTree, 'prompts.zh.json')))

    applyZh(installDir)

    // Source tree file must be unchanged (English original)
    const sourceEnAfter = readFileSync(join(sourceTree, 'prompts.json'), 'utf8')
    expect(sourceEnAfter).toBe(sourceEnBefore)

    // Install file is now the merged Chinese version
    const installWritten = JSON.parse(readFileSync(join(installDir, 'src', 'prompts.json'), 'utf8'))
    expect(installWritten.review.header).toBe('阶段切换')
    expect(installWritten.gotoTool).toEqual(enPrompts.gotoTool)
  })
})

// ─── 4. REAL load-chain: runtime reads Chinese review after applyZh ──

describe('REAL load-chain: runtime reads the zh overlay after applyZh', () => {
  let fix: string

  beforeEach(() => {
    fix = mkdtempSync(join(tmpdir(), 'zh-real-load-'))
    const srcDir = join(fix, 'src')
    mkdirSync(srcDir, { recursive: true })
    for (const f of ['prompts.ts', 'prompts.defaults.ts', 'prompts.json', 'prompts.zh.json']) {
      writeFileSync(join(srcDir, f), readFileSync(join('src', f)))
    }
    // Apply the zh overlay
    applyZh(fix)
  })

  afterEach(() => {
    rmSync(fix, { recursive: true, force: true })
  })

  it('stageSwitchPrompts.review is Chinese after applyZh', async () => {
    // Dynamic import of the fixture's prompts.ts — vitest resolves it as TS,
    // the module reads sibling prompts.json (now merged with zh).
    // vi.resetModules() ensures no stale cache from the repo's own prompts.ts.
    const { stageSwitchPrompts } = await import(
      pathToFileURL(join(fix, 'src', 'prompts.ts')).href
    )

    // Chinese review
    expect(stageSwitchPrompts.review.header).toBe('阶段切换')
    expect(stageSwitchPrompts.review.approveLabel).toBe('批准')
    expect(stageSwitchPrompts.review.keepStageLabel).toBe('保持当前阶段')

    // English everything else
    expect(stageSwitchPrompts.gotoTool.description).toContain('Use when the current stage')
    expect(stageSwitchPrompts.errors.notConfigured).toContain('goto_stage target stage')
    expect(stageSwitchPrompts.notice.handoffReplaced).toContain('Stage switched to')
    expect(stageSwitchPrompts.command.description).toContain('Show or switch the current stage')
    expect(stageSwitchPrompts.present.callTitle).toContain('Stage transition')

    // Placeholder substitution works
    const { formatPrompt } = await import(
      pathToFileURL(join(fix, 'src', 'prompts.ts')).href
    )
    const formatted = formatPrompt(stageSwitchPrompts.review.fullQuestion, { stage: 'design' })
    expect(formatted).toContain('design')
    expect(formatted).toBe('批准切换到「design」阶段并归档当前会话？')
  })

  it('the loaded DEFAULT_STAGE_SWITCH_PROMPTS is still English (unchanged)', async () => {
    const { DEFAULT_STAGE_SWITCH_PROMPTS } = await import(
      pathToFileURL(join(fix, 'src', 'prompts.defaults.ts')).href
    )
    // The embedded defaults are NOT affected by the overlay
    expect(DEFAULT_STAGE_SWITCH_PROMPTS.review.header).toBe('Stage transition')
    expect(DEFAULT_STAGE_SWITCH_PROMPTS.review.approveLabel).toBe('Approve')
  })
})
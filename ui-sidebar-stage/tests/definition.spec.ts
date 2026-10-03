/**
 * The type, as a definition: a page type that claims no address, sits in the
 * extension band, and offers the guide page one entry that opens its kind.
 *
 * The registry itself is a browser-bundle class the published
 * `ui-sidebar-right` package does not expose to Node, so the registration
 * path is covered by `apply.client.spec.ts` against a recorder registry and
 * the real browser path by the Phase 4 smoke test.
 */
import { describe, expect, it } from 'vitest'
import { makeTranslate } from './helpers.ts'
import { STAGE_ID, STAGE_KIND, stageDefinition } from '../src/client/definition.tsx'
import { zh } from '../src/client/locales.ts'

const t = makeTranslate(zh)

describe('stageDefinition', () => {
  it('is a page type under its kind and id and claims no address', () => {
    const definition = stageDefinition(t)
    expect(definition.id).toBe(STAGE_ID)
    expect(definition.kind).toBe(STAGE_KIND)
    expect(definition.patterns).toBeUndefined()
    expect(definition.canOpen).toBeUndefined()
  })

  it('offers the guide page one entry at order 20 that opens the stage kind', () => {
    const [entry, ...rest] = stageDefinition(t).guide ?? []
    expect(rest).toEqual([])
    expect(entry?.id).toBe('stage')
    expect(entry?.order).toBe(20)
    expect(entry?.title()).toBe(zh['guide.title'])
    expect(entry?.description?.()).toBe(zh['guide.description'])
  })

  it('sits in the extension band and titles itself from the dictionary', () => {
    const definition = stageDefinition(t)
    expect(definition.priority).toBe('extension')
    expect(definition.title('')).toBe(zh['type.label'])
  })
})

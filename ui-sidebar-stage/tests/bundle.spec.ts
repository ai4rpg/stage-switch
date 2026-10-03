/**
 * The built artifact, as the module loader sees it: the closure-factory
 * format (banner/footer, CJS module vars, baseline-only requires) and a
 * working `{ inject, apply }` client plugin body behind it.
 *
 * Runs only when `lib/client.js` exists (after `npm run build`); the source
 * path is covered by `apply.client.spec.ts`.
 */
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'

const bundle = existsSync('lib/client.js') ? readFileSync('lib/client.js', 'utf8') : undefined
/** Narrowed view: the suite is skipped unless the bundle exists. */
const code = bundle as string

describe.skipIf(bundle === undefined)('built client bundle', () => {
  it('opens with the closure-factory registration and closes with the module return', () => {
    expect(code).toMatch(/^window\.__ModuleLoader__\.load\(\{ id: "@ai4rpg\/dsh-ui-sidebar-stage", factory: \(require\) => \{ var module = \{ exports: \{\} \}; var exports = module\.exports;/)
    expect(code).toMatch(/return module\.exports; \} \}\);\s*(?:\/\/# sourceMappingURL=.*)?\s*$/)
  })

  it('requires only module-table baseline specifiers', () => {
    const requires = [...code.matchAll(/require\("([^"]+)"\)/g)].map(match => match[1])
    expect(requires.every(spec => spec === 'react' || spec === 'react/jsx-runtime')).toBe(true)
  })

  it('returns a working client plugin body', async () => {
    const entry: { factory: (require: (spec: string) => unknown) => unknown } = { factory: null as never }
    const g = globalThis as unknown as {
      window?: unknown
      __ModuleLoader__?: { load: (e: { factory: (require: (spec: string) => unknown) => unknown }) => void }
    }
    g.window = globalThis
    g.__ModuleLoader__ = { load: (e) => { entry.factory = e.factory } }
    try {
      new Function(code)()
      const react = { createElement: () => null, Fragment: null }
      const exports = entry.factory((spec) => {
        if (spec === 'react' || spec === 'react/jsx-runtime') return react
        throw new Error(`unexpected require: ${spec}`)
      }) as { inject: string[], apply: (ctx: Context) => void }
      expect(exports.inject).toEqual(['slots', 'locale', 'sidebarRightTabs', 'sessions'])
      expect(typeof exports.apply).toBe('function')
      const ctx = new Context()
      const seats: Array<[Record<string, unknown>, unknown]> = []
      ctx.provide('sidebarRightTabs', { register: () => () => {} })
      ctx.provide('slots', {
        inject: (_name: string, register: () => () => void) => { register(); return () => {} },
        register: (options: Record<string, unknown>, component: unknown) => {
          seats.push([options, component])
          return () => {}
        },
      })
      ctx.provide('locale', { bind: () => (key: string) => key, register: () => () => {} })
      ctx.provide('sessions', { binding: () => undefined })
      const fiber = ctx.plugin({ inject: [...exports.inject], apply: exports.apply })
      await fiber.await()
      expect(seats[0]?.[0].name).toBe('sidebar.right.pane.tab')
      expect(seats[0]?.[0].key).toBe('@ai4rpg/dsh-ui-sidebar-stage')
      await fiber.dispose()
    } finally {
      delete g.__ModuleLoader__
      delete g.window
    }
  })
})

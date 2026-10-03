/**
 * Workspace-integration test configuration: resolves every `@deepseek-ai/*`
 * specifier to a local dsh source checkout, so the integration spec can
 * mount this package's client plugin through the PRODUCTION slot machinery
 * (`SlotTestRuntime`: real SlotRegistry, real renderer, real session
 * fixtures) — the layer the self-contained specs cover only with recorders.
 *
 * Opt-in: `npm run test:integration` (requires a dsh checkout; see
 * AGENTS.md). The default `npm test` never uses these aliases, so the
 * self-contained suite always tests the PUBLISHED dependencies.
 */
import { existsSync, readFileSync } from 'node:fs'
import { defineConfig } from 'vitest/config'
import { HARNESS_ROOT as HARNESS } from './tests/workspace-root.ts'
const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const alias: Array<{ find: RegExp, replacement: string }> = []
if (existsSync(`${HARNESS}/tsconfig.base.json`)) {
  const raw = readFileSync(`${HARNESS}/tsconfig.base.json`, 'utf8').replace(/^\s*\/\/.*$/gm, '')
  const paths: Record<string, string[]> = JSON.parse(raw).compilerOptions.paths
  for (const [key, [value]] of Object.entries(paths)) {
    const target = `${HARNESS}/${value.replace(/^\.\//, '')}`
    // A root mapping names the package itself: exactly one slash (the scope
    // separator — a scoped name always contains it, so `includes('/')` would
    // misclassify every root). Root mappings double as subpath roots, which
    // is how the workspace itself resolves `/client` and `/src/*` specifiers
    // onto the source tree.
    const dir = target.endsWith('/index.ts') ? target.slice(0, -'/index.ts'.length) : target
    if (key.split('/').length === 2) {
      alias.push({ find: new RegExp(`^${escape(key)}/src/(.*)$`), replacement: `${dir}/$1` })
      alias.push({ find: new RegExp(`^${escape(key)}(/.*)?$`), replacement: `${dir}$1` })
    } else {
      alias.push({ find: new RegExp(`^${escape(key)}$`), replacement: target })
    }
  }
  // One React instance: this package's node_modules copy and the harness
  // source's copy would otherwise coexist (the machinery renders this
  // package's components, and a second copy breaks hook dispatch the moment
  // a component calls a hook directly).
  const react = `${HARNESS}/packages/client/ui-renderer/node_modules`
  for (const spec of ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client']) {
    alias.push({ find: new RegExp(`^${escape(spec)}$`), replacement: `${react}/${spec}` })
  }
}

export default defineConfig({
  resolve: { alias },
  test: { environment: 'jsdom', include: ['tests/integration.workspace.spec.ts'] },
})

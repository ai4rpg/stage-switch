#!/usr/bin/env node
/**
 * Build both halves of the dual-face package.
 *
 * The browser half must be the module-loader closure-factory artifact the
 * deployment expects: `window.__ModuleLoader__.load({ id, factory })` where
 * the factory receives the module-table `require` and returns its
 * `module.exports` (the `{ inject, apply }` client plugin body). Only
 * module-table baseline specifiers stay external; everything else inlines.
 * The harness's own client packages emit this same shape with its workspace
 * tsdown preset (`packages/client/tsdown.client.ts`); this script reproduces
 * the format with esbuild so an external package can ship it.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { build } from 'esbuild'

const ID = '@ai4rpg/dsh-ui-sidebar-stage'

/** Module-table baseline specifiers (PLATFORM_MODULES in the web shell). */
const EXTERNAL = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]

mkdirSync('lib', { recursive: true })

// Host half: an inert ESM entry so the Loader can import the package root.
await build({
  entryPoints: ['src/index.ts'],
  outfile: 'lib/index.js',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  logLevel: 'info',
})

// Client half: the closure-factory browser bundle.
await build({
  entryPoints: ['src/client/index.tsx'],
  outfile: 'lib/client.js',
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  sourcemap: true,
  external: EXTERNAL,
  banner: {
    js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`
      + ' var module = { exports: {} }; var exports = module.exports;',
  },
  footer: { js: 'return module.exports; } });' },
  logLevel: 'info',
})

// Declaration for the host half (the client half is loaded as JavaScript).
// Resolve tsc through the module system: under workspace hoisting the
// dependency lives in the workspace root's node_modules, not beside this
// package.
const tsc = join(dirname(createRequire(import.meta.url).resolve('typescript')), '..', 'bin', 'tsc')
execFileSync(
  process.execPath,
  [
    tsc,
    'src/index.ts',
    '--emitDeclarationOnly',
    '--declaration',
    '--outDir', 'lib',
    '--skipLibCheck',
    '--strict',
    '--module', 'esnext',
    '--moduleResolution', 'bundler',
    '--ignoreConfig',
  ],
  { stdio: 'inherit' },
)

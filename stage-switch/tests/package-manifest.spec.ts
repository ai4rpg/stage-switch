/**
 * The package-manifest contract that keeps the plugin loadable on dsh 0.2.x.
 *
 * `engines.dsh` is the compatibility gate the app-boot/plugin-manager readers
 * enforce (pre-release inclusive); the dsh `peerDependencies` are the Loader's
 * runtime-resolution map, not the compatibility source. Removing the peers
 * would break the host-package interception in a real profile; removing the
 * engine range would fall back to per-pre-release peer bumps. Pin both here so
 * a package.json cleanup cannot silently break either role.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

interface Manifest {
  readonly engines?: { readonly dsh?: string }
  readonly peerDependencies?: Readonly<Record<string, string>>
}

const manifest = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as Manifest

describe('package manifest', () => {
  it('declares the dsh 0.2 compatibility range', () => {
    expect(manifest.engines?.dsh).toBe('>=0.2.0-rc.2 <0.3.0-0')
  })

  it('keeps the runtime dsh peers for the loader resolution map', () => {
    const peers = Object.keys(manifest.peerDependencies ?? {})
    expect(peers).toEqual(expect.arrayContaining([
      '@deepseek-ai/dsh-llm',
      '@deepseek-ai/dsh-tools',
      '@deepseek-ai/dsh-user-questions',
    ]))
  })

  it('accepts both dsh 0.2 lines in the runtime peers', () => {
    const dshPeers = Object.entries(manifest.peerDependencies ?? {})
      .filter(([name]) => name.startsWith('@deepseek-ai/dsh-'))
    expect(dshPeers.length).toBeGreaterThan(0)
    for (const [name, range] of dshPeers) {
      expect(range, name).toBe('^0.2.0-rc.2 || ^0.2.1-rc.2')
    }
  })
})

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
  readonly version?: string
  readonly engines?: { readonly dsh?: string; readonly node?: string }
  readonly peerDependencies?: Readonly<Record<string, string>>
  readonly devDependencies?: Readonly<Record<string, string>>
  readonly dependencies?: Readonly<Record<string, string>>
}

const manifest = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as Manifest

describe('package manifest', () => {
  it('declares the rc.3 handle baseline and its Node floor', () => {
    expect(manifest.version).toBe('0.2.2')
    expect(manifest.engines?.dsh).toBe('>=0.2.2-rc.3 <0.3.0-0')
    expect(manifest.engines?.node).toBe('>=24.9.0')
  })

  it('keeps the runtime dsh peers for the loader resolution map', () => {
    const peers = Object.keys(manifest.peerDependencies ?? {})
    expect(peers).toEqual(expect.arrayContaining([
      '@deepseek-ai/dsh-llm',
      '@deepseek-ai/dsh-tools',
      '@deepseek-ai/dsh-user-questions',
    ]))
  })

  it('pins the schema dependency to rc.3 for ProjectionDefinition type identity', () => {
    expect(manifest.dependencies?.zod).toBe('4.6.6')
  })

  it('tests against rc.3 DSH packages including the native executor', () => {
    const devDependencies = Object.entries(manifest.devDependencies ?? {})
      .filter(([name]) => name.startsWith('@deepseek-ai/dsh-'))
    expect(devDependencies.length).toBeGreaterThan(0)
    expect(manifest.devDependencies?.['@deepseek-ai/dsh-tool-executor-native']).toBe('^0.2.2-rc.3')
    for (const [name, range] of devDependencies) expect(range, name).toBe('^0.2.2-rc.3')
  })

  it('requires the rc.3 API in the runtime peers', () => {
    const dshPeers = Object.entries(manifest.peerDependencies ?? {})
      .filter(([name]) => name.startsWith('@deepseek-ai/dsh-'))
    expect(dshPeers.length).toBeGreaterThan(0)
    for (const [name, range] of dshPeers) {
      expect(range, name).toBe('^0.2.2-rc.3')
    }
  })
})

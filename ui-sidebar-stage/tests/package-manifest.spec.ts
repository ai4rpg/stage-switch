/**
 * The package-manifest contract for the sidebar's host-plane row.
 *
 * The package has no runtime dsh imports and no peers; `engines.dsh` is its
 * only compatibility declaration. Pin it so a package.json cleanup cannot
 * silently remove the guard or reintroduce a peer that would make consumer
 * npm installs conflict.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

interface Manifest {
  readonly version?: string
  readonly engines?: { readonly dsh?: string }
  readonly peerDependencies?: Readonly<Record<string, string>>
  readonly devDependencies?: Readonly<Record<string, string>>
}

const manifest = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as Manifest

describe('package manifest', () => {
  it('declares the dsh 0.2 compatibility range', () => {
    expect(manifest.engines?.dsh).toBe('>=0.2.0-rc.2 <0.3.0-0')
  })

  it('keeps its runtime baseline and sibling contract while testing rc.3 devDependencies', () => {
    expect(manifest.version).toBe('0.2.1')
    expect(manifest.devDependencies?.['@ai4rpg/dsh-stage-switch']).toBe('^0.2.2')
    const dshDevDependencies = Object.entries(manifest.devDependencies ?? {})
      .filter(([name]) => name.startsWith('@deepseek-ai/dsh-'))
    expect(dshDevDependencies.length).toBeGreaterThan(0)
    for (const [name, range] of dshDevDependencies) expect(range, name).toBe('^0.2.2-rc.3')
  })

  it('has no peer dependencies', () => {
    expect(manifest.peerDependencies).toBeUndefined()
  })
})

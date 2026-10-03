/**
 * The dsh source checkout the workspace-integration layer borrows, when
 * present: the `DSH_HARNESS_ROOT` override, else the sibling checkout named
 * `deepseek-harness` beside this repository (the ecosystem's standard layout).
 * No absolute path is baked in — the integration layer stays portable and
 * leaks nothing about the machine it was authored on.
 */
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const HARNESS_ROOT: string = process.env.DSH_HARNESS_ROOT
  ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../../deepseek-harness')

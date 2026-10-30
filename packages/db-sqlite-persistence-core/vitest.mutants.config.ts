import { appendFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { mergeConfig } from 'vitest/config'
import baseConfig from './vite.config'
import type { Plugin } from 'vite'

/**
 * Applies one mutant from `scripts/demand-coverage-mutants.mjs` while vitest
 * transforms the module, so no file on disk changes and other test runs in
 * the same checkout see unmutated code. The mutant arrives as JSON in
 * `TANSTACK_DB_MUTANT`; each transform that applies it appends to the file in
 * `TANSTACK_DB_MUTANT_MARK`, so the harness can tell a surviving mutant from
 * one that never reached the code.
 */
function mutantPlugin(): Plugin {
  const raw = process.env.TANSTACK_DB_MUTANT
  const mutant = raw
    ? (JSON.parse(raw) as { file: string; find: string; replace: string })
    : undefined
  const target = mutant ? resolve(__dirname, `../..`, mutant.file) : undefined
  return {
    name: `tanstack-db-mutant`,
    enforce: `pre`,
    transform(code, id) {
      if (!mutant || id.split(`?`)[0] !== target) return undefined
      const count = code.split(mutant.find).length - 1
      if (count !== 1) {
        throw new Error(`mutant target occurs ${count} times in ${mutant.file}`)
      }
      if (process.env.TANSTACK_DB_MUTANT_MARK) {
        appendFileSync(process.env.TANSTACK_DB_MUTANT_MARK, `${id}\n`)
      }
      return code.replace(mutant.find, () => mutant.replace)
    },
  }
}

export default mergeConfig(baseConfig, {
  plugins: [mutantPlugin()],
  test: {
    coverage: { enabled: false },
    typecheck: { enabled: false },
  },
})

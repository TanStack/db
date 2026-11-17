import { appendFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { mergeConfig } from 'vitest/config'
import baseConfig from './vite.config'
import type { Plugin } from 'vite'

type Edit = { find: string; replace: string }

/**
 * Applies one mutant from `scripts/demand-coverage-mutants.mjs` or
 * `scripts/sqlite-page-mutants.mjs` while vitest transforms the module, so no
 * file on disk changes and other test runs in the same checkout see
 * unmutated code. The mutant arrives as JSON in `TANSTACK_DB_MUTANT`: one
 * `find` and `replace`, or `edits`, a list of them for a design that spans
 * several places. Each transform that applies it appends to the file in
 * `TANSTACK_DB_MUTANT_MARK`, so the harness can tell a surviving mutant from
 * one that never reached the code.
 */
function mutantPlugin(): Plugin {
  const raw = process.env.TANSTACK_DB_MUTANT
  const mutant = raw
    ? (JSON.parse(raw) as Partial<Edit> & { file: string; edits?: Array<Edit> })
    : undefined
  const edits = mutant ? (mutant.edits ?? [mutant as Edit]) : []
  const target = mutant ? resolve(__dirname, `../..`, mutant.file) : undefined
  return {
    name: `tanstack-db-mutant`,
    enforce: `pre`,
    transform(code, id) {
      if (!mutant || id.split(`?`)[0] !== target) return undefined
      for (const { find } of edits) {
        const count = code.split(find).length - 1
        if (count !== 1) {
          throw new Error(
            `mutant target occurs ${count} times in ${mutant.file}`,
          )
        }
      }
      if (process.env.TANSTACK_DB_MUTANT_MARK) {
        appendFileSync(process.env.TANSTACK_DB_MUTANT_MARK, `${id}\n`)
      }
      return edits.reduce(
        (mutated, { find, replace }) => mutated.replace(find, () => replace),
        code,
      )
    },
  }
}

export default mergeConfig(baseConfig, {
  plugins: [mutantPlugin()],
  test: {
    // The mutant changes the transform output, but Vitest's on-disk module
    // cache keys entries by file and config, not by the mutant environment
    // variable. A run would reuse a transform from an earlier mutant or from an
    // unmutated run, and the mutant would never apply. Disable the cache here.
    fsModuleCache: false,
    coverage: { enabled: false },
    typecheck: { enabled: false },
  },
})

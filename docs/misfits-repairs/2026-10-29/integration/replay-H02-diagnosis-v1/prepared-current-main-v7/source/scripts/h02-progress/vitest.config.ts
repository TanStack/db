import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import type { Plugin } from 'vite'

const root = fileURLToPath(new URL(`../../`, import.meta.url))
const digest = (bytes: string | Buffer) =>
  createHash(`sha256`).update(bytes).digest(`hex`)
const relevant = (id: string) =>
  /\/packages\/(?:db|db-ivm|query-db-collection)\/src\//.test(id)

/**
 * Record resolution and plugin-transform inputs as supplemental provenance.
 * These hooks do not prove loading. The setup instrument snapshots the actual
 * Vitest evaluated-module registry at named cuts and seals actual V8 loaded
 * source during startup, before disconnecting the inspector for the history.
 * All hooks run only when root later admits runtime; importing this config
 * for static typechecking does not execute a test or load production.
 */
function sourceBinding(): Plugin {
  const directory = process.env.H02_PROGRESS_BINDING_DIR
  const record = (value: unknown) => {
    if (!directory) return
    mkdirSync(resolve(directory, `loader-sources`), { recursive: true })
    appendFileSync(
      resolve(directory, `loader-binding.jsonl`),
      JSON.stringify(value) + `\n`,
    )
  }
  return {
    name: `h02-observe-effective-source`,
    enforce: `post`,
    async resolveId(id, importer) {
      if (!directory || !(id.startsWith(`@tanstack/db`) || relevant(id)))
        return null
      const resolved = await this.resolve(id, importer, { skipSelf: true })
      record({ phase: `resolution`, id, importer, resolved })
      return resolved
    },
    transform(code, id) {
      if (!directory || !relevant(id)) return
      const codeSha256 = digest(code)
      mkdirSync(resolve(directory, `plugin-transforms`), { recursive: true })
      writeFileSync(
        resolve(directory, `plugin-transforms`, `${codeSha256}.txt`),
        code,
      )
      record({
        phase: `plugin-transform`,
        id,
        codeSha256,
        sourceSha256: digest(readFileSync(id.replace(/\?.*$/, ``))),
      })
    },
  }
}

export default defineConfig({
  root,
  plugins: [sourceBinding()],
  resolve: {
    alias: [
      {
        find: /^@tanstack\/db$/,
        replacement: resolve(root, `packages/db/src/index.ts`),
      },
      {
        find: /^@tanstack\/db-ivm$/,
        replacement: resolve(root, `packages/db-ivm/src/index.ts`),
      },
    ],
  },
  test: {
    include: [
      `packages/query-db-collection/tests/queued-answer-progress*.test.ts`,
    ],
    environment: `jsdom`,
    setupFiles: [resolve(root, `scripts/h02-progress/source-binding.setup.ts`)],
    pool: `forks`,
    maxWorkers: 1,
    fileParallelism: false,
    execArgv: [`--max-old-space-size=384`],
    coverage: { enabled: false },
    typecheck: { enabled: false },
    testTimeout: 300_000,
  },
})

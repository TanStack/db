import { test } from 'node:test'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
const app = resolve(import.meta.dirname, '..')
const require = createRequire(
  await realpath(join(app, 'node_modules/vite/package.json')),
)
const { build } = require('esbuild')
test('actual collection runtime regressions against PostgreSQL order', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'endpoint-runtime-tests-'))
  const pg = new PGlite()
  try {
    const { rows } = await pg.query(
      `SELECT id FROM unnest($1::text[]) AS id ORDER BY id COLLATE "C"`,
      [['\u{10000}', '\uE000', 'a', 'é', '\u{10ffff}']],
    )
    const bundle = join(dir, 'runtime.mjs')
    await build({
      entryPoints: [join(app, 'tests/runtime-regressions.ts')],
      bundle: true,
      platform: 'node',
      format: 'esm',
      tsconfig: join(app, 'tsconfig.json'),
      outfile: bundle,
      logLevel: 'silent',
    })
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    try {
      process.stdout.write(
        execFileSync(
          process.execPath,
          [bundle, JSON.stringify(rows.map((r) => r.id))],
          { encoding: 'utf8', env, timeout: 30000 },
        ),
      )
    } catch (error) {
      process.stdout.write(error.stdout ?? '')
      throw error
    }
  } finally {
    await pg.close()
    await rm(dir, { recursive: true, force: true })
  }
})

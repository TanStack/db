import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
const app = resolve(import.meta.dirname, '..')
const require = createRequire(
  await realpath(join(app, 'node_modules/vite/package.json')),
)

test('DB scalar membership agrees with PostgreSQL three-valued predicates', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'endpoint-membership-')),
    pg = new PGlite()
  try {
    const output = join(dir, 'membership.mjs')
    await require('esbuild').build({
      entryPoints: [join(app, 'src/coherence.ts')],
      bundle: true,
      platform: 'node',
      format: 'esm',
      tsconfig: join(app, 'tsconfig.json'),
      outfile: output,
      logLevel: 'silent',
    })
    const { compileMembership } = await import(pathToFileURL(output).href)
    const operators = {
      eq: '=',
      ne: '<>',
      gt: '>',
      gte: '>=',
      lt: '<',
      lte: '<=',
    }
    for (const [op, sql] of Object.entries(operators))
      for (const value of [null, -2147483648, -1, 0, 1, 2147483647])
        for (const mode of ['plain', 'or-null', 'and-present']) {
          const base = { op, column: 'score', value: 0 }
          const expression =
            mode === 'plain'
              ? base
              : {
                  op: mode === 'or-null' ? 'or' : 'and',
                  args: [
                    base,
                    {
                      op: mode === 'or-null' ? 'isNull' : 'isNotNull',
                      column: 'score',
                    },
                  ],
                }
          const predicate =
            mode === 'plain'
              ? `score ${sql} 0`
              : mode === 'or-null'
                ? `score ${sql} 0 OR score IS NULL`
                : `score ${sql} 0 AND score IS NOT NULL`
          const expected = (
            await pg.query(
              `SELECT (${predicate}) IS TRUE AS accepted FROM (SELECT $1::integer AS score) AS input`,
              [value],
            )
          ).rows[0].accepted
          assert.equal(
            compileMembership({
              relation: 'x',
              order: ['id'],
              membership: { kind: 'expression', expression },
            })({ score: value }),
            expected,
            JSON.stringify({ op, value, mode }),
          )
        }
  } finally {
    await pg.close()
    await rm(dir, { recursive: true, force: true })
  }
})

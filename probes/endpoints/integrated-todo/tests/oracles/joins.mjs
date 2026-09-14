import assert from 'node:assert/strict'
import fc from 'fast-check'
import { PGlite } from '@electric-sql/pglite'
import { createRequire } from 'node:module'
import { mkdtemp, realpath, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
const app = resolve(import.meta.dirname, '../..')
const require = createRequire(
  await realpath(join(app, 'node_modules/vite/package.json')),
)
const dir = await mkdtemp(join(tmpdir(), 'endpoint-joins-'))
const output = resolve(
  process.env.ENDPOINT_ORACLE_OUTPUT ?? join(app, 'evidence/join-model'),
)
const pg = new PGlite()
const report = {
  ok: false,
  layer: 'DB relational model experiment, not compiled Endpoints',
  seed: 911031,
  operations: 0,
  checkpoints: 0,
  limits: [
    'Complete input relations supplied explicitly; no source-coverage inference.',
    'No endpoint joined write mapping or network/authority lifecycle coverage.',
    'Integer identities; nullable equality joins; two scopes; parent key unique.',
  ],
}
const sql = (kind) =>
  `SELECT c.id,c.text,c.completed,c.parent_id AS "parentId",p.text AS "parentText",p.completed AS "parentCompleted" FROM child c ${kind} JOIN parent p ON c.parent_id=p.id AND c.scope=p.scope WHERE c.scope='alice' ORDER BY c.id`
try {
  const bundle = join(dir, 'model.mjs')
  await require('esbuild').build({
    entryPoints: [join(import.meta.dirname, 'join-model.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    tsconfig: join(app, 'tsconfig.json'),
    outfile: bundle,
    logLevel: 'silent',
  })
  const { joinModel } = await import(pathToFileURL(bundle).href)
  report.engine = (await pg.query('SELECT version() AS version')).rows[0]
  const row = fc.record({
    id: fc.integer({ min: 0, max: 5 }),
    text: fc.string({ maxLength: 8 }),
    completed: fc.boolean(),
    scope: fc.constantFrom('alice', 'bob'),
    parentId: fc.option(fc.integer({ min: 0, max: 5 }), { nil: null }),
  })
  const operation = fc.record({
    side: fc.constantFrom('parent', 'child'),
    kind: fc.constantFrom('put', 'delete'),
    row,
    rollback: fc.boolean(),
  })
  const scenario = fc.record({
    parents: fc.uniqueArray(row, { selector: (r) => r.id, maxLength: 6 }),
    children: fc.uniqueArray(row, { selector: (r) => r.id, maxLength: 6 }),
    steps: fc.array(operation, { minLength: 20, maxLength: 20 }),
  })
  const result = await fc.check(
    fc.asyncProperty(scenario, async ({ parents, children, steps }) => {
      await pg.exec(
        'DROP TABLE IF EXISTS child,parent;CREATE TABLE parent(id integer PRIMARY KEY,text text,completed boolean,scope text,parent_id integer);CREATE TABLE child(LIKE parent INCLUDING ALL)',
      )
      const put = async (table, row) =>
        pg.query(
          `INSERT INTO ${table} VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET text=excluded.text,completed=excluded.completed,scope=excluded.scope,parent_id=excluded.parent_id`,
          [row.id, row.text, row.completed, row.scope, row.parentId],
        )
      for (const row of parents) await put('parent', row)
      for (const row of children) await put('child', row)
      const model = await joinModel(parents, children)
      const expected = async () =>
        Promise.all(
          ['INNER', 'LEFT'].map(
            async (kind) => (await pg.query(sql(kind))).rows,
          ),
        )
      const check = async (actual, label) => {
        assert.deepEqual(actual, await expected(), label)
        report.checkpoints++
      }
      try {
        await check(model.snapshot(), 'initial')
        for (const step of steps) {
          await pg.exec('BEGIN')
          if (step.kind === 'put') await put(step.side, step.row)
          else
            await pg.query(`DELETE FROM ${step.side} WHERE id=$1`, [
              step.row.id,
            ])
          const tx = model.change(step.side, step.kind, step.row)
          await check(tx.rows, 'synchronous optimistic join')
          if (step.rollback) {
            await pg.exec('ROLLBACK')
            tx.rollback()
          } else {
            await pg.exec('COMMIT')
            await tx.commit()
          }
          await check(model.snapshot(), 'settled join')
          report.operations++
        }
      } finally {
        await model.close()
      }
    }),
    { numRuns: 25, seed: report.seed },
  )
  report.property = {
    runs: result.numRuns,
    shrinks: result.numShrinks,
    path: result.counterexamplePath,
  }
  if (result.failed) {
    report.replay = result.counterexample
    throw result.errorInstance ?? Error(result.error)
  }
  // Identical observed inner-join results can hide different child rows.
  // Inserting the same parent then requires different optimistic results.
  await pg.exec(
    "TRUNCATE child,parent; INSERT INTO child VALUES(1,'hidden',false,'alice',4)",
  )
  const before = (await pg.query(sql('INNER'))).rows
  await pg.exec("INSERT INTO parent VALUES(4,'arrived',false,'alice',null)")
  const after = (await pg.query(sql('INNER'))).rows
  assert.deepEqual(before, [])
  assert.equal(after.length, 1)
  await pg.exec('TRUNCATE child')
  assert.deepEqual((await pg.query(sql('INNER'))).rows, [])
  report.coverageBoundary =
    'An empty inner result cannot distinguish missing child inputs from children waiting for a parent.'
  report.ok = true
} catch (error) {
  report.error = String(error.stack ?? error)
  console.error(report.error)
  process.exitCode = 1
} finally {
  await mkdir(output, { recursive: true })
  await writeFile(
    join(output, 'report.json'),
    JSON.stringify(report, null, 2) + '\n',
  )
  await pg.close()
  await rm(dir, { recursive: true, force: true })
}

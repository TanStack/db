import { Evidence } from './evidence.mjs'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import {
  mkdtemp,
  realpath,
  rm,
  mkdir,
  writeFile,
  readFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import fc from 'fast-check'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { pgSchema, text, integer } from 'drizzle-orm/pg-core'
import { eq, gt, isNotNull, sql } from 'drizzle-orm'
import { analyzeSqlDependencies } from '../../sql-dependencies.mjs'
import { inspectSchema } from '../../schema-snapshot.mjs'

// One generated SQL program, then X operation histories. The SUT reads through
// Drizzle + the real registry + real optimistic DB collections. The oracle reads
// PostgreSQL with independently rendered SQL; it never uses returned snapshots,
// membership evaluation or the matcher's dependency sets to get expected rows.
// Footprints are inferred from the actual SQL. Expected targets and values
// remain independently derived from generated program semantics.
const app = resolve(import.meta.dirname, '../..')
const output = resolve(
  process.env.ENDPOINT_ORACLE_OUTPUT ?? 'evidence/dependency-matching',
)
const seed = Number(process.env.ENDPOINT_ORACLE_SEED ?? 9122601)
const scenarios = Number(process.env.ENDPOINT_ORACLE_SCENARIOS ?? 30)
const sequences = Number(process.env.ENDPOINT_ORACLE_SEQUENCES ?? 3)
const require = createRequire(
  await realpath(join(app, 'node_modules/vite/package.json')),
)
const { build } = require('esbuild')
const dir = await mkdtemp(join(tmpdir(), 'endpoint-dependency-oracle-'))
const pg = new PGlite()
const db = drizzle(pg)
const evidence = new Evidence('endpoints.dependencies')
const report = {
  ok: false,
  seed,
  scenarios,
  sequences,
  histories: 0,
  operations: 0,
  optimisticChecks: 0,
  authorityChecks: 0,
  resultReads: 0,
  skippedReads: 0,
  responseBytes: 0,
  foreignKeyControls: 0,
  limits: [
    'Actual SQL footprints exercise discovery and matching; no JavaScript call-graph or library inference.',
    'Drizzle, registry, serialization and real client collections run in process; the companion browser registry oracle covers the compiled HTTP boundary.',
    'Joins and aggregates reconcile authoritatively; only full base-table views participate in optimistic propagation.',
    'Byte counts are JSON response estimates, not compressed HTTP bytes or latency.',
  ],
}
const physical = (i) => (i === 0 ? ['right', 't0'] : ['left', `t${i - 1}`])
const quoted = (i) =>
  physical(i)
    .map((s) => `"${s}"`)
    .join('.')
const identity = (i) => JSON.stringify(physical(i))
const plain = (rows) =>
  rows
    .map(({ id, value }) => ({ id, value }))
    .sort((a, b) => a.id.localeCompare(b.id))
let runtime

function queries(count) {
  const base = Array.from({ length: count }, (_, table) => ({
    kind: 'base',
    table,
    sources: [table],
  }))
  return [
    ...base,
    { kind: 'base', table: 0, sources: [0] },
    { kind: 'filter', table: 1, sources: [1] },
    { kind: 'join', table: 0, sources: [0, 1] },
    { kind: 'aggregate', table: 1, sources: [1] },
    { kind: 'unknown', table: count - 1, sources: [count - 1] },
  ]
}
async function oracleRead(query) {
  const from = quoted(query.table)
  let statement
  switch (query.kind) {
    case 'filter':
      statement = `SELECT id,value FROM ${from} WHERE value>0`
      break
    case 'join':
      statement = `SELECT a.id,(a.value+b.value)::integer AS value FROM ${quoted(
        0,
      )} a JOIN ${quoted(1)} b ON a.id=b.id`
      break
    case 'aggregate':
      statement = `SELECT 'total' AS id,coalesce(sum(value),0)::integer AS value FROM ${from}`
      break
    default:
      statement = `SELECT id,value FROM ${from}`
  }
  return plain((await pg.query(statement)).rows)
}
function sutRead(query, tables) {
  const table = tables[query.table]
  switch (query.kind) {
    case 'filter':
      return db.select().from(table).where(gt(table.value, 0))
    case 'join':
      return db
        .select({
          id: tables[0].id,
          value: sql`${tables[0].value}+${tables[1].value}`.mapWith(Number),
        })
        .from(tables[0])
        .innerJoin(tables[1], eq(tables[0].id, tables[1].id))
    case 'aggregate':
      return db
        .select({
          id: sql`'total'`.mapWith(String),
          value: sql`coalesce(sum(${table.value}),0)`.mapWith(Number),
        })
        .from(table)
    default:
      return db.select().from(table)
  }
}

async function run(program, steps) {
  return evidence.run({ program, steps }, () => execute(program, steps))
}
async function execute(program, steps) {
  const { count, trigger } = program
  await pg.exec(
    'DROP SCHEMA IF EXISTS "left" CASCADE; DROP SCHEMA IF EXISTS "right" CASCADE; CREATE SCHEMA "left"; CREATE SCHEMA "right"',
  )
  const tables = []
  for (let i = 0; i < count; i++) {
    await pg.exec(
      `CREATE TABLE ${quoted(
        i,
      )}(id text PRIMARY KEY,value integer NOT NULL); INSERT INTO ${quoted(
        i,
      )} VALUES ('row',${i + 1})`,
    )
    const [schema, name] = physical(i)
    tables.push(
      pgSchema(schema).table(name, {
        id: text('id').primaryKey(),
        value: integer('value').notNull(),
      }),
    )
  }
  if (trigger)
    await pg.exec(`
    CREATE FUNCTION "left".fanout() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN UPDATE ${quoted(
      1,
    )} SET value=NEW.value+1 WHERE id=NEW.id; RETURN NEW; END $$;
    CREATE TRIGGER fanout AFTER UPDATE ON ${quoted(
      0,
    )} FOR EACH ROW EXECUTE FUNCTION "left".fanout()`)
  const snapshot = await inspectSchema(
    (statement) => pg.query(statement),
    'fixture',
  )
  const core = new runtime.DbClient({ endpointScope: 'oracle' })
  try {
    const client = runtime.endpointRuntime(core)
    const definitions = queries(count)
    const reads = definitions.map(() => 0)
    const registry = {}
    const collections = definitions.map((query, i) => {
      const read = async () => {
        reads[i]++
        return sutRead(query, tables)
      }
      const id = `q${i}`
      registry[id] = runtime.registerQuery(
        'fixture',
        id,
        (x) => x,
        read,
        undefined,
        query.kind === 'unknown'
          ? null
          : analyzeSqlDependencies(sutRead(query, tables).toSQL().sql, snapshot)
              .reads,
      )
      return client.bindQuery(
        id,
        read,
        {
          relation:
            query.kind === 'base' ? identity(query.table) : `opaque:${id}`,
          membership: { kind: 'all' },
          order: [],
        },
        {},
        'fixture',
        runtime.z.object({ id: runtime.z.string(), value: runtime.z.number() }),
      )
    })
    await Promise.all(collections.map((c) => c.preload()))
    if (process.env.ENDPOINT_ORACLE_TEST_FAULT === 'bad-baseline') {
      collections[0].utils.writeUpsert({ id: 'row', value: 101 })
      report.testFaults = (report.testFaults ?? 0) + 1
      evidence.fault('bad-baseline', { collection: 0 })
    }
    report.histories++
    const admitted = await Promise.all(definitions.map(oracleRead))
    evidence.phase = 'execution'
    evidence.check(
      'reference-baseline',
      collections.map((c) => plain([...c.values()])),
      admitted,
      { checkpoint: 'preload' },
    )
    for (const step of steps) {
      const target = step.target % count
      const actual = step.actual % count
      const destinations = step.noop
        ? []
        : step.cross
        ? [...new Set([actual, (actual + 1) % count])]
        : [actual]
      // This oracle closure follows fixture SQL semantics, independently of the
      // manifest delivered to the matcher. A missing-trigger mutant must fail.
      const changedTables = [...destinations]
      if (trigger && destinations.includes(0) && !changedTables.includes(1))
        changedTables.push(1)
      const before = structuredClone(admitted)
      const optimistic = definitions.map(
        (q) =>
          q.kind === 'base' &&
          q.table === target &&
          before[target][0].value !== step.value,
      )
      const selected = definitions.map(
        (q, i) =>
          optimistic[i] ||
          step.unknown ||
          (trigger && destinations.includes(0)) ||
          q.kind === 'unknown' ||
          q.sources.some((t) => changedTables.includes(t)),
      )
      if (step.external) {
        // Unrelated external writes need no incidental refresh. Overlapping
        // queries that are selected still include them in their full snapshot.
        const outside = Array.from({ length: count }, (_, i) => i).find(
          (i) =>
            i !== target && !changedTables.includes(i) && !(trigger && i === 0),
        )
        if (outside !== undefined)
          await pg.query(`UPDATE ${quoted(outside)} SET value=$1`, [
            step.value + 100,
          ])
      }
      const countsBefore = [...reads]
      let response
      const action = client.bindMutation(
        'write',
        async ({ data }) => {
          response = await runtime.refreshRegisteredMutation(
            data.reads,
            registry,
            async () => {
              for (const index of destinations)
                await db
                  .update(tables[index])
                  .set({ value: step.value * 2 })
                  .where(eq(tables[index].id, 'row'))
              if (step.fail) throw Error('post-write fixture error')
            },
            { scope: data.scope },
            () => {
              if (step.unknown) return null
              const inferenceSnapshot = structuredClone(snapshot)
              if (process.env.ENDPOINT_DEPENDENCY_MUTANT === 'omit-trigger') {
                for (const table of inferenceSnapshot.tables)
                  table.writable = true
              }
              const manifests = destinations.map(
                (index) =>
                  analyzeSqlDependencies(
                    db
                      .update(tables[index])
                      .set({ value: step.value * 2 })
                      .where(eq(tables[index].id, 'row'))
                      .toSQL().sql,
                    inferenceSnapshot,
                  ).writes,
              )
              if (manifests.some((manifest) => manifest === null)) return null
              const writes = [...new Set(manifests.flat())]
              return process.env.ENDPOINT_DEPENDENCY_MUTANT === 'omit-write'
                ? []
                : writes
            },
          )
          // Exercise the array-based wire envelope after serialization too.
          return JSON.parse(JSON.stringify(response))
        },
        () =>
          collections[target].update('row', (draft) => {
            draft.value = step.value
          }),
      )
      const tx = action({})
      for (const [i, collection] of collections.entries()) {
        evidence.check(
          'optimistic-rows',
          plain([...collection.values()]),
          optimistic[i] ? [{ id: 'row', value: step.value }] : before[i],
          { checkpoint: 'same-turn', collection: i },
        )
        report.optimisticChecks++
      }
      if (step.fail)
        await assert.rejects(tx.isPersisted.promise, /post-write fixture error/)
      else await tx.isPersisted.promise
      for (const [i, query] of definitions.entries()) {
        const expected = selected[i] ? await oracleRead(query) : before[i]
        evidence.check(
          'settled-rows',
          plain([...collections[i].values()]),
          expected,
          { checkpoint: 'settled', collection: i },
        )
        admitted[i] = structuredClone(expected)
        assert.equal(
          reads[i] - countsBefore[i],
          selected[i] ? 1 : 0,
          `read obligation q${i}`,
        )
        report.authorityChecks++
        if (selected[i]) report.resultReads++
        else report.skippedReads++
      }
      assert.deepEqual(
        (response.unaffected ?? []).map((x) => x.id).sort(),
        selected.flatMap((read, i) => (read ? [] : [`q${i}`])).sort(),
      )
      report.responseBytes += Buffer.byteLength(JSON.stringify(response))
      report.operations++
    }
  } finally {
    await evidence.cleanup('client', () => core.cleanup())
  }
}

const step = fc.record({
  target: fc.nat(20),
  actual: fc.nat(20),
  value: fc.integer({ min: -20, max: 20 }),
  cross: fc.boolean(),
  noop: fc.boolean(),
  unknown: fc.boolean(),
  fail: fc.boolean(),
  external: fc.boolean(),
})

async function foreignKeyControl() {
  await pg.exec(`CREATE SCHEMA fk;
    CREATE TABLE fk.parent(id text PRIMARY KEY,value integer NOT NULL);
    CREATE TABLE fk.child(id text PRIMARY KEY,value integer NOT NULL,parent_id text REFERENCES fk.parent(id) ON DELETE SET NULL);
    INSERT INTO fk.parent VALUES ('row',1); INSERT INTO fk.child VALUES ('row',2,'row')`)
  const schema = pgSchema('fk')
  const parent = schema.table('parent', {
    id: text('id').primaryKey(),
    value: integer('value').notNull(),
  })
  const child = schema.table('child', {
    id: text('id').primaryKey(),
    value: integer('value').notNull(),
    parentId: text('parent_id'),
  })
  const core = new runtime.DbClient({ endpointScope: 'oracle' })
  try {
    const client = runtime.endpointRuntime(core)
    const snapshot = await inspectSchema(
      (statement) => pg.query(statement),
      'fixture',
    )
    const readParent = () => db.select().from(parent)
    const readChild = () =>
      db
        .select({ id: child.id, value: child.value })
        .from(child)
        .where(isNotNull(child.parentId))
    const collections = [readParent, readChild].map((read, i) =>
      client.bindQuery(
        `fk${i}`,
        read,
        {
          relation: `opaque:fk${i}`,
          membership: { kind: 'all' },
          order: [],
        },
        {},
        'fixture',
        runtime.z.object({ id: runtime.z.string(), value: runtime.z.number() }),
      ),
    )
    const registry = Object.fromEntries(
      [readParent, readChild].map((read, i) => [
        `fk${i}`,
        runtime.registerQuery(
          'fixture',
          `fk${i}`,
          (x) => x,
          read,
          undefined,
          analyzeSqlDependencies(read().toSQL().sql, snapshot).reads,
        ),
      ]),
    )
    await Promise.all(collections.map((c) => c.preload()))
    evidence.phase = 'execution'
    const action = client.bindMutation(
      'delete-parent',
      ({ data }) =>
        runtime.refreshRegisteredMutation(
          data.reads,
          registry,
          async () => {
            await db.delete(parent).where(eq(parent.id, 'row'))
          },
          { scope: data.scope },
          () =>
            process.env.ENDPOINT_DEPENDENCY_MUTANT === 'omit-fk'
              ? ['["fk","parent"]']
              : analyzeSqlDependencies(
                  db.delete(parent).where(eq(parent.id, 'row')).toSQL().sql,
                  snapshot,
                ).writes,
        ),
      () => collections[0].delete('row'),
    )
    const tx = action({})
    assert.deepEqual(plain([...collections[0].values()]), [])
    assert.deepEqual(plain([...collections[1].values()]), [
      { id: 'row', value: 2 },
    ])
    await tx.isPersisted.promise
    assert.deepEqual(
      plain([...collections[0].values()]),
      (await pg.query('SELECT id,value FROM fk.parent')).rows,
    )
    assert.deepEqual(
      plain([...collections[1].values()]),
      (
        await pg.query(
          'SELECT id,value FROM fk.child WHERE parent_id IS NOT NULL',
        )
      ).rows,
    )
    assert.deepEqual((await pg.query('SELECT parent_id FROM fk.child')).rows, [
      { parent_id: null },
    ])
    report.foreignKeyControls++
  } finally {
    await evidence.cleanup('client', () => core.cleanup())
  }
}
try {
  const bundle = join(dir, 'runtime.mjs')
  await build({
    stdin: {
      contents: `export {DbClient} from '@tanstack/db';export {z} from 'zod';export {endpointRuntime} from './src/runtime';export {registerQuery,refreshRegisteredMutation} from './src/registry.server';`,
      resolveDir: app,
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    tsconfig: join(app, 'tsconfig.json'),
    outfile: bundle,
    logLevel: 'silent',
  })
  runtime = await import(pathToFileURL(bundle).href)
  const replay = process.argv.indexOf('--replay')
  if (replay !== -1)
    await evidence.replay(
      JSON.parse(await readFile(process.argv[replay + 1], 'utf8')),
      (value) => run(value.program, value.steps),
    )
  else {
    await foreignKeyControl()
    await run({ count: 3, trigger: false }, [
      {
        target: 0,
        actual: 0,
        value: 7,
        cross: false,
        noop: false,
        unknown: false,
        fail: false,
        external: false,
      },
    ])
    // Deterministic positive control: the mutation modifies a second table only
    // through a PostgreSQL trigger, with a third table available to prune.
    await run({ count: 3, trigger: true }, [
      {
        target: 0,
        actual: 0,
        value: 7,
        cross: false,
        noop: false,
        unknown: false,
        fail: false,
        external: true,
      },
    ])
    if (!process.argv.includes('--controls-only'))
      evidence.property(
        await fc.check(
          fc.asyncProperty(
            fc.record({
              count: fc.integer({ min: 2, max: 5 }),
              trigger: fc.boolean(),
            }),
            fc.array(fc.array(step, { minLength: 2, maxLength: 10 }), {
              minLength: sequences,
              maxLength: sequences,
            }),
            async (program, histories) => {
              for (const history of histories) await run(program, history)
            },
          ),
          {
            seed,
            numRuns: scenarios,
            ...(process.env.ENDPOINT_ORACLE_PATH
              ? { path: process.env.ENDPOINT_ORACLE_PATH }
              : {}),
          },
        ),
      )
  }
  report.ok = true
} catch (error) {
  report.error = String(error.stack ?? error)
  process.exitCode = 1
} finally {
  await evidence.cleanup('pg', () => pg.close())
  await evidence.cleanup('directory', () =>
    rm(dir, { recursive: true, force: true }),
  )
  await evidence.finish(report, output)
  console.log(
    JSON.stringify({
      ok: report.ok,
      outcome: report.outcome,
      operations: report.operations,
    }),
  )
}

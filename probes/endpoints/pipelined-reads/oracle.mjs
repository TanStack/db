import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import fc from 'fast-check'
import { PGlite } from '@electric-sql/pglite'
import {
  connect,
  execute,
  readFunctions,
  decode,
  strategies,
} from './adapter.mjs'
import { startWireProxy } from './wire.mjs'
import { ddl, insert, mutation, queriesFor } from './fixture.mjs'
import { readDatabase, drizzleReads } from './drizzle.mjs'
import { refreshAfterMutation } from '../integrated-todo/src/refresh.server.ts'

const output = new URL('./evidence/', import.meta.url)
const seed = Number(process.env.PIPELINE_SEED ?? 20260912)
const numRuns = Number(process.env.PIPELINE_SCENARIOS ?? 20)
const histories = Number(process.env.PIPELINE_HISTORIES ?? 3)
const mutant = process.env.PIPELINE_MUTANT
const report = {
  ok: false,
  node: process.version,
  adapters: [
    'serial',
    'pipeline',
    'pool',
    'drizzle-default',
    'drizzle-prepared',
    'drizzle-pooled',
  ],
  seed,
  numRuns,
  histories,
  strategies,
  layer:
    'Actual Endpoints refresh helper + PostgreSQL network adapter; independent PGlite SQL reference',
  operationsChecked: 0,
  responseChecks: 0,
  controls: [],
  limits: [
    'Fixed two-table schema; generated rows, query choices/parameters and operation histories, not all PostgreSQL syntax.',
    'Client optimistic/publication implementation is unchanged and not instantiated by this adapter oracle.',
    'Ordered external writes are covered; arbitrary concurrent snapshots and production pool contention are not.',
    'PGlite reference aligns int8/numeric parsers with the tested driver; it does not establish every driver/codec mapping.',
  ],
}
const admin = connect('serial')
const clients = Object.fromEntries(
  Object.keys(strategies).map((name) => [name, connect(name)]),
)
const drizzleClients = {
  'drizzle-default': connect('pipeline'),
  'drizzle-prepared': connect('pipeline'),
  'drizzle-pooled': connect('pool'),
}
const databases = Object.fromEntries(
  Object.entries(drizzleClients).map(([name, client]) => [
    name,
    readDatabase(client, name !== 'drizzle-default'),
  ]),
)
const reference = new PGlite({
  parsers: { 20: (value) => value, 1700: (value) => value },
})
const refExecute = async (query) =>
  (await reference.query(query.text, query.params ?? [])).rows

async function reset(initial) {
  const setup = 'DROP TABLE IF EXISTS item,parent,audit; ' + ddl
  await admin.unsafe(setup)
  await reference.exec(setup)
  for (const id of [1, 2]) {
    const query = {
      text: 'INSERT INTO parent VALUES($1,$2)',
      params: [id, `parent-${id}`],
    }
    await execute(admin, query)
    await refExecute(query)
  }
  for (const row of initial) {
    await execute(admin, insert(row))
    await refExecute(insert(row))
  }
}

async function generatedHistories() {
  const text = fc.oneof(
    fc.string({ maxLength: 60 }),
    fc.constant("'; DROP TABLE item; -- 雪\\"),
  )
  const row = fc.record({
    id: fc.integer({ min: 0, max: 8 }).map(String),
    parent: fc.option(fc.integer({ min: 1, max: 3 }), { nil: null }),
    body: text,
    completed: fc.boolean(),
    score: fc.option(fc.integer({ min: -10, max: 20 }), { nil: null }),
  })
  const operation = fc.record({
    kind: fc.constantFrom('put', 'delete', 'edit', 'parent'),
    row,
  })
  const scenario = fc.record({
    initial: fc.uniqueArray(row, { selector: (r) => r.id, maxLength: 8 }),
    config: fc.record({
      completed: fc.boolean(),
      threshold: fc.integer({ min: -10, max: 20 }),
      limit: fc.integer({ min: 0, max: 8 }),
      offset: fc.integer({ min: 0, max: 10 }),
      body: text,
      kinds: fc.uniqueArray(fc.integer({ min: 0, max: 6 }), {
        minLength: 1,
        maxLength: 5,
      }),
    }),
    histories: fc.array(fc.array(operation, { minLength: 1, maxLength: 8 }), {
      minLength: histories,
      maxLength: histories,
    }),
  })
  const details = await fc.check(
    fc.asyncProperty(scenario, async (program) => {
      const queries = queriesFor(program.config)
      for (const history of program.histories) {
        for (const [strategy, sql] of Object.entries({
          ...clients,
          ...drizzleClients,
        })) {
          await reset(program.initial)
          for (const [index, op] of history.entries()) {
            // Intervening changes are not supplied by the endpoint mutation.
            const external = {
              text: 'UPDATE parent SET label=$1 WHERE id=1',
              params: [`external-${index}`],
            }
            await execute(admin, external)
            await refExecute(external)
            await refExecute(mutation(op))
            const expected = []
            for (const query of queries)
              expected.push({ id: query.id, rows: await refExecute(query) })
            let writes = 0
            const reads = Object.hasOwn(databases, strategy)
              ? drizzleReads(databases[strategy], program.config)
              : readFunctions(sql, queries)
            const response = await refreshAfterMutation(
              queries,
              reads,
              async () => {
                writes++
                await execute(admin, mutation(op))
                return 'committed'
              },
            )
            assert.equal(writes, 1)
            assert.deepEqual(response.handler, {
              kind: 'success',
              result: 'committed',
            })
            const actual = decode(response)
            if (mutant === 'drop-result' && strategy === 'pipeline')
              actual.pop()
            assert.deepEqual(
              actual,
              expected,
              `${strategy}: complete typed/ordered result after ${op.kind}`,
            )
            report.responseChecks++
          }
        }
        report.operationsChecked += history.length
      }
    }),
    {
      seed,
      numRuns,
      examples: JSON.parse(
        await readFile(new URL('./replays.json', import.meta.url), 'utf8'),
      ),
      ...(process.env.PIPELINE_PATH ? { path: process.env.PIPELINE_PATH } : {}),
    },
  )
  report.generated = {
    failed: details.failed,
    numRuns: details.numRuns,
    numShrinks: details.numShrinks,
    seed: details.seed,
    counterexamplePath: details.counterexamplePath,
    counterexample: details.counterexample,
  }
  if (details.failed) throw Error(details.error)
}

async function protocolControls() {
  const queries = [0, 1, 2].map((id) => ({
    id: String(id),
    text: 'SELECT $1::integer AS value',
    params: [id],
  }))
  for (const strategy of Object.keys(strategies)) {
    const proxy = await startWireProxy({ oneWayMs: 5 })
    const sql = connect(strategy, proxy.port)
    try {
      // All queries share a signature, but each pool connection must warm it.
      for (let i = 0; i < 4; i++)
        await Promise.all(queries.map((q) => execute(sql, q)))
      proxy.reset()
      const rows = await Promise.all(queries.map((q) => execute(sql, q)))
      assert.deepEqual(rows, [[{ value: 0 }], [{ value: 1 }], [{ value: 2 }]])
      const wire = proxy.snapshot()
      assert.equal(wire.executeMessages, 3)
      if (strategy === 'pipeline')
        assert.ok(wire.maxOutstandingPerConnection >= 3)
      else assert.equal(wire.maxOutstandingPerConnection, 1)
      if (strategy === 'pool') assert.equal(wire.usedConnections, 3)
      report.controls.push({
        name: 'observed PostgreSQL Execute frames before earlier ReadyForQuery',
        strategy,
        wire,
      })
    } finally {
      await sql.end({ timeout: 2 })
      await proxy.close()
    }
  }
  const config = {
    completed: false,
    threshold: 0,
    limit: 3,
    offset: 0,
    body: 'x',
    kinds: [1, 2, 3],
  }
  const requests = queriesFor(config)
  for (const [prepared, globalPrepare] of [
    [false, true],
    [true, true],
    [true, false],
  ]) {
    const proxy = await startWireProxy({ oneWayMs: 5 })
    const client = connect('pipeline', proxy.port, { prepare: globalPrepare })
    const db = readDatabase(client, prepared)
    try {
      const reads = drizzleReads(db, config)
      for (let i = 0; i < 4; i++)
        await refreshAfterMutation(requests, reads, async () => 'noop')
      proxy.reset()
      const start = performance.now()
      const response = await refreshAfterMutation(
        requests,
        reads,
        async () => 'noop',
      )
      decode(response)
      const ms = performance.now() - start
      const wire = proxy.snapshot()
      assert.equal(wire.executeMessages, 3)
      assert.equal(
        wire.maxOutstandingPerConnection,
        prepared && globalPrepare ? 3 : 1,
      )
      report.controls.push({
        name: 'Drizzle parameterized read preparation controls pipelining',
        prepared,
        globalPrepare,
        ms,
        wire,
      })
    } finally {
      await client.end({ timeout: 2 })
      await proxy.close()
    }
  }
}

async function errorControls() {
  await reset([])
  await Promise.all(
    Object.entries(clients).map(async ([strategy, sql]) => {
      for (const failedPosition of [0, 1, 2]) {
        const attempts = [0, 0, 0]
        const queries = [0, 1, 2].map((id) => ({
          id: String(id),
          text:
            id === failedPosition
              ? 'SELECT 1/0 AS value'
              : 'SELECT $1::integer AS value',
          params: id === failedPosition ? [] : [id],
        }))
        const reads = Object.fromEntries(
          queries.map((query, i) => [
            query.id,
            () => {
              attempts[i]++
              return execute(sql, query)
            },
          ]),
        )
        let writes = 0
        const response = await refreshAfterMutation(
          queries,
          reads,
          async () => {
            writes++
            await execute(admin, {
              text: 'INSERT INTO audit VALUES($1)',
              params: [`${strategy}-${failedPosition}`],
            })
            return 'committed'
          },
        )
        assert.equal(response.kind, 'read-error')
        assert.deepEqual(response.handler, {
          kind: 'success',
          result: 'committed',
        })
        assert.equal(writes, 1)
        assert.deepEqual(
          attempts,
          queries.map((_, i) => (i === failedPosition ? 4 : 1)),
        )
        assert.deepEqual(await execute(sql, { text: 'SELECT 42 AS value' }), [
          { value: 42 },
        ])
        report.controls.push({
          name: 'read error retries only failed read; drains protocol; no write replay',
          strategy,
          failedPosition,
          attempts,
        })
      }
      let writes = 0
      const queries = [
        {
          id: 'audit',
          text: 'SELECT id FROM audit WHERE id=$1',
          params: [`${strategy}-handler-error`],
        },
      ]
      const response = await refreshAfterMutation(
        queries,
        readFunctions(sql, queries),
        async () => {
          writes++
          await execute(admin, {
            text: 'INSERT INTO audit VALUES($1)',
            params: [`${strategy}-handler-error`],
          })
          throw Error('handler failed after commit')
        },
      )
      assert.equal(writes, 1)
      assert.equal(response.handler.kind, 'error')
      assert.deepEqual(decode(response), [
        { id: 'audit', rows: [{ id: `${strategy}-handler-error` }] },
      ])
      report.controls.push({
        name: 'handler error reconciles committed write',
        strategy,
      })
    }),
  )
  assert.equal(
    (
      await execute(admin, {
        text: 'SELECT count(*)::integer AS count FROM audit',
      })
    )[0].count,
    12,
  )
}

try {
  report.postgres = (
    await execute(admin, { text: 'SELECT version() AS version' })
  )[0].version
  report.pglite = (
    await reference.query('SELECT version() AS version')
  ).rows[0].version
  console.log(
    'Checking generated adapter histories against independent PGlite results…',
  )
  await generatedHistories()
  console.log(
    `Checked ${report.responseChecks} responses; verifying wire behavior and error recovery…`,
  )
  await protocolControls()
  await errorControls()
  report.ok = true
  console.log(
    JSON.stringify({
      ok: true,
      responses: report.responseChecks,
      controls: report.controls.length,
    }),
  )
} catch (error) {
  report.error = String(error.stack ?? error)
  console.error(report.error)
  process.exitCode = 1
} finally {
  await Promise.allSettled([
    admin.end({ timeout: 2 }),
    ...Object.values({ ...clients, ...drizzleClients }).map((sql) =>
      sql.end({ timeout: 2 }),
    ),
    reference.close(),
  ])
  await mkdir(output, { recursive: true })
  await writeFile(
    new URL(mutant ? `oracle-${mutant}.json` : 'oracle.json', output),
    JSON.stringify(report, null, 2) + '\n',
  )
}

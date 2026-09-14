// Disposable ground-condition experiment. Does not import or change app state.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import { performance } from 'node:perf_hooks'
import os from 'node:os'

const require = createRequire(new URL('../integrated-todo/package.json', import.meta.url))
const { PGlite } = require('@electric-sql/pglite')
const fc = require('fast-check')
const pg = new PGlite()
const seed = 912026
const projection = 'o.id,o.bucket,o.rank,o.amount,c.id AS customer_id,c.label AS customer_label'
const join = 'FROM orders o JOIN customers c ON c.id=o.customer_id'
const counts = { histories: 0, checkpoints: 0, mutationSteps: 0, emptyResults: 0 }
const output = {
  measuredAt: new Date().toISOString(),
  sourceHash: createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex'),
  host: { node: process.version, cpu: os.cpus()[0]?.model, arch: os.arch() },
  versions: {
    pglite: JSON.parse(await readFile(new URL('../integrated-todo/node_modules/@electric-sql/pglite/package.json', import.meta.url), 'utf8')).version,
    fastCheck: JSON.parse(await readFile(new URL('../integrated-todo/node_modules/fast-check/package.json', import.meta.url), 'utf8')).version,
  },
  scope: 'Local result-sharing experiment, not a framework implementation or network benchmark',
  controls: {
    lanes: {
      independent: 'Three independently written SQL queries; one JSON response',
      combined: 'One SQL statement, shared materialized join, three full result arrays',
      shared: 'Same combined SQL as combined; server deduplicates identical rows and returns ordered references',
    },
    isolation: 'No concurrent writes during any comparison; all lanes read the same unchanged state',
    supported: 'Same scoped row projection, unique order ID, inner many-orders-to-one-customer join, deterministic total orders',
    boundary: 'Same data and SQL shapes; bucket parameters [0,0,0] versus [0,1,2]',
    timing: 'Warm in-memory PGlite including JS result decode; 3 warmups, 21 interleaved samples; no network or browser DB apply',
    payload: 'Actual JSON/gzip of this experimental envelope, not the Start wire protocol',
    excludes: 'Auth changes, multi-snapshot reads, optimistic overlays, missing/expired baselines, general projections, many-to-many multiplicity, production PG planning/load',
  },
  correctness: {}, measurements: [],
}

function label(id, width = 96) {
  return Array.from({ length: Math.ceil(width / 64) }, (_, part) =>
    createHash('sha256').update(`${id}:${part}`).digest('hex'),
  ).join('').slice(0, width)
}
function normalize(row) {
  return { id: row.id, bucket: row.bucket, rank: row.rank, amount: row.amount,
    customer_id: row.customer_id, customer_label: row.customer_label }
}
function parameters(overlap, size) {
  return { buckets: overlap ? [0, 0, 0] : [0, 1, 2], limit1: Math.ceil(size * 0.8), limit2: Math.ceil(size * 0.5) }
}

// Reference queries deliberately do not use the candidate's CTE generation or manifests.
async function independent(config) {
  const first = await pg.query(`SELECT ${projection} ${join} WHERE o.bucket=$1 ORDER BY o.rank,o.id`, [config.buckets[0]])
  const second = await pg.query(`SELECT ${projection} ${join} WHERE o.bucket=$1 ORDER BY o.rank DESC,o.id LIMIT $2`, [config.buckets[1], config.limit1])
  const third = await pg.query(`SELECT ${projection} ${join} WHERE o.bucket=$1 ORDER BY o.amount DESC,o.id LIMIT $2`, [config.buckets[2], config.limit2])
  return [first, second, third].map(result => result.rows.map(normalize))
}
function combinedStatement(config) {
  return {
    sql: `WITH base AS MATERIALIZED (
      SELECT ${projection} ${join} WHERE o.bucket IN ($1,$2,$3)
    ), q0 AS (SELECT * FROM base WHERE bucket=$1 ORDER BY rank,id),
    q1 AS (SELECT * FROM base WHERE bucket=$2 ORDER BY rank DESC,id LIMIT $4),
    q2 AS (SELECT * FROM base WHERE bucket=$3 ORDER BY amount DESC,id LIMIT $5)
    SELECT jsonb_build_array(
      (SELECT coalesce(jsonb_agg(to_jsonb(q0) ORDER BY rank,id),'[]'::jsonb) FROM q0),
      (SELECT coalesce(jsonb_agg(to_jsonb(q1) ORDER BY rank DESC,id),'[]'::jsonb) FROM q1),
      (SELECT coalesce(jsonb_agg(to_jsonb(q2) ORDER BY amount DESC,id),'[]'::jsonb) FROM q2)
    ) AS results`,
    args: [...config.buckets, config.limit1, config.limit2],
  }
}
async function combined(config) {
  const { sql, args } = combinedStatement(config)
  const result = await pg.query(sql, args)
  return result.rows[0].results.map(rows => rows.map(normalize))
}
function fullPayload(results) {
  return { collections: results.map((rows, i) => ({ id: `q${i}`, rows })) }
}
function sharedPayload(results) {
  const rows = []
  const indexes = new Map()
  const collections = results.map((result, i) => ({
    id: `q${i}`,
    refs: result.map(row => {
      if (indexes.has(row.id)) {
        const index = indexes.get(row.id)
        assert.deepEqual(rows[index], row, 'one ID must not merge conflicting projected rows')
        return index
      }
      const index = rows.length
      indexes.set(row.id, index)
      rows.push(row)
      return index
    }),
  }))
  return { rows, collections }
}
function reconstruct(payload) {
  return payload.collections.map(collection => ({
    id: collection.id,
    rows: collection.refs.map(index => {
      assert(Number.isInteger(index) && index >= 0 && index < payload.rows.length, 'invalid row reference')
      return payload.rows[index]
    }),
  }))
}
async function reset(rows, width = 96) {
  await pg.exec('TRUNCATE orders,customers')
  const customers = Array.from({ length: 9 }, (_, id) => ({ id, label: label(id, width) }))
  await pg.query('INSERT INTO customers SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(id int,label text)', [JSON.stringify(customers)])
  if (rows.length) await pg.query('INSERT INTO orders SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(id int,customer_id int,bucket int,rank int,amount int)', [JSON.stringify(rows)])
}
async function apply(operation) {
  if (operation.kind === 'delete') {
    await pg.query('DELETE FROM orders WHERE id=$1', [operation.id])
  } else if (operation.kind === 'customer') {
    await pg.query('UPDATE customers SET label=$2 WHERE id=$1', [operation.customer_id, operation.label])
  } else if (operation.kind === 'move') {
    await pg.query('UPDATE orders SET bucket=$2,rank=$3,amount=$4 WHERE id=$1', [operation.id, operation.bucket, operation.rank, operation.amount])
  } else {
    await pg.query(`INSERT INTO orders VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT(id) DO UPDATE SET customer_id=excluded.customer_id,bucket=excluded.bucket,rank=excluded.rank,amount=excluded.amount`,
    [operation.id, operation.customer_id, operation.bucket, operation.rank, operation.amount])
  }
}
async function checkpoint(config) {
  const expected = await independent(config)
  const actual = await combined(config)
  assert.deepEqual(actual, expected, 'combined query must match independent SQL including order and limits')
  const wire = JSON.stringify(sharedPayload(actual))
  assert.deepEqual(reconstruct(JSON.parse(wire)), fullPayload(expected).collections, 'shared wire roundtrip must preserve each exact result')
  counts.checkpoints++
  counts.emptyResults += expected.filter(rows => rows.length === 0).length
  return expected
}
function stats(values) {
  const sorted = [...values].sort((a, b) => a - b)
  return { medianMs: sorted[Math.floor(sorted.length / 2)], p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1], samples: sorted.length }
}
async function timedLane(lane, config) {
  const started = performance.now()
  const results = await (lane === 'independent' ? independent(config) : combined(config))
  const queried = performance.now()
  const payload = lane === 'shared' ? sharedPayload(results) : fullPayload(results)
  const prepared = performance.now()
  const json = JSON.stringify(payload)
  const serialized = performance.now()
  const compressed = gzipSync(json)
  const gzipped = performance.now()
  const decoded = JSON.parse(json)
  const reconstructed = lane === 'shared' ? reconstruct(decoded) : decoded.collections
  const finished = performance.now()
  return { payload, reconstructed,
    queryMs: queried - started, preparationMs: prepared - queried,
    serializationMs: serialized - prepared, gzipMs: gzipped - serialized,
    clientDecodeMs: finished - gzipped, localTotalMs: finished - started,
    jsonBytes: Buffer.byteLength(json), gzipBytes: compressed.length }
}

try {
  await pg.exec(`CREATE TABLE customers(id int PRIMARY KEY,label text NOT NULL);
    CREATE TABLE orders(id int PRIMARY KEY,customer_id int NOT NULL REFERENCES customers(id),bucket int NOT NULL,rank int NOT NULL,amount int NOT NULL);
    CREATE INDEX orders_bucket ON orders(bucket)`)

  // Deterministic witnesses make the important transition classes non-probabilistic.
  const witnessRows = Array.from({ length: 12 }, (_, id) => ({ id, customer_id: id % 3, bucket: id % 3, rank: id % 2, amount: id }))
  await reset([])
  await checkpoint(parameters(true, 4))
  await reset(witnessRows)
  const high = parameters(true, 3)
  const before = await checkpoint(high)
  await apply({ kind: 'customer', customer_id: 0, label: 'changed shared customer' })
  const afterLabel = await checkpoint(high)
  assert.equal(afterLabel[0].filter((row, i) => row.customer_label !== before[0][i].customer_label).length, 4)
  const movedId = afterLabel[1][0].id
  await apply({ kind: 'move', id: movedId, bucket: 1, rank: 0, amount: 99 })
  const afterMove = await checkpoint(high)
  assert.equal(afterMove[1].length, 3)
  assert(!afterMove[1].some(row => row.id === movedId))
  assert(afterMove[1].some(row => !afterLabel[1].some(old => old.id === row.id)), 'departing limited row must be replaced')
  await apply({ kind: 'delete', id: afterMove[2][0].id })
  const afterDelete = await checkpoint(high)
  assert.equal(afterDelete[2].length, 2)
  assert(afterDelete[2].some(row => !afterMove[2].some(old => old.id === row.id)), 'deleted limited row must be replaced')

  // Oracle controls: deliberately break reconstruction; both must be detected.
  const payload = sharedPayload(before)
  const reversed = structuredClone(payload)
  reversed.collections[0].refs.reverse()
  assert.throws(() => assert.deepEqual(reconstruct(reversed), fullPayload(before).collections))
  const missing = structuredClone(payload)
  missing.collections[1].refs = []
  assert.throws(() => assert.deepEqual(reconstruct(missing), fullPayload(before).collections))
  assert.throws(() => sharedPayload([[before[0][0]], [{ ...before[0][0], customer_label: 'conflicting projection' }]]))

  const rowArbitrary = fc.record({ id: fc.integer({ min: 0, max: 40 }), customer_id: fc.integer({ min: 0, max: 8 }), bucket: fc.integer({ min: 0, max: 2 }), rank: fc.integer({ min: 0, max: 3 }), amount: fc.integer({ min: 0, max: 100 }) })
  const operationArbitrary = fc.record({ kind: fc.constantFrom('upsert', 'delete', 'move', 'customer'),
    id: fc.integer({ min: 0, max: 40 }), customer_id: fc.integer({ min: 0, max: 8 }), bucket: fc.integer({ min: 0, max: 2 }), rank: fc.integer({ min: 0, max: 3 }), amount: fc.integer({ min: 0, max: 100 }), label: fc.string({ maxLength: 30 }) })
  const property = fc.asyncProperty(fc.uniqueArray(rowArbitrary, { selector: row => row.id, maxLength: 24 }), fc.array(operationArbitrary, { minLength: 1, maxLength: 12 }), async (initial, operations) => {
    await reset(initial)
    counts.histories++
    for (const overlap of [true, false]) await checkpoint(parameters(overlap, 6))
    for (const operation of operations) {
      await apply(operation)
      counts.mutationSteps++
      for (const overlap of [true, false]) await checkpoint(parameters(overlap, 6))
    }
  })
  const run = await fc.check(property, { seed, numRuns: 30 })
  output.correctness = { ...counts, seed, numRuns: run.numRuns, failed: run.failed, numShrinks: run.numShrinks,
    counterexample: run.counterexample, counterexamplePath: run.counterexamplePath,
    error: run.error, controls: ['reversed order detected', 'lost collection membership detected', 'conflicting same-key row refused'],
    witnesses: ['all empty', 'customer update changes four untouched orders', 'membership departure fills limited result', 'delete', 'tied sort values'] }
  if (run.failed) throw Error(`Correctness failed: ${run.error}`)

  const lanes = ['independent', 'combined', 'shared']
  for (const perBucket of [10, 100, 1000]) {
    const rows = Array.from({ length: perBucket * 3 }, (_, id) => ({ id, customer_id: id % 9, bucket: id % 3, rank: Math.floor(id / 3) % 7, amount: (id * 37) % 101 }))
    await reset(rows)
    await pg.exec('ANALYZE')
    for (const overlap of [true, false]) {
      const config = parameters(overlap, perBucket)
      const expected = await checkpoint(config)
      const timings = Object.fromEntries(lanes.map(lane => [lane, []]))
      let last
      for (let iteration = -3; iteration < 21; iteration++) {
        for (let offset = 0; offset < lanes.length; offset++) {
          const lane = lanes[(iteration + 3 + offset) % lanes.length]
          const measured = await timedLane(lane, config)
          assert.deepEqual(measured.reconstructed, fullPayload(expected).collections)
          if (iteration >= 0) timings[lane].push(measured)
          if (lane === 'shared') last = measured.payload
        }
      }
      const measurement = { perBucket, overlap, config, resultRows: expected.map(rows => rows.length), uniqueResultRows: last.rows.length, lanes: {} }
      for (const lane of lanes) {
        measurement.lanes[lane] = { databaseCalls: lane === 'independent' ? 3 : 1,
          jsonBytes: timings[lane][0].jsonBytes, gzipBytes: timings[lane][0].gzipBytes }
        for (const metric of ['queryMs', 'preparationMs', 'serializationMs', 'gzipMs', 'clientDecodeMs', 'localTotalMs']) {
          measurement.lanes[lane][metric] = stats(timings[lane].map(sample => sample[metric]))
        }
      }
      const statement = combinedStatement(config)
      measurement.combinedPlan = (await pg.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ' + statement.sql, statement.args)).rows
      output.measurements.push(measurement)
      console.log(JSON.stringify({ perBucket, overlap, rows: measurement.resultRows,
        metrics: Object.fromEntries(lanes.map(lane => [lane, { gzip: measurement.lanes[lane].gzipBytes, localMs: measurement.lanes[lane].localTotalMs.medianMs }])) }))
    }
  }
} catch (error) {
  output.error = error.stack
  process.exitCode = 1
} finally {
  await pg.close()
  await writeFile(new URL('./result-sharing-measurements.json', import.meta.url), JSON.stringify(output, null, 2) + '\n')
  console.log(JSON.stringify({ correctness: output.correctness, error: output.error }))
}

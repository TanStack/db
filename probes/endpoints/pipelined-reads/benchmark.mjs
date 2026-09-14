import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import {
  connect,
  execute,
  readFunctions,
  decode,
  strategies,
} from './adapter.mjs'
import { startWireProxy } from './wire.mjs'
import { refreshAfterMutation } from '../integrated-todo/src/refresh.server.ts'

const samples = Number(process.env.PIPELINE_SAMPLES ?? 20)
const report = {
  ok: false,
  node: process.version,
  samples,
  strategies,
  cases: [],
  scope:
    'Mutation execution through confirmed refresh envelope; no browser render or HTTP transport',
  limits: [
    'Real PostgreSQL over Docker TCP; added latency is a transparent local proxy delay, not a WAN measurement.',
    'Proxy adds a constant delay per direction; it models neither bandwidth limits, packet loss nor pool contention.',
    'Queries run at ordinary statement snapshots. No common-snapshot or external-writer equivalence is claimed.',
    'Cold samples include new statement descriptions after connection warmup; warm samples exclude startup and preparation.',
    'Postgres.js configuration and behavior are version-specific. This experiment does not enable a production adapter.',
  ],
}
const quantile = (values, fraction) =>
  [...values].sort((a, b) => a - b)[
    Math.min(values.length - 1, Math.floor(values.length * fraction))
  ]
const admin = connect('serial')

async function measureCase({ count, queryCount, oneWayMs, sleepMs }) {
  await admin.unsafe(
    'DROP TABLE IF EXISTS bench; CREATE TABLE bench(id text PRIMARY KEY,body text,completed boolean,score integer)',
  )
  await execute(admin, {
    text: `INSERT INTO bench SELECT i::text,repeat('abcdefgh',32),i%2=0,i FROM generate_series(1,$1::integer) i`,
    params: [count],
  })
  const queries = Array.from({ length: queryCount }, (_, i) => ({
    id: `q${i}`,
    text: sleepMs
      ? 'SELECT $1::integer AS value FROM pg_sleep($2::double precision)'
      : `SELECT id,body,completed,score FROM bench WHERE score >= $1::integer ORDER BY score ${i % 2 ? 'DESC' : 'ASC'}`,
    params: sleepMs ? [i, sleepMs / 1000] : [i],
  }))
  const resources = {}
  const timing = Object.fromEntries(
    Object.keys(strategies).map((name) => [name, []]),
  )
  const cold = {}
  const wire = Object.fromEntries(
    Object.keys(strategies).map((name) => [name, []]),
  )
  const bytes = {}
  try {
    for (const name of Object.keys(strategies)) {
      const proxy = await startWireProxy({ oneWayMs })
      const sql = connect(name, proxy.port)
      resources[name] = { proxy, sql }
      // Establish the same number of connections each mode permits.
      await Promise.all(
        Array.from({ length: strategies[name].max }, () =>
          execute(sql, { text: 'SELECT 1' }),
        ),
      )
    }
    for (let iteration = 0; iteration < samples + 3; iteration++) {
      if (iteration === 1) {
        // Warm every signature on every pool connection. Merely repeating a
        // pooled request can leave a later-routed connection unprepared.
        for (const [name, { sql }] of Object.entries(resources)) {
          const reserved = await Promise.all(
            Array.from({ length: strategies[name].max }, () => sql.reserve()),
          )
          try {
            for (const connection of reserved) {
              await execute(connection, {
                text: 'UPDATE bench SET body=$1 WHERE id=$2',
                params: ['warmup', '1'],
              })
              for (const query of queries) await execute(connection, query)
            }
          } finally {
            for (const connection of reserved) connection.release()
          }
        }
      }
      const names = Object.keys(strategies)
      const order = names
        .slice(iteration % names.length)
        .concat(names.slice(0, iteration % names.length))
      let expected
      for (const name of order) {
        const { sql, proxy } = resources[name]
        proxy.reset()
        const start = performance.now()
        const response = await refreshAfterMutation(
          queries,
          readFunctions(sql, queries),
          async () => {
            await execute(sql, {
              text: 'UPDATE bench SET body=$1 WHERE id=$2',
              params: [`iteration-${iteration}`, '1'],
            })
            return 'committed'
          },
        )
        const elapsed = performance.now() - start
        assert.deepEqual(response.handler, {
          kind: 'success',
          result: 'committed',
        })
        const actual = decode(response)
        if (expected) assert.deepEqual(actual, expected)
        else expected = actual
        const traffic = proxy.snapshot()
        assert.equal(traffic.executeMessages, queryCount + 1)
        if (iteration === 0) cold[name] = { ms: elapsed, wire: traffic }
        if (iteration >= 3) {
          assert.equal(
            traffic.frontend.P ?? 0,
            0,
            'Warm samples must not include statement preparation',
          )
          timing[name].push(elapsed)
          wire[name].push(traffic)
        }
        bytes[name] = Buffer.byteLength(JSON.stringify(response))
      }
    }
    assert.equal(new Set(Object.values(bytes)).size, 1)
    const result = {
      count,
      queryCount,
      addedRttMs: oneWayMs * 2,
      sleepMs,
      cold,
      warm: Object.fromEntries(
        Object.entries(timing).map(([name, values]) => [
          name,
          {
            medianMs: quantile(values, 0.5),
            p95Ms: quantile(values, 0.95),
            samples: values,
            meanPgRequestBytes:
              wire[name].reduce((sum, s) => sum + s.requestBytes, 0) / samples,
            meanPgResponseBytes:
              wire[name].reduce((sum, s) => sum + s.responseBytes, 0) / samples,
            maxOutstandingPerConnection: Math.max(
              ...wire[name].map((s) => s.maxOutstandingPerConnection),
            ),
            maxConnectionsUsed: Math.max(
              ...wire[name].map((s) => s.usedConnections),
            ),
            parseMessages: wire[name].reduce(
              (sum, s) => sum + (s.frontend.P ?? 0),
              0,
            ),
            fullRefreshEnvelopeBytes: bytes[name],
          },
        ]),
      ),
    }
    report.cases.push(result)
    console.log(
      JSON.stringify({
        count,
        queryCount,
        addedRttMs: oneWayMs * 2,
        sleepMs,
        medianMs: Object.fromEntries(
          Object.entries(result.warm).map(([k, v]) => [
            k,
            Number(v.medianMs.toFixed(2)),
          ]),
        ),
      }),
    )
  } finally {
    for (const { sql, proxy } of Object.values(resources)) {
      await sql.end({ timeout: 2 })
      await proxy.close()
    }
  }
}

try {
  report.postgres = (
    await execute(admin, { text: 'SELECT version() AS version' })
  )[0].version
  for (const oneWayMs of [0, 10])
    for (const count of [10, 1000])
      for (const queryCount of [1, 2, 3])
        await measureCase({ count, queryCount, oneWayMs, sleepMs: 0 })
  // A pipeline serializes work on one backend. A pool can overlap it.
  await measureCase({ count: 10, queryCount: 3, oneWayMs: 10, sleepMs: 15 })
  report.ok = true
} catch (error) {
  report.error = String(error.stack ?? error)
  console.error(report.error)
  process.exitCode = 1
} finally {
  await admin.end({ timeout: 2 })
  const directory = new URL('./evidence/', import.meta.url)
  await mkdir(directory, { recursive: true })
  await writeFile(
    new URL('benchmark.json', directory),
    JSON.stringify(report, null, 2) + '\n',
  )
}

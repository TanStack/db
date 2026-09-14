import { Evidence } from './evidence.mjs'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { Driver } from './driver.mjs'
import { SchemaReference } from './schema-reference.mjs'
import { renderSchemaProgram, renderSchemaDatabase } from './schema-program.mjs'
import { materialize } from './schema-cases.mjs'
import { encodeSnapshots } from '../../src/snapshot-encoding.server.ts'

const output = resolve(
  process.env.ENDPOINT_ORACLE_OUTPUT ??
    new URL('../../evidence/loading-comparison', import.meta.url).pathname,
)
await mkdir(output, { recursive: true })
const samples = Number(process.env.ENDPOINT_LOADING_SAMPLES ?? 8)
assert.ok(Number.isSafeInteger(samples) && samples >= 2)
function payload(seed) {
  let state = seed + 12345
  return Array.from({ length: 1024 }, () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return String.fromCharCode(33 + ((state >>> 0) % 90))
  }).join('')
}
function fixture(kind) {
  const program = materialize({
    scope: 'alice',
    nullMode: true,
    shapes: [
      {
        suffix: 0,
        related: false,
        columns: [{ type: 'integer', nullable: true }],
      },
      {
        suffix: 1,
        related: false,
        columns: [{ type: 'integer', nullable: true }],
      },
    ],
  })
  const seedRows = program.initial.filter(
    (row) => row.scope === 'alice' && row.id === 'alice-0',
  )
  program.initial = seedRows.flatMap((row, table) =>
    Array.from({ length: kind === 'small' ? 1 : 80 }, (_, i) => ({
      ...row,
      id: 'row-' + String(i).padStart(3, '0'),
      text: kind === 'small' ? 'short' : payload(i + table * 100),
      field_0_integer: i,
      completed: i % 2 === 0,
    })),
  )
  program.queries =
    kind === 'small'
      ? [{ table: 0, predicate: null }]
      : kind === 'disjoint'
      ? [
          { table: 0, predicate: null },
          { table: 1, predicate: null },
        ]
      : kind === 'same-table-disjoint'
      ? [
          {
            table: 0,
            predicate: { op: 'eq', column: 'completed', value: false },
          },
          {
            table: 0,
            predicate: { op: 'eq', column: 'completed', value: true },
          },
        ]
      : [
          { table: 0, predicate: null },
          { table: 0, predicate: null },
          {
            table: 0,
            predicate: { op: 'eq', column: 'completed', value: false },
          },
        ]
  if (kind === 'overlap-two') program.queries.splice(1, 1)
  program.orders = program.queries.map(() => ['createdAt', 'id'])
  return program
}
const percentile = (values, p) =>
  values.slice().sort((a, b) => a - b)[Math.floor((values.length - 1) * p)]
const evidence = new Evidence('endpoints.loading')
const report = {
  samples,
  method:
    'Same generated schema, rows and mutations under full/adaptive encoding. Browser action-to-persistence time excludes oracle work and gate setup. First mutation is a warmup. Alternate strategy order between fixtures. Gzip sizes are offline estimates of individual Start response bodies, not observed compressed transfers.',
  cases: [],
  limits: [
    'Dev server and local PGlite; loopback timings do not establish WAN latency gains.',
    'All server queries still execute; this experiment reduces response duplication only.',
    'No LSN, row patches, invalidation pruning, or subset loading.',
  ],
}
let failed = false
try {
  const available = [
    'small',
    'disjoint',
    'overlap',
    'overlap-two',
    'same-table-disjoint',
  ]
  const selected = process.env.ENDPOINT_LOADING_CASES?.split(',') ?? available
  assert.ok(
    selected.length > 0 && selected.every((kind) => available.includes(kind)),
  )
  for (const [caseIndex, kind] of selected.entries()) {
    const program = fixture(kind),
      entry = {
        kind,
        rows: program.initial.length,
        queries: program.queries.length,
        strategies: {},
      }
    for (const encoding of caseIndex % 2
      ? ['adaptive', 'full']
      : ['full', 'adaptive']) {
      const reference = new SchemaReference(),
        driver = new Driver({
          evidence,
          reference,
          renderProgram: renderSchemaProgram,
          renderDatabase: renderSchemaDatabase,
          snapshotEncoding: encoding,
        })
      try {
        await driver.init()
        report.engine = reference.engine
        await reference.configure(program)
        await driver.prepare(program)
        await driver.control({ command: 'reset', rows: program.initial })
        await reference.reset(program.initial)
        const context = await driver.browser.newContext(),
          page = await context.newPage()
        const pending = [],
          wire = []
        page.on('response', (response) => {
          if (
            response.request().method() === 'POST' &&
            response.request().resourceType() === 'fetch'
          )
            pending.push(
              response.body().then((body) =>
                wire.push({
                  responseBytes: body.length,
                  gzipBytes: gzipSync(body).length,
                  requestBytes: Buffer.byteLength(
                    response.request().postData() ?? '',
                  ),
                }),
              ),
            )
        })
        try {
          await page.goto(driver.url + '/?scope=alice')
          await page.waitForFunction(() => window.endpointOracle)
          await page.evaluate(() => window.endpointOracle.ready())
          await driver.checkpoint(page, program, 'initial')
          const times = [],
            measurements = []
          for (let i = 0; i <= samples; i++) {
            let operation
            if (kind === 'same-table-disjoint') {
              const rows = await reference.query({
                ...program.queries[0],
                order: ['id'],
              })
              const row = rows[i % rows.length]
              operation = {
                kind: 'complete',
                target: 0,
                table: 0,
                next: 1,
                scope: program.scope,
                outcome: 'success',
                input: {
                  id: row.id,
                  text: 'toggle',
                  completed: !row.completed,
                  createdAt: row.createdAt,
                  extra: { field_0_integer: row.field_0_integer },
                  token: `operation-${i}`,
                  cross: false,
                  otherId: null,
                  failAfterCommit: false,
                },
              }
            } else
              operation = await reference.operation(
                program,
                {
                  kind: 'complete',
                  target: 0,
                  slot: i,
                  text: 'toggle',
                  rank: 1,
                  outcome: 'success',
                },
                i,
              )
            await driver.control({
              command: 'arm',
              token: operation.input.token,
            })
            await driver.control({
              command: 'write',
              token: operation.input.token,
            })
            await driver.control({ command: 'read' })
            await Promise.all(pending)
            const start = wire.length
            await page.evaluate(
              ({ name, input }) => window.endpointOracle.invoke(name, input),
              {
                name: operation.kind + operation.target,
                input: operation.input,
              },
            )
            await page.waitForFunction(
              (token) =>
                window.endpointOracle.outcomes[token]?.result !== 'pending',
              operation.input.token,
            )
            const outcome = await page.evaluate(
              (token) => window.endpointOracle.outcomes[token],
              operation.input.token,
            )
            assert.equal(outcome.result, 'fulfilled')
            await reference.apply('confirmed', operation)
            await reference.restore()
            await driver.checkpoint(page, program, 'confirmed ' + i)
            await Promise.all(pending)
            const requests = wire.slice(start)
            assert.equal(
              requests.length,
              1,
              'response sharing must preserve the one-RPC path',
            )
            if (i > 0) {
              times.push(outcome.elapsedMs)
              measurements.push(requests[0])
            }
          }
          const snapshots = (await reference.expected(program)).map(
            (rows, i) => ({
              id: 'query-' + i,
              rows: rows.map((row) => ({
                ...row,
                createdAt: new Date(row.createdAt),
              })),
            }),
          )
          const cpu = []
          for (let i = 0; i < 50; i++) {
            const start = performance.now()
            JSON.stringify(
              encodeSnapshots(
                snapshots,
                encoding,
                Object.fromEntries(
                  program.queries.map((query, i) => [
                    'query-' + i,
                    'relation-' + query.table,
                  ]),
                ),
              ),
            )
            cpu.push(performance.now() - start)
          }
          entry.strategies[encoding] = {
            clientMs: {
              p50: percentile(times, 0.5),
              p95: percentile(times, 0.95),
              samples: times,
            },
            encodeAndJsonMs: {
              p50: percentile(cpu, 0.5),
              p95: percentile(cpu, 0.95),
            },
            posts: measurements.length,
            ...measurements.reduce(
              (sum, item) => ({
                responseBytes: sum.responseBytes + item.responseBytes,
                gzipBytes: sum.gzipBytes + item.gzipBytes,
                requestBytes: sum.requestBytes + item.requestBytes,
              }),
              { responseBytes: 0, gzipBytes: 0, requestBytes: 0 },
            ),
            productionClientArtifacts: driver.counts.clientArtifacts,
          }
        } finally {
          await evidence.cleanup('context', () => context.close())
        }
      } finally {
        await driver.close()
      }
    }
    const { full, adaptive } = entry.strategies
    entry.responseSavings = 1 - adaptive.responseBytes / full.responseBytes
    entry.gzipSavings = 1 - adaptive.gzipBytes / full.gzipBytes
    if (kind.startsWith('overlap'))
      assert.ok(
        entry.responseSavings > 0.2,
        'sharing must measurably reduce real serialized response bodies',
      )
    else
      assert.ok(
        adaptive.responseBytes <= full.responseBytes + samples * 20,
        'adaptive fallback must avoid material expansion',
      )
    report.cases.push(entry)
  }
  report.ok = true
} catch (error) {
  failed = true
  report.ok = false
  report.error = String(error.stack ?? error)
  console.error(report.error)
}
await evidence.finish(report, output, !failed)
console.log(
  JSON.stringify(
    report.cases.map((c) => ({
      kind: c.kind,
      savings: c.responseSavings,
      gzip: c.gzipSavings,
      strategies: c.strategies,
    })),
  ),
)
if (failed) process.exitCode = 1

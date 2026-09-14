import assert from 'node:assert/strict'
import fc from 'fast-check'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Driver } from './driver.mjs'
import { sqlCoverage } from './coverage.mjs'
import { SchemaReference } from './schema-reference.mjs'
import { renderSchemaProgram, renderSchemaDatabase } from './schema-program.mjs'
import { schemaScenario } from './schema-cases.mjs'
import { SqlManifest } from './sql-manifest.mjs'
import { EffectReference } from './effect-reference.mjs'
import {
  registryProgram,
  renderRegistryProgram,
  registryFiles,
} from './registry-program.mjs'
import { effectScenario, renderEffectDatabase } from './effect-program.mjs'
const effects = process.env.ENDPOINT_ORACLE_EFFECTS === '1'
const registry = process.env.ENDPOINT_ORACLE_REGISTRY === '1'
const generatedSchema =
  registry || effects || process.env.ENDPOINT_ORACLE_SCHEMA === 'generated'
const manifest = new SqlManifest()

const N = Number(process.env.ENDPOINT_ORACLE_SCENARIOS ?? 2)
const X = Number(process.env.ENDPOINT_ORACLE_SEQUENCES ?? 3)
for (const value of [N, X]) assert.ok(Number.isSafeInteger(value) && value > 0)
const output = resolve(
  process.env.ENDPOINT_ORACLE_OUTPUT ??
    new URL('../../evidence/authority-concurrent', import.meta.url).pathname,
)
await mkdir(output, { recursive: true })
const deferred = () => {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const driver = new Driver(
  generatedSchema
    ? {
        reference: effects ? new EffectReference() : new SchemaReference(),
        renderProgram: registry
          ? (program) => renderRegistryProgram(program).main
          : renderSchemaProgram,
        ...(registry ? { extraModules: registryFiles } : {}),
        renderDatabase: effects ? renderEffectDatabase : renderSchemaDatabase,
      }
    : {},
)
const report = {
  seed: Number(process.env.ENDPOINT_ORACLE_SEED ?? 911026),
  N,
  X,
  effects,
  registry,
  programs: 0,
  sequences: 0,
  operations: 0,
  notifications: 0,
  checkpoints: 0,
  wire: [],
  scope:
    'Generated compiled endpoints, concurrent waves of 2–4 optimistic actions, independent server execution and response delivery order, PostgreSQL confirmed/tentative rows, every source notification, React consumers, production client source exclusion.',
  limits: [
    'Each wave settles as one cohort; no mixed-wave overlay retirement in this generator.',
    'Lifecycle, local rollback, unknown transport and reentrant callbacks have separate actual-runtime regressions.',
    'Wire bytes are decoded bodies; elapsed time includes gates and oracle work.',
  ],
}

async function run(program, sequence) {
  await driver.control({ command: 'reset', rows: program.initial })
  await driver.reference.reset(program.initial)
  const context = await driver.browser.newContext(),
    page = await context.newPage()
  const heldResponses = new Map(),
    routeWork = [],
    browserErrors = [],
    wire = []
  page.on('pageerror', (error) => browserErrors.push(error.message))
  await page.route('**/*', async (route) => {
    const request = route.request()
    if (request.method() !== 'POST' || request.resourceType() !== 'fetch')
      return route.continue()
    const body = request.postData() ?? ''
    const token = [...heldResponses.keys()].find((key) => body.includes(key))
    const response = await route.fetch()
    const bytes = await response.body()
    wire.push({
      requestBytes: Buffer.byteLength(body),
      responseBytes: bytes.length,
      mutation: !!token,
    })
    if (token) {
      const held = heldResponses.get(token)
      held.arrived = true
      await held.release.promise
    }
    routeWork.push(route.fulfill({ response }).catch(() => {}))
    await routeWork.at(-1)
  })
  let folded
  async function checkpoint(label) {
    const expected = await driver.reference.expected(program)
    const events = await page.evaluate(() =>
      window.endpointOracle.drainEvents(),
    )
    for (const event of events) {
      assert.deepEqual(
        event.rows,
        expected,
        `${label}: every notification sees coherent current collections`,
      )
      for (const change of event.changes) {
        if (change.type === 'delete')
          folded[event.index].delete(String(change.key))
        else folded[event.index].set(String(change.key), change.value)
      }
    }
    const canonical = (rows) =>
      [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    assert.deepEqual(
      folded.map((rows) => canonical(rows.values())),
      expected.map(canonical),
      `${label}: ordered event history materializes the same rows`,
    )
    await driver.checkpoint(page, program, label)
    report.notifications += events.length
    report.checkpoints++
  }
  try {
    await page.goto(driver.url + `/?scope=${program.scope}`)
    await page.waitForFunction(() => window.endpointOracle)
    await page.evaluate(() => window.endpointOracle.ready())
    folded = (await driver.reference.expected(program)).map(
      (rows) => new Map(rows.map((row) => [row.id, row])),
    )
    await page.evaluate(() => window.endpointOracle.observe())
    await checkpoint('initial')
    wire.length = 0
    const operations = []
    for (const [index, step] of sequence.steps.entries()) {
      const operation = await driver.reference.operation(program, step, index)
      operation.input.token = `wave-token-${index}-end`
      operations.push(operation)
      heldResponses.set(operation.input.token, {
        arrived: false,
        release: deferred(),
      })
      await driver.control({
        command: 'arm',
        token: operation.input.token,
        append: index > 0,
      })
      await driver.reference.apply('visible', operation)
      const result = await page.evaluate(
        ({ name, input }) => window.endpointOracle.invoke(name, input),
        { name: operation.kind + operation.target, input: operation.input },
      )
      assert.equal(result.isPromise, false)
      assert.equal(result.hasPersistence, true)
      await checkpoint(`optimistic ${index}`)
      await driver.until(
        async () =>
          (await driver.control({ command: 'status' })).events.includes(
            'write:waiting:' + operation.input.token,
          ),
        `write ${index} dispatched without a queue`,
      )
    }
    // All actions are in flight before any write is released. The first read
    // captures an older server state; response delivery is independently permuted.
    await driver.control({ command: 'read' })
    const ordered = (indices) =>
      indices
        .map((rank, index) => ({ rank, index }))
        .sort((a, b) => a.rank - b.rank || a.index - b.index)
        .map((item) => item.index)
    for (const index of ordered(sequence.writeOrder)) {
      const operation = operations[index]
      await driver.control({
        command: 'write',
        token: operation.input.token,
        reject: operation.outcome === 'reject',
      })
      if (operation.outcome !== 'reject')
        await driver.reference.apply('confirmed', operation)
      await driver.until(
        () => heldResponses.get(operation.input.token).arrived,
        `server response ${index}`,
      )
      await checkpoint(`server closed ${index}, response held`)
    }
    const delivery = ordered(sequence.deliveryOrder)
    for (const [position, index] of delivery.entries()) {
      const operation = operations[index]
      heldResponses.get(operation.input.token).release.resolve()
      if (position < delivery.length - 1) {
        await page.waitForTimeout(30)
        const outcomes = await page.evaluate(
          () => window.endpointOracle.outcomes,
        )
        assert.ok(
          Object.values(outcomes).every(
            (outcome) => outcome.result === 'pending',
          ),
          'overlap cannot settle from inline response order',
        )
        await checkpoint(`delivered ${index}, sibling outcome pending`)
      }
    }
    await driver.reference.restore()
    await driver.until(
      async () =>
        Object.values(
          await page.evaluate(() => window.endpointOracle.outcomes),
        ).every((outcome) => outcome.result !== 'pending'),
      'all covered receipts',
    )
    const outcomes = await page.evaluate(() => window.endpointOracle.outcomes)
    for (const operation of operations)
      assert.equal(
        outcomes[operation.input.token].result,
        operation.outcome === 'reject' ||
          operation.input.failAfterCommit ||
          operation.serverError
          ? 'rejected'
          : 'fulfilled',
      )
    await checkpoint('confirmed after all responses')
    assert.deepEqual(
      await page.evaluate(() => window.endpointOracle.errors()),
      [],
    )
    assert.deepEqual(browserErrors, [])
    if (generatedSchema) {
      report.successfulSequences ??= []
      const index = report.successfulSequences.push({ program, sequence }) - 1
      manifest.record(
        program,
        operations,
        `report.json#/successfulSequences/${index}`,
      )
    }
    report.operations += operations.length
    report.sequences++
    report.wire.push({
      operations: operations.length,
      queries: program.orders.length,
      posts: wire.length,
      ...wire.reduce(
        (sum, item) => ({
          requestBytes: sum.requestBytes + item.requestBytes,
          responseBytes: sum.responseBytes + item.responseBytes,
        }),
        { requestBytes: 0, responseBytes: 0 },
      ),
    })
  } catch (error) {
    error.message +=
      '\nBrowser errors: ' +
      JSON.stringify(browserErrors) +
      '\nServer tail:\n' +
      driver.serverLog.slice(-12000)
    throw error
  } finally {
    for (const held of heldResponses.values()) held.release.resolve()
    for (const token of heldResponses.keys())
      await driver.control({ command: 'write', token }).catch(() => {})
    await driver.control({ command: 'read' }).catch(() => {})
    await Promise.allSettled(routeWork)
    await page.unrouteAll({ behavior: 'ignoreErrors' })
    await context.close()
  }
}

const step = fc.record({
  kind: fc.constantFrom('insert', 'edit', 'complete', 'delete'),
  target: fc.nat(2),
  slot: fc.nat(2),
  text: fc.stringOf(fc.constantFrom('a', 'b', ' ', 'é'), {
    minLength: 1,
    maxLength: 8,
  }),
  rank: fc.nat(3),
  outcome: fc.constantFrom('success', 'reject'),
  actualEffect: fc.constantFrom('same', 'flip', 'other', 'noop'),
  failAfterCommit: fc.boolean(),
})
const sequence = fc.integer({ min: 2, max: 4 }).chain((count) =>
  fc.record({
    steps: fc.array(step, { minLength: count, maxLength: count }),
    writeOrder: fc.array(fc.nat(20), { minLength: count, maxLength: count }),
    deliveryOrder: fc.array(fc.nat(20), {
      minLength: count,
      maxLength: count,
    }),
  }),
)
const scenario = fc
  .record({
    scope: fc.constantFrom('alice', 'bob'),
    filters: fc.array(fc.option(fc.boolean(), { nil: null }), {
      minLength: 1,
      maxLength: 3,
    }),
    canonicalize: fc.boolean(),
    repeatedNames: fc.boolean(),
    sequences: fc.array(sequence, { minLength: X, maxLength: X }),
  })
  .map((value) => ({
    program: {
      scope: value.scope,
      orders: [null, ...value.filters].map((_, i) =>
        i % 2 ? ['createdAt', 'id'] : ['id', 'createdAt'],
      ),
      filters: [null, ...value.filters],
      canonicalize: value.canonicalize,
      repeatedNames: value.repeatedNames,
      initial: [false, true].map((completed, index) => ({
        id: 'seed-' + index,
        text: 'initial',
        completed,
        createdAt: '2026-01-01T00:00:00.000Z',
        scope: value.scope,
      })),
    },
    sequences: value.sequences,
  }))
let last,
  failed = false
try {
  await driver.init()
  report.engine = driver.reference.engine
  report.sqlCoverage = generatedSchema
    ? {
        mode: 'generated scalar schemas; see coverage cells',
        limits: [
          'Three actions per concurrent wave; no interleaved cohort retirement',
          'Required base row shape and trusted fixture types',
        ],
      }
    : sqlCoverage
  const execute = async (value) => {
    last = value
    if (generatedSchema) await driver.reference.configure(value.program)
    await driver.prepare(value.program)
    report.programs++
    for (const sequence of value.sequences) await run(value.program, sequence)
  }
  const replay = process.argv.indexOf('--replay')
  if (replay >= 0)
    await execute(JSON.parse(await readFile(process.argv[replay + 1], 'utf8')))
  else {
    const result = await fc.check(
      fc.asyncProperty(
        generatedSchema
          ? (effects ? effectScenario : schemaScenario)(X, 3)
              .map((value) =>
                registry
                  ? { ...value, program: registryProgram(value.program) }
                  : value,
              )
              .chain((value) =>
                fc
                  .tuple(
                    ...value.sequences.map((steps) =>
                      fc.record({
                        steps: fc.constant(steps),
                        writeOrder: fc.array(fc.nat(20), {
                          minLength: steps.length,
                          maxLength: steps.length,
                        }),
                        deliveryOrder: fc.array(fc.nat(20), {
                          minLength: steps.length,
                          maxLength: steps.length,
                        }),
                      }),
                    ),
                  )
                  .map((sequences) => ({ program: value.program, sequences })),
              )
          : scenario,
        execute,
      ),
      {
        seed: report.seed,
        numRuns: N,
        endOnFailure: !!process.env.ENDPOINT_ORACLE_DEBUG,
      },
    )
    report.property = {
      seed: result.seed,
      path: result.counterexamplePath,
      runs: result.numRuns,
      shrinks: result.numShrinks,
    }
    if (result.failed) {
      // The last attempted shrink may have passed. Replay the actual final
      // counterexample, not whichever scenario happened to execute last.
      last = result.counterexample[0]
      throw result.errorInstance ?? Error(result.error)
    }
  }
  report.ok = true
} catch (error) {
  failed = true
  report.ok = false
  report.error = String(error.stack ?? error)
  if (last)
    await writeFile(
      resolve(output, 'replay.json'),
      JSON.stringify(last, null, 2),
    )
  console.error(report.error)
} finally {
  if (generatedSchema) report.coverage = manifest.report()
  report.productionClientArtifacts = driver.counts.clientArtifacts
  await writeFile(
    resolve(output, 'report.json'),
    JSON.stringify(report, null, 2),
  )
  await driver.close()
}
if (failed) process.exitCode = 1

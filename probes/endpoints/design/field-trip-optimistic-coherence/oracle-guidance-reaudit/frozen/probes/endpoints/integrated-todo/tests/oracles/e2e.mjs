import fc from 'fast-check'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { oraclePropertyOptions } from '../../../../../packages/db/tests/oracle-config.ts'
import { Driver } from './driver.mjs'
import { sqlCoverage } from './coverage.mjs'
const positive = (name, fallback) => {
  const value = Number(process.env[name] ?? fallback)
  if (!Number.isSafeInteger(value) || value < 1)
    throw Error(`${name} must be a positive integer`)
  return value
}
const N = positive('ENDPOINT_ORACLE_SCENARIOS', 2),
  X = positive('ENDPOINT_ORACLE_SEQUENCES', 3),
  length = positive('ENDPOINT_ORACLE_STEPS', 5)
const selected = process.env.ENDPOINT_ORACLE_CAMPAIGN ?? 'all'
if (
  !['all', 'controls', 'coherence', 'read-failure', 'read-retry'].includes(
    selected,
  )
)
  throw Error(`Unknown campaign: ${selected}`)
const output = resolve(
  process.env.ENDPOINT_ORACLE_OUTPUT ??
    resolve(import.meta.dirname, '../../evidence/e2e-oracle'),
)
const order = fc.constantFrom(['createdAt', 'id'], ['id', 'createdAt'])
const text = fc.stringOf(fc.constantFrom('a', 'b', 'c', ' ', 'é', '"'), {
  minLength: 1,
  maxLength: 8,
})
const programArb = (count) =>
  fc
    .record({
      orders: fc.array(order, { minLength: count[0], maxLength: count[1] }),
      scope: fc.constantFrom('alice', 'bob'),
      filters: fc.array(fc.option(fc.boolean(), { nil: null }), {
        minLength: 3,
        maxLength: 3,
      }),
      retainWithoutSubscriber: fc.boolean(),
      canonicalize: fc.boolean(),
      repeatedNames: fc.boolean(),
      initial: fc.array(
        fc.record({
          text,
          idPrefix: fc.constantFrom('seed', '\uE000', '\u{10000}', 'é'),
          completed: fc.boolean(),
          rank: fc.integer({ min: 0, max: 2 }),
        }),
        { maxLength: 3 },
      ),
    })
    .map((program) => ({
      ...program,
      unsubscribed: program.retainWithoutSubscriber
        ? [program.orders.length - 1]
        : [],
      initial: program.initial.map((row, index) => ({
        id: `${row.idPrefix}-seed-${index}`,
        text: row.text,
        completed: row.completed,
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, row.rank)).toISOString(),
        scope: program.scope,
      })),
    }))
const stepArb = (outcomes) =>
  fc.record({
    kind: fc.constantFrom('insert', 'edit', 'complete', 'delete'),
    slot: fc.nat(3),
    text,
    rank: fc.integer({ min: 0, max: 2 }),
    target: fc.nat(2),
    outcome: fc.constantFrom(...outcomes),
    actualEffect: fc.constantFrom('same', 'flip', 'other', 'noop'),
    failAfterCommit: fc.boolean(),
    idPrefix: fc.constantFrom('new', '\uE000', '\u{10000}', 'é'),
    retryFailures: fc.integer({ min: 1, max: 3 }),
  })
const scenarioArb = (count, outcomes) =>
  fc.record({
    program: programArb(count),
    sequences: fc.array(
      fc.array(stepArb(outcomes), { minLength: 1, maxLength: length }),
      { minLength: X, maxLength: X },
    ),
  })
const driver = new Driver()
const evidence = driver.evidence
evidence.name = 'endpoints.e2e'
const report = {
  settings: {
    N,
    X,
    maxSteps: length,
    mutant: process.env.ENDPOINT_ORACLE_MUTANT ?? null,
  },
  campaigns: [],
  measurements: {
    requests: 'Browser fetch POST count',
    requestBytes: 'POST body bytes, excluding headers',
    responseBytes: 'Decoded response body bytes; not compressed transfer bytes',
    elapsedMs:
      'Harness elapsed including oracle, gates and browser checkpoints; not isolated application latency',
  },
  limits: [
    'Todo schema, full-row queries with all/completed predicates, ascending createdAt/id order',
    'Sequential operations within each sequence; no same-row concurrent scheduling contract',
    'Dev browser execution with production client artifact inspection; no production browser execution yet',
    'Server exclusion: live canaries, client dependency maps, raw/module request rejection and retained-server-import rejection; not proof against all possible leakage',
  ],
}
await mkdir(output, { recursive: true })
let failure = false
try {
  await driver.init()
  report.engine = driver.reference.engine
  report.sqlCoverage = sqlCoverage
  const replayIndex = process.argv.indexOf('--replay')
  if (replayIndex !== -1) {
    report.replay = process.argv[replayIndex + 1]
    const replay = JSON.parse(await readFile(report.replay, 'utf8'))
    await evidence.replay(replay, async (value) => {
      const scenario = value.scenario ?? value
      await driver.prepare(scenario.program)
      for (const steps of scenario.sequences)
        await driver.run(scenario.program, steps)
    })
    report.replayPassed = true
    console.log('Replay passed')
  } else {
    const witness = {
      orders: [['createdAt', 'id']],
      scope: 'alice',
      initial: [
        {
          id: 'seed-1',
          text: 'seed',
          completed: false,
          createdAt: '2026-01-01T00:00:02.000Z',
          scope: 'alice',
        },
      ],
    }
    if (selected === 'all' || selected === 'coherence') {
      const coverage = {
        ...witness,
        orders: [
          ['createdAt', 'id'],
          ['id', 'createdAt'],
          ['createdAt', 'id'],
          ['id', 'createdAt'],
        ],
        filters: [null, false, true, null],
        unsubscribed: [1, 2, 3],
        gced: [3],
        canonicalize: true,
      }
      const divergence = {
        ...coverage,
        repeatedNames: true,
        initial: [
          ...coverage.initial,
          {
            id: '\uE000',
            text: 'private',
            completed: true,
            createdAt: '2026-01-01T00:00:00.000Z',
            scope: 'alice',
          },
          {
            id: '\u{10000}',
            text: 'astral',
            completed: false,
            createdAt: '2026-01-01T00:00:00.000Z',
            scope: 'alice',
          },
        ],
      }
      await driver.prepare(divergence)
      await driver.run(
        divergence,
        [
          { kind: 'insert', actualEffect: 'flip' },
          { kind: 'edit', actualEffect: 'other' },
          { kind: 'delete', actualEffect: 'noop' },
          { kind: 'insert', actualEffect: 'flip', failAfterCommit: true },
          { kind: 'complete', actualEffect: 'other', failAfterCommit: true },
        ].map((step) => ({
          slot: 0,
          rank: 0,
          target: 1,
          text: 'independent effect',
          outcome: 'success',
          ...step,
        })),
      )
      report.independentEffectsWitness =
        'passed server membership changes, other-row writes, no-op, post-commit errors, Unicode IDs and repeated lexical names'
      await driver.prepare(coverage)
      await driver.run(
        coverage,
        [
          { kind: 'insert', target: 0, text: '  guessed text  ' },
          { kind: 'complete', target: 1, text: 'unused' },
          { kind: 'edit', target: 2, text: '  server trims  ' },
          { kind: 'complete', target: 2, text: 'unused', outcome: 'reject' },
          { kind: 'complete', target: 2, text: 'unused' },
          { kind: 'delete', target: 1, text: 'unused' },
        ].map((step) => ({ slot: 0, rank: 0, outcome: 'success', ...step })),
      )
      report.coherenceWitness =
        'passed filter entry/exit, server correction, rollback, zero-subscriber retention and GC exclusion'
    }
    if (selected === 'all' || selected === 'controls') {
      await driver.prepare(witness)
      await driver.run(
        witness,
        ['insert', 'edit', 'complete', 'delete'].map((kind, index) => ({
          kind,
          slot: 0,
          text: 'witness-' + index,
          rank: 0,
          target: 0,
          outcome: index === 2 ? 'reject' : 'success',
        })),
      )
      report.boundary = await driver.negativeBoundary(witness)
      report.fixedWitness =
        'passed CRUD/rollback/ordering/settlement and server boundary checks'
    }
    for (const [name, count, outcomes] of [
      ['controls', [1, 1], ['success', 'reject']],
      ['read-retry', [1, 1], ['read-retry']],
      ['coherence', [2, 3], ['success', 'reject']],
      ['read-failure', [1, 1], ['read-failure']],
    ]) {
      if (selected !== 'all' && selected !== name) continue
      let failedSequence = 0
      const property = fc.asyncProperty(
        scenarioArb(count, outcomes),
        (scenario) =>
          evidence.run(scenario, async () => {
            await driver.prepare(scenario.program)
            for (const [index, steps] of scenario.sequences.entries()) {
              try {
                await driver.run(scenario.program, steps)
              } catch (error) {
                failedSequence = index
                if (process.env.ENDPOINT_ORACLE_DEBUG)
                  console.log('failure', String(error))
                throw error
              }
            }
          }),
      )
      const result = await fc.check(property, {
        ...oraclePropertyOptions(N, `endpoints.e2e.${name}`),
        endOnFailure: process.env.ENDPOINT_ORACLE_DEBUG === 'stop',
      })
      const entry = {
        name,
        failed: result.failed,
        seed: result.seed,
        path: result.counterexamplePath,
        runs: result.numRuns,
        shrinks: result.numShrinks,
        error: result.error,
      }
      evidence.generation = entry
      report.campaigns.push(entry)
      console.log(JSON.stringify(entry))
      if (result.failed) {
        failure = true
        await driver.saveFailure(resolve(output, name), {
          property: `endpoints.e2e.${name}`,
          seed: result.seed,
          path: result.counterexamplePath,
          failedSequence,
          scenario: result.counterexample[0],
          error: result.error,
        })
        throw result.errorInstance ?? Error(result.error)
      }
    }
  }
} catch (error) {
  failure = true
  report.harnessError = String(error.stack ?? error)
  console.error(report.harnessError)
} finally {
  report.executed = driver.counts
  await driver.close()
  await evidence.finish(report, output, !failure)
}
if (failure) process.exitCode = 1

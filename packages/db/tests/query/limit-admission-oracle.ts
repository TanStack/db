/**
 * A negative limit throws RangeError synchronously, before query construction or a
 * window operation changes anything. Authority: maintainer decision 2026-11-02,
 * following the negative-width counterexample recorded in oracle-coverage.md.
 * Zero (including -0), positive integer limits and Infinity remain admitted.
 * Negative offsets keep their separate absolute-rank contract.
 *
 * This companion extends the pagination owner with an admission judgment:
 * rejection is the identity transformation on public observations. It does not
 * model top-K internals or give negative widths a result-set interpretation.
 * The controlled on-demand source installs its whole finite source up front;
 * held promises control acquisition settlement, not row delivery. These checks
 * establish core admission, not provider pagination or framework error timing.
 * NaN and positive fractions are outside this decision.
 * A rejected call also preserves an admitted operation's eventual outcome.
 * Held moves settle both successfully and with a source failure; failed moves
 * keep the previous window and rows (ARCHITECTURE.md, Atomic window publication).
 */
import { fc } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { Query, getQueryIR } from '../../src/query/builder/index.js'
import { createLiveQueryCollection } from '../../src/query/live-query-collection.js'
import { createDeferred } from '../../src/deferred.js'
import { declareOracle } from '../oracle-declaration.js'
import {
  oracleProperty,
  oracleReplayRequested,
  oracleRoute,
} from '../oracle-config.js'
import {
  forwardAssertionJudgment,
  oracleAssertion,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from '../oracle-assertion-adapter.js'
import {
  atOracleCheckpoint,
  createOracleFailureFidelity,
} from '../oracle-failure-fidelity.js'
import { withHistoryCleanup } from '../optimistic-history-oracle.js'
import { flushPromises } from '../utils.js'
import type { LoadSubsetOptions, SyncConfig } from '../../src/types.js'

type Row = { id: number; rank: number }
type Window = { offset: number; limit: number }
type Path =
  | `builder`
  | `unstarted`
  | `ready`
  | `initial-pending`
  | `move-pending`
  | `replay-pending`
type History = {
  ranks: Array<number>
  limit: number
  offset: number
  negative: number
}

// Each history reconstructs the reported -2 example and threshold neighbors.
// Removing fractions, tiny negatives or infinity admits integer-only guards;
// removing zero admits a <= 0 guard. The generated magnitude explores beyond
// those boundary witnesses. No NaN or positive fractional policy is inferred.
const historyArbitrary: fc.Arbitrary<History> = fc.record({
  ranks: fc.array(fc.integer({ min: -5, max: 5 }), {
    minLength: 12,
    maxLength: 12,
  }),
  limit: fc.integer({ min: 1, max: 3 }),
  offset: fc.integer({ min: 0, max: 2 }),
  negative: fc.integer({ min: 1, max: 1_000_000 }).map(
    (value) => -value,
    (value) => {
      if (typeof value !== `number`) throw new Error(`not a negative number`)
      return -value
    },
  ),
})
const example: History = {
  ranks: Array.from({ length: 12 }, (_, index) => index),
  limit: 2,
  offset: 0,
  negative: -2,
}

// The sign law predicts admission. Rejected inputs have no state transition;
// accepted windows independently sort and select absolute, nonnegative ranks.
function admitted(limit: number): boolean {
  return limit >= 0
}
function selected(rows: ReadonlyArray<Row>, window: Window): Array<Row> {
  return [...rows]
    .sort((a, b) => a.rank - b.rank || a.id - b.id)
    .filter(
      (_, rank) => rank >= window.offset && rank < window.offset + window.limit,
    )
}
function checkAdmission(
  limit: number,
  outcome: ReturnType<typeof attempt>,
): void {
  oracleAssertion(`admission of limit ${limit}`, () =>
    expect(outcome.threw, `admission of limit ${limit}`).toBe(!admitted(limit)),
  )
  // Both public entry points document RangeError. A wrong thrown value must
  // not satisfy rejection merely because it preserves the other observations.
  if (outcome.threw)
    oracleAssertion(`checkAdmission comparison 2`, () =>
      expect(outcome.error).toBeInstanceOf(RangeError),
    )
}

function attempt<T>(
  action: () => T,
): { threw: false; result: T } | { threw: true; error: unknown } {
  try {
    const result = action()
    // A wrongly accepted async move must not create an unhandled rejection.
    if (result instanceof Promise) void result.catch(() => {})
    return { threw: false, result }
  } catch (error) {
    return { threw: true, error }
  }
}

// Record fulfillment and rejection before releasing controlled acquisitions.
// The completion promise lets the driver wait without prescribing a task cut.
function settlement(operation: true | Promise<void>) {
  const observation: {
    value: `pending` | `fulfilled` | `rejected`
    error?: unknown
  } = { value: operation === true ? `fulfilled` : `pending` }
  const done =
    operation === true
      ? Promise.resolve()
      : operation.then(
          () => {
            observation.value = `fulfilled`
          },
          (error) => {
            observation.value = `rejected`
            observation.error = error
          },
        )
  return { observation, done }
}

// One second is a diagnostic budget for this controlled fixture, not a product
// deadline. On expiry the named comparison reports pending and retains its trace;
// a task-scheduled implementation may complete at any point within that budget.
async function waitForSettlement(
  outcome: ReturnType<typeof settlement>,
): Promise<void> {
  const deadline = createDeferred<void>()
  const timer = setTimeout(() => deadline.resolve(), 1000)
  try {
    await Promise.race([outcome.done, deadline.promise])
  } finally {
    clearTimeout(timer)
  }
}

function checkSettlement(
  { observation }: ReturnType<typeof settlement>,
  error?: Error,
): void {
  oracleAssertion(`checkSettlement comparison 3`, () =>
    expect(observation).toEqual(
      error ? { value: `rejected`, error } : { value: `fulfilled` },
    ),
  )
  if (error)
    oracleAssertion(`checkSettlement comparison 4`, () =>
      expect(observation.error).toBe(error),
    )
}

async function runHistory(
  history: History,
  path: Path,
  negative: boolean,
  reached: (state: string) => void,
  candidate?: number,
  rejectHeldMove = false,
): Promise<void> {
  let rows = history.ranks.map((rank, index) => ({ id: index + 1, rank }))
  const initialWindow = { offset: history.offset, limit: history.limit }
  const values = negative
    ? [-2, -0.5, -Number.MIN_VALUE, -Infinity, history.negative]
    : [candidate!]
  const events: Array<{ type: string; options: LoadSubsetOptions }> = []
  const pending: Array<ReturnType<typeof createDeferred<void>>> = []
  let hold = path === `initial-pending`
  let sync!: Parameters<SyncConfig<Row>[`sync`]>[0]
  const source = createCollection<Row>({
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    autoIndex: `off`,
    startSync: true,
    sync: {
      sync: (operations) => {
        sync = operations
        operations.begin()
        for (const row of rows)
          operations.write({ type: `insert`, value: { ...row } })
        operations.commit()
        operations.markReady()
        return {
          loadSubset: (options) => {
            events.push({ type: `load`, options })
            options.signal?.addEventListener(
              `abort`,
              () => events.push({ type: `abort`, options }),
              { once: true },
            )
            if (!hold) return true
            const deferred = createDeferred<void>()
            pending.push(deferred)
            return deferred.promise
          },
          unloadSubset: (options) => {
            events.push({ type: `unload`, options })
          },
        }
      },
    },
  })
  const builder = new Query()
    .from({ row: source })
    .orderBy(({ row }) => row.rank)
    .orderBy(({ row }) => row.id)
  const live = createLiveQueryCollection({
    query: builder.limit(initialWindow.limit).offset(initialWindow.offset),
  })
  let unsubscribe = () => {}
  const release = async (error?: Error) => {
    hold = false
    for (const deferred of pending)
      if (error) deferred.reject(error)
      else deferred.resolve()
    await flushPromises()
  }

  await withHistoryCleanup(
    async () => {
      if (path === `builder`) {
        const before = { ...getQueryIR(builder) }
        for (const value of values) {
          const outcome = attempt(() => builder.limit(value))
          reached(value < 0 ? `negative` : `valid`)
          atOracleCheckpoint(`limit admission`, `builder return`, () => {
            checkAdmission(value, outcome)
            oracleAssertion(`runHistory comparison 5`, () =>
              expect(getQueryIR(builder)).toEqual(before),
            )
            if (!outcome.threw)
              oracleAssertion(`runHistory comparison 6`, () =>
                expect(getQueryIR(outcome.result).limit).toBe(value),
              )
          })
        }
        return
      }

      const publications: Array<Array<Row>> = []
      let operation: true | Promise<void> = true
      let operationOutcome = settlement(operation)
      let expectedWindow = initialWindow
      if (path !== `unstarted`) {
        const subscription = live.subscribeChanges(() => {
          publications.push(
            Array.from(live.values(), ({ id, rank }) => ({ id, rank })),
          )
        })
        unsubscribe = () => subscription.unsubscribe()
        operation = live.preload()
        if (path !== `initial-pending`) await operation
        if (path === `move-pending` || path === `replay-pending`) {
          hold = true
          if (path === `replay-pending`) {
            sync.begin()
            sync.truncate()
            for (const row of rows)
              sync.write({ type: `insert`, value: { ...row } })
            sync.commit()
            await flushPromises()
          }
          expectedWindow = { offset: 6, limit: history.limit + 1 }
          operation = live.utils.setWindow(expectedWindow)
        }
        operationOutcome = settlement(operation)
        await flushPromises()
        if (hold) {
          oracleAssertion(`held acquisition premise`, () =>
            expect(pending.length, `held acquisition premise`).toBeGreaterThan(
              0,
            ),
          )
          oracleAssertion(`runHistory comparison 8`, () =>
            expect(operation).toBeInstanceOf(Promise),
          )
          oracleAssertion(`runHistory comparison 9`, () =>
            expect(operationOutcome.observation.value).toBe(`pending`),
          )
          reached(`held`)
        }
      }
      const observe = () => ({
        rows: Array.from(live.values(), ({ id, rank }) => ({ id, rank })),
        window: live.utils.getWindow(),
        status: live.status,
        error: live.utils.lastSubsetError,
        publications: publications.map((batch) => [...batch]),
        events: [...events],
        operationOutcome: operationOutcome.observation.value,
      })
      for (const value of values) {
        const requests = negative
          ? [{ limit: value }, { offset: 5, limit: value }]
          : [{ offset: value === history.limit ? -1 : 5, limit: value }]
        for (const options of requests) {
          const before = observe()
          // Omitted offsets and combined moves must both reject atomically.
          const outcome = attempt(() => live.utils.setWindow(options))
          reached(value < 0 ? `negative` : `valid`)
          atOracleCheckpoint(`limit admission`, `${path} return`, () => {
            checkAdmission(value, outcome)
            if (!admitted(value))
              oracleAssertion(`runHistory comparison 10`, () =>
                expect(observe()).toEqual(before),
              )
          })
          if (admitted(value))
            expectedWindow = { offset: options.offset!, limit: value }
          await flushPromises()
          atOracleCheckpoint(
            `rejection preserves window`,
            `${path} next turn`,
            () => {
              if (!admitted(value))
                oracleAssertion(`runHistory comparison 11`, () =>
                  expect(observe()).toEqual(before),
                )
            },
          )
          if (admitted(value) && !outcome.threw) {
            const candidateOutcome = settlement(outcome.result)
            await release()
            const preloadOutcome = settlement(live.preload())
            await waitForSettlement(candidateOutcome)
            await waitForSettlement(preloadOutcome)
            atOracleCheckpoint(
              `accepted window`,
              `${path} candidate settled`,
              () => {
                checkSettlement(candidateOutcome)
                checkSettlement(preloadOutcome)
                oracleAssertion(`runHistory comparison 12`, () =>
                  expect(live.utils.getWindow()).toEqual(expectedWindow),
                )
                oracleAssertion(`runHistory comparison 13`, () =>
                  expect(observe().rows).toEqual(
                    selected(rows, expectedWindow),
                  ),
                )
              },
            )
          }
        }
      }
      const loadError = rejectHeldMove
        ? new Error(`held move failed`)
        : undefined
      await release(loadError)
      if (rejectHeldMove) expectedWindow = initialWindow
      if (path === `unstarted`) {
        operationOutcome = settlement(live.preload())
      }
      await waitForSettlement(operationOutcome)
      atOracleCheckpoint(
        `rejection preserves window`,
        `${path} settled`,
        () => {
          checkSettlement(operationOutcome, loadError)
          oracleAssertion(`runHistory comparison 14`, () =>
            expect(live.utils.getWindow()).toEqual(expectedWindow),
          )
          oracleAssertion(`runHistory comparison 15`, () =>
            expect(observe().rows).toEqual(selected(rows, expectedWindow)),
          )
          if (loadError)
            oracleAssertion(`runHistory comparison 16`, () =>
              expect(live.utils.lastSubsetError).toBe(loadError),
            )
        },
      )
      if (path.endsWith(`pending`))
        reached(rejectHeldMove ? `failed-settlement` : `successful-settlement`)
      // A partial move detects an invisible mutation of requested bounds; then
      // a source change checks that rejection left the graph usable.
      expectedWindow = { offset: 1, limit: expectedWindow.limit }
      await live.utils.setWindow({ offset: 1 })
      rows = rows.map((row) => (row.id === 1 ? { ...row, rank: -20 } : row))
      sync.begin()
      sync.write({ type: `update`, value: { ...rows[0]! } })
      sync.commit()
      await flushPromises()
      atOracleCheckpoint(`valid next use`, `${path} source update`, () => {
        oracleAssertion(`runHistory comparison 17`, () =>
          expect(live.utils.getWindow()).toEqual(expectedWindow),
        )
        oracleAssertion(`runHistory comparison 18`, () =>
          expect(observe().rows).toEqual(selected(rows, expectedWindow)),
        )
      })
      reached(`next-use`)
    },
    () => [release, unsubscribe, () => live.cleanup(), () => source.cleanup()],
  )
}

declareOracle({
  check: [checkAdmission, checkSettlement],
  model: [admitted, selected],
  grammar: [historyArbitrary],
})

// Every payload already crosses every required admission/settlement cut for
// its path. The identity builder preserves generated ranks, bounds and the
// candidate/outcome loops. The negative map's inverse above only makes that
// unchanged generated language recognizable for constructed histories.
async function judgeLimitHistory(
  history: History,
  path: Path,
  negative: boolean,
  reached: (state: string) => void,
): Promise<void> {
  // Each accepted value gets its own held premise. Settling zero must not move
  // the remaining candidates to readiness. Negative held moves retain both
  // successful and failed settlement branches.
  for (const candidate of negative
    ? [undefined]
    : [0, -0, history.limit, Infinity]) {
    for (const rejectHeldMove of negative && path === `move-pending`
      ? [false, true]
      : [false])
      await runHistory(
        history,
        path,
        negative,
        reached,
        candidate,
        rejectHeldMove,
      )
  }
}

export function registerLimitAdmissionOracle(): void {
  describe(`negative limit admission`, () => {
    for (const path of [
      `builder`,
      `unstarted`,
      `ready`,
      `initial-pending`,
      `move-pending`,
      `replay-pending`,
    ] as const) {
      for (const negative of [false, true]) {
        const property = `pagination.limit-admission-${path}-${negative ? `negative` : `valid`}`
        const states = [
          negative ? `negative` : `valid`,
          ...(path === `builder` ? [] : [`next-use`]),
          ...(path.endsWith(`pending`) ? [`held`] : []),
          ...(path.endsWith(`pending`) ? [`successful-settlement`] : []),
          ...(negative && path === `move-pending` ? [`failed-settlement`] : []),
        ]
        // The previous explicit history has ranks outside the random grammar.
        // Retain it through the same model, driver and comparison rather than
        // widening that grammar to satisfy native fixed-history membership.
        if (!oracleReplayRequested())
          it(`${path} ${negative ? `rejects negatives` : `admits valid neighbors`} (fixed history)`, async () => {
            oracleRoute(`case`)
            await judgeLimitHistory(example, path, negative, () => {})
          }, 30000)

        // Native campaigns preserve the first law. Keep the existing fidelity
        // wrapper as well: it distinguishes the original law AND checkpoint
        // and retains original/reduced traces and cleanup diagnostics. A fresh
        // instance belongs to each native Vitest test, including its shrinks.
        const fidelityByTest = new Map<
          string,
          ReturnType<typeof createOracleFailureFidelity<History>>
        >()
        oracleProperty({
          id: property,
          law: {
            statement: `Negative limits reject synchronously without changing query construction, public windows, demand, rows or an admitted operation's outcome. Valid neighboring limits remain usable.`,
            authority: `The 2026-11-02 maintainer decision and ARCHITECTURE.md, Atomic window publication, stated above.`,
            limits: `The unchanged six core admission paths with controlled on-demand acquisition settlement; no NaN, positive-fraction or real-provider timing policy.`,
          },
          histories: {
            arbitrary: historyArbitrary,
            runs: 20,
            fixedSeeds: [2291],
            states,
            constructed: [
              {
                name: `admission and settlement cuts`,
                enters: states,
                build: (generated) => generated,
              },
            ],
          },
          resolve: (history) => ({ history }),
          model: recordedAssertionJudgment,
          driver: (plan: { history: History }, observe) =>
            recordAssertionJudgment(property, plan, observe, async () => {
              const testName = expect.getState().currentTestName!
              let fidelity = fidelityByTest.get(testName)
              if (fidelity === undefined) {
                fidelity = createOracleFailureFidelity<History>((history) =>
                  JSON.stringify(history),
                )
                fidelityByTest.set(testName, fidelity)
              }
              await fidelity.assert(() =>
                fidelity.run(plan.history, () =>
                  judgeLimitHistory(plan.history, path, negative, (state) =>
                    observe(`reach`, state),
                  ),
                ),
              )
            }),
          check: forwardAssertionJudgment,
          // Shrinking a stalled operation retains the original diagnostic budget.
          timeout: 30000,
        })
      }
    }
  })
}

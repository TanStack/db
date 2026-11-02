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
 */
import { fc } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { Query, getQueryIR } from '../../src/query/builder/index.js'
import { createLiveQueryCollection } from '../../src/query/live-query-collection.js'
import { createDeferred } from '../../src/deferred.js'
import { declareOracle } from '../oracle-declaration.js'
import { oraclePropertyOptions, oracleReplayTest } from '../oracle-config.js'
import { createOracleReach } from '../oracle-reach.js'
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
  negative: fc.integer({ min: 1, max: 1_000_000 }).map((value) => -value),
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
  expect(outcome.threw, `admission of limit ${limit}`).toBe(!admitted(limit))
  // Both public entry points document RangeError. A wrong thrown value must
  // not satisfy rejection merely because it preserves the other observations.
  if (outcome.threw) expect(outcome.error).toBeInstanceOf(RangeError)
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

async function runHistory(
  history: History,
  path: Path,
  negative: boolean,
  reached: (state: string) => void,
  candidate?: number,
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
  const release = async () => {
    hold = false
    for (const deferred of pending) deferred.resolve()
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
            expect(getQueryIR(builder)).toEqual(before)
            if (!outcome.threw)
              expect(getQueryIR(outcome.result).limit).toBe(value)
          })
        }
        return
      }

      const publications: Array<Array<Row>> = []
      let operation: true | Promise<void> = true
      const operationOutcome: {
        value: `none` | `pending` | `fulfilled` | `rejected`
      } = { value: `none` }
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
        if (operation !== true) {
          operationOutcome.value = `pending`
          void operation.then(
            () => {
              operationOutcome.value = `fulfilled`
            },
            () => {
              operationOutcome.value = `rejected`
            },
          )
        }
        await flushPromises()
        if (hold) {
          expect(pending.length, `held acquisition premise`).toBeGreaterThan(0)
          expect(operation).toBeInstanceOf(Promise)
          expect(operationOutcome.value).toBe(`pending`)
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
        operationOutcome: operationOutcome.value,
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
            if (!admitted(value)) expect(observe()).toEqual(before)
          })
          if (admitted(value))
            expectedWindow = { offset: options.offset!, limit: value }
          await flushPromises()
          atOracleCheckpoint(
            `rejection preserves window`,
            `${path} next turn`,
            () => {
              if (!admitted(value)) expect(observe()).toEqual(before)
            },
          )
          if (admitted(value) && !outcome.threw) {
            await release()
            await outcome.result
            await live.preload()
            atOracleCheckpoint(
              `accepted window`,
              `${path} candidate settled`,
              () => {
                expect(live.utils.getWindow()).toEqual(expectedWindow)
                expect(observe().rows).toEqual(selected(rows, expectedWindow))
              },
            )
          }
        }
      }
      await release()
      await operation
      await live.preload()
      atOracleCheckpoint(
        `rejection preserves window`,
        `${path} settled`,
        () => {
          expect(live.utils.getWindow()).toEqual(expectedWindow)
          expect(observe().rows).toEqual(selected(rows, expectedWindow))
        },
      )
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
        expect(live.utils.getWindow()).toEqual(expectedWindow)
        expect(observe().rows).toEqual(selected(rows, expectedWindow))
      })
      reached(`next-use`)
    },
    () => [release, unsubscribe, () => live.cleanup(), () => source.cleanup()],
  )
}

declareOracle({
  check: [checkAdmission],
  model: [admitted, selected],
  grammar: [historyArbitrary],
})

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
        for (const campaign of [`fixed`, `random`] as const) {
          const registration =
            campaign === `fixed`
              ? oracleReplayTest(it)
              : oracleReplayTest(it, property)
          registration(
            `${path} ${negative ? `rejects negatives` : `admits valid neighbors`} (${campaign})`,
            async () => {
              const states = [
                negative ? `negative` : `valid`,
                ...(path === `builder` ? [] : [`next-use`]),
                ...(path.endsWith(`pending`) ? [`held`] : []),
              ]
              const reach = createOracleReach(property, states, {
                fixedHistories: 1,
              })
              const fidelity = createOracleFailureFidelity<History>((history) =>
                JSON.stringify(history),
              )
              let count = 0
              await fidelity.assert(() =>
                fc.assert(
                  fc.asyncProperty(historyArbitrary, (history) => {
                    reach.beginHistory({ fixed: count++ === 0 })
                    return fidelity.run(history, async () => {
                      // Each accepted value gets its own held premise. Settling
                      // zero must not move the remaining candidates to readiness.
                      for (const candidate of negative
                        ? [undefined]
                        : [0, -0, history.limit, Infinity]) {
                        await runHistory(
                          history,
                          path,
                          negative,
                          (state) => reach.reach(state),
                          candidate,
                        )
                      }
                    })
                  }),
                  {
                    ...oraclePropertyOptions(20, property, {
                      examples: [[example]],
                    }),
                    ...(campaign === `fixed` ? { seed: 2291 } : {}),
                  },
                ),
              )
              reach.assertReached()
              if (process.env.TANSTACK_DB_ORACLE_STATISTICS === `1`) {
                process.stderr.write(
                  `${property} ${campaign} ${JSON.stringify(Object.fromEntries(reach.counts()))}\n`,
                )
              }
            },
          )
        }
      }
    }
  })
}

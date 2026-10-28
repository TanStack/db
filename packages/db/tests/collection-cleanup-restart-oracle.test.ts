import { afterAll, describe, expect, it, vi } from 'vitest'
import {
  BasicIndex,
  createCollection,
  createEffect,
  createLiveQueryCollection,
  eq,
  withCollectionSyncConfigCleanup,
} from '../src'
import { createDeferred } from '../src/deferred'
import { Query } from '../src/query/builder/index.js'
import { createPooledLiveQuery } from '../src/query/pooled-live-query.js'
import { createOracleReach } from './oracle-reach.js'
import { flushPromises } from './utils'
import type { CollectionDependent, SyncConfig } from '../src/types'

/**
 * # When does cleanup become observable?
 *
 * Authority comes from the public `Collection.cleanup()` contract and the
 * cleanup and cleanup-start terms in the contributing glossary. Public cleanup
 * first checks admission: it rejects while a live query or Effect reads the
 * Collection, and `cleanup({ dependents: true })` first cleans up each such
 * live query, with its own dependents, and disposes each such Effect. A direct
 * subscription is not refused: it survives cleanup and asks for data again in
 * the next sync run. `collection.subscribers` lists all three kinds. The
 * boundary histories below drive internal teardown, which bypasses that check,
 * as a retiring facade does. Cleanup has two boundaries. Cleanup start synchronously closes restart admission and
 * puts dependent live queries in terminal error while marking dependent Effects
 * disposed. Cleanup settlement publishes `cleaned-up` and settles the public
 * cleanup promise only after adapter cleanup settles. Cleanup start is internal;
 * it is not a Collection status and does not prove that adapter resources have
 * been released.
 *
 * The three-cut history grammar starts with a ready or loading source. Selected
 * histories add a live-query or Effect dependent. It invokes cleanup, holds
 * adapter cleanup, checks the cleanup-start observation, releases the adapter,
 * observes terminal `cleaned-up` publication, and checks the later
 * cleanup-Promise settlement.
 * Adjacent histories re-enter start or preload from abort and
 * release callbacks, request nested cleanup, reject adapter cleanup, throw
 * from cleanup-start observers, or register observers during active cleanup.
 * The late live-query history places the cleaning source before and after a
 * healthy source. Terminal setup must retain no partial source ownership.
 * A repeated-source history also proves one live query enters terminal error
 * once when two lexical aliases depend on the same Collection.
 * Errored eager and on-demand source histories clean up the dependent first,
 * then restart both Collections through live-query preload. They check the
 * same live-query object and subscriber after a later source update. These
 * pinned paths sit outside the three-cut model; they do not establish
 * automatic recovery after source-only restart.
 * If adapter cleanup and local teardown both fail, the aggregate keeps the
 * adapter error primary and every local error as an ordered secondary
 * diagnostic. A lone error keeps its identity.
 * Cleanup with dependents settles as a whole. It ends every dependent and
 * always starts the Collection's own cleanup, even when a dependent's `end()`
 * throws or rejects; its promise settles only after every dependent's end and
 * the Collection's cleanup settle, by when the Collection is `cleaned-up`, and
 * it rejects with one of those failures if any failed. The failing-dependents
 * product below checks this law for every pair of dependents drawn from
 * well-behaved, throwing, rejecting, and held ends, crossed with synchronous,
 * held, and rejecting adapter cleanup and both release orders.
 * No replacement sync run is admitted until terminal publication. Concurrent
 * callers share the cleanup promise. Rejection still finalizes the old run and
 * rejects every waiter. A later ordinary preload starts a new sync run.
 * A subset load still pending at cleanup ends with one `loadingSubset:change`
 * end transition, so no subscriber keeps a load that can no longer settle.
 *
 * `expectedCleanupBoundary` is a small independent three-cut timeline model. Its
 * `dependent` field combines the live query's terminal error and the Effect's
 * disposed state because both observations mean the dependent can no longer
 * use the discarded sync run. At cleanup start, status retains the prior public
 * value while cleanup remains pending. Terminal publication opens restart
 * admission and changes status to `cleaned-up` while the cleanup Promise remains
 * pending. The Promise settles afterward. The model does not reproduce manager
 * callbacks or adapter machinery. A status listener may restart at terminal
 * publication; adjacent event-restart histories exercise that reentry.
 * Ordinary subscriptions and resumption of deferred acquisition obey the same
 * restart admission boundary. Eighteen histories cross loading/ready/error cleanup,
 * eager/on-demand sources, and admission with or without a snapshot or through
 * deferred resumption. Rejection retains no new subscriber or acquisition;
 * explicit admission after cleanup settlement starts the replacement run.
 *
 * The production driver calls the real cleanup, live-query, and Effect entry
 * points. Refinement checks run before releasing the controlled adapter gate
 * and after the cleanup promise settles. Counts, exact errors, status, rows,
 * subscription and observer ownership, and settlement are observed. The alias
 * and late-registration cases are pinned refinements outside the three-cut
 * model. This suite does not establish full demand/replay histories, transport
 * shutdown, persistence-wrapper behavior, or general row-publication laws.
 */

type Row = { id: number; rank: number }
const cleanupError = {
  name: `CollectionStateError`,
  message: expect.stringContaining(`after cleanup() completes`),
}

type CleanupBoundary =
  `cleanup-start` | `terminal-publication` | `cleanup-settlement`
type CleanupBoundaryObservation<TStatus extends string> = {
  restartAdmission: `closed` | `open`
  collectionStatus: TStatus | `cleaned-up`
  cleanup: `pending` | `settled`
  dependent: `active` | `terminal`
}

/** Independent three-cut law for observations at each cleanup checkpoint. */
function expectedCleanupBoundary<TStatus extends string>(
  priorStatus: TStatus,
  boundary: CleanupBoundary,
): CleanupBoundaryObservation<TStatus> {
  if (boundary === `cleanup-start`) {
    return {
      restartAdmission: `closed`,
      collectionStatus: priorStatus,
      cleanup: `pending`,
      dependent: `terminal`,
    }
  }
  if (boundary === `terminal-publication`) {
    return {
      restartAdmission: `open`,
      collectionStatus: `cleaned-up`,
      cleanup: `pending`,
      dependent: `terminal`,
    }
  }
  return {
    restartAdmission: `open`,
    collectionStatus: `cleaned-up`,
    cleanup: `settled`,
    dependent: `terminal`,
  }
}

function observeRestartAdmission(start: () => void): `closed` | `open` {
  try {
    start()
    return `open`
  } catch (error) {
    expect(error).toMatchObject(cleanupError)
    return `closed`
  }
}

function observeCleanupSettlement(settled: boolean): `pending` | `settled` {
  return settled ? `settled` : `pending`
}

function observeDependent(active: boolean): `active` | `terminal` {
  return active ? `active` : `terminal`
}

const reentryScenarios = ([`abort`, `release`] as const).flatMap((boundary) =>
  [false, true].flatMap((nestedCleanup) =>
    [1, 2].map((attempts) => ({
      id: `${boundary}:${nestedCleanup ? `nested` : `plain`}:${attempts}`,
      boundary,
      nestedCleanup,
      attempts,
    })),
  ),
)

const completedBoundaryScenarios = ([`event`, `await`] as const).flatMap(
  (boundary) =>
    [false, true].map((liveQuery) => ({
      id: `${boundary}:${liveQuery ? `live-query` : `source`}`,
      boundary,
      liveQuery,
    })),
)

function expectExactCaseIds(
  actual: ReadonlyArray<{ id: string }>,
  expected: ReadonlyArray<string>,
): void {
  const ids = actual.map(({ id }) => id)
  expect(ids).toEqual(expected)
  expect(new Set(ids).size).toBe(ids.length)
}

async function withOracleCleanup<T>(
  body: () => T | Promise<T>,
  cleanups: Array<() => void | Promise<unknown>>,
): Promise<T> {
  let value: T | undefined
  const failures: Array<unknown> = []
  try {
    value = await body()
  } catch (error) {
    failures.push(error)
  }
  for (const cleanup of cleanups) {
    try {
      await cleanup()
    } catch (error) {
      failures.push(error)
    }
  }
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) {
    throw new AggregateError(failures, `Cleanup oracle and teardown failed`, {
      cause: failures[0],
    })
  }
  return value as T
}

describe(`Collection cleanup oracle calibration`, () => {
  it(`retains a primary mismatch and every teardown failure`, async () => {
    const primary = new Error(`oracle mismatch`)
    const firstCleanup = new Error(`first cleanup failed`)
    const secondCleanup = new Error(`second cleanup failed`)
    const attempts: Array<string> = []

    const failure = await withOracleCleanup(() => {
      throw primary
    }, [
      () => {
        attempts.push(`first`)
        throw firstCleanup
      },
      () => {
        attempts.push(`second`)
        return Promise.reject(secondCleanup)
      },
    ]).catch((error: unknown) => error)

    expect(attempts).toEqual([`first`, `second`])
    expect(failure).toBeInstanceOf(AggregateError)
    expect(failure).toMatchObject({
      cause: primary,
      errors: [primary, firstCleanup, secondCleanup],
    })
  })
})

/**
 * ## Cleanup with failing dependents
 *
 * Law: `cleanup({ dependents: true })` ends each dependent and starts the
 * Collection's own cleanup in the same call, whatever any dependent's end
 * does. Its promise settles only once every dependent's end and the
 * Collection's cleanup have settled; at that moment the Collection is
 * `cleaned-up`. It resolves when nothing failed and otherwise rejects with one
 * of the failures. Authority: the `Collection.cleanup()` JSDoc (an adapter
 * rejection rejects "after the Collection reaches its final cleaned-up
 * state"), the glossary's cleanup entry, and ARCHITECTURE law 14. The contract
 * names no precedence among failures, so the model accepts any of them.
 *
 * Model: `expectedDependentCleanup` reads only the declared cell. Work is
 * outstanding while a held dependent or a held adapter cleanup is unreleased;
 * the promise stays pending exactly that long, and the Collection keeps its
 * prior status exactly while its adapter cleanup is held.
 *
 * History grammar: an ordered pair of dependents, each ending by resolving,
 * throwing synchronously, rejecting, or holding and then resolving or
 * rejecting, or a pooled live query whose status listener throws at its end.
 * A pooled view, like a live-query Collection's emitter, gives each listener
 * its own call and reports a throw as uncaught, so that view's end succeeds
 * and the driver checks the throw was reported. Adapter cleanup is
 * synchronous, held then resolved, or held then rejected. When both sides
 * hold, either side is released first.
 *
 * Production driver: scripted dependents register through the internal
 * subscription `owner`, the same boundary every live query, Effect, and
 * pooled view uses. The driver calls the public `cleanup({ dependents: true })`
 * and releases the gates one at a time.
 *
 * Refinement check: the call returns a promise; it has ended both dependents
 * and invoked adapter cleanup by then; after each release the promise is
 * pending exactly while work is outstanding and the status matches the
 * model; the settlement continuation sees `cleaned-up` and every end settled;
 * the outcome and reason match the model.
 *
 * Calibration: ending dependents before starting the Collection's own cleanup
 * without catching a throw fails every throwing cell; settling with
 * `Promise.all` fails every cell where a dependent rejects while the adapter
 * cleanup is held; settling with `Promise.allSettled` over the dependents
 * alone fails every held-adapter cell.
 *
 * Limits: one Collection with two dependents; Effects and nested live-query
 * chains are covered only by the admission history above.
 */
type DependentEnd =
  | `resolve`
  | `throw`
  | `reject`
  | `held-resolve`
  | `held-reject`
  | `pooled-throw`
type AdapterCleanup = `sync` | `held-resolve` | `held-reject`
type DependentCleanupCell = {
  id: string
  ends: readonly [DependentEnd, DependentEnd]
  adapter: AdapterCleanup
  // Which side the driver releases first when both hold.
  adapterFirst: boolean
}

const dependentEnds: ReadonlyArray<DependentEnd> = [
  `resolve`,
  `throw`,
  `reject`,
  `held-resolve`,
  `held-reject`,
  `pooled-throw`,
]
const adapterCleanups: ReadonlyArray<AdapterCleanup> = [
  `sync`,
  `held-resolve`,
  `held-reject`,
]
const holds = (behavior: string) => behavior.startsWith(`held`)
const dependentCleanupCells: ReadonlyArray<DependentCleanupCell> =
  dependentEnds.flatMap((first) =>
    dependentEnds.flatMap((second) =>
      adapterCleanups.flatMap((adapter) =>
        (holds(adapter) && (holds(first) || holds(second))
          ? [false, true]
          : [false]
        ).map((adapterFirst) => ({
          id: `${first}+${second}:${adapter}${adapterFirst ? `:adapter-first` : ``}`,
          ends: [first, second] as const,
          adapter,
          adapterFirst,
        })),
      ),
    ),
  )

type Gate = `dependent-0` | `dependent-1` | `adapter`
type DependentCleanupExpectation = {
  // Gates in release order.
  releases: Array<Gate>
  // Whether the promise is still pending with these gates unreleased.
  pendingWhile: (unreleased: ReadonlySet<Gate>) => boolean
  statusWhile: (unreleased: ReadonlySet<Gate>) => `ready` | `cleaned-up`
  outcome: `resolved` | `rejected`
}

/** Independent model of one cell. */
function expectedDependentCleanup(
  cell: DependentCleanupCell,
): DependentCleanupExpectation {
  const heldDependents = cell.ends.flatMap((behavior, index) =>
    holds(behavior) ? [`dependent-${index}` as Gate] : [],
  )
  const adapter: Array<Gate> = holds(cell.adapter) ? [`adapter`] : []
  const fails = (behavior: string) =>
    behavior !== `resolve` &&
    behavior !== `sync` &&
    behavior !== `held-resolve` &&
    behavior !== `pooled-throw`
  return {
    releases: cell.adapterFirst
      ? [...adapter, ...heldDependents]
      : [...heldDependents, ...adapter],
    pendingWhile: (unreleased) => unreleased.size > 0,
    statusWhile: (unreleased) =>
      unreleased.has(`adapter`) ? `ready` : `cleaned-up`,
    outcome: [...cell.ends, cell.adapter].some(fails) ? `rejected` : `resolved`,
  }
}

const dependentCleanupReachStates = [
  `dependent-end-threw`,
  `dependent-failed-while-adapter-held`,
  `held-dependent-outlasted-adapter`,
  `adapter-rejected-after-dependent-failure`,
] as const

describe(`Collection cleanup with failing dependents oracle`, () => {
  const reach = createOracleReach(
    `collection-cleanup.dependents`,
    dependentCleanupReachStates,
  )
  afterAll(() => reach.assertReached())

  it(`declares each cell of the dependents product once`, () => {
    const ids = dependentCleanupCells.map(({ id }) => id)
    expect(new Set(ids).size).toBe(ids.length)
    // 6 x 6 pairs x 3 adapters, plus a second release order for the 20 pairs
    // with a held dependent under each of the 2 held adapters.
    expect(ids.length).toBe(6 * 6 * 3 + 20 * 2)
  })

  it.each(dependentCleanupCells)(
    `settles after every dependent and the source's own cleanup: $id`,
    async (cell) => {
      reach.beginHistory()
      const expected = expectedDependentCleanup(cell)
      const gates = new Map<Gate, ReturnType<typeof createDeferred<void>>>()
      // Teardown's own cleanup must not wait on a gate nobody releases.
      let tearingDown = false
      const gate = (name: Gate) => {
        const deferred = createDeferred<void>()
        gates.set(name, deferred)
        if (tearingDown) deferred.resolve()
        return deferred.promise
      }
      const failures = new Map<Gate | `adapter-cause`, Error>()
      const failure = (name: Gate) => {
        const error = new Error(`${name} failed exactly`)
        failures.set(name, error)
        return error
      }
      let adapterCalls = 0
      let adapterSettled = false
      // A listener's throw the pooled view reports uncaught.
      const uncaught: Array<unknown> = []
      const queueMicrotask = globalThis.queueMicrotask
      globalThis.queueMicrotask = (callback) =>
        queueMicrotask(() => {
          try {
            callback()
          } catch (error) {
            if ([...failures.values()].includes(error as Error))
              uncaught.push(error)
            else throw error
          }
        })
      const source = createCollection<Row, number>({
        getKey: (row) => row.id,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            begin()
            write({ type: `insert`, value: { id: 1, rank: 1 } })
            commit()
            markReady()
            return {
              cleanup: () => {
                adapterCalls++
                if (cell.adapter === `sync`) {
                  adapterSettled = true
                  return undefined
                }
                return gate(`adapter`).finally(() => {
                  adapterSettled = true
                  if (cell.adapter === `held-reject`) {
                    failures.set(`adapter-cause`, failure(`adapter`))
                    throw failures.get(`adapter`)
                  }
                })
              },
            }
          },
        },
      })
      const started = [false, false]
      const settled = [false, false]
      const teardown: Array<() => void> = []
      const markFailedWhileHeld = () => {
        if (holds(cell.adapter) && !adapterSettled) {
          reach.reach(`dependent-failed-while-adapter-held`)
        }
      }
      const register = (behavior: DependentEnd, index: 0 | 1) => {
        const name = `dependent-${index}` as Gate
        if (behavior === `pooled-throw`) {
          // A pooled view on its own field, so each is its own dependent.
          const query = new Query()
            .from({ r: source })
            .where(({ r }) => eq(index === 0 ? r.rank : r.id, 1))
          // The builder's public type hides the members the pool reads.
          const view = createPooledLiveQuery(
            query as unknown as Parameters<typeof createPooledLiveQuery>[0],
          ) as unknown as {
            on: (event: `status:change`, listener: () => void) => () => void
          }
          let thrown = false
          teardown.push(
            view.on(`status:change`, () => {
              if (thrown) return
              thrown = true
              started[index] = true
              settled[index] = true
              reach.reach(`dependent-end-threw`)
              markFailedWhileHeld()
              throw failure(name)
            }),
          )
          return
        }
        const owner: CollectionDependent = {
          kind: `live-query`,
          active: true,
          end: () => {
            started[index] = true
            subscription.unsubscribe()
            const finish = () => {
              settled[index] = true
            }
            if (behavior === `resolve`) {
              finish()
              return Promise.resolve()
            }
            if (behavior === `throw`) {
              finish()
              reach.reach(`dependent-end-threw`)
              throw failure(name)
            }
            if (behavior === `reject`) {
              finish()
              markFailedWhileHeld()
              return Promise.reject(failure(name))
            }
            return gate(name).then(() => {
              finish()
              if (behavior === `held-reject`) {
                markFailedWhileHeld()
                throw failure(name)
              }
            })
          },
        }
        const subscription = source.subscribeChanges(() => {}, { owner })
      }

      try {
        await source.preload()
        register(cell.ends[0], 0)
        register(cell.ends[1], 1)
        expect(source.subscribers).toHaveLength(2)

        let call: Promise<void>
        try {
          call = source.cleanup({ dependents: true })
        } catch (error) {
          throw new Error(`cleanup threw synchronously instead of rejecting`, {
            cause: error,
          })
        }
        let atSettlement:
          { status: string; ended: boolean; adapter: boolean } | undefined
        const outcome = call.then(
          () => `resolved` as const,
          (error: unknown) => ({ error }),
        )
        void outcome.then(() => {
          atSettlement = {
            status: source.status,
            ended: settled.every(Boolean),
            adapter: adapterSettled,
          }
        })
        // The call ends both dependents and starts the source's cleanup.
        expect(started, `dependents ended in the call`).toEqual([true, true])
        expect(adapterCalls, `adapter cleanup started in the call`).toBe(1)

        const unreleased = new Set(expected.releases)
        const checkpoint = async (label: string) => {
          await flushPromises()
          expect(atSettlement === undefined, `${label}: pending`).toBe(
            expected.pendingWhile(unreleased),
          )
          expect(source.status, `${label}: status`).toBe(
            expected.statusWhile(unreleased),
          )
        }
        await checkpoint(`after the call`)
        for (const name of expected.releases) {
          if (name === `adapter` && unreleased.size > 1) {
            reach.reach(`held-dependent-outlasted-adapter`)
          }
          if (
            name === `adapter` &&
            cell.adapter === `held-reject` &&
            failures.size > 0
          ) {
            reach.reach(`adapter-rejected-after-dependent-failure`)
          }
          gates.get(name)!.resolve()
          unreleased.delete(name)
          await checkpoint(`after releasing ${name}`)
        }

        const result = await outcome
        expect(atSettlement, `at settlement`).toEqual({
          status: `cleaned-up`,
          ended: true,
          adapter: true,
        })
        expect(result === `resolved` ? `resolved` : `rejected`).toBe(
          expected.outcome,
        )
        if (result !== `resolved`) {
          const reason = result.error as { cause?: unknown }
          const dependentFailures = [
            failures.get(`dependent-0`),
            failures.get(`dependent-1`),
          ].filter(Boolean)
          expect(
            dependentFailures.includes(reason as Error) ||
              (failures.has(`adapter-cause`) &&
                reason.cause === failures.get(`adapter-cause`)),
            `rejects with one of this cell's failures`,
          ).toBe(true)
        }
        expect(source.status).toBe(`cleaned-up`)
        await flushPromises()
        cell.ends.forEach((behavior, index) => {
          if (behavior === `pooled-throw`)
            expect(
              uncaught,
              `dependent-${index}'s listener throw is reported uncaught`,
            ).toContain(failures.get(`dependent-${index}` as Gate))
        })
      } finally {
        globalThis.queueMicrotask = queueMicrotask
        tearingDown = true
        for (const deferred of gates.values()) deferred.resolve()
        for (const stop of teardown) stop()
        await flushPromises()
        await source.cleanup({ dependents: true }).catch(() => undefined)
      }
    },
  )
})

describe(`Collection cleanup admission oracle`, () => {
  it(`refuses cleanup while a live query or Effect reads it, and ends dependents first on request`, async () => {
    let starts = 0
    let ops!: Parameters<SyncConfig<Row, number>[`sync`]>[0]
    const source = createCollection<Row, number>({
      getKey: (row) => row.id,
      sync: {
        sync: (params) => {
          ops = params
          starts++
          params.begin()
          params.write({ type: `insert`, value: { id: starts, rank: starts } })
          params.commit()
          params.markReady()
        },
      },
    })
    const inner = createLiveQueryCollection((q) => q.from({ row: source }))
    const outer = createLiveQueryCollection((q) => q.from({ row: inner }))
    const effect = createEffect({
      query: (q) => q.from({ row: source }),
      onBatch: () => {},
    })
    const received: Array<number> = []
    const direct = source.subscribeChanges((changes) => {
      for (const change of changes) received.push(change.key)
    })
    try {
      await outer.preload()
      // Model: three readers of the source, one of each kind; the outer query
      // reads the inner one, not the source.
      expect(source.subscribers.map(({ kind }) => kind).sort()).toEqual([
        `effect`,
        `live-query`,
        `subscription`,
      ])
      expect(
        source.subscribers.find(({ kind }) => kind === `live-query`)
          ?.collection,
      ).toBe(inner)
      expect(inner.subscribers.map(({ collection }) => collection)).toEqual([
        outer,
      ])

      // A plain cleanup refuses and changes nothing.
      await expect(source.cleanup()).rejects.toThrow(/dependent/)
      expect([source.status, inner.status, outer.status]).toEqual([
        `ready`,
        `ready`,
        `ready`,
      ])
      expect(effect.disposed).toBe(false)

      // With its dependents, cleanup ends the query chain and the Effect
      // first. The direct subscription survives into the next sync run.
      await source.cleanup({ dependents: true })
      expect([source.status, inner.status, outer.status]).toEqual([
        `cleaned-up`,
        `cleaned-up`,
        `cleaned-up`,
      ])
      expect(effect.disposed).toBe(true)
      expect(source.subscribers.map(({ kind }) => kind)).toEqual([
        `subscription`,
      ])
      received.length = 0
      source.startSyncImmediate()
      expect(starts).toBe(2)
      ops.begin()
      ops.write({ type: `insert`, value: { id: 9, rank: 9 } })
      ops.commit()
      expect(received).toContain(9)
      // Only direct subscriptions and an idle live query remain. Nothing
      // reads the idle query, so a plain cleanup is admitted; the idle query
      // ends at cleanup start, as a query under internal teardown does.
      const idle = createLiveQueryCollection((q) => q.from({ row: source }))
      await idle.preload()
      expect(
        source.subscribers.find(({ collection }) => collection === idle)
          ?.active,
      ).toBe(false)
      await source.cleanup()
      expect(source.status).toBe(`cleaned-up`)
      expect(idle.status).toBe(`crashed`)
    } finally {
      direct.unsubscribe()
      await outer.cleanup({ dependents: true })
      await effect.dispose()
      await source.cleanup({ dependents: true })
    }
  })

  // Logical demand is distinct from a request to start a sync run. Cleanup
  // rejects the latter, including resumption, while a deferred subscription
  // may retain demand without starting even a live-query Collection's run.
  // Idle and cleaned-up sources distinguish this law from checking only ready
  // Collections. The callback is the synchronous cleanup-start observation cut.
  it.each(
    ([`plain`, `live-query`] as const).flatMap((kind) =>
      ([`idle`, `ready`, `cleaned-up`] as const).map((priorStatus) => ({
        kind,
        priorStatus,
      })),
    ),
  )(
    `retains deferred demand during $priorStatus $kind cleanup`,
    async ({ kind, priorStatus }) => {
      let starts = 0
      const source = createCollection<Row, number>({
        getKey: (row) => row.id,
        gcTime: 0,
        sync: {
          sync: ({ markReady }) => {
            starts++
            markReady()
          },
        },
      })
      const live = createLiveQueryCollection({
        query: (q) => q.from({ row: source }),
        gcTime: 0,
      })
      const collection = kind === `plain` ? source : live
      let subscription:
        ReturnType<typeof collection.subscribeChanges> | undefined
      let reached = false
      if (priorStatus === `ready`) {
        source.startSyncImmediate()
        collection.startSyncImmediate()
      } else if (priorStatus === `cleaned-up`) {
        await collection.cleanup()
      }
      const before = starts
      const stop = collection._onCleanupStart(() => {
        reached = true
        expect(() => collection.subscribeChanges(() => {})).toThrow(
          expect.objectContaining(cleanupError),
        )
        subscription = collection.subscribeChanges(() => {}, {
          deferAcquisition: true,
          includeInitialState: true,
        })
        expect(subscription.isDeferringAcquisition()).toBe(true)
        expect(() => subscription!.resumeDeferredAcquisition()).toThrow(
          expect.objectContaining(cleanupError),
        )
        expect(collection.subscriberCount).toBe(0)
        expect(starts).toBe(before)
      })
      await withOracleCleanup(async () => {
        await collection.cleanup()
        expect(reached).toBe(true)
        expect(subscription).toBeDefined()
        expect(starts).toBe(before)
        stop()
        subscription!.resumeDeferredAcquisition()
        for (let turn = 0; turn < 10; turn++) await Promise.resolve()
        expect(collection.status).toBe(`ready`)
        expect(collection.subscriberCount).toBe(1)
      }, [
        stop,
        () => subscription?.unsubscribe(),
        () => live.cleanup(),
        () => source.cleanup(),
      ])
    },
  )

  // Promise ownership changes only when a replacement run actually starts.
  // A validation failure or a still-deferred start cannot create a second
  // retirement. Successful admission is the neighboring case: its new run
  // must have a distinct cleanup promise even before the old one settles.
  it.each([
    `none`,
    `deferred-start`,
    `listener-failure`,
    `subscribe`,
    `resume`,
    `preload`,
  ] as const)(
    `preserves retirement identity through %s admission`,
    async (admission) => {
      let starts = 0
      let cleanups = 0
      const collection = createCollection<Row, number>({
        getKey: (row) => row.id,
        gcTime: 0,
        sync: {
          sync: ({ markReady }) => {
            starts++
            markReady()
            return () => {
              cleanups++
            }
          },
        },
      })
      collection.startSyncImmediate()
      const first = collection.cleanup()
      const failure = new Error(`demand failed before replacement startup`)
      let stop = () => {}
      let subscription:
        ReturnType<typeof collection.subscribeChanges> | undefined
      let preload: Promise<void> | undefined
      await withOracleCleanup(async () => {
        if (admission === `listener-failure`) {
          stop = collection[`_changes`].onFirstSubscriberOrPreload(() => {
            throw failure
          })
          expect(() => collection.subscribeChanges(() => {})).toThrow(failure)
        } else if (admission === `deferred-start`) {
          collection._deferSyncStart()
          collection.startSyncImmediate()
        } else if (admission === `subscribe`) {
          subscription = collection.subscribeChanges(() => {})
        } else if (admission === `resume`) {
          subscription = collection.subscribeChanges(() => {}, {
            deferAcquisition: true,
          })
          subscription.resumeDeferredAcquisition()
        } else if (admission === `preload`) preload = collection.preload()
        const replacement = [`subscribe`, `resume`, `preload`].includes(
          admission,
        )
        const second = collection.cleanup()
        expect(second === first).toBe(!replacement)
        expect(starts).toBe(replacement ? 2 : 1)
        expect(cleanups).toBe(starts)
        await Promise.all([first, second, preload])
      }, [
        () => stop(),
        () => subscription?.unsubscribe(),
        () => collection.cleanup(),
      ])
    },
  )

  // These paths share the three-cut model above. The held adapter promise
  // reaches cleanup start without confusing the retained public status with
  // permission to start another sync run. No automatic retry is requested.
  const subscriberAdmissionCases = (
    [`loading`, `ready`, `error`] as const
  ).flatMap((priorStatus) =>
    ([`eager`, `on-demand`] as const).flatMap((syncMode) =>
      ([`subscribe`, `snapshot`, `resume`] as const).map((admission) => ({
        priorStatus,
        syncMode,
        admission,
      })),
    ),
  )

  it.each(subscriberAdmissionCases)(
    `closes $admission admission during $priorStatus $syncMode cleanup`,
    async ({ priorStatus, syncMode, admission }) => {
      const cleanupGate = createDeferred<void>()
      let starts = 0
      let acquisitions = 0
      let callbackCount = 0
      const subscriberCounts: Array<number> = []
      const rows = new Map<number, Row>()
      let publish = () => {}
      const collection = createCollection<Row, number>({
        getKey: (row) => row.id,
        syncMode,
        sync: {
          sync: ({ begin, write, commit, markReady, fail }) => {
            starts++
            publish = () => {
              begin()
              write({ type: `insert`, value: { id: 1, rank: starts } })
              commit()
            }
            if (priorStatus === `ready` || starts > 1) markReady()
            if (priorStatus === `error` && starts === 1) {
              fail(new Error(`initial source error`))
            }
            return {
              cleanup: () => cleanupGate.promise,
              loadSubset: () => {
                acquisitions++
                return true
              },
            }
          },
        },
      })
      let subscription:
        ReturnType<typeof collection.subscribeChanges> | undefined
      const subscribe = () => {
        subscription = collection.subscribeChanges(
          (changes) => {
            callbackCount++
            for (const change of changes) {
              if (change.type === `delete`) rows.delete(change.key)
              else {
                const { id, rank } = change.value
                rows.set(change.key, { id, rank })
              }
            }
          },
          {
            includeInitialState: admission !== `subscribe`,
            deferAcquisition: admission === `resume`,
          },
        )
      }
      const admit = () => {
        if (admission === `resume`) subscription!.resumeDeferredAcquisition()
        else subscribe()
      }
      const off = collection.on(`subscribers:change`, ({ subscriberCount }) => {
        subscriberCounts.push(subscriberCount)
      })

      await withOracleCleanup(async () => {
        collection.startSyncImmediate()
        const cleanup = collection.cleanup()
        // A deferring subscription starts no source work and may keep its
        // logical demand. Only its attempted resumption must be rejected.
        if (admission === `resume`) subscribe()
        // Deferred admission may report its local snapshot. The rejected
        // resumption must add no callback to that already-observed prefix.
        const callbacksBeforeAdmission = callbackCount
        const atStart = expectedCleanupBoundary(priorStatus, `cleanup-start`)
        expect(collection.status).toBe(atStart.collectionStatus)
        expect(observeRestartAdmission(admit)).toBe(atStart.restartAdmission)
        expect(collection.subscriberCount).toBe(0)
        expect(subscriberCounts).toEqual([])
        expect(callbackCount).toBe(callbacksBeforeAdmission)
        expect(acquisitions).toBe(0)
        expect(starts).toBe(1)
        if (admission === `resume`) {
          expect(subscription!.isDeferringAcquisition()).toBe(true)
        }

        cleanupGate.resolve()
        await cleanup
        const settled = expectedCleanupBoundary(
          priorStatus,
          `cleanup-settlement`,
        )
        expect(collection.status).toBe(settled.collectionStatus)
        expect(starts).toBe(1)
        expect(collection.subscriberCount).toBe(0)
        expect(callbackCount).toBe(callbacksBeforeAdmission)
        expect(observeRestartAdmission(admit)).toBe(settled.restartAdmission)
        expect(collection.subscriberCount).toBe(1)
        expect(starts).toBe(2)
        publish()
        expect([...rows.values()]).toEqual([{ id: 1, rank: 2 }])
      }, [
        () => cleanupGate.resolve(),
        () => subscription?.unsubscribe(),
        off,
        () => collection.cleanup(),
      ])
    },
  )

  it(`calibrates every declared bounded-product cell exactly once`, () => {
    expectExactCaseIds(reentryScenarios, [
      `abort:plain:1`,
      `abort:plain:2`,
      `abort:nested:1`,
      `abort:nested:2`,
      `release:plain:1`,
      `release:plain:2`,
      `release:nested:1`,
      `release:nested:2`,
    ])
    expectExactCaseIds(completedBoundaryScenarios, [
      `event:source`,
      `event:live-query`,
      `await:source`,
      `await:live-query`,
    ])
  })

  it(`awaits a structural thenable returned from contextual-void cleanup`, async () => {
    const cleanupGate = createDeferred<void>()
    let cleanupCalls = 0
    const thenable = {
      then: cleanupGate.promise.then.bind(cleanupGate.promise),
    }
    const cleanup: () => void = () => {
      cleanupCalls++
      return thenable
    }
    const collection = createCollection<Row, number>({
      getKey: (row) => row.id,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return cleanup
        },
      },
    })

    await withOracleCleanup(async () => {
      await collection.preload()
      let settled = false
      const retirement = collection.cleanup().then(() => {
        settled = true
      })

      expect(cleanupCalls).toBe(1)
      expect(collection.status).toBe(`ready`)
      expect(() => collection.startSyncImmediate()).toThrowError(
        expect.objectContaining(cleanupError),
      )
      await Promise.resolve()
      expect(settled).toBe(false)

      cleanupGate.resolve()
      await retirement
      expect(collection.status).toBe(`cleaned-up`)
    }, [() => cleanupGate.resolve(), () => collection.cleanup()])
  })

  it(`waits for source cleanup before publishing the restart boundary`, async () => {
    const cleanupGate = createDeferred<void>()
    let starts = 0
    let cleanups = 0
    let sourceCleanupSettled = false
    const statuses: Array<string> = []
    const settlementOrder: Array<string> = []
    let publicCleanupSettled = false
    let atTerminalPublication:
      | Pick<
          CleanupBoundaryObservation<`ready`>,
          `collectionStatus` | `cleanup`
        >
      | undefined
    const collection = createCollection<Row, number>({
      getKey: (row) => row.id,
      sync: {
        sync: ({ markReady }) => {
          starts++
          markReady()
          return {
            cleanup: () => {
              cleanups++
              return cleanupGate.promise.then(() => {
                sourceCleanupSettled = true
                settlementOrder.push(`adapter-cleanup-settled`)
              })
            },
          }
        },
      },
    })
    const off = collection.on(`status:change`, ({ status }) => {
      statuses.push(status)
      if (status === `cleaned-up`) {
        atTerminalPublication = {
          collectionStatus: status,
          cleanup: observeCleanupSettlement(publicCleanupSettled),
        }
        settlementOrder.push(`cleaned-up-event`)
      }
    })

    try {
      await collection.preload()
      statuses.length = 0

      const firstCleanup = collection.cleanup()
      const concurrentCleanup = collection.cleanup()
      void firstCleanup.then(() => {
        publicCleanupSettled = true
        settlementOrder.push(`public-cleanup-promise-continuation`)
      })

      const atCleanupStart = expectedCleanupBoundary(`ready`, `cleanup-start`)
      expect(sourceCleanupSettled).toBe(false)
      expect(collection.status).toBe(atCleanupStart.collectionStatus)
      expect(statuses).toEqual([])
      expect(cleanups).toBe(1)
      expect(concurrentCleanup).toBe(firstCleanup)
      expect(
        observeRestartAdmission(() => collection.startSyncImmediate()),
      ).toBe(atCleanupStart.restartAdmission)

      cleanupGate.resolve()
      await Promise.all([firstCleanup, concurrentCleanup])

      const atCleanupSettlement = expectedCleanupBoundary(
        `ready`,
        `cleanup-settlement`,
      )
      expect(sourceCleanupSettled).toBe(true)
      const terminalPublication = expectedCleanupBoundary(
        `ready`,
        `terminal-publication`,
      )
      expect(atTerminalPublication).toEqual({
        collectionStatus: terminalPublication.collectionStatus,
        cleanup: terminalPublication.cleanup,
      })
      expect(collection.status).toBe(atCleanupSettlement.collectionStatus)
      expect(statuses).toEqual([`cleaned-up`])
      expect(settlementOrder).toEqual([
        `adapter-cleanup-settled`,
        `cleaned-up-event`,
        `public-cleanup-promise-continuation`,
      ])

      await expect(collection.cleanup()).resolves.toBeUndefined()
      expect(cleanups).toBe(1)

      expect(
        observeRestartAdmission(() => collection.startSyncImmediate()),
      ).toBe(atCleanupSettlement.restartAdmission)
      expect(starts).toBe(2)
      expect(collection.status).toBe(`ready`)
    } finally {
      cleanupGate.resolve()
      off()
      await collection.cleanup()
    }
  })

  it(`retains loading status at cleanup start, then admits restart`, async () => {
    const cleanupGate = createDeferred<void>()
    const statuses: Array<string> = []
    let starts = 0
    const collection = createCollection<Row, number>({
      getKey: (row) => row.id,
      sync: {
        sync: ({ markReady }) => {
          starts++
          if (starts > 1) markReady()
          return { cleanup: () => cleanupGate.promise }
        },
      },
    })
    const off = collection.on(`status:change`, ({ status }) => {
      statuses.push(status)
    })

    try {
      collection.startSyncImmediate()
      expect(collection.status).toBe(`loading`)
      statuses.length = 0

      let cleanupSettled = false
      const cleanup = collection.cleanup().then(() => {
        cleanupSettled = true
      })
      const atCleanupStart = expectedCleanupBoundary(`loading`, `cleanup-start`)

      // A rule that forces ready at cleanup start fails at this held cut.
      expect(collection.status).toBe(atCleanupStart.collectionStatus)
      expect(statuses).toEqual([])
      expect(observeCleanupSettlement(cleanupSettled)).toBe(
        atCleanupStart.cleanup,
      )
      expect(
        observeRestartAdmission(() => collection.startSyncImmediate()),
      ).toBe(atCleanupStart.restartAdmission)

      cleanupGate.resolve()
      await cleanup
      const atCleanupSettlement = expectedCleanupBoundary(
        `loading`,
        `cleanup-settlement`,
      )
      expect(collection.status).toBe(atCleanupSettlement.collectionStatus)
      expect(statuses).toEqual([`cleaned-up`])
      expect(observeCleanupSettlement(cleanupSettled)).toBe(
        atCleanupSettlement.cleanup,
      )

      collection.startSyncImmediate()
      expect(starts).toBe(2)
      expect(collection.status).toBe(`ready`)
    } finally {
      cleanupGate.resolve()
      off()
      await collection.cleanup()
    }
  })

  it(`rejects dependent preload when cleanup starts before terminal settlement`, async () => {
    const cleanupGate = createDeferred<void>()
    const loadGate = createDeferred<void>()
    const loadEntered = createDeferred<void>()
    const source = createCollection<Row, number>({
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return {
            loadSubset: () => {
              loadEntered.resolve()
              return loadGate.promise
            },
            cleanup: () => cleanupGate.promise,
          }
        },
      },
    })
    const live = createLiveQueryCollection((q) => q.from({ row: source }))
    const message =
      `Source collection '${source.id}' was manually cleaned up while live query '${live.id}' depends on it. ` +
      `Live queries prevent automatic GC, so this was likely a manual cleanup() call.`
    const reports = vi.spyOn(console, `error`).mockImplementation(() => {})
    const preload = live.preload().then(
      () => ({ status: `fulfilled` as const }),
      (error: unknown) => ({ status: `rejected` as const, error }),
    )

    try {
      await loadEntered.promise
      // Internal teardown that bypasses cleanup admission, such as a retiring
      // facade, still crashes the dependent at cleanup start.
      let cleanupSettled = false
      const cleanup = source._lifecycle.cleanup().then(() => {
        cleanupSettled = true
      })

      const atCleanupStart = expectedCleanupBoundary(`ready`, `cleanup-start`)
      expect(source.status).toBe(atCleanupStart.collectionStatus)
      expect(observeCleanupSettlement(cleanupSettled)).toBe(
        atCleanupStart.cleanup,
      )
      expect(observeDependent(live.status !== `crashed`)).toBe(
        atCleanupStart.dependent,
      )
      expect(await preload).toMatchObject({
        status: `rejected`,
        error: { message },
      })

      cleanupGate.resolve()
      await cleanup
      expect(source.status).toBe(`cleaned-up`)
      expect(reports.mock.calls).toEqual([[`[Live Query Error] ${message}`]])
    } finally {
      cleanupGate.resolve()
      loadGate.resolve()
      reports.mockRestore()
      await live.cleanup()
      await source.cleanup()
    }
  })

  it(`crashes a live query once when internal teardown retires a source it reads under two aliases`, async () => {
    const cleanupGate = createDeferred<void>()
    const source = createCollection<Row, number>({
      getKey: (row) => row.id,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          write({ type: `insert`, value: { id: 1, rank: 1 } })
          commit()
          markReady()
          return { cleanup: () => cleanupGate.promise }
        },
      },
    })
    source.createIndex((row) => row.id, { indexType: BasicIndex })
    const live = createLiveQueryCollection((q) =>
      q
        .from({ left: source })
        .join(
          { right: source },
          ({ left, right }) => eq(left.id, right.id),
          `inner`,
        ),
    )
    const reports = vi.spyOn(console, `error`).mockImplementation(() => {})

    try {
      await live.preload()

      // Internal teardown that bypasses admission crashes the query once.
      const cleanup = source._lifecycle.cleanup()

      expect(live.status).toBe(`crashed`)
      expect(reports).toHaveBeenCalledTimes(1)

      cleanupGate.resolve()
      await cleanup
    } finally {
      cleanupGate.resolve()
      reports.mockRestore()
      await live.cleanup()
      await source.cleanup()
    }
  })

  it(`disposes a dependent Effect when cleanup starts before terminal settlement`, async () => {
    const cleanupGate = createDeferred<void>()
    const handlerGate = createDeferred<void>()
    const handlerEntered = createDeferred<void>()
    const sourceErrors: Array<Error> = []
    let adapterCleanupStarted = 0
    const source = createCollection<Row, number>({
      getKey: (row) => row.id,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          write({ type: `insert`, value: { id: 1, rank: 1 } })
          commit()
          markReady()
          return {
            cleanup: () => {
              adapterCleanupStarted++
              return cleanupGate.promise
            },
          }
        },
      },
    })
    const effect = createEffect({
      query: (q) => q.from({ row: source }),
      onEnter: () => {
        handlerEntered.resolve()
        return handlerGate.promise
      },
      onSourceError: (error) => sourceErrors.push(error),
    })

    try {
      await handlerEntered.promise
      expect(effect.disposed).toBe(false)
      expect(source.subscriberCount).toBe(1)

      // The public cleanup refuses while the Effect reads the source.
      // Internal teardown that bypasses it disposes the Effect at cleanup
      // start.
      await expect(source.cleanup()).rejects.toThrow(/dependent/)
      let cleanupSettled = false
      const cleanup = source._lifecycle.cleanup().then(() => {
        cleanupSettled = true
      })
      const atCleanupStart = expectedCleanupBoundary(`ready`, `cleanup-start`)

      expect(adapterCleanupStarted).toBe(1)
      expect(source.status).toBe(atCleanupStart.collectionStatus)
      expect(observeCleanupSettlement(cleanupSettled)).toBe(
        atCleanupStart.cleanup,
      )
      expect(observeDependent(!effect.disposed)).toBe(atCleanupStart.dependent)
      expect(source.subscriberCount).toBe(0)
      expect(sourceErrors).toEqual([
        expect.objectContaining({
          message: `Source collection '${source.id}' was cleaned up while effect depends on it`,
        }),
      ])
      let effectDisposalSettled = false
      const effectDisposal = effect.dispose().then(() => {
        effectDisposalSettled = true
      })
      expect(effectDisposalSettled).toBe(false)

      handlerGate.resolve()
      await effectDisposal
      expect(effectDisposalSettled).toBe(true)
      expect(cleanupSettled).toBe(false)

      cleanupGate.resolve()
      await cleanup
      const atCleanupSettlement = expectedCleanupBoundary(
        `ready`,
        `cleanup-settlement`,
      )

      expect(observeCleanupSettlement(cleanupSettled)).toBe(
        atCleanupSettlement.cleanup,
      )
      expect(source.status).toBe(atCleanupSettlement.collectionStatus)
      expect(observeDependent(!effect.disposed)).toBe(
        atCleanupSettlement.dependent,
      )
      expect(sourceErrors).toHaveLength(1)
    } finally {
      cleanupGate.resolve()
      handlerGate.resolve()
      await effect.dispose()
      await source.cleanup()
    }
  })

  it(`continues teardown when a cleanup-start observer throws`, async () => {
    const cleanupGate = createDeferred<void>()
    const observerError = new Error(`cleanup-start observer failed exactly`)
    let starts = 0
    let adapterCleanupStarted = 0
    const source = createCollection<Row, number>({
      getKey: (row) => row.id,
      sync: {
        sync: ({ markReady }) => {
          starts++
          markReady()
          return {
            cleanup: () => {
              adapterCleanupStarted++
              return cleanupGate.promise
            },
          }
        },
      },
    })
    const off = source._onCleanupStart(() => {
      throw observerError
    })

    try {
      await source.preload()
      const cleanupOutcome = source.cleanup().then(
        () => undefined,
        (error: unknown) => error,
      )

      expect(adapterCleanupStarted).toBe(1)
      expect(source.status).toBe(`ready`)

      cleanupGate.resolve()
      expect(await cleanupOutcome).toBe(observerError)
      expect(source.status).toBe(`cleaned-up`)

      off()
      source.startSyncImmediate()
      expect(starts).toBe(2)
      expect(source.status).toBe(`ready`)
    } finally {
      off()
      cleanupGate.resolve()
      await source.cleanup().catch(() => undefined)
    }
  })

  it(`keeps adapter cleanup failure primary when cleanup-start observer also fails`, async () => {
    const cleanupGate = createDeferred<void>()
    const observerError = new Error(`cleanup-start observer failed exactly`)
    const adapterError = new Error(`adapter cleanup failed exactly`)
    const source = createCollection<Row, number>({
      getKey: (row) => row.id,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return {
            cleanup: () =>
              cleanupGate.promise.then(() => {
                throw adapterError
              }),
          }
        },
      },
    })
    const off = source._onCleanupStart(() => {
      throw observerError
    })

    try {
      await source.preload()
      const cleanup = source.cleanup()

      expect(source.status).toBe(`ready`)
      cleanupGate.resolve()
      const failure = await cleanup.catch((error: unknown) => error)

      expect(failure).toBeInstanceOf(AggregateError)
      const aggregate = failure as AggregateError
      expect(aggregate.cause).toMatchObject({
        name: `SyncCleanupError`,
        cause: adapterError,
      })
      expect(aggregate.errors).toEqual([aggregate.cause, observerError])
      expect(source.status).toBe(`cleaned-up`)
    } finally {
      off()
      cleanupGate.resolve()
      await source.cleanup().catch(() => undefined)
    }
  })

  it(`retains every cleanup-start observer failure after adapter cleanup rejects`, async () => {
    const cleanupGate = createDeferred<void>()
    const firstObserverError = new Error(
      `first cleanup-start observer failed exactly`,
    )
    const secondObserverError = new Error(
      `second cleanup-start observer failed exactly`,
    )
    const adapterError = new Error(`adapter cleanup failed exactly`)
    const observerCalls: Array<string> = []
    let starts = 0
    const source = createCollection<Row, number>({
      getKey: (row) => row.id,
      sync: {
        sync: ({ markReady }) => {
          starts++
          markReady()
          return {
            cleanup: () =>
              cleanupGate.promise.then(() => {
                throw adapterError
              }),
          }
        },
      },
    })
    const offFirst = source._onCleanupStart(() => {
      observerCalls.push(`first`)
      throw firstObserverError
    })
    const offSecond = source._onCleanupStart(() => {
      observerCalls.push(`second`)
      throw secondObserverError
    })

    try {
      await source.preload()
      const cleanup = source.cleanup()

      expect(observerCalls).toEqual([`first`, `second`])
      expect(source.status).toBe(`ready`)
      cleanupGate.resolve()
      const failure = await cleanup.catch((error: unknown) => error)

      expect(failure).toBeInstanceOf(AggregateError)
      const aggregate = failure as AggregateError
      expect(aggregate.cause).toMatchObject({
        name: `SyncCleanupError`,
        cause: adapterError,
      })
      expect(aggregate.errors).toEqual([
        aggregate.cause,
        firstObserverError,
        secondObserverError,
      ])
      expect(source.status).toBe(`cleaned-up`)

      offFirst()
      offSecond()
      source.startSyncImmediate()
      expect(starts).toBe(2)
      expect(source.status).toBe(`ready`)
    } finally {
      offFirst()
      offSecond()
      cleanupGate.resolve()
      await source.cleanup().catch(() => undefined)
    }
  })

  const lateEffectCases = ([`loading`, `ready`, `error`] as const).flatMap(
    (priorStatus) =>
      ([`eager`, `on-demand`] as const).flatMap((syncMode) =>
        ([`first`, `second`] as const).map((cleaningPosition) => ({
          priorStatus,
          syncMode,
          cleaningPosition,
        })),
      ),
  )

  // Effects must retire at cleanup start, including when construction reaches
  // a source whose adapter cleanup is already pending. The same boundary model
  // requires a terminal dependent without partial subscription ownership.
  it.each(lateEffectCases)(
    `releases a late Effect during $priorStatus $syncMode cleanup of its $cleaningPosition source`,
    async ({ priorStatus, syncMode, cleaningPosition }) => {
      const cleanupGate = createDeferred<void>()
      let starts = 0
      const source = createCollection<Row, number>({
        getKey: (row) => row.id,
        syncMode,
        sync: {
          sync: ({ markReady, fail }) => {
            starts++
            if (priorStatus === `ready` || starts > 1) markReady()
            if (priorStatus === `error` && starts === 1) {
              fail(new Error(`initial source error`))
            }
            return {
              cleanup: () => cleanupGate.promise,
              loadSubset: () => true,
            }
          },
        },
      })
      const healthySource = createCollection<Row, number>({
        getKey: (row) => row.id,
        sync: { sync: ({ markReady }) => markReady() },
      })
      source.createIndex((row) => row.id, { indexType: BasicIndex })
      healthySource.createIndex((row) => row.id, { indexType: BasicIndex })
      const registerCleanupStart = source._onCleanupStart.bind(source)
      let activeCleanupStartObservers = 0
      source._onCleanupStart = (callback) => {
        activeCleanupStartObservers++
        const unsubscribe = registerCleanupStart(callback)
        let active = true
        return () => {
          if (!active) return
          active = false
          activeCleanupStartObservers--
          unsubscribe()
        }
      }

      const firstSource = cleaningPosition === `first` ? source : healthySource
      const secondSource =
        cleaningPosition === `second` ? source : healthySource
      const errors: Array<string> = []
      let batches = 0
      const create = () =>
        createEffect({
          query: (q) =>
            q
              .from({ first: firstSource })
              .join(
                { second: secondSource },
                ({ first, second }) => eq(first.id, second.id),
                `inner`,
              ),
          onBatch: () => {
            batches++
          },
          onSourceError: (error) => {
            errors.push(error.message)
          },
        })
      let effect: ReturnType<typeof createEffect> | undefined
      await withOracleCleanup(async () => {
        source.startSyncImmediate()
        const cleanup = source.cleanup()
        effect = create()
        const atStart = expectedCleanupBoundary(priorStatus, `cleanup-start`)
        expect(observeDependent(!effect.disposed)).toBe(atStart.dependent)
        expect(source.status).toBe(atStart.collectionStatus)
        expect(source.subscriberCount).toBe(0)
        expect(healthySource.subscriberCount).toBe(0)
        expect(activeCleanupStartObservers).toBe(0)
        expect(batches).toBe(0)
        expect(errors).toEqual([
          `Source collection '${source.id}' was cleaned up while effect depends on it`,
        ])

        cleanupGate.resolve()
        await cleanup
        expect(effect.disposed).toBe(true)
        expect(source.subscriberCount).toBe(0)
        expect(healthySource.subscriberCount).toBe(0)
        // A later, explicit Effect construction is allowed. The retired Effect
        // stays disposed; neither cleanup settlement nor restart revives it.
        effect = create()
        expect(effect.disposed).toBe(false)
        expect(source.subscriberCount).toBe(1)
        expect(healthySource.subscriberCount).toBe(1)
        expect(activeCleanupStartObservers).toBeGreaterThan(0)
        expect(errors).toHaveLength(1)
      }, [
        () => cleanupGate.resolve(),
        () => effect?.dispose(),
        () => source.cleanup(),
        () => healthySource.cleanup(),
      ])
      expect(activeCleanupStartObservers).toBe(0)
    },
  )

  it.each([`first`, `second`] as const)(
    `does not acquire live-query source subscriptions during active cleanup: %s source`,
    async (cleaningPosition) => {
      const cleanupGate = createDeferred<void>()
      const cleaningSource = createCollection<Row, number>({
        getKey: (row) => row.id,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return { cleanup: () => cleanupGate.promise }
          },
        },
      })
      const healthySource = createCollection<Row, number>({
        getKey: (row) => row.id,
        sync: { sync: ({ markReady }) => markReady() },
      })
      cleaningSource.createIndex((row) => row.id, { indexType: BasicIndex })
      healthySource.createIndex((row) => row.id, { indexType: BasicIndex })
      let live: ReturnType<typeof createLiveQueryCollection> | undefined
      const reports = vi.spyOn(console, `error`).mockImplementation(() => {})

      try {
        await cleaningSource.preload()
        const cleaning = cleaningSource.cleanup()
        expect(cleaningSource.status).toBe(`ready`)

        const firstSource =
          cleaningPosition === `first` ? cleaningSource : healthySource
        const secondSource =
          cleaningPosition === `second` ? cleaningSource : healthySource
        live = createLiveQueryCollection((q) =>
          q
            .from({ first: firstSource })
            .join(
              { second: secondSource },
              ({ first, second }) => eq(first.id, second.id),
              `inner`,
            ),
        )
        const message =
          `Source collection '${cleaningSource.id}' was manually cleaned up while live query '${live.id}' depends on it. ` +
          `Live queries prevent automatic GC, so this was likely a manual cleanup() call.`

        await expect(live.preload()).rejects.toThrow(message)

        expect(live.status).toBe(`crashed`)
        expect({
          cleaning: cleaningSource.subscriberCount,
          healthy: healthySource.subscriberCount,
        }).toEqual({ cleaning: 0, healthy: 0 })
        expect(reports.mock.calls).toEqual([[`[Live Query Error] ${message}`]])

        cleanupGate.resolve()
        await cleaning
      } finally {
        cleanupGate.resolve()
        reports.mockRestore()
        await live?.cleanup()
        await cleaningSource.cleanup()
        await healthySource.cleanup()
      }
    },
  )

  it(`does not retain a late cleanup-start observer that throws`, async () => {
    const cleanupGate = createDeferred<void>()
    const observerError = new Error(
      `late cleanup-start observer failed exactly`,
    )
    let observerCalls = 0
    const source = createCollection<Row, number>({
      getKey: (row) => row.id,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return { cleanup: () => cleanupGate.promise }
        },
      },
    })

    try {
      await source.preload()
      const firstCleanup = source.cleanup()

      expect(() =>
        source._onCleanupStart(() => {
          observerCalls++
          throw observerError
        }),
      ).toThrow(observerError)

      cleanupGate.resolve()
      await firstCleanup
      source.startSyncImmediate()
      await expect(source.cleanup()).resolves.toBeUndefined()
      expect(observerCalls).toBe(1)
    } finally {
      cleanupGate.resolve()
      await source.cleanup().catch(() => undefined)
    }
  })

  it(`notifies one observer once per cleanup boundary until it unsubscribes`, async () => {
    let starts = 0
    let observerCalls = 0
    const source = createCollection<Row, number>({
      getKey: (row) => row.id,
      sync: {
        sync: ({ markReady }) => {
          starts++
          markReady()
        },
      },
    })
    const off = source._onCleanupStart(() => {
      observerCalls++
    })

    try {
      await source.preload()
      const firstCleanup = source.cleanup()
      expect(observerCalls).toBe(1)
      await firstCleanup

      source.startSyncImmediate()
      const secondCleanup = source.cleanup()
      expect(observerCalls).toBe(2)
      await secondCleanup

      off()
      source.startSyncImmediate()
      await source.cleanup()
      expect({ starts, observerCalls }).toEqual({ starts: 3, observerCalls: 2 })
    } finally {
      off()
      await source.cleanup()
    }
  })

  it(`does not revive a cleaned-up live query when its source restarts`, async () => {
    let starts = 0
    const source = createCollection<Row, number>({
      getKey: (row) => row.id,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          starts++
          begin()
          write({ type: `insert`, value: { id: 1, rank: starts } })
          commit()
          markReady()
        },
      },
    })
    const live = createLiveQueryCollection((q) => q.from({ row: source }))
    const publications: Array<unknown> = []
    const subscription = live.subscribeChanges((changes) => {
      publications.push(changes)
    })
    const reports = vi.spyOn(console, `error`).mockImplementation(() => {})

    try {
      await live.preload()
      expect(live.get(1)?.rank).toBe(1)
      publications.length = 0

      // Cleanup refuses while the live query reads the source; with its
      // dependents it cleans the live query up first.
      await expect(source.cleanup()).rejects.toThrow(/dependent/)
      await source.cleanup({ dependents: true })
      expect(live.status).toBe(`cleaned-up`)

      // Restarting the source does not revive the cleaned-up live query,
      // and its surviving subscriber receives nothing from the new run.
      source.startSyncImmediate()
      expect(source.status).toBe(`ready`)
      expect(starts).toBe(2)
      expect(live.status).toBe(`cleaned-up`)
      expect(publications).toEqual([])
      expect(reports).not.toHaveBeenCalled()
    } finally {
      subscription.unsubscribe()
      reports.mockRestore()
      await live.cleanup()
      await source.cleanup()
    }
  })

  it.each([`eager`, `on-demand`] as const)(
    `restarts a %s source that failed after ready, and its live query, through their own restarts`,
    async (syncMode) => {
      let sourceSync!: Parameters<SyncConfig<Row, number>[`sync`]>[0]
      let starts = 0
      const source = createCollection<Row, number>({
        getKey: (row) => row.id,
        syncMode,
        sync: {
          sync: (methods) => {
            sourceSync = methods
            starts++
            const writeRow = () => {
              methods.begin()
              methods.write({ type: `insert`, value: { id: 1, rank: starts } })
              methods.commit()
            }
            if (syncMode === `eager`) writeRow()
            methods.markReady()
            if (syncMode === `on-demand`) {
              return {
                loadSubset: () => {
                  writeRow()
                  return true
                },
                unloadSubset: () => {},
              }
            }
            return undefined
          },
        },
      })
      const live = createLiveQueryCollection((q) => q.from({ row: source }))
      const observedRanks: Array<number | undefined> = []
      const subscription = live.subscribeChanges(() => {
        observedRanks.push(live.get(1)?.rank)
      })
      const reports = vi.spyOn(console, `error`).mockImplementation(() => {})

      try {
        await live.preload()
        expect(live.get(1)?.rank).toBe(1)

        // After the first ready a source's fail() stops its sync: the
        // status and rows stay, and the live query's health tree reports it.
        sourceSync.fail(new Error(`source sync failed`))
        expect(source.status).toBe(`ready`)
        expect(source.health.error).toMatchObject({
          message: `source sync failed`,
        })
        expect(live.status).toBe(`ready`)
        expect(live.get(1)?.rank).toBe(1)
        expect(live.health.sources[0]?.error).toBeTruthy()

        // Only a new sync run clears the error.
        await live.cleanup()
        await source.cleanup()
        await live.preload()
        expect(source.health.hasErrors).toBe(false)
        expect(live.health.hasErrors).toBe(false)

        expect(starts).toBe(2)
        expect(source.status).toBe(`ready`)
        expect(live.status).toBe(`ready`)
        expect(live.get(1)?.rank).toBe(2)

        observedRanks.length = 0
        sourceSync.begin()
        sourceSync.write({ type: `update`, value: { id: 1, rank: 3 } })
        sourceSync.commit()
        expect(live.get(1)?.rank).toBe(3)
        expect(observedRanks).toEqual([3])
      } finally {
        subscription.unsubscribe()
        reports.mockRestore()
        await live.cleanup()
        await source.cleanup()
      }
    },
  )

  it(`treats an incidental contextual-void return as synchronous cleanup`, async () => {
    let starts = 0
    const released: Array<number> = []
    const collection = createCollection<Row, number>({
      getKey: (row) => row.id,
      sync: {
        sync: ({ markReady }) => {
          starts++
          markReady()
          return () => released.push(starts)
        },
      },
    })

    try {
      await collection.preload()

      const cleanup = collection.cleanup()

      expect(released).toEqual([1])
      expect(collection.status).toBe(`cleaned-up`)
      collection.startSyncImmediate()
      expect(starts).toBe(2)
      await cleanup
    } finally {
      await collection.cleanup()
    }
  })

  it(`shares one retirement promise when cleanup finishes synchronously`, async () => {
    let adapterCleanups = 0
    let localCleanups = 0
    const sync = withCollectionSyncConfigCleanup(
      {
        sync: ({ markReady }) => {
          markReady()
          return () => {
            adapterCleanups++
          }
        },
      } satisfies SyncConfig<Row, number>,
      () => {
        localCleanups++
      },
    )
    const collection = createCollection<Row, number>({
      getKey: (row) => row.id,
      sync,
    })

    try {
      await collection.preload()
      const first = collection.cleanup()
      const concurrent = collection.cleanup()

      expect({
        samePromise: concurrent === first,
        adapterCleanups,
        localCleanups,
      }).toEqual({
        samePromise: true,
        adapterCleanups: 1,
        localCleanups: 1,
      })
      await first
      expect(collection.status).toBe(`cleaned-up`)
    } finally {
      await collection.cleanup()
    }
  })

  it(`lets a terminal listener clean a replacement sync run separately`, async () => {
    let starts = 0
    let adapterCleanups = 0
    let armed = false
    let replacementCleanup: Promise<void> | undefined
    const collection = createCollection<Row, number>({
      getKey: (row) => row.id,
      sync: {
        sync: ({ markReady }) => {
          starts++
          markReady()
          return () => {
            adapterCleanups++
          }
        },
      },
    })
    const off = collection.on(`status:change`, ({ status }) => {
      if (armed && status === `cleaned-up`) {
        armed = false
        collection.startSyncImmediate()
        replacementCleanup = collection.cleanup()
      }
    })

    try {
      await collection.preload()
      armed = true
      const firstCleanup = collection.cleanup()

      expect(replacementCleanup).toBeDefined()
      expect(replacementCleanup).not.toBe(firstCleanup)
      await Promise.all([firstCleanup, replacementCleanup!])
      expect(starts).toBe(2)
      expect(adapterCleanups).toBe(2)
      expect(collection.status).toBe(`cleaned-up`)
    } finally {
      armed = false
      off()
      await collection.cleanup()
    }
  })

  it(`awaits a runtime Promise from cleanup typed to return void`, async () => {
    const cleanupGate = createDeferred<void>()
    let cleanupCalls = 0
    const cleanup: () => void = () => {
      cleanupCalls++
      return cleanupGate.promise
    }
    const collection = createCollection<Row, number>({
      getKey: (row) => row.id,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return cleanup
        },
      },
    })

    try {
      await collection.preload()

      const retirement = collection.cleanup()

      expect(cleanupCalls).toBe(1)
      expect(collection.status).toBe(`ready`)
      expect(() => collection.startSyncImmediate()).toThrowError(
        expect.objectContaining(cleanupError),
      )

      cleanupGate.resolve()
      await retirement
      expect(collection.status).toBe(`cleaned-up`)
    } finally {
      cleanupGate.resolve()
      await collection.cleanup()
    }
  })

  it(`finishes teardown once and rejects every waiter when source cleanup rejects`, async () => {
    const cleanupGate = createDeferred<void>()
    const sourceError = new Error(`source cleanup failed exactly`)
    let starts = 0
    let cleanups = 0
    const statuses: Array<string> = []
    const settlementOrder: Array<string> = []
    const collection = createCollection<Row, number>({
      getKey: (row) => row.id,
      sync: {
        sync: ({ markReady }) => {
          starts++
          markReady()
          return {
            cleanup: () => {
              cleanups++
              return cleanups === 1
                ? cleanupGate.promise.then(() => {
                    settlementOrder.push(`adapter-cleanup-rejected`)
                    throw sourceError
                  })
                : undefined
            },
          }
        },
      },
    })
    const off = collection.on(`status:change`, ({ status }) => {
      statuses.push(status)
      if (status === `cleaned-up`) {
        settlementOrder.push(`cleaned-up-event`)
      }
    })

    try {
      await collection.preload()
      statuses.length = 0
      const firstCleanup = collection.cleanup()
      const concurrentCleanup = collection.cleanup()
      void firstCleanup.catch(() => {
        settlementOrder.push(`public-cleanup-rejection-continuation`)
      })
      const firstOutcome = firstCleanup.catch((error: unknown) => error)
      const concurrentOutcome = concurrentCleanup.catch(
        (error: unknown) => error,
      )

      expect(collection.status).toBe(`ready`)
      expect(cleanups).toBe(1)
      expect(concurrentCleanup).toBe(firstCleanup)
      cleanupGate.resolve()

      const [firstError, concurrentError] = await Promise.all([
        firstOutcome,
        concurrentOutcome,
      ])
      expect(concurrentError).toBe(firstError)
      expect(firstError).toMatchObject({
        name: `SyncCleanupError`,
        cause: sourceError,
      })
      expect(collection.status).toBe(`cleaned-up`)
      expect(statuses).toEqual([`cleaned-up`])
      expect(settlementOrder).toEqual([
        `adapter-cleanup-rejected`,
        `cleaned-up-event`,
        `public-cleanup-rejection-continuation`,
      ])
      expect(cleanups).toBe(1)

      // Rejection ends the old sync run. A later run is allowed, and a
      // repeated cleanup does not retry the failed callback from that run.
      await expect(collection.cleanup()).resolves.toBeUndefined()
      expect(cleanups).toBe(1)
      collection.startSyncImmediate()
      expect(starts).toBe(2)
      expect(collection.status).toBe(`ready`)
    } finally {
      cleanupGate.resolve()
      off()
      await collection.cleanup()
    }
  })

  it.each([`throw`, `reject`] as const)(
    `keeps adapter cleanup failure primary when local teardown also fails: %s`,
    async (outcome) => {
      const cleanupGate = createDeferred<void>()
      const adapterFailure = new Error(`adapter cleanup failed exactly`)
      const localFailure = new Error(`local teardown failed exactly`)
      const sync = withCollectionSyncConfigCleanup(
        {
          sync: ({ markReady }) => {
            markReady()
            return () => {
              if (outcome === `throw`) throw adapterFailure
              return cleanupGate.promise.then(() => {
                throw adapterFailure
              })
            }
          },
        } satisfies SyncConfig<Row, number>,
        () => {
          throw localFailure
        },
      )
      const collection = createCollection<Row, number>({
        getKey: (row) => row.id,
        sync,
      })

      try {
        await collection.preload()
        const cleanup = collection.cleanup()
        cleanupGate.resolve()
        const failure = await cleanup.catch((error: unknown) => error)

        expect(failure).toBeInstanceOf(AggregateError)
        const aggregate = failure as AggregateError
        expect(aggregate.cause).toMatchObject({
          name: `SyncCleanupError`,
          cause: adapterFailure,
        })
        expect(aggregate.errors).toEqual([aggregate.cause, localFailure])
        expect(collection.status).toBe(`cleaned-up`)
      } finally {
        cleanupGate.resolve()
        await collection.cleanup().catch(() => undefined)
      }
    },
  )

  it.each(reentryScenarios)(
    `rejects restart without creating replacement ownership: %j`,
    async ({ boundary, nestedCleanup, attempts }) => {
      let ops!: Parameters<SyncConfig<Row, number>[`sync`]>[0]
      let loads = 0
      let releases = 0
      let armed = false
      const errors: Array<unknown> = []
      const cleanups: Array<Promise<void>> = []
      const reenter = () => {
        if (!armed) return
        armed = false
        for (let i = 0; i < attempts; i++) {
          if (nestedCleanup) cleanups.push(live.cleanup())
          try {
            live.startSyncImmediate()
            errors.push(undefined)
          } catch (error) {
            errors.push(error)
          }
        }
      }
      const source = createCollection<Row, number>({
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          sync: (methods) => {
            ops = methods
            methods.begin()
            methods.write({ type: `insert`, value: { id: 1, rank: 1 } })
            methods.commit()
            methods.markReady()
            return {
              loadSubset: ({ signal }) => {
                loads++
                signal?.addEventListener(`abort`, () => {
                  if (boundary === `abort`) reenter()
                })
                return true
              },
              unloadSubset: () => {
                releases++
                if (boundary === `release`) reenter()
              },
            }
          },
        },
      })
      const live = createLiveQueryCollection((q) => q.from({ row: source }))
      try {
        await live.preload()
        armed = true
        await live.cleanup()
        await Promise.all(cleanups)
        expect(armed).toBe(false)
        expect(errors).toHaveLength(attempts)
        for (const error of errors) expect(error).toMatchObject(cleanupError)
        expect(loads).toBe(1)
        expect(releases).toBe(1)
        expect(source.subscriberCount).toBe(0)
        expect(live.status).toBe(`cleaned-up`)

        // The rejected calls must not poison a later, ordinary restart.
        await live.preload()
        expect(loads).toBe(2)
        expect(source.subscriberCount).toBe(1)
        ops.begin()
        ops.write({ type: `update`, value: { id: 1, rank: 2 } })
        ops.commit()
        expect(live.status).toBe(`ready`)
        expect(live.get(1)?.rank).toBe(2)
      } finally {
        armed = false
        await live.cleanup()
        await source.cleanup()
      }
    },
  )

  it.each([`start`, `preload`] as const)(
    `rejects %s from adapter cleanup but allows another collection to start`,
    async (method) => {
      let starts = 0
      let armed = false
      let observed: Promise<unknown> | undefined
      const peer = createCollection<Row, number>({
        getKey: (row) => row.id,
        sync: { sync: ({ markReady }) => markReady() },
      })
      const source = createCollection<Row, number>({
        getKey: (row) => row.id,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            starts++
            begin()
            write({ type: `insert`, value: { id: 1, rank: starts } })
            commit()
            markReady()
            return () => {
              if (!armed) return
              armed = false
              void source.cleanup()
              try {
                const result =
                  method === `start`
                    ? source.startSyncImmediate()
                    : source.preload()
                observed = Promise.resolve(result).then(
                  () => undefined,
                  (error: unknown) => error,
                )
              } catch (error) {
                observed = Promise.resolve(error)
              }
              peer.startSyncImmediate()
            }
          },
        },
      })
      try {
        await source.preload()
        armed = true
        await source.cleanup()
        expect(await observed).toMatchObject(cleanupError)
        expect(starts).toBe(1)
        expect(peer.status).toBe(`ready`)
        await source.preload()
        expect(starts).toBe(2)
        expect(source.get(1)?.rank).toBe(2)
      } finally {
        armed = false
        await source.cleanup()
        await peer.cleanup()
      }
    },
  )

  it.each(completedBoundaryScenarios)(
    `admits restart at the completed cleanup boundary: %j`,
    async ({ boundary, liveQuery }) => {
      let starts = 0
      let armed = false
      let ops!: Parameters<SyncConfig<Row, number>[`sync`]>[0]
      const source = createCollection<Row, number>({
        getKey: (row) => row.id,
        sync: {
          sync: (methods) => {
            ops = methods
            const { begin, write, commit, markReady } = methods
            starts++
            begin()
            write({ type: `insert`, value: { id: 1, rank: starts } })
            commit()
            markReady()
          },
        },
      })
      const collection = liveQuery
        ? createLiveQueryCollection((q) => q.from({ row: source }))
        : source
      const off = collection.on(`status:change`, ({ status }) => {
        if (armed && boundary === `event` && status === `cleaned-up`) {
          armed = false
          collection.startSyncImmediate()
        }
      })
      try {
        await collection.preload()
        armed = true
        await collection.cleanup()
        if (boundary === `await`) collection.startSyncImmediate()
        expect(starts).toBe(liveQuery ? 1 : 2)
        expect(collection.status).toBe(`ready`)
        expect(collection.get(1)?.rank).toBe(liveQuery ? 1 : 2)
        ops.begin()
        ops.write({ type: `update`, value: { id: 1, rank: 3 } })
        ops.commit()
        expect(collection.get(1)?.rank).toBe(3)
      } finally {
        armed = false
        off()
        if (liveQuery) await collection.cleanup()
        await source.cleanup()
      }
    },
  )

  it(`ends a pending subset load with one end transition at cleanup`, async () => {
    const collection = createCollection<Row, number>({
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      startSync: true,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return { loadSubset: () => new Promise<void>(() => {}) }
        },
      },
    })
    const transitions: Array<{
      isLoadingSubset: boolean
      previousIsLoadingSubset: boolean
      loadingSubsetTransition: string
    }> = []
    collection.on(`loadingSubset:change`, (event) => {
      transitions.push({
        isLoadingSubset: event.isLoadingSubset,
        previousIsLoadingSubset: event.previousIsLoadingSubset,
        loadingSubsetTransition: event.loadingSubsetTransition,
      })
    })

    void collection._sync.loadSubset({})
    await Promise.resolve()
    expect(collection.isLoadingSubset).toBe(true)

    await collection.cleanup()

    expect(transitions).toEqual([
      {
        isLoadingSubset: true,
        previousIsLoadingSubset: false,
        loadingSubsetTransition: `start`,
      },
      {
        isLoadingSubset: false,
        previousIsLoadingSubset: true,
        loadingSubsetTransition: `end`,
      },
    ])
    expect(collection.isLoadingSubset).toBe(false)
  })
})

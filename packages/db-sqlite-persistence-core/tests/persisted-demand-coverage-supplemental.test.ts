import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IR, createCollection, getLoadSubsetDemandKey } from '@tanstack/db'
import {
  SQLiteCorePersistenceAdapter,
  persistedCollectionOptions,
} from '../src/index.js'
import { createSerializedNodeSqliteDriver as createDriver } from './helpers/node-sqlite-driver.js'
import {
  drain,
  filterQuery,
  onDemandSource,
  quietConsole,
  untilUpstreamCalled,
  useFakeClock,
  withCleanup,
} from './helpers/demand-coverage-driver.js'
import type { Row } from './helpers/demand-coverage-driver.js'
import type { SQLiteDriver } from '../src/index.js'

/**
 * Supplemental checks beside the persisted demand coverage oracle
 * (`persisted-demand-coverage-oracle.test.ts`). These pin two behaviors that
 * the opt-in must leave as they were, and whose laws other owners hold, so
 * they are ordinary examples rather than inputs to the coverage judgment
 * (ORC-016):
 *
 * - An optimistic write on a demand settled from SQLite follows the
 *   optimistic overlay rules (`packages/db/tests/optimistic-history-oracle.ts`
 *   owns them): the row shows while its handler runs and leaves when it
 *   rejects, and the query stays ready throughout.
 * - Opting in keeps a synchronous answer synchronous: a second request for a
 *   demand already hydrated in this sync run reports `true` to core, as it
 *   did before the opt-in existed.
 */

const A1: Row = { id: `a1`, group: `a`, rank: 1, value: `v1` }
const A2: Row = { id: `a2`, group: `a`, rank: 2, value: `v1` }

async function coverD(
  driver: SQLiteDriver,
  rows: ReadonlyArray<Row> = [A1, A2],
): Promise<ReturnType<typeof getLoadSubsetDemandKey>> {
  const { collection, upstream } = onDemandSource(
    new SQLiteCorePersistenceAdapter({ driver }),
    0,
  )
  const query = filterQuery(collection, `a`)
  return withCleanup(async () => {
    const preload = query.preload()
    await vi.waitFor(() => expect(upstream.pendingCount()).toBe(1))
    await upstream.answer(rows)
    await preload
    return getLoadSubsetDemandKey(upstream.calls[0]!)
  }, [() => query.cleanup(), () => collection.cleanup()])
}

type OptimisticObservation = {
  settledBeforeWrite: Array<string>
  duringWrite: Array<string>
  afterRollback: Array<string>
  readyThroughout: boolean
}

async function runOptimisticWrite(): Promise<OptimisticObservation> {
  const driver = createDriver(new DatabaseSync(`:memory:`))
  await coverD(driver)
  useFakeClock()
  let rejectWrite!: (error: unknown) => void
  const { collection, upstream } = onDemandSource(
    new SQLiteCorePersistenceAdapter({ driver }),
    0,
    {
      onInsert: () =>
        new Promise<void>((_resolve, reject) => {
          rejectWrite = reject
        }),
    },
  )
  const query = filterQuery(collection, `a`)
  return withCleanup(async () => {
    void query.preload().catch(() => undefined)
    await untilUpstreamCalled(upstream, 1)
    await drain()
    await vi.advanceTimersByTimeAsync(1)
    await drain()
    const ids = () => query.toArray.map((row) => row.id).sort()
    let readyThroughout = query.status === `ready`
    const settledBeforeWrite = ids()
    const transaction = collection.insert({
      id: `a9`,
      group: `a`,
      rank: 9,
      value: `local`,
    })
    void transaction.isPersisted.promise.catch(() => undefined)
    await drain()
    readyThroughout &&= query.status === `ready`
    const duringWrite = ids()
    rejectWrite(new Error(`offline write`))
    await drain()
    readyThroughout &&= query.status === `ready`
    return {
      settledBeforeWrite,
      duringWrite,
      afterRollback: ids(),
      readyThroughout,
    }
  }, [
    () => vi.useRealTimers(),
    () => query.cleanup(),
    () => collection.cleanup(),
  ])
}

async function runSynchronousAnswer(): Promise<{
  sourceCalls: number
  secondResult: `true` | `promise` | `none`
}> {
  const driver = createDriver(new DatabaseSync(`:memory:`))
  let sourceCalls = 0
  const collection = createCollection(
    persistedCollectionOptions<Row, string>({
      id: `demand-coverage-synchronous`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      initialRender: { strategy: `network-first`, networkTimeoutMs: 0 },
      persistence: { adapter: new SQLiteCorePersistenceAdapter({ driver }) },
      sync: {
        sync: ({ begin, write, commit }) => ({
          loadSubset: () => {
            sourceCalls++
            begin()
            for (const value of [A1, A2]) write({ type: `insert`, value })
            commit()
            return true
          },
        }),
      },
    }),
  )
  const first = filterQuery(collection, `a`)
  let subscription: { unsubscribe: () => void } | undefined
  return withCleanup(async () => {
    await first.preload()
    await new Promise((resolve) => setTimeout(resolve, 50))
    const callsBefore = sourceCalls
    const second = { result: `none` as `true` | `promise` | `none` }
    const changes = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })
    subscription = changes
    ;(
      changes as unknown as { requestSnapshot: (options: object) => unknown }
    ).requestSnapshot({
      where: new IR.Func(`eq`, [new IR.PropRef([`group`]), new IR.Value(`a`)]),
      onLoadSubsetResult: (result: true | Promise<void>) => {
        second.result = result === true ? `true` : `promise`
      },
    })
    return {
      sourceCalls: sourceCalls - callsBefore,
      secondResult: second.result,
    }
  }, [
    () => subscription?.unsubscribe(),
    () => first.cleanup(),
    () => collection.cleanup(),
  ])
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe(`persisted demand coverage beside other owners' laws`, () => {
  it(`keeps an optimistic write's overlay rules on a demand settled from SQLite`, async () => {
    quietConsole()
    expect(await runOptimisticWrite()).toEqual({
      settledBeforeWrite: [`a1`, `a2`],
      duringWrite: [`a1`, `a2`, `a9`],
      afterRollback: [`a1`, `a2`],
      readyThroughout: true,
    })
  })

  it(`keeps a synchronous answer for an already hydrated demand synchronous`, async () => {
    quietConsole()
    // Positive witness: the second request reached the source.
    expect(await runSynchronousAnswer()).toEqual({
      sourceCalls: 1,
      secondResult: `true`,
    })
  })
})

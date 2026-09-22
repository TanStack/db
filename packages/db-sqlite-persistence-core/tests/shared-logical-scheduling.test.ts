/**
 * # Which adapters share one logical scheduling boundary?
 *
 * Contract and source: the RFC #1659 driver protocol keys scheduling by the
 * exact shared driver identity. Two fresh core adapters over that identity
 * must not interleave a complete hydration scope with regular adapter work.
 * Transparent wrappers must forward the identity unchanged, including when
 * the identity itself is a function object.
 *
 * Independent relation and legal domain: a two-adapter history starts one
 * hydration metadata query, holds it at the driver boundary, then requests one
 * regular metadata query. Before release, exactly the first query may be
 * admitted; after release, both operations must finish. The three legal driver
 * forms are direct, transparently wrapped, and direct with a function-valued
 * key. This relation records admissions without copying the production
 * scheduler or invoking the opaque key.
 *
 * Production boundary and checkpoint: both operations use
 * `createSQLiteCorePersistenceAdapter`; the hydration operation enters through
 * `runInHydrationScope`. The first checkpoint is immediately after the regular
 * request enters the adapter, while the first query remains held. Losing
 * wrapper identity or treating a function key as a getter synchronously admits
 * the second query and fails the exact admission assertion.
 *
 * Known omissions: this focused contract test does not establish K=1 lane
 * fairness, SQL result correctness, eventual progress under arbitrary I/O, or
 * cross-process coordination. Those belong to the shared-driver oracle and
 * provider refinements.
 */
import { describe, expect, it } from 'vitest'
import {
  SQLITE_DRIVER_SHARED_LOGICAL_SCHEDULING_KEY,
  createSQLiteCorePersistenceAdapter,
  forwardSQLiteDriverSharedLogicalScheduling,
} from '../src'
import type { SQLiteDriver } from '../src'

type Deferred = {
  promise: Promise<void>
  resolve: () => void
}

function createDeferred(): Deferred {
  let resolve!: () => void
  const promise = new Promise<void>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

class FirstQueryGatedDriver implements SQLiteDriver {
  readonly [SQLITE_DRIVER_SHARED_LOGICAL_SCHEDULING_KEY]: object
  readonly admissions: Array<string> = []
  readonly firstQueryEntered = createDeferred()
  private readonly firstQueryGate = createDeferred()
  private holdFirstQuery = true

  constructor(sharedLogicalSchedulingKey: object = {}) {
    this[SQLITE_DRIVER_SHARED_LOGICAL_SCHEDULING_KEY] =
      sharedLogicalSchedulingKey
  }

  exec(): Promise<void> {
    this.admissions.push(`exec`)
    return Promise.resolve()
  }

  async query<T>(): Promise<ReadonlyArray<T>> {
    this.admissions.push(`query`)
    if (this.holdFirstQuery) {
      this.holdFirstQuery = false
      this.firstQueryEntered.resolve()
      await this.firstQueryGate.promise
    }
    return []
  }

  run(): Promise<void> {
    this.admissions.push(`run`)
    return Promise.resolve()
  }

  transaction<T>(
    fn: (transactionDriver: SQLiteDriver) => Promise<T>,
  ): Promise<T> {
    this.admissions.push(`transaction`)
    return fn(this)
  }

  releaseFirstQuery(): void {
    this.firstQueryGate.resolve()
  }
}

function createTransparentWrapper(driver: SQLiteDriver): SQLiteDriver {
  return forwardSQLiteDriverSharedLogicalScheduling(driver, {
    exec: (sql) => driver.exec(sql),
    query: <T>(sql: string, params: ReadonlyArray<unknown> = []) =>
      driver.query<T>(sql, params),
    run: (sql, params = []) => driver.run(sql, params),
    transaction: <T>(fn: (transactionDriver: SQLiteDriver) => Promise<T>) =>
      driver.transaction(fn),
    transactionWithDriver: <T>(
      fn: (transactionDriver: SQLiteDriver) => Promise<T>,
    ) =>
      driver.transactionWithDriver
        ? driver.transactionWithDriver(fn)
        : driver.transaction(fn),
  })
}

describe(`shared logical scheduling`, () => {
  it.each([
    {
      name: `direct driver`,
      key: {},
      wrap: (driver: SQLiteDriver) => driver,
    },
    {
      name: `transparent delegating driver`,
      key: {},
      wrap: createTransparentWrapper,
    },
    {
      name: `function-valued key`,
      key: () => undefined,
      wrap: (driver: SQLiteDriver) => driver,
    },
  ])(
    `shares a scheduler across two fresh adapters through a $name`,
    async ({ key, wrap }) => {
      const underlying = new FirstQueryGatedDriver(key)
      const driver = wrap(underlying)
      const hydrateAdapter = createSQLiteCorePersistenceAdapter({ driver })
      const regularAdapter = createSQLiteCorePersistenceAdapter({ driver })

      const hydrate = hydrateAdapter.runInHydrationScope!(async (scoped) => {
        await scoped.loadCollectionMetadata!(`hydrate`)
      })
      await underlying.firstQueryEntered.promise

      const regular = regularAdapter.loadCollectionMetadata!(`regular`)

      expect(underlying.admissions).toEqual([`query`])

      underlying.releaseFirstQuery()
      await Promise.all([hydrate, regular])
      expect(underlying.admissions.length).toBeGreaterThan(1)
    },
  )
})

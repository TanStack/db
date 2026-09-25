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
 * scheduler or invoking the opaque key. Promise-only discovery is a fourth
 * form: the first operation reveals the shared identity and its complete
 * hydration scope becomes the scheduler's already-running unit.
 *
 * Production boundary and checkpoint: both operations use
 * `createSQLiteCorePersistenceAdapter`; the hydration operation enters through
 * `runInHydrationScope`. The first checkpoint is immediately after the regular
 * request enters the adapter, while the first query remains held. Losing
 * wrapper identity or treating a function key as a getter synchronously admits
 * the second query and fails the exact admission assertion.
 *
 * Known omissions: promise-only discovery coordinates adapters over the same
 * wrapper identity. Distinct unbranded wrappers must forward the shared key
 * before adapter construction. This focused contract test does not establish
 * K=1 lane fairness, SQL result correctness, eventual progress under arbitrary
 * I/O, or cross-process coordination. Those belong to the shared-driver oracle
 * and provider refinements.
 */
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
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

function fixtureQueryRows<T>(sql: string): ReadonlyArray<T> {
  if (sql.includes(`FROM collection_registry`)) {
    return [
      {
        table_name: `c_fixture`,
        tombstone_table_name: `t_fixture`,
        schema_version: 1,
      } as T,
    ]
  }
  return []
}

function isMetadataQuery(sql: string): boolean {
  return sql.includes(`FROM collection_metadata`)
}

class FirstQueryGatedDriver implements SQLiteDriver {
  readonly [SQLITE_DRIVER_SHARED_LOGICAL_SCHEDULING_KEY]: object
  readonly admissions: Array<string> = []
  readonly metadataAdmissions: Array<string> = []
  readonly firstQueryEntered = createDeferred()
  firstQueryAdmissionCount = 0
  onQuery: (() => void) | undefined
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

  async query<T>(sql: string): Promise<ReadonlyArray<T>> {
    this.admissions.push(`query`)
    if (isMetadataQuery(sql)) {
      this.metadataAdmissions.push(`query`)
      this.onQuery?.()
    }
    if (this.holdFirstQuery && isMetadataQuery(sql)) {
      this.holdFirstQuery = false
      this.firstQueryAdmissionCount = this.admissions.length
      this.firstQueryEntered.resolve()
      await this.firstQueryGate.promise
    }
    return fixtureQueryRows<T>(sql)
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

class PromiseBrandedFirstQueryGatedDriver implements SQLiteDriver {
  readonly admissions: Array<string> = []
  readonly metadataAdmissions: Array<string> = []
  readonly firstQueryEntered = createDeferred()
  firstQueryAdmissionCount = 0
  private readonly firstQueryGate = createDeferred()
  private holdFirstQuery = true

  constructor(private readonly schedulingKey: object = {}) {}

  exec(): Promise<void> {
    this.admissions.push(`exec`)
    return this.brand(Promise.resolve())
  }

  query<T>(sql: string): Promise<ReadonlyArray<T>> {
    this.admissions.push(`query`)
    if (isMetadataQuery(sql)) this.metadataAdmissions.push(`query`)
    const result = (async () => {
      if (this.holdFirstQuery && isMetadataQuery(sql)) {
        this.holdFirstQuery = false
        this.firstQueryAdmissionCount = this.admissions.length
        this.firstQueryEntered.resolve()
        await this.firstQueryGate.promise
      }
      return fixtureQueryRows<T>(sql)
    })()
    return this.brand(result)
  }

  run(): Promise<void> {
    this.admissions.push(`run`)
    return this.brand(Promise.resolve())
  }

  transaction<T>(
    fn: (transactionDriver: SQLiteDriver) => Promise<T>,
  ): Promise<T> {
    this.admissions.push(`transaction`)
    return this.brand(fn(this))
  }

  releaseFirstQuery(): void {
    this.firstQueryGate.resolve()
  }

  private brand<T>(promise: Promise<T>): Promise<T> {
    Object.defineProperty(
      promise,
      SQLITE_DRIVER_SHARED_LOGICAL_SCHEDULING_KEY,
      { value: this.schedulingKey },
    )
    return promise
  }
}

class UnbrandedPromiseLookupDriver implements SQLiteDriver {
  schedulingKeyLookups = 0

  exec(): Promise<void> {
    return this.unbranded(Promise.resolve())
  }

  query<T>(sql: string): Promise<ReadonlyArray<T>> {
    return this.unbranded(Promise.resolve(fixtureQueryRows<T>(sql)))
  }

  run(): Promise<void> {
    return this.unbranded(Promise.resolve())
  }

  transaction<T>(
    fn: (transactionDriver: SQLiteDriver) => Promise<T>,
  ): Promise<T> {
    return this.unbranded(fn(this))
  }

  private unbranded<T>(promise: Promise<T>): Promise<T> {
    Object.defineProperty(
      promise,
      SQLITE_DRIVER_SHARED_LOGICAL_SCHEDULING_KEY,
      {
        configurable: true,
        get: () => {
          this.schedulingKeyLookups++
          return undefined
        },
      },
    )
    return promise
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
      name: `twice-transparent delegating driver`,
      key: {},
      wrap: (driver: SQLiteDriver) =>
        createTransparentWrapper(createTransparentWrapper(driver)),
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

      expect(underlying.admissions).toHaveLength(
        underlying.firstQueryAdmissionCount,
      )

      underlying.releaseFirstQuery()
      await Promise.all([hydrate, regular])
      expect(underlying.metadataAdmissions).toEqual([`query`, `query`])
    },
  )

  it(`adopts a late-discovered promise identity before admitting peer work`, async () => {
    const driver = new PromiseBrandedFirstQueryGatedDriver()
    const hydrateAdapter = createSQLiteCorePersistenceAdapter({ driver })
    const regularAdapter = createSQLiteCorePersistenceAdapter({ driver })

    const hydrate = hydrateAdapter.runInHydrationScope!(async (scoped) => {
      await scoped.loadCollectionMetadata!(`hydrate`)
    })
    await driver.firstQueryEntered.promise

    const regular = regularAdapter.loadCollectionMetadata!(`regular`)

    expect(driver.admissions).toHaveLength(driver.firstQueryAdmissionCount)

    driver.releaseFirstQuery()
    await Promise.all([hydrate, regular])
    expect(driver.metadataAdmissions).toEqual([`query`, `query`])
  })

  it(`keeps generated promise-discovered hydrate units non-preemptible`, async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          hydrateQueries: fc.integer({ min: 1, max: 4 }),
          peerQueries: fc.integer({ min: 1, max: 3 }),
        }),
        async ({ hydrateQueries, peerQueries }) => {
          const driver = new PromiseBrandedFirstQueryGatedDriver()
          const hydrateAdapter = createSQLiteCorePersistenceAdapter({ driver })
          const peerAdapters = Array.from({ length: peerQueries }, () =>
            createSQLiteCorePersistenceAdapter({ driver }),
          )

          const hydrate = hydrateAdapter.runInHydrationScope!(
            async (scoped) => {
              for (let index = 0; index < hydrateQueries; index++) {
                await scoped.loadCollectionMetadata!(`hydrate-${index}`)
              }
            },
          )
          await driver.firstQueryEntered.promise

          const peers = peerAdapters.map((adapter, index) =>
            adapter.loadCollectionMetadata!(`peer-${index}`),
          )
          expect(driver.admissions).toHaveLength(
            driver.firstQueryAdmissionCount,
          )

          driver.releaseFirstQuery()
          await Promise.all([hydrate, ...peers])
          expect(driver.metadataAdmissions).toEqual(
            Array.from({ length: hydrateQueries + peerQueries }, () => `query`),
          )
        },
      ),
      { seed: 1868, numRuns: 12, endOnFailure: true },
    )
  })

  it(`counts a rejected hydrate as a completed K=1 lane unit`, async () => {
    const driver = new FirstQueryGatedDriver()
    const hydrateAdapter = createSQLiteCorePersistenceAdapter({ driver })
    const regularAdapter = createSQLiteCorePersistenceAdapter({ driver })
    const events: Array<string> = []

    const initialRegular = regularAdapter.loadCollectionMetadata!(`initial`)
    await driver.firstQueryEntered.promise
    driver.onQuery = () => events.push(`query`)

    const failedHydrate = hydrateAdapter.runInHydrationScope!(() => {
      events.push(`failed-hydrate`)
      throw new Error(`expected hydrate failure`)
    })
    const failedHydrateExpectation = expect(failedHydrate).rejects.toThrow(
      `expected hydrate failure`,
    )
    const regular = regularAdapter.loadCollectionMetadata!(`regular`)
    const nextHydrate = hydrateAdapter.runInHydrationScope!(async (scoped) => {
      events.push(`next-hydrate`)
      await scoped.loadCollectionMetadata!(`hydrate`)
    })

    driver.releaseFirstQuery()
    await Promise.all([
      initialRegular,
      failedHydrateExpectation,
      regular,
      nextHydrate,
    ])

    expect(events).toEqual([`failed-hydrate`, `query`, `next-hydrate`, `query`])
  })

  it(`stops probing after the first returned promise lacks scheduling support`, async () => {
    const driver = new UnbrandedPromiseLookupDriver()
    const adapter = createSQLiteCorePersistenceAdapter({ driver })

    await adapter.loadCollectionMetadata!(`first`)
    await adapter.loadCollectionMetadata!(`second`)

    expect(driver.schedulingKeyLookups).toBe(1)
  })
})

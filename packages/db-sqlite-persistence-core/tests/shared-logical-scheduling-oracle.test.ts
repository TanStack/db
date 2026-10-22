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
 * Queued-work barrier: `runInRegularScope.afterQueuedWork()` settles after
 * every operation, in either lane, that was queued or running at the call.
 * It ignores operations queued after the call, settles on the next microtask
 * when the scheduler is idle, and never rejects, even when the work it waits
 * for fails. A hydrate adopted through promise discovery counts as running
 * work, whether or not the scheduler was already busy when it was adopted.
 * So does an unscheduled hydrate that has issued no query yet: before
 * discovery, and on a driver without scheduling support, it is still the
 * adapter's own running work.
 * Each relation is checked at a held query, so a barrier that waits too
 * long, too briefly, or only for one lane is pending or settled at the wrong
 * cut. The shared-driver fairness oracle checks that the barrier is not a
 * K=1 lane completion.
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
        await scoped.loadCollectionMetadata!({
          kind: `eager`,
          collectionId: `hydrate`,
        })
      })
      await underlying.firstQueryEntered.promise

      const regular = regularAdapter.loadCollectionMetadata!({
        kind: `eager`,
        collectionId: `regular`,
      })

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
      await scoped.loadCollectionMetadata!({
        kind: `eager`,
        collectionId: `hydrate`,
      })
    })
    await driver.firstQueryEntered.promise

    const regular = regularAdapter.loadCollectionMetadata!({
      kind: `eager`,
      collectionId: `regular`,
    })

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
                await scoped.loadCollectionMetadata!({
                  kind: `eager`,
                  collectionId: `hydrate-${index}`,
                })
              }
            },
          )
          await driver.firstQueryEntered.promise

          const peers = peerAdapters.map((adapter, index) =>
            adapter.loadCollectionMetadata!({
              kind: `eager`,
              collectionId: `peer-${index}`,
            }),
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

    const initialRegular = regularAdapter.loadCollectionMetadata!({
      kind: `eager`,
      collectionId: `initial`,
    })
    await driver.firstQueryEntered.promise
    driver.onQuery = () => events.push(`query`)

    const failedHydrate = hydrateAdapter.runInHydrationScope!(() => {
      events.push(`failed-hydrate`)
      throw new Error(`expected hydrate failure`)
    })
    const failedHydrateExpectation = expect(failedHydrate).rejects.toThrow(
      `expected hydrate failure`,
    )
    const regular = regularAdapter.loadCollectionMetadata!({
      kind: `eager`,
      collectionId: `regular`,
    })
    const nextHydrate = hydrateAdapter.runInHydrationScope!(async (scoped) => {
      events.push(`next-hydrate`)
      await scoped.loadCollectionMetadata!({
        kind: `eager`,
        collectionId: `hydrate`,
      })
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

  describe(`queued-work barrier`, () => {
    async function settlesNow(promise: Promise<void>): Promise<boolean> {
      let settled = false
      void promise.then(
        () => {
          settled = true
        },
        () => {
          throw new Error(`the queued-work barrier rejected`)
        },
      )
      await new Promise((resolve) => setTimeout(resolve, 0))
      return settled
    }

    it(`resolves at once when the scheduler is idle`, async () => {
      const driver = new FirstQueryGatedDriver()
      const adapter = createSQLiteCorePersistenceAdapter({ driver })
      driver.releaseFirstQuery()
      expect(
        await settlesNow(adapter.runInRegularScope!.afterQueuedWork()),
      ).toBe(true)
    })

    it(`waits for regular work queued or running before the call`, async () => {
      const driver = new FirstQueryGatedDriver()
      const adapter = createSQLiteCorePersistenceAdapter({ driver })
      const regular = adapter.loadCollectionMetadata!({
        kind: `eager`,
        collectionId: `regular`,
      })
      await driver.firstQueryEntered.promise
      const queuedRegular = adapter.loadCollectionMetadata!({
        kind: `eager`,
        collectionId: `queued-regular`,
      })
      const barrier = adapter.runInRegularScope!.afterQueuedWork()
      expect(await settlesNow(barrier)).toBe(false)
      driver.releaseFirstQuery()
      await Promise.all([regular, queuedRegular])
      expect(await settlesNow(barrier)).toBe(true)
    })

    it(`waits for a hydrate adopted through promise discovery`, async () => {
      const driver = new PromiseBrandedFirstQueryGatedDriver()
      const hydrateAdapter = createSQLiteCorePersistenceAdapter({ driver })
      const barrierAdapter = createSQLiteCorePersistenceAdapter({ driver })
      const hydrate = hydrateAdapter.runInHydrationScope!(async (scoped) => {
        await scoped.loadCollectionMetadata!({
          kind: `eager`,
          collectionId: `adopted`,
        })
      })
      await driver.firstQueryEntered.promise
      const barrier = barrierAdapter.runInRegularScope!.afterQueuedWork()
      expect(await settlesNow(barrier)).toBe(false)
      driver.releaseFirstQuery()
      await hydrate
      expect(await settlesNow(barrier)).toBe(true)
    })

    it.each([
      [
        `before promise discovery`,
        () => new PromiseBrandedFirstQueryGatedDriver(),
      ],
      [`without scheduling support`, () => new UnbrandedPromiseLookupDriver()],
    ] as const)(
      `waits for an unscheduled hydrate that has issued no query, %s`,
      async (_driverKind, createDriver) => {
        const adapter = createSQLiteCorePersistenceAdapter({
          driver: createDriver(),
        })
        const gate = createDeferred()
        const hydrate = adapter.runInHydrationScope!(async (scoped) => {
          await gate.promise
          await scoped.getStreamPosition!({
            kind: `eager`,
            collectionId: `unscheduled`,
          })
        })
        const barrier = adapter.runInRegularScope!.afterQueuedWork()
        expect(await settlesNow(barrier)).toBe(false)
        gate.resolve()
        await hydrate
        expect(await settlesNow(barrier)).toBe(true)
      },
    )

    // A second wrapper over the same key discovers it only from a promise.
    // Its unscheduled hydrate is adopted while the scheduler already runs
    // the first wrapper's held regular read.
    it.each([`succeeds`, `fails`] as const)(
      `waits for a hydrate adopted while the scheduler is busy, when it %s`,
      async (outcome) => {
        const key = {}
        const busyDriver = new PromiseBrandedFirstQueryGatedDriver(key)
        const adoptedDriver = new PromiseBrandedFirstQueryGatedDriver(key)
        const busyAdapter = createSQLiteCorePersistenceAdapter({
          driver: busyDriver,
        })
        const adoptedAdapter = createSQLiteCorePersistenceAdapter({
          driver: adoptedDriver,
        })
        // Discover the key through a non-metadata read, then queue a
        // regular metadata read that holds the turn.
        await busyAdapter.getStreamPosition!({
          kind: `eager`,
          collectionId: `discover`,
        })
        const busy = busyAdapter.loadCollectionMetadata!({
          kind: `eager`,
          collectionId: `busy`,
        })
        await busyDriver.firstQueryEntered.promise
        const adopted = adoptedAdapter.runInHydrationScope!(async (scoped) => {
          await scoped.loadCollectionMetadata!({
            kind: `eager`,
            collectionId: `adopted`,
          })
          if (outcome === `fails`) throw new Error(`adopted hydrate failed`)
        })
        const adoptedSettled = adopted.then(
          () => undefined,
          () => undefined,
        )
        await adoptedDriver.firstQueryEntered.promise
        const barrier = busyAdapter.runInRegularScope!.afterQueuedWork()
        busyDriver.releaseFirstQuery()
        await busy
        // The busy read is done; the adopted hydrate is still held.
        expect(await settlesNow(barrier)).toBe(false)
        adoptedDriver.releaseFirstQuery()
        await adoptedSettled
        expect(await settlesNow(barrier)).toBe(true)
      },
    )

    it(`keeps waiting for other queued work after one queued operation fails`, async () => {
      const driver = new FirstQueryGatedDriver()
      const adapter = createSQLiteCorePersistenceAdapter({ driver })
      const heldGate = createDeferred()
      const running = adapter.loadCollectionMetadata!({
        kind: `eager`,
        collectionId: `running`,
      })
      await driver.firstQueryEntered.promise
      const failing = adapter.runInHydrationScope!(() => {
        throw new Error(`queued hydrate failed`)
      })
      const failingSettled = failing.then(
        () => undefined,
        () => undefined,
      )
      const held = adapter.runInRegularScope!(() => heldGate.promise)
      const barrier = adapter.runInRegularScope!.afterQueuedWork()
      driver.releaseFirstQuery()
      await Promise.all([running, failingSettled])
      // The failed hydrate has settled, but the held regular task has not.
      expect(await settlesNow(barrier)).toBe(false)
      heldGate.resolve()
      await held
      expect(await settlesNow(barrier)).toBe(true)
    })

    it(`waits for work queued before the call, not after it`, async () => {
      const driver = new FirstQueryGatedDriver()
      const hydrateAdapter = createSQLiteCorePersistenceAdapter({ driver })
      const barrierAdapter = createSQLiteCorePersistenceAdapter({ driver })
      const events: Array<string> = []
      const laterGate = createDeferred()

      const earlier = hydrateAdapter.runInHydrationScope!(async (scoped) => {
        await scoped.loadCollectionMetadata!({
          kind: `eager`,
          collectionId: `earlier`,
        })
        events.push(`earlier-hydrate`)
      })
      await driver.firstQueryEntered.promise
      const barrier = barrierAdapter
        .runInRegularScope!.afterQueuedWork()
        .then(() => {
          events.push(`barrier`)
        })
      const later = hydrateAdapter.runInHydrationScope!(async () => {
        await laterGate.promise
        events.push(`later-hydrate`)
      })
      const laterRegular = barrierAdapter.runInRegularScope!(async () => {
        await laterGate.promise
        events.push(`later-regular`)
      })

      expect(await settlesNow(barrier)).toBe(false)
      driver.releaseFirstQuery()
      await earlier
      // The barrier settles while the work queued after it is still held.
      expect(await settlesNow(barrier)).toBe(true)
      expect(events).toEqual([`earlier-hydrate`, `barrier`])
      laterGate.resolve()
      await Promise.all([later, laterRegular])
      expect(events.slice(0, 2)).toEqual([`earlier-hydrate`, `barrier`])
    })
  })

  it(`stops probing after the first returned promise lacks scheduling support`, async () => {
    const driver = new UnbrandedPromiseLookupDriver()
    const adapter = createSQLiteCorePersistenceAdapter({ driver })

    await adapter.loadCollectionMetadata!({
      kind: `eager`,
      collectionId: `first`,
    })
    await adapter.loadCollectionMetadata!({
      kind: `eager`,
      collectionId: `second`,
    })

    expect(driver.schedulingKeyLookups).toBe(1)
  })
})

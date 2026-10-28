// Scenario checks for logical scheduling across SQLite core adapters: hydration
// admission, wrapper identity, and the queued-work barrier. The generated
// non-preemption property in `shared-logical-scheduling-oracle.test.ts` owns the law.
import { describe, expect, it } from 'vitest'
import { createSQLiteCorePersistenceAdapter } from '../src'
import {
  FirstQueryGatedDriver,
  PromiseBrandedFirstQueryGatedDriver,
  UnbrandedPromiseLookupDriver,
  createDeferred,
  createTransparentWrapper,
} from './shared-logical-scheduling-support'
import type { SQLiteDriver } from '../src'

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

    it(`keeps waiting for an unscheduled hydrate after another one fails`, async () => {
      const adapter = createSQLiteCorePersistenceAdapter({
        driver: new UnbrandedPromiseLookupDriver(),
      })
      const failGate = createDeferred()
      const heldGate = createDeferred()
      const failing = adapter.runInHydrationScope!(async () => {
        await failGate.promise
        throw new Error(`unscheduled hydrate failed`)
      })
      const failingSettled = failing.then(
        () => undefined,
        () => undefined,
      )
      const held = adapter.runInHydrationScope!(() => heldGate.promise)
      const barrier = adapter.runInRegularScope!.afterQueuedWork()
      failGate.resolve()
      await failingSettled
      // The failed hydrate has settled, but the held one has not.
      expect(await settlesNow(barrier)).toBe(false)
      heldGate.resolve()
      await held
      expect(await settlesNow(barrier)).toBe(true)
    })

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

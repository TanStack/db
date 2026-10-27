/**
 * Unit scenarios of the infinite-query suite. Each one compares production with
 * a value that a person wrote down: a rejection message, an error the test
 * created itself, a subscriber count of zero, or a fetch order recorded as
 * booleans. None compares with the source rows or with a model, so none is
 * oracle coverage. The page-ledger laws are in infinite-suite-oracle.ts, and
 * the shared machinery is in infinite-suite-harness.ts.
 */
import { expect, it } from 'vitest'
import {
  captureError,
  rows,
  runScenario,
  scenarioLifetime,
  trackScenarioPromise,
  waitFor,
} from './infinite-suite-harness'
import type { QueryBuild } from './contract'
import type { InfiniteQueryContext } from './infinite-suite-harness'

export function registerInfiniteQueryCaseScenarios(
  context: InfiniteQueryContext,
): void {
  const { driver, registry, state } = context
  const lifetime = scenarioLifetime(state)
  const trackPromise = (promise: Promise<void>): Promise<void> =>
    trackScenarioPromise(state, promise)
  const scenario = (
    key: string,
    name: string,
    fn: () => Promise<void> | void,
  ) => {
    registry.register(key)
    const label = `[${key}] ${name}`
    it(label, () => runScenario(state, fn))
  }

  scenario(
    `fetch-settlement`,
    `fulfills the driver operation only after the window request fulfills`,
    async () => {
      const source = driver.makeSource(rows(8))
      const handle = driver.mount(
        (q) =>
          q
            .from({ items: source.collection })
            .orderBy(({ items }: any) => items.rank, `desc`),
        { pageSize: 3 },
      )
      await handle.flush()

      const utils = handle.current().collection.utils as {
        setWindow: (window: {
          offset: number
          limit: number
        }) => true | Promise<void>
      }
      const originalSetWindow = utils.setWindow.bind(utils)
      let resolveWindow: (() => void) | undefined
      lifetime!.defer(() => resolveWindow?.())
      utils.setWindow = (window) => {
        originalSetWindow(window)
        return new Promise<void>((resolve) => {
          resolveWindow = resolve
        })
      }

      try {
        let fetchFulfilled = false
        const fetch = trackPromise(handle.fetchNextPage()).then(() => {
          fetchFulfilled = true
        })
        void fetch.catch(() => undefined)
        await waitFor(() => resolveWindow !== undefined)
        await Promise.resolve()
        expect(fetchFulfilled).toBe(false)
        resolveWindow?.()
        await fetch
        expect(fetchFulfilled).toBe(true)
      } finally {
        utils.setWindow = originalSetWindow
      }
    },
  )

  scenario(
    `callback-error`,
    `surfaces an error thrown while constructing the query`,
    async () => {
      const failure = new Error(`query construction failed`)
      const error = await captureError(() =>
        driver.mount(
          ((..._args: Array<any>) => {
            throw failure
          }) as any,
          { pageSize: 3 },
        ),
      )
      expect(error).toBe(failure)
    },
  )

  scenario(
    `disabled-callback`,
    `rejects a nullable query callback through the shared input policy`,
    async () => {
      const error = await captureError(() =>
        driver.mount((() => null) as any, { pageSize: 3 }),
      )
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toContain(
        `Disabled null or undefined queries are not supported`,
      )
    },
  )

  scenario(
    `findone-runtime`,
    `rejects a single-result query at runtime`,
    async () => {
      const source = driver.makeSource(rows(4))
      const error = await captureError(() =>
        driver.mount(
          ((q: any) =>
            q
              .from({ items: source.collection })
              .orderBy(({ items }: any) => items.rank, `desc`)
              .findOne()) as any,
          { pageSize: 3 },
        ),
      )
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toContain(`Remove .findOne()`)
      // A rejected query must not have started: its source stays unread.
      expect(source.collection.subscriberCount).toBe(0)
    },
  )

  scenario(
    `unordered-collection`,
    `rejects a pre-created collection without orderBy`,
    async () => {
      const source = driver.makeSource(rows(4))
      const unordered = driver.makePrecreated((q) =>
        q.from({ items: source.collection }),
      ).collection
      const error = await captureError(() =>
        driver.mountCollection(unordered, { pageSize: 3 }),
      )
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toMatch(/orderBy|ORDER BY/)
    },
  )

  scenario(
    `unordered-query`,
    `rejects a query callback without orderBy`,
    async () => {
      const source = driver.makeSource(rows(4))
      const error = await captureError(() =>
        driver.mount((q) => q.from({ items: source.collection }), {
          pageSize: 3,
        }),
      )
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toMatch(/orderBy|ORDER BY/)
    },
  )

  scenario(
    `findone-collection`,
    `rejects a pre-created single-result collection`,
    async () => {
      const source = driver.makeSource(rows(4))
      const single = driver.makePrecreated(((q: any) =>
        q
          .from({ items: source.collection })
          .orderBy(({ items }: any) => items.rank, `desc`)
          .findOne()) as any).collection
      const error = await captureError(() =>
        driver.mountCollection(single, { pageSize: 3 }),
      )
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toContain(`Remove .findOne()`)
    },
  )

  scenario(
    `invalid-input`,
    `rejects a first argument that is neither a query nor a collection`,
    async () => {
      const error = await captureError(() =>
        driver.mount(null as unknown as Parameters<typeof driver.mount>[0], {
          pageSize: 3,
        }),
      )
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toContain(`First argument`)
    },
  )

  scenario(
    `source-id-reuse-in-one-query`,
    `rejects or pages one query that reads two sources under one Collection ID`,
    async () => {
      // Overlapping but different rows: ids 1-4 and 3-6.
      const first = driver.makeSource(rows(4))
      const reused = driver.makeSource(rows(6).slice(2), first.collection.id)
      const build: QueryBuild = (q) =>
        q
          .from({ items: first.collection })
          .join(
            { other: reused.collection },
            ({ items, other }: any) => driver.eq(items.id, other.id),
            `inner`,
          )
          .orderBy(({ items }: any) => items.rank, `desc`)
          .select(({ items }: any) => ({ ...items }))
      if (driver.comparesQueryIdentity) {
        const error = await captureError(() =>
          driver.mount(build, { pageSize: 3 }),
        )
        expect(error).toMatchObject({ name: `SourceCollectionIdReuseError` })
        return
      }
      // The inner join matches only ids both objects hold: 3 and 4.
      // Reading the first object for both sides pages 1-3; the second, 3-5.
      const handle = driver.mount(build, { pageSize: 3 })
      await handle.flush()
      expect(handle.current().data.map((row: any) => row.id)).toEqual([
        `3`,
        `4`,
      ])
    },
  )
}

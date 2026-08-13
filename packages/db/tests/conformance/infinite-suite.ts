/** Shared behavioral suite for every `useLiveInfiniteQuery` adapter. */
import { describe, expect, it, vi } from 'vitest'
import type {
  InfiniteQueryDriver,
  InfiniteQueryHandle,
} from './infinite-contract'

interface InfiniteRow {
  id: string
  label: string
  rank: number
}

function rows(count: number, prefix = ``): Array<InfiniteRow> {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}${index + 1}`,
    label: `${prefix || `row`}-${index + 1}`,
    rank: count - index,
  }))
}

async function captureError(fn: () => InfiniteQueryHandle): Promise<unknown> {
  try {
    const handle = fn()
    await handle.flush()
    handle.unmount()
    return undefined
  } catch (error) {
    return error
  }
}

async function waitFor(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (check()) return
    await Promise.resolve()
  }
  throw new Error(`Condition did not become true`)
}

async function waitForAsync(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`Condition did not become true`)
}

export function runInfiniteQuerySuite(rawDriver: InfiniteQueryDriver): void {
  const gaps = new Set(rawDriver.knownGaps ?? [])
  const registeredKeys = new Set<string>()
  let mounted: Array<InfiniteQueryHandle> | null = null

  const track = <H extends InfiniteQueryHandle>(handle: H): H => {
    mounted?.push(handle)
    return handle
  }
  const driver: InfiniteQueryDriver = {
    ...rawDriver,
    mount: (build, config) => track(rawDriver.mount(build, config)),
    mountControllable: (build, initial, config) =>
      track(rawDriver.mountControllable(build, initial, config)),
    mountCollection: (collection, config) =>
      track(rawDriver.mountCollection(collection, config)),
    mountCollectionControllable: (collection, config) =>
      track(rawDriver.mountCollectionControllable(collection, config)),
    mountConfigControllable: (build, config) =>
      track(rawDriver.mountConfigControllable(build, config)),
    mountInputControllable: (collection, build, config) =>
      track(rawDriver.mountInputControllable(collection, build, config)),
  }

  const scenario = (
    key: string,
    name: string,
    fn: () => Promise<void> | void,
  ) => {
    registeredKeys.add(key)
    const expectFail = gaps.has(key)
    const label = `[${key}] ${name}${expectFail ? ` (expected-fail)` : ``}`
    const run = async () => {
      const handles: Array<InfiniteQueryHandle> = []
      mounted = handles
      try {
        await fn()
      } finally {
        mounted = null
        for (const handle of handles) {
          try {
            handle.unmount()
          } catch {
            // Teardown is best-effort and idempotent.
          }
        }
      }
    }
    if (expectFail) it.fails(label, run)
    else it(label, run)
  }

  describe(`infinite-query conformance :: ${driver.name}`, () => {
    scenario(
      `page-expansion`,
      `loads the initial page and expands through the final partial page`,
      async () => {
        const source = driver.makeSource(rows(8))
        const handle = driver.mount(
          (q) =>
            q
              .from({ items: source.collection })
              .orderBy(({ items }: any) => items.rank, `desc`),
          { pageSize: 3, initialPageParam: 4 },
        )
        await handle.flush()

        expect(handle.current().data.map((row) => row.id)).toEqual([
          `1`,
          `2`,
          `3`,
        ])
        expect(handle.current().pages.map((page) => page.length)).toEqual([3])
        expect(handle.current().pageParams).toEqual([4])
        expect(handle.current().hasNextPage).toBe(true)

        await handle.fetchNextPage()
        await handle.flush()
        expect(handle.current().data.map((row) => row.id)).toEqual([
          `1`,
          `2`,
          `3`,
          `4`,
          `5`,
          `6`,
        ])
        expect(handle.current().pageParams).toEqual([4, 5])

        await handle.fetchNextPage()
        await handle.flush()
        expect(handle.current().pages.map((page) => page.length)).toEqual([
          3, 3, 2,
        ])
        expect(handle.current().pageParams).toEqual([4, 5, 6])
        expect(handle.current().hasNextPage).toBe(false)
      },
    )

    scenario(
      `boundary-noop`,
      `does not add a page after the end of the result`,
      async () => {
        const source = driver.makeSource(rows(2))
        const handle = driver.mount(
          (q) =>
            q
              .from({ items: source.collection })
              .orderBy(({ items }: any) => items.rank, `desc`),
          { pageSize: 3 },
        )
        await handle.flush()

        await handle.fetchNextPage()
        await handle.flush()
        expect(handle.current().pages.map((page) => page.length)).toEqual([2])
        expect(handle.current().hasNextPage).toBe(false)
      },
    )

    scenario(
      `empty-result`,
      `represents an empty result as one empty page`,
      async () => {
        const source = driver.makeSource(rows(0))
        const handle = driver.mount(
          (q) =>
            q
              .from({ items: source.collection })
              .orderBy(({ items }: any) => items.rank, `desc`),
          { pageSize: 3 },
        )
        await handle.flush()

        expect(handle.current().data).toEqual([])
        expect(handle.current().pages).toEqual([[]])
        expect(handle.current().hasNextPage).toBe(false)
      },
    )

    scenario(
      `exact-boundary`,
      `detects the end when the result fills the final page exactly`,
      async () => {
        const source = driver.makeSource(rows(6))
        const handle = driver.mount(
          (q) =>
            q
              .from({ items: source.collection })
              .orderBy(({ items }: any) => items.rank, `desc`),
          { pageSize: 3 },
        )
        await handle.flush()
        await handle.fetchNextPage()
        await handle.flush()

        expect(handle.current().pages.map((page) => page.length)).toEqual([
          3, 3,
        ])
        expect(handle.current().hasNextPage).toBe(false)
      },
    )

    scenario(
      `live-window`,
      `keeps all committed pages live when a row enters the window`,
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
        await handle.fetchNextPage()
        await handle.flush()

        await handle.apply(() => {
          source.insert({ id: `new`, label: `new`, rank: 100 })
        })
        expect(handle.current().data.map((row) => row.id)).toEqual([
          `new`,
          `1`,
          `2`,
          `3`,
          `4`,
          `5`,
        ])
        expect(handle.current().pages.map((page) => page.length)).toEqual([
          3, 3,
        ])
      },
    )

    scenario(
      `live-deletion`,
      `backfills committed pages when rows are deleted`,
      async () => {
        const data = rows(8)
        const source = driver.makeSource(data)
        const handle = driver.mount(
          (q) =>
            q
              .from({ items: source.collection })
              .orderBy(({ items }: any) => items.rank, `desc`),
          { pageSize: 3 },
        )
        await handle.flush()
        await handle.fetchNextPage()
        await handle.flush()

        await handle.apply(() => source.remove(data[1]!))
        expect(handle.current().data.map((row) => row.id)).toEqual([
          `1`,
          `3`,
          `4`,
          `5`,
          `6`,
          `7`,
        ])
        expect(handle.current().pages.map((page) => page.length)).toEqual([
          3, 3,
        ])
      },
    )

    scenario(
      `partial-page-deletion`,
      `removes rows from a partial page in either order direction`,
      async () => {
        for (const direction of [`desc`, `asc`] as const) {
          const data = rows(5, direction)
          const source = driver.makeSource(data)
          const handle = driver.mount(
            (q) =>
              q
                .from({ items: source.collection })
                .orderBy(({ items }: any) => items.rank, direction),
            { pageSize: 20 },
          )
          await handle.flush()

          const removed = direction === `desc` ? data[0]! : data[4]!
          await handle.apply(() => source.remove(removed))
          expect(handle.current().data.map((row) => row.id)).not.toContain(
            removed.id,
          )
          expect(handle.current().pages.map((page) => page.length)).toEqual([4])
          expect(handle.current().hasNextPage).toBe(false)
          handle.unmount()
        }
      },
    )

    scenario(
      `live-has-next-page`,
      `updates hasNextPage when a row is inserted beyond the visible page`,
      async () => {
        const source = driver.makeSource(rows(3))
        const handle = driver.mount(
          (q) =>
            q
              .from({ items: source.collection })
              .orderBy(({ items }: any) => items.rank, `desc`),
          { pageSize: 3 },
        )
        await handle.flush()
        expect(handle.current().hasNextPage).toBe(false)

        await handle.apply(() => {
          source.insert({ id: `last`, label: `last`, rank: 0 })
        })
        expect(handle.current().data.map((row) => row.id)).toEqual([
          `1`,
          `2`,
          `3`,
        ])
        expect(handle.current().hasNextPage).toBe(true)
      },
    )

    scenario(
      `concurrent-fetch`,
      `coalesces concurrent next-page requests`,
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
        let calls = 0
        let resolveWindow: (() => void) | undefined
        utils.setWindow = (window) => {
          calls++
          originalSetWindow(window)
          return new Promise<void>((resolve) => {
            resolveWindow = resolve
          })
        }

        try {
          const first = handle.fetchNextPage()
          const second = handle.fetchNextPage()
          let secondSettled = false
          void second.then(
            () => {
              secondSettled = true
            },
            () => {
              secondSettled = true
            },
          )
          await waitFor(() => resolveWindow !== undefined)

          expect(calls).toBe(1)
          expect(handle.current().isFetchingNextPage).toBe(true)
          expect(secondSettled).toBe(false)
          resolveWindow?.()
          await Promise.all([first, second])
          await handle.flush()
          expect(handle.current().pages.map((page) => page.length)).toEqual([
            3, 3,
          ])
        } finally {
          utils.setWindow = originalSetWindow
        }
      },
    )

    scenario(
      `fetch-settlement`,
      `settles the driver operation with the window request`,
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
        utils.setWindow = (window) => {
          originalSetWindow(window)
          return new Promise<void>((resolve) => {
            resolveWindow = resolve
          })
        }

        try {
          let settled = false
          const fetch = handle.fetchNextPage().then(() => {
            settled = true
          })
          await waitFor(() => resolveWindow !== undefined)
          await Promise.resolve()
          expect(settled).toBe(false)
          resolveWindow?.()
          await fetch
          expect(settled).toBe(true)
        } finally {
          utils.setWindow = originalSetWindow
        }
      },
    )

    scenario(
      `on-demand-paging`,
      `uses peek-ahead windows while paging an on-demand source`,
      async () => {
        const source = driver.makeOnDemandSource(rows(8))
        const handle = driver.mount(
          (q) =>
            q
              .from({ items: source.collection })
              .orderBy(({ items }: any) => items.rank, `desc`),
          { pageSize: 3 },
        )
        await handle.flush()

        expect(source.calls.some((call) => call.limit === 4)).toBe(true)
        expect(handle.current().data.map((row) => row.id)).toEqual([
          `1`,
          `2`,
          `3`,
        ])
        expect(handle.current().hasNextPage).toBe(true)

        await handle.fetchNextPage()
        await handle.fetchNextPage()
        await handle.flush()
        expect(handle.current().pages.map((page) => page.length)).toEqual([
          3, 3, 2,
        ])
        expect(handle.current().hasNextPage).toBe(false)
      },
    )

    scenario(
      `on-demand-async`,
      `tracks an asynchronous on-demand page load`,
      async () => {
        const source = driver.makeOnDemandSource(rows(8), 5)
        const handle = driver.mount(
          (q) =>
            q
              .from({ items: source.collection })
              .orderBy(({ items }: any) => items.rank, `desc`),
          { pageSize: 3 },
        )
        await waitForAsync(() => handle.current().data.length === 3)

        const fetch = handle.fetchNextPage()
        await waitForAsync(() => handle.current().isFetchingNextPage)
        await fetch
        await handle.flush()
        expect(handle.current().pages.map((page) => page.length)).toEqual([
          3, 3,
        ])
        expect(handle.current().isFetchingNextPage).toBe(false)
      },
    )

    scenario(
      `window-failure`,
      `surfaces a rejected window request without committing the page`,
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

        const failure = new Error(`window failed`)
        const utils = handle.current().collection.utils as {
          setWindow: (window: {
            offset: number
            limit: number
          }) => true | Promise<void>
        }
        const originalSetWindow = utils.setWindow.bind(utils)
        utils.setWindow = (window) => {
          originalSetWindow(window)
          return Promise.reject(failure)
        }

        try {
          await handle.fetchNextPage().catch(() => {})
          await handle.flush()
          expect(handle.current().pages.map((page) => page.length)).toEqual([3])
          expect(handle.current().status).toBe(`error`)
          expect(handle.current().error).toBe(failure)

          utils.setWindow = originalSetWindow
          await handle.fetchNextPage()
          await handle.flush()
          expect(handle.current().pages.map((page) => page.length)).toEqual([
            3, 3,
          ])
          expect(handle.current().error).toBeUndefined()
        } finally {
          utils.setWindow = originalSetWindow
        }
      },
    )

    scenario(
      `dependency-immediate-fetch`,
      `fetches from the replacement query before the framework settles`,
      async () => {
        const source = driver.makeSource(rows(10))
        const handle = driver.mountControllable(
          (q, minimum: number) =>
            q
              .from({ items: source.collection })
              .where(({ items }: any) => driver.gt(items.rank, minimum))
              .orderBy(({ items }: any) => items.rank, `desc`),
          0,
          { pageSize: 3 },
        )
        await handle.flush()
        await handle.fetchNextPage()
        await handle.flush()

        handle.setParamSync(5)
        await handle.fetchNextPage()
        await handle.flush()

        expect(handle.current().data.map((row) => row.rank)).toEqual([
          10, 9, 8, 7, 6,
        ])
        expect(handle.current().pages.map((page) => page.length)).toEqual([
          3, 2,
        ])
      },
    )

    scenario(
      `equal-dependency-depth`,
      `preserves loaded pages for a structurally equal dependency`,
      async () => {
        const source = driver.makeSource(rows(10))
        const handle = driver.mountControllable(
          (q, filter: { minimum: number }) =>
            q
              .from({ items: source.collection })
              .where(({ items }: any) => driver.gt(items.rank, filter.minimum))
              .orderBy(({ items }: any) => items.rank, `desc`),
          { minimum: 0 },
          { pageSize: 3 },
        )
        await handle.flush()
        await handle.fetchNextPage()
        await handle.flush()

        handle.setParamSync({ minimum: 0 })
        await handle.flush()
        expect(handle.current().pages.map((page) => page.length)).toEqual([
          3, 3,
        ])
      },
    )

    scenario(
      `circular-dependency`,
      `preserves page depth for a structurally equal circular dependency`,
      async () => {
        const source = driver.makeSource(rows(8))
        const dependency: { self?: unknown } = {}
        dependency.self = dependency
        const handle = driver.mountControllable(
          (q, _dependency: unknown) =>
            q
              .from({ items: source.collection })
              .orderBy(({ items }: any) => items.rank, `desc`),
          dependency,
          { pageSize: 3 },
        )
        await handle.flush()
        await handle.fetchNextPage()
        await handle.flush()

        const replacement: { self?: unknown } = {}
        replacement.self = replacement
        handle.setParamSync(replacement)
        await handle.flush()

        expect(handle.current().pages.map((page) => page.length)).toEqual([
          3, 3,
        ])
      },
    )

    scenario(
      `page-shape-change`,
      `preserves committed page depth when reactive page options change`,
      async () => {
        const source = driver.makeSource(rows(20))
        const handle = driver.mountConfigControllable(
          (q) =>
            q
              .from({ items: source.collection })
              .orderBy(({ items }: any) => items.rank, `desc`),
          { pageSize: 3, initialPageParam: 4 },
        )
        await handle.flush()
        await handle.fetchNextPage()
        await handle.fetchNextPage()
        await handle.flush()

        handle.setConfigSync({ pageSize: 4, initialPageParam: 8 })
        await handle.flush()
        expect(handle.current().pages.map((page) => page.length)).toEqual([
          4, 4, 4,
        ])
        expect(handle.current().pageParams).toEqual([8, 9, 10])
      },
    )

    scenario(
      `invalid-page-size`,
      `normalizes invalid and unsafe page sizes to the default`,
      async () => {
        const source = driver.makeSource(rows(21))
        for (const pageSize of [
          0,
          -1,
          2.5,
          Number.NaN,
          Number.POSITIVE_INFINITY,
          Number.MAX_SAFE_INTEGER,
        ]) {
          const handle = driver.mount(
            (q) =>
              q
                .from({ items: source.collection })
                .orderBy(({ items }: any) => items.rank, `desc`),
            { pageSize },
          )
          await handle.flush()
          expect(handle.current().pages[0]).toHaveLength(20)
          expect(handle.current().hasNextPage).toBe(true)
          handle.unmount()
        }
      },
    )

    scenario(
      `collection-immediate-fetch`,
      `fetches from a replacement collection before the framework settles`,
      async () => {
        const first = driver.makeSource(rows(8, `a`))
        const second = driver.makeSource(rows(8, `b`))
        const firstQuery = driver.makePrecreated((q) =>
          q
            .from({ items: first.collection })
            .orderBy(({ items }: any) => items.rank, `desc`)
            .limit(4),
        ).collection
        const secondQuery = driver.makePrecreated((q) =>
          q
            .from({ items: second.collection })
            .orderBy(({ items }: any) => items.rank, `desc`)
            .limit(4),
        ).collection
        const handle = driver.mountCollectionControllable(firstQuery, {
          pageSize: 3,
        })
        await handle.flush()
        await handle.fetchNextPage()
        await handle.flush()

        handle.replaceCollectionSync(secondQuery)
        await handle.fetchNextPage()
        await handle.flush()

        expect(handle.current().collection).toBe(secondQuery)
        expect(handle.current().data.map((row) => row.id)).toEqual([
          `b1`,
          `b2`,
          `b3`,
          `b4`,
          `b5`,
          `b6`,
        ])
        expect(handle.current().pages.map((page) => page.length)).toEqual([
          3, 3,
        ])
      },
    )

    scenario(
      `input-kind-switch`,
      `switches between a supplied collection and a query callback`,
      async () => {
        const collectionSource = driver.makeSource(rows(6, `a`))
        const querySource = driver.makeSource(rows(6, `b`))
        const collection = driver.makePrecreated((q) =>
          q
            .from({ items: collectionSource.collection })
            .orderBy(({ items }: any) => items.rank, `desc`)
            .limit(4),
        ).collection
        const handle = driver.mountInputControllable(
          collection,
          (q) =>
            q
              .from({ items: querySource.collection })
              .orderBy(({ items }: any) => items.rank, `desc`),
          { pageSize: 3 },
        )
        await handle.flush()
        expect(handle.current().data.map((row) => row.id)).toEqual([
          `a1`,
          `a2`,
          `a3`,
        ])

        handle.setInputKindSync(`query`)
        await handle.flush()
        expect(handle.current().data.map((row) => row.id)).toEqual([
          `b1`,
          `b2`,
          `b3`,
        ])

        handle.setInputKindSync(`collection`)
        await handle.flush()
        expect(handle.current().data.map((row) => row.id)).toEqual([
          `a1`,
          `a2`,
          `a3`,
        ])
      },
    )

    scenario(
      `stale-window`,
      `ignores a window promise from a replaced query`,
      async () => {
        const source = driver.makeSource(rows(10))
        const handle = driver.mountControllable(
          (q, minimum: number) =>
            q
              .from({ items: source.collection })
              .where(({ items }: any) => driver.gt(items.rank, minimum))
              .orderBy(({ items }: any) => items.rank, `desc`),
          0,
          { pageSize: 3 },
        )
        await handle.flush()

        const oldUtils = handle.current().collection.utils as {
          setWindow: (window: {
            offset: number
            limit: number
          }) => true | Promise<void>
        }
        const originalSetWindow = oldUtils.setWindow.bind(oldUtils)
        let resolveWindow: (() => void) | undefined
        oldUtils.setWindow = (window) => {
          const result = originalSetWindow(window)
          if (resolveWindow !== undefined) return result
          return new Promise<void>((resolve) => {
            resolveWindow = resolve
          })
        }

        try {
          const staleFetch = handle.fetchNextPage()
          await waitFor(() => resolveWindow !== undefined)
          handle.setParamSync(8)
          await handle.flush()
          resolveWindow?.()
          await staleFetch.catch(() => {})
          await handle.flush()

          expect(handle.current().data.map((row) => row.rank)).toEqual([10, 9])
          expect(handle.current().pages.map((page) => page.length)).toEqual([2])
        } finally {
          oldUtils.setWindow = originalSetWindow
        }
      },
    )

    scenario(
      `callback-once`,
      `invokes a zero-arity-compatible query callback once`,
      async () => {
        const source = driver.makeSource(rows(4))
        let calls = 0
        const callback = (...args: Array<any>) => {
          calls++
          return args[0]
            .from({ items: source.collection })
            .orderBy(({ items }: any) => items.rank, `desc`)
        }
        const handle = driver.mount(callback, { pageSize: 3 })
        await handle.flush()

        expect(calls).toBe(1)
        expect(handle.current().data).toHaveLength(3)
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
      `collection-window-normalization`,
      `normalizes a pre-created collection to the first peek-ahead window`,
      async () => {
        const source = driver.makeSource(rows(8))
        const collection = driver.makePrecreated((q) =>
          q
            .from({ items: source.collection })
            .orderBy(({ items }: any) => items.rank, `desc`)
            .offset(1)
            .limit(2),
        ).collection
        const warn = vi.spyOn(console, `warn`).mockImplementation(() => {})
        const handle = driver.mountCollection(collection, { pageSize: 3 })
        await handle.flush()

        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining(`Pre-created collection has window`),
        )
        expect(
          (collection.utils as { getWindow: () => unknown }).getWindow(),
        ).toEqual({ offset: 0, limit: 4 })
        expect(handle.current().data.map((row) => row.id)).toEqual([
          `1`,
          `2`,
          `3`,
        ])
        warn.mockRestore()
      },
    )

    scenario(
      `collection-live-update`,
      `keeps a supplied pre-created collection live`,
      async () => {
        const source = driver.makeSource(rows(6))
        const collection = driver.makePrecreated((q) =>
          q
            .from({ items: source.collection })
            .orderBy(({ items }: any) => items.rank, `desc`)
            .limit(4),
        ).collection
        const handle = driver.mountCollection(collection, { pageSize: 3 })
        await handle.flush()

        await handle.apply(() => {
          source.insert({ id: `new`, label: `new`, rank: 100 })
        })
        expect(handle.current().data.map((row) => row.id)).toEqual([
          `new`,
          `1`,
          `2`,
        ])
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
      `shared-window-release`,
      `releases shared window leases and restores the initial window`,
      async () => {
        const source = driver.makeSource(rows(12))
        const collection = driver.makePrecreated((q) =>
          q
            .from({ items: source.collection })
            .orderBy(({ items }: any) => items.rank, `desc`)
            .limit(4),
        ).collection
        const warn = vi.spyOn(console, `warn`).mockImplementation(() => {})
        try {
          const larger = driver.mountCollection(collection, { pageSize: 3 })
          const smaller = driver.mountCollection(collection, { pageSize: 1 })
          await larger.flush()
          await smaller.flush()
          await larger.fetchNextPage()
          await smaller.fetchNextPage()
          await larger.flush()

          const getWindow = () =>
            (collection.utils as { getWindow: () => unknown }).getWindow()
          expect(getWindow()).toEqual({ offset: 0, limit: 7 })
          larger.unmount()
          await smaller.flush()
          expect(getWindow()).toEqual({ offset: 0, limit: 3 })
          smaller.unmount()
          expect(getWindow()).toEqual({ offset: 0, limit: 4 })
          expect(warn).not.toHaveBeenCalled()
        } finally {
          warn.mockRestore()
        }
      },
    )

    it(`has no stale known-gap keys`, () => {
      expect([...gaps].filter((key) => !registeredKeys.has(key))).toEqual([])
    })
  })
}

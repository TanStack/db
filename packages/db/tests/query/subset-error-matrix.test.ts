import { describe, expect, it } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { BTreeIndex } from '../../src/indexes/btree-index.js'
import { createEffect, createLiveQueryCollection, eq } from '../../src/index.js'
import { mockSyncCollectionOptions } from '../utils.js'

type Delivery = `throw` | `reject`
type Consumer = `effect` | `live`
type StartupPath = `direct` | `ordered` | `lazy`
type IncrementalPath = Exclude<StartupPath, `direct`>
type FailureValue = `error` | `nan` | `undefined`

type Row = {
  id: number
  rank: number
  parentId: number
}

type FailureCase<TPath extends StartupPath> = {
  name: string
  consumer: Consumer
  path: TPath
  delivery: Delivery
}

type IncrementalFailureCase = FailureCase<IncrementalPath> & {
  failureValue: FailureValue
}

type CleanupFailureCase = {
  name: string
  consumer: Consumer
  failure: unknown
}

const row: Row = { id: 1, rank: 1, parentId: 1 }

// Every query form can fail while it acquires initial coverage.
const startupCases: ReadonlyArray<FailureCase<StartupPath>> = (
  [`effect`, `live`] as const
).flatMap((consumer) =>
  ([`direct`, `ordered`, `lazy`] as const).flatMap((path) =>
    ([`throw`, `reject`] as const).map((delivery) => ({
      name: `${consumer} ${path} ${delivery}`,
      consumer,
      path,
      delivery,
    })),
  ),
)

// Direct queries have no automatic later demand. Ordered refills and lazy
// relationship routes do, so only those paths have incremental cells.
const incrementalCases: ReadonlyArray<IncrementalFailureCase> = (
  [`effect`, `live`] as const
).flatMap((consumer) =>
  ([`ordered`, `lazy`] as const).flatMap((path) =>
    ([`throw`, `reject`] as const).flatMap((delivery) =>
      ([`error`, `nan`, `undefined`] as const).map((failureValue) => ({
        name: `${consumer} ${path} ${delivery} ${failureValue}`,
        consumer,
        path,
        delivery,
        failureValue,
      })),
    ),
  ),
)

const cleanupFailureObject = { kind: `cleanup-failure` }
const cleanupFailureCases: ReadonlyArray<CleanupFailureCase> = (
  [`effect`, `live`] as const
).flatMap((consumer) => [
  { name: `${consumer} undefined`, consumer, failure: undefined },
  { name: `${consumer} NaN`, consumer, failure: Number.NaN },
  { name: `${consumer} object`, consumer, failure: cleanupFailureObject },
])

function fail(delivery: Delivery, error: unknown): Promise<never> {
  if (delivery === `throw`) throw error
  return Promise.reject(error)
}

function createFailingSource(
  id: string,
  delivery: Delivery,
  error: unknown,
  onLoad = () => {},
) {
  return createCollection<Row>({
    id,
    getKey: (item) => item.id,
    syncMode: `on-demand`,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: ({ markReady }) => {
        markReady()
        return {
          loadSubset: () => {
            onLoad()
            return fail(delivery, error)
          },
        }
      },
    },
  })
}

function createStaticSource(id: string, initialData: ReadonlyArray<Row>) {
  return createCollection(
    mockSyncCollectionOptions<Row>({
      id,
      getKey: (item) => item.id,
      initialData: [...initialData],
    }),
  )
}

type RowCollection = ReturnType<typeof createFailingSource>

function startEffect(
  path: StartupPath,
  primary: RowCollection,
  child: RowCollection,
  sourceErrors: Array<Error>,
) {
  const callbacks = {
    onBatch: () => {},
    onSourceError: (error: Error) => sourceErrors.push(error),
  }
  if (path === `ordered`) {
    return createEffect({
      query: (q) =>
        q
          .from({ item: primary })
          .orderBy(({ item }) => item.rank, `asc`)
          .limit(1),
      ...callbacks,
    })
  }
  if (path === `lazy`) {
    return createEffect({
      query: (q) =>
        q
          .from({ item: primary })
          .leftJoin({ child }, ({ item, child: childRow }) =>
            eq(item.id, childRow.parentId),
          ),
      ...callbacks,
    })
  }
  return createEffect({
    query: (q) => q.from({ item: primary }),
    ...callbacks,
  })
}

function startLive(
  path: StartupPath,
  primary: RowCollection,
  child: RowCollection,
) {
  if (path === `ordered`) {
    return createLiveQueryCollection((q) =>
      q
        .from({ item: primary })
        .orderBy(({ item }) => item.rank, `asc`)
        .limit(1),
    )
  }
  if (path === `lazy`) {
    return createLiveQueryCollection((q) =>
      q
        .from({ item: primary })
        .leftJoin({ child }, ({ item, child: childRow }) =>
          eq(item.id, childRow.parentId),
        ),
    )
  }
  return createLiveQueryCollection((q) => q.from({ item: primary }))
}

async function flushFailures() {
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

describe(`loadSubset failure matrix`, () => {
  it.each(startupCases)(
    `releases startup ownership and reports the source error: $name`,
    async ({ consumer, path, delivery }) => {
      const error = new Error(`${consumer} ${path} startup failed`)
      const suffix = `${consumer}-${path}-${delivery}`
      const directOrOrderedSource = createFailingSource(
        `failure-matrix-startup-primary-${suffix}`,
        delivery,
        error,
      )
      const lazyParent = createStaticSource(
        `failure-matrix-startup-parent-${suffix}`,
        [row],
      )
      const lazyChild = createFailingSource(
        `failure-matrix-startup-child-${suffix}`,
        delivery,
        error,
      )
      const primary = path === `lazy` ? lazyParent : directOrOrderedSource
      const child = path === `lazy` ? lazyChild : directOrOrderedSource

      try {
        if (consumer === `effect`) {
          const sourceErrors: Array<Error> = []
          if (delivery === `throw`) {
            expect(() =>
              startEffect(path, primary, child, sourceErrors),
            ).toThrow(error)
          } else {
            const effect = startEffect(path, primary, child, sourceErrors)
            await flushFailures()
            expect(effect.disposed).toBe(true)
            await effect.dispose()
          }
          expect(sourceErrors).toEqual([error])
        } else {
          const live = startLive(path, primary, child)
          try {
            await expect(
              Promise.resolve().then(() => live.preload()),
            ).rejects.toBe(error)
            expect(live.status).toBe(`error`)
          } finally {
            await live.cleanup()
          }
        }

        expect(primary.subscriberCount).toBe(0)
        if (path === `lazy`) expect(child.subscriberCount).toBe(0)
      } finally {
        await Promise.all([
          directOrOrderedSource.cleanup(),
          lazyParent.cleanup(),
          lazyChild.cleanup(),
        ])
      }
    },
  )

  it.each(incrementalCases)(
    `reports an incremental failure without escaping its source commit: $name`,
    async ({ consumer, path, delivery, failureValue }) => {
      const error: unknown =
        failureValue === `nan`
          ? Number.NaN
          : failureValue === `undefined`
            ? undefined
            : new Error(`${consumer} ${path} incremental failed`)
      const suffix = `${consumer}-${path}-${delivery}-${failureValue}`
      let triggerFailure: () => void
      let primary: RowCollection
      let child: RowCollection
      let loadCount = 0

      if (path === `ordered`) {
        let begin!: () => void
        let write!: (message: { type: `insert` | `delete`; value: Row }) => void
        let commit!: () => void
        primary = createCollection<Row>({
          id: `failure-matrix-incremental-ordered-${suffix}`,
          getKey: (item) => item.id,
          syncMode: `on-demand`,
          autoIndex: `eager`,
          defaultIndexType: BTreeIndex,
          sync: {
            sync: (params) => {
              begin = params.begin
              write = params.write
              commit = params.commit
              params.markReady()
              return {
                loadSubset: () => {
                  loadCount++
                  if (loadCount > 1) return fail(delivery, error)
                  begin()
                  write({ type: `insert`, value: row })
                  commit()
                  return true
                },
              }
            },
          },
        })
        child = primary
        triggerFailure = () => {
          begin()
          write({ type: `delete`, value: row })
          commit()
        }
      } else {
        primary = createStaticSource(
          `failure-matrix-incremental-parent-${suffix}`,
          [],
        )
        child = createFailingSource(
          `failure-matrix-incremental-child-${suffix}`,
          delivery,
          error,
          () => loadCount++,
        )
        triggerFailure = () => {
          primary.utils.begin()
          primary.utils.write({ type: `insert`, value: row })
          primary.utils.commit()
        }
      }

      try {
        if (consumer === `effect`) {
          const sourceErrors: Array<Error> = []
          const effect = startEffect(path, primary, child, sourceErrors)
          try {
            triggerFailure()
            await flushFailures()

            expect(sourceErrors).toHaveLength(1)
            if (failureValue === `error`) {
              expect(sourceErrors[0]).toBe(error)
            } else {
              expect(sourceErrors[0]).toBeInstanceOf(Error)
            }
            expect(effect.disposed).toBe(true)
          } finally {
            await effect.dispose()
          }
        } else {
          const live = startLive(path, primary, child)
          try {
            await live.preload()
            triggerFailure()
            await flushFailures()

            expect(live.status).toBe(path === `lazy` ? `error` : `ready`)
            expect(Object.is(live.utils.lastSubsetError, error)).toBe(true)
          } finally {
            await live.cleanup()
          }
        }

        expect(loadCount).toBe(path === `ordered` ? 2 : 1)

        expect(primary.subscriberCount).toBe(0)
        if (path === `lazy`) expect(child.subscriberCount).toBe(0)
      } finally {
        await Promise.all(
          primary === child
            ? [primary.cleanup()]
            : [primary.cleanup(), child.cleanup()],
        )
      }
    },
  )

  it.each(cleanupFailureCases)(
    `reports obsolete-demand cleanup failure without failing the source commit: $name`,
    async ({ consumer, failure }) => {
      const suffix = `${consumer}-${
        failure === undefined
          ? `undefined`
          : typeof failure === `number`
            ? `nan`
            : `object`
      }`
      const parent = createStaticSource(`cleanup-failure-parent-${suffix}`, [
        row,
      ])
      let unloadCount = 0
      const child = createCollection<Row>({
        id: `cleanup-failure-child-${suffix}`,
        getKey: (item) => item.id,
        syncMode: `on-demand`,
        autoIndex: `eager`,
        defaultIndexType: BTreeIndex,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {
              loadSubset: () => true,
              unloadSubset: () => {
                unloadCount++
                if (unloadCount === 1) throw failure
              },
            }
          },
        },
      })
      const sourceErrors: Array<Error> = []
      const effect =
        consumer === `effect`
          ? createEffect({
              query: (q) =>
                q
                  .from({ item: parent })
                  .leftJoin({ child }, ({ item, child: childRow }) =>
                    eq(item.id, childRow.parentId),
                  ),
              onBatch: () => {},
              onSourceError: (error) => sourceErrors.push(error),
            })
          : undefined
      const live =
        consumer === `live`
          ? createLiveQueryCollection((q) =>
              q
                .from({ item: parent })
                .leftJoin({ child }, ({ item, child: childRow }) =>
                  eq(item.id, childRow.parentId),
                ),
            )
          : undefined

      try {
        if (live) await live.preload()
        await flushFailures()

        let didThrow = false
        let thrown: unknown
        try {
          parent.utils.begin()
          parent.utils.write({ type: `delete`, value: row })
          parent.utils.commit()
        } catch (error) {
          didThrow = true
          thrown = error
        }

        await flushFailures()

        expect(didThrow).toBe(false)
        expect(thrown).toBeUndefined()
        if (effect) {
          expect(sourceErrors).toHaveLength(1)
          expect(sourceErrors[0]?.message).toBe(String(failure))
          expect(effect.disposed).toBe(true)
        } else {
          expect(sourceErrors).toEqual([])
        }
        if (live) {
          expect(live.utils.hasSubsetError).toBe(true)
          expect(Object.is(live.utils.lastSubsetError, failure)).toBe(true)
          expect(live.status).toBe(`ready`)
        }
      } finally {
        if (effect) await effect.dispose()
        if (live) await live.cleanup()
        expect(unloadCount).toBe(2)
        await Promise.all([parent.cleanup(), child.cleanup()])
      }
    },
  )

  it(`retries live cleanup after an undefined failure survives demand retirement`, async () => {
    const parent = createStaticSource(`undefined-cleanup-retry-parent`, [row])
    let unloadCount = 0
    const child = createCollection<Row>({
      id: `undefined-cleanup-retry-child`,
      getKey: (item) => item.id,
      syncMode: `on-demand`,
      autoIndex: `eager`,
      defaultIndexType: BTreeIndex,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return {
            loadSubset: () => true,
            unloadSubset: () => {
              unloadCount++
              if (unloadCount <= 2) throw undefined
            },
          }
        },
      },
    })
    const live = createLiveQueryCollection((q) =>
      q
        .from({ item: parent })
        .leftJoin({ child }, ({ item, child: childRow }) =>
          eq(item.id, childRow.parentId),
        ),
    )
    const originalQueueMicrotask = globalThis.queueMicrotask
    const queuedMicrotasks: Array<() => void> = []

    try {
      await live.preload()

      parent.utils.begin()
      parent.utils.write({ type: `delete`, value: row })
      parent.utils.commit()
      await flushFailures()

      expect(unloadCount).toBe(1)
      expect(live.utils.hasSubsetError).toBe(true)
      expect(live.utils.lastSubsetError).toBeUndefined()

      globalThis.queueMicrotask = (callback) => {
        queuedMicrotasks.push(callback)
      }
      await live.cleanup()
      expect(unloadCount).toBe(2)
      expect(queuedMicrotasks).toHaveLength(1)

      let cleanupSurfaced = false
      try {
        queuedMicrotasks[0]!()
      } catch {
        cleanupSurfaced = true
      }
      expect(cleanupSurfaced).toBe(true)

      await live.cleanup()
      expect(unloadCount).toBe(3)
    } finally {
      globalThis.queueMicrotask = originalQueueMicrotask
      await Promise.all([live.cleanup(), parent.cleanup(), child.cleanup()])
    }
  })
})

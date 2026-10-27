import { describe, expect, it, vi } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { createDeferred } from '../../src/deferred.js'
import { BasicIndex } from '../../src/indexes/basic-index.js'
import { BucketFacadeAdapter } from '../../src/query/live/bucket-facade-adapter.js'
import {
  createLiveQueryCollection,
  eq,
  include,
  materialize,
  toArray,
} from '../../src/query/index.js'
import { flushPromises } from '../utils.js'
import { createControlledCollection } from './includes-oracle-helpers.js'
import {
  Projection,
  cleanupAfterOracle,
  collectionInputError,
  noPrimaryFailure,
  readChildren,
  rejectsCollectionInput,
  valueCells,
} from './includes-functional-projection-support.js'

// Ordinary functional projection tests. They compare production with written
// values: a fixed lifecycle, a cleanup machinery check, read surfaces, facade
// identity, and value output. The law owner is
// includes-functional-projection-oracle.test.ts, which keeps the model-based
// cells and the grammar calibration.

describe(`functional projection output compatibility`, () => {
  it(`retains the first mismatch and all cleanup failures`, async () => {
    const primary = new Error(`public result mismatch`)
    const firstCleanup = new Error(`first cleanup failed`)
    const secondCleanup = new Error(`second cleanup failed`)
    const released: Array<number> = []
    let reported: unknown
    let primaryFailure: unknown = noPrimaryFailure
    try {
      try {
        throw primary
      } catch (error) {
        primaryFailure = error
        throw error
      } finally {
        await cleanupAfterOracle(primaryFailure, [
          () => {
            released.push(1)
            throw firstCleanup
          },
          () => {
            released.push(2)
            throw secondCleanup
          },
          () => {
            released.push(3)
          },
        ])
      }
    } catch (error) {
      reported = error
    }
    expect(released).toEqual([1, 2, 3])
    expect(reported).toBeInstanceOf(AggregateError)
    expect((reported as AggregateError).cause).toBe(primary)
    expect((reported as AggregateError).errors).toEqual([
      firstCleanup,
      secondCleanup,
    ])
  })

  it.each(
    ([`expression`, `functional`] as const).flatMap((projection) =>
      ([`resolve`, `reject`, `cleanup-resolve`, `cleanup-reject`] as const).map(
        (settlement) => ({ projection, settlement }),
      ),
    ),
  )(
    `$projection projection fences $settlement of a pending child load`,
    async ({ projection, settlement }) => {
      const parents = createControlledCollection(`pending-parent`, [
        { id: 1, groupId: 1 },
      ])
      const requests: Array<{
        gate: ReturnType<typeof createDeferred<void>>
        signal: AbortSignal | undefined
      }> = []
      const children = createCollection<{ id: number; groupId: number }>({
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          sync: ({ begin, write, commit, markReady }) => ({
            loadSubset: ({ signal }) => {
              const gate = createDeferred<void>()
              requests.push({ gate, signal })
              return gate.promise.then(async () => {
                if (signal?.aborted) return
                begin()
                write({ type: `insert`, value: { id: 10, groupId: 1 } })
                await commit()
                markReady()
              })
            },
          }),
        },
      })
      const captured: Array<Pick<typeof children, `toArray`>> = []
      const buildQuery = () =>
        createLiveQueryCollection((q) => {
          const source = q.from({
            row: q
              .from({ parent: parents.collection })
              .select(({ parent }) => ({
                id: parent.id,
                children: include(
                  q
                    .from({ child: children })
                    .where(({ child }) => eq(child.groupId, parent.groupId)),
                ),
              })),
          })
          return projection === `expression`
            ? source.select(({ row }) => row)
            : source.fn.select(({ row }) => {
                captured.push(row.children)
                return { id: row.id, children: row.children }
              })
        })
      if (rejectsCollectionInput(`collection`, projection === `functional`)) {
        let primaryFailure: unknown = noPrimaryFailure
        try {
          expect(buildQuery).toThrow(collectionInputError)
          expect(captured).toEqual([])
        } catch (error) {
          primaryFailure = error
          throw error
        } finally {
          await cleanupAfterOracle(primaryFailure, [
            () => parents.collection.cleanup(),
            () => children.cleanup(),
          ])
        }
        return
      }
      const query = buildQuery()
      const failure = new Error(`pending child failed`)
      // Attach both outcomes immediately. A pending-length assertion must not
      // leave a rejected preload promise unobserved.
      const preload = () => {
        const result: { settled: boolean; error?: unknown } = { settled: false }
        const observed = query.preload().then(
          () => {
            result.settled = true
          },
          (error) => {
            result.settled = true
            result.error = error
          },
        )
        return { result, observed }
      }
      let primaryFailure: unknown = noPrimaryFailure
      try {
        const initial = preload()
        await flushPromises()
        expect(requests).toHaveLength(1)
        expect(initial.result.settled).toBe(false)
        expect(query.isReady()).toBe(false)
        const held = query.get(1)!.children
        expect(held.toArray).toEqual([])
        if (projection === `functional`) expect(captured).toHaveLength(1)
        const obsoleteViews = [...captured, held]

        if (settlement.startsWith(`cleanup`)) {
          await query.cleanup()
          await children.cleanup()
          await initial.observed
          expect(initial.result.error).toMatchObject({ name: `AbortError` })
          expect(requests[0]!.signal?.aborted).toBe(true)
          const restarted = preload()
          await flushPromises()
          expect(requests).toHaveLength(2)
          const current = query.get(1)!.children
          if (settlement === `cleanup-reject`) requests[0]!.gate.reject(failure)
          else requests[0]!.gate.resolve()
          await flushPromises()
          expect(
            restarted.result.settled,
            `obsolete completion cannot finish preload`,
          ).toBe(false)
          expect(query.isReady()).toBe(false)
          expect(current.toArray).toEqual([])
          requests[1]!.gate.resolve()
          await restarted.observed
          expect(restarted.result.error).toBeUndefined()
          expect(query.isReady()).toBe(true)
          expect(current.toArray.map((child) => child.id)).toEqual([10])
          for (const view of obsoleteViews) expect(view.toArray).toEqual([])
        } else {
          if (settlement === `reject`) requests[0]!.gate.reject(failure)
          else requests[0]!.gate.resolve()
          await initial.observed
          if (settlement === `reject`) {
            expect(initial.result.error).toBe(failure)
            expect(query.isReady()).toBe(false)
            expect(held.toArray).toEqual([])
          } else {
            expect(initial.result.error).toBeUndefined()
            expect(query.isReady()).toBe(true)
            expect(held.toArray.map((child) => child.id)).toEqual([10])
            for (const view of captured)
              expect(view.toArray.map((child) => child.id)).toEqual([10])
          }
        }
      } catch (error) {
        primaryFailure = error
        throw error
      } finally {
        await cleanupAfterOracle(primaryFailure, [
          () => query.cleanup(),
          ...requests.map(({ gate }) => gate.resolve),
          () => children.cleanup(),
          () => parents.collection.cleanup(),
        ])
      }
    },
  )

  it.each(
    ([`publication`, `after-preload`] as const).flatMap((subscribeAt) =>
      ([`none`, `callback`, `flush`] as const).map((failureAt) => ({
        subscribeAt,
        failureAt,
      })),
    ),
  )(
    `keeps $subscribeAt subscriptions isolated through $failureAt failure and restart`,
    async ({ subscribeAt, failureAt }) => {
      const parents = createControlledCollection(`subscription-parent`, [
        { id: 1, groupId: 1 },
      ])
      const children = createControlledCollection(`subscription-child`, [
        { id: 10, groupId: 1 },
        { id: 20, groupId: 2 },
      ])
      const observers: Array<{
        rows: Set<number>
        batches: Array<Array<string>>
        view: Pick<typeof children.collection, `toArray` | `subscribeChanges`>
      }> = []
      const releases: Array<() => void> = []
      const observe = (view: (typeof observers)[number][`view`]) => {
        const rows = new Set<number>()
        const batches: Array<Array<string>> = []
        const subscription = view.subscribeChanges(
          (changes) => {
            batches.push(
              changes.map((change) => `${change.type}:${change.value.id}`),
            )
            for (const change of changes) {
              if (change.type === `delete`) rows.delete(change.value.id)
              else rows.add(change.value.id)
            }
          },
          { includeInitialState: true },
        )
        releases.push(() => subscription.unsubscribe())
        observers.push({ rows, batches, view })
      }
      const failure = new Error(`projection subscription ${failureAt} failure`)
      let failing = false
      let flushReached = false
      const originalFlush = BucketFacadeAdapter.prototype.flush
      // Fail after actual facade writes, before any deferred public events.
      // An event-listener throw is asynchronous and would not test rollback.
      const flush =
        failureAt === `flush`
          ? vi
              .spyOn(BucketFacadeAdapter.prototype, `flush`)
              .mockImplementation(function (this: BucketFacadeAdapter) {
                const publication = originalFlush.call(this)
                return {
                  ...publication,
                  prepare: () => {
                    publication.prepare()
                    if (failing) {
                      flushReached = true
                      throw failure
                    }
                  },
                }
              })
          : undefined
      const query = createLiveQueryCollection((q) => {
        const projected = q
          .from({ parent: parents.collection })
          .fn.select(({ parent }) => {
            if (failing && failureAt === `callback`) throw failure
            return parent
          })
        return q.from({ row: projected }).select(({ row }) => ({
          id: row.id,
          groupId: row.groupId,
          children: include(
            q
              .from({ child: children.collection })
              .where(({ child }) => eq(child.groupId, row.groupId)),
          ),
        }))
      })
      if (subscribeAt === `publication`) {
        const rootSubscription = query.subscribeChanges(
          (changes) => {
            for (const change of changes)
              if (change.type !== `delete`) observe(change.value.children)
          },
          { includeInitialState: true },
        )
        releases.push(() => rootSubscription.unsubscribe())
      }
      const ids = (observer: (typeof observers)[number]) =>
        [...observer.rows].sort((a, b) => a - b)
      let primaryFailure: unknown = noPrimaryFailure
      try {
        await query.preload()
        if (subscribeAt === `after-preload`) observe(query.get(1)!.children)
        const first = observers[0]!
        expect(ids(first), `initial subscription snapshot`).toEqual([10])
        children.write(`insert`, { id: 11, groupId: 1 })
        expect(ids(first), `initial live insert`).toEqual([10, 11])
        const originalRow = query.get(1)
        const beforeFailure = first.batches.length
        failing = failureAt !== `none`
        const move = () => parents.write(`update`, { id: 1, groupId: 2 })
        if (failing) {
          let thrown: unknown
          try {
            move()
          } catch (error) {
            thrown = error
          }
          expect(thrown).toBe(failure)
          expect(query.get(1), `root rollback`).toBe(originalRow)
          expect(ids(first), `old subscriber rollback`).toEqual([10, 11])
          expect(first.batches.length, `no partial public events`).toBe(
            beforeFailure,
          )
          expect(observers).toHaveLength(1)
          if (failureAt === `flush`) expect(flushReached).toBe(true)
        } else {
          move()
          if (subscribeAt === `after-preload`) observe(query.get(1)!.children)
          expect(ids(first), `retired route`).toEqual([])
          expect(ids(observers[1]!), `destination subscription`).toEqual([20])
        }

        // Keep the external subscriptions alive across cleanup. They belong to
        // the old graph, not the next graph created by preload on this query.
        await query.cleanup()
        const oldObservers = [...observers]
        const oldBatches = oldObservers.map(
          (observer) => observer.batches.length,
        )
        failing = false
        await query.preload()
        if (subscribeAt === `after-preload`) observe(query.get(1)!.children)
        expect(observers).toHaveLength(oldObservers.length + 1)
        expect(query.get(1)!.groupId, `restart uses current source`).toBe(2)
        const restarted = observers.at(-1)!
        expect(ids(restarted), `restart subscription snapshot`).toEqual([20])
        children.write(`insert`, { id: 22, groupId: 2 })
        expect(ids(restarted), `restart live insert`).toEqual([20, 22])
        expect(
          oldObservers.map((observer) => observer.batches.length),
          `old graph receives no fresh events`,
        ).toEqual(oldBatches)
        for (const observer of oldObservers) {
          expect(
            observer.view.toArray,
            `old graph exposes no fresh rows`,
          ).toEqual([])
        }
      } catch (error) {
        primaryFailure = error
        throw error
      } finally {
        failing = false
        await cleanupAfterOracle(primaryFailure, [
          () => flush?.mockRestore(),
          ...releases,
          () => query.cleanup(),
          () => parents.collection.cleanup(),
          () => children.collection.cleanup(),
        ])
      }
    },
  )

  const readSurfaces = [
    `toArray`,
    `get`,
    `has`,
    `size`,
    `keys`,
    `values`,
    `entries`,
    `iterator`,
    `forEach`,
    `map`,
    `state`,
    `virtual-key`,
    `virtual-metadata`,
    `index`,
  ] as const

  it.each(
    readSurfaces.flatMap((surface) =>
      [false, true].map((ordered) => ({ surface, ordered })),
    ),
  )(
    `keeps published $surface reads live (ordered=$ordered)`,
    async ({ surface, ordered }) => {
      const parents = createControlledCollection(`read-api-parent`, [
        { id: 1, groupId: 1 },
      ])
      const children = createControlledCollection(`read-api-child`, [
        { id: 10, groupId: 1 },
        { id: 11, groupId: 1 },
        { id: 20, groupId: 2 },
        { id: 21, groupId: 2 },
      ])
      const readers = new Map<
        number,
        (keys: Array<number>) => Array<number | string>
      >()
      const retainedIndexReaders = new Map<
        number,
        (keys: Array<number>) => Array<number | string>
      >()
      const query = createLiveQueryCollection((q) =>
        q
          .from({
            row: q.from({ parent: parents.collection }).select(({ parent }) => {
              const childQuery = q
                .from({ child: children.collection })
                .where(({ child }) => eq(child.groupId, parent.groupId))
              return {
                id: parent.id,
                groupId: parent.groupId,
                children: include(
                  ordered
                    ? childQuery.orderBy(({ child }) => child.id, `desc`)
                    : childQuery,
                ),
              }
            }),
          })
          .select(({ row }) => row),
      )
      const capture = (row: NonNullable<ReturnType<typeof query.get>>) => {
        const view = row.children
        const expectedKeys = [row.groupId * 10, row.groupId * 10 + 1]
        const createIndex = view.createIndex.bind(view)
        if (surface === `index`) {
          const retainedIndex = createIndex((child) => child.id, {
            indexType: BasicIndex,
          })
          retainedIndexReaders.set(row.groupId, (keys) =>
            keys.flatMap((key) => [...retainedIndex.lookup(`eq`, key)]),
          )
        }
        const read = (keys: Array<number>) => {
          let ids: Array<number | string>
          switch (surface) {
            case `toArray`:
              ids = view.toArray.map((child) => child.id)
              break
            case `get`:
              ids = keys.flatMap((key) => view.get(key)?.id ?? [])
              break
            case `has`:
              ids = keys.filter((key) => view.has(key))
              break
            case `size`:
              ids = [view.size]
              break
            case `keys`:
              ids = [...view.keys()]
              break
            case `values`:
              ids = [...view.values()].map((child) => child.id)
              break
            case `entries`:
              ids = [...view.entries()].map(([key]) => key)
              break
            case `iterator`:
              ids = [...view].map(([key]) => key)
              break
            case `forEach`:
              ids = []
              view.forEach((child) => ids.push(child.id))
              break
            case `map`:
              ids = view.map((child) => child.id)
              break
            case `state`:
              ids = [...view.state.keys()]
              break
            case `virtual-key`:
              ids = view.toArray.map((child) => child.$key)
              break
            case `virtual-metadata`:
              ids = view.toArray.map((child) => {
                expect(child.$collectionId).toBe(children.collection.id)
                expect(child.$synced).toBe(true)
                expect(child.$origin).toBe(`remote`)
                return child.id
              })
              break
            case `index`: {
              const index = createIndex((child) => child.id, {
                indexType: BasicIndex,
              })
              ids = keys.flatMap((key) => [...index.lookup(`eq`, key)])
              break
            }
          }
          return ids
        }
        readers.set(row.groupId, read)
        const ids = read(expectedKeys)
        return { id: row.id, ids, children: view }
      }
      const expected = (group: number) => {
        if (surface === `size`) return [2]
        const ids = [group * 10, group * 10 + 1]
        return ordered && ![`get`, `has`, `index`].includes(surface)
          ? ids.reverse()
          : ids
      }
      const checkPublished = (
        group: number,
        ids: Array<number>,
        phase: string,
      ) => {
        const actual = readers.get(group)!([
          group * 10,
          group * 10 + 1,
          group * 10 + 2,
        ])
        const result =
          surface === `size`
            ? [ids.length]
            : ordered && ![`get`, `has`, `index`].includes(surface)
              ? [...ids].reverse()
              : ids
        expect.soft(actual, phase).toEqual(result)
        if (surface === `index`) {
          const readRetained = retainedIndexReaders.get(group)
          expect(readRetained, `${phase}: retained index reader`).toBeDefined()
          expect
            .soft(
              readRetained!([group * 10, group * 10 + 1, group * 10 + 2]),
              `${phase}: retained index`,
            )
            .toEqual(result)
        }
      }
      let primaryFailure: unknown = noPrimaryFailure
      try {
        await query.preload()
        const initialRead = capture(query.get(1)!)
        checkPublished(1, [10, 11], `initial published read`)
        expect
          .soft(initialRead.ids, `initial published input`)
          .toEqual(expected(1))
        parents.write(`update`, { id: 1, groupId: 2 })
        const movedRead = capture(query.get(1)!)
        expect.soft(movedRead.ids, `moved published input`).toEqual(expected(2))
        checkPublished(1, [], `retired route read`)
        checkPublished(2, [20, 21], `moved published read`)
        const held = query.get(1)!.children
        children.write(`insert`, { id: 22, groupId: 2 })
        expect(held.toArray.map((child) => child.id)).toEqual(
          ordered ? [22, 21, 20] : [20, 21, 22],
        )
        checkPublished(1, [], `retired route ignores later insert`)
        checkPublished(2, [20, 21, 22], `published insertion read`)
        children.write(`delete`, { id: 21, groupId: 2 })
        checkPublished(2, [20, 22], `published deletion read`)
      } catch (error) {
        primaryFailure = error
        throw error
      } finally {
        await cleanupAfterOracle(primaryFailure, [
          () => query.cleanup(),
          () => parents.collection.cleanup(),
          () => children.collection.cleanup(),
        ])
      }
    },
  )

  it.each([`expression`, `plain`, `opaque`, `closure`] as const)(
    `keeps retained views live across a same-route parent update through a %s holder`,
    async (holder) => {
      const parents = createControlledCollection(`facade-identity-parent`, [
        { id: 1, groupId: 1, label: `first` },
        { id: 2, groupId: 1, label: `second` },
      ])
      const childSource = createControlledCollection(`facade-identity-child`, [
        { id: 10, groupId: 1 },
      ])
      class Holder<T> {
        constructor(readonly children: T) {}
      }
      const query = createLiveQueryCollection((q) => {
        const source = q.from({
          row: q.from({ parent: parents.collection }).select(({ parent }) => ({
            id: parent.id,
            label: parent.label,
            children: include(
              q
                .from({ child: childSource.collection })
                .where(({ child }) => eq(child.groupId, parent.groupId)),
            ),
          })),
        })
        return source.select(({ row }) => ({
          id: row.id,
          label: row.label,
          box: { children: row.children },
        }))
      })
      let primaryFailure: unknown = noPrimaryFailure
      try {
        await query.preload()
        const childrenAtPublication = query.get(1)!.box.children
        const retained =
          holder === `opaque`
            ? new Holder(childrenAtPublication)
            : holder === `closure`
              ? {
                  get children() {
                    return childrenAtPublication
                  },
                }
              : { children: childrenAtPublication }
        const held = retained.children
        expect
          .soft(
            held.toArray.map((child) => child.id),
            `initial rows`,
          )
          .toEqual([10])
        expect
          .soft(query.get(2)!.box.children, `initial shared identity`)
          .toBe(held)
        parents.write(`update`, { id: 1, groupId: 1, label: `changed` })
        expect
          .soft(query.get(1)!.label, `parent update is visible`)
          .toBe(`changed`)
        expect(query.get(1)!.box.children).toBe(held)
        expect
          .soft(
            query.get(2)!.box.children,
            `unchanged parent keeps shared facade`,
          )
          .toBe(held)
        childSource.write(`insert`, { id: 11, groupId: 1 })
        for (const facade of [
          held,
          query.get(1)!.box.children,
          query.get(2)!.box.children,
        ]) {
          expect
            .soft(
              facade.toArray.map((child) => child.id).sort(),
              `retained view stays live`,
            )
            .toEqual([10, 11])
        }
      } catch (error) {
        primaryFailure = error
        throw error
      } finally {
        await cleanupAfterOracle(primaryFailure, [
          () => query.cleanup(),
          () => parents.collection.cleanup(),
          () => childSource.collection.cleanup(),
        ])
      }
    },
  )

  it.each([`rows`, `index`, `callback-read`, `captured-method`] as const)(
    `keeps held facade %s unchanged when a parent projection throws`,
    async (surface) => {
      const parents = createControlledCollection(`snapshot-parent`, [
        { id: 1, groupId: 1 },
      ])
      const children = createControlledCollection(`snapshot-child`, [
        { id: 10, groupId: 1 },
        { id: 20, groupId: 2 },
      ])
      const failure = new Error(`parent projection failed`)
      let fail = false
      let readPublished: (() => Array<number>) | undefined
      let capturedGet: ((key: number) => { id: number } | undefined) | undefined
      let observed: Array<number> | undefined
      const query = createLiveQueryCollection((q) => {
        const projected = q
          .from({ parent: parents.collection })
          .fn.select(({ parent }) => {
            if (fail) {
              observed = readPublished?.()
              throw failure
            }
            return parent
          })
        return q.from({ row: projected }).select(({ row }) => ({
          id: row.id,
          children: include(
            q
              .from({ child: children.collection })
              .where(({ child }) => eq(child.groupId, row.groupId)),
          ),
        }))
      })
      let primaryFailure: unknown = noPrimaryFailure
      try {
        await query.preload()
        const original = query.get(1)!
        const held = original.children
        capturedGet = held.get.bind(held)
        readPublished = () =>
          surface === `captured-method`
            ? [capturedGet?.(10)?.id].filter((id) => id !== undefined)
            : held.toArray.map((child) => child.id)
        const index = held.createIndex((child) => child.id, {
          indexType: BasicIndex,
        })
        expect(held.toArray.map((child) => child.id)).toEqual([10])
        expect(index.lookup(`eq`, 10)).toEqual(new Set([10]))
        fail = true
        expect(() => parents.write(`update`, { id: 1, groupId: 2 })).toThrow(
          failure,
        )
        expect(query.get(1)).toBe(original)
        if (surface === `rows`) {
          expect(held.toArray.map((child) => child.id)).toEqual([10])
        } else if (surface === `index`) {
          expect(index.lookup(`eq`, 10)).toEqual(new Set([10]))
          expect(index.lookup(`eq`, 20)).toEqual(new Set())
        } else {
          expect(observed).toEqual([10])
          if (surface === `captured-method`)
            expect(capturedGet(20)).toBeUndefined()
        }
      } catch (error) {
        primaryFailure = error
        throw error
      } finally {
        await cleanupAfterOracle(primaryFailure, [
          () => query.cleanup(),
          () => parents.collection.cleanup(),
          () => children.collection.cleanup(),
        ])
      }
    },
  )

  it.each([false, true])(
    `preserves projection through public-facade changes and parent restoration (reads=%s)`,
    async (readsFacade) => {
      const parents = createControlledCollection(`published-parent`, [
        { id: 1 },
      ])
      const children = createControlledCollection(`published-child`, [
        { id: 10, parentId: 1 },
      ])
      const source = createLiveQueryCollection((q) =>
        q.from({ parent: parents.collection }).select(({ parent }) => ({
          id: parent.id,
          children: include(
            q
              .from({ child: children.collection })
              .where(({ child }) => eq(child.parentId, parent.id)),
          ),
        })),
      )
      const projected = createLiveQueryCollection((q) =>
        q
          .from({ row: source })
          .fn.select(({ row }) => {
            const count = readsFacade
              ? readChildren(row.children, `collection`).rows.length
              : 1
            return { id: row.id, count }
          })
          .distinct(),
      )
      const rows = () =>
        projected.toArray.map(({ id, count }) => ({ id, count }))
      let primaryFailure: unknown = noPrimaryFailure
      try {
        await source.preload()
        await projected.preload()
        expect(rows()).toEqual([{ id: 1, count: 1 }])
        children.write(`insert`, { id: 11, parentId: 1 })
        expect(
          readChildren(source.toArray[0]?.children, `collection`).rows,
        ).toHaveLength(2)
        // A stable facade does not make its scalar reads child dependencies.
        expect(rows()).toEqual([{ id: 1, count: 1 }])
        parents.write(`delete`, { id: 1 })
        expect(rows()).toEqual([])
        children.write(`delete`, { id: 11, parentId: 1 })
        parents.write(`insert`, { id: 1 })
        expect(rows()).toEqual([{ id: 1, count: 1 }])
      } catch (error) {
        primaryFailure = error
        throw error
      } finally {
        await cleanupAfterOracle(primaryFailure, [
          () => projected.cleanup(),
          () => source.cleanup(),
          () => parents.collection.cleanup(),
          () => children.collection.cleanup(),
        ])
      }
    },
  )

  it.each(valueCells)(
    `$form / $consumer / $shape / include=$withInclude preserves arbitrary output`,
    async ({ form, consumer, shape, withInclude }) => {
      const parents = createControlledCollection(`output-parent`, [
        { id: 1, value: 2 },
      ])
      const children = createControlledCollection(`output-child`, [
        { id: 10, parentId: 1 },
      ])
      let expectedValue = 2
      const assertValue = (value: unknown, expected?: number) => {
        switch (shape) {
          case `number`:
            expect.soft(typeof value).toBe(`number`)
            if (expected !== undefined) expect.soft(value).toBe(expected)
            break
          case `null`:
            expect.soft(value).toBeNull()
            break
          case `date`:
            expect.soft(value instanceof Date).toBe(true)
            if (expected !== undefined && value instanceof Date)
              expect.soft(value.getTime()).toBe(expected * 1000)
            break
          case `dropped-record`:
            expect.soft(value !== null && typeof value === `object`).toBe(true)
            if (value !== null && typeof value === `object`) {
              // Virtual properties are public metadata. Check the selected field
              // and forbid leaked input fields without imposing a new metadata
              // contract on virtual properties.
              expect
                .soft(Object.keys(value).filter((key) => !key.startsWith(`$`)))
                .toEqual([`code`])
              expect.soft(`children` in value || `row` in value).toBe(false)
              expect.soft(`code` in value).toBe(true)
              if (expected !== undefined && `code` in value)
                expect.soft(value.code).toBe(expected)
            }
        }
      }
      const buildQuery = () =>
        createLiveQueryCollection((q) => {
          const source = q
            .from({ parent: parents.collection })
            .select(({ parent }) => {
              const childRows = q
                .from({ child: children.collection })
                .where(({ child }) => eq(child.parentId, parent.id))
              return {
                id: parent.id,
                value: parent.value,
                ...(withInclude
                  ? {
                      children:
                        form === `collection`
                          ? include(childRows)
                          : form === `array`
                            ? toArray(childRows)
                            : materialize(childRows),
                    }
                  : {}),
              }
            })
          const projected = q.from({ row: source }).fn.select(({ row }) => {
            switch (shape) {
              case `number`:
                return row.value
              case `null`:
                return null
              case `date`:
                return new Date(row.value * 1000)
              case `dropped-record`:
                return { code: row.value }
            }
          })
          const outer = q.from({ result: projected })
          return consumer === `expression`
            ? outer.select(({ result }) => ({ value: result }))
            : outer.fn.select(({ result }) => {
                // Observe the value on entry, including retract callbacks. Those
                // may carry an earlier value, but must still have its proper type.
                assertValue(result)
                return { value: result }
              })
        })
      if (rejectsCollectionInput(form, withInclude)) {
        let primaryFailure: unknown = noPrimaryFailure
        try {
          expect(buildQuery).toThrow(collectionInputError)
        } catch (error) {
          primaryFailure = error
          throw error
        } finally {
          await cleanupAfterOracle(primaryFailure, [
            () => parents.collection.cleanup(),
            () => children.collection.cleanup(),
          ])
        }
        return
      }
      const live = buildQuery()
      const check = () => {
        expect.soft(live.toArray).toHaveLength(1)
        assertValue(live.toArray[0]?.value, expectedValue)
      }
      let primaryFailure: unknown = noPrimaryFailure
      try {
        await live.preload()
        check()
        children.write(`insert`, { id: 11, parentId: 1 })
        check()
        expectedValue = 4
        parents.write(`update`, { id: 1, value: expectedValue })
        check()
        parents.write(`delete`, { id: 1, value: expectedValue })
        expect.soft(live.toArray).toEqual([])
      } catch (error) {
        primaryFailure = error
        throw error
      } finally {
        await cleanupAfterOracle(primaryFailure, [
          () => live.cleanup(),
          () => parents.collection.cleanup(),
          () => children.collection.cleanup(),
        ])
      }
    },
  )
})

describe(`functional include projection boundary grammar`, () => {
  it(`preserves a scalar result when a functional projection drops its include`, async () => {
    const parents = createControlledCollection(`scalar-projection-parent`, [
      { id: 1 },
    ])
    const children = createControlledCollection(`scalar-projection-child`, [
      { id: 10, parentId: 1 },
    ])
    const live = createLiveQueryCollection((q) => {
      const included = q
        .from({ parent: parents.collection })
        .select(({ parent }) => ({
          id: parent.id,
          children: toArray(
            q
              .from({ child: children.collection })
              .where(({ child }) => eq(child.parentId, parent.id)),
          ),
        }))
      const scalar = q.from({ row: included }).fn.select(({ row }) => row.id)
      return q
        .from({ result: scalar })
        .select(({ result }) => ({ value: result }))
    })
    let primaryFailure: unknown = noPrimaryFailure
    try {
      await live.preload()
      expect(live.toArray.map((row) => row.value)).toEqual([1])
    } catch (error) {
      primaryFailure = error
      throw error
    } finally {
      await cleanupAfterOracle(primaryFailure, [
        () => live.cleanup(),
        () => parents.collection.cleanup(),
        () => children.collection.cleanup(),
      ])
    }
  })

  it(`preserves opaque-root fields without include materialization`, async () => {
    const parents = createControlledCollection(`opaque-root-control`, [
      { id: 1 },
    ])
    const live = createLiveQueryCollection((q) =>
      q
        .from({ parent: parents.collection })
        .fn.select(
          ({ parent }) => new Projection(parent.id, `plain`, undefined, 0),
        ),
    )
    let primaryFailure: unknown = noPrimaryFailure
    try {
      await live.preload()
      expect(live.toArray).toHaveLength(1)
      const row = live.toArray[0]
      expect(row?.id).toBe(1)
      expect(row?.kind).toBe(`plain`)
      expect(row?.total).toBe(0)
      // Collection root records already flatten prototypes without includes.
      // This matrix checks their fields, not a new prototype-preservation API.
    } catch (error) {
      primaryFailure = error
      throw error
    } finally {
      await cleanupAfterOracle(primaryFailure, [
        () => live.cleanup(),
        () => parents.collection.cleanup(),
      ])
    }
  })
})

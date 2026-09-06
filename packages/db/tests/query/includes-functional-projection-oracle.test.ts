import { describe, expect, it, vi } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { createDeferred } from '../../src/deferred.js'
import { BasicIndex } from '../../src/indexes/basic-index.js'
import { BucketFacadeAdapter } from '../../src/query/live/bucket-facade-adapter.js'
import {
  createLiveQueryCollection,
  eq,
  materialize,
  toArray,
} from '../../src/query/index.js'
import { flushPromises } from '../utils.js'
import { createControlledCollection } from './includes-oracle-helpers.js'

const boundaries = [`query-ref`, `recursive-query-ref`, `union`] as const
const forms = [`collection`, `array`, `materialized`] as const
const outputs = [`expression`, `record`, `opaque-root`] as const
const initialStates = [`empty`, `populated`] as const
const cells = boundaries.flatMap((boundary) =>
  forms.flatMap((form) =>
    outputs.flatMap((output) =>
      initialStates.map((initial) => ({ boundary, form, output, initial })),
    ),
  ),
)
const consumers = [`expression`, `functional`] as const
const valueShapes = [`number`, `null`, `date`, `dropped-record`] as const
const valueCells = forms.flatMap((form) =>
  consumers.flatMap((consumer) =>
    valueShapes.flatMap((shape) =>
      [false, true].map((withInclude) => ({
        form,
        consumer,
        shape,
        withInclude,
      })),
    ),
  ),
)
const renamedCells = forms.flatMap((form) =>
  consumers.flatMap((consumer) =>
    consumers.flatMap((projection) =>
      [false, true].map((withSibling) => ({
        form,
        consumer,
        projection,
        withSibling,
      })),
    ),
  ),
)
const operatorCells = forms.flatMap((form) =>
  ([`custom-key`, `selected-order`, `distinct`] as const).flatMap((operator) =>
    [false, true].map((readsInclude) => ({ form, operator, readsInclude })),
  ),
)

type Child = { id: number; parentGroup: number; value: number }
type Input = { id: number; kind: string; children?: unknown }
type Phase = `initial` | `child-update` | `sibling-update` | `route-move`
type ChildView = {
  valid: boolean
  ready: boolean | undefined
  rows: Array<Child>
}

function readChildren(value: unknown, form: (typeof forms)[number]): ChildView {
  if (form !== `collection`) {
    return {
      valid: Array.isArray(value),
      ready: undefined,
      rows: Array.isArray(value) ? value : [],
    }
  }
  if (
    typeof value !== `object` ||
    value === null ||
    !(`toArray` in value) ||
    !(`isReady` in value) ||
    typeof value.isReady !== `function`
  ) {
    return { valid: false, ready: undefined, rows: [] }
  }
  return {
    valid: Array.isArray(value.toArray),
    ready: value.isReady(),
    rows: Array.isArray(value.toArray) ? value.toArray : [],
  }
}

// Keep only the selected public fields in row comparisons. Callback-time shape
// and facade readiness have their own assertions rather than being normalized away.
function publicRows(rows: ReadonlyArray<Child>) {
  return rows
    .map(({ id, parentGroup, value }) => ({ id, parentGroup, value }))
    .sort((left, right) => left.id - right.id)
}

class Projection {
  constructor(
    readonly id: number,
    readonly kind: string,
    readonly children: unknown,
    readonly total: number,
  ) {}
}

describe(`functional projection output compatibility`, () => {
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
      const query = createLiveQueryCollection((q) => {
        const source = q.from({
          row: q.from({ parent: parents.collection }).select(({ parent }) => ({
            id: parent.id,
            children: q
              .from({ child: children })
              .where(({ child }) => eq(child.groupId, parent.groupId)),
          })),
        })
        return projection === `expression`
          ? source.select(({ row }) => row)
          : source.fn.select(({ row }) => {
              captured.push(row.children)
              return { id: row.id, children: row.children }
            })
      })
      const failure = new Error(`pending child failed`)
      // Attach both outcomes immediately; no pending-length assertion may
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
      } finally {
        await query.cleanup()
        for (const { gate } of requests) gate.resolve()
        await children.cleanup()
        await parents.collection.cleanup()
      }
    },
  )

  it.each(
    ([`draft`, `published`] as const).flatMap((subscribeAt) =>
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
      const query = createLiveQueryCollection((q) =>
        q
          .from({
            row: q
              .from({ parent: parents.collection })
              .select(({ parent }) => ({
                id: parent.id,
                groupId: parent.groupId,
                children: q
                  .from({ child: children.collection })
                  .where(({ child }) => eq(child.groupId, parent.groupId)),
              })),
          })
          .fn.select(({ row }) => {
            if (subscribeAt === `draft`) observe(row.children)
            if (failing && failureAt === `callback`) throw failure
            return { id: row.id, groupId: row.groupId, children: row.children }
          }),
      )
      const ids = (observer: (typeof observers)[number]) =>
        [...observer.rows].sort((a, b) => a - b)
      try {
        await query.preload()
        if (subscribeAt === `published`) observe(query.get(1)!.children)
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
          if (subscribeAt === `draft`) {
            expect(observers).toHaveLength(2)
            expect(
              ids(observers[1]!),
              `failed subscriber sees no private rows`,
            ).toEqual([])
            expect(
              observers[1]!.batches.flat(),
              `no transient private changes`,
            ).toEqual([])
          }
          if (failureAt === `flush`) expect(flushReached).toBe(true)
        } else {
          move()
          if (subscribeAt === `published`) observe(query.get(1)!.children)
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
        if (subscribeAt === `published`) observe(query.get(1)!.children)
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
      } finally {
        failing = false
        flush?.mockRestore()
        for (const release of releases) release()
        await query.cleanup()
        await parents.collection.cleanup()
        await children.collection.cleanup()
      }
    },
  )

  const draftIndexError = `createIndex() cannot run on a temporary Collection inside fn.select(). Create the index on the published child Collection instead.`
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
    `index`,
  ] as const
  it.each(
    readSurfaces.flatMap((surface) =>
      [false, true].map((ordered) => ({ surface, ordered })),
    ),
  )(
    `enforces the $surface read boundary for projection inputs (ordered=$ordered)`,
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
        (keys: Array<number>, draft?: boolean) => Array<number | string>
      >()
      let checkPublishedIndex: (() => void) | undefined
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
                children: ordered
                  ? childQuery.orderBy(({ child }) => child.id, `desc`)
                  : childQuery,
              }
            }),
          })
          .fn.select(({ row }) => {
            const view = row.children
            const expectedKeys = [row.groupId * 10, row.groupId * 10 + 1]
            const createIndex = view.createIndex.bind(view)
            const read = (keys: Array<number>, draft = false) => {
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
                case `index`: {
                  // Capturing the method is safe. Calling it on private input is not.
                  if (!draft) {
                    const index = createIndex((child) => child.id, {
                      indexType: BasicIndex,
                    })
                    return keys.flatMap((key) => [...index.lookup(`eq`, key)])
                  }
                  expect(() =>
                    createIndex((child) => child.id, {
                      indexType: BasicIndex,
                    }),
                  ).toThrow(new Error(draftIndexError))
                  expect(view.indexes.size).toBe(0)
                  checkPublishedIndex = () => {
                    const index = createIndex((child) => child.id, {
                      indexType: BasicIndex,
                    })
                    for (const key of expectedKeys)
                      expect(index.lookup(`eq`, key)).toEqual(new Set([key]))
                    expect(index.lookup(`eq`, 22)).toEqual(new Set([22]))
                  }
                  ids = keys.flatMap((key) => view.get(key)?.id ?? [])
                  break
                }
              }
              return ids
            }
            readers.set(row.groupId, read)
            const ids = read(expectedKeys, true)
            return { id: row.id, ids, children: view }
          }),
      )
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
      }
      try {
        await query.preload()
        checkPublished(1, [10, 11], `initial published read`)
        expect
          .soft(query.get(1)!.ids, `initial callback input`)
          .toEqual(expected(1))
        parents.write(`update`, { id: 1, groupId: 2 })
        expect
          .soft(query.get(1)!.ids, `moved callback input`)
          .toEqual(expected(2))
        checkPublished(1, [], `retired route read`)
        checkPublished(2, [20, 21], `moved published read`)
        const held = query.get(1)!.children
        children.write(`insert`, { id: 22, groupId: 2 })
        expect(held.toArray.map((child) => child.id)).toEqual(
          ordered ? [22, 21, 20] : [20, 21, 22],
        )
        checkPublishedIndex?.()
        checkPublished(1, [], `retired route ignores later insert`)
        checkPublished(2, [20, 21, 22], `published insertion read`)
        children.write(`delete`, { id: 21, groupId: 2 })
        checkPublished(2, [20, 22], `published deletion read`)
      } finally {
        await query.cleanup()
        await parents.collection.cleanup()
        await children.collection.cleanup()
      }
    },
  )

  it.each([`initial`, `update`] as const)(
    `reports uncaught draft index creation during %s without publishing partial rows`,
    async (phase) => {
      const parents = createControlledCollection(`index-guard-parent`, [
        { id: 1, revision: 0 },
      ])
      const children = createControlledCollection(`index-guard-child`, [
        { id: 10, parentId: 1 },
      ])
      let rejectIndex = phase === `initial`
      const query = createLiveQueryCollection((q) =>
        q
          .from({
            row: q
              .from({ parent: parents.collection })
              .select(({ parent }) => ({
                id: parent.id,
                revision: parent.revision,
                children: q
                  .from({ child: children.collection })
                  .where(({ child }) => eq(child.parentId, parent.id)),
              })),
          })
          .fn.select(({ row }) => {
            if (rejectIndex)
              row.children.createIndex((child) => child.id, {
                indexType: BasicIndex,
              })
            return row
          }),
      )
      try {
        if (phase === `initial`) {
          await expect(query.preload()).rejects.toThrow(
            new Error(draftIndexError),
          )
          expect(query.size).toBe(0)
        } else {
          await query.preload()
          const original = query.get(1)!
          const index = original.children.createIndex((child) => child.id, {
            indexType: BasicIndex,
          })
          rejectIndex = true
          expect(() => parents.write(`update`, { id: 1, revision: 1 })).toThrow(
            new Error(draftIndexError),
          )
          expect(query.get(1)).toBe(original)
          expect(original.revision).toBe(0)
          expect(index.lookup(`eq`, 10)).toEqual(new Set([10]))
        }
      } finally {
        await query.cleanup()
        await parents.collection.cleanup()
        await children.collection.cleanup()
      }
    },
  )

  it.each([`expression`, `plain`, `opaque`, `closure`] as const)(
    `keeps retained views live across a same-route parent update through a %s holder`,
    async (holder) => {
      const parents = createControlledCollection(`draft-identity-parent`, [
        { id: 1, groupId: 1, label: `first` },
        { id: 2, groupId: 1, label: `second` },
      ])
      const childSource = createControlledCollection(`draft-identity-child`, [
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
            children: q
              .from({ child: childSource.collection })
              .where(({ child }) => eq(child.groupId, parent.groupId)),
          })),
        })
        if (holder === `expression`)
          return source.select(({ row }) => ({
            id: row.id,
            label: row.label,
            box: { children: row.children },
          }))
        return source.fn.select(({ row }) => {
          const captured = row.children
          return {
            id: row.id,
            label: row.label,
            box:
              holder === `plain`
                ? { children: row.children }
                : holder === `opaque`
                  ? new Holder(row.children)
                  : {
                      get children() {
                        return captured
                      },
                    },
          }
        })
      })
      try {
        await query.preload()
        const held = query.get(1)!.box.children
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
        // Expression projections share the public facade. Separate functional
        // calls may return distinct views, but every retained view stays live.
        if (holder === `expression`) {
          expect
            .soft(query.get(1)!.box.children, `shared public facade`)
            .toBe(held)
        }
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
      } finally {
        await query.cleanup()
        await parents.collection.cleanup()
        await childSource.collection.cleanup()
      }
    },
  )

  it.each([`rows`, `index`, `callback-read`, `captured-method`] as const)(
    `keeps held facade %s unchanged when a later projection throws`,
    async (surface) => {
      const parents = createControlledCollection(`snapshot-parent`, [
        { id: 1, groupId: 1 },
      ])
      const children = createControlledCollection(`snapshot-child`, [
        { id: 10, groupId: 1 },
        { id: 20, groupId: 2 },
      ])
      const failure = new Error(`projection failed after draft preparation`)
      let fail = false
      let prepared: Array<number> = []
      let readPublished: (() => Array<number>) | undefined
      let capturedGet: ((key: number) => { id: number } | undefined) | undefined
      let observed: Array<number> | undefined
      const query = createLiveQueryCollection((q) =>
        q
          .from({
            row: q
              .from({ parent: parents.collection })
              .select(({ parent }) => ({
                id: parent.id,
                children: q
                  .from({ child: children.collection })
                  .where(({ child }) => eq(child.groupId, parent.groupId)),
              })),
          })
          .fn.select(({ row }) => {
            prepared = row.children.toArray.map((child) => child.id)
            if (fail) {
              observed = readPublished?.()
              throw failure
            }
            capturedGet = row.children.get.bind(row.children)
            return { id: row.id, children: row.children }
          }),
      )
      try {
        await query.preload()
        const original = query.get(1)!
        const held = original.children
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
        expect(prepared).toEqual([20])
        expect(query.get(1)).toBe(original)
        if (surface === `rows`) {
          expect(held.toArray.map((child) => child.id)).toEqual([10])
        } else if (surface === `index`) {
          expect(index.lookup(`eq`, 10)).toEqual(new Set([10]))
        } else {
          expect(observed).toEqual([10])
        }
      } finally {
        await query.cleanup()
        await parents.collection.cleanup()
        await children.collection.cleanup()
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
          children: q
            .from({ child: children.collection })
            .where(({ child }) => eq(child.parentId, parent.id)),
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
      } finally {
        await projected.cleanup()
        await source.cleanup()
        await parents.collection.cleanup()
        await children.collection.cleanup()
      }
    },
  )

  it(`covers the declared output and renamed-field products`, () => {
    expect(valueCells).toHaveLength(48)
    expect(renamedCells).toHaveLength(24)
    expect(operatorCells).toHaveLength(18)
    expect(new Set(valueCells.map((cell) => JSON.stringify(cell))).size).toBe(
      48,
    )
    expect(new Set(renamedCells.map((cell) => JSON.stringify(cell))).size).toBe(
      24,
    )
    expect(
      new Set(operatorCells.map((cell) => JSON.stringify(cell))).size,
    ).toBe(18)
  })

  it.each(operatorCells)(
    `$form / $operator / reads-include=$readsInclude consumes the projected value`,
    async ({ form, operator, readsInclude }) => {
      const parents = createControlledCollection(`operator-parent`, [
        { id: 1, group: 1, base: 3 },
        { id: 2, group: 2, base: 5 },
      ])
      const children = createControlledCollection(`operator-child`, [
        { id: 10, parentGroup: 1, value: 3 },
        { id: 20, parentGroup: 2, value: 5 },
      ])
      // This model stores the scalar computed on a parent projection. A live
      // Collection handle does not make its scalar reads child dependencies.
      const expectedScores = new Map([
        [1, 3],
        [2, 5],
      ])
      const observed: Array<ChildView> = []
      const live = createLiveQueryCollection({
        query: (q) => {
          const source = q
            .from({ parent: parents.collection })
            .select(({ parent }) => {
              const childRows = q
                .from({ child: children.collection })
                .where(({ child }) => eq(child.parentGroup, parent.group))
              return {
                id: parent.id,
                base: parent.base,
                children:
                  form === `collection`
                    ? childRows
                    : form === `array`
                      ? toArray(childRows)
                      : materialize(childRows),
              }
            })
          const projected = q.from({ row: source }).fn.select(({ row }) => {
            const view = readsInclude
              ? readChildren(row.children, form)
              : undefined
            if (view) observed.push({ ...view, rows: publicRows(view.rows) })
            return {
              id: operator === `distinct` ? 0 : row.id,
              score: view
                ? view.rows.reduce((sum, child) => sum + child.value, 0)
                : row.base,
            }
          })
          if (operator === `distinct`) return projected.distinct()
          if (operator === `selected-order`)
            return projected
              .orderBy(({ $selected }) => $selected.score, `desc`)
              .orderBy(({ $selected }) => $selected.id)
              .limit(1)
          return projected
        },
        getKey:
          operator === `custom-key` ? (row) => `result:${row.id}` : undefined,
      })
      const check = () => {
        let expected = [...expectedScores].map(([id, score]) => ({ id, score }))
        if (operator === `distinct`)
          expected = [...new Set(expected.map((row) => row.score))].map(
            (score) => ({ id: 0, score }),
          )
        if (operator === `selected-order`)
          expected = expected
            .sort(
              (left, right) => right.score - left.score || left.id - right.id,
            )
            .slice(0, 1)
        const sort = (rows: Array<{ id: number; score: number }>) =>
          rows.sort(
            (left, right) => left.id - right.id || left.score - right.score,
          )
        expect
          .soft(sort(live.toArray.map(({ id, score }) => ({ id, score }))))
          .toEqual(sort(expected))
        if (operator === `custom-key`)
          expect
            .soft([...live.keys()].sort())
            .toEqual(expected.map((row) => `result:${row.id}`).sort())
        for (const view of observed) {
          expect.soft(view.valid, `operator callback input form`).toBe(true)
          if (form === `collection`)
            expect
              .soft(view.ready, `operator callback input readiness`)
              .toBe(true)
        }
        observed.length = 0
      }
      try {
        await live.preload()
        check()
        if (readsInclude && form !== `collection`) expectedScores.set(1, 7)
        children.write(`update`, { id: 10, parentGroup: 1, value: 7 })
        check()
        expectedScores.set(1, 5)
        parents.write(`update`, { id: 1, group: 2, base: 5 })
        check()
        expectedScores.delete(1)
        parents.write(`delete`, { id: 1, group: 2, base: 5 })
        check()
      } finally {
        await live.cleanup()
        await parents.collection.cleanup()
        await children.collection.cleanup()
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
              // and forbid input paths without imposing a new metadata contract.
              expect.soft(`children` in value || `row` in value).toBe(false)
              expect.soft(`code` in value).toBe(true)
              if (expected !== undefined && `code` in value)
                expect.soft(value.code).toBe(expected)
            }
        }
      }
      const live = createLiveQueryCollection((q) => {
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
                        ? childRows
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
      const check = () => {
        expect.soft(live.toArray).toHaveLength(1)
        assertValue(live.toArray[0]?.value, expectedValue)
      }
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
      } finally {
        await live.cleanup()
        await parents.collection.cleanup()
        await children.collection.cleanup()
      }
    },
  )

  it.each(renamedCells)(
    `$form / $projection / $consumer / sibling=$withSibling materializes inputs before renaming them`,
    async ({ form, consumer, projection, withSibling }) => {
      const parents = createControlledCollection(`renamed-parent`, [
        { id: 1, group: 1, siblingGroup: 2 },
      ])
      const initial: Array<Child> = [
        { id: 10, parentGroup: 1, value: 3 },
        { id: 20, parentGroup: 2, value: 5 },
      ]
      const children = createControlledCollection(`renamed-child`, initial)
      const truth = new Map(initial.map((row) => [row.id, row]))
      let group = 1
      let phase: Phase = `initial`
      const calls: Array<{
        phase: Phase
        stage: `projection` | `consumer`
        primary: ChildView
        sibling?: ChildView
      }> = []
      const inspect = (
        stage: `projection` | `consumer`,
        primary: unknown,
        sibling: unknown,
      ) => {
        const view = readChildren(primary, form)
        const second = withSibling ? readChildren(sibling, form) : undefined
        calls.push({
          phase,
          stage,
          primary: { ...view, rows: publicRows(view.rows) },
          sibling: second && { ...second, rows: publicRows(second.rows) },
        })
        return (
          view.rows.reduce((sum, row) => sum + row.value, 0) +
          (second?.rows.reduce((sum, row) => sum + row.value, 0) ?? 0)
        )
      }
      const live = createLiveQueryCollection((q) => {
        const source = q
          .from({ parent: parents.collection })
          .select(({ parent }) => {
            const primary = q
              .from({ child: children.collection })
              .where(({ child }) => eq(child.parentGroup, parent.group))
            const sibling = q
              .from({ other: children.collection })
              .where(({ other }) => eq(other.parentGroup, parent.siblingGroup))
            return {
              id: parent.id,
              children:
                form === `collection`
                  ? primary
                  : form === `array`
                    ? toArray(primary)
                    : materialize(primary),
              ...(withSibling
                ? {
                    sibling:
                      form === `collection`
                        ? sibling
                        : form === `array`
                          ? toArray(sibling)
                          : materialize(sibling),
                  }
                : {}),
            }
          })
        const input = q.from({ row: source })
        const projected =
          projection === `expression`
            ? input.select(({ row }) => ({
                id: row.id,
                renamed: { primary: row.children, sibling: row.sibling },
                total: 0,
              }))
            : input.fn.select(({ row }) => ({
                id: row.id,
                renamed: { primary: row.children, sibling: row.sibling },
                total: inspect(`projection`, row.children, row.sibling),
              }))
        const outer = q.from({ result: projected })
        return consumer === `expression`
          ? outer.select(({ result }) => ({ value: result }))
          : outer.fn.select(({ result }) => ({
              value: {
                id: result.id,
                renamed: result.renamed,
                total: inspect(
                  `consumer`,
                  result.renamed.primary,
                  result.renamed.sibling,
                ),
              },
            }))
      })
      const check = () => {
        const row = live.toArray[0]?.value
        expect.soft(live.toArray, `${phase}: row count`).toHaveLength(1)
        expect.soft(row?.id, `${phase}: public id`).toBe(1)
        const expectedPrimary = publicRows(
          [...truth.values()].filter((child) => child.parentGroup === group),
        )
        const expectedSibling = withSibling
          ? publicRows(
              [...truth.values()].filter((child) => child.parentGroup === 2),
            )
          : []
        for (const [value, expected] of [
          [row?.renamed.primary, expectedPrimary],
          ...(withSibling
            ? [[row?.renamed.sibling, expectedSibling] as const]
            : []),
        ] as const) {
          const view = readChildren(value, form)
          expect.soft(view.valid, `${phase}: renamed public form`).toBe(true)
          expect
            .soft(publicRows(view.rows), `${phase}: renamed public rows`)
            .toEqual(expected)
          if (form === `collection`)
            expect
              .soft(view.ready, `${phase}: renamed public readiness`)
              .toBe(true)
        }
        if (row)
          expect
            .soft(
              `children` in row || `row` in row,
              `${phase}: input paths do not leak`,
            )
            .toBe(false)
        if (
          form !== `collection` ||
          phase === `initial` ||
          phase === `route-move`
        ) {
          if (projection === `functional` || consumer === `functional`)
            expect
              .soft(row?.total, `${phase}: derived total`)
              .toBe(
                [...expectedPrimary, ...expectedSibling].reduce(
                  (sum, child) => sum + child.value,
                  0,
                ),
              )
          for (const stage of [
            ...(projection === `functional` ? [`projection` as const] : []),
            ...(consumer === `functional` ? [`consumer` as const] : []),
          ]) {
            expect
              .soft(
                calls.filter(
                  (call) => call.phase === phase && call.stage === stage,
                ).length,
                `${phase}: ${stage} callback reach`,
              )
              .toBeGreaterThan(0)
          }
        }
        for (const call of calls.filter((item) => item.phase === phase)) {
          for (const view of [
            call.primary,
            ...(call.sibling ? [call.sibling] : []),
          ]) {
            expect.soft(view.valid, `${phase}: callback input form`).toBe(true)
            if (form === `collection`)
              expect
                .soft(view.ready, `${phase}: callback input readiness`)
                .toBe(true)
          }
        }
      }
      try {
        await live.preload()
        check()
        phase = `child-update`
        const changed = { id: 10, parentGroup: 1, value: 7 }
        truth.set(10, changed)
        children.write(`update`, changed)
        check()
        if (withSibling) {
          phase = `sibling-update`
          const sibling = { id: 20, parentGroup: 2, value: 11 }
          truth.set(20, sibling)
          children.write(`update`, sibling)
          check()
        }
        phase = `route-move`
        group = 2
        parents.write(`update`, { id: 1, group, siblingGroup: 2 })
        check()
      } finally {
        await live.cleanup()
        await parents.collection.cleanup()
        await children.collection.cleanup()
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
    try {
      await live.preload()
      expect(live.toArray.map((row) => row.value)).toEqual([1])
    } finally {
      await live.cleanup()
      await parents.collection.cleanup()
      await children.collection.cleanup()
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
    try {
      await live.preload()
      const row = live.toArray[0]
      expect(row?.id).toBe(1)
      expect(row?.kind).toBe(`plain`)
      expect(row?.total).toBe(0)
      // Collection root records already flatten prototypes without includes.
      // This matrix checks their fields, not a new prototype-preservation API.
    } finally {
      await live.cleanup()
      await parents.collection.cleanup()
    }
  })

  it(`covers every declared boundary product without duplicate cells`, () => {
    expect(cells).toHaveLength(54)
    expect(new Set(cells.map((cell) => JSON.stringify(cell))).size).toBe(54)
  })

  it.each(cells)(
    `$boundary / $form / $output / $initial`,
    async ({ boundary, form, output, initial }) => {
      const parents = createControlledCollection(`projection-parents`, [
        { id: 1, group: 1 },
      ])
      const absent = createControlledCollection(`projection-absent`, [
        { id: 2 },
      ])
      const initialChildren: Array<Child> = [
        ...(initial === `populated`
          ? [{ id: 10, parentGroup: 1, value: 3 }]
          : []),
        { id: 20, parentGroup: 2, value: 5 },
      ]
      const children = createControlledCollection(
        `projection-children`,
        initialChildren,
      )
      const truth = new Map(initialChildren.map((row) => [row.id, row]))
      let group = 1
      let phase: Phase = `initial`
      const calls: Array<{
        phase: Phase
        kind: string
        child: unknown
        view: ChildView
      }> = []
      const project = (row: Input) => {
        const child = row.children
        const view = readChildren(child, form)
        // Capture readiness and contents NOW, not through a reference read after preload.
        calls.push({
          phase,
          kind: row.kind,
          child,
          view: { ...view, rows: publicRows(view.rows) },
        })
        const total = view.rows.reduce((sum, item) => sum + item.value, 0)
        return output === `opaque-root`
          ? new Projection(row.id, row.kind, child, total)
          : { id: row.id, kind: row.kind, children: child, total }
      }
      const live = createLiveQueryCollection((q) => {
        const included = q
          .from({ parent: parents.collection })
          .select(({ parent }) => {
            const childRows = q
              .from({ child: children.collection })
              .where(({ child }) => eq(child.parentGroup, parent.group))
              .orderBy(({ child }) => child.id)
              .select(({ child }) => ({
                id: child.id,
                parentGroup: child.parentGroup,
                value: child.value,
              }))
            return {
              id: parent.id,
              kind: `included`,
              total: 0,
              children:
                form === `collection`
                  ? childRows
                  : form === `array`
                    ? toArray(childRows)
                    : materialize(childRows),
            }
          })
        if (boundary === `union`) {
          const withoutInclude = q
            .from({ other: absent.collection })
            .select(({ other }) => ({
              id: other.id,
              kind: `absent`,
              total: 0,
            }))
          const union = q.unionAll(included, withoutInclude)
          return output === `expression` ? union : union.fn.select(project)
        }
        if (boundary === `recursive-query-ref`) {
          const intermediate = q
            .from({ inner: included })
            .select(({ inner }) => inner)
          const outer = q.from({ row: intermediate })
          return output === `expression`
            ? outer.select(({ row }) => row)
            : outer.fn.select(({ row }) => project(row))
        }
        const outer = q.from({ row: included })
        return output === `expression`
          ? outer.select(({ row }) => row)
          : outer.fn.select(({ row }) => project(row))
      })
      let facade: unknown
      const check = () => {
        const row: (Input & { total: number }) | undefined = live.toArray.find(
          (item) => item.kind === `included`,
        )
        expect.soft(row, `${phase}: included public row`).toBeDefined()
        if (!row) return
        const expected = publicRows(
          [...truth.values()].filter((item) => item.parentGroup === group),
        )
        const view = readChildren(row.children, form)
        expect.soft(view.valid, `${phase}: public include form`).toBe(true)
        expect
          .soft(publicRows(view.rows), `${phase}: public children`)
          .toEqual(expected)
        if (form === `collection`) {
          expect.soft(view.ready, `${phase}: public facade ready`).toBe(true)
          if (phase === `initial`) facade = row.children
          else if (phase === `child-update`)
            expect.soft(row.children, `child-only facade identity`).toBe(facade)
          else
            expect
              .soft(row.children, `route move replaces facade`)
              .not.toBe(facade)
        }
        // A Collection is a live handle, not a dependency-tracked scalar read.
        // Assert derived scalars when the parent projection runs, not on child-only
        // changes to a retained facade. Inline values do drive parent recomputation.
        if (
          output !== `expression` &&
          (form !== `collection` || phase !== `child-update`)
        ) {
          expect
            .soft(row.total, `${phase}: derived scalar`)
            .toBe(expected.reduce((sum, item) => sum + item.value, 0))
        }
        if (boundary === `union`) {
          const other: Input | undefined = live.toArray.find(
            (item) => item.kind === `absent`,
          )
          expect.soft(other, `${phase}: absent branch survives`).toBeDefined()
          expect
            .soft(other?.children, `${phase}: absent branch value`)
            .toBeUndefined()
        }
        const current = calls.filter(
          (call) => call.phase === phase && call.kind === `included`,
        )
        if (
          output !== `expression` &&
          (form !== `collection` || phase !== `child-update`)
        )
          expect
            .soft(current.length, `${phase}: callback reach`)
            .toBeGreaterThan(0)
        for (const call of current) {
          expect
            .soft(call.view.valid, `${phase}: callback include form`)
            .toBe(true)
          if (form === `collection`)
            expect
              .soft(call.view.ready, `${phase}: callback facade ready`)
              .toBe(true)
        }
        for (const call of calls.filter(
          (item) => item.phase === phase && item.kind === `absent`,
        )) {
          expect
            .soft(call.child, `${phase}: valid callback absence`)
            .toBeUndefined()
        }
      }
      try {
        await live.preload()
        check()
        phase = `child-update`
        const changed = { id: 10, parentGroup: 1, value: 7 }
        truth.set(10, changed)
        children.write(initial === `empty` ? `insert` : `update`, changed)
        check()
        phase = `route-move`
        group = 2
        parents.write(`update`, { id: 1, group })
        check()
      } finally {
        await live.cleanup()
        await Promise.all([
          parents.collection.cleanup(),
          children.collection.cleanup(),
          absent.collection.cleanup(),
        ])
      }
    },
  )
})

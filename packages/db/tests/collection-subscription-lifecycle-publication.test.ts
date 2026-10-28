/**
 * Ordinary publication tests: literal batch, reselection, and normalization
 * cases. The row-publication law lives in
 * collection-subscription-lifecycle-publication-oracle.property.test.ts.
 */
import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { createDeferred } from '../src/deferred.js'
import { BTreeIndex } from '../src/indexes/btree-index.js'
import { Func, PropRef, Value } from '../src/query/ir.js'
import { valueOrderBy } from './collection-subscription-ordered-fixture.js'
import { flushPromises } from './utils.js'
import {
  assertTerminalPublication,
  clonePublicationBatches,
  cloneRow,
  normalizePublicationOrder,
} from './collection-subscription-lifecycle-publication-support'
import type {
  PublicationChange,
  Row,
  RowKey,
  SyncOperations,
  TerminalPublicationSnapshot,
} from './collection-subscription-lifecycle-publication-support'
import type { LoadSubsetOptions, SyncConfig } from '../src/types.js'

describe(`CollectionSubscription lifecycle publication oracle`, () => {
  type SnapshotRow = { id: string; value: number }
  it(`reselects a key only after its deletion and next publication`, async () => {
    let operations!: Parameters<SyncConfig<SnapshotRow, string>[`sync`]>[0]
    const loads: Array<{ cursor?: { lastKey?: string | number } }> = []
    const collection = createCollection<SnapshotRow, string>({
      id: `snapshot-selection-after-delete`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: (sync) => {
          operations = sync
          sync.begin()
          sync.write({ type: `insert`, value: { id: `one`, value: 1 } })
          sync.write({ type: `insert`, value: { id: `two`, value: 2 } })
          sync.commit()
          sync.markReady()
          return {
            loadSubset: (options) => {
              loads.push(options)
              return true
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    const index = collection.createIndex((row) => row.value, {
      indexType: BTreeIndex,
    })
    const orderBy = valueOrderBy()
    const batches: Array<Array<string>> = []
    const visible = new Set<string>()
    const invalidChanges: Array<string> = []
    const subscription = collection.subscribeChanges((changes) => {
      const batch: Array<string> = []
      for (const change of changes) {
        batch.push(`${change.type}:${change.key}`)
        if (change.type === `insert`) {
          if (visible.has(String(change.key)))
            invalidChanges.push(`duplicate insert:${change.key}`)
          visible.add(String(change.key))
        } else if (change.type === `delete`) {
          if (!visible.delete(String(change.key)))
            invalidChanges.push(`delete absent:${change.key}`)
        }
      }
      if (batch.length > 0) batches.push(batch)
    })
    subscription.setOrderByIndex(index)
    try {
      subscription.requestSnapshot({
        where: new Func(`eq`, [new PropRef([`id`]), new Value(`one`)]),
      })
      operations.begin()
      operations.write({ type: `delete`, key: `one` })
      await operations.commit()
      operations.begin()
      operations.write({ type: `insert`, value: { id: `one`, value: 1 } })
      await operations.commit()
      subscription.requestLimitedSnapshot({
        orderBy,
        limit: 1,
        minValues: [1],
      })

      // The independent fold is select(one), remove(one), publish(one), then
      // select the first remaining ranked row. A permanent reservation loses
      // the source reinsert; a missing reservation repeats it in the window.
      expect(batches).toEqual([
        [`insert:one`],
        [`delete:one`],
        [`insert:one`],
        [`insert:two`],
      ])
      expect(invalidChanges).toEqual([])
      expect([...visible].sort()).toEqual([`one`, `two`])
      expect(loads.at(-1)).toMatchObject({ offset: 0 })
      expect(loads.at(-1)?.cursor?.lastKey).toBeUndefined()
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })
  // A subscriber's callback has already published each inserted key, whether
  // it filters source changes or passes them through. The model keeps source
  // rows in a plain Map and public keys in a Set. Source deletes remove public
  // keys; source inserts add them. An ordered snapshot may choose only an
  // absent public key. These legal histories cross callback insertion,
  // deletion, reinsert, and local selection in every filtering mode and ordered
  // index path. Each callback is an observation cut. Retained-key count checks
  // the long-lived tracking cost after deletion separately.
  const callbackSelectionHistories = [
    {
      name: `new-insert`,
      actions: [{ type: `insert`, row: { id: `two`, value: 2 } }],
    },
    {
      name: `delete-reinsert`,
      actions: [
        { type: `delete`, id: `one` },
        { type: `insert`, row: { id: `one`, value: 1 } },
        { type: `insert`, row: { id: `two`, value: 2 } },
      ],
    },
  ] as const
  it.each(
    ([`filtered`, `full`, `skip`] as const).flatMap((mode) =>
      ([false, true] as const).flatMap((withCursor) =>
        callbackSelectionHistories.map((history) => ({
          mode,
          withCursor,
          history,
        })),
      ),
    ),
  )(
    `does not reselect callback rows after $history.name: $mode, cursor=$withCursor`,
    async ({ mode, withCursor, history }) => {
      let operations!: Parameters<SyncConfig<SnapshotRow, string>[`sync`]>[0]
      const collection = createCollection<SnapshotRow, string>({
        id: `snapshot-callback-selection-${mode}-${withCursor}`,
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        sync: {
          sync: (sync) => {
            operations = sync
            sync.begin()
            sync.write({ type: `insert`, value: { id: `one`, value: 1 } })
            sync.commit()
            sync.markReady()
            return { loadSubset: () => true, unloadSubset: () => {} }
          },
        },
      })
      const index = collection.createIndex((row) => row.value, {
        indexType: BTreeIndex,
      })
      const orderBy = valueOrderBy()
      const batches: Array<Array<string>> = []
      const visible = new Set<string>()
      const invalidChanges: Array<string> = []
      const subscription = collection.subscribeChanges(
        (changes) => {
          const batch = changes.map(({ type, key }) => `${type}:${key}`)
          for (const change of changes) {
            if (change.type === `insert`) {
              if (visible.has(String(change.key)))
                invalidChanges.push(`duplicate insert:${change.key}`)
              visible.add(String(change.key))
            } else if (change.type === `delete`) {
              if (!visible.delete(String(change.key)))
                invalidChanges.push(`delete absent:${change.key}`)
            }
          }
          if (batch.length > 0) batches.push(batch)
        },
        { includeInitialState: mode === `skip` ? false : undefined },
      )
      subscription.setOrderByIndex(index)
      try {
        if (mode === `full`) subscription.requestSnapshot()
        else
          subscription.requestSnapshot({
            where: new Func(`eq`, [new PropRef([`id`]), new Value(`one`)]),
          })
        // The first snapshot selects the sole source row. From here the model
        // folds source actions without reading subscription tracking state.
        const expectedSource = new Map<string, SnapshotRow>([
          [`one`, { id: `one`, value: 1 }],
        ])
        const expectedVisible = new Set(expectedSource.keys())
        const expectedBatches = [[`insert:one`]]
        expect(batches).toEqual(expectedBatches)
        let retainedAfterDelete: number | undefined
        for (const action of history.actions) {
          operations.begin()
          if (action.type === `delete`) {
            expectedSource.delete(action.id)
            expectedVisible.delete(action.id)
            expectedBatches.push([`delete:${action.id}`])
            operations.write({ type: `delete`, key: action.id })
          } else {
            expectedSource.set(action.row.id, action.row)
            expectedVisible.add(action.row.id)
            expectedBatches.push([`insert:${action.row.id}`])
            operations.write({ type: `insert`, value: action.row })
          }
          await operations.commit()
          expect(batches).toEqual(expectedBatches)
          if (action.type === `delete`) {
            retainedAfterDelete = (
              subscription as unknown as { sentKeys: ReadonlySet<string> }
            ).sentKeys.size
          }
        }
        const nextOrdered = [...expectedSource.values()]
          .sort((left, right) => left.value - right.value)
          .find(({ id }) => !expectedVisible.has(id))
        if (nextOrdered) {
          expectedVisible.add(nextOrdered.id)
          expectedBatches.push([`insert:${nextOrdered.id}`])
        }
        subscription.requestLimitedSnapshot({
          orderBy,
          limit: 1,
          ...(withCursor ? { minValues: [1] } : {}),
        })

        expect.soft(batches).toEqual(expectedBatches)
        expect.soft(invalidChanges).toEqual([])
        expect([...visible].sort()).toEqual([...expectedVisible].sort())
        if (retainedAfterDelete !== undefined)
          expect.soft(retainedAfterDelete).toBe(0)
      } finally {
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )
  // Selected keys and provider coverage answer different questions. A key
  // delivered by a callback must not be selected again, but it does not prove
  // that every lower-ranked provider row was fetched. These two legal histories
  // challenge both directions: a sparse callback leaves a lower rank unseen,
  // and an ordered callback may reenter before its outer request acquires a
  // provider page. The plain remote array is the independent source model; the
  // controlled adapter honors a key cursor when supplied and otherwise
  // returns exactly the requested offset page. After a bounded sequence of
  // requests, every remote key must be public once.
  it.each(
    ([undefined, false] as const).flatMap((includeInitialState) =>
      ([`sparse-callback`, `ordered-reentry`] as const).flatMap((history) =>
        ([false, true] as const).map((withCursor) => ({
          includeInitialState,
          history,
          withCursor,
        })),
      ),
    ),
  )(
    `loads unseen ordered rows after $history, includeInitialState=$includeInitialState, cursor=$withCursor`,
    async ({ includeInitialState, history, withCursor }) => {
      type ProviderRow = { id: string; value: number }
      const remote: Array<ProviderRow> = [
        { id: `one`, value: 1 },
        { id: `two`, value: 2 },
        { id: `three`, value: 3 },
      ]
      const initial =
        history === `ordered-reentry` ? remote.slice(0, 2) : remote.slice(0, 1)
      let operations!: Parameters<SyncConfig<ProviderRow, string>[`sync`]>[0]
      const requests: Array<LoadSubsetOptions> = []
      const collection = createCollection<ProviderRow, string>({
        id: `snapshot-selection-provider-${history}-${includeInitialState}-${withCursor}`,
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        sync: {
          sync: (sync) => {
            operations = sync
            sync.begin()
            for (const value of initial) sync.write({ type: `insert`, value })
            sync.commit()
            sync.markReady()
            return {
              loadSubset: (options) => {
                requests.push(options)
                if (options.orderBy) {
                  const cursorKey = options.cursor?.lastKey
                  const start =
                    cursorKey === undefined
                      ? (options.offset ?? 0)
                      : remote.findIndex(({ id }) => id === cursorKey) + 1
                  const page = remote.slice(
                    start,
                    options.limit === undefined
                      ? undefined
                      : start + options.limit,
                  )
                  const missing = page.filter(({ id }) => !collection.has(id))
                  if (missing.length > 0) {
                    operations.begin()
                    for (const value of missing)
                      operations.write({ type: `insert`, value })
                    operations.commit()
                  }
                }
                return true
              },
              unloadSubset: () => {},
            }
          },
        },
      })
      const index = collection.createIndex((row) => row.value, {
        indexType: BTreeIndex,
      })
      const orderBy = valueOrderBy()
      const visible = new Map<string, ProviderRow>()
      const violations: Array<string> = []
      let reentered = false
      const subscription = collection.subscribeChanges(
        (changes) => {
          for (const change of changes) {
            if (change.type === `delete`) {
              if (!visible.delete(String(change.key)))
                violations.push(`delete absent:${change.key}`)
            } else {
              if (change.type === `insert` && visible.has(String(change.key)))
                violations.push(`duplicate insert:${change.key}`)
              visible.set(String(change.key), change.value)
            }
          }
          if (
            history === `ordered-reentry` &&
            !reentered &&
            changes.some(({ type, key }) => type === `insert` && key === `one`)
          ) {
            reentered = true
            subscription.requestLimitedSnapshot({
              orderBy,
              limit: 1,
              ...(withCursor ? { minValues: [0] } : {}),
            })
          }
        },
        { includeInitialState },
      )
      subscription.setOrderByIndex(index)
      try {
        if (history === `sparse-callback`) {
          subscription.requestSnapshot({
            where: new Func(`eq`, [new PropRef([`id`]), new Value(`one`)]),
          })
          operations.begin()
          operations.write({ type: `insert`, value: remote[2]! })
          await operations.commit()
        }
        for (const expectedRow of remote) {
          subscription.requestLimitedSnapshot({
            orderBy,
            limit: 1,
            ...(withCursor ? { minValues: [0] } : {}),
          })
          expect(visible.has(expectedRow.id)).toBe(true)
        }
        await flushPromises()

        const orderedRequests = requests.filter(
          ({ orderBy: requestedOrder }) => requestedOrder !== undefined,
        )
        expect(orderedRequests.length).toBeGreaterThan(0)
        expect(
          orderedRequests.every(({ limit }) =>
            withCursor ? limit === undefined : limit !== undefined,
          ),
        ).toBe(true)
        expect(violations).toEqual([])
        expect([...visible.keys()].sort()).toEqual(
          remote.map(({ id }) => id).sort(),
        )
      } finally {
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )
  // A cursor expression alone does not move an offset-only provider. Here the
  // cursor value is just before the last remote row, while the Collection has
  // only the first row. The plain remote array defines the expected target.
  // An adapter that ignores cursor expressions returns an offset page, so a
  // finite prefix based only on local selections cannot guarantee progress.
  it.each(
    ([undefined, false] as const).flatMap((includeInitialState) =>
      [3, 7].map((rowCount) => ({ includeInitialState, rowCount })),
    ),
  )(
    `loads a high cursor boundary through an offset provider, includeInitialState=$includeInitialState, rows=$rowCount`,
    async ({ includeInitialState, rowCount }) => {
      type ProviderRow = { id: number; value: number }
      const remote = Array.from({ length: rowCount }, (_, index) => ({
        id: index + 1,
        value: index + 1,
      }))
      let operations!: Parameters<SyncConfig<ProviderRow, number>[`sync`]>[0]
      const requests: Array<{ offset?: number; limit?: number }> = []
      const collection = createCollection<ProviderRow, number>({
        id: `snapshot-high-cursor-offset-${includeInitialState}-${rowCount}`,
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        sync: {
          sync: (sync) => {
            operations = sync
            sync.begin()
            sync.write({ type: `insert`, value: remote[0]! })
            sync.commit()
            sync.markReady()
            return {
              loadSubset: (options) => {
                requests.push(options)
                const start = options.offset ?? 0
                const page = remote.slice(
                  start,
                  start + (options.limit ?? remote.length),
                )
                const missing = page.filter(({ id }) => !collection.has(id))
                if (missing.length > 0) {
                  operations.begin()
                  for (const value of missing)
                    operations.write({ type: `insert`, value })
                  operations.commit()
                }
                return true
              },
              unloadSubset: () => {},
            }
          },
        },
      })
      const index = collection.createIndex((row) => row.value, {
        indexType: BTreeIndex,
      })
      const visible = new Set<number>()
      const violations: Array<string> = []
      const subscription = collection.subscribeChanges(
        (changes) => {
          for (const change of changes) {
            if (change.type === `delete`) visible.delete(change.key)
            else {
              if (change.type === `insert` && visible.has(change.key))
                violations.push(`duplicate insert:${change.key}`)
              visible.add(change.key)
            }
          }
        },
        { includeInitialState },
      )
      subscription.setOrderByIndex(index)
      try {
        subscription.requestLimitedSnapshot({
          orderBy: valueOrderBy(),
          limit: 1,
          minValues: [rowCount - 1],
        })
        await flushPromises()

        expect(requests).toHaveLength(1)
        expect(requests[0]).toMatchObject({ offset: 0 })
        expect(requests[0]?.limit).toBeUndefined()
        expect(visible.has(remote.at(-1)!.id)).toBe(true)
        expect(violations).toEqual([])
      } finally {
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )
  // A provider page is ranked in authoritative source state, while the local
  // Collection is an optimistic projection of it. A pending delete or update
  // can hide a source row without reserving its key for this subscriber. The
  // plain remote array and the pending local changes define the next visible
  // rank independently of the subscription's request arithmetic. At request
  // submission, its provider page must reach that rank. A source commit may
  // remain queued behind the optimistic transaction, so this cut judges the
  // request rather than claiming that the page is already public.
  it.each(
    ([`delete`, `update-out-of-filter`] as const).flatMap((mutation) =>
      [1, 2].map((hiddenCount) => ({ mutation, hiddenCount })),
    ),
  )(
    `loads past $hiddenCount pending optimistic $mutation row(s)`,
    async ({ mutation, hiddenCount }) => {
      type ProviderRow = { id: number; value: number; status: string }
      const remote = [1, 2, 3].map((id) => ({
        id,
        value: id,
        status: `visible`,
      }))
      const heldMutation = createDeferred<void>()
      const delivered = new Set<number>()
      const requests: Array<LoadSubsetOptions> = []
      let operations!: Parameters<SyncConfig<ProviderRow, number>[`sync`]>[0]
      const collection = createCollection<ProviderRow, number>({
        id: `snapshot-optimistic-prefix-${mutation}-${hiddenCount}`,
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        onDelete: async () => heldMutation.promise,
        onUpdate: async () => heldMutation.promise,
        sync: {
          sync: (sync) => {
            operations = sync
            sync.markReady()
            return {
              loadSubset: (options) => {
                requests.push(options)
                const start = options.offset ?? 0
                const page = remote.slice(
                  start,
                  options.limit === undefined
                    ? undefined
                    : start + options.limit,
                )
                const fresh = page.filter(({ id }) => !delivered.has(id))
                if (fresh.length > 0) {
                  operations.begin()
                  for (const row of fresh) {
                    delivered.add(row.id)
                    operations.write({ type: `insert`, value: row })
                  }
                  return operations.commit(options.signal)
                }
                return true
              },
              unloadSubset: () => {},
            }
          },
        },
      })
      const index = collection.createIndex((row) => row.value, {
        indexType: BTreeIndex,
      })
      const visible = new Set<number>()
      const invalidChanges: Array<string> = []
      const subscription = collection.subscribeChanges(
        (changes) => {
          for (const change of changes) {
            if (change.type === `delete`) {
              if (!visible.delete(change.key))
                invalidChanges.push(`delete absent:${change.key}`)
            } else {
              if (change.type === `insert` && visible.has(change.key))
                invalidChanges.push(`duplicate insert:${change.key}`)
              visible.add(change.key)
            }
          }
        },
        mutation === `update-out-of-filter`
          ? {
              whereExpression: new Func(`eq`, [
                new PropRef([`status`]),
                new Value(`visible`),
              ]),
            }
          : undefined,
      )
      subscription.setOrderByIndex(index)
      try {
        subscription.requestLimitedSnapshot({
          orderBy: valueOrderBy(),
          limit: hiddenCount,
        })
        expect([...visible].sort()).toEqual(
          remote.slice(0, hiddenCount).map(({ id }) => id),
        )
        for (const { id } of remote.slice(0, hiddenCount)) {
          if (mutation === `delete`) collection.delete(id)
          else
            collection.update(id, (draft) => {
              draft.status = `hidden`
            })
        }
        expect(visible.size).toBe(0)
        expect(collection._optimisticOverlaySize()).toBe(hiddenCount)

        subscription.requestLimitedSnapshot({
          orderBy: valueOrderBy(),
          limit: 1,
        })
        const nextRequest = requests.at(-1)!
        const start = nextRequest.offset ?? 0
        const requested = remote.slice(
          start,
          nextRequest.limit === undefined
            ? undefined
            : start + nextRequest.limit,
        )
        expect(invalidChanges).toEqual([])
        expect(requests).toHaveLength(2)
        expect(requested.map(({ id }) => id)).toContain(remote[hiddenCount]!.id)
      } finally {
        heldMutation.resolve()
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )
  // A callback insertion is public before user code runs. If that code asks
  // for the next local ordered row, the callback key is excluded and another
  // eligible key still advances selection. This crosses the positive and
  // negative halves of the law at the callback observation cut.
  it.each([undefined, false] as const)(
    `selects an unseen row during a source callback, includeInitialState=%s`,
    async (includeInitialState) => {
      type SelectionRow = { id: string; value: number }
      let operations!: Parameters<SyncConfig<SelectionRow, string>[`sync`]>[0]
      const collection = createCollection<SelectionRow, string>({
        id: `snapshot-source-callback-reentry-${includeInitialState}`,
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        sync: {
          sync: (sync) => {
            operations = sync
            sync.begin()
            sync.write({ type: `insert`, value: { id: `one`, value: 1 } })
            sync.write({ type: `insert`, value: { id: `three`, value: 3 } })
            sync.commit()
            sync.markReady()
            return { loadSubset: () => true, unloadSubset: () => {} }
          },
        },
      })
      const index = collection.createIndex((row) => row.value, {
        indexType: BTreeIndex,
      })
      const orderBy = valueOrderBy()
      const batches: Array<Array<string>> = []
      const visible = new Set<string>()
      const violations: Array<string> = []
      let reentered = false
      const subscription = collection.subscribeChanges(
        (changes) => {
          if (changes.length > 0)
            batches.push(changes.map(({ type, key }) => `${type}:${key}`))
          for (const change of changes) {
            if (change.type === `insert`) {
              if (visible.has(String(change.key)))
                violations.push(`duplicate insert:${change.key}`)
              visible.add(String(change.key))
            } else if (change.type === `delete`) {
              visible.delete(String(change.key))
            }
          }
          if (
            !reentered &&
            changes.some(({ type, key }) => type === `insert` && key === `two`)
          ) {
            reentered = true
            subscription.requestLimitedSnapshot({
              orderBy,
              limit: 1,
              minValues: [1],
            })
          }
        },
        { includeInitialState },
      )
      subscription.setOrderByIndex(index)
      try {
        subscription.requestSnapshot({
          where: new Func(`eq`, [new PropRef([`id`]), new Value(`one`)]),
        })
        operations.begin()
        operations.write({ type: `insert`, value: { id: `two`, value: 2 } })
        await operations.commit()

        // The independent fold is: select one, publish source two, then choose
        // the lowest ordered source row absent from {one, two}, namely three.
        expect(reentered).toBe(true)
        expect(batches).toEqual([
          [`insert:one`],
          [`insert:two`],
          [`insert:three`],
        ])
        expect(violations).toEqual([])
        expect([...visible].sort()).toEqual([`one`, `three`, `two`])
      } finally {
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )
  it.each([`row`, `status`, `error`, `acquisition`] as const)(
    `rejects a terminal %s observation with an unchanged-retired neighbor`,
    (fault) => {
      const retired: TerminalPublicationSnapshot = {
        batches: [],
        visible: [{ id: `c`, value: 42 }],
        statusEvents: [],
        errors: [],
        status: `ready`,
        subscriberCount: 0,
        attempts: 2,
        unloads: [0, 1],
        syncRuns: 1,
      }
      const actual: TerminalPublicationSnapshot = {
        ...retired,
        batches: [],
        visible: retired.visible.map(cloneRow),
        statusEvents: [],
        errors: [],
        unloads: [...retired.unloads],
      }
      assertTerminalPublication(actual, retired)
      if (fault === `row`)
        actual.batches.push([
          { type: `insert`, key: `a`, value: { id: `a`, value: 9 } },
        ])
      if (fault === `status`)
        actual.statusEvents.push({
          previousStatus: `ready`,
          status: `loadingSubset`,
        })
      if (fault === `error`) actual.errors.push(new Error(`late transport`))
      if (fault === `acquisition`) actual.attempts++
      expect(() => assertTerminalPublication(actual, retired)).toThrowError(
        /expected/,
      )
    },
  )
  it.each(
    ([undefined, false] as const).flatMap((includeInitialState) =>
      ([`update`, `delete`, `truncate`] as const).map((operation) => ({
        includeInitialState,
        operation,
      })),
    ),
  )(
    `distinguishes unseen-row $operation with includeInitialState=$includeInitialState`,
    async ({ includeInitialState, operation }) => {
      let operations!: SyncOperations
      const collection = createCollection<Row, RowKey>({
        getKey: ({ id }) => id,
        startSync: true,
        sync: {
          sync: (sync) => {
            operations = sync
            sync.begin()
            sync.write({ type: `insert`, value: { id: `d`, value: 0 } })
            sync.commit()
            sync.markReady()
          },
        },
      })
      const changes: Array<PublicationChange> = []
      const subscription = collection.subscribeChanges(
        (batch) => {
          for (const change of batch) {
            changes.push({
              type: change.type,
              key: change.value.id,
              value: cloneRow(change.value),
              ...(change.previousValue
                ? { previousValue: cloneRow(change.previousValue) }
                : {}),
            })
          }
        },
        { includeInitialState },
      )
      try {
        expect(changes).toEqual([])
        operations.begin()
        if (operation === `truncate`) operations.truncate()
        else if (operation === `delete`)
          operations.write({ type: `delete`, key: `d` })
        else operations.write({ type: `update`, value: { id: `d`, value: 4 } })
        await operations.commit()
        expect(changes).toEqual(
          operation === `update`
            ? [
                {
                  type: includeInitialState === false ? `update` : `insert`,
                  key: `d`,
                  value: { id: `d`, value: 4 },
                  ...(includeInitialState === false
                    ? { previousValue: { id: `d`, value: 0 } }
                    : {}),
                },
              ]
            : includeInitialState === false
              ? [{ type: `delete`, key: `d`, value: { id: `d`, value: 0 } }]
              : [],
        )
      } finally {
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )

  it.each([
    `none`,
    `missing`,
    `duplicate`,
    `value`,
    `previous-value`,
    `split`,
    `merge`,
    `same-key-order`,
  ] as const)(
    `normalizes only independent change order with corruption: %s`,
    (corruption) => {
      const baseline: Array<Array<PublicationChange>> = [
        [
          {
            type: `update`,
            key: `a`,
            value: { id: `a`, value: 1 },
            previousValue: { id: `a`, value: 0 },
          },
          { type: `delete`, key: `b`, value: { id: `b`, value: 0 } },
          { type: `insert`, key: `c`, value: { id: `c`, value: 1 } },
        ],
        [
          {
            type: `update`,
            key: `a`,
            value: { id: `a`, value: 2 },
            previousValue: { id: `a`, value: 1 },
          },
          { type: `delete`, key: `a`, value: { id: `a`, value: 2 } },
        ],
      ]
      const permutations = [
        [0, 1, 2],
        [0, 2, 1],
        [1, 0, 2],
        [1, 2, 0],
        [2, 0, 1],
        [2, 1, 0],
      ]
      for (const permutation of permutations) {
        const candidate = clonePublicationBatches(baseline)
        const changes = candidate[0]!
        if (corruption === `value`) changes[0]!.value.value++
        if (corruption === `previous-value`) changes[0]!.previousValue!.value++
        candidate[0] = permutation.map((index) => changes[index]!)
        if (corruption === `missing`) candidate[0].pop()
        if (corruption === `duplicate`) candidate[0].push(changes[0]!)
        if (corruption === `split`)
          candidate.splice(1, 0, candidate[0].splice(1))
        if (corruption === `merge`) candidate.splice(0, 2, candidate.flat())
        if (corruption === `same-key-order`) candidate[1]!.reverse()
        const actual = normalizePublicationOrder(candidate)
        const expected = normalizePublicationOrder(baseline)
        if (corruption === `none`) expect(actual).toEqual(expected)
        else expect(actual).not.toEqual(expected)
      }
    },
  )
})

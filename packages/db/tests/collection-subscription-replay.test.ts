// Ordinary tests moved out of collection-subscription-replay-oracle.property.test.ts.
// They keep literal expectations for replay publication, retirement, and ordering;
// the replay laws and the scenario grammar stay in the oracle file.
import { describe, expect, it, vi } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { createDeferred } from '../src/deferred.js'
import { BTreeIndex } from '../src/indexes/btree-index.js'
import { ReverseIndex } from '../src/indexes/reverse-index.js'
import { Func, PropRef, Value } from '../src/query/ir.js'
import { valueOrderBy } from './collection-subscription-ordered-fixture.js'
import { captureMicrotaskErrors, flushPromises } from './utils.js'
import {
  expectSameSubsetRequest,
  recordPublishedChanges,
  sortedChanges,
  sortedRows,
} from './collection-subscription-replay-support.js'
import type {
  ReplayChange,
  ReplayRow,
} from './collection-subscription-replay-support.js'
import type { CollectionSubscription } from '../src/collection/subscription.js'
import type {
  ChangeMessageOrDeleteKeyMessage,
  LoadSubsetOptions,
  SyncConfig,
} from '../src/types.js'

describe(`CollectionSubscription replay oracle`, () => {
  it.each([`resolve`, `reject`] as const)(
    `starts a replacement that lets canceled replay %s`,
    async (outcome) => {
      const oldReplay = createDeferred<void>()
      const newReplay = createDeferred<void>()
      const aborted = new DOMException(`superseded`, `AbortError`)
      const loads: Array<LoadSubsetOptions> = []
      const unloads: Array<LoadSubsetOptions> = []
      const events: Array<string> = []
      let operations!: Parameters<SyncConfig<ReplayRow>[`sync`]>[0]
      const collection = createCollection<ReplayRow>({
        id: `replacement-start-dependency-${outcome}`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          sync: (sync) => {
            operations = sync
            sync.markReady()
            return {
              loadSubset: (options) => {
                loads.push(options)
                events.push(`load:${loads.length}`)
                if (loads.length === 1) {
                  sync.begin()
                  sync.write({ type: `insert`, value: { id: `one`, value: 0 } })
                  sync.commit()
                  return true
                }
                if (loads.length === 2) return oldReplay.promise
                // This provider has stopped old request-scoped writes on abort.
                // Its shared refresh protocol completes the old waiter only
                // when a replacement acquisition registers. Completion does
                // not require new result publication or a callback from core.
                expect(loads[1]?.signal?.aborted).toBe(true)
                if (outcome === `resolve`) oldReplay.resolve()
                else oldReplay.reject(aborted)
                events.push(`old:settled`)
                return newReplay.promise
              },
              unloadSubset: (options) => {
                unloads.push(options)
              },
            }
          },
        },
      })
      const visible = new Map<string | number, ReplayRow>()
      const subscription = collection.subscribeChanges((changes) => {
        for (const change of changes) {
          if (change.type === `delete`) visible.delete(change.key)
          else {
            const { id, value } = change.value
            visible.set(change.key, { id, value })
          }
        }
      })
      const truncate = () => {
        operations.begin()
        operations.truncate()
        operations.commit()
      }
      try {
        subscription.requestSnapshot({ optimizedOnly: false })
        expect([...visible.values()]).toEqual([{ id: `one`, value: 0 }])
        truncate()
        const completion = subscription.pendingTruncateReplacement
        expect(completion).toBeDefined()
        let completed = false
        const completionErrors: Array<unknown> = []
        void completion?.then(
          () => {
            completed = true
          },
          (error: unknown) => completionErrors.push(error),
        )
        await flushPromises()
        expect(loads).toHaveLength(2)
        expect(oldReplay.isPending()).toBe(true)
        expect([...visible.values()]).toEqual([{ id: `one`, value: 0 }])

        truncate()
        await flushPromises()
        expect(events).toEqual([`load:1`, `load:2`, `load:3`, `old:settled`])
        expect(oldReplay.isPending()).toBe(false)
        expect([...visible.values()]).toEqual([{ id: `one`, value: 0 }])
        expect(subscription.status).toBe(`loadingSubset`)
        expect(subscription.lastError).toBeUndefined()
        expect(completed).toBe(false)
        expect(completionErrors).toEqual([])

        operations.begin()
        operations.write({ type: `insert`, value: { id: `one`, value: 2 } })
        await operations.commit()
        newReplay.resolve()
        await flushPromises()
        expect([...visible.values()]).toEqual([{ id: `one`, value: 2 }])
        expect(subscription.status).toBe(`ready`)
        expect(subscription.lastError).toBeUndefined()
        expect(completed).toBe(true)
        expect(completionErrors).toEqual([])
      } finally {
        oldReplay.resolve()
        newReplay.resolve()
        await flushPromises()
        subscription.unsubscribe()
        await collection.cleanup()
      }
      expect(unloads).toHaveLength(loads.length)
      for (const load of loads) {
        expect(unloads.filter((unload) => unload === load)).toHaveLength(1)
      }
    },
  )

  it(`aborts an in-flight initial acquisition before its replay replaces it`, async () => {
    let begin!: () => void
    let write!: (
      message: ChangeMessageOrDeleteKeyMessage<ReplayRow, string>,
    ) => void
    let commit!: () => void
    let truncate!: () => void
    const loads: Array<{
      options: LoadSubsetOptions
      deferred: ReturnType<typeof createDeferred<void>>
    }> = []
    const collection = createCollection<ReplayRow>({
      id: `initial-acquisition-replay`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      sync: {
        sync: (params) => {
          begin = params.begin
          write = params.write
          commit = params.commit
          truncate = params.truncate
          params.markReady()
          return {
            loadSubset: (options) => {
              const deferred = createDeferred<void>()
              loads.push({ options, deferred })
              return deferred.promise
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    const visible = new Map<string | number, ReplayRow>()
    const subscription = collection.subscribeChanges((changes) => {
      for (const change of changes) {
        if (change.type === `delete`) visible.delete(change.key)
        else {
          visible.set(change.key, {
            id: change.value.id,
            value: change.value.value,
          })
        }
      }
    })

    try {
      subscription.requestSnapshot({ optimizedOnly: false })
      begin()
      truncate()
      commit()
      await flushPromises()
      expect(loads[0]?.options.signal?.aborted).toBe(true)

      begin()
      write({ type: `insert`, value: { id: `two`, value: 2 } })
      commit()
      loads[1]?.deferred.resolve()
      await flushPromises()

      if (!loads[0]?.options.signal?.aborted) {
        begin()
        write({ type: `insert`, value: { id: `one`, value: 1 } })
        commit()
      }
      loads[0]?.deferred.resolve()
      await flushPromises()

      expect(sortedRows(visible)).toEqual([{ id: `two`, value: 2 }])
      expect(subscription.status).toBe(`ready`)
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`keeps the published replacement after a reentrant replay fails`, async () => {
    let begin!: () => void
    let write!: (
      message: ChangeMessageOrDeleteKeyMessage<ReplayRow, string>,
    ) => void
    let commit!: () => void
    let truncate!: () => void
    let loadCount = 0
    const replayLoads: Array<ReturnType<typeof createDeferred<void>>> = []
    const collection = createCollection<ReplayRow>({
      id: `reentrant-replay`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      sync: {
        sync: (params) => {
          begin = params.begin
          write = params.write
          commit = params.commit
          truncate = params.truncate
          params.markReady()
          return {
            loadSubset: () => {
              loadCount++
              if (loadCount === 1) {
                begin()
                write({ type: `insert`, value: { id: `one`, value: 1 } })
                commit()
                return true
              }

              const deferred = createDeferred<void>()
              replayLoads.push(deferred)
              return deferred.promise
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    const visible = new Map<string | number, ReplayRow>()
    let startedNestedReplay = false
    const subscription = collection.subscribeChanges((changes) => {
      for (const change of changes) {
        if (change.type === `delete`) visible.delete(change.key)
        else {
          visible.set(change.key, {
            id: change.value.id,
            value: change.value.value,
          })
        }
      }

      if (!startedNestedReplay && visible.get(`one`)?.value === 2) {
        startedNestedReplay = true
        begin()
        truncate()
        commit()
      }
    })

    try {
      subscription.requestSnapshot({ optimizedOnly: false })
      begin()
      truncate()
      commit()
      await flushPromises()
      begin()
      write({ type: `insert`, value: { id: `one`, value: 2 } })
      commit()
      replayLoads[0]?.resolve()
      await flushPromises()
      expect(startedNestedReplay).toBe(true)

      replayLoads[1]?.reject(new Error(`nested replay failed`))
      await flushPromises()
      begin()
      write({ type: `insert`, value: { id: `one`, value: 1 } })
      commit()

      expect(sortedRows(visible)).toEqual([{ id: `one`, value: 2 }])
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`ignores an aborted released demand while publishing the remaining replay`, async () => {
    let begin!: () => void
    let write!: (
      message: ChangeMessageOrDeleteKeyMessage<ReplayRow, string>,
    ) => void
    let commit!: () => void
    let truncate!: () => void
    const replays: Array<{
      options: { signal?: AbortSignal }
      deferred: ReturnType<typeof createDeferred<void>>
    }> = []
    let loadCount = 0
    const collection = createCollection<ReplayRow>({
      id: `released-demand-replay`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      sync: {
        sync: (params) => {
          begin = params.begin
          write = params.write
          commit = params.commit
          truncate = params.truncate
          params.markReady()
          return {
            loadSubset: (options) => {
              loadCount++
              if (loadCount === 1) {
                begin()
                write({ type: `insert`, value: { id: `one`, value: 0 } })
                write({ type: `insert`, value: { id: `two`, value: 0 } })
                commit()
                return true
              }
              if (loadCount === 2) return true

              const deferred = createDeferred<void>()
              replays.push({ options, deferred })
              return deferred.promise
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    const visible = new Map<string | number, ReplayRow>()
    const subscription = collection.subscribeChanges((changes) => {
      for (const change of changes) {
        if (change.type === `delete`) visible.delete(change.key)
        else {
          visible.set(change.key, {
            id: change.value.id,
            value: change.value.value,
          })
        }
      }
    })
    const demandOne = new Func(`eq`, [new PropRef([`id`]), new Value(`one`)])
    const demandTwo = new Func(`eq`, [new PropRef([`id`]), new Value(`two`)])

    try {
      subscription.requestSnapshot({ where: demandOne })
      subscription.requestSnapshot({ where: demandTwo })
      begin()
      truncate()
      commit()
      await flushPromises()

      subscription.releaseSnapshot(demandOne)
      expect(replays[0]?.options.signal?.aborted).toBe(true)
      begin()
      write({ type: `insert`, value: { id: `two`, value: 2 } })
      commit()
      replays[1]?.deferred.resolve()
      await flushPromises()

      expect(sortedRows(visible)).toEqual([{ id: `two`, value: 2 }])
      expect(subscription.status).toBe(`ready`)
      expect(subscription.lastError).toBeUndefined()
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  const orderedReplayCases = ([`asc`, `desc`] as const).flatMap((direction) => [
    ...([`return`, `resolve`] as const).flatMap((delivery) =>
      ([`same`, `changed`] as const).map((identity) => ({
        name: `${direction} ${delivery} with ${identity} keys`,
        direction,
        delivery,
        identity,
      })),
    ),
    ...([`throw`, `reject`] as const).map((delivery) => ({
      name: `${direction} ${delivery}`,
      direction,
      delivery,
      identity: `none` as const,
    })),
  ])

  it.each(orderedReplayCases)(
    `requests a safe ordered provider prefix after replay: $name`,
    async ({ direction, delivery, identity }) => {
      type OrderedReplayRow = {
        id: `one` | `two` | `three` | `four`
        value: number
      }
      let begin!: () => void
      let write!: (
        message: ChangeMessageOrDeleteKeyMessage<OrderedReplayRow, string>,
      ) => void
      let commit!: () => void
      let truncate!: () => void
      let loadCount = 0
      const loadOptions: Array<LoadSubsetOptions> = []
      const replayLoads: Array<ReturnType<typeof createDeferred<void>>> = []
      const replayRows: ReadonlyArray<OrderedReplayRow> =
        identity === `same`
          ? [
              { id: `one`, value: 1 },
              { id: `two`, value: 2 },
            ]
          : [
              { id: `three`, value: 1 },
              { id: `four`, value: 2 },
            ]
      let replayRowsInstalled = false
      const installReplayRows = () => {
        if (replayRowsInstalled || identity === `none`) return
        replayRowsInstalled = true
        begin()
        for (const row of replayRows) {
          write({ type: `insert`, value: row })
        }
        commit()
      }
      const collection = createCollection<OrderedReplayRow>({
        id: `ordered-replay-${direction}-${delivery}-${identity}`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          sync: (params) => {
            begin = params.begin
            write = params.write
            commit = params.commit
            truncate = params.truncate
            begin()
            write({ type: `insert`, value: { id: `one`, value: 1 } })
            write({ type: `insert`, value: { id: `two`, value: 2 } })
            commit()
            params.markReady()
            return {
              loadSubset: (options) => {
                loadCount++
                loadOptions.push(options)
                if (loadCount <= 2) return true
                if (loadCount > 4) return true

                if (delivery === `return`) {
                  installReplayRows()
                  return true
                }
                if (delivery === `throw`) {
                  if (loadCount === 3) {
                    throw new Error(`ordered replay failed`)
                  }
                  return true
                }

                const deferred = createDeferred<void>()
                replayLoads.push(deferred)
                return deferred.promise
              },
              unloadSubset: () => {},
            }
          },
        },
      })
      const index = collection.createIndex((row) => row.value, {
        indexType: BTreeIndex,
      })
      const orderedIndex =
        direction === `asc` ? index : new ReverseIndex(index, true)
      const orderBy = valueOrderBy(direction)
      const batches: Array<Array<OrderedReplayRow[`id`]>> = []
      const subscription = collection.subscribeChanges((changes) => {
        batches.push(changes.map(({ value }) => value.id))
      })
      subscription.setOrderByIndex(orderedIndex)

      const initialIds =
        direction === `asc`
          ? ([`one`, `two`] as const)
          : ([`two`, `one`] as const)
      const replacementIds =
        direction === `asc`
          ? ([`three`, `four`] as const)
          : ([`four`, `three`] as const)
      const succeeds = delivery === `return` || delivery === `resolve`
      const expectedIds = identity === `changed` ? replacementIds : initialIds

      try {
        subscription.requestLimitedSnapshot({ orderBy, limit: 1 })
        expect(batches).toEqual([[initialIds[0]]])
        subscription.requestLimitedSnapshot({
          orderBy,
          limit: 1,
          minValues: [direction === `asc` ? 1 : 2],
        })
        expect(loadOptions[1]).toMatchObject({ offset: 0 })
        expect(loadOptions[1]?.limit).toBeUndefined()
        expect(loadOptions[1]?.cursor?.lastKey).toBeUndefined()

        begin()
        truncate()
        commit()
        await flushPromises()
        expectSameSubsetRequest(loadOptions[2]!, loadOptions[0]!)
        expectSameSubsetRequest(loadOptions[3]!, loadOptions[1]!)

        if (delivery === `resolve`) {
          expect(replayLoads).toHaveLength(2)
          installReplayRows()
          replayLoads[0]?.resolve()
          replayLoads[1]?.resolve()
        } else if (delivery === `reject`) {
          expect(replayLoads).toHaveLength(2)
          replayLoads[0]?.reject(new Error(`ordered replay failed`))
          replayLoads[1]?.resolve()
        } else {
          expect(replayLoads).toEqual([])
        }
        await flushPromises()
        expect(collection.toArray.map(({ id }) => id).sort()).toEqual(
          succeeds ? [...expectedIds].sort() : [],
        )

        const batchCount = batches.length
        subscription.requestLimitedSnapshot({
          orderBy,
          limit: 1,
          minValues: [direction === `asc` ? 2 : 1],
        })
        expect(loadOptions[4]).toMatchObject({ offset: 0 })
        expect(loadOptions[4]?.cursor?.lastKey).toBeUndefined()
        if (succeeds) expect(batches.at(-1)).toEqual([])
        else expect(batches).toHaveLength(batchCount)
      } finally {
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )

  // A successful replacement restores the public row, but that row need not
  // be a provider prefix. The plain remote array is the reference order. A
  // provider may honor a last-key cursor before an offset; naming the sparse
  // public row as that cursor would hide every earlier row. The held replay
  // separates replacement settlement from the next ordered acquisition.
  it(`loads rows before a sparse public key after successful replay`, async () => {
    type Row = { id: string; value: number }
    const remote: Array<Row> = [
      { id: `one`, value: 1 },
      { id: `two`, value: 2 },
      { id: `three`, value: 3 },
    ]
    let begin!: () => void
    let write!: (message: { type: `insert`; value: Row }) => void
    let commit!: () => void
    let truncate!: () => void
    let holdReplay = false
    let heldRequests = 0
    const held = createDeferred<void>()
    const orderedLoads: Array<LoadSubsetOptions> = []
    const collection = createCollection<Row>({
      id: `ordered-replay-sparse-provider-prefix`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: (params) => {
          begin = params.begin
          write = params.write
          commit = params.commit
          truncate = params.truncate
          begin()
          write({ type: `insert`, value: remote[2]! })
          commit()
          params.markReady()
          return {
            loadSubset: (options) => {
              if (holdReplay && options.orderBy === undefined) {
                holdReplay = false
                heldRequests++
                return held.promise
              }
              if (options.orderBy === undefined) return true

              orderedLoads.push(options)
              const cursorKey = options.cursor?.lastKey
              const start =
                cursorKey === undefined
                  ? (options.offset ?? 0)
                  : remote.findIndex(({ id }) => id === cursorKey) + 1
              const page = remote.slice(
                start,
                options.limit === undefined ? undefined : start + options.limit,
              )
              const missing = page.filter(({ id }) => !collection.has(id))
              if (missing.length > 0) {
                begin()
                for (const value of missing) write({ type: `insert`, value })
                commit()
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
    const whereThree = new Func(`eq`, [new PropRef([`id`]), new Value(`three`)])
    const publicRows = new Map<string, Row>()
    const invalidChanges: Array<string> = []
    const subscription = collection.subscribeChanges((changes) => {
      for (const change of changes) {
        const key = String(change.key)
        if (change.type === `delete`) {
          if (!publicRows.delete(key))
            invalidChanges.push(`delete absent:${key}`)
        } else {
          if (change.type === `insert` && publicRows.has(key))
            invalidChanges.push(`duplicate insert:${key}`)
          publicRows.set(key, change.value)
        }
      }
    })
    subscription.setOrderByIndex(index)
    try {
      subscription.requestSnapshot({ where: whereThree })
      expect([...publicRows.keys()]).toEqual([`three`])

      holdReplay = true
      begin()
      truncate()
      commit()
      await flushPromises()
      expect(heldRequests).toBe(1)
      begin()
      write({ type: `insert`, value: remote[2]! })
      commit()
      expect([...publicRows.keys()]).toEqual([`three`])
      held.resolve()
      await flushPromises()

      for (const expectedRow of remote) {
        subscription.requestLimitedSnapshot({
          orderBy,
          limit: 1,
          minValues: [0],
        })
        expect(publicRows.has(expectedRow.id)).toBe(true)
      }
      await flushPromises()
      expect(orderedLoads).toHaveLength(remote.length)
      expect(orderedLoads[0]).toMatchObject({ offset: 0 })
      expect(orderedLoads[0]?.cursor?.lastKey).toBeUndefined()
      expect(invalidChanges).toEqual([])
      expect([...publicRows.keys()].sort()).toEqual(
        remote.map(({ id }) => id).sort(),
      )
    } finally {
      held.resolve()
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  // A direct subscriber buffers ordered rows privately while a replay is
  // pending. Each row still counts once: repeated ordered snapshots during the
  // replay continue after the rows already chosen. Those private selections
  // widen the provider prefix without claiming a provider cursor boundary.
  it(`continues after buffered rows when ordered snapshots repeat during a replay`, async () => {
    type Row = { id: string; value: number }
    let begin!: () => void
    let write!: (message: { type: `insert`; value: Row }) => void
    let commit!: () => void
    let truncate!: () => void
    const loadOptions: Array<LoadSubsetOptions> = []
    const heldReplay = createDeferred<void>()
    let holdReplayRequest = false
    let heldRequestCount = 0
    const rows: Array<Row> = [
      { id: `one`, value: 1 },
      { id: `two`, value: 2 },
      { id: `three`, value: 3 },
    ]
    const collection = createCollection<Row>({
      id: `ordered-replay-repeated-snapshots`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      sync: {
        sync: (params) => {
          begin = params.begin
          write = params.write
          commit = params.commit
          truncate = params.truncate
          begin()
          for (const value of rows) write({ type: `insert`, value })
          commit()
          params.markReady()
          return {
            // Hold the replay of the first ordered demand. The phase and
            // request data identify it independently of other load calls.
            loadSubset: (options) => {
              loadOptions.push(options)
              if (
                holdReplayRequest &&
                options.orderBy !== undefined &&
                options.offset === 0 &&
                options.cursor === undefined
              ) {
                holdReplayRequest = false
                heldRequestCount++
                return heldReplay.promise
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
    // The public subscriber model starts with one visible row. Replay adds
    // the other two as one replacement batch, without re-inserting that row.
    const publicRows = new Map<string, Row>()
    const batches: Array<Array<string>> = []
    const invalidChanges: Array<string> = []
    const subscription = collection.subscribeChanges((changes) => {
      const batch: Array<string> = []
      for (const change of changes) {
        batch.push(`${change.type}:${change.key}`)
        if (change.type === `insert`) {
          if (publicRows.has(String(change.key)))
            invalidChanges.push(`duplicate insert:${change.key}`)
          publicRows.set(String(change.key), change.value)
        } else if (change.type === `delete`) {
          publicRows.delete(String(change.key))
        } else {
          publicRows.set(String(change.key), change.value)
        }
      }
      if (batch.length > 0) batches.push(batch)
    })
    subscription.setOrderByIndex(index)
    try {
      subscription.requestLimitedSnapshot({ orderBy, limit: 1 })
      expect(batches).toEqual([[`insert:one`]])
      // An unrelated empty demand may be added before replay. It must not
      // determine which acquisition the fixture holds.
      subscription.requestSnapshot({
        where: new Func(`eq`, [new PropRef([`id`]), new Value(`missing`)]),
      })
      holdReplayRequest = true
      begin()
      truncate()
      commit()
      await flushPromises()
      expect(heldRequestCount).toBe(1)
      begin()
      for (const value of rows) write({ type: `insert`, value })
      commit()
      await flushPromises()
      expect(batches).toEqual([[`insert:one`]])

      const before = loadOptions.length
      subscription.requestLimitedSnapshot({ orderBy, limit: 1 })
      subscription.requestLimitedSnapshot({ orderBy, limit: 1 })
      subscription.requestLimitedSnapshot({ orderBy, limit: 1 })
      expect(loadOptions[before + 2]).toMatchObject({ offset: 0 })
      expect(loadOptions[before + 2]?.limit).toBeGreaterThanOrEqual(4)
      expect(loadOptions[before + 2]?.cursor?.lastKey).toBeUndefined()
      expect(batches).toEqual([[`insert:one`]])
      heldReplay.resolve()
      await flushPromises()
      expect(batches.map((batch) => [...batch].sort())).toEqual([
        [`insert:one`],
        [`insert:three`, `insert:two`],
      ])
      expect(invalidChanges).toEqual([])
      expect([...publicRows.keys()].sort()).toEqual(
        rows.map(({ id }) => id).sort(),
      )
    } finally {
      heldReplay.resolve()
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  // Law 9 at retirement: a failure in the current attempt keeps the replay
  // private even after the last owner is released. Each site writes a row
  // before it fails, so publishing the private rows would show that row.
  // A throwing release is not such a failure; the next test owns that site.
  it.each([
    `replay load throws`,
    `old lease unload throws`,
    `new request throws`,
  ])(
    `keeps a replay private at retirement after a synchronous failure, except a throwing release: %s`,
    async (site) => {
      let begin!: () => void
      let write!: (message: {
        type: `insert` | `update`
        value: ReplayRow
      }) => void
      let commit!: () => void
      let truncate!: () => void
      let loads = 0
      let unloads = 0
      const writeRow = (row: ReplayRow) => {
        begin()
        write({ type: `insert`, value: row })
        commit()
      }
      const collection = createCollection<ReplayRow>({
        id: `retired-replay-synchronous-failure-${site}`,
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        sync: {
          sync: (operations) => {
            begin = operations.begin
            write = operations.write
            commit = operations.commit
            truncate = operations.truncate
            operations.markReady()
            return {
              loadSubset: () => {
                loads++
                if (loads === 1) {
                  writeRow({ id: `one`, value: 1 })
                  return true
                }
                if (site === `replay load throws` && loads === 2) {
                  writeRow({ id: `one`, value: 5 })
                  throw new Error(`replay load failed`)
                }
                if (site === `new request throws` && loads === 3) {
                  writeRow({ id: `two`, value: 2 })
                  throw new Error(`request failed`)
                }
                return createDeferred<void>().promise
              },
              unloadSubset: () => {
                unloads++
                if (site === `old lease unload throws` && unloads === 1) {
                  writeRow({ id: `two`, value: 2 })
                  throw new Error(`unload failed`)
                }
              },
            }
          },
        },
      })
      const visible = new Map<string | number, ReplayRow>()
      const uncaught = captureMicrotaskErrors()
      const subscription = collection.subscribeChanges((changes) => {
        recordPublishedChanges(visible, changes)
      })
      const where = new Func(`eq`, [new PropRef([`id`]), new Value(`one`)])
      try {
        subscription.requestSnapshot({ where, optimizedOnly: false })
        await flushPromises()
        expect(sortedRows(visible)).toEqual([{ id: `one`, value: 1 }])

        begin()
        truncate()
        commit()
        await flushPromises()
        if (site === `new request throws`) {
          // A synchronous throw is a rejection: the request fails its load.
          expect(() =>
            subscription.requestSnapshot({
              where: new Func(`eq`, [new PropRef([`id`]), new Value(`two`)]),
              optimizedOnly: false,
            }),
          ).not.toThrow()
          await flushPromises()
        }
        subscription.releaseSnapshot(where)
        await flushPromises()

        expect(subscription.pendingTruncateReplacement).toBeUndefined()
        // A release error fails no replay, so the retired replay publishes
        // the rows it holds: the truncate removed `one`, and the adapter
        // wrote `two` before it threw.
        expect(sortedRows(visible)).toEqual(
          site === `old lease unload throws`
            ? [{ id: `two`, value: 2 }]
            : [{ id: `one`, value: 1 }],
        )
        expect(
          uncaught.errors.map((error) => (error as Error).message),
        ).toEqual(site === `old lease unload throws` ? [`unload failed`] : [])
      } finally {
        uncaught.restore()
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )

  // A synchronous throw is a rejection (maintainer decision), so no failure
  // is held by an attempt whose setup stack has not returned yet.
  it.each(
    [`current`, `pending`].flatMap((scope) =>
      [`throw`, `reject`].map((failureMode) => ({ scope, failureMode })),
    ),
  )(
    `drops released failure references: $scope, $failureMode`,
    async ({ scope, failureMode }) => {
      let begin!: () => void
      let commit!: () => void
      let truncate!: () => void
      const pendingPeer = createDeferred<void>()
      const replacement = createDeferred<void>()
      const failure = new Error(`failed owner`)
      let loads = 0
      const collection = createCollection<ReplayRow>({
        id: `released-replay-failure-${scope}-${failureMode}`,
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        sync: {
          sync: (operations) => {
            begin = operations.begin
            commit = operations.commit
            truncate = operations.truncate
            operations.markReady()
            return {
              loadSubset: () => {
                loads++
                if (loads <= 2) return true
                if (loads === 3) {
                  if (failureMode === `throw`) throw failure
                  return Promise.reject(failure)
                }
                return loads === 4 ? pendingPeer.promise : replacement.promise
              },
              unloadSubset: () => {},
            }
          },
        },
      })
      const subscription = collection.subscribeChanges(() => {}, {
        includeInitialState: false,
      })
      const failedWhere = new Func(`eq`, [
        new PropRef([`id`]),
        new Value(`one`),
      ])
      const peerWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`two`)])
      const retainedFailures = () => {
        // Narrow retention witness for old and new representations. Follow
        // stored replay frames, not a captured map that the source discarded.
        type Frame = { failures?: Map<unknown, Error> }
        const replayState = (
          subscription as unknown as {
            truncateReplayState: Frame & {
              currentAttempt: Frame
              attempts?: Set<Frame>
              pending?: Set<{ attempt: Frame }>
            }
          }
        ).truncateReplayState
        const frames = new Set([
          replayState,
          replayState.currentAttempt,
          ...(replayState.attempts ?? []),
          ...[...(replayState.pending ?? [])].map(({ attempt }) => attempt),
        ])
        return [...frames].flatMap((frame) => [
          ...(frame.failures?.values() ?? []),
        ])
      }
      const replaySource = async () => {
        begin()
        truncate()
        commit()
        await flushPromises()
      }

      try {
        subscription.requestSnapshot({
          where: failedWhere,
          optimizedOnly: false,
        })
        subscription.requestSnapshot({ where: peerWhere, optimizedOnly: false })
        await replaySource()
        // This is a retained-state witness, not a row oracle or GC benchmark.
        // Public rows cannot reveal a released owner held by an old error map.
        // Adapt this witness if the replay representation changes again.
        expect(retainedFailures()).toEqual([failure])
        if (scope === `pending`) await replaySource()
        subscription.releaseSnapshot(failedWhere)
        expect(retainedFailures()).toEqual([])
        expect(subscription.status).toBe(`loadingSubset`)
        replacement.resolve()
        pendingPeer.resolve()
        await flushPromises()
        expect(subscription.status).toBe(`ready`)
      } finally {
        replacement.resolve()
        pendingPeer.resolve()
        await flushPromises()
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )

  it(`does not start a queued replay after a newer truncate supersedes it`, async () => {
    let begin!: () => void
    let commit!: () => void
    let truncate!: () => void
    const replay = createDeferred<void>()
    const loadSignals: Array<AbortSignal | undefined> = []
    const collection = createCollection<ReplayRow>({
      id: `superseded-before-replay-setup`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: (operations) => {
          begin = operations.begin
          commit = operations.commit
          truncate = operations.truncate
          operations.markReady()
          return {
            loadSubset: ({ signal }) => {
              loadSignals.push(signal)
              return loadSignals.length === 1 ? true : replay.promise
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })

    try {
      subscription.requestSnapshot({ optimizedOnly: false })

      begin()
      truncate()
      commit()
      begin()
      truncate()
      commit()
      await flushPromises()

      expect(loadSignals).toHaveLength(2)
      expect(loadSignals[0]?.aborted).toBe(true)
      expect(loadSignals[1]?.aborted).toBe(false)
    } finally {
      replay.resolve()
      await flushPromises()
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it.each([
    `replay`,
    `additional demand`,
    `additional pending demand`,
  ] as const)(
    `aborts a %s acquisition before a reentrant newer truncate starts`,
    async (start) => {
      let begin!: () => void
      let write!: (
        message: ChangeMessageOrDeleteKeyMessage<ReplayRow, string>,
      ) => void
      let commit!: () => void
      let truncate!: () => void
      const olderReplay = createDeferred<void>()
      const newerReplay = createDeferred<void>()
      const predecessor = createDeferred<void>()
      const replaySignals: Array<AbortSignal | undefined> = []
      let loadCount = 0
      const collection = createCollection<ReplayRow>({
        id: `reentrant-newer-replay`,
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        sync: {
          sync: (operations) => {
            begin = operations.begin
            write = operations.write
            commit = operations.commit
            truncate = operations.truncate
            operations.markReady()
            return {
              loadSubset: ({ signal }) => {
                loadCount++
                if (loadCount === 1) {
                  begin()
                  write({ type: `insert`, value: { id: `one`, value: 0 } })
                  commit()
                  return true
                }

                if (loadCount === 2 && start !== `replay`) {
                  if (start === `additional pending demand`) {
                    return predecessor.promise
                  }
                  // A failed replay retains its public baseline after setup and
                  // all participants finish. Start the extra demand in that gap.
                  throw new Error(`retain the failed replay`)
                }
                replaySignals.push(signal)
                if (loadCount === (start === `replay` ? 2 : 3)) {
                  begin()
                  truncate()
                  commit()
                  return olderReplay.promise
                }
                return newerReplay.promise
              },
              unloadSubset: () => {},
            }
          },
        },
      })
      const visible = new Map<string | number, ReplayRow>()
      const subscription = collection.subscribeChanges((changes) => {
        recordPublishedChanges(visible, changes as Array<ReplayChange>)
      })

      const install = (value: number) => {
        begin()
        write({
          type: collection.has(`one`) ? `update` : `insert`,
          value: { id: `one`, value },
        })
        commit()
      }

      try {
        subscription.requestSnapshot({ optimizedOnly: false })
        expect(sortedRows(visible)).toEqual([{ id: `one`, value: 0 }])

        begin()
        truncate()
        commit()
        await flushPromises()

        if (start !== `replay`) {
          if (start === `additional demand`) {
            expect(subscription.lastError).toEqual(
              new Error(`retain the failed replay`),
            )
          }
          expect(sortedRows(visible)).toEqual([{ id: `one`, value: 0 }])
          subscription.requestSnapshot({
            where: new Func(`eq`, [new PropRef([`id`]), new Value(`two`)]),
            optimizedOnly: false,
          })
          await flushPromises()
        }

        expect(replaySignals).toHaveLength(start === `replay` ? 2 : 3)
        expect(replaySignals[0]?.aborted).toBe(true)
        expect(sortedRows(visible)).toEqual([{ id: `one`, value: 0 }])

        install(2)
        newerReplay.resolve()
        await flushPromises()
        if (start === `additional pending demand`) {
          expect(sortedRows(visible)).toEqual([{ id: `one`, value: 0 }])
          predecessor.resolve()
          await flushPromises()
          // The returning extra demand joined the retained old attempt. Its
          // transport still holds publication after that attempt's prior work.
          expect(sortedRows(visible)).toEqual([{ id: `one`, value: 0 }])
          expect(subscription.status).toBe(`loadingSubset`)
        } else {
          // A startup superseded before return does not hold publication. An
          // ordinary demand still owns its separate readiness participant.
          expect(sortedRows(visible)).toEqual([{ id: `one`, value: 2 }])
          expect(subscription.status).toBe(
            start === `replay` ? `ready` : `loadingSubset`,
          )
        }
        if (!replaySignals[0]?.aborted) install(1)
        olderReplay.resolve()
        await flushPromises()

        expect(sortedRows(visible)).toEqual([{ id: `one`, value: 2 }])
        expect(subscription.status).toBe(`ready`)
      } finally {
        predecessor.resolve()
        olderReplay.resolve()
        newerReplay.resolve()
        await flushPromises()
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )

  it(`does not retain replay work registered after its demand is released`, async () => {
    let begin!: () => void
    let write!: (
      message: ChangeMessageOrDeleteKeyMessage<ReplayRow, string>,
    ) => void
    let commit!: () => void
    let truncate!: () => void
    const firstWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`one`)])
    const secondWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`two`)])
    const releasedReplay = createDeferred<void>()
    let loadCount = 0
    const collection = createCollection<ReplayRow>({
      id: `released-during-replay-start`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: (operations) => {
          begin = operations.begin
          write = operations.write
          commit = operations.commit
          truncate = operations.truncate
          begin()
          write({ type: `insert`, value: { id: `one`, value: 1 } })
          write({ type: `insert`, value: { id: `two`, value: 1 } })
          commit()
          operations.markReady()
          return {
            loadSubset: () => {
              loadCount++
              if (loadCount <= 2) return true
              if (loadCount === 3) {
                subscription.releaseSnapshot(firstWhere)
                return releasedReplay.promise
              }
              begin()
              write({ type: `insert`, value: { id: `two`, value: 2 } })
              commit()
              return Promise.resolve()
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    const visible = new Map<string | number, ReplayRow>()
    const subscription = collection.subscribeChanges((changes) => {
      recordPublishedChanges(visible, changes as Array<ReplayChange>)
    })

    try {
      subscription.requestSnapshot({
        where: firstWhere,
        optimizedOnly: false,
      })
      subscription.requestSnapshot({
        where: secondWhere,
        optimizedOnly: false,
      })

      begin()
      truncate()
      commit()
      await flushPromises()

      expect(subscription.status).toBe(`ready`)
      expect(sortedRows(visible)).toEqual([{ id: `two`, value: 2 }])
    } finally {
      releasedReplay.resolve()
      await flushPromises()
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`finishes replay state and surfaces an async subscriber failure`, async () => {
    let begin!: () => void
    let write!: (
      message: ChangeMessageOrDeleteKeyMessage<ReplayRow, string>,
    ) => void
    let commit!: () => void
    let truncate!: () => void
    const replay = createDeferred<void>()
    const listenerFailure = new Error(`replay subscriber failed`)
    const queuedMicrotasks: Array<VoidFunction> = []
    let loadCount = 0
    let rejectReplacement = false
    const collection = createCollection<ReplayRow>({
      id: `async-replay-subscriber-failure`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: (operations) => {
          begin = operations.begin
          write = operations.write
          commit = operations.commit
          truncate = operations.truncate
          operations.markReady()
          return {
            loadSubset: () => {
              loadCount++
              if (loadCount === 1) {
                begin()
                write({ type: `insert`, value: { id: `one`, value: 1 } })
                commit()
                return true
              }
              return replay.promise
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    const visible = new Map<string | number, ReplayRow>()
    const subscription = collection.subscribeChanges((changes) => {
      recordPublishedChanges(visible, changes as Array<ReplayChange>)
      if (rejectReplacement) throw listenerFailure
    })

    try {
      subscription.requestSnapshot({ optimizedOnly: false })
      begin()
      truncate()
      commit()
      await flushPromises()

      begin()
      write({ type: `insert`, value: { id: `one`, value: 2 } })
      commit()
      rejectReplacement = true
      const queueMicrotaskSpy = vi
        .spyOn(globalThis, `queueMicrotask`)
        .mockImplementation((callback) => queuedMicrotasks.push(callback))
      try {
        replay.resolve()
        await flushPromises()

        expect(subscription.status).toBe(`ready`)
        expect(sortedRows(visible)).toEqual([{ id: `one`, value: 2 }])
        expect(queuedMicrotasks).toHaveLength(1)
        expect(() => queuedMicrotasks[0]!()).toThrow(listenerFailure)
      } finally {
        queueMicrotaskSpy.mockRestore()
      }
    } finally {
      replay.resolve()
      await flushPromises()
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`does not start another demand for a replay superseded by reentrancy`, async () => {
    let begin!: () => void
    let write!: (
      message: ChangeMessageOrDeleteKeyMessage<ReplayRow, string>,
    ) => void
    let commit!: () => void
    let truncate!: () => void
    const firstWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`one`)])
    const secondWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`two`)])
    let loadCount = 0
    let inSupersededSetup = false
    let staleSecondDemandStarted = false
    const collection = createCollection<ReplayRow>({
      id: `reentrant-multi-demand-replay`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: (operations) => {
          begin = operations.begin
          write = operations.write
          commit = operations.commit
          truncate = operations.truncate
          begin()
          write({ type: `insert`, value: { id: `one`, value: 0 } })
          write({ type: `insert`, value: { id: `two`, value: 0 } })
          commit()
          operations.markReady()
          return {
            loadSubset: (options) => {
              loadCount++
              if (loadCount <= 2) return true
              if (loadCount === 3) {
                inSupersededSetup = true
                queueMicrotask(() => {
                  inSupersededSetup = false
                })
                begin()
                truncate()
                commit()
                return true
              }
              if (inSupersededSetup) {
                staleSecondDemandStarted = true
                begin()
                write({ type: `insert`, value: { id: `two`, value: 1 } })
                commit()
                return true
              }
              if (options.where === firstWhere) {
                begin()
                write({ type: `insert`, value: { id: `one`, value: 2 } })
                commit()
              }
              return true
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    const visible = new Map<string | number, ReplayRow>()
    const subscription = collection.subscribeChanges((changes) => {
      recordPublishedChanges(visible, changes as Array<ReplayChange>)
    })

    try {
      subscription.requestSnapshot({
        where: firstWhere,
        optimizedOnly: false,
      })
      subscription.requestSnapshot({
        where: secondWhere,
        optimizedOnly: false,
      })
      begin()
      truncate()
      commit()
      await flushPromises()

      expect(staleSecondDemandStarted).toBe(false)
      expect(sortedRows(visible)).toEqual([{ id: `one`, value: 2 }])
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`does not start replay work retired by the loading transition`, async () => {
    let begin!: () => void
    let commit!: () => void
    let truncate!: () => void
    const replay = createDeferred<void>()
    const where = new Func(`eq`, [new PropRef([`id`]), new Value(`one`)])
    const loads: Array<LoadSubsetOptions> = []
    const unloads: Array<LoadSubsetOptions> = []
    const collection = createCollection<ReplayRow>({
      id: `reentrant-status-release`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: (operations) => {
          begin = operations.begin
          commit = operations.commit
          truncate = operations.truncate
          operations.markReady()
          return {
            loadSubset: (options) => {
              loads.push(options)
              return loads.length === 1 ? true : replay.promise
            },
            unloadSubset: (options) => unloads.push(options),
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })
    let releaseOnLoading = false
    subscription.on(`status:loadingSubset`, () => {
      if (releaseOnLoading) subscription.releaseSnapshot(where)
    })

    try {
      subscription.requestSnapshot({ where, optimizedOnly: false })
      releaseOnLoading = true
      begin()
      truncate()
      commit()
      await flushPromises()

      expect(loads).toHaveLength(1)
      expect(unloads).toEqual([loads[0]])
      expect(subscription.status).toBe(`ready`)
    } finally {
      replay.resolve()
      await flushPromises()
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`releases replay work when its final publication callback throws`, async () => {
    let begin!: () => void
    let write!: (
      message: ChangeMessageOrDeleteKeyMessage<ReplayRow, string>,
    ) => void
    let commit!: () => void
    let truncate!: () => void
    const replay = createDeferred<void>()
    const where = new Func(`eq`, [new PropRef([`id`]), new Value(`one`)])
    const loads: Array<LoadSubsetOptions> = []
    const unloads: Array<LoadSubsetOptions> = []
    const listenerFailure = new Error(`release publication failed`)
    let rejectReplacement = false
    const collection = createCollection<ReplayRow>({
      id: `replay-release-callback-cleanup`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: (operations) => {
          begin = operations.begin
          write = operations.write
          commit = operations.commit
          truncate = operations.truncate
          operations.markReady()
          return {
            loadSubset: (options) => {
              loads.push(options)
              if (loads.length === 1) {
                begin()
                write({ type: `insert`, value: { id: `one`, value: 1 } })
                commit()
                return true
              }
              return replay.promise
            },
            unloadSubset: (options) => unloads.push(options),
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {}, {
      truncateReplayPublication: {
        siblingReplays: () => undefined,
        start: () => {},
        succeed: () => {
          if (rejectReplacement) throw listenerFailure
        },
      },
    })

    try {
      subscription.requestSnapshot({ where, optimizedOnly: false })
      begin()
      truncate()
      commit()
      await flushPromises()
      begin()
      write({ type: `insert`, value: { id: `one`, value: 2 } })
      commit()
      rejectReplacement = true

      expect(() => subscription.releaseSnapshot(where)).toThrow(listenerFailure)
      expect(loads[1]?.signal?.aborted).toBe(true)
      expect(unloads.map((options) => loads.indexOf(options))).toEqual([0, 1])
      expect(subscription.status).toBe(`ready`)
    } finally {
      rejectReplacement = false
      replay.resolve()
      await flushPromises()
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`does not retain a demand released during adapter startup`, async () => {
    let begin!: () => void
    let commit!: () => void
    let truncate!: () => void
    const replay = createDeferred<void>()
    const releasedLoad = createDeferred<void>()
    const firstWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`one`)])
    const secondWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`two`)])
    const loads: Array<LoadSubsetOptions> = []
    const unloads: Array<LoadSubsetOptions> = []
    const collection = createCollection<ReplayRow>({
      id: `reentrant-new-demand-release`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: (operations) => {
          begin = operations.begin
          commit = operations.commit
          truncate = operations.truncate
          operations.markReady()
          return {
            loadSubset: (options) => {
              loads.push(options)
              if (loads.length === 1) return true
              if (loads.length === 2) return replay.promise
              subscription.releaseSnapshot(secondWhere)
              return releasedLoad.promise
            },
            unloadSubset: (options) => unloads.push(options),
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })

    try {
      subscription.requestSnapshot({
        where: firstWhere,
        optimizedOnly: false,
      })
      begin()
      truncate()
      commit()
      await flushPromises()

      subscription.requestSnapshot({
        where: secondWhere,
        optimizedOnly: false,
      })
      replay.resolve()
      await flushPromises()

      expect(loads).toHaveLength(3)
      expect(loads[2]?.signal?.aborted).toBe(true)
      expect(unloads).toContain(loads[2])
      expect(subscription.status).toBe(`ready`)
      expect(subscription.pendingTruncateReplacement).toBeUndefined()
    } finally {
      releasedLoad.resolve()
      replay.resolve()
      await flushPromises()
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`publishes a replay replacement before reporting ready`, async () => {
    let begin!: () => void
    let write!: (
      message: ChangeMessageOrDeleteKeyMessage<ReplayRow, string>,
    ) => void
    let commit!: () => void
    let truncate!: () => void
    const replay = createDeferred<void>()
    let loadCount = 0
    const collection = createCollection<ReplayRow>({
      id: `replay-ready-after-publication`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: (operations) => {
          begin = operations.begin
          write = operations.write
          commit = operations.commit
          truncate = operations.truncate
          operations.markReady()
          return {
            loadSubset: () => {
              loadCount++
              if (loadCount === 1) {
                begin()
                write({ type: `insert`, value: { id: `one`, value: 1 } })
                commit()
                return true
              }
              return replay.promise
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    const visible = new Map<string | number, ReplayRow>()
    const readyValues: Array<number | undefined> = []
    const subscription = collection.subscribeChanges((changes) => {
      recordPublishedChanges(visible, changes as Array<ReplayChange>)
    })
    subscription.on(`status:ready`, () => {
      readyValues.push(visible.get(`one`)?.value)
    })

    try {
      subscription.requestSnapshot({ optimizedOnly: false })
      begin()
      truncate()
      commit()
      await flushPromises()
      begin()
      write({ type: `insert`, value: { id: `one`, value: 2 } })
      commit()

      replay.resolve()
      await flushPromises()

      expect(readyValues).toEqual([2])
      expect(visible.get(`one`)?.value).toBe(2)
      expect(subscription.status).toBe(`ready`)
    } finally {
      replay.resolve()
      await flushPromises()
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`ignores a synchronous replay failure after its demand releases itself`, async () => {
    let begin!: () => void
    let write!: (
      message: ChangeMessageOrDeleteKeyMessage<ReplayRow, string>,
    ) => void
    let commit!: () => void
    let truncate!: () => void
    const firstWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`one`)])
    const secondWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`two`)])
    const releasedFailure = new Error(`released replay load failed`)
    const reportedErrors: Array<unknown> = []
    let loadCount = 0
    const collection = createCollection<ReplayRow>({
      id: `released-sync-failure`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: (operations) => {
          begin = operations.begin
          write = operations.write
          commit = operations.commit
          truncate = operations.truncate
          begin()
          write({ type: `insert`, value: { id: `one`, value: 1 } })
          write({ type: `insert`, value: { id: `two`, value: 1 } })
          commit()
          operations.markReady()
          return {
            loadSubset: () => {
              loadCount++
              if (loadCount <= 2) return true
              if (loadCount === 3) {
                subscription.releaseSnapshot(firstWhere)
                throw releasedFailure
              }
              begin()
              write({ type: `insert`, value: { id: `two`, value: 2 } })
              commit()
              return true
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    const visible = new Map<string | number, ReplayRow>()
    const subscription = collection.subscribeChanges((changes) => {
      recordPublishedChanges(visible, changes as Array<ReplayChange>)
    })
    subscription.on(`loadSubset:error`, ({ error }) => {
      reportedErrors.push(error)
    })

    try {
      subscription.requestSnapshot({
        where: firstWhere,
        optimizedOnly: false,
      })
      subscription.requestSnapshot({
        where: secondWhere,
        optimizedOnly: false,
      })
      begin()
      truncate()
      commit()
      await flushPromises()

      expect(reportedErrors).not.toContain(releasedFailure)
      expect(sortedRows(visible)).toEqual([{ id: `two`, value: 2 }])
      expect(subscription.status).toBe(`ready`)
      expect(subscription.pendingTruncateReplacement).toBeUndefined()
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it.each(
    [false, true].flatMap((releaseDemand) =>
      [false, true].map((failRelease) => ({ releaseDemand, failRelease })),
    ),
  )(
    `releases before reacquisition with releaseDemand=$releaseDemand and failRelease=$failRelease`,
    async ({ releaseDemand, failRelease }) => {
      let begin!: () => void
      let commit!: () => void
      let truncate!: () => void
      const where = new Func(`eq`, [new PropRef([`id`]), new Value(`one`)])
      const loads: Array<LoadSubsetOptions> = []
      const unloads: Array<LoadSubsetOptions> = []
      let reentered = false
      const releaseFailure = new Error(
        `old replay acquisition lease release failed`,
      )
      const collection = createCollection<ReplayRow>({
        id: `reentrant-replay-acquisition-lease-replacement`,
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        sync: {
          sync: (operations) => {
            begin = operations.begin
            commit = operations.commit
            truncate = operations.truncate
            operations.markReady()
            return {
              loadSubset: (options) => {
                loads.push(options)
                return true
              },
              unloadSubset: (options) => {
                unloads.push(options)
                if (options === loads[0] && !reentered) {
                  reentered = true
                  if (releaseDemand) subscription.releaseSnapshot(where)
                  if (failRelease) throw releaseFailure
                }
              },
            }
          },
        },
      })
      const subscription = collection.subscribeChanges(() => {}, {
        includeInitialState: false,
      })
      const uncaught = captureMicrotaskErrors()

      try {
        subscription.requestSnapshot({ where, optimizedOnly: false })
        begin()
        truncate()
        commit()
        await flushPromises()

        // A failed release is reported uncaught and still counts as released,
        // so only a retired logical demand stops the reacquisition.
        const reacquires = !releaseDemand
        expect(loads).toHaveLength(reacquires ? 2 : 1)
        // indexOf checks the exact options object, not a structurally equal copy.
        expect(unloads.map((options) => loads.indexOf(options))).toEqual([0])
        if (reacquires) expect(loads[1]!.signal?.aborted).toBe(false)
        expect(subscription.lastError).toBe(undefined)
        expect(uncaught.errors).toEqual(failRelease ? [releaseFailure] : [])
        subscription.unsubscribe()
        // A retired logical demand never starts a replacement.
        expect(unloads.map((options) => loads.indexOf(options))).toEqual(
          reacquires ? [0, 1] : [0],
        )
      } finally {
        uncaught.restore()
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )

  it(`rejects replay completion with the exact reported adapter error`, async () => {
    let begin!: () => void
    let commit!: () => void
    let truncate!: () => void
    const replayLoad = createDeferred<void>()
    const failure = new Error(`exact replay failure`)
    const reportedErrors: Array<unknown> = []
    let loadCount = 0
    const collection = createCollection<ReplayRow>({
      id: `exact-replay-completion-error`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: (operations) => {
          begin = operations.begin
          commit = operations.commit
          truncate = operations.truncate
          operations.markReady()
          return {
            loadSubset: () => (++loadCount === 1 ? true : replayLoad.promise),
            unloadSubset: () => {},
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
      truncateReplayPublication: {
        siblingReplays: () => undefined,
        start: () => {},
        succeed: () => {},
      },
    })
    subscription.on(`loadSubset:error`, ({ error }) => {
      reportedErrors.push(error)
    })

    try {
      subscription.requestSnapshot({ optimizedOnly: false })
      begin()
      truncate()
      commit()
      await flushPromises()
      const replacement = subscription.pendingTruncateReplacement
      expect(replacement).toBeInstanceOf(Promise)

      replayLoad.reject(failure)

      await expect(replacement).rejects.toBe(failure)
      expect(subscription.lastError).toBe(failure)
      expect(reportedErrors).toEqual([failure])
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`normalizes one primitive rejection for every observer of a shared replay`, async () => {
    let begin!: () => void
    let commit!: () => void
    let truncate!: () => void
    const replayLoad = createDeferred<void>()
    const firstWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`one`)])
    const secondWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`two`)])
    const loads: Array<LoadSubsetOptions> = []
    const reportedErrors: Array<{
      options: LoadSubsetOptions
      error: unknown
    }> = []
    let loadCount = 0
    const collection = createCollection<ReplayRow>({
      id: `shared-primitive-replay-error`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: (operations) => {
          begin = operations.begin
          commit = operations.commit
          truncate = operations.truncate
          operations.markReady()
          return {
            loadSubset: (options) => {
              loads.push(options)
              loadCount++
              return loadCount <= 2 ? true : replayLoad.promise
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
      truncateReplayPublication: {
        siblingReplays: () => undefined,
        start: () => {},
        succeed: () => {},
      },
    })
    subscription.on(`loadSubset:error`, ({ options, error }) => {
      reportedErrors.push({ options, error })
    })

    try {
      subscription.requestSnapshot({
        where: firstWhere,
        optimizedOnly: false,
      })
      subscription.requestSnapshot({
        where: secondWhere,
        optimizedOnly: false,
      })
      begin()
      truncate()
      commit()
      await flushPromises()
      const replacement = subscription.pendingTruncateReplacement
      expect(replacement).toBeInstanceOf(Promise)
      expect(loads.map(({ where }) => where)).toEqual([
        firstWhere,
        secondWhere,
        firstWhere,
        secondWhere,
      ])

      replayLoad.reject(undefined)

      let replacementError: unknown
      try {
        await replacement
      } catch (error) {
        replacementError = error
      }
      expect(reportedErrors).toHaveLength(2)
      expect(reportedErrors.map(({ options }) => options)).toEqual([
        loads[2],
        loads[3],
      ])
      expect(reportedErrors[0]?.error).toBeInstanceOf(Error)
      expect(reportedErrors[1]?.error).toBe(reportedErrors[0]?.error)
      expect(subscription.lastError).toBe(reportedErrors[0]?.error)
      expect(replacementError).toBe(reportedErrors[0]?.error)
    } finally {
      replayLoad.resolve()
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it.each([`none`, `first`, `second`, `both`] as const)(
    `normalizes one primitive rejection for ordinary shared loads after releasing %s demand`,
    async (released) => {
      const sharedLoad = createDeferred<void>()
      const firstWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`one`)])
      const secondWhere = new Func(`eq`, [
        new PropRef([`id`]),
        new Value(`two`),
      ])
      const loads: Array<LoadSubsetOptions> = []
      const unloads: Array<LoadSubsetOptions> = []
      const reportedErrors: Array<{
        options: LoadSubsetOptions
        error: unknown
      }> = []
      const collection = createCollection<ReplayRow>({
        id: `shared-primitive-ordinary-error-${released}`,
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        sync: {
          sync: (operations) => {
            operations.markReady()
            return {
              loadSubset: (options) => {
                loads.push(options)
                return sharedLoad.promise
              },
              unloadSubset: (options) => unloads.push(options),
            }
          },
        },
      })
      const subscription = collection.subscribeChanges(() => {}, {
        includeInitialState: false,
      })
      subscription.on(`loadSubset:error`, ({ options, error }) => {
        reportedErrors.push({ options, error })
      })

      try {
        subscription.requestSnapshot({ where: firstWhere })
        subscription.requestSnapshot({ where: secondWhere })
        expect(loads.map(({ where }) => where)).toEqual([
          firstWhere,
          secondWhere,
        ])

        if (released === `first` || released === `both`) {
          subscription.releaseSnapshot(firstWhere)
        }
        if (released === `second` || released === `both`) {
          subscription.releaseSnapshot(secondWhere)
        }
        expect(loads[0]?.signal?.aborted).toBe(
          released === `first` || released === `both`,
        )
        expect(loads[1]?.signal?.aborted).toBe(
          released === `second` || released === `both`,
        )

        sharedLoad.reject(undefined)
        await flushPromises()

        const activeLoads = loads.filter((load) => !load.signal?.aborted)
        expect(reportedErrors.map(({ options }) => options)).toEqual(
          activeLoads,
        )
        if (activeLoads.length > 0) {
          expect(reportedErrors[0]?.error).toBeInstanceOf(Error)
          for (const { error } of reportedErrors) {
            expect(error).toBe(reportedErrors[0]?.error)
          }
          expect(subscription.lastError).toBe(reportedErrors[0]?.error)
        } else {
          expect(subscription.lastError).toBeUndefined()
        }
        expect(subscription.status).toBe(`ready`)
      } finally {
        sharedLoad.resolve()
        subscription.unsubscribe()
        await collection.cleanup()
      }
      expect(unloads).toHaveLength(loads.length)
      for (const load of loads) {
        expect(unloads.filter((options) => options === load)).toHaveLength(1)
      }
    },
  )

  it.each([`first`, `second`, `both`] as const)(
    `settles a shared replay rejection after releasing %s demand`,
    async (released) => {
      let begin!: () => void
      let commit!: () => void
      let truncate!: () => void
      const replayLoad = createDeferred<void>()
      const firstWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`one`)])
      const secondWhere = new Func(`eq`, [
        new PropRef([`id`]),
        new Value(`two`),
      ])
      const loads: Array<LoadSubsetOptions> = []
      const unloads: Array<LoadSubsetOptions> = []
      const reportedErrors: Array<{
        options: LoadSubsetOptions
        error: unknown
      }> = []
      let loadCount = 0
      let replayStarts = 0
      let replaySuccesses = 0
      const collection = createCollection<ReplayRow>({
        id: `released-shared-primitive-replay-error-${released}`,
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        sync: {
          sync: (operations) => {
            begin = operations.begin
            commit = operations.commit
            truncate = operations.truncate
            operations.markReady()
            return {
              loadSubset: (options) => {
                loads.push(options)
                loadCount++
                return loadCount <= 2 ? true : replayLoad.promise
              },
              unloadSubset: (options) => unloads.push(options),
            }
          },
        },
      })
      const subscription = collection.subscribeChanges(() => {}, {
        includeInitialState: false,
        truncateReplayPublication: {
          siblingReplays: () => undefined,
          start: () => replayStarts++,
          succeed: () => replaySuccesses++,
        },
      })
      subscription.on(`loadSubset:error`, ({ options, error }) => {
        reportedErrors.push({ options, error })
      })

      try {
        subscription.requestSnapshot({ where: firstWhere })
        subscription.requestSnapshot({ where: secondWhere })
        begin()
        truncate()
        commit()
        await flushPromises()
        const replacement = subscription.pendingTruncateReplacement
        expect(replacement).toBeInstanceOf(Promise)
        expect(loads.map(({ where }) => where)).toEqual([
          firstWhere,
          secondWhere,
          firstWhere,
          secondWhere,
        ])
        const settlement = replacement!.then(
          () => ({ status: `resolved` as const }),
          (error: unknown) => ({ status: `rejected` as const, error }),
        )
        expect({ replayStarts, replaySuccesses }).toEqual({
          replayStarts: 1,
          replaySuccesses: 0,
        })

        if (released === `first` || released === `both`) {
          subscription.releaseSnapshot(firstWhere)
        }
        if (released === `second` || released === `both`) {
          subscription.releaseSnapshot(secondWhere)
        }
        expect(loads[2]?.signal?.aborted).toBe(
          released === `first` || released === `both`,
        )
        expect(loads[3]?.signal?.aborted).toBe(
          released === `second` || released === `both`,
        )

        if (released === `both`) {
          const result = await settlement
          expect(result).toMatchObject({
            status: `rejected`,
            error: { name: `AbortError` },
          })
          expect(reportedErrors).toEqual([])
          expect(subscription.lastError).toBeUndefined()
          expect(subscription.status).toBe(`ready`)
          expect(replaySuccesses).toBe(1)
        } else {
          expect(subscription.pendingTruncateReplacement).toBe(replacement)
          expect(subscription.status).toBe(`loadingSubset`)
          replayLoad.reject(undefined)
          const result = await settlement
          expect(result.status).toBe(`rejected`)

          const activeIndex = released === `first` ? 3 : 2
          expect(reportedErrors).toHaveLength(1)
          expect(reportedErrors[0]?.options).toBe(loads[activeIndex])
          expect(reportedErrors[0]?.error).toBeInstanceOf(Error)
          expect(subscription.lastError).toBe(reportedErrors[0]?.error)
          expect(result).toMatchObject({
            status: `rejected`,
            error: reportedErrors[0]?.error,
          })
        }
      } finally {
        replayLoad.resolve()
        subscription.unsubscribe()
        await collection.cleanup()
      }
      expect(unloads).toHaveLength(loads.length)
      for (const load of loads) {
        expect(unloads.filter((options) => options === load)).toHaveLength(1)
      }
      expect(replayStarts).toBe(1)
      expect(replaySuccesses).toBe(released === `both` ? 1 : 0)
    },
  )

  it(`ignores a retired demand's replay failure once surviving demand succeeds`, async () => {
    let begin!: () => void
    let commit!: () => void
    let truncate!: () => void
    const firstReplay = createDeferred<void>()
    const secondReplay = createDeferred<void>()
    const firstWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`one`)])
    const secondWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`two`)])
    const loads: Array<LoadSubsetOptions> = []
    const failure = new Error(`retired demand failed`)
    let replaySuccesses = 0
    const collection = createCollection<ReplayRow>({
      id: `retired-replay-failure`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: (operations) => {
          begin = operations.begin
          commit = operations.commit
          truncate = operations.truncate
          operations.markReady()
          return {
            loadSubset: (options) => {
              loads.push(options)
              if (loads.length <= 2) return true
              return loads.length === 3
                ? firstReplay.promise
                : secondReplay.promise
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
      truncateReplayPublication: {
        siblingReplays: () => undefined,
        start: () => {},
        succeed: () => replaySuccesses++,
      },
    })

    try {
      subscription.requestSnapshot({ where: firstWhere })
      subscription.requestSnapshot({ where: secondWhere })
      begin()
      truncate()
      commit()
      await flushPromises()
      const replacement = subscription.pendingTruncateReplacement
      expect(replacement).toBeInstanceOf(Promise)

      firstReplay.reject(failure)
      await flushPromises()
      subscription.releaseSnapshot(firstWhere)
      secondReplay.resolve()

      await expect(replacement).resolves.toBeUndefined()
      expect(replaySuccesses).toBe(1)
      expect(subscription.status).toBe(`ready`)
    } finally {
      firstReplay.resolve()
      secondReplay.resolve()
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`retains successful peer rows after failed replay demand retires`, async () => {
    let begin!: () => void
    let write!: (
      message: ChangeMessageOrDeleteKeyMessage<ReplayRow, string>,
    ) => void
    let commit!: () => void
    let truncate!: () => void
    const failed = createDeferred<void>()
    const successful = createDeferred<void>()
    const firstWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`one`)])
    const secondWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`two`)])
    const loads: Array<LoadSubsetOptions> = []
    const unloads: Array<LoadSubsetOptions> = []
    const visible = new Map<string | number, ReplayRow>()
    const batches: Array<Array<ReplayChange>> = []
    let survivingRows: Array<ReplayRow> = []
    const collection = createCollection<ReplayRow>({
      id: `settled-replay-peer`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: (operations) => {
          begin = operations.begin
          write = operations.write
          commit = operations.commit
          truncate = operations.truncate
          operations.markReady()
          return {
            loadSubset: (options) => {
              loads.push(options)
              const id = options.where === firstWhere ? `one` : `two`
              begin()
              write({
                type: `insert`,
                value: { id, value: loads.length <= 2 ? 1 : 2 },
              })
              commit()
              if (loads.length <= 2) return true
              return id === `one` ? failed.promise : successful.promise
            },
            unloadSubset: (options) => {
              unloads.push(options)
            },
          }
        },
      },
    })
    const subscription = collection.subscribeChanges((changes) => {
      batches.push(recordPublishedChanges(visible, changes))
    })
    try {
      subscription.requestSnapshot({ where: firstWhere })
      subscription.requestSnapshot({ where: secondWhere })
      expect(sortedRows(visible)).toEqual([
        { id: `one`, value: 1 },
        { id: `two`, value: 1 },
      ])
      begin()
      truncate()
      commit()
      await flushPromises()
      expect(loads).toHaveLength(4)
      failed.reject(new Error(`first demand replay failed`))
      successful.resolve()
      await flushPromises()
      expect(sortedRows(visible)).toEqual([
        { id: `one`, value: 1 },
        { id: `two`, value: 1 },
      ])
      subscription.releaseSnapshot(firstWhere)
      await flushPromises()
      // Retirement leaves only the successful demand. Its replacement rows
      // must survive failure handling for the now-retired peer.
      survivingRows = sortedRows(visible)
      subscription.releaseSnapshot(secondWhere)
      // Outside replay, release ends acquisition ownership; this adapter does
      // not evict its cached rows. The still-live subscriber observes deletion
      // when the source actually removes the row.
      expect(sortedRows(visible)).toEqual([
        { id: `one`, value: 2 },
        { id: `two`, value: 2 },
      ])
      begin()
      write({ type: `delete`, key: `two` })
      commit()
      expect(sortedRows(visible)).toEqual([{ id: `one`, value: 2 }])
    } finally {
      failed.resolve()
      successful.resolve()
      subscription.unsubscribe()
      await collection.cleanup()
    }
    expect(unloads).toHaveLength(4)
    for (const load of loads) {
      expect(unloads.filter((options) => options === load)).toHaveLength(1)
    }
    expect(survivingRows).toEqual([
      { id: `one`, value: 2 },
      { id: `two`, value: 2 },
    ])
  })

  it(`keeps replay completion failure separate from a peer release failure`, async () => {
    let begin!: () => void
    let commit!: () => void
    let truncate!: () => void
    const failed = createDeferred<void>()
    const peer = createDeferred<void>()
    const replayFailure = new Error(`replay failed`)
    const releaseFailure = new Error(`peer release failed`)
    const firstWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`one`)])
    const peerWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`two`)])
    const loads: Array<LoadSubsetOptions> = []
    const unloadAttempts: Array<LoadSubsetOptions> = []
    const unloaded: Array<LoadSubsetOptions> = []
    let failRelease = false
    const succeeded = vi.fn()
    const uncaught = captureMicrotaskErrors()
    const collection = createCollection<ReplayRow>({
      id: `replay-error-ownership`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: (operations) => {
          begin = operations.begin
          commit = operations.commit
          truncate = operations.truncate
          operations.markReady()
          return {
            loadSubset: (options) => {
              loads.push(options)
              if (loads.length <= 2) return true
              return options.where === firstWhere
                ? failed.promise
                : peer.promise
            },
            unloadSubset: (options) => {
              unloadAttempts.push(options)
              if (failRelease && options === loads[3]) {
                failRelease = false
                throw releaseFailure
              }
              unloaded.push(options)
            },
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
      truncateReplayPublication: {
        start: () => {},
        succeed: succeeded,
        siblingReplays: () => undefined,
      },
    })
    try {
      subscription.requestSnapshot({ where: firstWhere })
      subscription.requestSnapshot({ where: peerWhere })
      begin()
      truncate()
      commit()
      await flushPromises()
      expect(loads).toHaveLength(4)
      const completion = subscription.pendingTruncateReplacement
      expect(completion).toBeInstanceOf(Promise)
      const observed = completion!.then(
        () => ({ status: `resolved` as const }),
        (error: unknown) => ({ status: `rejected` as const, error }),
      )
      failed.reject(replayFailure)
      await flushPromises()
      failRelease = true
      // The release error goes uncaught; the replay keeps its own failure.
      expect(() => subscription.releaseSnapshot(peerWhere)).not.toThrow()
      await Promise.resolve()
      expect(uncaught.errors).toEqual([releaseFailure])
      expect(succeeded).not.toHaveBeenCalled()
      await expect(observed).resolves.toEqual({
        status: `rejected`,
        error: replayFailure,
      })
      const result = await observed
      expect(`error` in result ? result.error : undefined).toBe(replayFailure)
      peer.resolve()
      await flushPromises()
      await expect(observed).resolves.toEqual({
        status: `rejected`,
        error: replayFailure,
      })
    } finally {
      uncaught.restore()
      failed.resolve()
      peer.resolve()
      failRelease = false
      subscription.unsubscribe()
      await collection.cleanup()
    }
    expect(
      unloadAttempts.filter((options) => options === loads[3]),
    ).toHaveLength(1)
    expect(unloaded).toHaveLength(3)
    for (const load of loads) {
      expect(unloaded.filter((options) => options === load)).toHaveLength(
        load === loads[3] ? 0 : 1,
      )
    }
  })

  it(`waits for a new async demand acquired while unloading a replay acquisition lease`, async () => {
    let begin!: () => void
    let write!: (
      message: ChangeMessageOrDeleteKeyMessage<ReplayRow, string>,
    ) => void
    let commit!: () => void
    let truncate!: () => void
    const replay = createDeferred<void>()
    const nested = createDeferred<void>()
    const firstWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`one`)])
    const nestedWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`two`)])
    const loads: Array<LoadSubsetOptions> = []
    const unloads: Array<LoadSubsetOptions> = []
    const ready = vi.fn()
    const visible = new Map<string | number, ReplayRow>()
    const publications: Array<Array<ReplayRow>> = []
    const collection = createCollection<ReplayRow>({
      id: `replay-new-demand-readiness`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: (operations) => {
          begin = operations.begin
          write = operations.write
          commit = operations.commit
          truncate = operations.truncate
          operations.markReady()
          return {
            loadSubset: (options) => {
              loads.push(options)
              begin()
              write({
                type: `insert`,
                value: {
                  id: options.where === nestedWhere ? `two` : `one`,
                  value: loads.length === 1 ? 1 : 2,
                },
              })
              commit()
              if (loads.length === 1) return true
              return options.where === nestedWhere
                ? nested.promise
                : replay.promise
            },
            unloadSubset: (options) => {
              unloads.push(options)
              if (options === loads[0]) {
                subscription.requestSnapshot({ where: nestedWhere })
              }
            },
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(
      (changes) => {
        recordPublishedChanges(visible, changes)
        publications.push(sortedRows(visible))
      },
      { includeInitialState: false },
    )
    try {
      subscription.requestSnapshot({ where: firstWhere })
      publications.length = 0
      subscription.on(`status:ready`, ready)
      begin()
      truncate()
      commit()
      await flushPromises()
      expect(loads.map(({ where }) => where)).toEqual([
        firstWhere,
        nestedWhere,
        firstWhere,
      ])
      expect(unloads).toEqual([loads[0]])
      const completion = subscription.pendingTruncateReplacement
      expect(completion).toBeInstanceOf(Promise)
      const settled = vi.fn()
      void completion!.then(settled, settled)
      replay.resolve()
      await flushPromises()
      expect(subscription.status).not.toBe(`ready`)
      expect(ready).not.toHaveBeenCalled()
      expect(settled).not.toHaveBeenCalled()
      expect(sortedRows(visible)).toEqual([{ id: `one`, value: 1 }])
      expect(publications).toEqual([])
      nested.resolve()
      await completion
      await flushPromises()
      expect(subscription.status).toBe(`ready`)
      expect(ready).toHaveBeenCalledTimes(1)
      expect(settled).toHaveBeenCalledTimes(1)
      expect(sortedRows(visible)).toEqual([
        { id: `one`, value: 2 },
        { id: `two`, value: 2 },
      ])
      expect(publications).toEqual([
        [
          { id: `one`, value: 2 },
          { id: `two`, value: 2 },
        ],
      ])
    } finally {
      replay.resolve()
      nested.resolve()
      subscription.unsubscribe()
      await collection.cleanup()
    }
    expect(unloads).toHaveLength(3)
    for (const load of loads) {
      expect(unloads.filter((options) => options === load)).toHaveLength(1)
    }
  })

  it.each([`after-release`, `during-ready`, `during-unload`] as const)(
    `reacquires a final released replay demand %s without waiting for obsolete work`,
    async (reacquireTiming) => {
      let begin!: () => void
      let write!: (
        message: ChangeMessageOrDeleteKeyMessage<ReplayRow, string>,
      ) => void
      let commit!: () => void
      let truncate!: () => void
      const replayLoad = createDeferred<void>()
      const reacquiredLoad = createDeferred<void>()
      const where = new Func(`eq`, [new PropRef([`id`]), new Value(`one`)])
      const loads: Array<LoadSubsetOptions> = []
      const unloads: Array<LoadSubsetOptions> = []
      let reacquireOnReady = false
      let reacquireInUnload = false
      const collection = createCollection<ReplayRow>({
        id: `final-replay-reacquire-${reacquireTiming}`,
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        sync: {
          sync: (operations) => {
            begin = operations.begin
            write = operations.write
            commit = operations.commit
            truncate = operations.truncate
            operations.markReady()
            return {
              loadSubset: (options) => {
                loads.push(options)
                if (loads.length === 1) {
                  begin()
                  write({ type: `insert`, value: { id: `one`, value: 1 } })
                  commit()
                  return true
                }
                if (loads.length === 2) {
                  begin()
                  write({ type: `insert`, value: { id: `one`, value: 2 } })
                  commit()
                  return replayLoad.promise
                }
                return reacquireTiming === `during-unload`
                  ? reacquiredLoad.promise
                  : true
              },
              unloadSubset: (options) => {
                unloads.push(options)
                if (reacquireInUnload && options === loads[1]) {
                  reacquireInUnload = false
                  subscription.requestSnapshot({ where })
                }
              },
            }
          },
        },
      })
      const visible = new Map<string | number, ReplayRow>()
      const batches: Array<Array<ReplayChange>> = []
      const subscription: CollectionSubscription = collection.subscribeChanges(
        (changes) => {
          batches.push(recordPublishedChanges(visible, changes))
        },
      )
      const readyRows: Array<Array<ReplayRow>> = []
      subscription.on(`status:ready`, () => {
        readyRows.push(sortedRows(visible))
        if (reacquireOnReady) {
          reacquireOnReady = false
          subscription.requestSnapshot({ where })
        }
      })

      try {
        subscription.requestSnapshot({ where })
        begin()
        truncate()
        commit()
        await flushPromises()
        const replacement = subscription.pendingTruncateReplacement
        expect(replacement).toBeInstanceOf(Promise)
        const settlement = replacement!.then(
          () => ({ status: `resolved` as const }),
          (error: unknown) => ({ status: `rejected` as const, error }),
        )

        // Release has no synthetic delete callback. Reenter from its actual
        // ready notification instead; the old replay is already retired then.
        reacquireOnReady = reacquireTiming === `during-ready`
        reacquireInUnload = reacquireTiming === `during-unload`
        subscription.releaseSnapshot(where)
        // Releasing the final demand retires the replay, which publishes the
        // row it holds, so the replacement resolves.
        if (reacquireTiming === `after-release`) {
          await expect(settlement).resolves.toEqual({ status: `resolved` })
          subscription.requestSnapshot({ where })
        } else if (reacquireTiming === `during-unload`) {
          let settled = false
          void settlement.then(() => {
            settled = true
          })
          const batchesBeforePendingFlush = batches.length
          await flushPromises()
          expect(settled).toBe(false)
          expect(subscription.status).not.toBe(`ready`)
          expect(readyRows).toEqual([])
          expect(batches).toHaveLength(batchesBeforePendingFlush)
          const batchesBeforeObsoleteSettlement = batches.length
          replayLoad.resolve()
          await flushPromises()
          expect(settled).toBe(false)
          expect(subscription.status).not.toBe(`ready`)
          expect(readyRows).toEqual([])
          expect(batches).toHaveLength(batchesBeforeObsoleteSettlement)
          reacquiredLoad.resolve()
          await expect(settlement).resolves.toEqual({ status: `resolved` })
        } else {
          expect(subscription.pendingTruncateReplacement).toBeUndefined()
          await expect(settlement).resolves.toEqual({ status: `resolved` })
        }

        expect(subscription.pendingTruncateReplacement).toBeUndefined()
        expect(sortedRows(visible)).toEqual([{ id: `one`, value: 2 }])
        expect(sortedChanges(batches[0]!)).toEqual([
          { type: `insert`, key: `one`, value: { id: `one`, value: 1 } },
        ])
        // Retiring the replay publishes its applied row at the release; the
        // reacquired demand then has nothing new to deliver.
        expect(
          sortedChanges(batches.filter((batch) => batch.length > 0).at(-1)!),
        ).toEqual([
          {
            type: `update`,
            key: `one`,
            value: { id: `one`, value: 2 },
            previousValue: { id: `one`, value: 1 },
          },
        ])
        expect(batches.filter((batch) => batch.length > 0)).toHaveLength(2)
        expect(loads).toHaveLength(3)
        expect(loads.map(({ where: requestWhere }) => requestWhere)).toEqual([
          where,
          where,
          where,
        ])
        if (reacquireTiming === `during-unload`) {
          expect(readyRows).toEqual([[{ id: `one`, value: 2 }]])
        }
      } finally {
        replayLoad.resolve()
        reacquiredLoad.resolve()
        await flushPromises()
        subscription.unsubscribe()
        await collection.cleanup()
      }
      expect(unloads).toHaveLength(loads.length)
      for (const load of loads) {
        expect(unloads.filter((options) => options === load)).toHaveLength(1)
      }
    },
  )

  it(`does not start replacement work after release unsubscribes`, () => {
    const where = new Func(`eq`, [new PropRef([`id`]), new Value(`one`)])
    const loads: Array<LoadSubsetOptions> = []
    const unloads: Array<LoadSubsetOptions> = []
    const collection = createCollection<ReplayRow>({
      id: `reentrant-replacement-unsubscribe`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: (operations) => {
          operations.markReady()
          return {
            loadSubset: (options) => {
              loads.push(options)
              return true
            },
            unloadSubset: (options) => {
              unloads.push(options)
              subscription.unsubscribe()
            },
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })

    let release: (() => void) | undefined
    subscription.requestSnapshot({
      where,
      optimizedOnly: false,
      onLoadSubsetResult: (_result, _options, releaseDemand) => {
        release = releaseDemand
      },
    })
    expect(release).toBeTypeOf(`function`)
    release!()
    expect(
      subscription.requestSnapshot({
        where,
        optimizedOnly: false,
      }),
    ).toBe(false)

    expect(loads).toHaveLength(1)
    expect(unloads).toEqual([loads[0]])
  })

  it.each([`generic`, `specific`] as const)(
    `does not emit a stale specific status after reentrant release from a %s listener`,
    async (reentryEvent) => {
      const where = new Func(`eq`, [new PropRef([`id`]), new Value(`one`)])
      const load = createDeferred<void>()
      const collection = createCollection<ReplayRow>({
        id: `reentrant-specific-status`,
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        sync: {
          sync: (operations) => {
            operations.markReady()
            return {
              loadSubset: () => load.promise,
              unloadSubset: () => {},
            }
          },
        },
      })
      const subscription = collection.subscribeChanges(() => {}, {
        includeInitialState: false,
      })
      const observed: Array<{ event: string; current: string }> = []
      if (reentryEvent === `generic`) {
        subscription.on(`status:change`, ({ status }) => {
          if (status === `loadingSubset`) subscription.releaseSnapshot(where)
        })
      } else {
        subscription.on(`status:loadingSubset`, () => {
          subscription.releaseSnapshot(where)
        })
      }
      subscription.on(`status:loadingSubset`, ({ status }) => {
        observed.push({ event: status, current: subscription.status })
      })
      subscription.on(`status:ready`, ({ status }) => {
        observed.push({ event: status, current: subscription.status })
      })

      try {
        subscription.requestSnapshot({ where, optimizedOnly: false })
        expect(observed).toEqual([{ event: `ready`, current: `ready` }])
      } finally {
        load.resolve()
        await flushPromises()
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )

  it.each([`generic`, `specific`] as const)(
    `does not resume an obsolete status transition after %s-listener ABA reentry`,
    async (reentryEvent) => {
      const firstWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`one`)])
      const secondWhere = new Func(`eq`, [
        new PropRef([`id`]),
        new Value(`two`),
      ])
      const load = createDeferred<void>()
      const collection = createCollection<ReplayRow>({
        id: `reentrant-status-aba-${reentryEvent}`,
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        sync: {
          sync: (operations) => {
            operations.markReady()
            return {
              loadSubset: () => load.promise,
              unloadSubset: () => {},
            }
          },
        },
      })
      const subscription = collection.subscribeChanges(() => {}, {
        includeInitialState: false,
      })
      const trace: Array<string> = []
      let reentered = false
      const reenter = () => {
        if (reentered) return
        reentered = true
        subscription.releaseSnapshot(firstWhere)
        subscription.requestSnapshot({ where: secondWhere })
      }
      if (reentryEvent === `generic`) {
        subscription.on(`status:change`, ({ status }) => {
          if (status === `loadingSubset`) reenter()
        })
      } else {
        subscription.on(`status:loadingSubset`, reenter)
      }
      subscription.on(`status:change`, ({ previousStatus, status }) => {
        trace.push(
          `generic:${previousStatus}->${status}:${subscription.status}`,
        )
      })
      subscription.on(`status:loadingSubset`, () => {
        trace.push(`specific:loadingSubset:${subscription.status}`)
      })

      try {
        subscription.requestSnapshot({ where: firstWhere })

        expect(trace).toEqual(
          reentryEvent === `generic`
            ? [
                `generic:loadingSubset->ready:ready`,
                `generic:ready->loadingSubset:loadingSubset`,
                `specific:loadingSubset:loadingSubset`,
              ]
            : [
                `generic:ready->loadingSubset:loadingSubset`,
                `generic:loadingSubset->ready:ready`,
                `generic:ready->loadingSubset:loadingSubset`,
                `specific:loadingSubset:loadingSubset`,
              ],
        )
      } finally {
        load.resolve()
        await flushPromises()
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )

  it.each([`generic`, `specific`] as const)(
    `stops %s status delivery when an earlier ready listener unsubscribes`,
    async (reentryEvent) => {
      const where = new Func(`eq`, [new PropRef([`id`]), new Value(`one`)])
      const load = createDeferred<void>()
      const collection = createCollection<ReplayRow>({
        id: `reentrant-status-unsubscribe-${reentryEvent}`,
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        sync: {
          sync: (operations) => {
            operations.markReady()
            return {
              loadSubset: () => load.promise,
              unloadSubset: () => {},
            }
          },
        },
      })
      const subscription = collection.subscribeChanges(() => {}, {
        includeInitialState: false,
      })
      const trace: Array<string> = []
      const unsubscribe = () => {
        trace.push(`unsubscribe`)
        subscription.unsubscribe()
      }
      if (reentryEvent === `generic`) {
        subscription.on(`status:change`, ({ status }) => {
          if (status === `ready`) unsubscribe()
        })
      } else {
        subscription.on(`status:ready`, unsubscribe)
      }
      subscription.on(`status:change`, ({ status }) => {
        if (status === `ready`) trace.push(`late-generic`)
      })
      subscription.on(`status:ready`, () => trace.push(`late-specific`))
      subscription.on(`unsubscribed`, () => trace.push(`unsubscribed`))

      try {
        subscription.requestSnapshot({ where })
        load.resolve()
        await flushPromises()

        expect(trace).toEqual(
          reentryEvent === `generic`
            ? [`unsubscribe`, `unsubscribed`]
            : [`late-generic`, `unsubscribe`, `unsubscribed`],
        )
      } finally {
        load.resolve()
        await collection.cleanup()
      }
    },
  )

  // An open review finding, recorded in the coverage map (Ordered
  // acquisition). A demand that fails while a failed replay of another of the
  // query's subscriptions to the source holds publication fails this
  // subscription's replacement too. That hold lasts until a later replay of
  // the source succeeds or the subscription's last demand retires
  // (ARCHITECTURE.md, "Replay participants and failure"). The replay that
  // `failReplacement` creates records no failed demand, so a later demand
  // that joins it and settles completes it as a success: it publishes, and a
  // live query's `succeed` clears the failed demand's request error.
  // Maintainer decision: pinned and left unfixed for now.
  it.fails(
    `keeps a failed replacement's hold when a later demand settles`,
    async () => {
      const succeed = vi.fn()
      const collection = createCollection<{ id: string }>({
        id: `failed-replacement-hold`,
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {
              loadSubset: () => Promise.resolve(),
              unloadSubset: () => {},
            }
          },
        },
      })
      const subscription = collection.subscribeChanges(() => {}, {
        includeInitialState: false,
        truncateReplayPublication: {
          siblingReplays: () => undefined,
          start: () => {},
          succeed,
        },
      })

      try {
        subscription.failReplacement(new Error(`sibling replay failed`))
        subscription.requestSnapshot({
          where: new Func(`eq`, [new PropRef([`id`]), new Value(`two`)]),
          optimizedOnly: false,
        })
        await flushPromises()

        expect(succeed).not.toHaveBeenCalled()
        expect(subscription.hasFailedTruncateReplacement).toBe(true)
      } finally {
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )
})

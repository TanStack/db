import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection'
import { createDeferred } from '../src/deferred'
import { BasicIndex } from '../src/indexes/basic-index'
import { createLiveQueryCollection, eq } from '../src/query'
import { PropRef } from '../src/query/ir'
import { evaluateReferenceExpression } from './reference-expression'
import { flushPromises } from './utils'
import type { Deferred } from '../src/deferred'
import type { ChangeMessage, LoadSubsetOptions, SyncConfig } from '../src/types'

type Row = { id: number; version: number }
type Ops = Parameters<SyncConfig<Row, number>[`sync`]>[0]
type Batch = Array<[string, string | number, number]>

const idRef = () => new PropRef<number>([`id`])
const shape = (changes: Array<ChangeMessage<Row, string | number>>): Batch =>
  changes.map((c) => [c.type, c.key, c.value.version])

/** Retention witness: private replacement rows held per subscription. */
function replaySessions(collection: unknown) {
  const internals = collection as {
    _changes: {
      changeSubscriptions: Iterable<{
        options: { truncateReplayPublication?: unknown }
        truncateReplaySession?: { privateRows?: ReadonlyMap<unknown, unknown> }
      }>
    }
  }
  return [...internals._changes.changeSubscriptions].flatMap((s) =>
    s.truncateReplaySession
      ? [
          {
            delegated: Boolean(s.options.truncateReplayPublication),
            privateRows: s.truncateReplaySession.privateRows?.size ?? null,
          },
        ]
      : [],
  )
}

function makeSource(id: string) {
  let version = 1
  let hold: Deferred<void> | undefined
  let sync!: Ops
  const loads: Array<LoadSubsetOptions> = []
  const source = createCollection<Row, number>({
    id,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    autoIndex: `eager`,
    defaultIndexType: BasicIndex,
    sync: {
      sync: (operations) => {
        sync = operations
        operations.markReady()
        return {
          loadSubset: (options) => {
            loads.push(options)
            const ids = [1, 2, 3].filter(
              (rowId) =>
                !options.where ||
                evaluateReferenceExpression(options.where, {
                  id: rowId,
                  version,
                }),
            )
            operations.begin()
            for (const rowId of ids) {
              operations.write({
                type: source.has(rowId) ? `update` : `insert`,
                value: { id: rowId, version },
              })
            }
            operations.commit()
            return hold ? hold.promise : true
          },
          unloadSubset: () => {},
        }
      },
    },
  })
  return {
    source,
    loads,
    get sync() {
      return sync
    },
    setVersion: (next: number) => {
      version = next
    },
    setHold: (next: Deferred<void> | undefined) => {
      hold = next
    },
    truncate: () => {
      sync.begin()
      sync.truncate()
      sync.commit()
    },
  }
}

describe(`Replay publication storage`, () => {
  it(`direct: one replacement batch, healthy peers, late demand joins the barrier`, async () => {
    const s = makeSource(`probe-direct`)
    const batches: Array<Batch> = []
    const sub = s.source.subscribeChanges(
      (changes) => changes.length && batches.push(shape(changes)),
      { includeInitialState: false },
    )
    sub.requestSnapshot({ where: eq(idRef(), 1), optimizedOnly: false })
    sub.requestSnapshot({ where: eq(idRef(), 2), optimizedOnly: false })
    // A demand-free peer sees every source delta immediately.
    const peerBatches: Array<Batch> = []
    const peer = s.source.subscribeChanges(
      (changes) => changes.length && peerBatches.push(shape(changes)),
      { includeInitialState: false },
    )
    // A query peer over the same source uses the delegated publication path.
    const peerLive = createLiveQueryCollection((q) =>
      q.from({ row: s.source }).where(({ row }) => eq(row.id, 2)),
    )
    await peerLive.preload()
    expect(batches.flat()).toEqual([
      [`insert`, 1, 1],
      [`insert`, 2, 1],
    ])
    expect(peerLive.get(2)?.version).toBe(1)
    batches.length = 0
    peerBatches.length = 0

    s.setVersion(2)
    const hold = createDeferred<void>()
    s.setHold(hold)
    s.truncate()
    const completion = sub.pendingTruncateReplacement
    expect(completion).toBeInstanceOf(Promise)
    await flushPromises()
    expect(sub.status).toBe(`loadingSubset`)
    // No flash of missing content for the direct subscriber.
    expect(batches).toEqual([])
    // The query peer keeps its last complete result behind its own barrier.
    expect(peerLive.get(2)?.version).toBe(1)
    // The demand-free peer saw the truncate deletes and the reloads.
    expect(peerBatches.flat().sort()).toEqual(
      [
        [`delete`, 1, 1],
        [`delete`, 2, 1],
        [`insert`, 1, 2],
        [`insert`, 2, 2],
      ].sort(),
    )

    // Reentrant acquisition while the replay is open joins the barrier.
    sub.requestSnapshot({ where: eq(idRef(), 3), optimizedOnly: false })
    expect(batches).toEqual([])
    const retention = replaySessions(s.source)
    expect(retention).toContainEqual({ delegated: false, privateRows: 3 })
    expect(retention.filter((r) => r.delegated)).toHaveLength(1)

    hold.resolve()
    await flushPromises()
    await completion
    expect(sub.status).toBe(`ready`)
    expect(batches).toHaveLength(1)
    expect(batches[0]!.sort()).toEqual([
      [`insert`, 3, 2],
      [`update`, 1, 2],
      [`update`, 2, 2],
    ])
    expect(peerLive.get(2)?.version).toBe(2)
    expect(replaySessions(s.source)).toEqual([])

    // A later plain delta publishes normally.
    s.sync.begin()
    s.sync.write({ type: `update`, value: { id: 3, version: 5 } })
    s.sync.commit()
    expect(batches.at(-1)).toEqual([[`update`, 3, 5]])

    sub.unsubscribe()
    peer.unsubscribe()
    await peerLive.cleanup()
    await s.source.cleanup()
  })

  it(`direct: releasing the last demand during replay retires it; re-acquisition reconciles`, async () => {
    const s = makeSource(`probe-release`)
    const visible = new Map<string | number, number>()
    const batches: Array<Batch> = []
    const sub = s.source.subscribeChanges(
      (changes) => {
        changes.length && batches.push(shape(changes))
        for (const c of changes) {
          if (c.type === `delete`) visible.delete(c.key)
          else visible.set(c.key, c.value.version)
        }
      },
      { includeInitialState: false },
    )
    const where = eq(idRef(), 1)
    sub.requestSnapshot({ where, optimizedOnly: false })
    expect(visible.get(1)).toBe(1)

    s.setVersion(2)
    const hold = createDeferred<void>()
    s.setHold(hold)
    s.truncate()
    const settled = Promise.allSettled([sub.pendingTruncateReplacement])
    await flushPromises()
    expect(sub.status).toBe(`loadingSubset`)
    expect(s.source.get(1)?.version).toBe(2)
    expect(visible.get(1)).toBe(1)

    sub.releaseSnapshot(where)
    const [outcome] = await settled
    expect(outcome.status).toBe(`rejected`)
    expect((outcome as PromiseRejectedResult).reason.name).toBe(`AbortError`)
    expect(sub.status).toBe(`ready`)
    expect(sub.hasPendingTruncateReplacement).toBe(false)
    expect(visible.get(1)).toBe(1)
    expect(replaySessions(s.source)).toEqual([])

    // Late settlement of the released transport changes nothing.
    hold.resolve()
    await flushPromises()
    expect(visible.get(1)).toBe(1)
    expect(sub.status).toBe(`ready`)

    // Re-acquiring reconciles the retained row against the source.
    s.setHold(undefined)
    s.setVersion(3)
    sub.requestSnapshot({ where, optimizedOnly: false })
    await flushPromises()
    expect(visible.get(1)).toBe(3)
    expect(batches.at(-1)).toEqual([[`update`, 1, 3]])
    expect(sub.status).toBe(`ready`)

    sub.unsubscribe()
    await s.source.cleanup()
  })

  it(`direct: on-demand restart reacquires demand behind one private batch`, async () => {
    let loadCount = 0
    let ops!: Ops
    const batches: Array<Batch> = []
    const source = createCollection<Row, number>({
      id: `probe-restart-on-demand`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      sync: {
        sync: (operations) => {
          ops = operations
          operations.markReady()
          return {
            loadSubset: () => {
              loadCount++
              ops.begin()
              ops.write({
                type: `insert`,
                value: { id: 1, version: loadCount },
              })
              ops.commit()
              return true
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    const sub = source.subscribeChanges(
      (changes) => changes.length && batches.push(shape(changes)),
      { includeInitialState: false },
    )
    sub.requestSnapshot()
    expect(batches).toEqual([[[`insert`, 1, 1]]])

    await source.cleanup()
    source.startSyncImmediate()
    expect(sub.status).toBe(`loadingSubset`)
    await flushPromises()
    expect(loadCount).toBe(2)
    expect(sub.status).toBe(`ready`)
    expect(batches).toEqual([[[`insert`, 1, 1]], [[`update`, 1, 2]]])

    sub.unsubscribe()
    await source.cleanup()
  })

  it(`direct: eager restart reconciles retained rows on the next ready batch`, async () => {
    let session = 0
    const batches: Array<Batch> = []
    const source = createCollection<Row, number>({
      id: `probe-restart-eager`,
      getKey: (row) => row.id,
      sync: {
        sync: (operations) => {
          session++
          operations.begin()
          const rows =
            session === 1
              ? [
                  { id: 1, version: 1 },
                  { id: 2, version: 1 },
                ]
              : [{ id: 1, version: 2 }]
          for (const value of rows) operations.write({ type: `insert`, value })
          operations.commit()
          operations.markReady()
        },
      },
    })
    const sub = source.subscribeChanges(
      (changes) => changes.length && batches.push(shape(changes)),
      { includeInitialState: true },
    )
    expect(batches.flat().sort()).toEqual([
      [`insert`, 1, 1],
      [`insert`, 2, 1],
    ])
    batches.length = 0

    await source.cleanup()
    source.startSyncImmediate()
    await flushPromises()
    expect(batches).toHaveLength(1)
    expect(batches[0]!.sort()).toEqual([
      [`delete`, 2, 1],
      [`update`, 1, 2],
    ])
    expect(sub.status).toBe(`ready`)

    sub.unsubscribe()
    await source.cleanup()
  })
})

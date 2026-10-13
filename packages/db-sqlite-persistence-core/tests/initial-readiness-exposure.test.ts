import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { createCollection, createLiveQueryCollection, eq } from '@tanstack/db'
import { createDeferred } from '../../db/src/deferred.js'
import { persistedCollectionOptions } from '../src/index.js'
import type { Collection, LoadSubsetOptions } from '@tanstack/db'
import type {
  PersistedCollectionCoordinator,
  PersistenceAdapter,
  ProtocolEnvelope,
  TxCommitted,
} from '../src/index.js'

/**
 * # Does the persisted wrapper carry initial-query readiness?
 *
 * ARCHITECTURE.md law 10 makes a settled `loadSubset` the readiness evidence
 * for an on-demand source, and law 7 says a successful load settles only after
 * its rows are visible. The persisted wrapper composes two loads: it hydrates
 * the subset from local storage, then awaits the upstream source's load. The
 * upstream here never calls `markReady()`, as a progressive source would not
 * during its full sync. Each witness records the rows visible at the
 * query's first-ready transition.
 */

type Row = { id: string; group: string }

function storageAdapter(local: ReadonlyArray<Row>) {
  const read = createDeferred<void>()
  const adapter: PersistenceAdapter = {
    loadSubset: async () => {
      await read.promise
      return local.map((value) => ({ key: value.id, value }))
    },
    loadResumeSnapshot: () =>
      Promise.resolve({
        rows: [],
        keySet: { status: `consistent` },
        collectionMetadata: [],
        latestTerm: 0,
        latestSeq: 0,
        latestRowVersion: 0,
        resetEpoch: 0,
      }),
    applyCommittedTx: async () => {},
    ensureIndex: async () => {},
  }
  return { adapter, read }
}

type Upstream = {
  calls: Array<LoadSubsetOptions>
  respond: (rows: ReadonlyArray<Row>) => void
  fail: (error: unknown) => void
}

function persistedOnDemand(
  adapter: PersistenceAdapter,
): [Collection<Row, string, any>, Upstream] {
  let pending = createDeferred<void>()
  let write!: (rows: ReadonlyArray<Row>) => void
  const upstream: Upstream = {
    calls: [],
    respond: (rows) => {
      write(rows)
      pending.resolve()
    },
    fail: (error) => pending.reject(error),
  }
  const collection = createCollection(
    persistedCollectionOptions<Row, string>({
      id: `exposure-${Math.random().toString(36).slice(2)}`,
      getKey: (row) => row.id,
      persistence: { adapter },
      syncMode: `on-demand`,
      sync: {
        sync: (params) => {
          write = (rows) => {
            params.begin()
            for (const value of rows) params.write({ type: `insert`, value })
            params.commit()
          }
          return {
            loadSubset: (options: LoadSubsetOptions) => {
              upstream.calls.push(options)
              pending = createDeferred<void>()
              return pending.promise
            },
          }
        },
      },
    }),
  )
  onTestFinished(() => collection.cleanup())
  return [collection, upstream]
}

function groupA(source: Collection<Row, string, any>) {
  const query = createLiveQueryCollection((q) =>
    q.from({ row: source }).where(({ row }) => eq(row.group, `a`)),
  )
  onTestFinished(() => query.cleanup())
  return query
}

function rowsAtFirstReady(query: Collection<any, any, any>) {
  const seen: { rows?: Array<unknown> } = {}
  query.onFirstReady(() => {
    seen.rows = query.toArray.map((row: Row) => row.id).sort()
  })
  return seen
}

describe(`persisted on-demand initial readiness follows the composed load`, () => {
  it(`is first ready with local and upstream subset rows visible`, async () => {
    const storage = storageAdapter([{ id: `local`, group: `a` }])
    const [source, upstream] = persistedOnDemand(storage.adapter)
    const query = groupA(source)
    const seen = rowsAtFirstReady(query)
    const preload = query.preload()

    storage.read.resolve()
    await vi.waitFor(() => expect(upstream.calls).toHaveLength(1))
    expect(query.isReady()).toBe(false)
    upstream.respond([{ id: `remote`, group: `a` }])
    await preload

    expect(source.isReady()).toBe(false)
    expect(seen.rows).toEqual([`local`, `remote`])
  })

  it(`an upstream load failure errors the query and never readies it`, async () => {
    const storage = storageAdapter([])
    const [source, upstream] = persistedOnDemand(storage.adapter)
    const warned = vi.spyOn(console, `warn`).mockImplementation(() => {})
    const loggedError = vi.spyOn(console, `error`).mockImplementation(() => {})
    onTestFinished(() => {
      warned.mockRestore()
      loggedError.mockRestore()
    })
    const query = groupA(source)
    const seen = rowsAtFirstReady(query)
    void query.preload().catch(() => {})
    storage.read.resolve()
    await vi.waitFor(() => expect(upstream.calls).toHaveLength(1))
    upstream.fail(new Error(`upstream failed`))
    await vi.waitFor(() => expect(query.status).toBe(`error`))
    expect(seen.rows).toBeUndefined()
  })

  it(`a demand released during local hydration starts no upstream load`, async () => {
    const storage = storageAdapter([{ id: `local`, group: `a` }])
    const [source, upstream] = persistedOnDemand(storage.adapter)
    const query = groupA(source)
    void query.preload().catch(() => {})
    await new Promise((resolve) => setTimeout(resolve, 0))
    await query.cleanup()
    storage.read.resolve()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(upstream.calls.every((options) => options.signal?.aborted)).toBe(
      true,
    )
    expect(source.has(`remote`)).toBe(false)
  })
})

/**
 * A follower tab routes its demand to the elected leader. The leader loads the
 * rows upstream, commits them durably, and broadcasts `tx:committed` before it
 * answers the ensure request on the same channel. The follower applies that
 * broadcast asynchronously: it reads the durable rows under its apply mutex.
 * Law 7 therefore requires the follower's load to settle only after the
 * broadcasts that preceded the ensure reply have applied in this tab.
 *
 * The history holds the follower's durable read for the broadcast, so the
 * reply arrives while the leader's rows are committed but not yet visible.
 */
function followerTab() {
  const durable: Array<Row> = []
  let holdNextRead: Promise<void> | undefined
  let reads = 0
  const adapter: PersistenceAdapter = {
    loadSubset: async () => {
      reads++
      const hold = holdNextRead
      holdNextRead = undefined
      await hold
      return durable.map((value) => ({ key: value.id, value }))
    },
    loadResumeSnapshot: () =>
      Promise.resolve({
        rows: [],
        keySet: { status: `consistent` },
        collectionMetadata: [],
        latestTerm: 0,
        latestSeq: 0,
        latestRowVersion: 0,
        resetEpoch: 0,
      }),
    applyCommittedTx: async () => {},
    ensureIndex: async () => {},
  }
  const broadcastRead = createDeferred<void>()
  let subscriber: ((message: ProtocolEnvelope<unknown>) => void) | undefined
  const coordinator: PersistedCollectionCoordinator = {
    getNodeId: () => `follower`,
    subscribe: (_collectionId, onMessage) => {
      subscriber = onMessage
      return () => {
        subscriber = undefined
      }
    },
    publish: () => {},
    isLeader: () => false,
    ensureLeadership: async () => {},
    requestEnsurePersistedIndex: async () => {},
    // The leader commits the row, broadcasts it, then replies.
    requestEnsureRemoteSubset: (collectionId) => {
      const value = { id: `remote`, group: `a` }
      durable.push(value)
      holdNextRead = broadcastRead.promise
      const payload: TxCommitted = {
        type: `tx:committed`,
        term: 1,
        seq: 1,
        txId: `leader-tx-1`,
        latestRowVersion: 1,
        requiresFullReload: false,
        changedRows: [{ key: value.id, value }],
        deletedKeys: [],
      }
      subscriber?.({
        v: 1,
        dbName: `test-db`,
        collectionId,
        senderId: `leader`,
        ts: Date.now(),
        payload,
      })
      return Promise.resolve()
    },
    requestReleaseRemoteSubset: async () => {},
    registerRemoteSubsetOwner: () => () => {},
    requestApplyCommittedTx: (_collectionId, tx) =>
      Promise.resolve({
        type: `rpc:applyCommittedTx:res`,
        rpcId: tx.txId,
        ok: true,
        term: tx.term,
        seq: tx.seq,
        latestRowVersion: tx.rowVersion,
      }),
    pullSince: () =>
      Promise.resolve({
        type: `rpc:pullSince:res`,
        rpcId: `pull-0`,
        ok: true,
        latestTerm: 1,
        latestSeq: 0,
        latestRowVersion: 0,
        requiresFullReload: false,
        changedKeys: [],
        deletedKeys: [],
      }),
  }
  const source = createCollection(
    persistedCollectionOptions<Row, string>({
      id: `follower-${Math.random().toString(36).slice(2)}`,
      getKey: (row) => row.id,
      persistence: { adapter, coordinator },
      syncMode: `on-demand`,
      sync: {
        sync: () => ({ loadSubset: () => Promise.resolve() }),
      },
    }),
  )
  onTestFinished(() => source.cleanup())
  return { source, broadcastRead, reads: () => reads }
}

describe(`a persisted follower tab's load settles with the leader's rows`, () => {
  it(`is first ready only after the leader's broadcast applies here`, async () => {
    const tab = followerTab()
    const query = groupA(tab.source)
    const seen = rowsAtFirstReady(query)
    const preload = query.preload()

    // The hydration read and the broadcast's durable read have both started.
    await vi.waitFor(() => expect(tab.reads()).toBe(2))
    await new Promise((resolve) => setTimeout(resolve, 0))
    tab.broadcastRead.resolve()
    await preload

    expect(seen.rows).toEqual([`remote`])
  })
})

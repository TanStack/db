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
 * broadcasts that preceded the ensure reply have applied in this tab, and to
 * reject if applying them failed.
 *
 * The scripted tab can hold or fail any durable read by its order. A read
 * returns the durable rows as of its start, so a hydration read that began
 * before the leader committed cannot supply the leader's row.
 */
type ReadScript = (read: number) => { hold?: Promise<void>; fail?: Error }

function followerTab(
  script: ReadScript = () => ({}),
  beforeLeaderCommit: () => Promise<void> = () => Promise.resolve(),
  rotateAfterFirstRead = false,
) {
  const durable: Array<Row> = []
  let reads = 0
  // A managed cache claim that is lost right after the first read, so that
  // read is discarded and the demand reacquires under a rotated generation.
  let storageId = `follower-cache-1`
  let loseClaim = false
  const claim = () => ({
    storageCollectionId: storageId,
    claimId: `follower-claim`,
    expiresAtMs: Date.now() + 10_000,
  })
  const adapter: PersistenceAdapter = {
    loadSubset: async () => {
      const read = ++reads
      const snapshot = durable.slice()
      const { hold, fail } = script(read)
      await hold
      if (fail) throw fail
      if (rotateAfterFirstRead && read === 1) loseClaim = true
      return snapshot.map((value) => ({ key: value.id, value }))
    },
    ...(rotateAfterFirstRead
      ? {
          claimCacheGeneration: async () => claim(),
          renewCacheGenerationClaim: async () =>
            loseClaim ? undefined : Date.now() + 10_000,
          rotateCacheGeneration: async () => {
            loseClaim = false
            storageId = `follower-cache-2`
            return claim()
          },
          releaseCacheGenerationClaim: async () => {},
        }
      : {}),
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
  let subscriber: ((message: ProtocolEnvelope<unknown>) => void) | undefined
  let ensures = 0
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
    // On the first ensure, the leader commits the row, broadcasts it, then
    // replies. Later ensures find nothing new.
    requestEnsureRemoteSubset: async (collectionId) => {
      if (++ensures > 1) return
      await beforeLeaderCommit()
      const value = { id: `remote`, group: `a` }
      durable.push(value)
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
        sync: () => ({
          loadSubset: () => Promise.resolve(),
          restartAfterScopedRecovery: () => {},
        }),
      },
    }),
  )
  onTestFinished(() => source.cleanup())
  source.startSyncImmediate()
  return { source, reads: () => reads }
}

function groupB(source: Collection<Row, string, any>) {
  const query = createLiveQueryCollection((q) =>
    q.from({ row: source }).where(({ row }) => eq(row.group, `b`)),
  )
  onTestFinished(() => query.cleanup())
  return query
}

// Records a promise's outcome so a test can assert it at a checkpoint.
function outcome(promise: Promise<unknown>) {
  const record: { state: `pending` | `fulfilled` | `rejected` } = {
    state: `pending`,
  }
  void promise.then(
    () => (record.state = `fulfilled`),
    () => (record.state = `rejected`),
  )
  return record
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

function quietErrors() {
  const error = vi.spyOn(console, `error`).mockImplementation(() => {})
  const warn = vi.spyOn(console, `warn`).mockImplementation(() => {})
  onTestFinished(() => {
    error.mockRestore()
    warn.mockRestore()
  })
}

describe(`a persisted follower tab's load settles with the leader's rows`, () => {
  it(`is first ready only after the leader's broadcast applies here`, async () => {
    const broadcastRead = createDeferred<void>()
    // Read 1 hydrates the subset; read 2 applies the leader's broadcast.
    const tab = followerTab((read) =>
      read === 2 ? { hold: broadcastRead.promise } : {},
    )
    const query = groupA(tab.source)
    const seen = rowsAtFirstReady(query)
    const preload = query.preload()

    await vi.waitFor(() => expect(tab.reads()).toBe(2))
    await tick()
    // The leader has replied, but its rows are not visible here yet.
    expect(seen.rows).toBeUndefined()
    expect(query.isReady()).toBe(false)
    broadcastRead.resolve()
    await preload

    expect(seen.rows).toEqual([`remote`])
  })

  it(`is first ready with the leader's rows when their broadcast waits behind another subset's hydration`, async () => {
    const otherHydration = createDeferred<void>()
    const otherReadStarted = createDeferred<void>()
    // Read 1 hydrates group a; read 2 hydrates group b and is held, so the
    // leader's broadcast is queued; read 3 applies it.
    const tab = followerTab(
      (read) => {
        if (read !== 2) return {}
        otherReadStarted.resolve()
        return { hold: otherHydration.promise }
      },
      () => otherReadStarted.promise,
    )
    const query = groupA(tab.source)
    const seen = rowsAtFirstReady(query)
    const preload = query.preload()
    void groupB(tab.source).preload()

    await otherReadStarted.promise
    await tick()
    expect(seen.rows).toBeUndefined()
    otherHydration.resolve()
    await preload

    expect(seen.rows).toEqual([`remote`])
  })

  // Open, and the same on main: after the claim rotates, the reacquired
  // demand has not hydrated in the new generation, so the leader's broadcast
  // invalidates nothing and its row never becomes visible here. This pins the
  // gap; it also means the rotated route's wait has no distinguishing witness.
  it.fails(
    `settles a demand reacquired under a rotated cache with the leader's rows`,
    async () => {
      // The claim is lost right after read 1, so that read is discarded and
      // the demand reacquires under the rotated generation through the leader.
      const tab = followerTab(undefined, undefined, true)
      let visibleAtSettlement: boolean | undefined
      await Promise.resolve(tab.source._sync.loadSubset({ limit: 10 })).then(
        () => {
          visibleAtSettlement = tab.source.has(`remote`)
        },
      )

      expect(visibleAtSettlement).toBe(true)
    },
  )

  it(`rejects when the leader's broadcast fails to apply`, async () => {
    quietErrors()
    // Read 2 applies the leader's broadcast, and it fails.
    const tab = followerTab((read) =>
      read === 2 ? { fail: new Error(`durable read failed`) } : {},
    )
    const load = outcome(
      Promise.resolve(tab.source._sync.loadSubset({ limit: 10 })),
    )
    await vi.waitFor(() => expect(tab.reads()).toBe(2))
    await tick()
    await tick()

    expect(load.state).toBe(`rejected`)
    expect(tab.source.has(`remote`)).toBe(false)
  })

  it(`rejects and fails the source when a queued broadcast fails to apply`, async () => {
    quietErrors()
    const otherHydration = createDeferred<void>()
    const otherReadStarted = createDeferred<void>()
    // Read 2 holds another subset's hydration, so the broadcast is queued;
    // read 3 applies it, and it fails.
    const tab = followerTab(
      (read) => {
        if (read === 2) {
          otherReadStarted.resolve()
          return { hold: otherHydration.promise }
        }
        return read === 3 ? { fail: new Error(`durable read failed`) } : {}
      },
      () => otherReadStarted.promise,
    )
    const load = outcome(
      Promise.resolve(tab.source._sync.loadSubset({ limit: 10 })),
    )
    void Promise.resolve(
      tab.source._sync.loadSubset({ limit: 20, offset: 1 }),
    ).catch(() => {})
    await otherReadStarted.promise
    await tick()
    otherHydration.resolve()
    await vi.waitFor(() => expect(tab.reads()).toBe(3))
    await tick()
    await tick()

    expect(load.state).toBe(`rejected`)
    expect(tab.source.status).toBe(`error`)
  })
})

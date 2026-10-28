import { expect, it, vi } from 'vitest'
import { DbClient, collectionOptions, createCollection } from '@tanstack/db'
import { persistedCollectionOptions } from '../src'
import {
  atPersistedOracleCheckpoint,
  createCoordinatorHarness,
  createDeferred,
  createRecordingAdapter,
  flushAsyncWork,
} from './persisted-support'
import type { Todo, TodoSyncParams } from './persisted-support'

// Fixed witnesses for the sync metadata session through the persisted
// wrapper. The session law is owned by sync-metadata-session-oracle.ts and
// its persisted driver, sync-metadata-session-persisted.test.ts.

// A row another tab's source wrote in this run reaches this tab when it loads
// a new demand from storage. It is a source row, not a persisted cache row,
// so a later DbClient hydration seed cannot replace it (D4; decision 9 marks
// only previous runs' rows as seeds). Recorded in
// docs/contributing/oracle-reviews/2026-10-22-sync-metadata-session.md.
it.each([`named keys`, `a full reload`] as const)(
  `keeps a row another tab wrote this run when a later seed arrives (%s)`,
  async (notice) => {
    const adapter = createRecordingAdapter([])
    const coordinator = createCoordinatorHarness()
    const collectionId = `remote-write-then-seed`
    const client = new DbClient()
    let source!: TodoSyncParams
    const collection = client.collection(
      collectionOptions(
        persistedCollectionOptions<Todo, string>({
          id: collectionId,
          getKey: (row) => row.id,
          syncMode: `on-demand`,
          sync: {
            sync: (params) => {
              source = params
              params.markReady()
              return { loadSubset: () => true }
            },
          },
          persistence: { adapter, coordinator },
        }),
      ),
    )
    try {
      await atPersistedOracleCheckpoint(collection.preload(), `source ready`)
      adapter.rows.set(`remote`, { id: `remote`, title: `written by a peer` })
      adapter.rowMetadata.set(`remote`, { peer: true })
      coordinator.emit(
        {
          type: `tx:committed`,
          term: 1,
          seq: 1,
          txId: `peer-write`,
          latestRowVersion: 1,
          ...(notice === `named keys`
            ? {
                requiresFullReload: false as const,
                changedRows: [
                  {
                    key: `remote`,
                    value: { id: `remote`, title: `written by a peer` },
                  },
                ],
                deletedKeys: [],
              }
            : { requiresFullReload: true as const }),
        },
        `peer`,
        collectionId,
      )
      await flushAsyncWork()
      await atPersistedOracleCheckpoint(
        Promise.resolve(collection._sync.loadSubset({})),
        `demand loaded`,
      )
      await vi.waitFor(() =>
        expect(collection.get(`remote`)?.title).toBe(`written by a peer`),
      )
      client.hydrate({
        collections: [
          {
            collectionId,
            rows: [
              {
                key: `remote`,
                value: { id: `remote`, title: `stale seed` },
                metadata: { seeded: true },
              },
            ],
          },
        ],
      })
      await flushAsyncWork()
      // The peer wrote the row and its metadata, so the seed supplies neither.
      expect({
        title: collection.get(`remote`)?.title,
        metadata: source.metadata?.row.get(`remote`),
      }).toEqual({ title: `written by a peer`, metadata: { peer: true } })
    } finally {
      await client.cleanup()
    }
  },
)

// A source transaction committed while a storage read runs waits, before
// its durable step, until the read ends. Aborting its signal then abandons it
// (the commit contract: an abort before acceptance). An enclosing open
// transaction's inserts were judged against it, so they are judged again
// without it: here the enclosing insert clears metadata once more.
it(`judges enclosing inserts again when a buffered inner transaction is abandoned`, async () => {
  const adapter = createRecordingAdapter([])
  let source!: TodoSyncParams
  const collection = createCollection(
    persistedCollectionOptions<Todo, string>({
      id: `abandoned-buffered-inner`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      sync: {
        sync: (params) => {
          source = params
          params.markReady()
          return { loadSubset: () => true }
        },
      },
      persistence: { adapter },
    }),
  )
  await atPersistedOracleCheckpoint(collection.preload(), `source ready`)
  source.begin()
  source.write({
    type: `insert`,
    value: { id: `1`, title: `first` },
    metadata: { m: 0 },
  })
  await atPersistedOracleCheckpoint(
    Promise.resolve(source.commit()),
    `first row applied`,
  )
  source.begin()
  source.write({ type: `insert`, value: { id: `1`, title: `second` } })
  expect(source.metadata?.row.get(`1`)).toBeUndefined()
  const gate = createDeferred()
  const loadSubset = adapter.loadSubset
  adapter.loadSubset = async (...args) => {
    await gate.promise
    return loadSubset(...args)
  }
  const loading = Promise.resolve(collection._sync.loadSubset({ limit: 5 }))
  await flushAsyncWork()
  source.begin()
  source.write({ type: `insert`, value: { id: `1`, title: `second` } })
  const controller = new AbortController()
  const receipt = source.commit(controller.signal)
  // The inner equal re-insert commits ahead, so the enclosing insert keeps.
  expect(source.metadata?.row.get(`1`)).toEqual({ m: 0 })
  controller.abort()
  gate.resolve()
  await loading
  await expect(Promise.resolve(receipt)).rejects.toMatchObject({
    name: `AbortError`,
  })
  await flushAsyncWork()
  expect(source.metadata?.row.get(`1`)).toBeUndefined()
})

// A peer that deletes a row ends it for this session too. When this tab's
// storage read validates its public keys and finds the row gone, the delete
// is a source delete, so a later DbClient hydration seed cannot bring the row
// back (D4). Recorded in
// docs/contributing/oracle-reviews/2026-10-22-sync-metadata-session.md.
it(`keeps a row a peer deleted absent when a later seed arrives`, async () => {
  const adapter = createRecordingAdapter([{ id: `cached`, title: `cached` }])
  const coordinator = createCoordinatorHarness()
  const collectionId = `peer-delete-then-seed`
  const client = new DbClient()
  const collection = client.collection(
    collectionOptions(
      persistedCollectionOptions<Todo, string>({
        id: collectionId,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          sync: (params) => {
            params.markReady()
            return { loadSubset: () => true }
          },
        },
        persistence: { adapter, coordinator },
      }),
    ),
  )
  try {
    await atPersistedOracleCheckpoint(collection.preload(), `source ready`)
    const demand = {}
    await atPersistedOracleCheckpoint(
      Promise.resolve(collection._sync.loadSubset(demand)),
      `cached row loaded`,
    )
    expect(collection.get(`cached`)?.title).toBe(`cached`)
    collection._sync.unloadSubset(demand)
    adapter.rows.delete(`cached`)
    coordinator.emit(
      {
        type: `tx:committed`,
        term: 1,
        seq: 1,
        txId: `peer-delete`,
        latestRowVersion: 1,
        requiresFullReload: true,
      },
      `peer`,
      collectionId,
    )
    await vi.waitFor(() => expect(collection.has(`cached`)).toBe(false))
    client.hydrate({
      collections: [
        {
          collectionId,
          rows: [
            { key: `cached`, value: { id: `cached`, title: `stale seed` } },
          ],
        },
      ],
    })
    await flushAsyncWork()
    expect(collection.has(`cached`)).toBe(false)
  } finally {
    await client.cleanup()
  }
})

// Writes while a storage read is in flight follow the same metadata rules as
// other writes: the last write for a key wins, so an insert without metadata
// clears an explicit write before it, and the source reads that clear
// (read-your-writes). Recorded in
// docs/contributing/oracle-reviews/2026-10-22-sync-metadata-session.md.
it(`clears an explicit metadata write with a later insert during a storage read`, async () => {
  const adapter = createRecordingAdapter([])
  let source!: TodoSyncParams
  const collection = createCollection(
    persistedCollectionOptions<Todo, string>({
      id: `insert-clears-during-read`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      sync: {
        sync: (params) => {
          source = params
          params.markReady()
          return { loadSubset: () => true }
        },
      },
      persistence: { adapter },
    }),
  )
  await atPersistedOracleCheckpoint(collection.preload(), `source ready`)
  source.begin()
  source.write({
    type: `insert`,
    value: { id: `1`, title: `first` },
    metadata: { m: 0 },
  })
  await atPersistedOracleCheckpoint(
    Promise.resolve(source.commit()),
    `first row applied`,
  )
  const gate = createDeferred()
  const loadSubset = adapter.loadSubset
  adapter.loadSubset = async (...args) => {
    await gate.promise
    return loadSubset(...args)
  }
  const loading = Promise.resolve(collection._sync.loadSubset({ limit: 5 }))
  await flushAsyncWork()
  source.begin()
  source.metadata?.row.set(`1`, { explicit: true })
  source.write({ type: `insert`, value: { id: `1`, title: `second` } })
  expect(source.metadata?.row.get(`1`)).toBeUndefined()
  const receipt = source.commit()
  gate.resolve()
  await loading
  await receipt
  await flushAsyncWork()
  expect(source.metadata?.row.get(`1`)).toBeUndefined()
})

// A peer's write in this run replaces a DbClient seed this tab already holds
// (decision 11), and a later seed does not bring the old seed back. An equal
// re-insert of the peer's row by this tab's source keeps its metadata, as an
// equal re-insert of a source row does. Recorded in
// docs/contributing/oracle-reviews/2026-10-22-sync-metadata-session.md.
it.each([
  `replaces a held seed`,
  `keeps metadata on an equal re-insert`,
] as const)(
  `treats a row a peer wrote this run as a source row (%s)`,
  async (check) => {
    const adapter = createRecordingAdapter([])
    const coordinator = createCoordinatorHarness()
    const collectionId = `peer-row-is-source-${check.replace(/ /g, `-`)}`
    const client = new DbClient()
    let source!: TodoSyncParams
    const collection = client.collection(
      collectionOptions(
        persistedCollectionOptions<Todo, string>({
          id: collectionId,
          getKey: (row) => row.id,
          syncMode: `on-demand`,
          sync: {
            sync: (params) => {
              source = params
              params.markReady()
              return { loadSubset: () => true }
            },
          },
          persistence: { adapter, coordinator },
        }),
      ),
    )
    try {
      await atPersistedOracleCheckpoint(collection.preload(), `source ready`)
      if (check === `replaces a held seed`)
        client.hydrate({
          collections: [
            {
              collectionId,
              rows: [
                {
                  key: `remote`,
                  value: { id: `remote`, title: `earlier seed` },
                  metadata: { seed: 0 },
                },
              ],
            },
          ],
        })
      await flushAsyncWork()
      adapter.rows.set(`remote`, { id: `remote`, title: `written by a peer` })
      adapter.rowMetadata.set(`remote`, { peer: true })
      coordinator.emit(
        {
          type: `tx:committed`,
          term: 1,
          seq: 1,
          txId: `peer-write`,
          latestRowVersion: 1,
          requiresFullReload: false,
          changedRows: [
            {
              key: `remote`,
              value: { id: `remote`, title: `written by a peer` },
            },
          ],
          deletedKeys: [],
        },
        `peer`,
        collectionId,
      )
      await flushAsyncWork()
      await atPersistedOracleCheckpoint(
        Promise.resolve(collection._sync.loadSubset({})),
        `demand loaded`,
      )
      await vi.waitFor(() =>
        expect(collection.get(`remote`)?.title).toBe(`written by a peer`),
      )
      if (check === `replaces a held seed`) {
        client.hydrate({
          collections: [
            {
              collectionId,
              rows: [
                {
                  key: `remote`,
                  value: { id: `remote`, title: `stale seed` },
                  metadata: { seeded: true },
                },
              ],
            },
          ],
        })
      } else {
        source.begin()
        source.write({
          type: `insert`,
          value: { id: `remote`, title: `written by a peer` },
        })
        await atPersistedOracleCheckpoint(
          Promise.resolve(source.commit()),
          `equal re-insert applied`,
        )
      }
      await flushAsyncWork()
      expect({
        title: collection.get(`remote`)?.title,
        metadata: source.metadata?.row.get(`remote`),
      }).toEqual({ title: `written by a peer`, metadata: { peer: true } })
    } finally {
      await client.cleanup()
    }
  },
)

// Peer writes in this run, per object and per route (decision 11). A peer's
// notice can name only row metadata; a peer's write can reach this tab only
// through a reload after a gap the catch-up cannot fill; and a peer's row can
// arrive while this tab's source has an open insert of the same key.
// Recorded in docs/contributing/oracle-reviews/
// 2026-10-22-sync-metadata-session.md.
it.each([
  `metadata-only notice over a held seed`,
  `write whose notice was missed`,
  `peer row during an open insert`,
] as const)(
  `treats a peer's write in this run as a source write (%s)`,
  async (variant) => {
    const adapter = createRecordingAdapter([])
    const coordinator = createCoordinatorHarness()
    const collectionId = `peer-route-${variant.replace(/ /g, `-`)}`
    const client = new DbClient()
    let source!: TodoSyncParams
    const collection = client.collection(
      collectionOptions(
        persistedCollectionOptions<Todo, string>({
          id: collectionId,
          getKey: (row) => row.id,
          syncMode: `on-demand`,
          sync: {
            sync: (params) => {
              source = params
              params.markReady()
              return { loadSubset: () => true }
            },
          },
          persistence: { adapter, coordinator },
        }),
      ),
    )
    const seed = (title: string, metadata: Record<string, unknown>) =>
      client.hydrate({
        collections: [
          {
            collectionId,
            rows: [{ key: `k`, value: { id: `k`, title }, metadata }],
          },
        ],
      })
    const observe = () => ({
      title: collection.get(`k`)?.title,
      metadata: source.metadata?.row.get(`k`),
    })
    try {
      await atPersistedOracleCheckpoint(collection.preload(), `source ready`)
      if (variant === `metadata-only notice over a held seed`) {
        seed(`held seed`, { seed: 0 })
        await flushAsyncWork()
        adapter.rowMetadata.set(`k`, { peer: true })
        coordinator.emit(
          {
            type: `tx:committed`,
            term: 1,
            seq: 1,
            txId: `peer-metadata`,
            latestRowVersion: 1,
            requiresFullReload: false,
            changedRows: [],
            deletedKeys: [],
            rowMetadataMutations: [
              { type: `set`, key: `k`, value: { peer: true } },
            ],
          },
          `peer`,
          collectionId,
        )
        await flushAsyncWork()
        seed(`late seed`, { seeded: true })
        await flushAsyncWork()
        // The peer wrote only metadata, so the row stays a seed's and the
        // later seed wins it; the peer's metadata stays.
        expect(observe()).toEqual({
          title: `late seed`,
          metadata: { peer: true },
        })
      } else if (variant === `write whose notice was missed`) {
        coordinator.setPullSinceResponse({
          type: `rpc:pullSince:res`,
          rpcId: `pull-failed`,
          ok: false,
          error: `unavailable`,
        } as never)
        // The notice for the peer's write of `k` never arrives. The next
        // notice names another key and reveals the gap.
        adapter.rows.set(`k`, { id: `k`, title: `written by a peer` })
        adapter.rowMetadata.set(`k`, { peer: true })
        adapter.rows.set(`other`, { id: `other`, title: `later peer write` })
        coordinator.emit(
          {
            type: `tx:committed`,
            term: 1,
            seq: 3,
            txId: `peer-after-gap`,
            latestRowVersion: 3,
            requiresFullReload: false,
            changedRows: [
              {
                key: `other`,
                value: { id: `other`, title: `later peer write` },
              },
            ],
            deletedKeys: [],
          },
          `peer`,
          collectionId,
        )
        await flushAsyncWork()
        await atPersistedOracleCheckpoint(
          Promise.resolve(collection._sync.loadSubset({})),
          `demand loaded`,
        )
        await vi.waitFor(() =>
          expect(collection.get(`k`)?.title).toBe(`written by a peer`),
        )
        seed(`stale seed`, { seeded: true })
        await flushAsyncWork()
        expect(observe()).toEqual({
          title: `written by a peer`,
          metadata: { peer: true },
        })
      } else {
        await atPersistedOracleCheckpoint(
          Promise.resolve(collection._sync.loadSubset({})),
          `demand loaded`,
        )
        source.begin()
        source.write({ type: `insert`, value: { id: `k`, title: `mine` } })
        await atPersistedOracleCheckpoint(
          Promise.resolve(source.commit()),
          `first row applied`,
        )
        source.begin()
        // An equal re-insert of this tab's row, judged before the peer writes.
        source.write({ type: `insert`, value: { id: `k`, title: `mine` } })
        adapter.rows.set(`k`, { id: `k`, title: `written by a peer` })
        adapter.rowMetadata.set(`k`, { peer: true })
        coordinator.emit(
          {
            type: `tx:committed`,
            term: 1,
            seq: 2,
            txId: `peer-during-open-insert`,
            latestRowVersion: 2,
            requiresFullReload: false,
            changedRows: [
              { key: `k`, value: { id: `k`, title: `written by a peer` } },
            ],
            deletedKeys: [],
            rowMetadataMutations: [
              { type: `set`, key: `k`, value: { peer: true } },
            ],
          },
          `peer`,
          collectionId,
        )
        await flushAsyncWork()
        // The peer's row lands ahead of the open insert, which now changes
        // the row it lands on, so the insert clears metadata (decisions 7,
        // 10, and 11); the source reads its own open clear.
        expect(observe()).toEqual({
          title: `written by a peer`,
          metadata: undefined,
        })
        await atPersistedOracleCheckpoint(
          Promise.resolve(source.commit()),
          `insert applied`,
        )
        await flushAsyncWork()
        expect(observe()).toEqual({ title: `mine`, metadata: undefined })
      }
    } finally {
      await client.cleanup()
    }
  },
)

// A peer's notice can make this tab reload its demand from storage instead of
// applying the notice's rows: when it names a row this tab shows, names a
// key no demand has seen, or names more keys than a targeted update allows.
// A reload is how this tab reads storage again; it is not a source write. A
// stored row from a previous run that no source wrote in this run stays a
// seed across it, so a later `DbClient` seed still replaces it (decision 9),
// while a row the notice names is a source write that the seed cannot
// replace (decision 11). A key that storage never held is no source's
// write either, so a seed supplies it. After a full-reload notice this tab
// cannot tell which stored rows a source wrote, so a stored row counts as a
// source write only if it differs from the row this tab holds (decision
// 15): the peer's row does, the unchanged previous-run row stays a seed, and
// a later storage read for a new demand keeps that status. A row the peer
// deleted is a source's delete, so a later seed cannot bring it back (D4).
// Each variant
// reaches a different branch: no `DbClient` seed held, a held seed, a notice
// over the key limit, and unknown writes. Recorded in
// docs/contributing/oracle-reviews/2026-10-22-sync-metadata-session.md.
it.each([
  `notice naming a shown row`,
  `notice naming a shown row while a seed is held`,
  `notice over the targeted key limit`,
  `full-reload notice`,
  `full-reload notice, then a new demand reads the rows`,
] as const)(
  `keeps previous-run rows seeds across a reload a peer's notice causes (%s)`,
  async (variant) => {
    const adapter = createRecordingAdapter([
      { id: `cached`, title: `previous run` },
      { id: `shown`, title: `previous run` },
      { id: `gone`, title: `previous run` },
    ])
    adapter.rowMetadata.set(`cached`, { cached: true })
    adapter.rowMetadata.set(`shown`, { cached: true })
    const coordinator = createCoordinatorHarness()
    const collectionId = `reload-route-${variant.replace(/ /g, `-`)}`
    const client = new DbClient()
    let source!: TodoSyncParams
    const collection = client.collection(
      collectionOptions(
        persistedCollectionOptions<Todo, string>({
          id: collectionId,
          getKey: (row) => row.id,
          syncMode: `on-demand`,
          sync: {
            sync: (params) => {
              source = params
              params.markReady()
              return { loadSubset: () => true }
            },
          },
          persistence: { adapter, coordinator },
        }),
      ),
    )
    const seed = (key: string) =>
      client.hydrate({
        collections: [
          {
            collectionId,
            rows: [
              {
                key,
                value: { id: key, title: `later seed` },
                metadata: { seeded: true },
              },
            ],
          },
        ],
      })
    const observe = (key: string) => ({
      title: collection.get(key)?.title,
      metadata: source.metadata?.row.get(key),
    })
    try {
      await atPersistedOracleCheckpoint(collection.preload(), `source ready`)
      await atPersistedOracleCheckpoint(
        Promise.resolve(collection._sync.loadSubset({})),
        `demand loaded`,
      )
      await vi.waitFor(() =>
        expect(collection.get(`cached`)?.title).toBe(`previous run`),
      )
      if (variant === `notice naming a shown row while a seed is held`) {
        seed(`held`)
        await flushAsyncWork()
      }
      adapter.rows.set(`shown`, { id: `shown`, title: `written by a peer` })
      adapter.rowMetadata.set(`shown`, { peer: true })
      adapter.rows.delete(`gone`)
      const unseen = Array.from({ length: 129 }, (_, index) => ({
        key: `unseen-${index}`,
        value: { id: `unseen-${index}`, title: `written by a peer` },
      }))
      if (variant === `notice over the targeted key limit`)
        for (const row of unseen) adapter.rows.set(row.key, row.value)
      coordinator.emit(
        {
          type: `tx:committed`,
          term: 1,
          seq: 1,
          txId: `peer-write`,
          latestRowVersion: 1,
          ...(variant.startsWith(`full-reload notice`)
            ? { requiresFullReload: true as const }
            : {
                requiresFullReload: false as const,
                changedRows: [
                  {
                    key: `shown`,
                    value: { id: `shown`, title: `written by a peer` },
                  },
                  ...(variant === `notice over the targeted key limit`
                    ? unseen
                    : []),
                ],
                deletedKeys: [`gone`],
                rowMetadataMutations: [
                  { type: `set` as const, key: `shown`, value: { peer: true } },
                ],
              }),
        },
        `peer`,
        collectionId,
      )
      await vi.waitFor(() =>
        expect(collection.get(`shown`)?.title).toBe(`written by a peer`),
      )
      await flushAsyncWork()
      if (variant === `full-reload notice, then a new demand reads the rows`)
        await atPersistedOracleCheckpoint(
          Promise.resolve(collection._sync.loadSubset({ limit: 10 })),
          `new demand loaded`,
        )
      seed(`cached`)
      seed(`shown`)
      seed(`fresh`)
      seed(`gone`)
      await flushAsyncWork()
      expect({
        cached: observe(`cached`),
        shown: observe(`shown`),
        fresh: observe(`fresh`),
        gone: observe(`gone`),
      }).toEqual({
        cached: { title: `later seed`, metadata: { seeded: true } },
        shown: { title: `written by a peer`, metadata: { peer: true } },
        fresh: { title: `later seed`, metadata: { seeded: true } },
        gone: { title: undefined, metadata: undefined },
      })
    } finally {
      await client.cleanup()
    }
  },
)

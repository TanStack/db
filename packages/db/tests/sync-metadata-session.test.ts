import { describe, expect, it } from 'vitest'
import { DbClient, collectionOptions } from '../src/client.js'
import { createCollection } from '../src/collection/index.js'
import {
  createSessionModel,
  persistedPeerGrammar,
  runSessionHistory,
} from './sync-metadata-session-oracle.js'
import type { SessionDriver } from './sync-metadata-session-oracle.js'
import type { SyncConfig } from '../src/types.js'

// Fixed boundaries of the sync metadata session. The session law itself is
// owned by sync-metadata-session-oracle.ts and its generated histories.

type Row = { id: number; v: unknown }
type SyncActions = Parameters<SyncConfig<Row, number>[`sync`]>[0]

// This tests runner ordering, rather than introducing another product model.
it(`consumes completed setup inputs before authored actions`, async () => {
  const order: Array<string> = []
  let setup = true
  const observation = createSessionModel(persistedPeerGrammar).observe()
  const driver: SessionDriver = {
    begin: () => {
      order.push(`action`)
    },
    commit: () => {},
    cancel: () => {},
    rowSet: () => {},
    rowDelete: () => {},
    insert: () => {},
    update: () => {},
    delete: () => {},
    truncate: () => {},
    collectionSet: () => {},
    collectionDelete: () => {},
    hold: () => {},
    release: () => Promise.resolve(),
    flush: () => Promise.resolve(),
    settle: () => Promise.resolve([]),
    cleanup: () => Promise.resolve(),
    observe: () => observation,
    takeRecoveryInputs: () => {
      order.push(`recovery`)
      if (!setup) return []
      setup = false
      return [
        {
          type: `unknown-storage-observation`,
          fromRowVersion: 0,
          latestRowVersion: 1,
        },
      ]
    },
  }
  const result = await runSessionHistory(
    persistedPeerGrammar,
    [{ type: `begin` }],
    () => Promise.resolve(driver),
  )
  expect(result.mismatch).toBeUndefined()
  expect(order[0]).toBe(`recovery`)
  expect(order[1]).toBe(`action`)
  expect(result.recoveryInputs).toHaveLength(1)
})

/**
 * Boundary witnesses for P11. A sync run that cleanup has ended reads nothing
 * and ignores writes; a metadata write with no open transaction throws.
 */
describe(`sync metadata session boundaries`, () => {
  it(`a stale sync run reads nothing and ignores writes`, async () => {
    let sync!: SyncActions
    const collection = createCollection<Row, number>({
      id: `sync-metadata-session-stale`,
      getKey: (row) => row.id,
      startSync: true,
      sync: {
        sync: (actions) => {
          sync = actions
          actions.begin()
          actions.metadata!.row.set(1, { m: 1 })
          actions.metadata!.collection.set(`cursor`, 1)
          actions.commit()
          actions.markReady()
        },
      },
    })
    await collection.preload()
    expect(sync.metadata!.collection.get(`cursor`)).toBe(1)
    const stale = sync
    await collection.cleanup()
    expect(stale.metadata!.row.get(1)).toBeUndefined()
    expect(stale.metadata!.collection.get(`cursor`)).toBeUndefined()
    expect(stale.metadata!.collection.list()).toEqual([])
    expect(() => stale.metadata!.collection.set(`cursor`, 2)).not.toThrow()
  })

  // Cleanup abandons a held seed; its receipt is internal, so the abandonment
  // must not surface as an unhandled rejection.
  it(`cleanup with a held seed leaves no unhandled rejection`, async () => {
    const unhandled: Array<unknown> = []
    const listener = (reason: unknown) => unhandled.push(reason)
    process.on(`unhandledRejection`, listener)
    let release!: () => void
    const client = new DbClient()
    const collection = client.collection(
      collectionOptions<Row, number>({
        id: `sync-metadata-session-held-seed-cleanup`,
        getKey: (row) => row.id,
        sync: {
          sync: (actions) => {
            actions.begin()
            actions.commit()
            actions.markReady()
          },
        },
        onInsert: () =>
          new Promise<void>((resolve) => {
            release = resolve
          }),
      }),
    )
    try {
      await collection.preload()
      collection.insert({ id: 1000, v: 0 })
      client.hydrate({
        collections: [
          {
            collectionId: `sync-metadata-session-held-seed-cleanup`,
            rows: [{ key: 1, value: { id: 1, v: 1 }, metadata: { m: 1 } }],
          },
        ],
      })
      await collection.cleanup()
      release()
      await new Promise((resolve) => setTimeout(resolve, 10))
    } finally {
      process.off(`unhandledRejection`, listener)
    }
    expect(unhandled).toEqual([])
  })

  it(`a metadata write with no open transaction throws`, async () => {
    let sync!: SyncActions
    const collection = createCollection<Row, number>({
      id: `sync-metadata-session-no-transaction`,
      getKey: (row) => row.id,
      startSync: true,
      sync: {
        sync: (actions) => {
          sync = actions
          actions.begin()
          actions.commit()
          actions.markReady()
        },
      },
    })
    try {
      await collection.preload()
      expect(() => sync.metadata!.row.set(1, { m: 1 })).toThrow()
      expect(() => sync.metadata!.collection.set(`cursor`, 1)).toThrow()
    } finally {
      await collection.cleanup()
    }
  })
})

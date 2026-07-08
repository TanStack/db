/**
 * Red/green verification tests for external-review claims about the
 * persistence/Electric/SQLite issue cluster.
 *
 * Each test asserts the DESIRED invariant claimed by the review. A failing
 * test (RED) confirms the claimed defect exists in current code.
 */
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { createCollection } from '@tanstack/db'
import { SQLiteCorePersistenceAdapter, persistedCollectionOptions } from '../src'
import type { PersistenceAdapter, SQLiteDriver } from '../src'
import type { SyncConfig } from '@tanstack/db'

type Todo = {
  id: string
  title: string
}

async function flushAsyncWork(delayMs: number = 0): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, delayMs))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function toBindable(value: unknown): string | number | bigint | null {
  if (value === null || value === undefined) return null
  if (typeof value === `boolean`) return value ? 1 : 0
  if (
    typeof value === `string` ||
    typeof value === `number` ||
    typeof value === `bigint`
  ) {
    return value
  }
  return String(value)
}

function createNodeSqliteDriver(db: DatabaseSync): SQLiteDriver {
  const driver: SQLiteDriver = {
    exec: (sql) => {
      db.exec(sql)
      return Promise.resolve()
    },
    query: (sql, params = []) => {
      const rows = db
        .prepare(sql)
        .all(...params.map(toBindable))
        .map((row) => ({ ...row }))
      return Promise.resolve(rows as Array<never>)
    },
    run: (sql, params = []) => {
      db.prepare(sql).run(...params.map(toBindable))
      return Promise.resolve()
    },
    transaction: async (fn) => {
      db.exec(`BEGIN IMMEDIATE`)
      try {
        const result = await fn(driver)
        db.exec(`COMMIT`)
        return result
      } catch (error) {
        db.exec(`ROLLBACK`)
        throw error
      }
    },
  }
  return driver
}

type FakeAdapter = PersistenceAdapter & {
  rows: Map<string, Todo>
  applyCommittedTxCalls: number
}

function createFakeAdapter(
  initialRows: Array<Todo> = [],
  options: { failWrites?: boolean } = {},
): FakeAdapter {
  const rows = new Map(initialRows.map((row) => [row.id, row]))
  const adapter: FakeAdapter = {
    rows,
    applyCommittedTxCalls: 0,
    loadSubset: () =>
      Promise.resolve(
        Array.from(rows.values()).map((value) => ({ key: value.id, value })),
      ),
    applyCommittedTx: (_collectionId, tx) => {
      adapter.applyCommittedTxCalls += 1
      if (options.failWrites) {
        return Promise.reject(new Error(`disk write failed`))
      }
      for (const mutation of tx.mutations) {
        if (mutation.type === `delete`) {
          rows.delete(mutation.key as string)
        } else {
          rows.set(mutation.key as string, mutation.value as Todo)
        }
      }
      return Promise.resolve()
    },
    ensureIndex: () => Promise.resolve(),
  }
  return adapter
}

describe(`review claim: schema reset must not leave a sync resume point behind (#1589)`, () => {
  it(`clears collection metadata (electric:resume) when a schema mismatch wipes rows`, async () => {
    const db = new DatabaseSync(`:memory:`)
    const driver = createNodeSqliteDriver(db)

    const adapterV1 = new SQLiteCorePersistenceAdapter({
      driver,
      schemaVersion: 1,
    })

    await adapterV1.applyCommittedTx(`todos`, {
      txId: `tx-1`,
      term: 1,
      seq: 1,
      rowVersion: 1,
      mutations: [
        { type: `insert`, key: `1`, value: { id: `1`, title: `First` } },
      ],
      collectionMetadataMutations: [
        {
          type: `set`,
          key: `electric:resume`,
          value: {
            kind: `resume`,
            offset: `10_0`,
            handle: `handle-1`,
            shapeId: `shape-1`,
            updatedAt: 1,
          },
        },
      ],
    })

    // Sanity: v1 adapter sees the row and the resume point.
    expect(await adapterV1.loadSubset(`todos`, {})).toHaveLength(1)
    expect(await adapterV1.loadCollectionMetadata(`todos`)).toEqual([
      { key: `electric:resume`, value: expect.objectContaining({ kind: `resume` }) },
    ])

    // Reopen at schemaVersion 2 → schema-mismatch reset wipes the rows.
    const adapterV2 = new SQLiteCorePersistenceAdapter({
      driver,
      schemaVersion: 2,
      schemaMismatchPolicy: `sync-present-reset`,
    })

    const rowsAfterReset = await adapterV2.loadSubset(`todos`, {})
    expect(rowsAfterReset).toHaveLength(0)

    // DESIRED INVARIANT: a reset that wipes rows must also invalidate the
    // sync resume point, or Electric resumes past all the wiped data and the
    // collection stays permanently empty.
    const metadataAfterReset = await adapterV2.loadCollectionMetadata(`todos`)
    expect(
      metadataAfterReset.find((entry) => entry.key === `electric:resume`),
    ).toBeUndefined()
  })
})

describe(`review claim: local hydration should make persisted data usable when the remote source is unreachable (#1416/#1443)`, () => {
  it.fails(`marks a sync-present collection ready from hydrated local rows when the source never signals`, async () => {
    const adapter = createFakeAdapter([{ id: `1`, title: `Persisted locally` }])

    // Simulates Electric offline: the client retries forever, never calls
    // markReady, never errors.
    const silentSource: SyncConfig<Todo, string> = {
      sync: () => {},
    }

    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `offline-electric`,
        getKey: (item) => item.id,
        sync: silentSource,
        startSync: true,
        persistence: { adapter },
      }),
    )

    await flushAsyncWork(50)

    // Hydration itself works: the persisted row is in the collection.
    expect(collection.size).toBe(1)

    // DESIRED INVARIANT: locally hydrated data is readable — the collection
    // should not stay in "loading" forever just because the remote is down.
    expect(collection.status).toBe(`ready`)
  })
})

describe(`review claim: sync commits are write-behind; persistence failures are silent and data is lost on restart`, () => {
  it.fails(`does not silently drop a committed sync transaction when the disk write fails`, async () => {
    const adapter = createFakeAdapter([], { failWrites: true })

    const source: SyncConfig<Todo, string> = {
      sync: ({ begin, write, commit, markReady }) => {
        begin()
        write({ type: `insert`, value: { id: `1`, title: `From remote` } })
        commit()
        markReady()
      },
    }

    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `write-behind`,
        getKey: (item) => item.id,
        sync: source,
        startSync: true,
        persistence: { adapter },
      }),
    )

    await collection.stateWhenReady()
    await flushAsyncWork(20)

    // The row is visible in memory and the collection reports healthy...
    expect(collection.get(`1`)).toBeDefined()
    expect(adapter.applyCommittedTxCalls).toBeGreaterThan(0)

    // ...but the persistence write failed. Simulate an app restart with the
    // same (empty) storage and a source that is now unreachable.
    const restarted = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `write-behind-restarted`,
        getKey: (item) => item.id,
        sync: { sync: ({ markReady }) => markReady() },
        startSync: true,
        persistence: { adapter },
      }),
    )
    await restarted.stateWhenReady()
    await flushAsyncWork(20)

    // DESIRED INVARIANT: data that was visible and "committed" should be
    // durable across restart (or the failure must surface as an error state,
    // which would also fail this test's premise that status stayed healthy).
    expect(restarted.get(`1`)).toBeDefined()
  })
})

describe(`review claim: sync-present local mutations are never persisted locally (#1456)`, () => {
  it.fails(`persists an accepted optimistic mutation so it survives restart before the sync stream echoes it`, async () => {
    const adapter = createFakeAdapter()

    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `electric-writes`,
        getKey: (item) => item.id,
        sync: { sync: ({ markReady }) => markReady() },
        startSync: true,
        // Server accepts the write; the stream echo has not arrived yet
        // (or never will, while offline).
        onInsert: () => Promise.resolve({}),
        persistence: { adapter },
      }),
    )

    await collection.stateWhenReady()

    const tx = collection.insert({ id: `1`, title: `Written offline` })
    await tx.isPersisted.promise
    await flushAsyncWork(20)

    // DESIRED INVARIANT: the locally accepted mutation reaches the local
    // store (as pending/outbox state at minimum) instead of existing only in
    // memory until the remote round-trip completes.
    expect(adapter.applyCommittedTxCalls).toBeGreaterThan(0)
  })
})

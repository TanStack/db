// Fixtures shared by the persisted direct-write oracle and its ordinary unit tests
// in persisted-direct-write.test.ts. They build collections, storage, and held
// durable writes. They compare nothing; the oracle owns the law.

import { QueryClient } from '@tanstack/query-core'
import { createNodeSQLitePersistence } from '../../node-db-sqlite-persistence/src'
import { BetterSqlite3SQLiteDriver } from '../../node-db-sqlite-persistence/src/node-driver'
import type { QueryCollectionUtils } from '../src/query'
import type {
  PersistedStorageTarget,
  PersistedTx,
} from '../../db-sqlite-persistence-core/src'

export type Row = { id: string; value: number }
export type Op = `insert` | `update` | `delete` | `upsert`
export const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

export function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

export function sortRows(rows: Iterable<Row>): Array<Row> {
  return Array.from(rows, ({ id, value }) => ({ id, value })).sort((l, r) =>
    l.id < r.id ? -1 : l.id > r.id ? 1 : 0,
  )
}

export function write(utils: QueryCollectionUtils<Row>, op: Op): unknown {
  switch (op) {
    case `insert`:
      return utils.writeInsert({ id: `k`, value: 9 })
    case `update`:
      return utils.writeUpdate({ id: `k`, value: 9 })
    case `delete`:
      return utils.writeDelete(`k`)
    case `upsert`:
      return utils.writeUpsert({ id: `k`, value: 9 })
  }
}

/** Run the write; report `ok` or the error name, thrown or rejected. */
export async function outcomeOf(
  run: () => unknown,
): Promise<{ outcome: string; timing: `sync` | `async` | `none` }> {
  let result: unknown
  try {
    result = run()
  } catch (error) {
    return { outcome: (error as Error).name, timing: `sync` }
  }
  try {
    await result
    return { outcome: `ok`, timing: `none` }
  } catch (error) {
    return { outcome: (error as Error).name, timing: `async` }
  }
}

/**
 * Run a driver, then every cleanup step. A cleanup failure must not hide the
 * driver's failure: when both fail, the result is an AggregateError whose
 * `cause` is the driver's failure and whose `errors` list it first, then each
 * cleanup failure.
 */
export async function checked<T>(
  body: () => Promise<T>,
  cleanups: Array<() => unknown>,
): Promise<T> {
  let primary: { error: unknown } | undefined
  try {
    return await body()
  } catch (error) {
    primary = { error }
    throw error
  } finally {
    const failures: Array<unknown> = []
    for (const cleanup of cleanups) {
      try {
        await cleanup()
      } catch (error) {
        failures.push(error)
      }
    }
    if (failures.length > 0) {
      // eslint-disable-next-line no-unsafe-finally
      throw primary
        ? new AggregateError(
            [primary.error, ...failures],
            `driver failed: ${String((primary.error as Error).message)}; cleanup also failed`,
            { cause: primary.error },
          )
        : new AggregateError(failures, `cleanup failed`)
    }
  }
}

/** Narrow a stored value and key to this oracle's row shape. */
export function asRow(value: Record<string, unknown>): Row {
  if (typeof value.id !== `string` || typeof value.value !== `number`) {
    throw new Error(`unexpected stored row: ${JSON.stringify(value)}`)
  }
  return { ...value, id: value.id, value: value.value }
}

export function asKey(key: string | number): string {
  if (typeof key !== `string`) throw new Error(`unexpected key: ${key}`)
  return key
}

export function createAdapter(seed: Array<Row>) {
  const rows = new Map(seed.map((row) => [row.id, row]))
  const rowMetadata = new Map<string, unknown>()
  const collectionMetadata = new Map<string, unknown>()
  let latestTerm = 0
  let latestSeq = 0
  let latestRowVersion = 0
  const entries = () =>
    Array.from(rows.values()).map((value) => ({
      key: value.id,
      value,
      metadata: rowMetadata.get(value.id),
    }))
  return {
    rows,
    loadSubset: async () => entries(),
    loadResumeSnapshot: async (
      _target: PersistedStorageTarget,
      options?: { includeRows?: boolean },
    ) => ({
      rows: options?.includeRows === false ? [] : entries(),
      keySet: { status: `consistent` as const },
      collectionMetadata: Array.from(
        collectionMetadata.entries(),
        ([key, value]) => ({ key, value }),
      ),
      latestTerm,
      latestSeq,
      latestRowVersion,
      resetEpoch: 0,
    }),
    loadCollectionMetadata: async () =>
      Array.from(collectionMetadata.entries()).map(([key, value]) => ({
        key,
        value,
      })),
    scanRows: async () => entries(),
    applyCommittedTx: async (
      _target: PersistedStorageTarget,
      tx: PersistedTx,
    ) => {
      if (tx.truncate) {
        rows.clear()
        rowMetadata.clear()
      }
      for (const mutation of tx.mutations) {
        const key = asKey(mutation.key)
        if (mutation.type === `delete`) {
          rows.delete(key)
          rowMetadata.delete(key)
        } else {
          rows.set(key, asRow(mutation.value))
        }
      }
      for (const mutation of tx.rowMetadataMutations ?? []) {
        const key = asKey(mutation.key)
        if (mutation.type === `delete`) rowMetadata.delete(key)
        else rowMetadata.set(key, mutation.value)
      }
      for (const mutation of tx.collectionMetadataMutations ?? []) {
        if (mutation.type === `delete`) collectionMetadata.delete(mutation.key)
        else collectionMetadata.set(mutation.key, mutation.value)
      }
      latestTerm = tx.term
      latestSeq = tx.seq
      latestRowVersion = tx.rowVersion
    },
    ensureIndex: async () => {},
  }
}

export type StorageKind = `fake` | `sqlite`

/**
 * Storage for the persisted driver. The fake adapter holds rows in memory.
 * The `sqlite` storage uses the node SQLite adapter over an in-memory
 * database, and starts empty, so the first fetch stores the base rows.
 */
export function createStorage(
  kind: StorageKind,
  seed: Array<Row>,
  collectionId: string,
) {
  if (kind === `fake`) {
    const adapter = createAdapter(seed)
    return {
      adapter,
      persistence: { adapter },
      storedRows: (_collectionId: string) =>
        Promise.resolve(sortRows(adapter.rows.values())),
      close: () => {},
    }
  }
  const driver = new BetterSqlite3SQLiteDriver({ filename: `:memory:` })
  // A Query Collection is sync-present. Resolve that adapter, so the gate
  // below wraps the adapter the collection writes through.
  const resolved = createNodeSQLitePersistence({
    database: driver.getDatabase(),
  }).resolvePersistenceForCollection!({
    collectionId,
    mode: `sync-present`,
    schemaVersion: undefined,
  })
  const persistence = {
    adapter: resolved.adapter,
    coordinator: resolved.coordinator,
  }
  const adapter = resolved.adapter as unknown as ReturnType<
    typeof createAdapter
  > & {
    scanRows: (target: {
      kind: `eager`
      collectionId: string
    }) => Promise<Array<{ key: unknown; value: Row }>>
  }
  return {
    adapter,
    persistence,
    storedRows: async (collectionId: string) =>
      sortRows(
        (await adapter.scanRows({ kind: `eager`, collectionId })).map(
          (row) => row.value,
        ),
      ),
    close: () => driver.close(),
  }
}

export function newQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { staleTime: 0, gcTime: 0, retry: false } },
  })
}

/** A queryFn whose calls after `armed` wait for the test to return them. */
export function heldQueryFn(rows: () => Array<Row>) {
  const calls: Array<{ resolve: (rows: Array<Row>) => void }> = []
  let armed = false
  const started = { count: 0 }
  const queryFn = () => {
    started.count++
    if (!armed) return Promise.resolve(rows().map((row) => ({ ...row })))
    const call = deferred<Array<Row>>()
    calls.push(call)
    return call.promise
  }
  return {
    queryFn,
    started,
    arm: () => {
      armed = true
    },
    disarm: () => {
      armed = false
    },
    calls,
  }
}

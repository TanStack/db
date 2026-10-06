import { describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/query-core'
import { createCollection } from '@tanstack/db'
import { persistedCollectionOptions } from '../../db-sqlite-persistence-core/src'
import { createNodeSQLitePersistence } from '../../node-db-sqlite-persistence/src'
import { BetterSqlite3SQLiteDriver } from '../../node-db-sqlite-persistence/src/node-driver'
import { queryCollectionOptions } from '../src/query'
import type { QueryCollectionUtils } from '../src/query'

/**
 * # Does a direct write see the commits that came before it?
 *
 * A persisted Query Collection puts each source commit behind the persistence
 * wrapper's apply lock. While another task holds that lock, a committed
 * refetch waits there, and core has not accepted it yet. Its result is already
 * in the Query cache. The contract: a direct write (`writeInsert`,
 * `writeUpdate`, `writeDelete`, `writeUpsert`) that runs in that window is
 * validated against, and applies on top of, the rows of every commit that came
 * before it. Persistence must not change what the write does.
 *
 * The reference is the same Query Collection without persistence. It runs the
 * same operations, but no lock exists, so the earlier refetch has applied when
 * the write runs. The reference does not share the persistence wrapper, which
 * is the code under judgment. It shares the Query Collection's direct-write
 * code, so this oracle cannot find a fault in that code that both paths share.
 *
 * ## Contract and ownership table
 *
 * | Contract | History/domain | Production path | Observation and checkpoint | Owner and limits |
 * | --- | --- | --- | --- | --- |
 * | validation sees earlier commits | 4 write types x 2 lock holders x 2 key cases | utils.write* -> manual-sync -> persisted commit | outcome of the write: `ok` or the error name | this oracle |
 * | the write applies on top | the same | the same | visible rows after every promise settles | this oracle |
 * | the Query cache agrees | the same | updateCacheData | Query cache rows after settlement | this oracle |
 * | storage agrees | the same | persisted durable write | stored rows after settlement equal the visible rows | this oracle |
 * | real SQLite receives the same | a subset: each write type, `refetch-only`, `source-write`, and the ordering cases | the same, over the node SQLite adapter | the same observations | this oracle; the full matrix runs over an in-memory fake adapter |
 *
 * Lock holders:
 *
 * - `source-write`: an earlier refetch's durable write is held after core
 *   applied it, so the lock stays busy.
 * - `startup`: persisted startup hydration is held, so the first fetch result
 *   waits for it.
 *
 * A mutation confirmation does not take this lock for a Query Collection.
 * `persistAndConfirmCollectionMutations` runs only for sync-absent
 * collections, so that holder is outside this oracle.
 *
 * Key cases: `refetch-only` means only the waiting refetch holds key `k`.
 * `both` means the applied rows hold `k`, and the waiting refetch changes it.
 *
 * The domain is a finite matrix of 16 cases, not a generated history, so no
 * random campaign is claimed. The comparison ignores whether an error is
 * thrown at once or rejects later. The driver records that timing, because it
 * is an API choice and not part of this law.
 *
 * The driver checks that it reached the window: when the write runs, storage
 * does not hold the waiting refetch's row for `k` yet. This check does not
 * depend on when core accepts the refetch, which a fix may change. Each failure message carries
 * both observations, so a failure keeps the case that broke the law.
 */

type Row = { id: string; value: number }
type Op = `insert` | `update` | `delete` | `upsert`
type Holder = `source-write` | `startup`
type KeyCase = `refetch-only` | `both`

type Observation = {
  outcome: string
  visible: Array<Row>
  cache: Array<Row>
}

const ops: Array<Op> = [`insert`, `update`, `delete`, `upsert`]
const holders: Array<Holder> = [`source-write`, `startup`]
const keyCases: Array<KeyCase> = [`refetch-only`, `both`]

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

/** The applied rows before the window, and the waiting refetch's rows. */
function scenario(keyCase: KeyCase): { base: Array<Row>; next: Array<Row> } {
  return keyCase === `both`
    ? {
        base: [
          { id: `a`, value: 1 },
          { id: `k`, value: 1 },
        ],
        next: [
          { id: `a`, value: 2 },
          { id: `k`, value: 5 },
        ],
      }
    : {
        base: [{ id: `a`, value: 1 }],
        next: [
          { id: `a`, value: 2 },
          { id: `k`, value: 5 },
        ],
      }
}

function sortRows(rows: Iterable<Row>): Array<Row> {
  return Array.from(rows, ({ id, value }) => ({ id, value })).sort((l, r) =>
    l.id < r.id ? -1 : l.id > r.id ? 1 : 0,
  )
}

function write(utils: QueryCollectionUtils<Row>, op: Op): unknown {
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
async function outcomeOf(
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
async function checked<T>(
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

function createAdapter(seed: Array<Row>) {
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
      _collectionId: string,
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
    applyCommittedTx: async (_collectionId: string, tx: any) => {
      if (tx.truncate) {
        rows.clear()
        rowMetadata.clear()
      }
      for (const mutation of tx.mutations) {
        if (mutation.type === `delete`) {
          rows.delete(mutation.key)
          rowMetadata.delete(mutation.key)
        } else {
          rows.set(mutation.key, mutation.value)
        }
      }
      for (const mutation of tx.rowMetadataMutations ?? []) {
        if (mutation.type === `delete`) rowMetadata.delete(mutation.key)
        else rowMetadata.set(mutation.key, mutation.value)
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

type StorageKind = `fake` | `sqlite`

/**
 * Storage for the persisted driver. The fake adapter holds rows in memory.
 * The `sqlite` storage uses the node SQLite adapter over an in-memory
 * database, and starts empty, so the first fetch stores the base rows.
 */
function createStorage(
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
    scanRows: (
      collectionId: string,
    ) => Promise<Array<{ key: unknown; value: Row }>>
  }
  return {
    adapter,
    persistence,
    storedRows: async (collectionId: string) =>
      sortRows((await adapter.scanRows(collectionId)).map((row) => row.value)),
    close: () => driver.close(),
  }
}

function newQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { staleTime: 0, gcTime: 0, retry: false } },
  })
}

/**
 * Reference: no persistence. The waiting refetch has applied when the write
 * runs, so its rows decide validation.
 */
async function reference(op: Op, keyCase: KeyCase): Promise<Observation> {
  const { base, next } = scenario(keyCase)
  let server = base
  const queryClient = newQueryClient()
  const queryKey = [`reference`, op, keyCase]
  const collection = createCollection(
    queryCollectionOptions<Row>({
      id: `reference-${op}-${keyCase}`,
      queryKey,
      queryFn: () => Promise.resolve(server.map((row) => ({ ...row }))),
      queryClient,
      getKey: (row) => row.id,
      startSync: true,
    }),
  )
  return checked(async () => {
    await collection.preload()
    server = next
    await collection.utils.refetch()
    const { outcome } = await outcomeOf(() => write(collection.utils, op))
    await flush()
    return {
      outcome,
      visible: sortRows(collection.values()),
      cache: sortRows(queryClient.getQueryData(queryKey) ?? []),
    }
  }, [() => collection.cleanup()])
}

/**
 * Production driver: the persisted Query Collection. The write runs while the
 * refetch that carries `next` waits on the apply lock.
 */
async function persisted(
  op: Op,
  holder: Holder,
  keyCase: KeyCase,
  kind: StorageKind = `fake`,
): Promise<
  Observation & { stored: Array<Row>; timing: string; waited: boolean }
> {
  const { base, next } = scenario(keyCase)
  const id = `persisted-${kind}-${op}-${holder}-${keyCase}`
  const storage = createStorage(kind, base, id)
  const adapter = storage.adapter
  const queryClient = newQueryClient()
  const queryKey = [`persisted`, kind, op, holder, keyCase]
  const release = deferred()
  const entered = deferred()
  let server = base
  let hold = false

  if (holder === `source-write`) {
    const applyCommittedTx = adapter.applyCommittedTx.bind(adapter)
    adapter.applyCommittedTx = async (...args) => {
      if (hold && args[1].mutations.length > 0) {
        hold = false
        entered.resolve()
        await release.promise
      }
      return applyCommittedTx(...args)
    }
  } else {
    // Hold startup hydration: the row read after the metadata read. The
    // source starts after the metadata read, and its first fetch returns
    // `next`.
    server = next
    const loadResumeSnapshot = adapter.loadResumeSnapshot
    adapter.loadResumeSnapshot = async (collectionId, options) => {
      if (options?.includeRows !== false) {
        entered.resolve()
        await release.promise
      }
      return loadResumeSnapshot(collectionId, options)
    }
  }

  const errors = vi.spyOn(console, `error`).mockImplementation(() => {})
  const collection = createCollection(
    persistedCollectionOptions<
      Row,
      string | number,
      never,
      QueryCollectionUtils<Row>
    >({
      ...queryCollectionOptions<Row>({
        id,
        queryKey,
        queryFn: () => Promise.resolve(server.map((row) => ({ ...row }))),
        queryClient,
        getKey: (row) => row.id,
        startSync: true,
      }),
      persistence: storage.persistence,
    }),
  )
  const pending: Array<Promise<unknown>> = []
  return checked(async () => {
    if (holder === `source-write`) {
      await collection.preload()
      // R1 changes `a` and holds the lock in its durable write.
      hold = true
      server = [{ id: `a`, value: 2 }, ...base.filter((r) => r.id !== `a`)]
      pending.push(collection.utils.refetch())
      await entered.promise
      // R2 carries `next`; its commit waits behind the busy lock.
      server = next
      pending.push(collection.utils.refetch())
    } else {
      pending.push(collection.preload())
      await entered.promise
    }
    // The Query cache holds `next` once its result is committed.
    await vi.waitFor(() =>
      expect(sortRows(queryClient.getQueryData(queryKey) ?? [])).toEqual(
        sortRows(next),
      ),
    )
    // The window: the refetch is committed, but its durable write has not
    // finished, because another task holds the lock.
    const waited =
      (await storage.storedRows(id)).find((row) => row.id === `k`)?.value !== 5
    const settled = outcomeOf(() => write(collection.utils, op))
    release.resolve()
    const { outcome, timing } = await settled
    await Promise.allSettled(pending)
    await flush()
    await flush()
    return {
      outcome,
      timing,
      waited,
      visible: sortRows(collection.values()),
      cache: sortRows(queryClient.getQueryData(queryKey) ?? []),
      stored: await storage.storedRows(id),
    }
  }, [
    () => release.resolve(),
    () => errors.mockRestore(),
    () => collection.cleanup(),
    () => storage.close(),
  ])
}

describe(`persisted direct writes behind a waiting refetch`, () => {
  for (const holder of holders) {
    for (const keyCase of keyCases) {
      for (const op of ops) {
        it(`${op} with ${holder} holding the lock, key ${keyCase}`, async () => {
          const expected = await reference(op, keyCase)
          const actual = await persisted(op, holder, keyCase)
          // The driver reached the window: core had not accepted `next`.
          expect(actual.waited, `the refetch waited on the lock`).toBe(true)
          const observed = {
            outcome: actual.outcome,
            visible: actual.visible,
            cache: actual.cache,
          }
          expect(
            observed,
            `persisted ${JSON.stringify(observed)} != reference ${JSON.stringify(expected)}`,
          ).toEqual(expected)
          expect(actual.stored, `storage matches the visible rows`).toEqual(
            actual.visible,
          )
        })
      }
    }
  }
})

/**
 * ## A later refetch while the direct write waits
 *
 * A direct write W waits for earlier commits. A third refetch R3 can return
 * during that wait. The ordering law comes from the merge rule for direct
 * writes and in-flight fetches:
 *
 * - If R3 started before W was called, R3 has older server data for W's keys.
 *   W wins on its keys, and R3 wins on the other keys.
 * - If R3 started after W was called, R3 reflects the server after the write,
 *   so R3 wins.
 *
 * W writes `k`. R3 either changes `k` (same key) or only changes `a`
 * (different key). The reference runs the same timeline without persistence:
 * W applies at once, and R3 returns afterwards.
 */
type Start = `before` | `after`
type Touch = `same` | `different`

function laterRows(touch: Touch): Array<Row> {
  return touch === `same`
    ? [
        { id: `a`, value: 2 },
        { id: `k`, value: 6 },
      ]
    : [
        { id: `a`, value: 7 },
        { id: `k`, value: 5 },
      ]
}

/** A queryFn whose calls after `armed` wait for the test to return them. */
function heldQueryFn(rows: () => Array<Row>) {
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

async function referenceOrder(start: Start, touch: Touch): Promise<Array<Row>> {
  const server: Array<Row> = [
    { id: `a`, value: 2 },
    { id: `k`, value: 5 },
  ]
  const held = heldQueryFn(() => server)
  const queryClient = newQueryClient()
  const collection = createCollection(
    queryCollectionOptions<Row>({
      id: `reference-order-${start}-${touch}`,
      queryKey: [`reference-order`, start, touch],
      queryFn: held.queryFn,
      queryClient,
      getKey: (row) => row.id,
      startSync: true,
    }),
  )
  return checked(async () => {
    await collection.preload()
    let r3: Promise<unknown> | undefined
    if (start === `before`) {
      held.arm()
      r3 = collection.utils.refetch()
      await vi.waitFor(() => expect(held.calls.length).toBe(1))
    }
    await outcomeOf(() => collection.utils.writeUpdate({ id: `k`, value: 9 }))
    if (start === `after`) {
      held.arm()
      r3 = collection.utils.refetch()
      await vi.waitFor(() => expect(held.calls.length).toBe(1))
    }
    held.disarm()
    held.calls[0]!.resolve(laterRows(touch))
    await r3
    await flush()
    await flush()
    return sortRows(collection.values())
  }, [() => collection.cleanup()])
}

async function persistedOrder(
  start: Start,
  touch: Touch,
  kind: StorageKind = `fake`,
): Promise<{ visible: Array<Row>; stored: Array<Row>; waited: boolean }> {
  const base: Array<Row> = [
    { id: `a`, value: 1 },
    { id: `k`, value: 1 },
  ]
  const id = `persisted-order-${kind}-${start}-${touch}`
  const storage = createStorage(kind, base, id)
  const adapter = storage.adapter
  let server = base
  const held = heldQueryFn(() => server)
  const release = deferred()
  const entered = deferred()
  let hold = false
  const applyCommittedTx = adapter.applyCommittedTx.bind(adapter)
  adapter.applyCommittedTx = async (...args) => {
    if (hold && args[1].mutations.length > 0) {
      hold = false
      entered.resolve()
      await release.promise
    }
    return applyCommittedTx(...args)
  }
  const errors = vi.spyOn(console, `error`).mockImplementation(() => {})
  const queryClient = newQueryClient()
  const collection = createCollection(
    persistedCollectionOptions<
      Row,
      string | number,
      never,
      QueryCollectionUtils<Row>
    >({
      ...queryCollectionOptions<Row>({
        id,
        queryKey: [`persisted-order`, start, touch],
        queryFn: held.queryFn,
        queryClient,
        getKey: (row) => row.id,
        startSync: true,
      }),
      persistence: storage.persistence,
    }),
  )
  const pending: Array<Promise<unknown>> = []
  return checked(async () => {
    await collection.preload()
    // R1 holds the lock; R2 (a=2, k=5) commits and waits behind it.
    hold = true
    server = [
      { id: `a`, value: 2 },
      { id: `k`, value: 1 },
    ]
    pending.push(collection.utils.refetch())
    await entered.promise
    server = [
      { id: `a`, value: 2 },
      { id: `k`, value: 5 },
    ]
    pending.push(collection.utils.refetch())
    await vi.waitFor(() =>
      expect(
        sortRows(
          queryClient.getQueryData([`persisted-order`, start, touch]) ?? [],
        ),
      ).toEqual(sortRows(server)),
    )
    const waited =
      (await storage.storedRows(id)).find((row) => row.id === `k`)?.value !== 5
    if (start === `before`) {
      held.arm()
      pending.push(collection.utils.refetch())
      await vi.waitFor(() => expect(held.calls.length).toBe(1))
    }
    const w = outcomeOf(() =>
      collection.utils.writeUpdate({ id: `k`, value: 9 }),
    )
    if (start === `after`) {
      held.arm()
      pending.push(collection.utils.refetch())
      await vi.waitFor(() => expect(held.calls.length).toBe(1))
    }
    held.disarm()
    // R3 returns while W still waits for R2.
    held.calls[0]!.resolve(laterRows(touch))
    await flush()
    release.resolve()
    await w
    await Promise.allSettled(pending)
    for (let i = 0; i < 20; i++) await flush()
    return {
      visible: sortRows(collection.values()),
      stored: await storage.storedRows(id),
      waited,
    }
  }, [
    () => release.resolve(),
    () => errors.mockRestore(),
    () => collection.cleanup(),
    () => storage.close(),
  ])
}

describe(`a later refetch while a persisted direct write waits`, () => {
  for (const start of [`before`, `after`] as const) {
    for (const touch of [`same`, `different`] as const) {
      it(`R3 started ${start} the write, ${touch} key`, async () => {
        const expected = await referenceOrder(start, touch)
        const actual = await persistedOrder(start, touch)
        expect(actual.waited, `the write waited on the lock`).toBe(true)
        expect(
          actual.visible,
          `persisted ${JSON.stringify(actual.visible)} != reference ${JSON.stringify(expected)}`,
        ).toEqual(expected)
        expect(actual.stored, `storage matches the visible rows`).toEqual(
          actual.visible,
        )
      })
    }
  }
})

/**
 * ## Real SQLite receives the same law
 *
 * The matrix above runs over an in-memory fake adapter, which supplies the
 * durable-write delay. This subset runs the same drivers over the node SQLite
 * adapter, gated the same way: each write type with the key that only the
 * waiting refetch holds and an earlier refetch's durable write holding the
 * lock, plus the four ordering cases.
 */
describe(`real SQLite: persisted direct writes behind a waiting refetch`, () => {
  for (const op of ops) {
    it(`${op} with source-write holding the lock, key refetch-only`, async () => {
      const expected = await reference(op, `refetch-only`)
      const actual = await persisted(
        op,
        `source-write`,
        `refetch-only`,
        `sqlite`,
      )
      expect(actual.waited, `the refetch waited on the lock`).toBe(true)
      const observed = {
        outcome: actual.outcome,
        visible: actual.visible,
        cache: actual.cache,
      }
      expect(
        observed,
        `sqlite ${JSON.stringify(observed)} != reference ${JSON.stringify(expected)}`,
      ).toEqual(expected)
      expect(actual.stored, `SQLite matches the visible rows`).toEqual(
        actual.visible,
      )
    })
  }
  for (const start of [`before`, `after`] as const) {
    for (const touch of [`same`, `different`] as const) {
      it(`R3 started ${start} the write, ${touch} key`, async () => {
        const expected = await referenceOrder(start, touch)
        const actual = await persistedOrder(start, touch, `sqlite`)
        expect(actual.waited, `the write waited on the lock`).toBe(true)
        expect(
          actual.visible,
          `sqlite ${JSON.stringify(actual.visible)} != reference ${JSON.stringify(expected)}`,
        ).toEqual(expected)
        expect(actual.stored, `SQLite matches the visible rows`).toEqual(
          actual.visible,
        )
      })
    }
  }
})

/**
 * ## A persisted insert of an existing key
 *
 * Without persistence, core rejects a sync insert of a key that it already
 * holds. Persistence stores every sync insert as an update, so before this
 * check a persisted `writeInsert` of an existing key replaced the row. This
 * witness needs no lock window: the key is applied before the write runs.
 */
describe(`a persisted direct insert of an existing key`, () => {
  it(`rejects like the reference and keeps the row`, async () => {
    const base: Array<Row> = [{ id: `k`, value: 1 }]
    const reference = createCollection(
      queryCollectionOptions<Row>({
        id: `reference-duplicate-insert`,
        queryKey: [`reference-duplicate-insert`],
        queryFn: () => Promise.resolve(base.map((row) => ({ ...row }))),
        queryClient: newQueryClient(),
        getKey: (row) => row.id,
        startSync: true,
      }),
    )
    const adapter = createAdapter(base)
    const persistedCollection = createCollection(
      persistedCollectionOptions<
        Row,
        string | number,
        never,
        QueryCollectionUtils<Row>
      >({
        ...queryCollectionOptions<Row>({
          id: `persisted-duplicate-insert`,
          queryKey: [`persisted-duplicate-insert`],
          queryFn: () => Promise.resolve(base.map((row) => ({ ...row }))),
          queryClient: newQueryClient(),
          getKey: (row) => row.id,
          startSync: true,
        }),
        persistence: { adapter },
      }),
    )
    await checked(async () => {
      await reference.preload()
      await persistedCollection.preload()
      const expected = await outcomeOf(() =>
        reference.utils.writeInsert({ id: `k`, value: 9 }),
      )
      const actual = await outcomeOf(() =>
        persistedCollection.utils.writeInsert({ id: `k`, value: 9 }),
      )
      await flush()
      expect(actual.outcome).toBe(expected.outcome)
      expect(sortRows(persistedCollection.values())).toEqual(
        sortRows(reference.values()),
      )
      expect(sortRows(adapter.rows.values())).toEqual([{ id: `k`, value: 1 }])
    }, [() => reference.cleanup(), () => persistedCollection.cleanup()])
  })
})

describe(`the oracle harness keeps the primary failure`, () => {
  it(`reports the driver's failure when cleanup also fails`, async () => {
    const report = await checked(() => {
      expect(1, `the driver's assertion`).toBe(2)
      return Promise.resolve()
    }, [
      () => {
        throw new Error(`cleanup failed on purpose`)
      },
    ]).then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(report).toBeInstanceOf(AggregateError)
    const aggregate = report as AggregateError
    expect((aggregate.cause as Error).message).toContain(
      `the driver's assertion`,
    )
    expect(aggregate.message).toContain(`the driver's assertion`)
    expect(aggregate.errors).toHaveLength(2)
    expect(aggregate.errors[0]).toBe(aggregate.cause)
    expect((aggregate.errors[1] as Error).message).toBe(
      `cleanup failed on purpose`,
    )
  })
})

/**
 * ## Direct writes interleaved with refetches: the precedence model
 *
 * The rows above come from a reference collection. That reference runs the
 * same direct-write code, so it cannot judge a fault in the code both paths
 * share. The laws below take their expected rows from this model instead:
 *
 * 1. A direct write takes its position in the order of operations when it is
 *    called. A fetch that starts later reflects the server after the write.
 * 2. Only an accepted write gains precedence over a fetch that started before
 *    it. A rejected write changes no rows and gains no precedence.
 * 3. For each key, the newest of these wins: the latest accepted write, or a
 *    fetch that started after it.
 * 4. `await refetch()` settles after its result's rows apply, even when that
 *    result had to wait for a direct write.
 * 5. A write whose sync run cleanup retired while it waited rejects, and it
 *    stores nothing.
 *
 * Each case below states its expected rows from these rules. The histories
 * are finite and pinned. Rule 4 is observed inside the refetch's fulfillment
 * callback, not after a later flush, because a later flush hides a refetch
 * that settles early.
 */

type FailedWrite = `insert` | `update` | `delete` | `batch`

function failingWrite(
  utils: QueryCollectionUtils<Row>,
  failed: FailedWrite,
): unknown {
  switch (failed) {
    case `insert`:
      // `k` exists in the applied rows, so this insert is a duplicate.
      return utils.writeInsert({ id: `k`, value: 9 })
    case `update`:
      // `k` is not in the applied rows.
      return utils.writeUpdate({ id: `k`, value: 9 })
    case `delete`:
      return utils.writeDelete(`k`)
    case `batch`:
      return utils.writeBatch(() => {
        utils.writeInsert({ id: `k`, value: 9 })
        utils.writeInsert({ id: `k`, value: 10 })
      })
  }
}

/** A persisted collection whose next durable write can be held. */
function heldPersistedCollection(
  id: string,
  storage: ReturnType<typeof createAdapter>,
  queryFn: () => Promise<Array<Row>>,
) {
  const gate = deferred()
  const entered = deferred()
  let hold = false
  const original = storage.applyCommittedTx
  storage.applyCommittedTx = async (...args) => {
    if (hold && args[1].mutations.length) {
      hold = false
      entered.resolve()
      await gate.promise
    }
    return original(...args)
  }
  const queryClient = newQueryClient()
  const queryKey = [id]
  const collection = createCollection(
    persistedCollectionOptions<
      Row,
      string | number,
      never,
      QueryCollectionUtils<Row>
    >({
      ...queryCollectionOptions<Row>({
        id,
        queryKey,
        queryClient,
        queryFn,
        getKey: (row) => row.id,
        startSync: true,
      }),
      persistence: { adapter: storage },
    }),
  )
  return {
    collection,
    queryClient,
    queryKey,
    hold: () => {
      hold = true
    },
    entered: entered.promise,
    release: () => gate.resolve(),
  }
}

describe(`direct writes interleaved with refetches follow the precedence model`, () => {
  for (const persistence of [false, true]) {
    for (const failed of [`insert`, `update`, `delete`, `batch`] as const) {
      it(`a rejected ${failed} leaves an in-flight refetch authoritative (persisted=${persistence})`, async () => {
        // Rule 2: the rejected write gains no precedence, so the refetch's
        // row for `k` (value 2) is the expected row.
        const base = failed === `insert` ? [{ id: `k`, value: 1 }] : []
        const held = heldQueryFn(() => base)
        const id = `rejected-${failed}-${persistence}`
        const queryClient = newQueryClient()
        const options = queryCollectionOptions<Row>({
          id,
          queryKey: [id],
          queryClient,
          queryFn: held.queryFn,
          getKey: (row) => row.id,
          startSync: true,
        })
        const collection = persistence
          ? createCollection(
              persistedCollectionOptions<
                Row,
                string | number,
                never,
                QueryCollectionUtils<Row>
              >({ ...options, persistence: { adapter: createAdapter(base) } }),
            )
          : createCollection(options)
        await checked(async () => {
          await collection.preload()
          held.arm()
          const refetch = collection.utils.refetch()
          await vi.waitFor(() => expect(held.calls.length).toBe(1))
          const result = await outcomeOf(() =>
            failingWrite(collection.utils, failed),
          )
          expect(result).toMatchObject({ timing: `async` })
          expect(result.outcome).not.toBe(`ok`)
          held.disarm()
          held.calls[0]!.resolve([{ id: `k`, value: 2 }])
          const rowsAtSettlement = await refetch.then(() =>
            sortRows(collection.values()),
          )
          expect(rowsAtSettlement).toEqual([{ id: `k`, value: 2 }])
          expect(sortRows((queryClient.getQueryData([id]) ?? []) as Array<Row>)).toEqual([
            { id: `k`, value: 2 },
          ])
        }, [() => collection.cleanup()])
      })
    }
  }

  it(`a queued write sees an earlier queued write`, async () => {
    // Rule 3: the insert of k=3 is accepted first, so the update to k=4 is
    // valid and wins.
    let server = [{ id: `a`, value: 1 }]
    const storage = createAdapter(server)
    const fixture = heldPersistedCollection(`two-queued-writes`, storage, () =>
      Promise.resolve(server.map((row) => ({ ...row }))),
    )
    const { collection } = fixture
    await checked(async () => {
      await collection.preload()
      fixture.hold()
      server = [{ id: `a`, value: 2 }]
      const refetch = collection.utils.refetch()
      await fixture.entered
      const first = outcomeOf(() =>
        collection.utils.writeInsert({ id: `k`, value: 3 }),
      )
      const second = outcomeOf(() =>
        collection.utils.writeUpdate({ id: `k`, value: 4 }),
      )
      fixture.release()
      expect((await first).outcome).toBe(`ok`)
      expect((await second).outcome).toBe(`ok`)
      await refetch
      expect(sortRows(collection.values())).toEqual([
        { id: `a`, value: 2 },
        { id: `k`, value: 4 },
      ])
    }, [() => fixture.release(), () => collection.cleanup()])
  })

  it(`a refetch that waited for a direct write settles after its rows apply`, async () => {
    // Rule 4. The later refetch starts after the write, so its row wins
    // (rule 1). Its fulfillment must already see that row.
    let server = [{ id: `k`, value: 1 }]
    const storage = createAdapter(server)
    const held = heldQueryFn(() => server)
    const fixture = heldPersistedCollection(`settles-after-apply`, storage, held.queryFn)
    const { collection } = fixture
    await checked(async () => {
      await collection.preload()
      fixture.hold()
      server = [{ id: `k`, value: 2 }]
      const firstRefetch = collection.utils.refetch()
      await fixture.entered
      const directWrite = outcomeOf(() =>
        collection.utils.writeUpdate({ id: `k`, value: 9 }),
      )
      held.arm()
      let settled = false
      const later = collection.utils.refetch().then(() => {
        settled = true
        return sortRows(collection.values())
      })
      await vi.waitFor(() => expect(held.calls.length).toBe(1))
      held.disarm()
      held.calls[0]!.resolve([{ id: `k`, value: 6 }])
      await flush()
      await flush()
      expect({ settled, rows: sortRows(collection.values()) }).toEqual({
        settled: false,
        rows: [{ id: `k`, value: 2 }],
      })
      fixture.release()
      expect(await later).toEqual([{ id: `k`, value: 6 }])
      await Promise.all([firstRefetch, directWrite])
    }, [() => fixture.release(), () => collection.cleanup()])
  })

  for (const sibling of [false, true]) {
    it(`a write after a deferred result arrives keeps precedence (${sibling ? `sibling key` : `same key`})`, async () => {
      // W1 writes k=9. R3 starts after W1 and returns k=6, so R3 wins on k
      // (rule 1). W2 is called after R3 started, so W2 wins on its key
      // (rule 3): k=10 for the same key, or j=10 beside k=6.
      let server = [{ id: `k`, value: 1 }]
      const storage = createAdapter(server)
      const held = heldQueryFn(() => server)
      const id = `second-write-${sibling ? `sibling` : `same`}`
      const fixture = heldPersistedCollection(id, storage, held.queryFn)
      const { collection, queryClient, queryKey } = fixture
      await checked(async () => {
        await collection.preload()
        fixture.hold()
        server = [{ id: `k`, value: 5 }]
        const first = collection.utils.refetch()
        await fixture.entered
        const w1 = outcomeOf(() =>
          collection.utils.writeUpdate({ id: `k`, value: 9 }),
        )
        held.arm()
        const r3 = collection.utils.refetch()
        await vi.waitFor(() => expect(held.calls.length).toBe(1))
        held.disarm()
        held.calls[0]!.resolve(
          sibling
            ? [
                { id: `j`, value: 1 },
                { id: `k`, value: 6 },
              ]
            : [{ id: `k`, value: 6 }],
        )
        await flush()
        const w2 = outcomeOf(() =>
          sibling
            ? collection.utils.writeUpsert({ id: `j`, value: 10 })
            : collection.utils.writeUpdate({ id: `k`, value: 10 }),
        )
        fixture.release()
        expect((await w1).outcome).toBe(`ok`)
        expect((await w2).outcome).toBe(`ok`)
        await Promise.all([first, r3])
        await flush()
        const expected = sibling
          ? [
              { id: `j`, value: 10 },
              { id: `k`, value: 6 },
            ]
          : [{ id: `k`, value: 10 }]
        expect({
          rows: sortRows(collection.values()),
          cache: sortRows((queryClient.getQueryData(queryKey) ?? []) as Array<Row>),
          stored: sortRows(storage.rows.values()),
        }).toEqual({ rows: expected, cache: expected, stored: expected })
      }, [() => fixture.release(), () => collection.cleanup()])
    })
  }

  for (const op of [`insert`, `upsert`, `batch`] as const) {
    it(`a ${op} whose sync run cleanup retired while it waited rejects and stores nothing`, async () => {
      // Rule 5. The write waits behind a held durable write, then cleanup
      // starts before the lock is released.
      let server = [{ id: `a`, value: 1 }]
      const storage = createAdapter(server)
      const fixture = heldPersistedCollection(`cleanup-${op}`, storage, () =>
        Promise.resolve(server.map((row) => ({ ...row }))),
      )
      const { collection } = fixture
      await checked(async () => {
        await collection.preload()
        fixture.hold()
        server = [{ id: `a`, value: 2 }]
        const refetch = collection.utils.refetch().catch(() => undefined)
        await fixture.entered
        const pending = outcomeOf(() =>
          op === `insert`
            ? collection.utils.writeInsert({ id: `z`, value: 9 })
            : op === `upsert`
              ? collection.utils.writeUpsert({ id: `z`, value: 9 })
              : collection.utils.writeBatch(() => {
                  collection.utils.writeInsert({ id: `z`, value: 9 })
                }),
        )
        const cleanup = collection.cleanup()
        fixture.release()
        await cleanup
        const result = await pending
        await refetch
        expect(result.outcome).not.toBe(`ok`)
        expect(storage.rows.has(`z`)).toBe(false)
        // A restart over the same storage publishes no `z`.
        const restarted = createCollection(
          persistedCollectionOptions<
            Row,
            string | number,
            never,
            QueryCollectionUtils<Row>
          >({
            ...queryCollectionOptions<Row>({
              id: `cleanup-${op}`,
              queryKey: [`cleanup-${op}-restart`],
              queryClient: newQueryClient(),
              queryFn: () => Promise.resolve(server.map((row) => ({ ...row }))),
              getKey: (row) => row.id,
              startSync: true,
            }),
            persistence: { adapter: storage },
          }),
        )
        try {
          await restarted.preload()
          expect(restarted.has(`z`)).toBe(false)
        } finally {
          await restarted.cleanup()
        }
      }, [() => fixture.release(), () => collection.cleanup()])
    })
  }
})

import { describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/query-core'
import { createCollection } from '@tanstack/db'
import { persistedCollectionOptions } from '../../db-sqlite-persistence-core/src'
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
 * | storage agrees | the same | persisted durable write | adapter rows after settlement equal the visible rows | this oracle; the adapter is an in-memory fake, not SQLite |
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
 * The driver checks that it reached the window: when the write runs, core has
 * not accepted the waiting refetch's row for `k`. Each failure message carries
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
  try {
    await collection.preload()
    server = next
    await collection.utils.refetch()
    const { outcome } = await outcomeOf(() => write(collection.utils, op))
    await flush()
    return {
      outcome,
      visible: sortRows(collection.values()),
      cache: sortRows(
        (queryClient.getQueryData(queryKey) as Array<Row> | undefined) ?? [],
      ),
    }
  } finally {
    await collection.cleanup()
  }
}

/**
 * Production driver: the persisted Query Collection. The write runs while the
 * refetch that carries `next` waits on the apply lock.
 */
async function persisted(
  op: Op,
  holder: Holder,
  keyCase: KeyCase,
): Promise<
  Observation & { stored: Array<Row>; timing: string; waited: boolean }
> {
  const { base, next } = scenario(keyCase)
  const adapter = createAdapter(base)
  const queryClient = newQueryClient()
  const queryKey = [`persisted`, op, holder, keyCase]
  const release = deferred()
  const entered = deferred()
  let server = base
  let hold = false

  if (holder === `source-write`) {
    const applyCommittedTx = adapter.applyCommittedTx
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
        id: `persisted-${op}-${holder}-${keyCase}`,
        queryKey,
        queryFn: () => Promise.resolve(server.map((row) => ({ ...row }))),
        queryClient,
        getKey: (row) => row.id,
        startSync: true,
      }),
      persistence: { adapter },
    }),
  )
  const pending: Array<Promise<unknown>> = []
  try {
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
      expect(
        sortRows(
          (queryClient.getQueryData(queryKey) as Array<Row> | undefined) ?? [],
        ),
      ).toEqual(sortRows(next)),
    )
    const waited = collection._state.getAcceptedSyncedRow(`k`)?.value !== 5
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
      cache: sortRows(
        (queryClient.getQueryData(queryKey) as Array<Row> | undefined) ?? [],
      ),
      stored: sortRows(adapter.rows.values()),
    }
  } finally {
    release.resolve()
    errors.mockRestore()
    await collection.cleanup()
  }
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

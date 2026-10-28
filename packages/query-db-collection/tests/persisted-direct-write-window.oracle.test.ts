import { describe, expect, it, vi } from 'vitest'
import { DuplicateKeySyncError, createCollection } from '@tanstack/db'
import { persistedCollectionOptions } from '../../db-sqlite-persistence-core/src'
import { queryCollectionOptions } from '../src/query'
import { declareOracle } from '../../db/tests/oracle-declaration.js'
import {
  checked,
  createAdapter,
  createStorage,
  deferred,
  flush,
  heldQueryFn,
  newQueryClient,
  outcomeOf,
  sortRows,
  write,
} from './persisted-direct-write-support'
import type { QueryCollectionUtils } from '../src/query'
import type { Op, Row, StorageKind } from './persisted-direct-write-support'
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
 * code, so it cannot find a fault in that code that both paths share. The
 * precedence rules for writes that interleave with refetches are pinned as
 * unit tests in `persisted-direct-write.test.ts`; they are not an oracle.
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
 * | rejected writes gain no precedence | 4 rejected writes during a held refetch, with and without persistence | utils.write* -> validation | rows and Query cache inside the refetch's fulfillment | unit tests in `persisted-direct-write.test.ts`; no oracle owner |
 * | a later accepted write keeps precedence | a second write after a deferred result arrives, same key and sibling key | deferred merge | rows, Query cache and stored rows after settlement | unit tests in `persisted-direct-write.test.ts`; no oracle owner |
 * | refetch settles after its rows apply | a deferred result, and one whose merged write is held | deferred merge -> result settlement | rows inside the refetch's fulfillment | unit tests in `persisted-direct-write.test.ts`; no oracle owner |
 * | cleanup during the wait rejects | insert, upsert and batch while cleanup retires the sync run | manual-sync -> current-context check | outcome, stored rows, rows after a restart | unit tests in `persisted-direct-write.test.ts`; no oracle owner |
 * | validation errors reject the promise | duplicate insert, with and without persistence | utils.writeInsert | `rejects.toBeInstanceOf(DuplicateKeySyncError)` | this oracle |
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
 * random campaign is claimed. The matrix comparison ignores whether an error
 * is thrown at once or rejects later. The precedence rules and the
 * duplicate-insert witness check that validation errors reject the promise.
 *
 * The driver checks that it reached the window: when the write runs, storage
 * does not hold the waiting refetch's row for `k` yet. This check does not
 * depend on when core accepts the refetch, which a fix may change. Each failure message carries
 * both observations, so a failure keeps the case that broke the law.
 */

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

/**
 * The matrix law: a direct write that runs while an earlier refetch waits for
 * the apply lock returns the outcome and rows of the no-persistence reference,
 * and storage then holds the visible rows. The reference is the model: it runs
 * the same operations after the waiting refetch has applied. The driver's
 * `waited` observation shows that the write ran inside the window.
 */
async function compareWriteWithReference(
  op: Op,
  holder: Holder,
  keyCase: KeyCase,
  kind: StorageKind = `fake`,
): Promise<void> {
  const expected = await reference(op, keyCase)
  const actual = await persisted(op, holder, keyCase, kind)
  const label = kind === `sqlite` ? `sqlite` : `persisted`
  // The driver reached the window: core had not accepted `next`.
  expect(actual.waited, `the refetch waited on the lock`).toBe(true)
  const observed = {
    outcome: actual.outcome,
    visible: actual.visible,
    cache: actual.cache,
  }
  expect(
    observed,
    `${label} ${JSON.stringify(observed)} != reference ${JSON.stringify(expected)}`,
  ).toEqual(expected)
  expect(actual.stored, `storage matches the visible rows`).toEqual(
    actual.visible,
  )
}

declareOracle({
  check: [
    compareWriteWithReference,
    compareLaterRefetchOrder,
    compareDuplicateInsert,
  ],
})

describe(`persisted direct writes behind a waiting refetch`, () => {
  for (const holder of holders) {
    for (const keyCase of keyCases) {
      for (const op of ops) {
        it(`${op} with ${holder} holding the lock, key ${keyCase}`, async () => {
          await compareWriteWithReference(op, holder, keyCase)
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

/**
 * The ordering law for a later refetch: the write's result matches the
 * no-persistence reference, and storage holds the visible rows.
 */
async function compareLaterRefetchOrder(
  start: Start,
  touch: Touch,
  kind: StorageKind = `fake`,
): Promise<void> {
  const expected = await referenceOrder(start, touch)
  const actual = await persistedOrder(start, touch, kind)
  const label = kind === `sqlite` ? `sqlite` : `persisted`
  expect(actual.waited, `the write waited on the lock`).toBe(true)
  expect(
    actual.visible,
    `${label} ${JSON.stringify(actual.visible)} != reference ${JSON.stringify(expected)}`,
  ).toEqual(expected)
  expect(actual.stored, `storage matches the visible rows`).toEqual(
    actual.visible,
  )
}

describe(`a later refetch while a persisted direct write waits`, () => {
  for (const start of [`before`, `after`] as const) {
    for (const touch of [`same`, `different`] as const) {
      it(`R3 started ${start} the write, ${touch} key`, async () => {
        await compareLaterRefetchOrder(start, touch)
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
      await compareWriteWithReference(
        op,
        `source-write`,
        `refetch-only`,
        `sqlite`,
      )
    })
  }
  for (const start of [`before`, `after`] as const) {
    for (const touch of [`same`, `different`] as const) {
      it(`R3 started ${start} the write, ${touch} key`, async () => {
        await compareLaterRefetchOrder(start, touch, `sqlite`)
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
/**
 * The duplicate-insert law: without persistence, core rejects a sync insert of an existing key;
 * the persisted collection must reject it too, and keep the stored row.
 */
async function compareDuplicateInsert(): Promise<void> {
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
    // The returned promise rejects with DuplicateKeySyncError. A
    // synchronous throw fails here, because it escapes the call before
    // `expect` receives a promise.
    for (const collection of [reference, persistedCollection]) {
      await expect(
        collection.utils.writeInsert({ id: `k`, value: 9 }),
      ).rejects.toBeInstanceOf(DuplicateKeySyncError)
    }
    await flush()
    expect(sortRows(persistedCollection.values())).toEqual(
      sortRows(reference.values()),
    )
    expect(sortRows(adapter.rows.values())).toEqual([{ id: `k`, value: 1 }])
  }, [() => reference.cleanup(), () => persistedCollection.cleanup()])
}

describe(`a persisted direct insert of an existing key`, () => {
  it(`rejects like the reference and keeps the row`, async () => {
    await compareDuplicateInsert()
  })
})

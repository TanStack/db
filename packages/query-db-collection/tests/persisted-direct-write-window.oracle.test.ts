import { describe, expect, vi } from 'vitest'
import { DuplicateKeySyncError, createCollection } from '@tanstack/db'
import { persistedCollectionOptions } from '../../db-sqlite-persistence-core/src'
import { queryCollectionOptions } from '../src/query'
import { oracleProperty } from '../../db/tests/oracle-property'
import {
  forwardAssertionJudgment,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from '../../db/tests/oracle-assertion-adapter'
import { rejectsAs } from '../../db/tests/calibration-rejection'
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
import type { PersistenceAdapter } from '../../db-sqlite-persistence-core/src'
import type { Op, Row, StorageKind } from './persisted-direct-write-support'
/**
 * # Does a direct write see the commits that came before it?
 *
 * A persisted Query Collection puts each source commit behind the persistence
 * wrapper's apply lock. While another task holds that lock, a committed
 * refetch can wait there before core accepts it. Startup hydration can also
 * hold the first result before its source commit. The Query cache alone does
 * not distinguish those orders. The contract: a direct write (`writeInsert`,
 * `writeUpdate`, `writeDelete`, `writeUpsert`) that runs in that window is
 * validated against, and applies on top of, the rows of every commit that came
 * before it. Persistence must not change what the write does.
 *
 * The reference is the same Query Collection without persistence. It runs the
 * same causal order: a preceding source commit applies before the write;
 * otherwise, its first result waits until after the write. The reference does
 * not share the persistence wrapper, which
 * is the code under judgment. It shares the Query Collection's direct-write
 * code, so it cannot find a fault in that code that both paths share. The
 * precedence rules for writes that interleave with refetches are fixed as
 * unit tests in `persisted-direct-write.test.ts`; they are not an oracle.
 *
 * ## Contract and ownership table
 *
 * | Contract | History/domain | Production path | Observation and checkpoint | Owner and limits |
 * | --- | --- | --- | --- | --- |
 * | validation respects source commit order | 4 write types x 3 lock holders x 2 key cases, including startup before the first source commit | utils.write* -> manual-sync -> persisted commit | outcome of the write: `ok` or the error name | this oracle |
 * | the write applies on top | the same | the same | visible rows after every promise settles | this oracle |
 * | the Query cache agrees | the same | updateCacheData | Query cache rows after settlement | this oracle |
 * | storage agrees | the same | persisted durable write | stored rows after settlement equal the visible rows | this oracle |
 * | real SQLite receives the same | a subset: each write type, `refetch-only`, all three holders, and the ordering cases | the same, over the node SQLite adapter | the same observations | this oracle; the full matrix runs over an in-memory fake adapter |
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
 *   waits for it. Cache availability does not prove the source committed.
 * - `initial-result-write`: the first Query result has committed; its durable
 *   write is held, so a later direct write waits for that earlier commit.
 *
 * The production driver records source commits before the direct write. That
 * causal order selects the reference schedule, never its expected row values
 * or write outcome. Commit invocation is an input event to this differential
 * law. Cache success is not that event. Requiring a commit in `startup` would
 * impose an ordering that the direct-write contract does not promise.
 * With no earlier commit, the reference holds its first result until after the
 * direct write. An early update/delete can then reject because no row is loaded
 * (query-collection.md, "Individual Write Operations"). Both committed holders
 * require positive commit reach; startup permits either legal commit order.
 *
 * A mutation confirmation does not take this lock for a Query Collection.
 * `persistAndConfirmCollectionMutations` runs only for sync-absent
 * collections, so that holder is outside this oracle.
 *
 * Key cases: `refetch-only` means only the waiting result holds key `k`.
 * `both` means the baseline also holds `k`, and the waiting result changes it.
 * The startup holder keeps that durable baseline from applying before the write.
 *
 * The domain is a finite matrix of 24 cases, not a generated history, so no
 * random campaign is claimed. The matrix comparison ignores whether an error
 * is thrown at once or rejects later. The precedence rules and the
 * duplicate-insert witness check that validation errors reject the promise.
 *
 * The driver checks that it reached the window: when the write runs, no
 * durable apply carrying the waiting result's `k` has completed. It records
 * adapter acknowledgments instead of querying SQLite inside a held transaction.
 * This check does not depend on when core accepts the refetch, which a fix may
 * change. Each failure message carries both observations, so a failure keeps
 * the case that broke the law.
 */

type Holder = `source-write` | `startup` | `initial-result-write`
type KeyCase = `refetch-only` | `both`

type Observation = {
  outcome: string
  visible: Array<Row>
  cache: Array<Row>
}

const ops: Array<Op> = [`insert`, `update`, `delete`, `upsert`]
const holders: Array<Holder> = [
  `source-write`,
  `startup`,
  `initial-result-write`,
]
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
 * Reference: no persistence. Replay the observed causal order of source commit
 * and direct write. An earlier commit decides validation; before the first
 * commit, the store is empty and the first fetch remains pending.
 */
async function reference(
  op: Op,
  keyCase: KeyCase,
  committedBeforeWrite = true,
): Promise<Observation> {
  const { base, next } = scenario(keyCase)
  let server = committedBeforeWrite ? base : next
  const releaseInitial = deferred()
  const queryClient = newQueryClient()
  const queryKey = [`reference`, op, keyCase]
  const collection = createCollection(
    queryCollectionOptions<Row>({
      id: `reference-${op}-${keyCase}`,
      queryKey,
      queryFn: async () => {
        if (!committedBeforeWrite) await releaseInitial.promise
        return server.map((row) => ({ ...row }))
      },
      queryClient,
      getKey: (row) => row.id,
      startSync: true,
    }),
  )
  return checked(async () => {
    const ready = collection.preload()
    if (committedBeforeWrite) {
      await ready
      server = next
      await collection.utils.refetch()
    }
    const { outcome } = await outcomeOf(() => write(collection.utils, op))
    releaseInitial.resolve()
    await ready
    await flush()
    return {
      outcome,
      visible: sortRows(collection.values()),
      cache: sortRows(queryClient.getQueryData(queryKey) ?? []),
    }
  }, [
    () => releaseInitial.resolve(),
    () => collection.cleanup(),
    () => queryClient.clear(),
  ])
}

/**
 * Production driver: the persisted Query Collection. The write runs while the
 * result carrying `next` waits for the held startup read or durable write.
 */
async function persisted(
  op: Op,
  holder: Holder,
  keyCase: KeyCase,
  kind: StorageKind = `fake`,
  dropFirstResult = false,
): Promise<
  Observation & {
    stored: Array<Row>
    timing: string
    waited: boolean
    commitsBeforeWrite: number
    discardedWrites: number
    readySignals: number
  }
> {
  const { base, next } = scenario(keyCase)
  const id = `persisted-${kind}-${op}-${holder}-${keyCase}`
  const storage = createStorage(kind, base, id)
  const adapter = storage.adapter
  if (kind === `sqlite` && holder === `startup`) {
    // The real adapter starts empty. Establish the same durable baseline as
    // the controlled adapter before asking the startup read to hold it.
    const seed = createCollection(
      persistedCollectionOptions<Row, string>({
        id,
        getKey: (row) => row.id,
        persistence: storage.persistence,
        sync: {
          sync: ({ begin, write: syncWrite, commit, markReady }) => {
            begin()
            for (const row of base) syncWrite({ type: `insert`, value: row })
            commit()
            markReady()
          },
        },
      }),
    )
    await seed.preload()
    await seed.cleanup()
  }
  const queryClient = newQueryClient()
  const queryKey = [`persisted`, kind, op, holder, keyCase]
  const release = deferred()
  const entered = deferred()
  let server = base
  let hold = false

  let nextDurablyApplied = false
  const holdDurableWrite =
    (
      apply: PersistenceAdapter[`applyCommittedTx`],
    ): PersistenceAdapter[`applyCommittedTx`] =>
    async (...args) => {
      if (hold && args[1].mutations.length > 0) {
        hold = false
        entered.resolve()
        await release.promise
      }
      const applied = await apply(...args)
      if (
        args[1].mutations.some(
          (mutation) =>
            mutation.type !== `delete` &&
            mutation.key === `k` &&
            (mutation.value as Row).value === 5,
        )
      )
        nextDurablyApplied = true
      return applied
    }
  const holdBaselineRead =
    (
      read: PersistenceAdapter[`loadResumeSnapshot`],
    ): PersistenceAdapter[`loadResumeSnapshot`] =>
    async (target, options) => {
      if (holder === `startup` && options?.includeRows !== false) {
        entered.resolve()
        await release.promise
      }
      return read(target, options)
    }
  const persistenceAdapter: PersistenceAdapter = adapter
  persistenceAdapter.applyCommittedTx = holdDurableWrite(
    adapter.applyCommittedTx.bind(adapter),
  )
  persistenceAdapter.loadResumeSnapshot = holdBaselineRead(
    adapter.loadResumeSnapshot.bind(adapter),
  )
  if (persistenceAdapter.runInHydrationScope) {
    // SQLite startup reads and buffered source commits use this supplied
    // adapter. Preserve the real scheduler turn and gate its methods too;
    // wrapping only the outer adapter misses commits buffered during startup.
    const runInHydrationScope =
      persistenceAdapter.runInHydrationScope.bind(persistenceAdapter)
    persistenceAdapter.runInHydrationScope = (task) =>
      runInHydrationScope((scopedAdapter) =>
        task({
          ...scopedAdapter,
          applyCommittedTx: holdDurableWrite(
            scopedAdapter.applyCommittedTx.bind(scopedAdapter),
          ),
          loadResumeSnapshot: holdBaselineRead(
            scopedAdapter.loadResumeSnapshot.bind(scopedAdapter),
          ),
        }),
      )
  }
  if (holder === `initial-result-write`) {
    server = next
    hold = true
  } else if (holder === `startup`) {
    // Hold the baseline before it applies. Neither adapter path issues an
    // observation read while the hold is live.
    server = next
  }

  const errors = vi.spyOn(console, `error`).mockImplementation(() => {})
  let sourceCommits = 0
  let discard = dropFirstResult
  let discardedWrites = 0
  let readySignals = 0
  const source = queryCollectionOptions<Row>({
    id,
    queryKey,
    queryFn: () => Promise.resolve(server.map((row) => ({ ...row }))),
    queryClient,
    getKey: (row) => row.id,
    startSync: true,
  })
  const sourceSync = source.sync.sync
  source.sync = {
    ...source.sync,
    sync: (params) =>
      sourceSync({
        ...params,
        write: (...args) => {
          if (discard) discardedWrites++
          else params.write(...args)
        },
        markReady: () => {
          readySignals++
          params.markReady()
        },
        commit: (...args) => {
          sourceCommits++
          discard = false
          return params.commit(...args)
        },
      }),
  }
  const collection = createCollection(
    persistedCollectionOptions<
      Row,
      string | number,
      never,
      QueryCollectionUtils<Row>
    >({
      ...source,
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
    // Cache availability is separate from the recorded source commit boundary.
    await vi.waitFor(() =>
      expect(sortRows(queryClient.getQueryData(queryKey) ?? [])).toEqual(
        sortRows(next),
      ),
    )
    // Durable storage has not received `next`. Record whether the source has
    // committed, rather than inferring that fact from cache availability.
    const waited = !nextDurablyApplied
    const commitsBeforeWrite = sourceCommits
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
      commitsBeforeWrite,
      discardedWrites,
      readySignals,
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
 * The matrix law: a direct write returns the outcome and rows of the
 * no-persistence reference with the same source-commit order, and storage then
 * holds the visible rows. The driver's `waited` observation shows that the
 * write ran before the waiting result durably applied.
 */
async function compareWriteWithReference(
  op: Op,
  holder: Holder,
  keyCase: KeyCase,
  kind: StorageKind = `fake`,
  dropFirstResult = false,
): Promise<void> {
  const actual = await persisted(op, holder, keyCase, kind, dropFirstResult)
  if (dropFirstResult) {
    expect(
      actual.discardedWrites,
      `mutant must discard source rows`,
    ).toBeGreaterThan(0)
    expect(
      actual.readySignals,
      `mutant must report source readiness`,
    ).toBeGreaterThan(0)
  }
  if (holder !== `startup`)
    expect(
      actual.commitsBeforeWrite,
      `source committed before the write`,
    ).toBeGreaterThan(0)
  const expected = await reference(op, keyCase, actual.commitsBeforeWrite > 0)
  const label = kind === `sqlite` ? `sqlite` : `persisted`
  // The driver reached the held durable boundary; source commit is separate.
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

type WriteCase = {
  name: string
  op: Op
  holder: Holder
  keyCase: KeyCase
  kind: StorageKind
}
// The fake-adapter matrix, then the real SQLite subset: each write type with
// the key that only the waiting refetch holds, at all three held boundaries.
const writeCases: Array<WriteCase> = [
  ...holders.flatMap((holder) =>
    keyCases.flatMap((keyCase) =>
      ops.map((op): WriteCase => ({
        name: `${op} with ${holder} holding the lock, key ${keyCase}`,
        op,
        holder,
        keyCase,
        kind: `fake`,
      })),
    ),
  ),
  ...holders.flatMap((holder) =>
    ops.map((op): WriteCase => ({
      name: `real SQLite: ${op} with ${holder} holding the lock, key refetch-only`,
      op,
      holder,
      keyCase: `refetch-only`,
      kind: `sqlite`,
    })),
  ),
]

describe(`persisted direct writes behind a waiting refetch`, () => {
  oracleProperty({
    id: `query-db.persisted-direct-write-window`,
    law: {
      statement: `A persisted direct write behind a waiting refetch returns the outcome and rows of the no-persistence reference with the same source-commit order, and storage then holds the visible rows.`,
      authority: `The direct-write window contract stated at the top of this file; docs/collections/query-collection.md, Direct Writes.`,
      limits: `Four write types, three held boundaries and two key cases over the fake adapter, and the refetch-only subset over node SQLite; no concurrent writers or failed I/O.`,
    },
    owns: [`src/query.ts#queryCollectionOptions`],
    histories: writeCases,
    label: ({ name }) => name,
    resolve: (writeCase) => ({ writeCase }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(
        `persisted direct write window`,
        plan,
        observe,
        () =>
          compareWriteWithReference(
            plan.writeCase.op,
            plan.writeCase.holder,
            plan.writeCase.keyCase,
            plan.writeCase.kind,
          ),
      ),
    check: forwardAssertionJudgment,
    // A mutant that reports readiness but discards the first source transaction
    // commits its empty metadata transaction and must fail the same comparison.
    // Selecting its causal schedule cannot excuse missing source rows at the
    // final observation cut. Each calibration configures that mutant only for
    // its own write type and storage at the startup boundary with the
    // refetch-only key, the history the old calibration ran; every other
    // history runs unchanged and passes, so the calibration reaches that one.
    calibrations: ([`fake`, `sqlite`] as const).flatMap((kind) =>
      ops.map((op) => ({
        name: `rejects a discarded first result for ${op} through ${kind}`,
        law: `persisted direct write window`,
        driver: (
          plan: { writeCase: WriteCase },
          observe: (checkpoint: string, value: unknown) => void,
        ) =>
          recordAssertionJudgment(
            `persisted direct write window`,
            plan,
            observe,
            () => {
              const { writeCase } = plan
              const mutated =
                writeCase.op === op &&
                writeCase.kind === kind &&
                writeCase.holder === `startup` &&
                writeCase.keyCase === `refetch-only`
              if (!mutated)
                return compareWriteWithReference(
                  writeCase.op,
                  writeCase.holder,
                  writeCase.keyCase,
                  writeCase.kind,
                )
              return rejectsAs(
                `discarded first result`,
                () =>
                  compareWriteWithReference(
                    op,
                    `startup`,
                    `refetch-only`,
                    kind,
                    true,
                  ),
                (failure) =>
                  expect(() => {
                    throw failure
                  }).toThrow(/reference/),
              )
            },
          ),
      })),
    ),
  })
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

/**
 * ## Real SQLite receives the same law
 *
 * The matrix above runs over an in-memory fake adapter, which supplies the
 * durable-write delay. This subset runs the same drivers over the node SQLite
 * adapter, gated the same way: each write type with the key that only the
 * waiting refetch holds, at all three held boundaries, plus the four ordering
 * cases. The same commit recorder determines the reference's causal order.
 */
type OrderCase = { name: string; start: Start; touch: Touch; kind: StorageKind }
const orderCases: Array<OrderCase> = ([`fake`, `sqlite`] as const).flatMap(
  (kind) =>
    ([`before`, `after`] as const).flatMap((start) =>
      ([`same`, `different`] as const).map((touch): OrderCase => ({
        name: `${kind === `sqlite` ? `real SQLite: ` : ``}R3 started ${start} the write, ${touch} key`,
        start,
        touch,
        kind,
      })),
    ),
)

describe(`a later refetch while a persisted direct write waits`, () => {
  oracleProperty({
    id: `query-db.persisted-direct-write-refetch-order`,
    law: {
      statement: `A refetch that started before a waiting persisted direct write loses to it on its keys and wins on the others; one that started after it wins. The visible rows equal the no-persistence reference, and storage holds them.`,
      authority: `The merge rule for direct writes and in-flight fetches stated above; docs/collections/query-collection.md, Direct Writes.`,
      limits: `Both start orders and both key choices, over the fake adapter and node SQLite.`,
    },
    owns: [`src/query.ts#queryCollectionOptions`],
    histories: orderCases,
    label: ({ name }) => name,
    resolve: (orderCase) => ({ orderCase }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(`later refetch order`, plan, observe, () =>
        compareLaterRefetchOrder(
          plan.orderCase.start,
          plan.orderCase.touch,
          plan.orderCase.kind,
        ),
      ),
    check: forwardAssertionJudgment,
  })
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
  const referenceCollection = createCollection(
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
    await referenceCollection.preload()
    await persistedCollection.preload()
    // The returned promise rejects with DuplicateKeySyncError. A
    // synchronous throw fails here, because it escapes the call before
    // `expect` receives a promise.
    for (const collection of [referenceCollection, persistedCollection]) {
      await expect(
        collection.utils.writeInsert({ id: `k`, value: 9 }),
      ).rejects.toBeInstanceOf(DuplicateKeySyncError)
    }
    await flush()
    expect(sortRows(persistedCollection.values())).toEqual(
      sortRows(referenceCollection.values()),
    )
    expect(sortRows(adapter.rows.values())).toEqual([{ id: `k`, value: 1 }])
  }, [() => referenceCollection.cleanup(), () => persistedCollection.cleanup()])
}

describe(`a persisted direct insert of an existing key`, () => {
  oracleProperty({
    id: `query-db.persisted-direct-duplicate-insert`,
    law: {
      statement: `Without persistence, core rejects a sync insert of an existing key; the persisted Collection must reject it too and keep the stored row.`,
      authority: `Core sync insert semantics (DuplicateKeySyncError); the duplicate-insert law stated above.`,
      limits: `One existing key, applied before the write runs, over the fake adapter.`,
    },
    owns: [`src/query.ts#queryCollectionOptions`],
    histories: [`rejects like the reference and keeps the row`],
    label: (name) => name,
    resolve: (name) => ({ name }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(`duplicate insert`, plan, observe, () =>
        compareDuplicateInsert(),
      ),
    check: forwardAssertionJudgment,
  })
})

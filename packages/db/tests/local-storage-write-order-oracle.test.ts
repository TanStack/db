/**
 * LocalStorage automatic writes persist in author order, over every short
 * history.
 *
 * The law is the one that `local-storage-order-oracle.test.ts` states: within
 * one Collection, a later authored write must not be replaced by an older
 * handler that happens to finish later, and no later write reports persistence
 * ahead of an undecided predecessor. A failed later handler still releases its
 * own optimistic state promptly. That file checks two writes in a fixed set of
 * schedules. This one checks every history of up to three writes, every order
 * in which their handlers finish, and every accept/reject decision, and it
 * checks the held-handler law after each handler finishes, not only once.
 *
 * Authority: the public LocalStorage guide's direct, persisted mutations;
 * Collection settlement, where a fulfilled `when('settled')` reflects the
 * accepted mutation; and the order law and prompt-failure rule in the header
 * of `local-storage-order-oracle.test.ts`.
 *
 * Limits. Writes are whole-row updates and deletes of two stored rows, made
 * by one Collection with automatic handlers. Inserts are excluded: an insert
 * after a rejected delete of the same key is undecided behaviour. Manual
 * acceptance and peer writes are outside this property because they need
 * different event and ownership boundaries; the order oracle's pinned
 * witnesses and `local-storage.peers` cover them. Storage faults and
 * histories longer than three writes are also outside it. The prompt release
 * of a failed later handler's receipt and optimistic row is witnessed only by
 * the fixed tests in `local-storage-order.test.ts` (coverage map).
 */
import { createCollection } from '../src/collection/index'
import { createDeferred } from '../src/deferred'
import { localStorageCollectionOptions } from '../src/local-storage'
import {
  initial,
  makeSeededStorage,
  sortedRows,
} from './local-storage-fixtures'
import { withHistoryCleanup } from './optimistic-history-oracle'
import { oracleProperty, pass, violation } from './oracle-property'
import type { Row } from './local-storage-fixtures'

// -- Histories ------------------------------------------------------------------
//
// A history is a list of writes, the order in which their handlers finish, and
// each handler's decision. A write is legal when it is submitted: an update or
// a delete needs its row to exist in the Collection at that moment, which is
// the authored state with every earlier write applied optimistically. The
// lists cross same-key and disjoint-key writes. An update followed by a delete
// of the same row distinguishes author order from a simple last-value
// replacement: an accepted delete removes the row even when its handler
// finishes before the update's.
//
// A test is named by its history: `ua db` is an update of `a` then a delete of
// `b`, `release 10` lets write 1's handler finish before write 0's, and
// `decisions YN` accepts write 0 and rejects write 1.

type Write = { kind: `update` | `delete`; id: `a` | `b` }
type History = {
  writes: ReadonlyArray<Write>
  release: ReadonlyArray<number>
  accepted: ReadonlyArray<boolean>
}

const MAX_WRITES = 3

function legalWriteLists(): Array<Array<Write>> {
  const lists: Array<Array<Write>> = []
  const extend = (list: Array<Write>, present: Set<string>) => {
    if (list.length > 0) lists.push(list)
    if (list.length === MAX_WRITES) return
    for (const id of [`a`, `b`] as const) {
      if (!present.has(id)) continue
      extend([...list, { kind: `update`, id }], present)
      const remaining = new Set(present)
      remaining.delete(id)
      extend([...list, { kind: `delete`, id }], remaining)
    }
  }
  extend([], new Set(initial.map((row) => row.id)))
  return lists
}

function permutations(count: number): Array<Array<number>> {
  if (count === 0) return [[]]
  return permutations(count - 1).flatMap((rest) =>
    Array.from({ length: count }, (_, at) => [
      ...rest.slice(0, at),
      count - 1,
      ...rest.slice(at),
    ]),
  )
}

function decisionVectors(count: number): Array<Array<boolean>> {
  if (count === 0) return [[]]
  return decisionVectors(count - 1).flatMap((rest) => [
    [...rest, true],
    [...rest, false],
  ])
}

const histories: Array<History> = legalWriteLists().flatMap((writes) =>
  permutations(writes.length).flatMap((release) =>
    decisionVectors(writes.length).map((accepted) => ({
      writes,
      release,
      accepted,
    })),
  ),
)

// -- Model ----------------------------------------------------------------------
//
// The model does not model handlers, optimistic overlays, storage caches, or
// sync queues. The documented effect of an accepted write, in author order: an update
// replaces the whole row with the value it authored (its position plus one),
// and a delete removes the row. A rejected write contributes nothing. The fold
// of the first m writes is what storage may hold once those m writes are
// decided, so the model returns the fold of every prefix as well as the final
// rows.

function fold(history: History, count: number): Array<Row> {
  const rows = new Map(initial.map((row) => [row.id, { ...row }]))
  history.writes.slice(0, count).forEach((write, index) => {
    if (!history.accepted[index]) return
    if (write.kind === `update`)
      rows.set(write.id, { id: write.id, value: index + 1 })
    else rows.delete(write.id)
  })
  return sortedRows(rows.values())
}

function expectedResult(history: History) {
  return {
    outcomes: history.accepted,
    rows: fold(history, history.writes.length),
    // One fold per prefix length, from no writes to all of them.
    prefixRows: Array.from({ length: history.writes.length + 1 }, (_, count) =>
      fold(history, count),
    ),
  }
}

// -- Production driver ------------------------------------------------------------
//
// One Collection with automatic update and delete handlers over seeded
// storage. The driver submits every write without waiting, holds each handler
// until the history releases it, and releases them in the history's order with
// the history's decision. After each release it lets two microtasks run, then
// records which receipts have settled and what storage holds. At the end it
// records each receipt's outcome, the durable and public rows, and the rows a
// fresh Collection restores. It records; it does not judge.

function durableRows(storage: ReturnType<typeof makeSeededStorage>) {
  const raw = storage.getItem(`rows`)
  if (raw === null) return null
  const records = JSON.parse(raw) as Record<string, { data: Row }>
  return sortedRows(Object.values(records).map(({ data }) => data))
}

async function drive(
  history: History,
  observe: (checkpoint: string, value: unknown) => void,
) {
  const { writes, release, accepted } = history
  const storage = makeSeededStorage()
  const gates = writes.map(() => createDeferred<void>())
  const entered = writes.map(() => createDeferred<void>())
  // An update names itself by the value it authored. A delete names itself by
  // its key: a legal history deletes a key at most once.
  const deletes = new Map<string, number>(
    writes.flatMap((write, index) =>
      write.kind === `delete` ? [[write.id, index] as const] : [],
    ),
  )
  const hold = (index: number) => {
    entered[index]!.resolve()
    return gates[index]!.promise
  }
  type Mutations = { mutations: Array<{ modified: Row; original: Row }> }
  const makeCollection = (withHandlers: boolean) =>
    createCollection(
      localStorageCollectionOptions<Row>({
        storageKey: `rows`,
        storage,
        storageEventApi: { addEventListener() {}, removeEventListener() {} },
        getKey: (row) => row.id,
        ...(withHandlers
          ? {
              onUpdate: ({ transaction }: { transaction: Mutations }) =>
                hold(transaction.mutations[0]!.modified.value - 1),
              onDelete: ({ transaction }: { transaction: Mutations }) =>
                hold(deletes.get(transaction.mutations[0]!.original.id)!),
            }
          : {}),
      }),
    )
  const collection = makeCollection(true)
  let reopened: ReturnType<typeof makeCollection> | undefined
  await withHistoryCleanup(
    async () => {
      await collection.preload()
      const transactions = writes.map((write, index) =>
        write.kind === `update`
          ? collection.update(write.id, (draft) => {
              draft.value = index + 1
            })
          : collection.delete(write.id),
      )
      const settled = writes.map(() => false)
      const outcomes = transactions.map((transaction, index) =>
        transaction.when(`settled`).then(
          () => ((settled[index] = true), true),
          () => ((settled[index] = true), false),
        ),
      )
      await Promise.all(entered.map((item) => item.promise))
      for (const [step, index] of release.entries()) {
        if (accepted[index]) gates[index]!.resolve()
        else gates[index]!.reject(new Error(`handler ${index} rejected`))
        await Promise.resolve()
        await Promise.resolve()
        observe(`held after release ${step + 1}`, {
          released: release.slice(0, step + 1),
          settled: [...settled],
          durable: durableRows(storage),
        })
      }
      observe(`settled`, {
        outcomes: await Promise.all(outcomes),
        durable: durableRows(storage),
        public: sortedRows(collection.values()),
      })
      reopened = makeCollection(false)
      await reopened.preload()
      observe(`fresh restore`, sortedRows(reopened.values()))
    },
    () => [
      () => gates.forEach((gate) => gate.resolve()),
      () => reopened?.cleanup(),
      () => collection.cleanup(),
    ],
  )
}

// -- Check ------------------------------------------------------------------------
//
// After each release, the released prefix is the longest run of writes, in
// author order, whose handlers have all finished. An accepted write outside it
// must not have settled: it would report persistence ahead of an undecided
// predecessor. A rejected write may settle as soon as its own handler fails.
// Storage may lag, but it may only hold the fold of some part of the released
// prefix. At settlement, the outcomes are the decisions, and storage, the
// public rows, and a fresh restore all equal the fold of every write.

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

function checkHistory(
  history: History,
  observations: ReadonlyArray<{ checkpoint: string; value: unknown }>,
  expected: ReturnType<typeof expectedResult>,
) {
  const count = history.writes.length
  for (const { checkpoint, value } of observations) {
    if (checkpoint.startsWith(`held`)) {
      const { released, settled, durable } = value as {
        released: Array<number>
        settled: Array<boolean>
        durable: Array<Row> | null
      }
      let prefix = 0
      while (prefix < count && released.includes(prefix)) prefix += 1
      for (let index = prefix; index < count; index += 1) {
        if (settled[index] && history.accepted[index])
          return violation(
            checkpoint,
            `accepted write ${index} settled while write ${prefix} was undecided`,
          )
      }
      const allowed = expected.prefixRows.slice(0, prefix + 1)
      if (!allowed.some((rows) => same(rows, durable)))
        return violation(
          checkpoint,
          `storage holds ${JSON.stringify(durable)}; only a fold of the first ${prefix} writes is allowed: ${JSON.stringify(allowed)}`,
        )
    } else if (checkpoint === `settled`) {
      const {
        outcomes,
        durable,
        public: rows,
      } = value as {
        outcomes: Array<boolean>
        durable: Array<Row> | null
        public: Array<Row>
      }
      if (!same(outcomes, expected.outcomes))
        return violation(
          checkpoint,
          `outcomes ${JSON.stringify(outcomes)}, decisions ${JSON.stringify(expected.outcomes)}`,
          undefined,
          { actual: outcomes, expected: expected.outcomes },
        )
      if (!same(durable, expected.rows))
        return violation(
          checkpoint,
          `storage ${JSON.stringify(durable)}, expected ${JSON.stringify(expected.rows)}`,
          undefined,
          { actual: durable, expected: expected.rows },
        )
      if (!same(rows, expected.rows))
        return violation(
          checkpoint,
          `public rows ${JSON.stringify(rows)}, expected ${JSON.stringify(expected.rows)}`,
          undefined,
          { actual: rows, expected: expected.rows },
        )
    } else if (!same(value, expected.rows)) {
      return violation(
        checkpoint,
        `restored ${JSON.stringify(value)}, expected ${JSON.stringify(expected.rows)}`,
        undefined,
        { actual: value, expected: expected.rows },
      )
    }
  }
  // Completeness last: a history whose driver threw keeps the violation
  // found at a recorded checkpoint.
  const seen = new Set(observations.map(({ checkpoint }) => checkpoint))
  for (const checkpoint of [`settled`, `fresh restore`]) {
    if (!seen.has(checkpoint))
      return violation(
        checkpoint,
        `the driver recorded no "${checkpoint}" observation`,
      )
  }
  return pass
}

oracleProperty({
  id: `local-storage.write-order`,
  law: {
    statement: `Automatic LocalStorage writes persist in author order: no accepted write settles or reaches storage ahead of an undecided predecessor, and settled storage, public rows, and a fresh restore equal the author-order fold of the accepted writes.`,
    authority: `LocalStorage guide (direct, persisted mutations); Collection settlement (when('settled')); order law and prompt-failure rule in local-storage-order-oracle.test.ts`,
    limits: `Up to three updates and deletes of two stored rows in one Collection; no inserts, manual acceptance, peers, or storage faults.`,
    owner: `LocalStorage Collection`,
  },
  histories,
  label: ({ writes, release, accepted }) =>
    `${writes.map((write) => `${write.kind[0]}${write.id}`).join(` `)} | release ${release.join(``)} | decisions ${accepted.map((value) => (value ? `Y` : `N`)).join(``)}`,
  model: expectedResult,
  driver: drive,
  check: checkHistory,
})

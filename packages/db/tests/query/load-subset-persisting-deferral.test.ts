import { describe, expect, it } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { createLiveQueryCollection, eq } from '../../src/query/index.js'
import { createTransaction } from '../../src/transactions'

// Reproduction for the on-demand `loadSubset` readiness bug.
//
// When any user transaction on a collection is in state `persisting`, a synced
// transaction committed by `loadSubset` is parked by `commitPendingTransactions`
// (src/collection/state.ts skips applying while `hasPersistingTransaction`), yet
// the `loadSubset` promise still resolves and the live query still marks ready.
// So `toArrayWhenReady()` resolves with an empty/stale result for rows that were
// actually fetched and committed.
//
// The `loadSubset` below begins/writes/commits synchronously and then resolves —
// exactly like @tanstack/electric-db-collection's subscribe handler does on a
// `subset-end` control message, before its `requestSnapshot` promise resolves.

interface Row {
  id: string
  projectId: string
  name: string
}

const row1: Row = { id: `r1`, projectId: `p1`, name: `a` }
const row2: Row = { id: `r2`, projectId: `p1`, name: `b` }

function createOnDemandCollection() {
  let loadSubsetCalls = 0
  const collection = createCollection<Row>({
    id: `loadsubset-persisting-repro`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        // changes-only stream at offset `now`: ready with an empty store,
        // before any subset is loaded.
        markReady()
        return {
          loadSubset: () => {
            loadSubsetCalls++
            begin()
            write({ type: `insert`, value: row1 })
            write({ type: `insert`, value: row2 })
            commit()
            return Promise.resolve()
          },
        }
      },
    },
  })
  return { collection, loadSubsetCalls: () => loadSubsetCalls }
}

// Flush queued microtasks (transaction-settlement plumbing runs on microtasks).
async function flushMicrotasks(rounds = 10) {
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve()
  }
}

describe(`on-demand loadSubset readiness vs. a persisting transaction`, () => {
  it(`returns the loaded rows with no mutation in flight (control — passes)`, async () => {
    const { collection, loadSubsetCalls } = createOnDemandCollection()

    const lq = createLiveQueryCollection((q) =>
      q.from({ row: collection }).where(({ row }) => eq(row.projectId, `p1`)),
    )
    const rows = await lq.toArrayWhenReady()

    expect(loadSubsetCalls()).toBe(1)
    expect(rows.map((r) => r.id).sort()).toEqual([`r1`, `r2`])
  })

  it(`returns the loaded rows even while an unrelated mutation is persisting`, async () => {
    const { collection, loadSubsetCalls } = createOnDemandCollection()

    // An optimistic mutation whose mutationFn is still in flight => the
    // transaction is in state `persisting`. It touches a DIFFERENT row that
    // does not match the query predicate.
    let resolveMutation: (() => void) | undefined
    const tx = createTransaction({
      mutationFn: () =>
        new Promise<void>((resolve) => {
          resolveMutation = resolve
        }),
    })
    tx.mutate(() =>
      collection.insert({ id: `other`, projectId: `p2`, name: `x` }),
    )
    expect(tx.state).toBe(`persisting`)

    const lq = createLiveQueryCollection((q) =>
      q.from({ row: collection }).where(({ row }) => eq(row.projectId, `p1`)),
    )
    const rows = await lq.toArrayWhenReady()

    // `loadSubset` ran (fetched + committed r1/r2) and the live query resolved
    // ready — so the read must contain them.
    expect(loadSubsetCalls()).toBe(1)
    // vvv FAILS today: receives []. The committed synced transaction is parked
    //     in `pendingSyncedTransactions` behind the persisting transaction.
    expect(rows.map((r) => r.id).sort()).toEqual([`r1`, `r2`])

    // The rows are parked, not lost: once the mutation settles they become
    // readable, with no further `loadSubset` call.
    resolveMutation?.()
    await tx.isPersisted.promise
    await flushMicrotasks()
    expect(
      collection.toArray
        .filter((r) => r.projectId === `p1`)
        .map((r) => r.id)
        .sort(),
    ).toEqual([`r1`, `r2`])
    expect(loadSubsetCalls()).toBe(1)
  })
})

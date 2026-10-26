import { describe, expect, it } from 'vitest'
import { declareOracle } from './oracle-config.js'
import { stripVirtualProps } from './utils.js'
import {
  initial,
  orders,
  pendingTransaction,
  source,
} from './optimistic-composition-fixture.js'
import type { Row } from './optimistic-composition-fixture.js'

/**
 * Which row does a key show while several optimistic transactions cover it?
 *
 * Contract: each pending or persisting transaction records a whole-row
 * snapshot when it mutates. The visible row is the snapshot of the newest
 * live transaction, or the synced row when none is live. A settled
 * transaction contributes nothing: its optimistic state drops when its
 * mutationFn returns. A sync transaction committed while a mutation persists
 * is held, then publishes in the same publication as that drop. Its `$origin`
 * is 'local' only when it was committed before the drop; a later commit is
 * 'remote'.
 *
 * Model: the `expected` fold in the generated matrix. It replays the
 * mutations in creation order and keeps the last snapshot that is not rolled
 * back. It does not read production layers. The matrix crosses every creation
 * order of three updates, both live phases, each rolled-back member, and
 * disjoint or overlapping fields.
 *
 * Production path and observation: public `update`, `createTransaction`, sync
 * `begin`/`write`/`commit`, and `get`. The publication case also compares a
 * subscriber replica and a downstream live query. Each check runs at the named
 * cut, after the mutation or rollback returns, or after `isPersisted` and the
 * held receipts settle.
 *
 * Limits: this file owns one key and simple row snapshots. Generated
 * multi-key settlement histories belong to `optimistic-history-oracle.ts`.
 */

const cases = orders.flatMap((order) =>
  ([`pending`, `persisting`] as const).flatMap((phase) =>
    [0, 1, 2].flatMap((removed) =>
      ([`disjoint`, `overlapping`] as const).map((fields) => ({
        order,
        phase,
        removed,
        fields,
      })),
    ),
  ),
)

// The model: the row a key shows is the newest snapshot that is not excluded,
// or the synced row when none is.
function expectedOwnedRow(
  snapshots: ReadonlyArray<Row | undefined>,
  synced: Row,
  excluded: number,
): Row {
  return snapshots.reduce<Row>(
    (last, row, index) =>
      row !== undefined && index !== excluded ? row : last,
    synced,
  )
}

// The check: the public row for the key equals the model's owned row.
function expectVisibleRow(
  collection: ReturnType<typeof source>[`collection`],
  expectedRow: Row,
): void {
  expect(stripVirtualProps(collection.get(1))).toEqual(expectedRow)
}

declareOracle({ check: [expectVisibleRow], model: [expectedOwnedRow] })

describe(`optimistic snapshot ownership`, () => {
  it.each(cases)(
    `$order / $phase / rollback $removed / $fields`,
    async ({ order, phase, removed, fields }) => {
      const fixture = source()
      const pending = [
        pendingTransaction(),
        pendingTransaction(),
        pendingTransaction(),
      ]
      const patches: Array<Partial<Row>> =
        fields === `disjoint`
          ? [{ a: `a1` }, { b: `b2` }, { c: `c3` }]
          : [{ a: `a1` }, { a: `a2`, b: `b2` }, { c: `c3` }]
      const snapshots: Array<Row | undefined> = [
        undefined,
        undefined,
        undefined,
      ]
      const expected = (excluded = -1) =>
        expectedOwnedRow(snapshots, initial, excluded)
      try {
        await fixture.collection.preload()
        for (const index of order) {
          snapshots[index] = { ...expected(), ...patches[index] }
          pending[index]!.tx.mutate(() =>
            fixture.collection.update(1, (row) => {
              Object.assign(row, patches[index])
            }),
          )
        }
        if (phase === `persisting`) {
          for (const entry of pending) void entry.tx.commit().catch(() => {})
        }
        expectVisibleRow(fixture.collection, expected())
        // Isolate one rollback's projection; conflict-cascade policy is unchanged.
        pending[removed]!.tx.rollback({ isSecondaryRollback: true })
        expectVisibleRow(fixture.collection, expected(removed))
      } finally {
        for (const entry of pending) {
          entry.tx.rollback({ isSecondaryRollback: true })
          entry.done.resolve()
        }
        await Promise.all(pending.map((entry) => entry.settled))
        await fixture.collection.cleanup()
      }
    },
  )
})

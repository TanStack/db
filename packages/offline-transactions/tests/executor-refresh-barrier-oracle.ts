import fc from 'fast-check'
import { declareOracle } from '../../db/tests/oracle-declaration'
import { differs, pass } from '../../db/tests/oracle-property'
import type { Observation } from '../../db/tests/oracle-property'

/**
 * A Collection's public deferDataRefresh promise protects pending writes while a
 * reconnect batch runs. An old batch cannot remove a newer batch's barrier.
 * Null and settled promises both let an awaiting consumer proceed. The QueryDB
 * receiving path additionally owes public refetch settlement with fresh rows.
 * Authority: Collection.deferDataRefresh's public JSDoc, offline replay/disposal
 * contracts, and QueryDB's offline-refresh e2e contract.
 *
 * This registration-free companion shares one independent judgment between the
 * core executor driver and QueryDB's real receiving driver. Each runner owns its
 * production path and campaigns. Limits: controlled Node/jsdom provider and
 * storage premises; no native browser event or remote durability claim.
 */

export type BarrierHistory = {
  count: number
  overlap: boolean
  retire: boolean
  notifications: number
}
// Zero writes exercises idle reconnect. Two or more writes permit an old batch
// to finish offline, then its public completion callback starts a new batch.
// Retirement keeps only the already-issued call eligible to finish. Counts
// zero/one/two/three distinguish idle, one owner, overlap and a queued suffix.
export const barrierHistory: fc.Arbitrary<BarrierHistory> = fc.record({
  count: fc.integer({ min: 0, max: 3 }),
  overlap: fc.boolean(),
  retire: fc.boolean(),
  notifications: fc.integer({ min: 1, max: 3 }),
})
export type BarrierCut = {
  barrier: `none` | `pending` | `settled`
  calls: Array<number>
  callers: Array<string>
  outbox: Array<number>
  errors: Array<string>
  completed: number
  query?: {
    receipt: string
    rows: Array<{ id: string; value: string }>
    staleDelivered: boolean
    deferredScheduled: boolean
  }
}
// The JSDoc's Promise projection distinguishes pending from none/settled. It
// does not independently owe null field identity. The same model also predicts
// a real receiving consumer's public receipt and rows, which can distinguish an
// installed fulfilled promise from a completed, usable QueryDB refresh.
export function barrierModel(plan: BarrierHistory) {
  return (checkpoint: string, completed: number) => ({
    callers: Array.from({ length: plan.count }, (_, index) =>
      index < completed ? `fulfilled` : `pending`,
    ),
    outbox: Array.from(
      { length: plan.count - completed },
      (_, index) => index + completed,
    ),
    blocking:
      checkpoint === `provider held` ||
      checkpoint === `newer provider held` ||
      checkpoint === `stale refetch held`,
    queryReceipt: checkpoint === `batch completed` ? `fulfilled` : `pending`,
    rows: [
      { id: `base`, value: `base` },
      ...Array.from({ length: plan.count }, (_, index) => ({
        id: String(index),
        value: `insert ${index}`,
      })),
    ].sort((left, right) => left.id.localeCompare(right.id)),
  })
}

export function checkBarrier(
  _plan: BarrierHistory,
  trace: ReadonlyArray<Observation>,
  model: ReturnType<typeof barrierModel>,
) {
  for (const { checkpoint, value } of trace) {
    if (checkpoint === `reach`) continue
    const cut = value as BarrierCut
    const expected = model(checkpoint, cut.completed)
    const error =
      differs(checkpoint, `connectivity errors`, cut.errors, []) ??
      differs(
        checkpoint,
        `refresh barrier`,
        cut.barrier === `pending`,
        expected.blocking,
      ) ??
      differs(checkpoint, `caller settlement`, cut.callers, expected.callers) ??
      differs(checkpoint, `durable ownership`, cut.outbox, expected.outbox) ??
      (cut.query
        ? (differs(
            checkpoint,
            `query refresh settlement`,
            cut.query.receipt,
            expected.queryReceipt,
          ) ??
          differs(
            checkpoint,
            `query refresh rows`,
            cut.query.rows,
            expected.rows,
          ) ??
          differs(
            checkpoint,
            `query receiving premise`,
            cut.query.staleDelivered,
            true,
          ) ??
          differs(
            checkpoint,
            `query receiving premise`,
            cut.query.deferredScheduled,
            true,
          ))
        : undefined) ??
      (checkpoint === `provider held`
        ? differs(checkpoint, `provider progress`, cut.calls, [0])
        : undefined) ??
      (checkpoint === `newer provider held`
        ? differs(checkpoint, `provider progress`, cut.calls, [0, 1])
        : undefined) ??
      (checkpoint === `retired issued call completed`
        ? differs(checkpoint, `disposal execution fence`, cut.calls, [0])
        : undefined) ??
      (checkpoint === `batch completed`
        ? differs(
            checkpoint,
            `provider progress`,
            cut.calls,
            Array.from({ length: cut.completed }, (_, index) => index),
          )
        : undefined)
    if (error) return error
  }
  return pass
}
declareOracle({
  grammar: [barrierHistory],
  model: [barrierModel],
  check: [checkBarrier],
})

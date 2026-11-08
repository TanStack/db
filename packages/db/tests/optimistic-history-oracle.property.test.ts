/**
 * # Optimistic histories, as one property
 *
 * The laws are the ones the optimistic-history module states: an optimistic
 * mutation is visible in the tick that makes it; a sync transaction committed
 * while a mutation persists is accepted and queued, and applies in the
 * publication that drops the settling mutation's optimistic state; a held
 * completed row lives only while a committed sync transaction that has not
 * applied touches its key; attribution, truncate, external completion, and
 * open source transactions behave as the module header describes. Each law the
 * check judges is named in `checkOptimisticHistory`.
 *
 * This property runs the core grammar (`optimisticHistory`) through the core
 * production path. The history resolves to a plan of concrete actions; the
 * driver records what production published and showed; the model owes, at
 * each checkpoint, the allowed cuts, rows, outcomes, receipts, and tracked
 * transactions. The seven observation mutants are calibrations.
 *
 * Limits: the core grammar has no partial-update production path, schema default,
 * pending manual edit, external completion, rejected handler, reentrant drain,
 * or ordered source operations. Those dimensions are exercised by the owners
 * that still drive `runOptimisticHistory` with fixed histories (coverage map).
 */
import { declareOracle } from './oracle-declaration.js'
import { oracleProperty } from './oracle-property.js'
import {
  checkOptimisticHistory,
  optimisticHistory,
  optimisticHistoryCalibrations,
  optimisticHistoryDriver,
  optimisticHistoryModel,
  optimisticHistoryReach,
  optimisticHistoryStates,
  resolveOptimisticHistory,
} from './optimistic-history-oracle.js'
import type {
  HistoryRow,
  OptimisticHistory,
  OptimisticStep,
} from './optimistic-history-oracle.js'

const row: HistoryRow = { id: 1, a: 0, b: 0, c: 0 }
const edit = (
  fields: Partial<Omit<HistoryRow, `id`>>,
  optimistic = true,
): OptimisticStep => ({
  type: `edit`,
  key: 1,
  fields,
  optimistic,
  inHandler: undefined,
})
const settle = (slot: number, success = true): OptimisticStep => ({
  type: `settle`,
  slot,
  success,
  cascade: false,
})
const sync = (
  rows: Array<HistoryRow>,
  truncate = false,
  copies = 1,
): OptimisticStep => ({ type: `sync`, rows, deletes: [], truncate, copies })

// Regressions from the settlement-boundary owner, written in the grammar's
// own form so that they shrink like generated histories.
const cases: Array<{
  name: string
  initial: Array<HistoryRow>
  steps: Array<OptimisticStep>
}> = [
  {
    name: `one confirmation for repeated queued writes`,
    initial: [row],
    steps: [edit({ a: 1 }), sync([{ ...row, a: 1 }], false, 2), settle(0)],
  },
  {
    name: `an acknowledged insert cannot remove an accepted update`,
    initial: [],
    steps: [
      edit({ a: 1 }),
      sync([{ ...row, a: 1 }], false),
      edit({ b: 2 }),
      settle(1),
      settle(0, false),
    ],
  },
  {
    name: `failed insertion cannot remove later same-key snapshots`,
    initial: [],
    steps: [
      edit({ a: 1 }),
      edit({ b: 1 }),
      settle(1),
      settle(0, false),
      edit({ a: 2 }),
      edit({ b: 2 }),
      settle(1),
      settle(0),
    ],
  },
  ...[true, false].map((success) => ({
    name: `dependent snapshot follows insert settlement: ${success}`,
    initial: [],
    steps: [edit({ a: 1 }), edit({ b: 2 }), settle(1), settle(0, success)],
  })),
  ...[true, false].map((truncate) => ({
    name: `failed birth does not erase accepted sibling attribution: ${truncate}`,
    initial: [],
    steps: [
      edit({ a: 1 }),
      edit({ b: 2 }),
      settle(1),
      settle(0, false),
      sync([row], truncate),
    ],
  })),
  {
    name: `a later accepted update survives an earlier failed insertion`,
    initial: [],
    steps: [edit({ a: 1 }), edit({ b: 2 }), settle(0, false), settle(0)],
  },
  ...[true, false].map((truncate) => ({
    name: `sync retirement precedes rebuilding active snapshots: ${truncate}`,
    initial: [],
    steps: [
      edit({ a: 1 }),
      edit({ b: 2 }),
      settle(1),
      sync([], truncate),
      settle(0, false),
    ],
  })),
  {
    name: `unchanged persistence completion does not publish`,
    initial: [row],
    steps: [edit({ a: 1 }), settle(0)],
  },
  {
    name: `truncate preserves the captured whole row`,
    initial: [row],
    steps: [edit({ a: 1 }), sync([{ ...row, b: 2 }], true), settle(0)],
  },
  {
    name: `rollback does not rewrite a later captured request`,
    initial: [row],
    steps: [edit({ a: 1 }), edit({ b: 2 }), settle(0, false), settle(0)],
  },
  {
    name: `duplicate writes retain a local acknowledgement within a batch`,
    initial: [],
    steps: [edit({ a: 1 }, false), sync([{ ...row, a: 1 }], false, 2)],
  },
  {
    name: `a persisting peer does not hide rollback publication`,
    initial: [],
    steps: [edit({ a: 1 }, false), edit({ a: 2 }), sync([]), settle(1, false)],
  },
  {
    name: `truncate retains pending nonoptimistic attribution`,
    initial: [],
    steps: [
      edit({ a: 1 }, false),
      sync([], true),
      sync([{ ...row, a: 1 }], false),
    ],
  },
  {
    name: `completed sibling does not erase active truncate attribution`,
    initial: [],
    steps: [
      edit({ a: 1 }, false),
      edit({ a: 2 }),
      settle(1),
      sync([{ ...row, a: 1 }], true),
    ],
  },
  {
    name: `removal of a truncate-retained snapshot reaches subscribers`,
    initial: [],
    steps: [edit({ a: 1 }), settle(0), sync([], true), sync([])],
  },
  // The seed-1 random campaign's shrunk counterexample, found when the
  // model compared visible rows through JSON, which erases a zero's sign.
  // The rolled-back flipZeros edit turns the row's zeros back from 0 to -0,
  // a visible change (-0 and 0 are distinct row values, maintainer
  // decision 2026-10-29), so the settlement is not quiet.
  {
    name: `a rollback that only flips a zero's sign publishes`,
    initial: [],
    steps: [
      {
        type: `edit`,
        key: 3,
        fields: { c: -0 },
        optimistic: true,
        inHandler: {
          type: `sync`,
          rows: [],
          deletes: [],
          truncate: false,
          copies: 1,
          awaitReceipt: false,
        },
      },
      {
        type: `edit`,
        key: 3,
        fields: { a: 0, b: 0, c: 0 },
        optimistic: true,
        inHandler: undefined,
        flipZeros: true,
      },
      settle(1, false),
      {
        type: `edit`,
        key: 1,
        fields: { c: -0 },
        optimistic: false,
        inHandler: undefined,
      },
      settle(0, false),
    ],
  },
]

// What this oracle owns: the gap report judges every function in
// src/transactions.ts and src/collection/state.ts by this file's generated
// optimistic and sync histories.

declareOracle({
  owns: [`src/transactions.ts`, `src/collection/state.ts`],
})

oracleProperty({
  id: `optimistic-history.core`,
  law: {
    statement: `Optimistic and sync histories expose the rows, publications, request outcomes, receipts, and tracked transactions that the optimistic-history model owes at every step.`,
    authority: `packages/db/tests/optimistic-history-oracle.ts header (the optimistic and sync history contract); the public transaction contract for commit admission and terminal outcomes`,
    limits: `The core grammar and production path only: no partial-update production path, schema default, pending manual edit, external completion, rejected handler, reentrant drain, ordered source operations, acknowledged handler write, or wrapping sync.`,
    owner: `Optimistic state`,
  },
  histories: {
    arbitrary: optimisticHistory,
    states: [],
    measured: optimisticHistoryStates,
    runs: 100,
    fixedSeeds: [86103],
    fixed: cases.map(({ name, initial, steps }) => ({
      name,
      history: { initial, steps } satisfies OptimisticHistory,
    })),
  },
  resolve: resolveOptimisticHistory,
  model: optimisticHistoryModel,
  reached: optimisticHistoryReach,
  driver: optimisticHistoryDriver(),
  check: checkOptimisticHistory,
  calibrations: optimisticHistoryCalibrations,
})

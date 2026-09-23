import { it } from 'vitest'
import { runOptimisticHistory } from './optimistic-history-oracle.js'
import type { HistoryRow, OptimisticStep } from './optimistic-history-oracle.js'

const row: HistoryRow = { id: 1, a: 0, b: 0, c: 0 }
const edit = (
  fields: Partial<Omit<HistoryRow, `id`>>,
  optimistic = true,
): OptimisticStep => ({ type: `edit`, key: 1, fields, optimistic })
const settle = (slot: number, success = true): OptimisticStep => ({
  type: `settle`,
  slot,
  success,
  cascade: false,
})
const sync = (
  rows: Array<HistoryRow>,
  truncate = false,
  immediate = false,
  copies = 1,
): OptimisticStep => ({ type: `sync`, rows, truncate, immediate, copies })

// Every regression is a program for the same model, driver and checkpoint
// assertions used by generated histories. Membership work has its own generated
// law in query/derived-delete-reconciliation.test.ts.
const cases: Array<{
  name: string
  initial: Array<HistoryRow>
  steps: Array<OptimisticStep>
}> = [
  {
    name: `one confirmation for repeated queued writes`,
    initial: [row],
    steps: [
      edit({ a: 1 }),
      sync([{ ...row, a: 1 }], false, false, 2),
      settle(0),
    ],
  },
  {
    name: `an acknowledged insert cannot remove an accepted update`,
    initial: [],
    steps: [
      edit({ a: 1 }),
      sync([{ ...row, a: 1 }], false, true),
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
      sync([], truncate, true),
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
    steps: [edit({ a: 1 }, false), sync([{ ...row, a: 1 }], false, true, 2)],
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
      sync([{ ...row, a: 1 }], false, true),
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
]

it.each(cases)(`oracle replay: $name`, async ({ initial, steps }) => {
  await runOptimisticHistory(initial, steps)
})

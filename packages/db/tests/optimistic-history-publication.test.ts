import { expect, it } from 'vitest'
import { runOptimisticHistory } from './optimistic-history-oracle.js'
import type { HistoryRow, OptimisticStep } from './optimistic-history-oracle.js'

const initial: Array<HistoryRow> = [
  { id: 1, a: 0, b: 0, c: 0 },
  { id: 2, a: 0, b: 0, c: 0 },
]

it.each([false, true])(
  `deletes the prior published row, queued insert=%s`,
  async (insert) => {
    await runOptimisticHistory(insert ? [] : [{ id: 2, a: 0, b: 0, c: 0 }], [
      { type: `edit`, key: 1, fields: { b: 0 }, optimistic: false },
      {
        type: `sync`,
        rows: [{ id: 2, a: 0, b: 0, c: -1 }],
        truncate: false,
        immediate: false,
        copies: 1,
      },
      { type: `sync`, rows: [], truncate: true, immediate: false, copies: 1 },
    ])
  },
)

const history = (success: boolean): Array<OptimisticStep> => [
  { type: `edit`, key: 1, fields: { a: 1 }, optimistic: true },
  {
    type: `sync`,
    rows: initial.map((row) => ({ ...row, b: 2 })),
    truncate: false,
    immediate: false,
    copies: 1,
  },
  { type: `settle`, slot: 0, success, cascade: false },
]

it.each([false, true])(
  `preserves old origin through truncate, replacement=%s`,
  async (replace) => {
    await runOptimisticHistory(initial, [
      { type: `edit`, key: 1, fields: { c: 1 }, optimistic: false },
      {
        type: `sync`,
        rows: replace ? initial : [],
        truncate: true,
        immediate: false,
        copies: 1,
      },
    ])
  },
)

it.each([true, false])(
  `checks every complete publication through settlement %s`,
  async (success) => {
    await runOptimisticHistory(initial, history(success))
  },
)

it.each([
  `wrong-key`,
  `transient-field`,
  `partial-batch`,
  `backwards-cuts`,
  `previous-value`,
  `update-as-insert`,
] as const)(`rejects captured callback corruption: %s`, async (fault) => {
  // Rollback then queued source drain supplies two distinct complete cuts.
  await runOptimisticHistory(initial, history(false))
  await expect(
    runOptimisticHistory(initial, history(false), fault),
  ).rejects.toThrow(
    /native callback key|whole forward publication|callback-time complete source|event semantics/,
  )
})

import { expect, it } from 'vitest'
import { runOptimisticHistory } from './optimistic-history-oracle.js'
import type { HistoryRow, OptimisticStep } from './optimistic-history-oracle.js'

const initial: Array<HistoryRow> = [
  { id: 1, a: 0, b: 0, c: 0 },
  { id: 2, a: 0, b: 0, c: 0 },
]

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
] as const)(`rejects captured callback corruption: %s`, async (fault) => {
  // Rollback then queued source drain supplies two distinct complete cuts.
  await runOptimisticHistory(initial, history(false))
  await expect(
    runOptimisticHistory(initial, history(false), fault),
  ).rejects.toThrow(
    /native callback key|whole forward publication|callback-time complete source/,
  )
})

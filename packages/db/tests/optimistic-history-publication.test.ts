import { expect, it } from 'vitest'
import { runOptimisticHistory } from './optimistic-history-oracle.js'
import type { HistoryRow, OptimisticStep } from './optimistic-history-oracle.js'

/**
 * # Does each optimistic history publish complete source cuts?
 *
 * These short distinguishing histories focus on publication boundaries that a
 * final-row assertion can miss: deletes of prior rows, truncate replacement,
 * origin retention, rollback followed by queued source drain, and exact event
 * semantics. The shared history model supplies expected rows and batches.
 * Corruption cases prove the driver rejects wrong keys, partial or reversed
 * cuts, stale previous values, and updates mislabeled as inserts.
 */

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

it(`publishes a failed insert before draining a queued same-key sync write`, async () => {
  const failed = { id: 2, a: 2, b: 0, c: 0 }
  const synced = { id: 2, a: 3, b: 0, c: 0 }
  const steps: Array<OptimisticStep> = [
    { type: `edit`, key: 1, fields: { a: 1 }, optimistic: false },
    { type: `edit`, key: 2, fields: { a: 2 }, optimistic: true },
    {
      type: `sync`,
      rows: [synced],
      truncate: false,
      immediate: false,
      copies: 1,
    },
    {
      type: `settle`,
      slot: 1,
      success: false,
      cascade: false,
      failure: `reject`,
    },
    { type: `settle`, slot: 0, success: true, cascade: false },
  ]
  const result = await runOptimisticHistory([], steps)

  expect(result).toMatchObject({ edits: 2, failures: 1, queued: 1 })
  expect(result.eventTrace).toStrictEqual([
    {
      step: 1,
      changes: [
        {
          type: `insert`,
          key: 2,
          value: { ...failed, $origin: `local`, $synced: false },
          previousValue: undefined,
          metadata: undefined,
        },
      ],
    },
    {
      step: 3,
      changes: [
        {
          type: `delete`,
          key: 2,
          value: { ...failed, $origin: `local`, $synced: false },
          previousValue: undefined,
          metadata: undefined,
        },
      ],
    },
    {
      step: 4,
      changes: [
        {
          type: `insert`,
          key: 2,
          value: { ...synced, $origin: `remote`, $synced: true },
          previousValue: undefined,
          metadata: undefined,
        },
      ],
    },
  ])
  await expect(
    runOptimisticHistory([], steps, `missing-delete`),
  ).rejects.toThrow(/3: .*whole forward publication/)
})

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

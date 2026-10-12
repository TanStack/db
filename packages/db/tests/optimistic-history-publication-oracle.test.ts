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
        copies: 1,
      },
      { type: `sync`, rows: [], truncate: true, copies: 1 },
    ])
  },
)

const history = (success: boolean): Array<OptimisticStep> => [
  { type: `edit`, key: 1, fields: { a: 1 }, optimistic: true },
  {
    type: `sync`,
    rows: initial.map((row) => ({ ...row, b: 2 })),
    truncate: false,
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

// A source has no causal-origin field. The model therefore gives the first
// queued same-key sync transaction local attribution at successful settlement,
// even when an independent peer supplied it. A later transaction on that key
// replaces its row with remote attribution. These histories make that limit
// visible at the settlement publication.
it.each([1, 2] as const)(
  `attributes only the first of %i queued same-key source transactions locally`,
  async (sourceTransactions) => {
    const steps: Array<OptimisticStep> = [
      { type: `edit`, key: 1, fields: { a: 1 }, optimistic: true },
      {
        type: `sync`,
        rows: [{ id: 1, a: 2, b: 0, c: 0 }],
        truncate: false,
        copies: 1,
      },
      ...(sourceTransactions === 2
        ? [
            {
              type: `sync` as const,
              rows: [{ id: 1, a: 3, b: 0, c: 0 }],
              truncate: false,
              copies: 1,
            },
          ]
        : []),
      { type: `settle`, slot: 0, success: true, cascade: false },
    ]
    const counts = await runOptimisticHistory([], steps)
    expect(counts).toMatchObject({
      edits: 1,
      settlements: 1,
      queued: sourceTransactions,
      sourceInserts: 1,
    })
  },
)

// Attribution belongs to one atomic source transaction, even when it writes
// the same key twice. Its final row keeps the attribution of its first write.
it(`keeps local attribution through repeated same-key writes in one source transaction`, async () => {
  const counts = await runOptimisticHistory(
    [{ id: 1, a: 0, b: 0, c: 0 }],
    [
      { type: `edit`, key: 1, fields: { a: 1 }, optimistic: true },
      {
        type: `sync`,
        rows: [
          { id: 1, a: 2, b: 0, c: 0 },
          { id: 1, a: 3, b: 0, c: 0 },
        ],
        truncate: false,
        copies: 1,
      },
      { type: `settle`, slot: 0, success: true, cascade: false },
    ],
  )
  expect(counts).toMatchObject({
    edits: 1,
    queued: 1,
    settlements: 1,
    sourceInserts: 0,
  })
})

// A delete and reinsert in one accepted source transaction have one origin
// snapshot. Moving the reinsert to a later transaction consumes that origin
// before the later write, which distinguishes the atomic boundary.
it.each([false, true])(
  `attributes a delete and reinsert in one source transaction, later=%s`,
  async (later) => {
    const counts = await runOptimisticHistory(
      [{ id: 1, a: 0, b: 0, c: 0 }],
      [
        { type: `edit`, key: 1, fields: { a: 1 }, optimistic: true },
        {
          type: `sync`,
          rows: [],
          operations: [
            { type: `delete`, key: 1 },
            { type: `row`, row: { id: 1, a: 2, b: 0, c: 0 } },
          ],
          truncate: false,
          copies: 1,
        },
        ...(later
          ? [
              {
                type: `sync` as const,
                rows: [{ id: 1, a: 3, b: 0, c: 0 }],
                truncate: false,
                copies: 1,
              },
            ]
          : []),
        { type: `settle`, slot: 0, success: true, cascade: false },
      ],
    )
    expect(counts).toMatchObject({
      sourceInserts: 1,
      sourceDeletes: 1,
      queued: later ? 2 : 1,
    })
  },
)

// A source delete also touches the key even when that source held no row.
// It consumes the one local attribution, so a later source insert is remote.
it(`consumes local attribution with an absent-key source delete`, async () => {
  const counts = await runOptimisticHistory(
    [],
    [
      { type: `edit`, key: 1, fields: { a: 1 }, optimistic: true },
      { type: `sync`, rows: [], deletes: [1], truncate: false, copies: 1 },
      {
        type: `sync`,
        rows: [{ id: 1, a: 2, b: 0, c: 0 }],
        truncate: false,
        copies: 1,
      },
      { type: `settle`, slot: 0, success: true, cascade: false },
    ],
  )
  expect(counts).toMatchObject({
    edits: 1,
    settlements: 1,
    queued: 2,
    sourceDeletes: 1,
    absentSourceDeletes: 1,
    sourceInserts: 1,
  })
})

// Unlike an ordinary queued batch, a truncate publishes while the mutation
// still persists. A same-key source row can therefore receive local attribution
// even if that mutation later fails. The model compares both publication cuts.
it(`retains active-mutation attribution from a truncate after failure`, async () => {
  const counts = await runOptimisticHistory(
    [],
    [
      { type: `edit`, key: 1, fields: { a: 1 }, optimistic: true },
      {
        type: `sync`,
        rows: [{ id: 1, a: 2, b: 0, c: 0 }],
        truncate: true,
        copies: 1,
      },
      { type: `settle`, slot: 0, success: false, cascade: false },
    ],
  )
  expect(counts).toMatchObject({
    edits: 1,
    settlements: 1,
    replacements: 1,
    failures: 1,
    sourceInserts: 1,
  })
})

// A manual local transaction is active before its mutation function starts.
// Source writes do not wait for it, so settlement exposes the already applied
// source row and its key-and-timing attribution. Optimistic visibility and
// fulfillment and handler rejection are separate dimensions of that attribution.
it.each(
  [false, true].flatMap((optimistic) =>
    ([`rollback`, `reject`, `success`] as const).map((outcome) => ({
      optimistic,
      outcome,
    })),
  ),
)(
  `keeps source attribution through pending settlement, optimistic=$optimistic outcome=$outcome`,
  async ({ optimistic, outcome }) => {
    const counts = await runOptimisticHistory(
      [],
      [
        { type: `edit`, key: 1, fields: { a: 1 }, optimistic, pending: true },
        {
          type: `sync`,
          rows: [{ id: 1, a: 2, b: 0, c: 0 }],
          truncate: false,
          copies: 1,
        },
        {
          type: `settle`,
          slot: 0,
          success: outcome === `success`,
          cascade: false,
          ...(outcome === `success` ? {} : { failure: outcome }),
        },
      ],
    )
    expect(counts).toMatchObject({
      edits: 1,
      failures: outcome === `success` ? 0 : 1,
      sourceInserts: 1,
    })
  },
)

// The first manual transaction starts its mutation function only at commit.
// A later automatic edit must not replace the handler promise for that request.
it.each([false, true])(
  `settles an earlier pending manual request after a later edit starts, success=%s`,
  async (success) => {
    const counts = await runOptimisticHistory(
      [],
      [
        {
          type: `edit`,
          key: 1,
          fields: { a: 1 },
          optimistic: true,
          pending: true,
        },
        { type: `edit`, key: 2, fields: { a: 2 }, optimistic: true },
        {
          type: `settle`,
          slot: 0,
          success,
          cascade: false,
          ...(success ? {} : { failure: `reject` as const }),
        },
        { type: `settle`, slot: 0, success: true, cascade: false },
      ],
    )
    expect(counts).toMatchObject({
      edits: 2,
      settlements: 2,
      failures: success ? 0 : 1,
    })
  },
)

// A source callback commits a truncate and successor during an earlier drain.
// The suffix truncate gets active attribution again. The later same-key
// transaction in the suffix drain is remote after the truncate consumes it.
it.each([false, true])(
  `consumes truncate attribution before a later same-key transaction in one drain, later=%s`,
  async (later) => {
    const counts = await runOptimisticHistory(
      [{ id: 1, a: 0, b: 0, c: 0 }],
      [
        { type: `edit`, key: 1, fields: { a: 1 }, optimistic: true },
        {
          type: `reentrant`,
          trigger: {
            type: `sync`,
            rows: [{ id: 1, a: 2, b: 0, c: 0 }],
            truncate: true,
            copies: 1,
          },
          batches: [
            {
              type: `sync`,
              rows: [{ id: 1, a: 3, b: 0, c: 0 }],
              truncate: true,
              copies: 1,
            },
            ...(later
              ? [
                  {
                    type: `sync` as const,
                    rows: [{ id: 1, a: 4, b: 0, c: 0 }],
                    truncate: false,
                    copies: 1,
                  },
                ]
              : []),
          ],
        },
        { type: `settle`, slot: 0, success: false, cascade: false },
      ],
    )
    expect(counts).toMatchObject({
      edits: 1,
      failures: 1,
      replacements: 2,
    })
  },
)

// A truncate consumes attribution for keys it writes, while an active edit on
// another key still owns its first later source transaction in the same drain.
// The nonoptimistic lane exposes source origin at the drain cut; the optimistic
// lane exposes it when the failed edit drops its overlay.
it.each([false, true])(
  `retains active attribution for another key after truncate, optimistic=%s`,
  async (optimistic) => {
    const counts = await runOptimisticHistory(
      [],
      [
        { type: `edit`, key: 2, fields: { a: 1 }, optimistic },
        {
          type: `reentrant`,
          trigger: {
            type: `sync`,
            rows: [{ id: 1, a: 1, b: 0, c: 0 }],
            truncate: true,
            copies: 1,
          },
          batches: [
            {
              type: `sync`,
              rows: [{ id: 1, a: 2, b: 0, c: 0 }],
              truncate: true,
              copies: 1,
            },
            {
              type: `sync`,
              rows: [{ id: 2, a: 3, b: 0, c: 0 }],
              truncate: false,
              copies: 1,
            },
          ],
        },
        { type: `settle`, slot: 0, success: false, cascade: false },
      ],
    )
    expect(counts).toMatchObject({
      edits: 1,
      settlements: 1,
      failures: 1,
      replacements: 2,
      sourceInserts: 3,
    })
  },
)

// Two active same-key mutations share one source key but settle independently.
// A failure cannot consume another mutation's held attribution; a second
// source transaction still needs to lose attribution after the first.
const overlappingCases = [false, true].flatMap((firstSucceeds) =>
  [false, true].flatMap((secondSucceeds) =>
    [1, 2].flatMap((sourceTransactions) =>
      [false, true].map((settleSecondFirst) => ({
        firstSucceeds,
        secondSucceeds,
        sourceTransactions,
        settleSecondFirst,
      })),
    ),
  ),
)
it.each(overlappingCases)(
  `settles overlapping same-key mutations, first=$firstSucceeds second=$secondSucceeds sources=$sourceTransactions reverse=$settleSecondFirst`,
  async ({
    firstSucceeds,
    secondSucceeds,
    sourceTransactions,
    settleSecondFirst,
  }) => {
    const counts = await runOptimisticHistory(
      [{ id: 1, a: 0, b: 0, c: 0 }],
      [
        { type: `edit`, key: 1, fields: { a: 1 }, optimistic: true },
        { type: `edit`, key: 1, fields: { b: 2 }, optimistic: true },
        {
          type: `sync`,
          rows: [{ id: 1, a: 3, b: 3, c: 0 }],
          truncate: false,
          copies: 1,
        },
        ...(sourceTransactions === 2
          ? [
              {
                type: `sync` as const,
                rows: [{ id: 1, a: 4, b: 4, c: 0 }],
                truncate: false,
                copies: 1,
              },
            ]
          : []),
        {
          type: `settle`,
          slot: settleSecondFirst ? 1 : 0,
          success: firstSucceeds,
          cascade: false,
        },
        { type: `settle`, slot: 0, success: secondSucceeds, cascade: false },
      ],
    )
    expect(counts).toMatchObject({
      edits: 2,
      settlements: 2,
      queued: sourceTransactions,
    })
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

// Found by the raw subscriber in a random campaign. A settled delete drops,
// and a later active edit covers the key while a sync transaction waits.
// The key must publish once when the edit's overlay and the sync apply.
it(`publishes a key once after a settled delete beneath a later active edit`, async () => {
  await runOptimisticHistory(
    [{ id: 1, a: 0, b: 0, c: 0 }],
    [
      { type: `delete`, key: 1, optimistic: true },
      { type: `settle`, slot: 0, success: true, cascade: false },
      { type: `edit`, key: 1, fields: { b: 1 }, optimistic: true },
      { type: `sync`, rows: [], truncate: false, copies: 1 },
      { type: `settle`, slot: 0, success: true, cascade: false },
    ],
  )
})

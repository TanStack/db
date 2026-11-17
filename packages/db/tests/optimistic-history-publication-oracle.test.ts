import { expect } from 'vitest'
import { runOptimisticHistory } from './optimistic-history-oracle.js'
import { oracleProperty } from './oracle-config.js'
import {
  forwardAssertionJudgment,
  recordAssertionJudgment,
  recordedAssertionJudgment,
  rejectAt,
} from './oracle-assertion-adapter.js'
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
 *
 * Each history below is data: its initial rows, its steps, and, where the
 * history must reach a particular attribution boundary, the counts that
 * `runOptimisticHistory` must report for it. One enumerated property replays
 * every history through that shared model and driver.
 */

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
    copies: 1,
  },
  { type: `settle`, slot: 0, success, cascade: false },
]

type PublicationHistory = {
  name: string
  initial: Array<HistoryRow>
  steps: Array<OptimisticStep>
  /** The counts the history must report, when it must reach a boundary. */
  counts?: Record<string, number>
}

const publicationHistories: Array<PublicationHistory> = [
  ...[false, true].map((insert): PublicationHistory => ({
    name: `deletes the prior published row, queued insert=${insert}`,
    initial: insert ? [] : [{ id: 2, a: 0, b: 0, c: 0 }],
    steps: [
      { type: `edit`, key: 1, fields: { b: 0 }, optimistic: false },
      {
        type: `sync`,
        rows: [{ id: 2, a: 0, b: 0, c: -1 }],
        truncate: false,
        copies: 1,
      },
      { type: `sync`, rows: [], truncate: true, copies: 1 },
    ],
  })),
  ...[false, true].map((replace): PublicationHistory => ({
    name: `preserves old origin through truncate, replacement=${replace}`,
    initial,
    steps: [
      { type: `edit`, key: 1, fields: { c: 1 }, optimistic: false },
      {
        type: `sync`,
        rows: replace ? initial : [],
        truncate: true,
        copies: 1,
      },
    ],
  })),
  ...[true, false].map((success): PublicationHistory => ({
    name: `checks every complete publication through settlement ${success}`,
    initial,
    steps: history(success),
  })),
  // A source has no causal-origin field. The model therefore gives the first
  // queued same-key sync transaction local attribution at successful
  // settlement, even when an independent peer supplied it. A later transaction
  // on that key replaces its row with remote attribution. These histories make
  // that limit visible at the settlement publication.
  ...([1, 2] as const).map((sourceTransactions): PublicationHistory => ({
    name: `attributes only the first of ${sourceTransactions} queued same-key source transactions locally`,
    initial: [],
    steps: [
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
    ],
    counts: {
      edits: 1,
      settlements: 1,
      queued: sourceTransactions,
      sourceInserts: 1,
    },
  })),
  // Attribution belongs to one atomic source transaction, even when it writes
  // the same key twice. Its final row keeps the attribution of its first write.
  {
    name: `keeps local attribution through repeated same-key writes in one source transaction`,
    initial: [{ id: 1, a: 0, b: 0, c: 0 }],
    steps: [
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
    counts: {
      edits: 1,
      queued: 1,
      settlements: 1,
      sourceInserts: 0,
    },
  },
  // A delete and reinsert in one accepted source transaction have one origin
  // snapshot. Moving the reinsert to a later transaction consumes that origin
  // before the later write, which distinguishes the atomic boundary.
  ...[false, true].map((later): PublicationHistory => ({
    name: `attributes a delete and reinsert in one source transaction, later=${later}`,
    initial: [{ id: 1, a: 0, b: 0, c: 0 }],
    steps: [
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
    counts: {
      sourceInserts: 1,
      sourceDeletes: 1,
      queued: later ? 2 : 1,
    },
  })),
  // A source delete also touches the key even when that source held no row.
  // It consumes the one local attribution, so a later source insert is remote.
  {
    name: `consumes local attribution with an absent-key source delete`,
    initial: [],
    steps: [
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
    counts: {
      edits: 1,
      settlements: 1,
      queued: 2,
      sourceDeletes: 1,
      absentSourceDeletes: 1,
      sourceInserts: 1,
    },
  },
  // Unlike an ordinary queued batch, a truncate publishes while the mutation
  // still persists. A same-key source row can therefore receive local
  // attribution even if that mutation later fails. The model compares both
  // publication cuts.
  {
    name: `retains active-mutation attribution from a truncate after failure`,
    initial: [],
    steps: [
      { type: `edit`, key: 1, fields: { a: 1 }, optimistic: true },
      {
        type: `sync`,
        rows: [{ id: 1, a: 2, b: 0, c: 0 }],
        truncate: true,
        copies: 1,
      },
      { type: `settle`, slot: 0, success: false, cascade: false },
    ],
    counts: {
      edits: 1,
      settlements: 1,
      replacements: 1,
      failures: 1,
      sourceInserts: 1,
    },
  },
  // A manual local transaction is active before its mutation function starts.
  // Source writes do not wait for it, so settlement exposes the already applied
  // source row and its key-and-timing attribution. Optimistic visibility and
  // fulfillment and handler rejection are separate dimensions of that
  // attribution.
  ...[false, true].flatMap((optimistic) =>
    ([`rollback`, `reject`, `success`] as const).map(
      (outcome): PublicationHistory => ({
        name: `keeps source attribution through pending settlement, optimistic=${optimistic} outcome=${outcome}`,
        initial: [],
        steps: [
          {
            type: `edit`,
            key: 1,
            fields: { a: 1 },
            optimistic,
            pending: true,
          },
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
        counts: {
          edits: 1,
          failures: outcome === `success` ? 0 : 1,
          sourceInserts: 1,
        },
      }),
    ),
  ),
  // The first manual transaction starts its mutation function only at commit.
  // A later automatic edit must not replace the handler promise for that
  // request.
  ...[false, true].map((success): PublicationHistory => ({
    name: `settles an earlier pending manual request after a later edit starts, success=${success}`,
    initial: [],
    steps: [
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
    counts: {
      edits: 2,
      settlements: 2,
      failures: success ? 0 : 1,
    },
  })),
  // A source callback commits a truncate and successor during an earlier
  // drain. The suffix truncate gets active attribution again. The later
  // same-key transaction in the suffix drain is remote after the truncate
  // consumes it.
  ...[false, true].map((later): PublicationHistory => ({
    name: `consumes truncate attribution before a later same-key transaction in one drain, later=${later}`,
    initial: [{ id: 1, a: 0, b: 0, c: 0 }],
    steps: [
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
    counts: {
      edits: 1,
      failures: 1,
      replacements: 2,
    },
  })),
  // A truncate consumes attribution for keys it writes, while an active edit
  // on another key still owns its first later source transaction in the same
  // drain. The nonoptimistic production path exposes source origin at the
  // drain cut; the optimistic production path exposes it when the failed edit
  // drops its overlay.
  ...[false, true].map((optimistic): PublicationHistory => ({
    name: `retains active attribution for another key after truncate, optimistic=${optimistic}`,
    initial: [],
    steps: [
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
    counts: {
      edits: 1,
      settlements: 1,
      failures: 1,
      replacements: 2,
      sourceInserts: 3,
    },
  })),
  // Two active same-key mutations share one source key but settle
  // independently. A failure cannot consume another mutation's held
  // attribution; a second source transaction still needs to lose attribution
  // after the first.
  ...[false, true].flatMap((firstSucceeds) =>
    [false, true].flatMap((secondSucceeds) =>
      [1, 2].flatMap((sourceTransactions) =>
        [false, true].map((settleSecondFirst): PublicationHistory => ({
          name: `settles overlapping same-key mutations, first=${firstSucceeds} second=${secondSucceeds} sources=${sourceTransactions} reverse=${settleSecondFirst}`,
          initial: [{ id: 1, a: 0, b: 0, c: 0 }],
          steps: [
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
            {
              type: `settle`,
              slot: 0,
              success: secondSucceeds,
              cascade: false,
            },
          ],
          counts: {
            edits: 2,
            settlements: 2,
            queued: sourceTransactions,
          },
        })),
      ),
    ),
  ),
  // Found by the raw subscriber in a random campaign. A settled delete drops,
  // and a later active edit covers the key while a sync transaction waits.
  // The key must publish once when the edit's overlay and the sync apply.
  {
    name: `publishes a key once after a settled delete beneath a later active edit`,
    initial: [{ id: 1, a: 0, b: 0, c: 0 }],
    steps: [
      { type: `delete`, key: 1, optimistic: true },
      { type: `settle`, slot: 0, success: true, cascade: false },
      { type: `edit`, key: 1, fields: { b: 1 }, optimistic: true },
      { type: `sync`, rows: [], truncate: false, copies: 1 },
      { type: `settle`, slot: 0, success: true, cascade: false },
    ],
  },
]

const publicationLaw = `optimistic-history.publication-cases`
// The captured-callback corruptions that the shared driver must reject.
const callbackFaults = [
  `wrong-key`,
  `transient-field`,
  `partial-batch`,
  `backwards-cuts`,
  `previous-value`,
  `update-as-insert`,
] as const

// What this oracle owns: the gap report judges how optimistic publication
// reaches the Collection's state, its source sync, and its transactions, by
// this file's tests. The history model and driver live in
// optimistic-history-oracle.ts.
oracleProperty({
  id: publicationLaw,
  law: {
    statement: `Each optimistic history publishes complete source cuts with the shared history model's rows, batches and event semantics, and reaches its stated attribution counts.`,
    authority: `The optimistic snapshot and settlement contract stated in optimistic-history-oracle.ts.`,
    limits: `The named distinguishing histories above and the six captured-callback corruptions of the rollback-then-drain history; no generated histories.`,
  },
  owns: [
    `src/collection/state.ts`,
    `src/collection/sync.ts`,
    `src/transactions.ts`,
  ],
  histories: publicationHistories,
  label: ({ name }) => name,
  resolve: (publication) => ({ publication }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(publicationLaw, plan, observe, async () => {
      const { initial: rows, steps, counts } = plan.publication
      const reported = await runOptimisticHistory(rows, steps)
      if (counts) expect(reported).toMatchObject(counts)
    }),
  check: forwardAssertionJudgment,
  calibrations: callbackFaults.map((fault) => ({
    name: `rejects captured callback corruption: ${fault}`,
    law: publicationLaw,
    driver: (plan: object, observe: (c: string, v: unknown) => void) =>
      recordAssertionJudgment(publicationLaw, plan, observe, async () => {
        // Rollback then queued source drain supplies two distinct complete
        // cuts.
        await runOptimisticHistory(initial, history(false))
        try {
          await runOptimisticHistory(initial, history(false), fault)
        } catch (error) {
          // Exactly the old matcher: only these rejections count as the
          // check rejecting the wrong answer.
          if (
            error instanceof Error &&
            /native callback key|whole forward publication|callback-time complete source|event semantics/.test(
              error.message,
            )
          )
            rejectAt(`calibration ${fault}`, error)
          throw new Error(
            `rejects captured callback corruption: ${fault}: the check rejected with an error the old matcher did not accept: ${String(error)}`,
          )
        }
      }),
  })),
})

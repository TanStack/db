import { describe, expect, it } from 'vitest'
import {
  checkQueuedAnswerProgress,
  createProgressReceiptCheck,
  modelProgressValue,
  queuedAnswerExample,
} from '../../packages/query-db-collection/tests/queued-answer-progress-oracle.js'
import type {
  ProgressHistory,
  ProgressOutcome,
  ProgressReceipt,
  ProgressRow,
} from '../../packages/query-db-collection/tests/queued-answer-progress-oracle.js'

/**
 * Authored observations calibrate the shared judgment. They execute no driver,
 * QueryClient, provider, production graph, or generated history. A rejected
 * receipt proves checker sensitivity only; it is not a current-main RED.
 */
const history = { ...queuedAnswerExample, nonemptyPrior: true }
const prior = modelProgressValue(history, false)
const final = modelProgressValue(history, true)
const changes = (before: Array<ProgressRow>, after: Array<ProgressRow>) => [
  ...before.map((value) => ({ type: `delete`, value })),
  ...after.map((value) => ({ type: `insert`, value })),
]
const lawful: Array<ProgressReceipt> = [
  { phase: `initial-publication`, rows: prior },
  { phase: `reload-start` },
  { phase: `retained-publication`, rows: prior },
  // These authored flags deliberately say no provider answer is pending.
  // Neither the shared checker nor its production call site relies on them.
  {
    phase: `public-change`,
    rows: prior,
    changes: [],
    pending: false,
  },
  {
    phase: `public-change`,
    rows: final,
    changes: changes(prior, final),
    pending: false,
  },
  { phase: `public-change`, rows: final, changes: [], pending: false },
  {
    phase: `final-publication`,
    rows: final,
    downstream: final,
    ready: true,
    syncError: false,
  },
  { phase: `cleanup-start` },
]
const check = (
  receipts: Array<ProgressReceipt>,
  input: ProgressHistory = history,
) => {
  const observe = createProgressReceiptCheck(input)
  for (const receipt of receipts) observe(receipt)
}

// Published row roots legitimately include these public metadata fields. The
// payload law still compares every selected id/rank/markers value, occurrence
// and position; this calibration does not judge metadata attribution/timing.
const enrich = (row: ProgressRow, collectionId = `authored-root`) => ({
  ...row,
  markers: [...row.markers],
  $hasPendingWrites: false,
  $origin: `remote`,
  $key: `authored-key-${row.id}`,
  $collectionId: collectionId,
})
const virtualLawful = (): Array<ProgressReceipt> =>
  lawful.map((receipt) => ({
    ...receipt,
    ...(receipt.rows ? { rows: receipt.rows.map((row) => enrich(row)) } : {}),
    ...(Array.isArray(receipt.downstream)
      ? {
          downstream: (receipt.downstream as Array<ProgressRow>).map((row) =>
            enrich(row, `authored-downstream`),
          ),
        }
      : {}),
    ...(Array.isArray(receipt.changes)
      ? {
          changes: (
            receipt.changes as Array<{ type: string; value: ProgressRow }>
          ).map((change) => ({ ...change, value: enrich(change.value) })),
        }
      : {}),
  }))

// These authored supervisor results calibrate the unchanged judgment's failure
// categories. A contained prefix is not a current-main execution witness.
const containedOutcome = (
  reason: ProgressOutcome[`reason`],
  executed = false,
): ProgressOutcome => ({
  reason,
  exitCode: null,
  signal: `SIGKILL`,
  bindingStatus: `bound`,
  receipts: [
    { phase: `conflicting-cache-premise`, sequence: 214 },
    { phase: `answer-queued`, sequence: 216, enqueueReturned: true },
    ...(executed ? [{ phase: `answer-executed`, sequence: 300 }] : []),
  ],
  keyCallbacks: 1,
  prefixViolations: 0,
  warnings: 0,
  cleanupErrors: [],
  logPath: `authored-pure-calibration`,
})

describe(`pure queued-progress failure classification`, () => {
  it(`identifies watchdog noncompletion only after measured premise and enqueue`, () => {
    expect(() =>
      checkQueuedAnswerProgress(history, containedOutcome(`wall`)),
    ).toThrow(`bounded queued-answer progress failure after reached premise`)
    const startup = { ...containedOutcome(`wall`), receipts: [] }
    expect(() => checkQueuedAnswerProgress(history, startup)).toThrow(
      `unmet premise or setup`,
    )
  })

  it(`does not classify a callback observed during final drain as noncompletion`, () => {
    expect(() =>
      checkQueuedAnswerProgress(history, containedOutcome(`wall`, true)),
    ).toThrow(`runtime after callback`)
  })

  it(`preserves resource termination as a separate instrument failure`, () => {
    for (const reason of [`rss`, `heap`] as const)
      expect(() =>
        checkQueuedAnswerProgress(history, containedOutcome(reason)),
      ).toThrow(`resource termination; no progress verdict`)
  })

  it(`preserves a recording failure ahead of a watchdog progress judgment`, () => {
    const outcome = containedOutcome(`wall`)
    outcome.primaryObservationError = `original receipt read failure`
    expect(() => checkQueuedAnswerProgress(history, outcome)).toThrow(
      `original receipt read failure`,
    )
  })
})

describe(`pure progress receipt comparison calibration`, () => {
  it(`accepts virtual-enriched public rows at every payload checkpoint`, () => {
    expect(() => check(virtualLawful())).not.toThrow()
  })
  it(`rejects selected payload corruption inside virtual-enriched rows`, () => {
    for (const corrupt of [
      (row: ProgressRow) => ({ ...row, id: row.id + 1 }),
      (row: ProgressRow) => ({ ...row, rank: row.rank + 1 }),
      (row: ProgressRow) => ({ ...row, markers: [900] }),
    ]) {
      const receipts = virtualLawful()
      receipts[0]!.rows = receipts[0]!.rows!.map(corrupt)
      expect(() => check(receipts)).toThrow(
        `pending answer retains complete publication`,
      )
    }
    const duplicate = virtualLawful()
    duplicate[0]!.rows!.push(duplicate[0]!.rows![0]!)
    expect(() => check(duplicate)).toThrow(
      `pending answer retains complete publication`,
    )
  })
  it(`preserves ordered row positions when public rows carry virtual fields`, () => {
    const input = { kind: `sync-initial` as const, keyShift: 0, rankScale: 10 }
    const rows = modelProgressValue(input, true).map((row) => enrich(row))
    const receipt = {
      phase: `immediate-publication`,
      cut: `subscriber-return-before-preload`,
      rows,
      ready: true,
    }
    expect(() => check([receipt], input)).not.toThrow()
    expect(() =>
      check([{ ...receipt, rows: [...rows].reverse() }], input),
    ).toThrow(`immediate-publication`)
  })
  it(`accepts complete prior-to-final publication after provider releases`, () => {
    expect(() => check(lawful)).not.toThrow()
  })
  it(`rejects a wrong transient before a later valid final publication`, () => {
    const wrong = [
      ...lawful.slice(0, 4),
      { phase: `public-change`, rows: [], changes: [], pending: false },
      ...lawful.slice(4),
    ]
    expect(() => check(wrong)).toThrow(
      `every reload callback publishes one complete snapshot`,
    )
  })
  it(`rejects a bad payload even when the callback read is correct`, () => {
    const wrong = lawful.map((receipt, index) =>
      index === 4 ? { ...receipt, changes: [] } : receipt,
    )
    expect(() => check(wrong)).toThrow(
      `payload and callback read expose the same complete value`,
    )
  })
  it(`rejects an omitted final callback even when final rows are correct`, () => {
    const wrong = [...lawful.slice(0, 4), ...lawful.slice(6)]
    expect(() => check(wrong)).toThrow(
      `final checkpoint includes every event-derived public row`,
    )
  })
  it(`rejects an absent reload boundary instead of bypassing event judgment`, () => {
    const wrong = lawful.filter(({ phase }) => phase !== `reload-start`)
    expect(() => check(wrong)).toThrow(
      `query final checkpoint follows reload start`,
    )
  })
  it(`rejects a return to prior after final first publishes`, () => {
    const wrong = [
      ...lawful.slice(0, 5),
      { phase: `public-change`, rows: prior, changes: changes(final, prior) },
      ...lawful.slice(5),
    ]
    expect(() => check(wrong)).toThrow(
      `every reload callback publishes one complete snapshot`,
    )
  })
  it(`rejects a duplicate insert without normalizing it away`, () => {
    const wrong = [
      ...lawful.slice(0, 4),
      {
        phase: `public-change`,
        rows: prior,
        changes: [{ type: `insert`, value: prior[0] }],
      },
    ]
    expect(() => check(wrong)).toThrow(`event insert has no prior row`)
  })
  it(`rejects a missing delete without normalizing it away`, () => {
    const wrong = [
      ...lawful.slice(0, 4),
      {
        phase: `public-change`,
        rows: prior,
        changes: [{ type: `delete`, value: final[0] }],
      },
    ]
    expect(() => check(wrong)).toThrow(`event operation has a prior row`)
  })
  it(`rejects duplicate updates even when their final folded value is correct`, () => {
    const wrong = [
      ...lawful.slice(0, 4),
      {
        phase: `public-change`,
        rows: prior,
        changes: [
          { type: `update`, value: prior[0] },
          { type: `update`, value: prior[0] },
        ],
      },
    ]
    expect(() => check(wrong)).toThrow(
      `one public-change operation per projected row`,
    )
  })
  it(`compares an initial synchronous snapshot at the initiating subscriber cut`, () => {
    const initial = {
      kind: `sync-initial` as const,
      keyShift: 0,
      rankScale: 10,
    }
    const immediate = {
      phase: `immediate-publication`,
      cut: `subscriber-return-before-preload`,
      rows: modelProgressValue(initial, true),
      ready: true,
    }
    expect(() => check([immediate], initial)).not.toThrow()
    expect(() => check([{ ...immediate, rows: [] }], initial)).toThrow(
      `immediate-publication`,
    )
    expect(() =>
      check([{ ...immediate, cut: `after-preload` }], initial),
    ).toThrow(`precedes a second public call`)
  })
})

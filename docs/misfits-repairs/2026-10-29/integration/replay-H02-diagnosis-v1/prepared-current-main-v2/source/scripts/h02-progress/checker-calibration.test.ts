import { describe, expect, it } from 'vitest'
import {
  createProgressReceiptCheck,
  modelProgressValue,
  queuedAnswerExample,
} from '../../packages/query-db-collection/tests/queued-answer-progress-oracle.js'
import type {
  ProgressHistory,
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

describe(`pure progress receipt comparison calibration`, () => {
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

import { fc } from '@fast-check/vitest'
import { expect } from 'vitest'
import { declareOracle } from './oracle-declaration.js'

/**
 * Raw Collection reads and a full-state raw subscriber reflect each applied
 * source transaction, even while replay acquisitions are held or failed.
 * Authority: maintainer decision in this task, 2026-10-30: raw subscribers see
 * raw commits; a live query supplies a higher-level coherent result.
 * Accepted source writes do not retract when a load later rejects.
 *
 * The prior draft withheld source rows until replay success. That expectation
 * is superseded; its RED evidence remains in review-evidence/collection-publication.
 * Live-query full-result retention is unchanged and outside this raw model.
 *
 * A PublicSnapshotCommit contains fixture-authored end-of-transaction row
 * effects. It abstracts a source transaction's writes, not a production buffer.
 * The applied prefix must come from a named application boundary: a core
 * applied receipt, or callback-time publication of that authored transaction.
 * A wrapper may expose a later durability receipt; its driver names that
 * difference. Reads never choose which commits enter the expected prefix.
 * held/failed/complete label acquisition cuts, not visibility states. Cleanup,
 * optimistic overlays and event ordering within one key remain outside this
 * bounded relation.
 */
export type PublicSnapshotRow = { id: `a` | `b` | `c` | `d`; value: number }
export type PublicSnapshotHistory = {
  initial: ReadonlyArray<PublicSnapshotRow>
  replacement: ReadonlyArray<PublicSnapshotRow>
  outcome: `resolve` | `reject`
}
export type PublicSnapshotPhase = `initial` | `held` | `failed` | `complete`

const sortedRows = (rows: ReadonlyArray<PublicSnapshotRow>) =>
  rows
    .map(({ id, value }) => ({ id, value }))
    .sort((left, right) => left.id.localeCompare(right.id))

export type PublicSnapshotCommit = {
  truncate?: boolean
  rows: ReadonlyArray<PublicSnapshotRow>
  deleted?: ReadonlyArray<PublicSnapshotRow[`id`]>
}

// Load success or failure is absent from this reducer: neither retracts an
// applied source write. The model is a plain keyed fold of authored facts.
export function expectedPublicSnapshot(
  history: PublicSnapshotHistory,
  appliedCommits: ReadonlyArray<PublicSnapshotCommit>,
): Array<PublicSnapshotRow> {
  const rows = new Map(history.initial.map((row) => [row.id, { ...row }]))
  for (const commit of appliedCommits) {
    if (commit.truncate) rows.clear()
    for (const key of commit.deleted ?? []) rows.delete(key)
    for (const row of commit.rows) rows.set(row.id, { ...row })
  }
  return sortedRows([...rows.values()])
}

export type PublicSnapshotObservation = {
  appliedCommits: ReadonlyArray<PublicSnapshotCommit>
  reads: Record<string, ReadonlyArray<PublicSnapshotRow>>
  foldedRows: ReadonlyArray<PublicSnapshotRow>
  keys?: Record<string, ReadonlyArray<PublicSnapshotRow[`id`]>>
  sizes?: Record<string, number>
}

/** One judgment is shared by core and receiving adapters. No recorder filters
 * an observation against expected membership: extra, missing and stale rows
 * must remain representable. Distinct-key iteration order is outside this law.
 */
export function checkPublicSnapshotObservation(
  history: PublicSnapshotHistory,
  phase: PublicSnapshotPhase,
  observation: PublicSnapshotObservation,
): void {
  if (!Object.hasOwn(observation, `appliedCommits`))
    throw new Error(
      `Public snapshot comparison requires an authored applied prefix`,
    )
  const expected = expectedPublicSnapshot(history, observation.appliedCommits)
  if (Object.keys(observation.reads).length === 0)
    throw new Error(`Public snapshot comparison requires a direct-read path`)
  if (!Object.hasOwn(observation, `foldedRows`))
    throw new Error(
      `Public snapshot comparison requires a full-state subscriber fold`,
    )
  for (const [path, rows] of Object.entries(observation.reads))
    expect(
      sortedRows(rows),
      `${phase}: public snapshot through ${path}`,
    ).toEqual(expected)
  expect(
    sortedRows(observation.foldedRows),
    `${phase}: full-state subscriber fold`,
  ).toEqual(expected)
  for (const [path, keys] of Object.entries(observation.keys ?? {}))
    expect([...keys].sort(), `${phase}: public keys through ${path}`).toEqual(
      expected.map(({ id }) => id),
    )
  for (const [path, size] of Object.entries(observation.sizes ?? {}))
    expect(size, `${phase}: public size through ${path}`).toBe(expected.length)
}

/** Membership and values vary independently of the two-demand schedule. Empty
 * baselines cover the original retained-empty report. Empty replacements must
 * delete old public rows. Same, overlapping and disjoint key sets distinguish
 * retained values from insert/delete behavior. Equal values retain the case
 * where an equal follow-up must not hide a missed earlier publication.
 * Removing any dimension loses that named distinction. Duplicate keys within
 * one row list and uncommitted source writes are outside this legal grammar.
 */
export const publicSnapshotHistoryArbitrary: fc.Arbitrary<PublicSnapshotHistory> =
  fc
    .record({
      baseline: fc.integer({ min: -20, max: 20 }),
      delta: fc.integer({ min: 1, max: 20 }),
      initial: fc.constantFrom(
        `empty` as const,
        `one` as const,
        `three` as const,
      ),
      membership: fc.constantFrom(
        `empty` as const,
        `same` as const,
        `overlap` as const,
        `disjoint` as const,
      ),
      values: fc.constantFrom(`equal` as const, `changed` as const),
      outcome: fc.constantFrom(`resolve` as const, `reject` as const),
    })
    .map(({ baseline, delta, initial, membership, values, outcome }) => {
      const initialKeys: Array<PublicSnapshotRow[`id`]> =
        initial === `empty` ? [] : initial === `one` ? [`a`] : [`a`, `b`, `c`]
      const replacementKeys: Array<PublicSnapshotRow[`id`]> =
        membership === `empty`
          ? []
          : membership === `same`
            ? initialKeys
            : membership === `overlap`
              ? [`a`, `d`]
              : initial === `empty`
                ? [`a`, `b`]
                : [`d`]
      const value = (id: PublicSnapshotRow[`id`]) =>
        baseline + id.charCodeAt(0) - 97
      return {
        initial: initialKeys.map((id) => ({ id, value: value(id) })),
        replacement: replacementKeys.map((id) => ({
          id,
          value: value(id) + (values === `changed` ? delta : 0),
        })),
        outcome,
      }
    })

// Fixed witnesses replay the same judgment as generated and receiving paths.
export const publicSnapshotHistoryExamples: ReadonlyArray<PublicSnapshotHistory> =
  [
    ...([`resolve`, `reject`] as const).flatMap((outcome) => [
      { initial: [], replacement: [{ id: `a` as const, value: 1 }], outcome },
      { initial: [{ id: `a` as const, value: 0 }], replacement: [], outcome },
      {
        initial: [{ id: `a` as const, value: 0 }],
        replacement: [{ id: `a` as const, value: 0 }],
        outcome,
      },
      {
        initial: [
          { id: `a` as const, value: 0 },
          { id: `b` as const, value: 1 },
          { id: `c` as const, value: 2 },
        ],
        replacement: [
          { id: `a` as const, value: 3 },
          { id: `d` as const, value: 5 },
        ],
        outcome,
      },
    ]),
  ]

declareOracle({
  model: [expectedPublicSnapshot],
  check: [checkPublicSnapshotObservation],
  grammar: [publicSnapshotHistoryArbitrary, publicSnapshotHistoryExamples],
})

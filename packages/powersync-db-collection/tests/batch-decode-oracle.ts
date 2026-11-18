/**
 * # Which native SQLite batches may become public after decoding refuses one?
 *
 * Native syncBatchSize permits successful initial pages to stream. A refusal
 * in a later page cannot revoke those earlier publications. The refused page
 * itself contributes no rows, and fatal deserialization ends the sync run:
 * initial eager loading fails; an already-ready source retains its rows and
 * records a terminal sync error. Its change watcher is released.
 * Unlike a user onLoadSubset hook rejection, a deserialization refusal leaves
 * the source inconsistent with SQLite; the native contract calls that fatal.
 *
 * Native schemas may transform IDs and scalar representations. Valid rows
 * retain the authored application key, boolean and Date, including updates of
 * transformed keys. A refused batch must not affect their previous values.
 * Authority: native definitions.ts deserialization contract and syncBatchSize
 * streaming promise; glossary loading error, sync error and publication.
 *
 * The model receives source SQL batches recorded at the real provider's read
 * boundary. SQLite owes no scan order. These are input facts, not Collection
 * writes: the independent model admits complete source pages before the first
 * refused page. It never reads production commits, rows or error decisions.
 * A fatal refusal remains final for that sync run. Corrected SQLite rows and
 * new subset requests cannot resume it. Cleanup followed by an explicit
 * restart admits a new valid source snapshot and clears the retired error.
 * Limits: one table, initial read or one live SQL transaction, 1–6 rows,
 * native schemas, no retained reload, persistence or local mutations.
 */
import fc from 'fast-check'
import { observeDecodeRows } from '../../db-adapter-conformance/tests/decode-refusal-oracle'
import type { DecodeValue } from '../../db-adapter-conformance/tests/decode-refusal-oracle'

export type NativeDecodeHistory = {
  mode: `eager` | `on-demand`
  phase: `initial` | `live`
  outcome: `valid` | `throw` | `issues`
  count: number
  batchSize: number
  refusalIndex: number
  transformKeys: boolean
  overlap: boolean
  coordinate: number
  epoch: number
}
export const nativeDecodeHistoryArb: fc.Arbitrary<NativeDecodeHistory> = fc
  .record({
    mode: fc.constantFrom(`eager` as const, `on-demand` as const),
    phase: fc.constantFrom(`initial` as const, `live` as const),
    outcome: fc.constantFrom(
      `valid` as const,
      `throw` as const,
      `issues` as const,
    ),
    count: fc.integer({ min: 1, max: 6 }),
    batchSize: fc.integer({ min: 1, max: 4 }),
    refusalIndex: fc.nat({ max: 1000 }),
    transformKeys: fc.boolean(),
    overlap: fc.boolean(),
    coordinate: fc.nat({ max: 100_000 }),
    epoch: fc.integer({ min: 0, max: 2_000_000_000_000 }),
  })
  .map(
    (h) => ({ ...h, refusalIndex: h.refusalIndex % h.count }),
    (h) => h as NativeDecodeHistory,
  )

export function nativeDecodeKey(
  h: NativeDecodeHistory,
  index: number,
  initial: boolean,
) {
  return `row-${h.coordinate}-${initial || h.overlap ? `shared` : `new`}-${index}`
}
export function nativeDecodeBatch(h: NativeDecodeHistory, initial: boolean) {
  return Array.from({ length: h.count }, (_, i) => ({
    id: nativeDecodeKey(h, i, initial),
    flag: (i % 2 === 0) === initial,
    when: new Date(h.epoch + i + (initial ? 0 : 10_000)),
  }))
}
// A fresh application-key set distinguishes continued old-run work from a
// valid new run. Cleanup discards the old snapshot before this restart reads.
export function nativeDecodeRecoveryBatch(h: NativeDecodeHistory) {
  return nativeDecodeBatch(
    { ...h, coordinate: h.coordinate + 100_001, epoch: h.epoch + 20_000 },
    true,
  )
}
export type NativeDecodeObservation = {
  cleanupErrors?: ReadonlyArray<string>
  browserErrors?: ReadonlyArray<string>
  sourceBatches: Array<Array<string>>
  parsed: Array<string>
  rows: Array<DecodeValue>
  publications: Array<Array<DecodeValue>>
  status: string
  load: string
  terminalError: boolean
  failureReason: boolean
  rejectedCauseMatches: boolean
  terminalCauseMatches: boolean
  watcherReleases: Array<number>
  reached: Array<string>
  continuation?: {
    sameRunRows: Array<DecodeValue>
    sameRunStatus: string
    sameRunTerminalError: boolean
    sameRunCauseStable: boolean
    sameRunDecodedRows: number
    laterSubsetLoads: Array<{
      empty: boolean
      outcome: string
      causeMatches: boolean
    }>
    restartRows: Array<DecodeValue>
    restartStatus: string
    restartTerminalError: boolean
    restartFailureReason: boolean
    restartLoad: string
    restartWatcherReleases: Array<number>
  }
}

// A batch is the provider's page, rather than the whole eager source result.
// Authored application values are independent of the user schema under test.
export function nativeDecodeModel(
  h: NativeDecodeHistory,
  sourceBatches: ReadonlyArray<ReadonlyArray<string>>,
) {
  const initial = h.phase === `initial`
  const before = initial ? [] : nativeDecodeBatch(h, true)
  const target = nativeDecodeBatch(h, initial)
  const values = new Map(target.map((row) => [row.id, row]))
  const rows = new Map(before.map((row) => [row.id, row]))
  const allowedPublications: Array<Array<DecodeValue>> = [
    observeDecodeRows(before),
  ]
  const refusal = nativeDecodeKey(h, h.refusalIndex, initial)
  for (const batch of sourceBatches) {
    if (h.outcome !== `valid` && batch.includes(refusal)) break
    for (const key of batch) {
      const row = values.get(key)
      if (row) rows.set(key, row)
    }
    if (batch.length)
      allowedPublications.push(observeDecodeRows([...rows.values()]))
  }
  return {
    rows: observeDecodeRows([...rows.values()]),
    allowedPublications,
    status:
      initial && h.mode === `eager` && h.outcome !== `valid`
        ? `error`
        : `ready`,
    load: initial && h.outcome !== `valid` ? `rejected` : `fulfilled`,
    stopped: h.outcome !== `valid`,
  }
}
export function nativeDecodeViolations(
  h: NativeDecodeHistory,
  a: NativeDecodeObservation,
): Array<string> {
  const m = nativeDecodeModel(h, a.sourceBatches)
  const errors: Array<string> = (a.browserErrors ?? []).map(
    (message) => `browser error: ${message}`,
  )
  const same = (left: unknown, right: unknown) =>
    JSON.stringify(left) === JSON.stringify(right)
  const target = nativeDecodeBatch(h, h.phase === `initial`)
  const delivered = new Set(a.sourceBatches.flat())
  if (!a.sourceBatches.length)
    errors.push(`native SQL source batch not reached`)
  if (h.outcome === `valid` && target.some((row) => !delivered.has(row.id)))
    errors.push(`source rows omitted before decode comparison`)
  const refusal = nativeDecodeKey(h, h.refusalIndex, h.phase === `initial`)
  if (
    h.outcome !== `valid` &&
    (!delivered.has(refusal) || !a.parsed.includes(refusal))
  )
    errors.push(`refusal never reached actual schema`)
  if (!same(a.rows, m.rows)) errors.push(`accepted page rows differ`)
  // A direct subscription can repeat its current snapshot at readiness. The
  // contract constrains coherent cuts, not one callback per SQL page. Every
  // recorded publication must be a complete admitted-page prefix; final rows
  // above still require all successful pages to have applied.
  let admittedPage = 0
  for (const cut of a.publications) {
    const nextPage = m.allowedPublications.findIndex(
      (allowed, index) => index >= admittedPage && same(cut, allowed),
    )
    if (nextPage < 0) {
      errors.push(
        `publication split, regressed, or crossed a refused source batch`,
      )
      break
    }
    admittedPage = nextPage
  }
  if (m.rows.length && !a.publications.length && h.phase === `initial`)
    errors.push(`accepted initial pages produced no public change`)
  if (a.status !== m.status || a.load !== m.load)
    errors.push(`refusal crossed the wrong loading boundary`)
  if (a.terminalError !== m.stopped || a.failureReason)
    errors.push(`fatal deserialization did not terminate sync health`)
  if (m.stopped && !a.terminalCauseMatches)
    errors.push(`fatal deserialization lost its cause`)
  if (h.phase === `initial` && h.outcome !== `valid` && !a.rejectedCauseMatches)
    errors.push(`loading refusal lost its cause`)
  if (
    !a.watcherReleases.length ||
    a.watcherReleases.some((n) => n !== (m.stopped ? 1 : 0))
  )
    errors.push(`fatal run retained its change watcher`)
  if (m.stopped) {
    const c = a.continuation
    if (!c) errors.push(`fatal continuation not observed`)
    else {
      if (
        !same(c.sameRunRows, m.rows) ||
        c.sameRunStatus !== m.status ||
        !c.sameRunTerminalError ||
        !c.sameRunCauseStable ||
        c.sameRunDecodedRows !== 0
      )
        errors.push(`fatal sync run resumed after corrected source rows`)
      if (
        h.mode === `on-demand` &&
        (c.laterSubsetLoads.length !== 2 ||
          c.laterSubsetLoads.some(
            (load, index) =>
              load.empty !== (index === 1) || load.outcome !== `rejected`,
          ))
      )
        errors.push(`fatal sync run admitted a later subset request`)
      // New requests may reject with a descriptive stopped error. The exact
      // original refusal belongs to stable source health, checked above.
      if (
        !same(c.restartRows, observeDecodeRows(nativeDecodeRecoveryBatch(h))) ||
        c.restartStatus !== `ready` ||
        c.restartTerminalError ||
        c.restartFailureReason ||
        c.restartLoad !== `fulfilled` ||
        !c.restartWatcherReleases.length ||
        c.restartWatcherReleases.some((count) => count !== 0)
      )
        errors.push(`explicit new sync run did not recover valid source rows`)
    }
  }
  return errors
}

export const nativeDecodeStates = [
  ...([`eager`, `on-demand`] as const).flatMap((mode) =>
    ([`initial`, `live`] as const).flatMap((phase) =>
      ([`valid`, `throw`, `issues`] as const).map(
        (outcome) => `${mode}:${phase}:${outcome}`,
      ),
    ),
  ),
  `transformed-key`,
  `live-overlap`,
  `live-fresh`,
  `refusal-first`,
  `refusal-last`,
  `accepted-earlier-page`,
  `corrected-source-after-refusal`,
  `restart-after-refusal`,
  `empty-subset-after-refusal`,
] as const

/**
 * Cleanup retires one sync run. A late list or persisted-baseline completion
 * from that run cannot change a cleaned-up Collection or a replacement run.
 * Authority: the lifecycle oracle's cleanup law in ORACLE.md and the glossary's
 * cleanup/sync-run contract. Durable accepted rows survive cleanup; a new eager
 * run's complete result replaces them (the shared persisted-startup law).
 *
 * This is a projection of the primary lifecycle oracle, not a second lifecycle
 * machine. Input bitsets encode subsets of three string keys. The judgment
 * ignores adapter gates and queues: after cleanup public rows are empty; after
 * replacement readiness they are exactly the new complete result. Resuming old
 * work preserves each observation. A subsequent new-run event still applies.
 * The production driver adds real persisted hosts to that same boundary.
 */
import * as fc from 'fast-check'

export type HydrationLifecycleRow = { id: string; value: number }
export type HydrationLifecycleHistory = {
  previous: number
  old: number
  replacement: number
  oldList: `complete` | `reject`
  resumeAt: `cleaned-up` | `replacement-loading` | `replacement-ready`
  initialRender: `default` | `network-first`
}
export const hydrationLifecycleRows = (
  mask: number,
  value: number,
): Array<HydrationLifecycleRow> =>
  [0, 1, 2].flatMap((id) =>
    mask & (1 << id) ? [{ id: String(id), value }] : [],
  )

export type HydrationLifecycleSnapshot = {
  rows: Array<HydrationLifecycleRow>
  durable: Array<HydrationLifecycleRow>
  status: string
}
export type HydrationLifecycleObservation = {
  retiredResume: HydrationLifecycleSnapshot
  ready: HydrationLifecycleSnapshot
  afterEvent: HydrationLifecycleSnapshot
  oldPreload: string
  oldCancelCalls: number
  oldLocked: boolean
  replacementLocked: boolean
  replacementReleasedAfterCleanup: boolean
  reports: Array<string>
  obsoleteBegins: number
  reached: Array<string>
}
export const hydrationLifecycleStates = [
  `hydration-held-cleanup`,
  `late-list-rejection`,
  `resume-cleaned-up`,
  `resume-replacement-loading`,
  `resume-replacement-ready`,
  `empty-replacement`,
  `nonempty-replacement`,
  `new-row-outside-old-list`,
  `old-row-omitted`,
]

// The complete replacement decides values without consulting source output.
// Before its list is delivered, only the durable old page and restored rows
// exist. Old rejected lists contribute no page rows.
export function expectedHydrationLifecycle(h: HydrationLifecycleHistory) {
  const oldRows = new Map(
    hydrationLifecycleRows(h.previous, 1).map((row) => [row.id, row]),
  )
  if (h.oldList === `complete`)
    for (const row of hydrationLifecycleRows(h.old, 2)) oldRows.set(row.id, row)
  const held = [...oldRows.values()].sort((a, b) => a.id.localeCompare(b.id))
  const replacement = hydrationLifecycleRows(h.replacement, 3)
  const afterEvent = [...replacement, { id: `3`, value: 4 }]
  return {
    retiredResume:
      h.resumeAt === `replacement-ready`
        ? { rows: replacement, durable: replacement, status: `ready` }
        : h.resumeAt === `replacement-loading`
          ? {
              rows: held,
              durable: held,
              status: `loading`,
            }
          : { rows: [], durable: held, status: `cleaned-up` },
    ready: { rows: replacement, durable: replacement, status: `ready` },
    afterEvent: { rows: afterEvent, durable: afterEvent, status: `ready` },
  }
}

export function hydrationLifecycleViolations(
  h: HydrationLifecycleHistory,
  actual: HydrationLifecycleObservation,
): Array<string> {
  const expected = expectedHydrationLifecycle(h)
  const violations: Array<string> = []
  for (const cut of [`retiredResume`, `ready`, `afterEvent`] as const)
    if (JSON.stringify(actual[cut]) !== JSON.stringify(expected[cut]))
      violations.push(
        `${cut}: ${JSON.stringify(actual[cut])} != ${JSON.stringify(expected[cut])}`,
      )
  // SQLite guide, "Render after SQLite restore": default readiness still
  // needs the adapter; network-first has not reached its deadline here.
  const oldPreload = `AbortError`
  if (actual.oldPreload !== oldPreload)
    violations.push(`old preload ${actual.oldPreload} != ${oldPreload}`)
  if (actual.oldCancelCalls !== 1 || actual.oldLocked)
    violations.push(`old stream was not canceled once and released`)
  if (!actual.replacementLocked)
    violations.push(`late old work released the replacement stream`)
  if (!actual.replacementReleasedAfterCleanup)
    violations.push(`final cleanup did not release the replacement stream`)
  if (actual.reports.length)
    violations.push(`old work reported: ${actual.reports}`)
  return violations
}

// Row subsets vary independently when the list completes. A rejected list has
// no row payload, represented by old=0 rather than a redundant random subset.
// Exclude no legal overlap. Every run cleans up the old source before it resumes;
// list rejection never pretends to have reached the later hydration await.
const hydrationLifecycleCommon = {
  previous: fc.integer({ min: 0, max: 7 }),
  replacement: fc.integer({ min: 0, max: 7 }),
  initialRender: fc.constantFrom(`default` as const, `network-first` as const),
  resumeAt: fc.constantFrom(
    `cleaned-up` as const,
    `replacement-loading` as const,
    `replacement-ready` as const,
  ),
}
export const hydrationLifecycleHistoryArb = fc.oneof(
  fc.record({
    ...hydrationLifecycleCommon,
    oldList: fc.constant(`complete` as const),
    old: fc.integer({ min: 0, max: 7 }),
  }),
  fc.record({
    ...hydrationLifecycleCommon,
    oldList: fc.constant(`reject` as const),
    old: fc.constant(0),
  }),
)
export const hydrationLifecycleHistories: Array<HydrationLifecycleHistory> = (
  [`cleaned-up`, `replacement-loading`, `replacement-ready`] as const
).flatMap((resumeAt) =>
  ([`complete`, `reject`] as const).flatMap((oldList) =>
    [0, 6].flatMap((replacement) =>
      ([`default`, `network-first`] as const).map((initialRender) => ({
        previous: 3,
        old: oldList === `complete` ? 1 : 0,
        replacement,
        oldList,
        resumeAt,
        initialRender,
      })),
    ),
  ),
)

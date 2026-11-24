/**
 * Coherent acquired-source revisions remain a legal keyed baseline across
 * deferred, accepted and applied settlement. Authority: SyncAppliedReceipt,
 * whenSyncAccepted and the glossary's accepted/deferred sync transactions.
 *
 * These histories supply whole authored source relations. LazyVersionModel
 * judges their monotone public publications; the exact row comparison below
 * judges accepted and applied checkpoints. No production insert/update
 * classifier supplies an expected row. Each receiving driver supplies its
 * provider and storage. Six revisions bound the claim; arbitrary scopes,
 * failed acceptance and commit reentry belong to separate owners.
 */
import fc from 'fast-check'
import { expectedLazyRows } from './lazy-paging-model-oracle'
import type { LazyRow } from './lazy-paging-model-oracle'

export const deferredBaselineGrammar = fc.record({
  size: fc.integer({ min: 3, max: 8 }),
  text: fc.string({ maxLength: 8 }),
  descending: fc.boolean(),
  acceptance: fc.constantFrom(
    `after-callbacks` as const,
    `before-next-callback` as const,
  ),
})
export type DeferredBaselineHistory =
  typeof deferredBaselineGrammar extends fc.Arbitrary<infer H> ? H : never

export function deferredBaselineRows(h: DeferredBaselineHistory) {
  const original: Array<LazyRow> = Array.from(
    { length: h.size },
    (_, rank) => ({ id: `row-${rank}`, rank, text: h.text }),
  )
  const added = { id: `added`, rank: h.size, text: `${h.text}:added` }
  const updated = { ...added, text: `${h.text}:updated` }
  const reinserted = { ...added, text: `${h.text}:reinserted` }
  const revisedOriginal = original.map((row, index) =>
    index === 0 ? { ...row, text: `${h.text}:restored` } : row,
  )
  return {
    original,
    revisions: [
      [...original, added],
      [...original, updated],
      original,
      [...original, reinserted],
      [...original.slice(1), reinserted],
      [...revisedOriginal, reinserted],
    ],
  }
}

/** Exact keyed values at a cut, independent of Collection iteration order. */
export function assertDeferredBaselineRows(
  actual: ReadonlyArray<LazyRow>,
  expected: ReadonlyArray<LazyRow>,
  h: DeferredBaselineHistory,
  checkpoint: string,
) {
  const observed = expectedLazyRows(actual, {}, h.descending)
  const owed = expectedLazyRows(expected, {}, h.descending)
  if (JSON.stringify(observed) !== JSON.stringify(owed))
    throw new Error(
      `lazy deferred ${checkpoint}: expected ${JSON.stringify(owed)}, got ${JSON.stringify(observed)}`,
    )
}

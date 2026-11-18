/**
 * Active native PowerSync demands support the union of their predicates. An
 * absent predicate supports every row, including when the demand has a limit.
 * Retiring one demand preserves rows supported by another and stops support
 * for rows supported only by the retired demand.
 *
 * Authority: docs/collections/powersync-collection.md, On-Demand Mode and
 * On-Demand Mode with Sync Streams. The adapter tracks predicate support, not
 * individual live-query window membership. This judgment observes source
 * Collection rows after real SQLite reads and change callbacks have consumed
 * provider work. It excludes transport, reload, persistence, pending hooks,
 * optimistic holds, predicate-changing updates and arbitrary predicate trees.
 * While a third demand retires and an unrestricted demand survives, every
 * source publication keeps the same complete rows. The union before and after
 * that retirement is identical. No SQLite write occurs during this window.
 */
import fc from 'fast-check'

export type UnionScope = `all` | `left` | `right`
export type UnionHistory = {
  order: `broad-first` | `broad-last` | `narrow-only`
  overlap: boolean
  pivot: number
  value: number
  limited: boolean
}
export type UnionRow = { id: string; rank: number; value: string }
export type UnionCut = {
  name: string
  active: Array<UnionScope>
  revision: number
  rows: Array<UnionRow>
}
export type UnionObservation = {
  cuts: Array<UnionCut>
  retirementPublications: Array<{ revision: number; rows: Array<UnionRow> }>
  reached: Array<UnionState>
  cleanupErrors?: ReadonlyArray<string>
  browserErrors?: ReadonlyArray<string>
}

// Acquisition order distinguishes joining an unrestricted owner from adding a
// filtered owner to one. Overlap distinguishes shared support from disjoint
// support. Values change at unchanged ids, so membership alone cannot pass.
// Unique scope names and release of acquired scopes exclude double acquisition
// and release-before-acquisition histories. Every narrow-only history leaves
// the last two rows outside the union, rejecting accidental full-source reads.
export const unionHistoryArb = fc.record({
  order: fc.constantFrom(
    `broad-first` as const,
    `broad-last` as const,
    `narrow-only` as const,
  ),
  overlap: fc.boolean(),
  pivot: fc.integer({ min: -4, max: 4 }),
  value: fc.integer({ min: 0, max: 100_000 }),
  limited: fc.boolean(),
})
export const unionStates = [
  `broad-first`,
  `broad-last`,
  `narrow-only-disjoint`,
  `narrow-only-overlap`,
  `third-retired-broad-remains`,
  `broad-retired-narrow-remains`,
  `changed-values`,
  `limited-broad`,
  `third-retirement-observed`,
] as const
export type UnionState = (typeof unionStates)[number]

export function unionRows(h: UnionHistory, revision: number): Array<UnionRow> {
  return [-1, 0, 1, 2, 10].map((offset, index) => ({
    id: `row-${index}`,
    rank: h.pivot + offset,
    value: `${h.value}:${revision}:${index}`,
  }))
}
// This is set membership over literal integers. It shares no expression IR,
// SQL compiler, trigger predicate, or active-demand classifier with production.
export function unionModel(
  h: UnionHistory,
  active: ReadonlyArray<UnionScope>,
  revision: number,
) {
  return unionRows(h, revision).filter((row) =>
    active.some(
      (scope) =>
        scope === `all` ||
        (scope === `left`
          ? row.rank <= h.pivot
          : row.rank === h.pivot + (h.overlap ? 0 : 1)),
    ),
  )
}
export function unionViolations(h: UnionHistory, a: UnionObservation) {
  const errors = [...(a.browserErrors ?? []), ...(a.cleanupErrors ?? [])]
  const expected = unionHistoryModel(h)
  if (a.cuts.length !== expected.length)
    errors.push(`provider-consumption cuts differ`)
  for (const [index, cut] of expected.entries()) {
    if (JSON.stringify(a.cuts[index]) !== JSON.stringify(cut))
      errors.push(`${cut.name}: predicate union rows differ`)
  }
  const retirement = expected.find(
    (cut) => cut.name === `retired right` && cut.active.includes(`all`),
  )
  for (const publication of a.retirementPublications) {
    // Broad support and provider rows stay constant throughout this cut.
    // Callback cardinality is free: unchanged public rows need no callback.
    if (
      !retirement ||
      publication.revision !== retirement.revision ||
      JSON.stringify(publication.rows) !== JSON.stringify(retirement.rows)
    )
      errors.push(`third retirement publication: predicate union rows differ`)
  }
  return errors
}

// The history fixes legal acquisition/retirement order. Recomputing every cut
// from that input also rejects missing cuts or a recorder with the wrong owners.
export function unionHistoryModel(h: UnionHistory): Array<UnionCut> {
  let active: Array<UnionScope> = []
  let revision = 0
  const cuts: Array<UnionCut> = []
  const record = (name: string) =>
    cuts.push({
      name,
      active: [...active],
      revision,
      rows: unionModel(h, active, revision),
    })
  const acquire = (scope: UnionScope) => {
    active.push(scope)
    record(`acquired ${scope}`)
  }
  const retire = (scope: UnionScope) => {
    active = active.filter((x) => x !== scope)
    record(`retired ${scope}`)
  }
  const update = () => {
    revision++
    record(`changed values ${revision}`)
  }
  if (h.order === `broad-first`) acquire(`all`)
  acquire(`left`)
  if (h.order === `broad-first`) update()
  acquire(`right`)
  if (h.order === `broad-last`) acquire(`all`)
  update()
  retire(`right`)
  update()
  if (h.order !== `narrow-only`) {
    retire(`all`)
    update()
  }
  return cuts
}

import type { LazyRow } from './lazy-paging-model-oracle'

/**
 * A coherent source observation belongs to one authored revision. After a newer
 * revision becomes public, an older revision cannot become public again.
 * Authority: the fixed-query coherent-snapshot premise in the approved Convex
 * lazy-paging design, and Collection's atomic sync transaction publication.
 *
 * Revisions are full authored relations, not provider pages. The receiver below
 * observes a fully acquired stable-key source, so each allowed relation is exact.
 * Retention choices for partially acquired sources and optimistic values are
 * outside this model. Old complete values may stutter, and intermediate offered
 * revisions may be skipped. Offering a revision permits it; it does not require
 * immediate visibility or prove that its facts have actually been delivered.
 * The separate source-provenance comparison supplies that latter obligation.
 * Sequence observations use the same monotone revision law for exact ordered
 * windows independently projected by expectedLazyRows. Relation observations
 * ignore Collection iteration order; sequence observations retain public order.
 */
export class LazyVersionModel {
  private readonly revisions: Array<string> = []
  private minimumRevision = 0

  constructor(
    private readonly observation: `relation` | `sequence` = `relation`,
  ) {}

  offer(rows: ReadonlyArray<LazyRow>): void {
    this.revisions.push(this.signature(rows))
  }

  observe(rows: ReadonlyArray<LazyRow>): void {
    const value = this.signature(rows)
    // If unchanged rows make two revisions observationally indistinguishable,
    // keep the earliest compatible one. This preserves every monotone history
    // that the public observations could represent, without guessing a version.
    const next = this.revisions.findIndex(
      (revision, index) => index >= this.minimumRevision && revision === value,
    )
    if (next < 0)
      throw new Error(
        `lazy version: mixed revision or public rollback ${value}`,
      )
    this.minimumRevision = next
  }

  private signature(rows: ReadonlyArray<LazyRow>): string {
    return JSON.stringify(
      (this.observation === `relation`
        ? [...rows].sort((a, b) => a.id.localeCompare(b.id))
        : [...rows]
      ).map(({ id, rank, text }) => [id, rank, text]),
    )
  }
}

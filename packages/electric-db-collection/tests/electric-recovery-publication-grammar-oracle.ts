// The persistence publication history grammar of the Electric recovery
// oracle. electric-recovery-oracle.test.ts runs its histories through
// production; electric-recovery-publication-grammar.test.ts checks its fixed
// sample's reach. This module registers no tests.
import { fc } from '@fast-check/vitest'

export type PublicationHistoryCommand = {
  id: number
  name: string
  deleted: boolean
  fullReload: boolean
  operation?: `insert` | `update`
  obsolete?: boolean
}

/**
 * One model command pairs two production boundaries: a committed peer
 * publication, then an Electric stream update. The row Map models complete
 * public values; the publication marker is only a reach witness, not model
 * state. No later command branches on that marker.
 *
 * The bounded grammar permits 1–8 pairs, keys 2–4 beside the untouched
 * baseline key 1, and names of length 0–8. Key variation distinguishes
 * independent rows from repeated edits; name and optional field variation
 * distinguish partial update from same-key insert replacement. Deletion
 * changes membership;
 * fullReload requires a persisted read. A targeted notice can also require
 * a read when its row is new to this Collection: the notice carries a
 * patch without a completeness certificate. Public rows, rather than the
 * number of reads, decide whether that route satisfies the law. Multiple
 * pairs expose repeated-key histories. The authored history below
 * reconstructs insert then delete with a reload. The other fixed histories
 * reach both sequence-length and name/key margins. The grammar excludes a
 * malformed peer transaction that lists one key as both changed and deleted;
 * the publisher constructs exactly one of those lists from `deleted`.
 * Arbitrary keys and longer histories remain outside this property.
 */
export const publicationHistoryArbitrary = fc.array(
  fc.record({
    id: fc.integer({ min: 2, max: 4 }),
    name: fc.string({ maxLength: 8 }),
    deleted: fc.boolean(),
    fullReload: fc.boolean(),
    operation: fc.constantFrom(`insert` as const, `update` as const),
    obsolete: fc.boolean(),
  }),
  { minLength: 1, maxLength: 8 },
)

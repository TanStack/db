// The structural page-end histories of refetch-ordered-prefix-oracle.test.ts.
// Each history names the page width and offset, the hold regime (a delete or
// an update of the boundary row, a delete of another row, or no hold), and
// whether the boundary moves earlier or later. The oracle builds each with
// `pageEndCase` and runs it through its shared driver and comparison. This
// module registers no tests; the grammar-size check is in
// refetch-ordered-prefix.test.ts.
export type PageEndStructuralHistory = {
  limit: 1 | 2 | 3
  offset: 0 | 1
  hold: `delete` | `update` | `other-delete` | `none`
  direction: `earlier` | `later`
}

export const pageEndStructuralHistories: Array<PageEndStructuralHistory> = (
  [1, 2, 3] as const
).flatMap((limit) =>
  ([0, 1] as const).flatMap((offset) =>
    ([`delete`, `update`, `other-delete`, `none`] as const).flatMap((hold) =>
      ([`earlier`, `later`] as const).map((direction) => ({
        limit,
        offset,
        hold,
        direction,
      })),
    ),
  ),
)

// A delete hold whose boundary moves earlier must report and repair its gap
// at every width and offset.
export const pageEndStructuralStates = [1, 2, 3].flatMap((limit) =>
  [0, 1].map((offset) => `delete-held gap width ${limit} offset ${offset}`),
)

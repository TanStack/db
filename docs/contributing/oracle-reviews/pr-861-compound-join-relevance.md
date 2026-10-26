# Historical assessment of the original compound-join implementation

This assessment applied to discarded merge `9838e88f78a8571f214874a587c6373318030b2f`,
combining original PR head `82d50c00e580aeeabd54756b9efe61ca750e53cd` with main
`4070864414f26212dcef20e2537057bff8e21535` on 2026-10-05.

That implementation failed special-value tuple equality and omitted additional
join conditions from query identity. Its implementation and example tests were
removed before the replacement. Its readiness verdict does not apply to the
current branch.

The [archived assessment](https://github.com/TanStack/db/blob/ee490df80d200f701df805faf81d8105ba492527/docs/contributing/oracle-reviews/pr-861-compound-join-relevance.md)
preserves the old diagnostics and revision-specific receipts. The
[replacement evidence](2026-10-05-compound-joins.md) describes the current design,
oracle owners, replay commands, and coverage limits.

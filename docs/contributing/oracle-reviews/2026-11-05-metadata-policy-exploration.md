# Metadata policy and latency exploration

The maintainer asked whether #2312's metadata guarantees justify their latency
cost, and requested weaker or alternate rules. This is a product-contract
exploration at `8feab6ea3eaae4456f738da39fa93508ddd5cc01` plus the existing
nested-row repair. At the time of these experiments no proposed law had been adopted. The experiments modify
copied sources, not the branch's production code or accepted oracles.

## Recommendation and rival rules

Prefer **protection at published Collection boundaries**. Actual Collection
rows expose computed `$key`, `$collectionId`, `$origin` and
`$hasPendingWrites`, with the existing source-attribution rules. Intermediate
projections and inline results expose the values the query authored. A direct
source row already comes from a Collection, so its genuine metadata remains.
Authored fields on intermediate projections are application data, and cannot
override the metadata of an eventual published Collection row.

This removes the promise that callbacks receive a different interpretation of
an intermediate value from the interpretation exported by an inline include.
It also removes intermediate structured-spread override normalization: an
explicit authored override remains data until publication. Publication still
uses the selected source's genuine metadata where the source-attribution law
requires it. Reading metadata before projection, or reading a published
Collection row, remains unambiguous.

For an intermediate projection `{ id: 1, $collectionId: 'application-value' }`:

| Policy | Downstream functional callback reads | Inline result retains | Published Collection root |
| --- | --- | --- | --- |
| Current accepted law | Field absent | `'application-value'` | Genuine computed metadata |
| Boundary-only protection, recommended | `'application-value'` | `'application-value'` | Genuine computed metadata |
| Uniform reservation at query row roots | Field absent | Field absent | Genuine computed metadata |

Uniform reservation is the other coherent single-representation policy. New
projected row roots lose reserved fields everywhere, including inline results.
Direct source rows and structured source-preserving selections retain genuine
source metadata. Nested application objects are unaffected. This gives up the
existing authored-inline-shape promise, and would require affected applications
to rename those fields. Boundary-only protection instead changes callbacks
that currently rely on reserved fields being absent or source-normalized after
an intermediate projection. Neither proposal is a compatibility-free patch.

Keeping the current law with a different representation remains possible in
principle. Carry private route state beside values, and produce callback views
at compiler-known projection paths only when a consumer needs them. Treat source
payloads as opaque. This design has not been implemented or timed here; it must
not duplicate user expression or getter evaluation. The current law does not
logically require recursively discovering private state in application data.

Dropping only the predicate extension is a weak alternative: `fn.select` and
`fn.where` would interpret the same input differently, and the remaining
callback/inline distinction would still require separate views. Rejecting
reserved projections outright would also reject useful inline application
data and would need runtime checks for arbitrary functional results.

## What the issue and PR history establish

1. [PR 2171](https://github.com/TanStack/db/pull/2171) describes reserved fields
   on **published Collection rows**, while inline values keep selected shape.
   The [migration guide](../../guides/migrate-to-1-0-rc.md#keep-virtual-field-names-for-row-metadata)
   states this boundary explicitly.
2. The October 28 O12 decision added removal of reserved fields from new
   projected subquery objects before downstream `fn.select`. A subsequent
   decision retained genuine metadata for structured whole-source spreads.
   The [decision record](2026-10-28-pr-2171-oracle-chunks.md#subsequent-authority-for-o12)
   is the authority, rather than an inference from implementation behavior.
3. The initial #2312 repair propagated existing normalization modes at two
   callsites. Unconditional propagation broke authored inline results. The
   [repair record](callback-metadata.md#repair-and-discriminators) preserves
   both failures and the narrower correction.
4. The October 30 decision extended the input rule to `fn.where` and
   `fn.having`, while retaining authored inline output. #2312 then carried a
   normalized view beside each authored row occurrence. See its
   [law and experiment record](callback-metadata.md#law-experiment-and-inference).
   This is an explicit extension of the promise.
5. A CodeRabbit review on October 30 at 20:39:51 UTC warned: “Avoid building
   callback-only views for ordinary root output.” It identified `finalizeRow`'s
   per-row transformation and stripping, but classified it as trivial. The
   [PR's existing benchmark comment](https://github.com/TanStack/db/pull/2312#issuecomment-6527837501)
   already reported 1.19× writes and 1.26× cold overall, using flat workloads.
6. [Issue 2355](https://github.com/TanStack/db/issues/2355) supplied the missing
   whole-document workload and identified repeated deep discovery. Its proposed
   preliminary scan still visits every nested object; it does not remove that
   scaling term.

The GitHub discussion contains no further substantive human product rationale
for the callback rule. The repository records explicit earlier maintainer
decisions; those decisions remain accepted until revised. Their practical
benefit is predictable metadata interpretation across callback placement. They
do not supply a security boundary against authored queries.

Pre-#2312 public probes reproduce placement dependence: a new projection's
reserved fields are absent at a root callback but present at a correlated
callback. Boundary-only protection would preserve authored fields in both.
It is a deliberate policy revision, not an exact restoration of all old behavior.
The PR also includes independent ordered-loading, replay and Solid repairs.
A metadata policy revision does not justify reverting those repairs.

## Experiments and limits

Three isolated source copies use the repaired current implementation, a
boundary-only prototype, and a uniform-reservation prototype. Both prototypes
replace the final callback view with the final authored value. Boundary-only
disables source normalization propagation; uniform reservation enables selected
normalization everywhere. These small flag experiments test the policy
distinction, not a finished implementation or a minimal shipped-code result.

Public probes exercise structured and functional projections, all four reserved
collisions, select/where/having callbacks, direct source returns, structured
spreads with and without overrides, functional spreads, published collision
protection, inline values and a correlated callback through a QueryRef.
Observed values match the three policy predictions. Checked published rows
retain genuine metadata. Documents retain reference identity and nested
application `$key` data through preload and 120 synced replacements.

At one child and 0/20/200 blocks, the batch-descriptor counter observes:

| Receiving path | Repaired current | Boundary-only | Uniform reservation |
| --- | --- | --- | --- |
| Ordinary structured document projection | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |
| QueryRef → fn.where → structured projection | 2 / 102 / 1002 | 0 / 0 / 0 | 0 / 0 / 0 |
| Correlated plain inline document | 6 / 306 / 3006 | 4 / 204 / 2004 | 4 / 204 / 2004 |
| Correlated QueryRef → fn.select → inline output | 12 / 612 / 6012 | 8 / 408 / 4008 | 8 / 408 / 4008 |

The predicate substitution path remains expensive in the current repair. The
existing payload grammar checks predicates on direct sources, so it does not
reach this QueryRef-plus-predicate composition. This is additional open work
under the broader latency objective. Correlated private-state cleanup remains
proportional to payload size under both prototypes. Weaker public metadata laws
alone do not eliminate it.

The counter measures `Object.getOwnPropertyDescriptors` on known payload
containers. It does not detect every traversal. In particular, the pre-#2312
walker uses singular `Object.getOwnPropertyDescriptor`; its batch count of zero
cannot establish zero traversal. No baseline work-count comparison is claimed.

Separate elapsed runs use 10 children with 200-block documents, three fresh
fixtures, 20 warmup writes and 100 timed synced replacements. All variants run
sequentially with instrumentation disabled, using the same current db-ivm and
dependencies on Node 24.19.0 / Apple M5 Max. Numbers are medians across fixtures:

| Receiving path and measurement | Pre-2312 DB sources | Repaired current | Boundary-only | Uniform reservation |
| --- | ---: | ---: | ---: | ---: |
| QueryRef + predicate, cold ms | 0.386 | 6.853 | 0.350 | 0.356 |
| QueryRef + predicate, median write ms | 0.0409 | 1.1112 | 0.0356 | 0.0339 |
| Correlated inline, cold ms | 6.704 | 19.221 | 22.095 | 22.733 |
| Correlated inline, median write ms | 3.3529 | 8.4695 | 7.4231 | 7.4503 |

The [measurement table](../../../scripts/bench/metadata-policy-exploration-2026-11-05.csv)
also retains zero-block runs and every repetition. Neither single-view prototype
restores the correlated case to its prior latency. Its smaller scan count is
not proof of smaller elapsed cold time. Small flat timings also cannot prove
zero fixed overhead. These are public-API experiments, not a standalone copy
microbenchmark or a reconstruction of every historical dependency.

Scratch sources, the executable probe, independent predictions, raw JSON,
source hashes and append-only history ledger are retained in
`/tmp/db-metadata-law-exploration-2026-11-05`. An earlier 100-child timing series
overlapped late control probes and is excluded from this controlled table.
An initial correlated fixture failed admission and is setup evidence only.

## Decision and remaining implementation work

Choose the metadata policy before changing semantic expectations. The
recommendation is boundary-only protection, with genuine published attribution
retained. Uniform reservation and the current dual interpretation are its
concrete rivals. No semantic oracle has been weakened for these experiments.

After a decision, extend the metadata-input and publication owners across their
Collection, inline and Effect receivers before changing production. Reach both
authored and source-owned collisions through QueryRef, join and union placement,
including shared-cache reuse, held mutations, settlement and later source use.
The revised contract must fail current production where its promised outputs
change, then pass the implementation and reject the old-policy mutant.

Independently, extend the work owner to reach the predicate composition and
correlated paths above, and replace payload discovery with compiler-known
transport or construction. Require zero metadata work that grows with ordinary
source payload size at the named checkpoints. The instrument must catch both
singular and batch descriptor discovery, alongside elapsed benchmarks; a new
unobserved scan must not earn a false GREEN. Preserve descriptors, getters,
cycles, symbols, opaque values, reference equality and existing route laws.

The original repair and CI gate remain locally implemented and uncommitted.
This exploration establishes the policy differences and a remaining performance
gap. It does not establish universal zero latency impact, closure of the broader
performance objective, or whole-PR readiness.


## Subsequent maintainer decision

On 2026-11-05 the maintainer selected **boundary-only protection**: intermediate
callbacks and inline results keep authored fields; actual published Collection
rows retain genuine computed metadata. That decision supersedes the October
28/30 callback-normalization rules. The prototype measurements above remain
historical. The [implementation record](2026-11-05-boundary-only-metadata.md)
records the revised oracle, pre-production RED gates, implementation,
verification and new measurements.

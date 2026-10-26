# Temporal persistence grammar v2 — implementation contract

This replaces the open choices of v1 for the implementation requested by the
user. Source: e21c280f3; user decisions: native reconstruction is required,
existing persisted data may be replaced, and the existing SQL/residual pipeline
is the integration point. V1 and its hostile readings remain historical evidence.

## Frozen model

M1 Value: support Instant and PlainDate, the two reported kinds. Resolve their
constructors from globalThis.Temporal, as the offline serializer does. Require
them on encode and decode; prototype toString performs the brand check. Reject
other genuine Temporal kinds explicitly. Do not silently stringify or flatten
them. Preserve existing Date/BigInt/scalar behavior. No pluggable codec API.

M2 Carrier: rows, nested records/arrays, row/collection metadata, replay and
tombstones use the same native encoding. Wrapper index specifications use that
encoding too. Plain records containing the reserved marker are escaped on new
writes, so decoding cannot promote them to native values.

M3 Representation: each native tag stores canonical text and a sortable key.
Instant uses an offset, zero-padded decimal epoch-nanosecond integer; PlainDate
uses its ISO-calendar year/month/day with an offset, padded year. Neither uses
floating point or Date conversion. Canonical kind/text is equality identity;
the sortable key is ordering identity. PlainDates with different calendar IDs
can have the same order but different equality identity.

M4 SQL: extend the shared runtime/index reference expression to select native
sort keys. Temporal literals use the same sort key. Equality and IN add a
kind/text identity check when required, retaining the indexed key restriction.
Coalesce propagates both representations. Boolean composition operates on exact
predicates in this declared domain, including NOT; preserve the existing
unsupported-expression and binding-cap fallbacks. Runtime and persisted index
SQL must remain syntactically aligned. The existing residual evaluator and local
sort remain authoritative, with native Temporal comparison in local sort and
pagination after cleanup. No new query execution pipeline.

M5 Query domain: native scalar refs/literals, nested refs, coalesce, equality,
IN, same-kind ordered comparisons, Boolean composition, ordered windows and
cursor predicates. Ordered operands must have compatible declared types;
cross-kind native ordering is invalid, not an invented total order. Native
calendar annotations and nanosecond precision remain observable. Arbitrary
Temporal arithmetic/date extraction, other native kinds and custom classes are
not introduced by this repair.

M6 Histories: extend current owner grammars with native values. Preserve action
order, validation of superseded actions, full durable rollback, replay positions,
wrapper receipts/FIFO and existing publication-before-durability. Immutable
Temporal values may be retained by the model; observations must compare native
kind and text instead of relying on structuredClone or empty-object equality.

M7 Boundaries: direct shared core and wrapper index serialization are included.
Existing coordinator wire contracts remain narrower: reject invalid wire input
before remote-demand retry admission; do not transport native instances through
structuredClone. Native host/multiprocess receiving support is not claimed.

M8 Upgrade: new readers retain existing supported encodings and rebuild changed
index SQL through the existing path. Already-corrupted empty objects remain
plain data; an application can replace the cache using the existing schema
version/reset options. No automatic reset or irreversible data action is needed
to implement this additive repair. Downgrade readers are not promised support
for the new format. New accepted data still has the M1/M2 preservation contract.

Case := value family × carrier × operation × existing legal history × boundary.
The active overlaps are storage/equality/order, runtime/index literals,
serialization/action folding, and public admission/transport. These dimensions
are model annotations, not proposed production classes or lifecycle states.

## Evidence and executable owners

E1 sqlite-temporal-value-oracle: file reopen, nested values, metadata, replay,
boundaries in precision/year/calendar, marker escaping and constructor failure.
E2 expression-index-oracle: raw SQL keys before cleanup, native equality/order,
IN/NOT/coalesce, and actual index use. Add a wrapper-produced specification path.
E3 ordinary-transaction-work-oracle: independent native kind/text observations
for repeated actions, rollback and invalid superseded native values; keep work
bounds and current models.
E4 persisted-oracle: preserve existing receipt/FIFO laws and reject permanent
wire admission failures before they enter retry. Reuse its current owner paths.

## Selected transformations and overlaps

| Form | Route and fixed boundary | Dependency change and cost | Limit |
| --- | --- | --- | --- |
| F1 native storage | Substitute the shared codec; preserve adapter row/metadata/replay APIs (M1–M3). | Registered constructors become a runtime dependency; immutable values gain canonical text and order keys. | Other kinds reject; no erased-value recovery. |
| F2 native indexed queries | Augment shared runtime/index expressions (M3–M5). | Equality identity accompanies ordering; IN retains correlated pairs; residual cleanup stays in place. | Same-kind ordering only; no arbitrary native arithmetic. |
| F3 explicit wire boundary | Exclude native literals at existing remote-demand admission (M7). | Validate before dispatch; preserve transient retries for admissible values. | This is a transport limit, not general native transport support. |

The user selected F1 and F2 together and accepted the stated F3 receiving limit
in the implementation plan. These are adjacent transformation paths from the
same existing subsystem, not competing performance/correctness products.
Storage and queries overlap at representation; queries and index metadata
overlap at native literals; action folding and serialization overlap at
validation; public demand and transport overlap at admission. Splitting these
into independent codecs or models would lose those obligations.

The case dimensions are finite test annotations. Dynamics are value encoding,
query compilation and existing action histories; constraints are M1–M8; boundary
conditions are the two supported kinds, one registered constructor provider,
real Node SQLite and the declared shared-core/local-wrapper routes.

## Post-freeze implementation discoveries — 2026-10-05

D1 (M2/E2): Collection.getIndexMetadata was an additional receiving entrance.
Its JSON clone erased native literals and its signature collapsed them to empty
records. Copy expression structure while retaining immutable values, and include
kind/text in the signature. Six wrapper witnesses failed before this repair.

D2 (M2/M4/E1): IN must match correlated (order, identity) pairs. Two ordinary
string literals must not combine to impersonate one native value under NOT IN.
Escape only an ordinary record's marker field so its other nested JSON paths
remain queryable. Both distinctions have pre-fix public-result failures.

D3 (M7/E4): a leader without a local subset owner can become a follower while
hydration waits. Validate at entry for an already-remote request, and after
hydration inside the existing admission cleanup boundary for a newly remote
request. Remove the redundant hydration-time ensure path; dispatch owns the
remote request. String controls dispatch exactly once; unsupported native input
never reaches dispatch or retry. No new lifecycle or retry state is added.

D4 (M4/E2): SQLite forbids membership subqueries in index definitions. Runtime
IN uses paired membership; index expressions use equivalent balanced OR clauses.
Balancing preserves large membership definitions without exceeding expression
depth. Two and 1,025-value string-index witnesses check final keys, raw SQL and
named-index use. This preserves an existing scalar index route affected by F2.

These addenda refine the receiving paths and SQL forms. They do not replace the
frozen native-value law or revise existing publication/durability contracts.

See [evidence](v2-evidence.md) for executed controls and remaining owner gaps,
and [process](v2-process.md) for reconstruction and projection provenance.

## Current-main integration and review repairs — 2026-10-05

The branch now includes main cfb03f201, including the safe candidate contract
from #1997. M4's exact native examples retain their raw-key/index checks.
Classification admits native raw-ref equality, native membership, same-kind
ranges and raw-ref NOT leaves. Range candidates retain SQL NULL projections
because core NaN orders above native values. NOT uses the original leaf, never
an approximate candidate. Mixed native/scalar field pairs fall back outside the
native pair. Positive native coalesce equality remains selective; NOT/coalesce
and unsupported Boolean shapes keep residual filtering. NaN is not nullish in
the core evaluator, so SQL coalesce cannot certify negation for that domain.

D4's scalar membership DDL law still holds. Its original exact raw-key and plan
claim preceded #1997: eq(in(ref, strings), true) now deliberately reads a candidate
superset. The two and 1,025-value witnesses retain successful DDL and exact final
keys, with full candidate reads as the current contract. Native plan assertions
remain unchanged.

M7 also covers an ownerless leader that completes local loading before it becomes
a follower. Sequence-gap recovery validates retained demand at the existing
remote queue admission. Invalid native input reaches the existing terminal
error path without a coordinator call; a valid string dispatches once. Transient
transport retry keeps its prior law. No second lifecycle or transport codec is added.

M8 does not claim lossless migration for old ordinary objects whose reserved
marker now names a recognized encoding. A receiving old-writer/new-reader probe
confirms that ambiguity. The user permits replacing old data; the guide now
states the rebuild requirement. New accepted records retain M2 preservation.

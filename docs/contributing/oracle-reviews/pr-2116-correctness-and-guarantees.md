# PR #2116: correctness review and guarantee cost

Reviewed executable commit: `4ed5242dbef0e7dbf87b31ca97c2fd2bc7901cad`.
Merge base: `b112d888f0c1f1ef4245ae48e8b071e8fad916b0`. This documentation
follows the reviewed code in a separate commit. The external review has 28
source-order items; R29 is a sibling found while challenging the repaired
Temporal law. The task-local loss ledger retains each raw item and its evidence.

## Laws, experiments, and limits

| Item and authority | Independent judgment and reached checkpoint | Decisive failure and repaired evidence | Boundary |
| --- | --- | --- | --- |
| R16: a valid row admitted by a Collection cannot remain stored while its index and subscribers omit it. Existing Collection publication and changelog #1519 also require public `orderBy` to reject unsupported Temporal order. | Supplied genuine Duration-with-months, PlainMonthDay, and mixed-kind rows determine membership. BasicIndex/BTreeIndex add, reverse add, and build compare complete exact and ordered key sets. Two sequential sync commits compare the row, exact index membership, and callback batch; public limit-one `orderBy` must throw. | On the earlier code, the second commit threw and left two stored rows with one indexed/published row in six index/value combinations. A selected pre-repair oracle run had eight failed cases, including unexpected index-order throws. Restoring the public comparator at this head recreated partial publication for both index types; advertising private order as public returned a row instead of throwing. The final 12 focused admission checks pass. | One polyfill; three unsupported-order fixture classes; finite histories. No malformed Temporal promise, arbitrary callback, provider cursor, or long live-query history. |
| R17: after a returned direct index action, exact and ordered reads describe the same current keys. The index API and prior behavior authorize equal-time Date removal; a different callback position for a substituted old item has weaker authority. | A source Map retains each key's supplied timestamp or callback position. After add, remove, update, build, and re-add, both indexes are checked through key count, exact lookup, ordered take, and bounded range reads. | The old BTree cache left a detached ordered bucket after equal-distinct removal and object reuse. A nearby wrong-position removal left a ghost ordered key in both index types while exact lookup/count looked correct. The new history rejects both at take/range checkpoints. All 444 owner tests pass; 100-seed mixed-action probes per index found no mismatch. | Valid Dates, stable callbacks, unique-key add, direct index path. Arbitrary objects/comparators and Collection publication are outside this claim. |
| R25: native Dates with the same time are deep-equal across ordinary realms; a changed time must publish a Collection update so a subscriber mirrors the stored row. The live-query guide and Collection mirror law supply authority. | Supplied valid or invalid times and local or Node-vm constructors determine expected equality. The direct Date owner crosses realm and time margins; a ready unindexed sync Collection receiver compares exact batches, callback row, mirror, and settled row. | The old local `instanceof Date` branch missed changed foreign Dates and rejected equal mixed-realm Dates. Local-only and changed-time-ignored wrong answers fail direct checks; original public event traces failed before the repair. The final direct/receiving owners are included in the 552-test combined run below. | Ordinary native Dates in Node realms; seven fixed public sync cases. User-modified Date display tags have only fixed diagnostics, not a broad grammar. Indexed/optimistic publication and other hosts remain outside this witness. |
| R29: Duration query equality preserves its ten fields, even when two representations have the same display. Changelog #1519 states this for `PT60M` and `PT1H`; changed fields must publish enough for the Collection mirror. | Supplied ten-field vectors, both signs, opposite signs, eight fixed-factor unit carries, and three subsecond display collisions predict direct equality without production normalization. Fixed and generated direct properties compare `deepEquals`. Nine ready unindexed sync replacement histories compare subscriber batches, callback row, mirror, and settled row. | Display-only equality missed both directions of seconds-to-milliseconds changes. Before repair, five targeted cases failed. After adding negative controls, a display-only mutant failed seven targeted cases. An absolute-field mutant failed the opposite-sign check; a balancing mutant failed direct hour/minute and public change-message checks. Both owners pass 552 tests; saved replays #41 and #42 pass. | Direct magnitudes 0–3, display-collision magnitudes 1–100, one polyfill; representative public replacement histories. Arbitrary ten-field Collection histories, indexed/optimistic publication, and mixed Temporal implementations remain open. |

The R25/R29 combined owner run has 552 tests. Six related owners pass 783 tests,
with no test type errors. A separate exact-head sweep compared 12,720 valid
Temporal pairs across all eight kinds with native equality or supplied Duration
fields and found no mismatch. This finite sweep does not extend the histories
or public paths above. The full DB suite passes 13,365 tests in 284 files;
DB-IVM passes 702 in 46 files; built-package tests pass 291 in five files.
Source and test TypeScript checks, ESLint with no errors, Prettier, and both
package builds pass at this code commit.

## ORC-001 through ORC-014

| Requirement | Outcome at the reviewed code commit |
| --- | --- |
| ORC-001 contract | The opening law comments identify Collection publication, index refinement, native Date time, and #1519 Duration/Temporal behavior. R17's different-position substituted old item lacks explicit API authority and is cataloged below rather than credited to the general law. |
| ORC-002 independent judgment | Supplied rows, epochs, callback positions, times, and Duration field vectors determine expected results. No oracle imports the production comparator, normalizer, index cache, or `deepEquals` for its expected answer. |
| ORC-003 literate responsibilities | Each changed owner states law and limits before mechanics, then places the model, finite or generated grammar, real driver, public observation, and comparison beside their code. |
| ORC-004 grammar controls | R16 and the new R17 Date lanes are fixed finite histories. R25's generated pair crosses local/foreign placement and valid/invalid time; R29 crosses ten fields, two signs, equal/changed vectors, and three display-collision unit pairs. Each axis has a fixed reconstruction or mutant control. Mixed-sign Duration input is invalid and excluded. |
| ORC-005 public observation | Real indexes and Collections are driven. R16 checks callback-time membership and public rejection; R17 checks exact plus ordered methods after every direct action; R25/R29 check direct equality and exact Collection batches, callback row, mirror, and settled row. Complete keys expose duplicates and omissions. |
| ORC-006 calibration | The original R16, R17, R25, and R29 paths failed at their named checks. R16's unexpected legal-operation throw was itself the public violation; the ordered-read and equality faults reached assertion mismatches. Public-comparator, stale-cache, local-only Date, display-only Duration, absolute-field, and balancing wrong designs are rejected at their intended checkpoints. None was a timeout or setup error. |
| ORC-007 replay | Fixed lanes do not trigger generated replay. Existing R17 numeric properties keep their campaigns. The new R25/R29 utility properties run fixed and random campaigns with the existing direct seed/path replay interface; selectors #40–#42 preserve older #1–#39 registrations. Replays #41 and #42 passed at seed 20260911 and empty path. |
| ORC-008 model state | R17's source Map retains each key's epoch or callback position because a later legal removal or ordered read distinguishes owners with the same key count. The other new judgments recompute from supplied immutable facts. |
| ORC-009 vocabulary | Exact equality key, stored order operand, source row, change batch, and public ordered read retain their glossary/architecture meanings. The private Temporal index order is explicitly separate from public `orderBy`. |
| ORC-010 failure fidelity | The fixed direct checks have no shrinking or external cleanup. Collection receivers use the existing cleanup harness; reported RED cases reached their intended assertions before cleanup. Saved replay selectors preserve the generated target. |
| ORC-011 second formulation | R16 crosses direct index membership with public Collection publication/rejection. R25/R29 cross direct value equality with public subscriber mirrors. R17 crosses exact lookup with ordered reads that the old code separated. No real-provider formulation is claimed. |
| ORC-012 review evidence | This record binds the outcome, controls, and limits to commit `4ed5242dbef0e7dbf87b31ca97c2fd2bc7901cad`. Four hostile reviewers rechecked the committed R16, R17, R25/narrowed Temporal, and R29 owners; none found a blocker in the stated cells. |
| ORC-013 neighboring witness | R16 separates private index order from public rejection; R17 separates same-position from different-position old items and exact from ordered keys; R25 separates equal mixed-realm from changed-time Dates; R29 separates same display, opposite sign, and adjacent-unit carry from exact field equality. |
| ORC-014 provider handoff | These claims stop at direct indexes or controlled ready in-memory sync Collections. No external-provider or browser-host handoff is inferred. R21's broader IANA alias claim needs a real supported host witness before it can become a contract finding. |

## Production weight and guarantees to decide

Against the merge base, production TypeScript is **+876 net lines**. The
architecture document is **+56 net lines**, counted separately. A minified
build of every ESM module is **+4,647 gzip bytes** in aggregate
(205,407 to 210,054). A minified browser bundle of the public DB entry is
**+2,856 gzip bytes** (111,875 to 114,731) under the same esbuild command
at both revisions. These are two different footprint views, not additive
costs or a prediction for every consumer. The external review's +974-line
figure mixed production code and architecture prose at an earlier head.

| Guarantee or work cost | Authority and value | Decision surface |
| --- | --- | --- |
| A captured mutable `inArray` reads current members and refreshes the whole retained query on the next source event. | The maintainer explicitly chose both rules. The receiving oracles cover WHERE, joins, selections, groups, aggregates, HAVING, order, nested queries, and selected on-demand/include paths. | Largest cost: the review estimated about 427 source lines. Full-source acquisition disables index/subset pushdown, keyed lazy demand, and pooled fast paths for this query shape. Changing this requires a contract decision; freezing a list already restores the optimizations. |
| A custom index callback orders **each stored row**, even when query equality groups two values together. | The maintainer explicitly chose this. | Both indexes retain per-row order operands and may sort/refresh more rows. Callback arguments now expose raw Date/Uint8Array values instead of the former timestamp/encoded-byte representation. That compatibility change follows the per-row rule and should be called out in release notes. |
| Default native-byte order is unsigned lexicographic order. | This PR proposes the policy; no separate maintainer decision was recorded. | It requires scan/index agreement and comparator machinery. Keep or remove as a product decision, rather than treating the old encoded-string order as authoritative. |
| Cross-realm native Dates and byte views, plus Date subclasses with overridden coercion, use intrinsic times or bytes. | The branch adds public and direct witnesses; ordinary local Dates and bytes already have value semantics. The wider host/subclass scope has no separate maintainer decision. | Removing this scope would revise several oracle laws and could let valid foreign values change a stored row without publishing it. Keep the R25 mirror repair as long as this scope is promised. |
| Mixed-kind default index order stays total, while public Temporal `orderBy` still rejects kinds without an order. | Valid mixed rows must be admitted without partially updating a Collection; the specific rank between unlike ordinary kinds is a policy chosen by this branch. | The kind separation and private Temporal order add comparator code. A narrower accepted input domain or another internal order would need an explicit contract change and the R16 atomic-publication witness. |
| A direct index removal accepts an equal-time but different old Date whose custom callback position differs from the stored Date. | The general refinement law supports normal remove/re-add, but the index API does not document this substitution. | Added per-key stored-order state supports it. This is a candidate to narrow if the direct API may require the actual prior value. |
| A fresh, equal-field Duration replacement emits no update message. | Consistent with existing change-event suppression; the mirror law requires changed-field publication, not this silence. | The public R29 receiver asserts silence. It can be relaxed independently of exact field equality and changed-field publication. |
| User-modified Date display tags, byte-view length properties, and an array's own `some` method cannot redefine intrinsic value or `inArray` membership. | These are valid JavaScript objects but user-modified built-ins, with weaker product authority than ordinary Dates, byte views, and arrays. | Their checks and helpers add complexity. Treat them as separate compatibility decisions. Deliberately malformed, borrowed, forged, and shadowed Temporal values were removed from the claimed domain. |
| Repeated Temporal key/display work, per-row BasicIndex build sorting, and equal-row index refresh. | Deterministic work probes observed these costs; no work budget was promised. | Optimize only if a bounded workload justifies it. The old claim that *every* Temporal comparison calls `toString` is stale after the valid-value narrowing. |

R21 is not closed as a Firefox defect. A mocked time-zone formatter preserving
aliases exposed sensitivity, but current ECMA-402 canonicalizes zone names
and no conforming real-host failure was found. The speculative alias scan
repair was removed. Reopen on a supported engine/version where two native-equal
zones produce different resolved names and a public scan or indexed equality
misses.

## Integration after merging main

Merge commit `f42e816d9c0442448624ab418074fd5008ee14c7` combines the reviewed
repair with `origin/main` at `bbbf017ef5b3884515295a4225faacdfd814499e`.
Main added replay retirement and bounded ordered-window behavior. The only
textual conflict was this architecture document; its resolution keeps both the
captured-list full-source rule and main's finite-window rule. No R16, R17, R25,
or R29 oracle expectation was changed during the merge.

The combined tree passes 13,381 DB source tests, 705 DB-IVM tests, and 291 DB
dist tests. The packed IndexedDB package check passes 19 tests. Five focused
Temporal/index/equality/publication/replay owners pass 874 tests, with no test
type errors. DB source and test TypeScript checks and both package builds pass.
The focused integration review found no new mismatch in ordinary ready sync
publication. Date or Duration replacement during truncate replay is not a
separately generated cross-product; replay histories use numeric rows and the
replay path calls the repaired equality function. This is a receiving limit,
not evidence of a known failing legal history.

Against this newer `origin/main`, production TypeScript is **+878 net lines**
(1,388 added, 510 removed); architecture prose is **+56 net lines** separately.
Minified ESM modules total 206,777 to 211,426 gzip bytes for DB (**+4,649**)
and 24,350 to 24,369 for DB-IVM (**+19**). A minified browser bundle of the
public DB source entry is 112,595 to 115,464 gzip bytes (**+2,869**) under
the same esbuild command at both revisions. The main bundle was reproduced
byte for byte before comparing. These views overlap and must not be added.

The guarantee choices in the table above still apply. The two largest behavior
costs, live captured arrays with whole-result refresh and per-row custom
callback order, are explicit maintainer decisions. Unsigned default byte order,
cross-realm/subclass scope, mixed-kind default order, different-position
old-Date removal, silence for equal-field Duration copies, and intrinsic
semantics for user-modified built-ins remain separate product choices. No size
reduction is credited for dropping them without a same-path oracle and a
measured implementation change.

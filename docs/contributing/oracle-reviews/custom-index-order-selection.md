# Custom comparator index selection

An index with a user-supplied `compareFn` cannot advertise the ordinary
Collection `orderBy` comparator merely through `compareOptions`. The
live-query architecture's Identity contract requires advertised comparison
options to describe the comparator the index executes. Exact equality lookup
remains a separate index operation.

The new oracle supplies three numeric rows in source order 20, 30, 10. Its
independent model sorts their supplied ranks numerically, so an ascending
`limit: 1` read must return rank 10. It compares unindexed and indexed public
Collection snapshots after readiness for both BasicIndex and BTreeIndex. A
custom callback orders ranks descending, and an ordinary index is a control.
The driver also checks descending reads, `optimizedOnly` refusal of a custom
index for ordinary order, and optimized exact `eq` on that same custom index.

At frozen head `1265abeb5`, both custom index types claimed default ascending
eligibility and returned rank 30. The new oracle failed twice at the public
first-key comparison, with no type errors. The repair makes public ordered
selection respect the existing `supportsRangeOptimization` capability, which
is false for custom comparators. This leaves exact lookup available and does
not change the custom callback's direct index behavior. The focused 460-test
index/query campaign passed with no type errors after repair.

The oracle covers a ready in-memory Collection, one numeric field, one order
term, limit one, and two built-in index types. It does not establish arbitrary
custom comparator laws, mutation histories, live-query publication, or
provider ordering.

## Oracle guide audit

| Requirement | Evidence and limit |
| --- | --- |
| ORC-001 | The architecture's index metadata law and public ordered-read contract authorize the numeric first-key observation. |
| ORC-002 | Supplied ranks determine expected order without reading the index comparator or its metadata. |
| ORC-003 | The oracle explains law, fixture, production paths, snapshot, and comparison beside its code. |
| ORC-004 | Fixed three-row source order distinguishes insertion order from ascending and descending rank; no generated-history claim is made. |
| ORC-005 | Both public Collection snapshot paths are observed after readiness; optimized-only reads check planner admission. |
| ORC-006 | The original wrong planner fails at both public first-key assertions; an ordinary index and exact lookup are adjacent controls. |
| ORC-007 | Not triggered: this owner is a bounded fixed witness. |
| ORC-008 | Not triggered: the model has no mutable state. |
| ORC-009 | Ranks are model facts; `supportsRangeOptimization` is production capability observed separately from expected row order. |
| ORC-010 | `withOracleCleanup` releases each Collection while preserving the primary assertion. |
| ORC-011 | The unindexed scan and numeric model check the indexed result through different formulations; both production paths still share the Collection API. |
| ORC-012 | This record names RED/GREEN evidence, owner, limits, and pending exact-commit review. |
| ORC-013 | A reverse-number callback makes the wrong index choice visibly return rank 30 instead of rank 10. |
| ORC-014 | Controlled in-memory sync ends at the ready snapshot; no provider handoff is claimed. |

## Exact-commit hostile review and follow-up

At `c4c07da42`, a fresh reviewer reproduced a planner failure with two
indexes on the same field: when the custom index was created first and a
compatible ordinary index second, `optimizedOnly` ordered reads still
returned no result. The original oracle put the indexes in separate
Collections, so first-match selection was never challenged. An eager
Collection also treated the custom index as sufficient and created no
compatible ordinary index. Numeric range predicates had the same first-match
problem. The reviewer reproduced both index types and both read directions.

The extended fixture now puts both indexes in one Collection and checks
ascending and descending public first rows. It also starts with a custom
index under eager mode, requires one compatible index to be created, and
checks a repeated read does not create another. Optimized exact `eq` still
uses the first custom index, verified through its lookup spy. The fixture
also checks optimized single and compound numeric ranges and an eager range
subscriber. Four ordered-selection cases failed before that repair at the
missing first row. Four more cases failed before the range repair: both index
types returned no optimized `gt` result, and both eager subscriptions failed
to create a compatible index. The compound assertion followed the single
range assertion in one test, so no separate pre-fix compound failure was
observed. Selection and eager admission now skip a custom index only when
ordered traversal is required. The new oracle passed 8 cases, and the
six-file related campaign passed 145 tests with no type errors. Lint and
diff checks passed.

Fresh review of the final committed head remains pending.

At `5df06de2e`, another reviewer found that eager admission recognized
`gt(rank, 10)` but not its equivalent value-left form `lt(10, rank)` after a
custom index. Initial subscription rows were correct, but the value-left
history failed its optimized-only snapshot because no compatible index was
created. The author added single and paired value-left RED witnesses for
BasicIndex and BTreeIndex before extending eager expression extraction to
identify the field on either side. The repaired tests compare initial rows,
optimized rows, and index count against independent numeric row filters. A
custom-only optimized range refusal is an adjacent control. The focused
oracle passed eight tests and the neighboring index campaign passed 547.
This establishes neither arbitrary value domains nor mutation histories.
The live-query compiler has a separate index-admission path; simple public
probes were correct, but the comparable coexisting-index schedule remains
unproved there.

## Live-query receiving path after `ae0b67fd2`

A fresh hostile review found a public counterexample to the compiler's ordered
index admission. An on-demand source had rank-20 and rank-40 rows cached.
It held four authoritative rows at ranks 10, 20, 30, and 40. With a reverse
custom index declared before an ordinary index, an ascending live query
preloaded its first row correctly. Moving to offset one and limit two then
published ranks 30 and 40, instead of 20 and 30. The provider fulfilled its
exact ordered request for ranks 10, 20, and 30. It did not rewrite cached
rank 20, which the wrong local index traversal had failed to send into the
graph. Ordinary-first, ordinary-only, and no-index controls returned the
correct rows. The reviewer reproduced both index types and found 16 public
mismatches in a separate 64-scenario cache/window sweep.

The new [window oracle](https://github.com/TanStack/db/blob/main/packages/db/tests/query/custom-index-window-selection-oracle.test.ts)
assigns numeric ranks in its source model and sorts and slices those four
facts independently of index selection. Its controlled adapter evaluates
each request's predicate and cursor against the source facts, records the
selected provider rows, and writes only uncached rows. It checks the live
query's rows after preload and after `setWindow()` settles, plus the sole
publication batch. A reply `[1,2,3]` with writes `[1,3]` proves that row 2
was already cached and still belonged to the requested result. The fixed
history crosses custom-first, ordinary-first, no-index, and eager-custom-only
layouts with BasicIndex and BTreeIndex. On the original compiler, four cases
failed at the moved public window: `[3,4]` instead of `[2,3]`. Controls
passed. All eight cases passed after the repair; 677 related tests and the
explicit test TypeScript check passed.

The compiler now requires an ordinary ordered-traversal index when it creates
or selects the first order term's source index. Eager creation lets BaseIndex
derive the comparator from `compareOptions`; passing an explicit `compareFn`
would mark that index custom and make it ineligible. This changes only source
index admission. Direct custom callbacks still order each row according to
the maintainer's decision. The production edit removes two net lines.

The oracle states the ordered window law and its source limits beside its
model, request grammar, driver, and two public cuts (ORC-001–005). The
original compiler fails at the promised post-window comparison, while
ordinary-first and no-index controls reach the same public boundary
(ORC-006, -011, -013). This is a fixed finite matrix, so generated replay
does not apply (ORC-004, -007). The provider is controlled and awaits applied
receipts; the claim does not extend to remote hosts (ORC-014). Ties, nullish
or nonnumeric orders, mutations, replay, multiple order terms, arbitrary
callbacks, and other window schedules remain open. Fresh hostile review of
the final committed oracle is pending.

At committed head `be5b7a3c4`, a fresh hostile reviewer found no additional
numeric window mismatch in 128 controlled cache/layout scenarios. A read-only
wrong-index admission fault changed the settled public rows, confirming the
comparison rejects that error. The reviewer found that readiness and live
query construction happened before cleanup protection; the driver now enters
`withOracleCleanup` before those steps and releases any handles created before
a setup failure. The `eager-custom-only` layout means eager *auto-indexing on
an on-demand source*. The eight-case oracle proves the public result and the
provider's cached-row interaction. It does not measure ordinary-index use or
an eager source path. The architecture's index work law needs a separate
index-use witness before this owner claims that property.

## Frozen-head review and mixed Date/number order

Review of `210651d207eefe9bbc025c780f6259e470225c9e` found three
source-inspection gaps in the ordered-selection oracle. Correct public rows
alone did not prove the later ordinary index supplied the ordered and range
reads. Inclusive value-left `gte`/`lte` boundaries were absent. Some
Collection construction still preceded cleanup protection. The working-tree
oracle now spies on the ordinary index's take, lookup, and range methods;
checks lower, upper, and paired inclusive value-left predicates against
independent row filters; and registers each Collection inside protected
construction. These gaps did not demonstrate an additional production bug.

An adjacent public witness did expose a production order mismatch for one
Date/number fixture. Before the repair, the unindexed ordered snapshot was
`[equal-number, number, date]`, while BasicIndex and BTreeIndex optimized
snapshots returned `[date, equal-number, number]`. The two new index-type
cases failed at that public full-order comparison. They now compare both
full order and the first-row window before and after index installation,
check the Date/timestamp exact-equality class, and spy on the optimized
index take. The repair retains raw native Dates as index order values while
preserving their normalized exact lookup key. The focused index campaign
passed 497 tests, and the full `@tanstack/db` run passed 12,345 tests in 281
files, with no reported type errors. These are working-tree runs, not a
committed-head review. The witness requires scan/index agreement for this
fixture; it does not define a universal order between value families.

## Follow-up to committed-head review

Review of `d974d4a4f` found that the earlier paired inclusive range
(`20 <= rank <= 30` over ranks 10, 20, and 30) did not make either bound
exclude a row. The paired fixture now uses an upper bound of 25, so its
independent model expects only rank 20. The ordinary index has separate
positive spies for ascending take, descending reverse take, numeric lookup,
and range traversal; the full mixed Date/number optimized read also proves
its take was called. These additions make a wrong selected index or a skipped
bound observable at the public snapshot and traversal checkpoints. The
focused owner passed. They do not prove arbitrary numeric histories,
providers, or the live-query compiler's index-use premise. A fresh hostile
review of the final committed follow-up is pending.

The read-only hostile review of `0c236f448` ran all 10 owner tests and found
no blocker in the fixed selection domain. It corrected one claim about the
paired inclusive bound: with ranks 10, 20, and 30 and predicate
`20 <= rank <= 25`, omitting either bound changes the result. Moving either
bound slightly does not necessarily change it, so the coverage map now says
"omitting" rather than "misplacing." This is a documentation correction,
not a new production bug or an added witness. Final review of the next
committed head remains pending.

## Finite provider order handoff

Review of `d917ba4c9` found that the window oracle's controlled provider read
its source rows from the rank-sorted expected result. Removing `orderBy` from
every request therefore left all eight cases green: the fixture still served
the right prefix without an ordering hint. The source facts now have physical
rank order 30, 10, 40, 20. The independent public model still sorts by numeric
rank. The adapter sorts its filtered source rows only when the request carries
`orderBy`, and it checks that every finite request asks for one ascending
`rank` term. This keeps provider work at the request boundary; the public
preload and moved-window comparisons keep their original law.

All eight fixed cases passed after this oracle repair. A temporary test-only
mutant stripped `orderBy` as the adapter received it. All eight cases failed
at the finite-request assertion. With that assertion temporarily disabled,
the BasicIndex/custom-first case reached the initial public snapshot and
failed with `[2]` instead of `[1]`. Both mutations were removed. These are
assertion failures at the intended request and public checkpoints, not
setup failures. The controlled provider still does not establish how a remote
provider interprets an ordered request.

## Public comparator ties at `d917ba4c9`

The public `currentStateAsChanges` path returned `[b]` for descending
`orderBy rank, limit: 1` over tied source keys, while an unindexed scan
returned `[a]`. BasicIndex and BTreeIndex both exposed the
failure through their reverse views. The low-level reverse index may reverse
tie order; the public Collection rule from changelog #958 requires source keys
ascending within comparator-equal positions. New numeric, mixed-key,
custom-collation, and nullish fixtures compare independently sorted source
facts with unindexed and optimized indexed snapshots. Finite prefixes cut
through tied groups, and index-take spies establish the optimized path.

The same defect reached direct on-demand `requestLimitedSnapshot`: a source
with rank-1 keys `c`, `b`, `a` published `[c]` for a descending limit-one
request. That was a separate RED public receiving witness. A neighboring
history first publishes a unique rank-2 row, then continues at a cursor into
the rank-1 tie. A custom string-length comparator checks that a cursor at
`xx` still includes the unsent `yy` peer in the same comparator position.
The repair shares indexed prefix selection across ready snapshots and direct
subscriptions, completes only a finite prefix's boundary group, and sorts
source keys within each comparator group. It does not change the low-level
ReverseIndex contract. The repaired focused ordering, lifecycle, pagination,
and work suites passed 748 tests, plus TypeScript, lint, formatting, and diff
checks. The evidence covers these two public snapshot paths and fixed
histories; provider ordering, source mutations, and full live-query
publication require separate receiving witnesses. Fresh hostile review of
the committed repair remains pending.

## Exact-commit hostile finding at `5c97f18dc`

The fresh reviewer confirmed that ordered indexes could compare encoded
equality keys instead of source values. A custom string-length callback saw
an escaped representation of `"\u0000tanstack-db:x"`, so an indexed ascending
limit-one read selected a 17-character string before that 14-character
string. The unindexed public read selected the 14-character row. Both
BasicIndex and BTreeIndex failed. Direct take, range, and cursor reads also
misordered or omitted it, and a direct subscription continued to the wrong
row. The previous tie fixtures used ordinary strings, so they never crossed
the encoding boundary.

The same encoded-order error moved native byte views into the string order
class. A bounded 40-case hostile sweep crossed five value groups, both index
types, both null placements, and both order directions. String/byte,
number/byte, and equal-content distinct byte-view groups disagreed with the
public scan in their corresponding eight-cell lanes. String/Date and
nullish/byte controls agreed. Exact byte lookups stayed correct. This was an
order-operand bug, not an equality-key bug.

The repaired oracle supplies raw string lengths for the custom callback,
checks direct ordered take/range/cursor and one subscription continuation,
then compares ready public scan and indexed snapshots. A mixed-value fixture
checks primitive-before-byte order and preserves the scan order of two
distinct equal-content byte views after indexing. Exact lookup still groups
those byte views. A literal string that resembles the old BTree undefined
marker stays distinct from undefined in both order and exact lookup. The
production repair keeps raw order operands and normalized exact keys, with a
unique undefined traversal marker for BTree. Six new public assertions and
four direct comparisons per index type were RED on `5c97f18dc`; the focused
649-test campaign passed afterward. A normalized-byte mutant fails both
public indexed comparisons, and an old string marker fails the BTree ordered
read. Both faults were restored.

The earlier prefix helper's take spies establish that an index supplied the
keys. They do not prove a strict work bound: ReverseIndex can enumerate its
whole nullish group inside one finite take. The helper comment now limits
its claim to the requested prefix and boundary group at its own boundary.
The fixed rows and controlled subscription do not establish arbitrary value
mixtures, source mutations, remote provider order, or all live-query
publication schedules. A fresh hostile review of the next committed code
remains necessary.

## Exact-commit window review of `5c97f18dc`

A separate fresh reviewer found no blocker in the finite provider order-hint
repair. Physical provider order differs from rank order. Missing `orderBy`
fails the finite-request guard; without that guard, it fails the initial
public snapshot. All eight fixed window cases passed with no type errors.
This controlled provider does not prove real-provider collation, index-use
efficiency, ties, mutation, or replay.

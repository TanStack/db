# Captured `inArray` membership at source publication

The accepted contract for a live query that captures a caller-owned `inArray`
list is that its current members govern the whole existing result when the
next source event is processed. Changing the list alone publishes nothing.
An untouched row can enter or leave after an unrelated source update. This
query input is distinct from an already submitted `LoadSubsetOptions` request:
the latter's membership data remains immutable for its lifetime under
`packages/db/src/query/live/ARCHITECTURE.md`.

The primary receiving owner is
`packages/db/tests/query/where-predicate-publication-oracle.property.test.ts`.
Its fixed model filters authored source facts with the list's current
members; it does not use compiled membership or source-index decisions to
predict expected keys. A direct Collection snapshot checks current members
after a source transaction. A retained live-query Collection starts with
members `[1]`, changes them to `[2]` and then `[2, 1]`, and delivers an
unrelated source update each time. It compares the complete public key set
and exact insert/delete events for untouched rows, then checks that an
unchanged list does not republish those rows. A separate ordered limit-one
history admits a previously excluded row ahead of the old top and then
removes all prefix matches, requiring refill to the next current member.
A design review then found that this green history missed an unseen source
event. A second ordered history changes `[1]` to `[0]` and deletes rank 4,
outside the acquired finite prefix. Before repair, its public result stayed
`['1']` instead of `['0']`. The repaired dynamic-list ordered plan requires a
full-source acquisition, so that delete reaches the query and the receiver
passes. This costs a full-source acquisition for such ordered plans; the
in-memory receiver does not measure a real provider's bandwidth or latency.
A controlled on-demand ordered receiver checks that its first `loadSubset`
request has no `where`, `orderBy`, or `limit`, then checks the public result
after an unseen delete and list change.

The controlled on-demand receiver deliberately returns only its first row
when a source request contains a `where` predicate. The query must acquire
unfiltered rows so a later list member is available after an unrelated
update. An inner join receiver changes the list, then updates an unmatched
row on either source side. Neither write yields a joined-row delta, but each
must publish one coherent reverse insert/delete batch for the already joined
rows. A QueryRef receiver puts mutable membership in the outer query while
the inner filter suppresses the triggering source change. A correlated
include receiver changes an unrelated child row and checks the parent row's
child Collection against current membership. Fixed Date and byte-array
items mutate in place inside their captured lists and change the result at
the next unrelated source event.

The pooled-query receiver is
`packages/db/tests/query/pooled-live-query-oracle.property.test.ts`. A query
with `eq(group, 'g')` and a residual `inArray` list changes membership, then
updates a source row in another equality group. A pooled group would not
notify that view, so the fixed receiver requires the live-query Collection
path and checks the complete result after the event. The unguarded pooled
path failed this public snapshot before the guard; the receiving cut passes
after fallback. This does not assert that the fallback has the same work cost
as a pooled view.

A 40-row work witness observes indexed reads of one captured list slot. An
ordinary source update with unchanged membership reads that slot fewer than
ten times; changing the list before the next update reads it at least 40
times and refreshes the result. This rejects an all-candidate membership
rescan for every ordinary event in that fixed direct-query path. It does not
establish a general time bound, provider work bound, or cost for the other
query shapes above. Source inspection shows that each delivered graph event
snapshots the captured list in work proportional to its length; a list change
also revisits retained candidates. The fixed counter observes one list slot,
not an asymptotic cost bound for all list values and query shapes.

At committed head `0c236f448`, the evaluator's compiled equality owner passed
249 focused tests for its declared value grammar. That result did not test
the retained live-query result after a caller changed a captured list. The
new fixed receiving histories address that separate publication boundary.
The revised source and receiver still await an exact committed-head hostile
review. A further design review found an on-demand LEFT-join gap:
main rows `one(v=1,g)` and `two(v=2,g)` join group `g`, while group `h` is
outside the lazy joined-side demand. After the list changes from `[1]` to
`[2]`, deleting `h` left the public result at `one` instead of changing it
to `two`. The joined source event was real, but keyed lazy demand did not
deliver this unacquired row to the query. The new public receiver was RED
before the compiler disabled keyed lazy joined-side demand for dynamic-list
compilation and GREEN afterward. This controlled source does not establish
real-provider behavior or the transfer cost of full acquisition. A parallel
on-demand include receiver has parent `g`, children `one(v=1,g)` and
`two(v=2,g)`, and spare child `(v=3,h)` outside the former lazy child demand.
After `[1]` changes to `[2]`, deleting the spare must change the materialized
children from `[one]` to `[two]`. The working-tree receiver passes and checks
that the first child `loadSubset` request has no `where` predicate. A separate
public probe saw `[one]` before this gate and `[two]` afterward; the oracle
suite's combined run establishes the receiving check after the gate.

An earlier working-tree focused and neighboring run passed 988 tests across
11 suites, with no type errors. It includes the direct, pooled, ordered,
on-demand, joined, QueryRef, include, Date/byte, and 40-row work receivers.
The later full DB run exposed two older positive fixtures that assumed an
ordinary mutable `inArray` literal could still use index pushdown or forward
a finite subset predicate. Those assumptions conflict with the accepted
captured-list law: a changed member can admit an existing row outside the
former subset. The index-optimization and subquery-forwarding tests now use
`Object.freeze` lists, so they continue to check those optimizations within
the immutable-list domain. Their 34 focused tests pass. This fixture change
does not retire either test. `ExpressionLike` now accepts `ReadonlyArray` so
the frozen expressions typecheck; a separate error-catalog failure was fixed
by recording code 243. The final DB suite passes 12,383 tests across 282 files,
and DB-IVM passes 693 tests across 45 files. Both suites have no test type
errors. The DB and DB-IVM builds and explicit source and test typechecks pass.
Real providers, broader source schedules, arbitrary list values and histories,
and general work bounds remain outside these fixed receivers. Exact
committed-head hostile review remains pending.

## Query-stage transfer

The new primary stage owner is
`packages/db/tests/query/captured-inarray-stages-oracle.test.ts`. Its plain
array model checks numeric list membership after `[1]` changes to `[2]` and
one unrelated source transaction updates value 3. Values 1 and 2 remain
untouched. The initial nine fixed public witnesses cover selected membership,
including one coherent update batch and a callback that reads the complete
new result. The other cuts cover a retained ordered limit, an on-demand
selected value under an ordered limit, group-key moves, an aggregate argument,
HAVING, membership on each JOIN operand side, and an inner QueryRef SELECT
consumed by an outer filter. The
controlled on-demand witness also requires its first `loadSubset` request to
omit `where`, `orderBy`, and `limit`. Three later fixed cuts check a distinct
four-row limited ORDER result, grouped SUM/min/max arguments while a
different group receives the source update, and a mutable aggregate argument
wrapped by a selected addition. These are stage and acquisition
cuts of the same accepted source-publication law, not a generated grammar.

The nine initial witnesses were RED against the earlier stage implementation
and GREEN after the working-tree repair; each also compares public rows.
Source inspection shows one list revision driven by raw source events across
the compiled graph. A revision
revisits retained stage inputs; each stage retains its prior output for
retraction before evaluating current membership. The repair applies this at
JOIN, WHERE, SELECT, GROUP and aggregate input, HAVING, and ORDER, with an
optional mapped-input hook in the D2 groupBy operator. The fixed witnesses
establish the named observations, not all combinations of these stages.

Hostile design review found one further public counterexample: after
membership changed, a limited ordered result duplicated a source row. A
four-row, limit-three receiver sorts each source identity once by current
membership and key. It was RED before Collection deferred order maintenance
for a layout change and GREEN afterward. A separate grouped receiver checks
SUM, min, and max arguments for an untouched group after a different group
updates; it passes in workspace Vitest. The standalone probe that suggested a
min/max failure imported stale DB-IVM output, so it did not establish a
production defect. The wrapped-aggregate receiver selects
`add(sum(caseWhen(inArray(row.v, members), row.v, 0)), 10)`. After `[1]` changes
to `[2]` and an unrelated row updates, the plain-array model requires total
12; the earlier implementation retained 11. Recursive aggregate-input
detection makes the twelfth public witness GREEN. Hostile probes of nullish
grouped/public output and projected sorting were bounded GREEN controls, not
confirmed production defects. The earlier working-tree run passed 11 stage
tests and 33 WHERE/publication cases; the final DB suite includes all twelve
stage witnesses and the WHERE/publication receivers. The exact committed-head
hostile verdict remains pending. Real-provider event delivery, arbitrary list
values or histories, mixed stage combinations, and general work bounds remain
outside this fixed stage owner.

### Provisional oracle-guide applicability

- **ORC-001–003:** The accepted next-source-event law and fixed numeric limits
  are stated in the owner; plain-array `includes` computes expected results
  without compiler or D2 outputs; opening prose distinguishes model, source
  history, public observations, and comparison cuts. Exact-head review of
  that prose remains pending.
- **ORC-004, ORC-007, ORC-008, ORC-009:** No generated history, seed/path
  campaign, stateful reference model, or model-only subsystem vocabulary is
  introduced by these fixed recomputations.
- **ORC-005–006:** The real live-query Collection is compared immediately
  after preload and one source commit. SELECT additionally checks one public
  subscriber batch; the on-demand case checks request shape before comparing
  public rows. The nine initial pre-repair runs failed their receiving checks
  and passed after repair in the working tree. The separate limited ORDER
  duplicate was also RED at its public comparison and GREEN after its repair.
  The wrapped aggregate was RED at total 11 against expected 12 and GREEN
  after recursive detection. The grouped SUM/min/max receiver passes in
  workspace Vitest. This
  calibrates these fixed cuts without claiming all legal histories.
- **ORC-010:** `withOracleCleanup` releases each source, live-query Collection,
  and subscription where present while preserving the primary assertion
  failure. No shrink or replay capture occurs.
- **ORC-011:** The limited ORDER duplicate and top-level-only aggregate
  detection name additional wrong designs; plain-array ordering and wrapped
  sum predictions reject them. The apparent min/max
  failure came from a stale standalone module import; the workspace receiver
  passes. No general stage-law closure is claimed.
- **ORC-013:** This owner claims twelve fixed cuts and checkpoints, not all
  legal values, histories, or stage combinations. New reachable cases remain
  within this stage owner's coverage responsibility.
- **ORC-014:** The on-demand source is controlled. Its unfiltered request and
  public result establish the Collection path; real-provider adherence and
  bandwidth remain open.
- **ORC-012:** This applicability record is provisional. Verdict-critical
  evidence needs a fresh hostile review tied to the exact committed head. The
  full DB and DB-IVM suites, builds, and source/test typechecks pass at the
  working-tree checkpoint above.

## Exact-commit publication review of `5c97f18dc`

A fresh read-only reviewer found no blocker in the retained direct WHERE
receiver's callback and pre-event checks. The accepted law requires a whole
current result after the next source transaction. The fixture changes
`[1]` to `[2]` and then `[2,1]`, while an excluded source row supplies each
event. The independent source-row model predicts all public keys. The
recorder preserves callback boundaries, checks one complete delete/insert
batch, and reads the whole public result during delivery. The focused
checkpoint passed with no type errors. The earlier pre-event assertion
covered only the synchronous call stack. The next repair waits one microtask
turn after each edit, then checks the old keys and zero callbacks again. The
33-test focused WHERE owner passes. Later timers, arbitrary asynchronous
schedules, and real providers remain outside this fixed history. A fresh
review of the committed microtask addition remains pending.

The captured-list stage owner received a separate read-only review at
`d917ba4c9`. All twelve fixed checks passed. Four temporary public probes
also passed for repeated list edits, combined stages, an unmatched LEFT JOIN,
and a UNION refreshed by another source. Those probes were removed and do
not extend the committed owner's claim. Broader callback coherence and real
provider behavior remain open for that owner.

## Exact-commit microtask review of `d93ae1dd6`

A fresh read-only reviewer found no behavior defect in the retained direct
WHERE history. The selected test passed with no type errors. The independent
source-row model predicts the current whole key set. The direct receiver checks
old keys and zero callbacks through one microtask after each list edit. After
the next source transaction, it checks one complete callback batch and reads
the current whole result during that callback. The compiler schedules list
refreshes from source input events; the reviewer found no list-only scheduling
path. The review found one contract-wording gap: the oracle said a list edit
"need not publish," while the architecture says it does not publish. The
follow-up changes that prose to the accepted law. The existing split-batch
control calibrates event coherence, but no separate delayed-schedule mutant
calibrates the new microtask checkpoint. Nested microtasks, timers, arbitrary
list/event histories, and real providers remain outside this witness. It does
not retire an additional legacy test block.

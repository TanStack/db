# Alias scope follow-up: outer joins and captured operands

The contract is `packages/db/src/query/live/ARCHITECTURE.md` §Identity and
normative law 1. A captured reference names its lexical source even when a
child declares the same alias. An absent outer-join side has no row from that
source. A join operand may combine an ancestor value with a local source value;
reversing `eq()` operands does not change the relation.

The primary executable owner is
`packages/db/tests/query/includes-alias-shadowing-oracle.test.ts`. Its new
plain-row models pair sources by numeric keys and apply ancestor correlation by
source role. They do not use compiler alias maps, binding IDs, route metadata,
or optimizer helpers to calculate expected rows. The driver uses public `Query`
and live Collection entry points. The comparison reads public rows after
preload and after each source write.

## RED on merged `main`

The starting commit was `f7ac2c63a`, the merge of PR #2079. Before the
compiler edit, the new QueryRef RIGHT and FULL cells reached the first public
row check with an unmatched joined row. The expected child `mainId` was
`undefined` and `missingMain` was `true`; the actual values were the ancestor's
`id` of `1` and `false`. A direct joined Collection lost the unmatched row
entirely, because only the main stream carried the parent route. Both eager
and on-demand versions showed the mismatch. The captured-ancestor join cells
failed at compilation with `InvalidJoinCondition` before they could publish
rows; their renamed and reversed controls supplied distinguishable source
roles.

The first repair exposed one more missing checkpoint. A FULL join whose
correlation was attached to the main side admitted a joined-only row after the
main source had already been filtered by parent keys. The independent model
excluded that row. This was RED at initial publication in both source modes.

## Repair and GREEN witness

The compiler now routes the joined input of a correlated RIGHT or FULL join
through the parent stream. At the join output, an absent main side clears its
local aliases from inherited parent context. After a RIGHT or FULL join, the
compiler checks correlation again, since that join can create a row without
the previously filtered main source. Join operand classification uses binding
IDs to distinguish the joined declaration, local main declarations, and
captured ancestors. Ancestor terms are legal on either operand; a joined-side
ancestor term also triggers route attachment before its expression runs.

The outer-join matrix has 24 cells: three join/correlation layouts, two source
modes, direct or QueryRef joined sources, and shadowed or renamed aliases.
Each cell checks the initial state and six writes, including main removal and
return, a second match, joined-side removal, and an ancestor update. Two parent
routes prevent one route's rows from standing in for another. The operand
matrix has 24 cells: an ancestor term combined with a local main or joined
term, or serving as the entire main key, crossed with both equality orders,
two aliases, and two source modes. It checks five cuts across ancestor, child,
and joined-source changes. The original implementation fails witnesses
for each reported bug at the intended construction or public-row checkpoint;
the repaired implementation passes the matrix.

Four targeted mutants confirm sensitivity at the intended checkpoint:

- Retaining inherited local aliases makes the shadowed QueryRef RIGHT cell
  fail its first public-row comparison.
- Omitting parent routing for direct RIGHT/FULL joined inputs makes the direct
  RIGHT cell lose its unmatched row at the first public-row comparison.
- Omitting the post-join correlation check admits a joined-only FULL row whose
  correlation belongs to the absent main side.
- Classifying a bound join reference by alias text makes the captured-operand
  cells throw `InvalidJoinCondition` during compilation.

The final focused run passed 716 tests across seven join, include, optimizer,
and oracle suites. TypeScript checking, lint, and whitespace checks passed.
The package-wide run with its browser-capable configuration passed 11,905
tests in 272 files. Its `oracle-replay.test.ts` child-process harness failed
21 tests because this local checkout links `node_modules` to a directory that
the sandbox cannot write; Vite reported `EPERM` while creating its temporary
config. No query or join test failed in that run. The package's `test:oracles`
command now includes the primary alias-shadowing oracle.

This is bounded evidence for these legal histories and observations. It does
not establish arbitrary chained outer joins, deeper captures through other
recursive query forms, temporal provider races, or every lazy join target.
Those remain in the alias-scope owner entry of `oracle-coverage.md`.

## Foreign captured join operands — 2026-10-10 follow-up

CodeRabbit review `5476389606` examined `2d0cbafabddb898d8fadcb7d304ff06fb0154d7e`.
Its one correctness finding is repaired at executable revision
`50407da55dc0be58aec1b5e735ebc10a5b7cd7a9`. This record covers that
revision; a later documentation-only commit may carry the record itself.

**Law and test gap.** `ARCHITECTURE.md` §Identity and law 1 make aliases lexical
names. A join operand can read a local or actual ancestor declaration; a
reference captured from an unrelated query is outside scope even if its alias
matches. The earlier operand matrix exercised valid local and ancestor roles,
but lacked an unrelated provenance role and a rejection checkpoint. It was
correctly green for its narrower grammar.

**Independent oracle.** The primary
`packages/db/tests/query/includes-alias-shadowing-oracle.test.ts` now uses the
source declaration's role, not binding IDs or compiler alias maps, to predict
admission. Its bounded grammar crosses root versus include placement, eager
versus on-demand sources, and a foreign alias that matches the local alias
versus one with different text. The driver captures the foreign reference
through the public `Query.select()` callback, builds the join through the
public builder, and observes rejection during construction or preload before
rows are accepted. A valid local operand publishes exactly one row in the
same fixture; the pre-existing 24-cell ancestor-operand matrix keeps legal
captures accepted across source mode, alias spelling, operand order, and
updates. The foreign source's ID is `999` while the local and joined IDs are
`1`, so substituting the local row cannot masquerade as the foreign source's
value. The test cleans up every constructed live-query Collection and source
Collection while preserving a primary assertion failure.

**RED, calibration, GREEN.** On the reviewed head, the public-path probe
published `[{localId:1,joinedId:1}]` with the unrelated `local.id` operand,
the same as the legal local-operand control. The newly added oracle was RED
in all four placement/source-mode tests because each preload fulfilled rather
than rejecting. With the final oracle unchanged, a temporary mutant that
disabled raw-plan scope validation failed all four at the intended rejection
assertion; it was an assertion failure, not a setup error or timeout. The mutant
was removed. On the repaired executable revision the full primary oracle
passed 103 tests, and seven affected join, include, and optimizer suites
passed 493 tests. The production-error-message oracle passed 19 tests;
TypeScript, ESLint, and `git diff --check` passed. A package-wide run passed
11,909 tests in 272 files. Its 21 oracle-replay subprocess tests could not
write Vite's temporary config through this checkout's restricted dependency
link; an additional Vitest typecheck temporary file hit the same sandbox
boundary. These are local harness failures, not a claim of a fully green
package-wide run. CI remains the normal unrestricted receiving check.

**Repair boundary.** Scope validation walks the original query before
optimization, carrying declarations visible at each join through `QueryRef`,
union branches, and includes. It rejects a bound join ref absent from the
current and ancestor sets. Recursive compilation uses the already validated
tree, while the public compiler entry keeps its original signature. The
checker passes only the current query's visible declarations and its actual
ancestors to include validation. It does not infer ancestry from alias text or
expose declarations hidden inside a `QueryRef` or union branch. The remaining
owner entry in `oracle-coverage.md` tracks foreign refs outside join operands,
other recursive join shapes, and provider schedules; this bounded evidence
does not establish those cells.

Guide audit for this oracle repair:

| Requirement | Evidence or reason it does not apply |
| --- | --- |
| ORC-001 | §Identity and law 1 authorize lexical provenance and fail-fast rejection; the paragraph above states the join-only bound. |
| ORC-002 | Expected admission comes from source roles declared in the fixture, independent of compiler binding lookup or alias maps. |
| ORC-003 | The executable block states the law and limits beside its role model, finite grammar, public driver, preload observation, and comparison. |
| ORC-004 | The new matrix is bounded enumeration, not a generated-history property. Both aliases, placements, and modes are explicit; matching alias kills an alias-only rule, include placement requires an actual ancestor context, and the valid local and ancestor controls prevent a universal rejection rule. |
| ORC-005 | Public `Query` and `createLiveQueryCollection` reach compilation; the assertion checks rejection at construction or preload, and the local control checks exact public rows. |
| ORC-006 | The unvalidated implementation and the guard-disabled mutant both reach the promised checkpoint and fail by assertion. |
| ORC-007 | No new generated property or seed/replay interface was introduced. |
| ORC-008 | The provenance rule is stateless; it adds no reference-model state. |
| ORC-009 | Model roles `local`, `ancestor`, and `unrelated` denote source declarations in lexical scopes, not compiler IDs or runtime Collections. |
| ORC-010 | `withHistoryCleanup` preserves the primary rejection mismatch and separately reports cleanup failures. |
| ORC-011 | Matching versus different foreign alias text is a second, metamorphic formulation of the same rejection law; the legal ancestor matrix is the opposite control. |
| ORC-012 | This table records every other applicable guide requirement and the finite closure boundary. |
| ORC-013 | The matching-alias foreign witness rejects the plausible wrong rule “same alias means local”; the local and ancestor witnesses reject “all captured refs are invalid.” |
| ORC-014 | No claim crosses from the controlled source adapter to a real provider; the tested admission happens before provider-specific behavior matters. |

## Chained joins and main-correlated route work — 2026-10-10 follow-up

The nine-item user review inspected `2d0cbafabddb898d8fadcb7d304ff06fb0154d7e` without executing its findings. The current repair started from `43d7c3d771c52c39bff38ba5a4fb7b1d02e99215`; its executable commit is `b41dc35bf`. This section records the bounded oracle evidence for the two reported behavior gaps. The task-local lossless ledger is `/private/tmp/pr2095-user-review-ledger.md`.

**Absent local binding law.** `ARCHITECTURE.md` §Identity and law 1 distinguish a captured ancestor's `issue` from a child's same-named declaration. Once a LEFT join has no child `issue`, a later routed joined row may carry the ancestor context but cannot supply the missing child source. The prior outer-join matrix had one join only. It was green for its declared boundary and could not generate the reported two-join sequence.

The primary `includes-alias-shadowing-oracle.test.ts` now recomputes two LEFT joins from plain parent, comment, issue, and tag rows. Its legal history has two parent routes: one child issue is absent and the other is matched. It adds and removes the absent issue, then removes and restores the second joined side. Each cut compares exact public child rows, including the local issue ID and `isUndefined`, under shadowed and renamed aliases, eager and on-demand sources, and routing caused by either a parent-dependent QueryRef or a captured ancestor operand. The model uses source roles and plain numeric relations; it does not read compiler namespaces, binding maps, or route metadata. The QueryRef filters tags by parent, while the direct source reads the parent in its equality operand; the model states that distinction explicitly.

With the final oracle in place, restoring the original merge order made both source-mode tests fail at **initial public rows**: child comment 10 had expected local issue `undefined` and `missingLocalIssue: true`, but received ancestor issue ID `1` and `false`. The QueryRef route produced the same RED observation in an earlier calibration run. The repair copies the main row's scope when it exists and only the joined source from the joined row; when the main side is absent, it still retains the joined row's route context and clears local main aliases. The repaired oracle passes both tests and its neighboring single-join matrix.

**Route-work law.** `ARCHITECTURE.md` law 12 says irrelevant rows must not activate unrelated routes when an applicable index exists. A direct joined source in a main-correlated RIGHT or FULL include has no parent-dependent expression. Joined-only output has no main correlation and is removed at the post-join correlation cut, so adding unmatched joined rows cannot increase parent-route assembly for that source. A joined-correlated outer join and a parent-dependent QueryRef remain distinct; the primary row matrix retains both as correctness controls.

The separate `includes-outer-join-route-work-oracle.test.ts` owns this work observation. A transparent wrapper counts calls to the existing route assembler while public rows are checked against plain relational recomputation. With two parents, it compares one matching anchor with that anchor plus two irrelevant anchors across RIGHT/FULL and eager/on-demand source modes. The old unconditional routing rule was a hostile mutant: all four cells kept the expected rows but grew from **2 to 6** route assemblies at preload and failed the work assertion. The repaired rule had equal counts (**0 and 0**) and the same public rows. Equality, rather than a mandated zero, is the work law; another implementation may do constant useful route work. This is an internal assembly count, not a claim about real-provider requests or every source scan.

The reviewed head's foreign-bound-operand finding was repaired earlier in `50407da55` with a provenance oracle. The new review's mixed bound/unbound same-alias example does not reach its claimed same-source error: a public Query using a bound ancestor operand and an unbound raw-IR joined operand preloaded and returned the correct row. The role and same-source logic were unchanged from `2d0cbaf` to `43d7c3d77`. The new control remains in the primary oracle. The review's test-gap observation was valid: the prior matrix omitted a two-join history and main-correlated RIGHT. Those dimensions are now executable. Join-ref classification and the three expression walkers were consolidated; the join's local-binding set remains intentionally incremental because the builder helper includes future joins.

The follow-up production diff from `43d7c3d77` is 59 added and 111 removed lines, net **−52**. The review's 86/44 (+42) count was accurate for `2d0cbaf`; after the earlier foreign-scope validator and this follow-up, cumulative production code remains larger than merged main. The extra validator enforces the explicit out-of-scope rejection law; line count alone is not a row-correctness witness.

Focused primary and work owners passed 112 tests. The wider query directory passed 4,198 tests in 100 files. TypeScript checking, ESLint, Prettier, and `git diff --check` passed. The right-main row cells cover initial publication and six source writes; the chained law covers initial publication and four writes; the work law is checked at preload. This does **not** prove arbitrary chained join orders or kinds, every recursive joined source, a full source-work bound, publication events, or real-provider scheduling. The alias-scope coverage-map owner retains those limits.

| Guide requirement | Evidence or limit for this follow-up |
| --- | --- |
| ORC-001 | §Identity/law 1 authorizes lexical source absence; law 12 authorizes the bounded route-work relation. The scopes and exclusions are stated above and in each oracle's opening prose. |
| ORC-002 | Plain source-row pairing predicts public rows; the work relation compares irrelevant-anchor growth. Neither expected result uses compiler role classification or route assembly. |
| ORC-003 | Both executable files place law and limits before mechanics, with model, finite history, public driver, observations, and comparison described beside code. |
| ORC-004 | No generated property was added. The bounded tables cross the named modes, aliases, route causes, and join kinds; matching and absent controls are explicit. |
| ORC-005 | Public Query and live Collection preload/writes reach compilation. Assertions read exact public child rows at each named cut; the transparent work wrapper counts route assembly at preload. |
| ORC-006 | Restoring the original merge order fails both chained-row tests at the first public-row assertion. Restoring unconditional RIGHT/FULL routing fails all four work cells at the count comparison while rows remain right. These are assertion failures, not setup errors. |
| ORC-007 | No important generated property was added; fixed-seed/random campaign parity and replay do not apply. |
| ORC-008 | Both expected results are stateless recomputations from current plain rows; no reference-model lifecycle state changed. |
| ORC-009 | Model parent, main/comment, local issue, tag/anchor, and route cause denote source roles and grammar choices; they do not stand for compiler alias maps or route metadata. |
| ORC-010 | `withHistoryCleanup` preserves the primary mismatch and cleans live and source Collections, reporting secondary cleanup errors separately. |
| ORC-011 | Alpha-renamed aliases and two route causes provide a second way to expose ancestor substitution. No independent real-provider work formulation is claimed; that handoff remains open. |
| ORC-012 | This table records every applicable guide requirement and states the finite closure boundary and unresolved cells above. |
| ORC-013 | An absent versus matched local issue distinguishes the source-binding consequence; one versus three anchors distinguishes useful joined rows from unrelated route work. The original merge and unconditional-route mutants are rejected at those checkpoints. |
| ORC-014 | Eager and controlled on-demand Collections supply the source premise. No claim is made about an external provider's request work; it needs a receiving witness before extension. |

## Include validation and hidden source bindings — 2026-10-10 follow-up

CodeRabbit review `5479589545` covered `43d7c3d77`, before the chained-join
repair, and reported that an include child could capture a source declared
inside its parent's `QueryRef` or union branch. The reviewed implementation
passed all bindings in the parent's source tree to the child validator.
`ARCHITECTURE.md` §Identity/law 1 instead gives the child the parent's visible
declarations and actual ancestors. A nested source's result may be visible, but
its private declaration is not. A child join operand bound to that declaration
must be rejected before public rows are accepted, regardless of alias text.

The primary alias oracle now crosses hidden-source placement (`QueryRef` or
union branch), matching or renamed alias, and eager or on-demand source mode.
It captures the hidden source through the public builder and attempts an
include join through `createLiveQueryCollection`. The expected rejection comes
from the fixture's declaration provenance; it does not inspect compiler
binding sets. Valid local and genuine ancestor captures in the same owner are
opposite controls. The observation is rejection during construction or preload,
before public rows are accepted. All eight matrix tests failed on `6bd64e86f`
because preload resolved instead of rejecting. This was an assertion failure
at the intended checkpoint, not a setup error. Passing the validator's
existing visible-binding set to include validation made all eight pass.

The query directory passed 4,593 tests in 110 files with Vitest inline
typecheck disabled; separate TypeScript and ESLint checks passed. A first run
with inline typecheck enabled passed 4,818 tests in 130 files before the alias
cells were split for independent RED assertions, then exited nonzero because
the linked Vitest installation could not write its temporary
TypeScript cache outside this workspace. Prettier and whitespace checks passed
after formatting. The finite matrix does not prove every hidden-source
expression position, deeper recursive source topology, or provider schedule.
Those remain under the alias-scope owner in `oracle-coverage.md`.

| Guide requirement | Evidence or limit for this follow-up |
| --- | --- |
| ORC-001 | §Identity/law 1 authorizes lexical visibility; the parent result does not export its nested source declarations. |
| ORC-002 | The fixture labels visible and hidden declarations independently of the compiler's binding collection. |
| ORC-003 | The executable block states the law, model distinction, finite grammar, public driver, rejection cut, and limits beside the test. |
| ORC-004 | The bounded matrix crosses placement, alias spelling, and source mode; valid local and ancestor controls distinguish overbroad rejection. |
| ORC-005 | Public builders and live Collection preload reach the validator; each cell asserts rejection before accepting rows. |
| ORC-006 | Restoring the pre-repair source-tree collector fails all eight final cells by resolving preload; the repaired compiler passes them. |
| ORC-007 | No generated property or seed interface changed. |
| ORC-008 | Declaration provenance is a static model rule; no model lifecycle state changed. |
| ORC-009 | `hidden`, `local`, and `ancestor` name lexical source roles, not compiler IDs. |
| ORC-010 | `withHistoryCleanup` preserves rejection failures and disposes live and source Collections. |
| ORC-011 | Matching and renamed aliases are alternate formulations of the same visibility law. |
| ORC-012 | This table records the applicable guide requirements and the finite boundary above. |
| ORC-013 | The original recursive source-tree collector is the rejected wrong design; valid captures rule out a blanket ban. |
| ORC-014 | Both controlled source modes reach public preload. Real-provider scheduling is not claimed. |

## Joined source scope — 2026-10-10 follow-up

CodeRabbit review `5479690200` covered `6bd64e86f` and reported that a
joined `QueryRef` could capture a source declared beside it in the enclosing
query. This remained reachable after the include-scope repair. The compiler
compiles the joined `QueryRef` as a separate source stream; it receives any
actual ancestor route, but not the enclosing query's sibling rows. The law in
`ARCHITECTURE.md` §Identity therefore requires rejection of a bound sibling
reference inside the joined source. Only the enclosing join condition can
combine those two sources. The previous validator passed preceding sibling
bindings to the joined `QueryRef` and admitted the invalid capture.

The primary oracle now crosses root/include placement, a joined source whose
inner alias matches or differs from the sibling's alias, and eager/on-demand
source mode. Each of eight invalid cells captures the sibling through a public
builder callback, places that reference inside the joined `QueryRef`'s own
join condition, and asserts rejection at construction or preload before public
rows are accepted. Four neighboring cells instead capture a true include
ancestor in the same nested join and compare exact public rows with plain
relational recomputation. These expected results come from source roles and
input rows, not compiler binding IDs or route metadata.

On the pre-repair `e7ad3be2f` head, all eight invalid cells failed at their
rejection assertion because preload resolved. Restoring only the permissive
validator on the final oracle made the same eight fail while all four valid
ancestor controls passed. Passing actual `ancestorBindings` to joined-source
validation made all twelve cells pass. The visible-binding set remains in use
for the enclosing join condition and include children. This is bounded
admission and row evidence: it does not prove every expression position,
deeper recursive source form, or real-provider schedule.

The final query-directory run passed 4,605 tests in 110 files with Vitest's
inline typecheck disabled. Separate TypeScript, ESLint, Prettier, and whitespace
checks passed. The linked test-runner cache limitation described above still
applies to inline typechecking in this local checkout.

| Oracle responsibility | Evidence |
| --- | --- |
| Contract and model | §Identity names which declarations a joined source receives; plain source roles predict rejection or joined rows. |
| Grammar and driver | Root/include × matching/renamed alias × eager/on-demand mode; public Query and live Collection preload. |
| Observations and refinement | Eight rejection assertions before accepted rows; four true-ancestor controls compare exact public rows after preload. |
| Sensitivity and limits | A one-line permissive validator mutant fails all eight invalid cells and passes all four controls; the recursive and provider limits remain with the alias-scope owner. |

## Expanded alias-scope laws — 2026-10-10 follow-up

This expansion starts from `a598fa2bb`. The primary executable owner is
`packages/db/tests/query/includes-alias-shadowing-oracle.test.ts`; the
companion route-work owner is
`packages/db/tests/query/includes-outer-join-route-work-oracle.test.ts`.
`ARCHITECTURE.md` §Identity and law 1 authorize lexical source identity and
rejection of an unrelated bound reference before its expression accepts rows.
Law 12 supplies the bounded route-work relation. These tests use plain source
rows and declaration roles to predict results, without compiler binding maps,
parent-route metadata, or join classifiers.

**Legal histories and observations.** The primary owner now recomputes four
two-join chains: RIGHT then LEFT, RIGHT then RIGHT, FULL then FULL, and FULL
then LEFT. The finite grammar crosses main, first-joined, or second-joined
parent correlation as applicable; shadowed and renamed aliases; eager and
controlled on-demand sources; and six writes that remove or restore first and
second join matches or change an ancestor value. Two parent routes distinguish
leakage between routes. At initial publication and after every write, the
driver compares exact public child rows, including the presence of each source.
The route-work owner now compares public rows and route-assembly counts at
preload and four main-source writes while irrelevant joined rows grow. It
asserts equal useful work across fixture sizes, without asserting that a
particular implementation performs zero assemblies.

**Provenance grammar.** A source hidden inside a parent QueryRef or union
branch remains unavailable to an include child at one or two recursive levels.
Sixteen cells cross the four source placements, matching or renamed alias, and
source mode. Twelve non-join cells reject an unrelated bound reference in WHERE,
GROUP BY, HAVING, ORDER BY, direct SELECT, or conditional SELECT, with matching
and renamed aliases. A separate grouped include accepts actual ancestor refs
through shadowing, grouping, HAVING, ordering, and parent or child writes. Four
parent-filter cells reject a foreign reference moved out of the child's WHERE;
four extracted-correlation cells reject a foreign parent field removed from
that WHERE. Each has an exact-row control using the real parent. Public preload
is the rejection checkpoint; the valid controls compare public rows.

**Sensitivity and repair.** A temporary later-FULL-as-LEFT mutant failed two
mixed-chain cells at their first public-row comparison. Restoring the
source-tree-binding mistake failed eight deeper hidden-source cells by
resolving preload instead of rejecting. Disabling the new non-join expression
checks failed all twelve cells at that same rejection assertion. The
parent-filter gap was RED on the starting validator and a focused mutant
omitting its repair failed all four parent-filter cells. Omitting validation
of the extracted correlation field failed all four new correlation cells.
These were assertion failures at the promised checkpoints, not setup errors or
timeouts; every temporary mutant was removed. The final validator checks
visible bindings in join operands, predicates, grouping, ordering, select
expressions, extracted parent filters, and both correlation fields before
optimization. The development text for error 237 now says “Query reference”
to match its wider scope.

**GREEN and limits.** On the final working tree, the two focused owners passed
170 tests; the query directory passed 4,643 tests in 110 files; and the
production-error-message oracle passed 19 tests. Separate TypeScript, ESLint,
Prettier, and whitespace checks passed. The production compiler diff is 65
added and 14 removed lines, net **+51**; the independent oracle tests grow
separately to prove the expanded law. The validation machinery accounts for
the positive production weight. This evidence covers the enumerated histories
and public checkpoints. Other expression forms, arbitrary join-subquery and
lazy-target shapes, deeper captures, other chained outer joins, external
provider schedules, and broader source-work bounds remain open in the
alias-scope coverage-map owner.

| Oracle responsibility | Evidence or limit |
| --- | --- |
| Contract and model (ORC-001–003, 009) | §Identity and laws 1 and 12 supply the promise; plain relational rows and fixture declaration roles supply independent expected results. The executable comments place the law, limits, model, histories, public path, and comparison beside the tests. |
| Grammar (ORC-004, 007–008) | These are bounded matrices and stateless recomputations, not an important generated property or a new stateful model. The named axes expose absent and present source roles, alias renaming, recursion depth, and extraction boundaries. |
| Public path and comparison (ORC-005, 010–011) | Public Query and live Collection preload or writes reach compilation. Exact rows, rejection before accepted rows, and bounded route work are checked at their stated cuts; cleanup preserves the primary failure. Valid local and ancestor controls provide opposite formulations. |
| Calibration (ORC-006, 013) | The five temporary mistakes above fail at intended assertions; none survived or failed only in setup. |
| Handoff and record (ORC-012, 014) | The coverage-map owner states remaining paths. Controlled on-demand sources do not establish external-provider scheduling or work bounds. |

## Sibling builder reuse and spread identity — 2026-10-10 review

The merged #2079 review targeted `84dc3601c`. Its shared-builder finding
distinguishes **placing** a query builder twice from **capturing** a reference
declared inside a sibling query. `ARCHITECTURE.md` §Identity and law 1 allow
sibling reuse. The existing hidden-source oracle correctly rejects a bound
reference *into* the parent's QueryRef or union branch; it does not require
rejecting the same builder when that builder is independently placed in the
include child. Two older tests conflated the two acts and expected error 236
for legal sibling placement.

The primary oracle now places one builder both inside a parent QueryRef,
`unionAll` branch, or joined QueryRef and inside a sibling include. Six cells
cross these positions with eager or controlled on-demand sources. The plain
row model pairs current employees with their current manager; construction,
public rows after preload, and rows after a manager change are the asserted
cuts. The original source-tree guard failed all six cells at construction with
error 236. Restricting the guard to declarations in the containing query's
lexical scope makes them pass; the existing actual ancestor/descendant reuse
cells still reject before publication. This is admission and row evidence for
those three placements and one update, not an arbitrary recursion proof.

The same review found that each enumeration of a captured reference proxy left
a spread marker behind. An independent selected-plan control now discards one
enumeration, then selects the same parent and child fields as a plan without
that discarded enumeration. It asserts equal query identity before preload and
exact public rows before and after a child update. The retained-marker
implementation failed at the identity assertion. A proxy now offers only the
marker for the current enumeration; the unchanged control and repaired plan
pass the same checks. Other spread layouts remain covered by neighboring
field, whole-row, nested-path, and alias-renaming cells rather than this one
identity control alone.

The review's optimizer and work observations require narrower conclusions.
A scratch public-path probe of a pure same-alias QueryRef wrapper with an
indexed on-demand source observed a full-source request and two installed rows
for an outer equality selecting one row; the direct-source control requested
only that key. This confirms extra work in the current wrapper shape, but the
pre-merge optimizer extracted source predicates before wrapper collapse too,
so this probe does not establish that #2079 introduced the full-source request.
The wrapper's extra stage is real; its exact work budget and a safe binding
remap remain unproved. A nested `unionAll` ordered wrapper with the minimum
row in its second on-demand source published that row and requested both
sources; direct union sources are excluded from ordered-prefix optimization.
That probe does not prove every union shape safe. A bound root reference caused
an extra route-metadata check relative to an unbound reference, and a
function-form query failed `queriesMatchForCaching` even when compared with
itself. Those are deterministic mechanism observations, without a measured
public work bound. All scratch probes were removed; their evidence is kept in
the task-local review ledger, while the primary owner and coverage map retain
the behavior witnesses and their limits.

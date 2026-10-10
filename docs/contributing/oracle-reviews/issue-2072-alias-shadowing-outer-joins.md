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
checker uses the builder's existing source-tree traversal for include
ancestors. It does not infer ancestry from alias text. The remaining owner
entry in `oracle-coverage.md` tracks foreign refs outside join operands,
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

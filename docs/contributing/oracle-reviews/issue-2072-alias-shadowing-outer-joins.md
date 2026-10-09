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

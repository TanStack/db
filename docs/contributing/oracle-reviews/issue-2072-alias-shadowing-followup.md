# Issue #2072 alias scope: review follow-up for PR #2079

The external review checked the alias-shadowing change at `c79d8a8c4`. The
evaluation ran against `0d4b883cc2`, which merged newer `main` error-message
work but kept the relevant binding and compiler logic. The contract is
`packages/db/src/query/live/ARCHITECTURE.md` §Identity and law 1. The primary
executable owner is `includes-alias-shadowing-oracle.test.ts`, with the broader
scope grammar in `includes-oracle.property.test.ts`.

## Proved failures and repairs

- Reusing one `q.from({ n })` builder as both the parent and a direct include
  child gives both placements the same binding ID. A child
  `eq(child.parentId, parent.id)` is then classified as two child references
  and construction throws the misleading “must have a WHERE ... eq()” error.
  This is still open. The existing helper-reuse oracle reused a child twice,
  which did not exercise one builder across ancestor and descendant scopes.
- The declaration collector also descended through a child `QueryRef`. A
  captured parent ref was classified as child-local when the parent builder
  was reused inside that `QueryRef`. A public query failed at include
  construction before its first row comparison. The collector now includes
  only declarations in the queried lexical scope. The primary oracle checks
  the same form at preload and after a source row moves between parents. The
  old collector fails before publication; the repaired collector passes.
- A spread sentinel carried its path but not its binding. Whole-row and
  nested-profile spreads of a captured parent read child data under a shadowed
  alias, and read `undefined` under a renamed child alias. The sentinel now
  carries a `PropRef` with its binding. Eight primary-oracle cells cross row
  and profile spreads, shadowed and renamed aliases, and eager and on-demand
  child sources. They compare parent fields and child ID after preload,
  parent update, and child update. All eight failed on the old lowering at the
  public-row assertion and pass after the repair.
- `queriesMatchForCaching` equated identical `PropRef` paths whose hidden
  binding IDs named different scopes. A focused cache test failed on the old
  comparison and passes after an additional semantic-identity check. A
  function-form query has no stable identity, so the cache comparison now
  conservatively returns false for that valid form instead of throwing.
  Public consequences of the broader rewrite-loss claim still need a witness.
- Single-row and `$selected` proxies returned a nested Proxy for
  `__bindingId`; alias proxies did not report that key through `in` or
  `getOwnPropertyDescriptor`. Focused tests failed on the old traps and pass
  after all three proxy forms return or expose the intended metadata.

## Remaining evidence and boundaries

- Flat alias-keyed compiler metadata can overwrite a same-named source from
  another scope. A public eager-root/on-demand-joined-`QueryRef` witness with
  an inner alias shadowing the root loaded the correct joined row and issued
  a joined-source request. The asserted wrong-target outcome needs a smaller
  failing query or an additional lazy topology. The coverage map already owns
  lazy join loading through merged `aliasRemapping` as an open cell.
- In a no-includes query, a deterministic spy observed four parent-context
  metadata lookups for two rows and two selected refs. This confirms extra
  work. It does not establish a throughput regression or that a guard is
  cheaper than the current property lookup. No performance change was made.
- The claim that a captured parent `orderBy` or `groupBy` reads the child row
  did not reproduce in a public order/limit probe or the existing grouping
  oracle. Several `new PropRef` sites deliberately turn a namespaced ref into
  a single-row ref; a blanket preserve-ID rewrite would be wrong. The cache
  comparison defect above is the demonstrated structural-equality part.
- `removeRedundantFromClause` can collapse an outer `QueryRef` to its inner
  `CollectionRef` while outer refs retain the vanished binding ID. A wrapped
  and direct query returned equal public rows in the tested correlated form,
  but their optimized plans had different identities. Predicate pushdown loss
  and a public row failure remain unproven. A repair must preserve `SourceId`
  and lexical binding roles together, or retain the wrapper.
- `DuplicateAliasInSubqueryError` remains exported for import compatibility
  but has no throw site. Its source documentation marks the changed behavior,
  and a minor changeset records the newly supported nested alias scope.
- `_getCurrentAliases()` has a `unionAll()` output wildcard `*` that
  `_getCurrentBindings()` intentionally lacks. Deriving the alias list only
  from binding-map keys would lose that output namespace.

This follow-up does not close the alias-scope bug class. The direct reused
builder trace is an in-scope counterexample to the approved lexical law.
Broader lazy targets, captured ordering/grouping, optimizer rewrites, and
temporal demand retain the owners and limits recorded in the coverage map.

## Follow-up: ancestor/descendant builder reuse

The API now requires a fresh `new Query().from()` when a source is declared in a
descendant of a query that already uses that source binding. The same builder
may still be placed in sibling include fields. The primary oracle's direct and
`QueryRef` rejection cells were RED at `5bd355a7`: the direct form gave the
misleading missing-correlation error and the `QueryRef` form constructed
silently. Two more cells require the same error through a union branch and a
nested include. The rejection checks source bindings through those placements
before correlation extraction. The former positive
parent/inner `QueryRef` cell now uses a fresh declaration of the same
Collection, preserving its row and source-update assertions. The sibling
reuse cell remains unchanged. This closes the known direct reuse trace under
the stated API rule; the other evidence gaps above remain open.

At `1f588f53f`, the 51-cell alias-shadowing oracle, 268-cell generated scope
oracle, alias validation tests, and production error-message oracle all passed
(346 tests total, no type errors). Lint and whitespace checks passed too.

## Bounded group, identity, and lazy-demand follow-up

This audit starts from PR head `eda70b96cba65be5e843fbd0a73db4f500f719c0`.
The established laws are ARCHITECTURE.md §Identity and laws 1 and 12: a
captured reference keeps its lexical source, explicit projected results are
invariant under legal alias renaming, and an applicable index excludes
irrelevant source rows from physical work. These are consequences of the
approved alias-scope design; the oracle does not introduce a new API rule.

Three bounded cells were added to the existing alias-scope owner:

- **Same-path group keys.** A child shadows `parent` and both have `rank`.
  The independent model counts plain child rows by rank for each parent.
  Four cases cross shadowed/renamed aliases with both group-key orders. The
  public-row comparison runs after preload, a child-rank change, and a
  parent-rank change. Removing the binding-ID comparison from group expression
  equality makes both shadowed cases fail at the first public-row assertion:
  `childRank` reads the parent's value. Renamed controls pass.
- **Optimized identity.** Two pure wrappers differ only in the lexical name
  of their source. A plain Map predicts identical explicitly projected rows
  after preload and after a source change. Their raw identities agree, but the
  old optimizer collapsed a distinct outer binding and left its refs dangling;
  the optimized identities then differed by alias spelling. Restoring that
  collapse makes the new identity assertion fail after the public-row checks.
  The repair retains a user-declared wrapper when its binding differs from the
  inner source. The older optimizer fixture now gives its synthetic internal
  wrappers the same binding ID, so it still proves that safe wrappers collapse.
- **Lazy joined QueryRef.** A finite on-demand user source is joined to an
  anchor, while an include inside that joined QueryRef shadows or renames the
  user's alias. Direct and wrapped include sources cross both names. A plain
  Map predicts public rows, and a separate finite interpreter evaluates each
  provider WHERE over both user IDs. The checks run after preload, an anchor
  move, and a user update. Restoring the child's `aliasToCollectionId` merge
  makes the shadowed direct case ask for `[1, 2]` when the model permits only
  `[1]`, at the first provider-work assertion. A child compilation result
  already owns its aliases, so the repair does not merge child alias or
  remapping records into the enclosing scope. Source-keyed WHERE clauses
  still propagate. The wrapped cases challenge a child remapping as well.

Oracle guide audit for these cells: ORC-001 names the architecture authority
and explicit limits in each opening comment. ORC-002 uses plain Map/count
models, a metamorphic alpha-renaming relation, and a small provider-predicate
interpreter rather than compiler decisions. ORC-003 keeps law, model, bounded
history, public production driver, observation, and checkpoint beside their
code. ORC-004 and ORC-007 do not apply: these are finite enumerations, not new
generated properties; the existing broader scope campaigns remain unchanged.
ORC-005 observes complete selected group values and counts, public wrapper
rows, and both public rows and provider requests for the lazy case. ORC-006 is
demonstrated by the three intended-checkpoint failures above; none is a setup
or timeout failure. ORC-008 applies only to the lazy model's covered-ID set:
the anchor's later move distinguishes an already covered user from a newly
reached user. ORC-009 maps model parent, child, anchor, and user roles to
Collection sources; lexical aliases and binding IDs are production concepts,
not model state. ORC-010 uses `withHistoryCleanup` to retain the primary
failure while releasing the live queries and sources. ORC-011 has no named
shared semantic fault requiring a second formulation; public-row models and
alias-renamed controls also constrain the lazy interpreter. This record and
the updated coverage map provide ORC-012 evidence. ORC-013 is witnessed by
the shadowed/renamed cases and by `[1]` versus an unrestricted `[1, 2]`
request with an applicable index. ORC-014 makes no real-provider claim: the
request witness uses a controlled finite adapter.

At repair commit `d1126e7c4`, all 98 DB query suites pass (4,079 tests),
including the generated scope oracle's fixed and random campaigns. The DB
TypeScript, ESLint, and Prettier checks pass with the worktree's pinned
dependencies linked.
This is bounded evidence, not alias-scope closure. Other aggregate and
ordering expressions, other optimizer rewrites, RIGHT/FULL joins, broader
lazy-target paths, cancellation, and real-provider request handling retain
the owners and limits in the coverage map. The no-includes metadata lookup
count remains an unquantified performance observation; no throughput law or
repair is claimed for it.

## Outer filter ownership and captured projection pushdown

The semantic repair head is `8c34efa2c20de1cc521bb6f0ed643771dbdbe9a3`.
ARCHITECTURE.md §Identity and law 1 supplies both expectations: a filter
belongs to its lexical source, and a captured parent field keeps that binding
through a child QueryRef. The primary alias oracle adds two independent
plain-Map models. One checks parent and child rows through a joined QueryRef or
direct include, with shadowed or renamed child aliases, eager or on-demand
sources, and child IDs equal to or different from the outer filter literal.
The other checks that a projected parent rank controls a child QueryRef after
preload, a child-rank write, and a parent-rank write. Both compare public rows;
the on-demand cases also check which child source rows were admitted.

At the original production head `7486c5360`, six of the ten new cases failed
at the initial public-row comparison: four lost a child whose ID differed
from the outer filter literal, and two evaluated a captured parent rank as
the child's rank. The neighboring child-ID-1 cases passed. The repair converts
each query scope's alias-keyed filter to its SourceId before merging child
compilation results. It also retains a parent-dependent predicate outside a
child QueryRef rather than pushing it into the child source. At the semantic
repair head, all ten new cases, the 268-case generated scope oracle, and the
56-case optimizer oracle pass. The full query runtime suite passes 4,476 tests;
the DB test TypeScript check, targeted lint, and formatting checks pass.

Oracle-guide audit: ORC-001 uses the architecture law and names the finite
scope in each opening comment. ORC-002 uses plain source-role maps rather than
compiler metadata. ORC-003 places the law, model, grammar, public driver,
observations, and checkpoint beside their code. ORC-004 and ORC-007 do not
apply to these finite enumerations; the existing generated scope campaigns
retain their own controls and replay. ORC-005 observes complete selected rows
and, for on-demand sources, admitted source rows after preload. ORC-006 is the
six assertion failures at the intended checkpoint on the original head.
ORC-008 retains parent and child rank because the two legal writes distinguish
their effects; the model has no planner or provider state. ORC-009 maps plain
Map entries to source Collection rows and their selected public result.
ORC-010 uses `withHistoryCleanup` to retain the primary assertion failure
while releasing Collections. ORC-011 uses alias renaming as a second
metamorphic formulation beside the source-role model. ORC-012 is this
exact-head record and the updated coverage map. ORC-013 is distinguished by
child ID 1 versus 2 and by parent rank A beside child rank Z, then the
independent rank writes. ORC-014 makes no real-provider or browser claim: the
on-demand sync adapters are finite controlled fixtures.

These witnesses cover those two predicate paths and checkpoints. They do not
claim that all optimizer rewrites, nested joins, or temporal demand histories
preserve lexical bindings; the alias-scope row in the coverage map retains
those cells.

## Ancestor source declarations inside union and QueryRef sources

CodeRabbit review `5471809088` at `eda70b96c` noted that a parent built from
`unionAll(branchA, branchB)` could reuse `branchA` as an include child without
the fresh-declaration error. The accepted law is ARCHITECTURE.md §Identity and
law 1: one source declaration cannot serve in both an ancestor source tree and
its descendant include. A union's projected fields are visible to callbacks;
its branch source aliases are not. The admission check must still know the
branches' source identities. The same distinction applies to a QueryRef used
as the parent's source.

Two finite oracle witnesses at `3617eacd5` returned a builder instead of
throwing: one reused a parent union branch as an include child, and the other
reused a source inside a parent QueryRef. Each supplied a separate joined
anchor for the required correlation, so a missing-correlation error could not
mask the reuse. The new checker compares the construction result with the
documented fresh-Query error. Both cases were RED before the repair and pass
after source-binding collection walks the parent's FROM and JOIN source tree.
Callback proxies still expose only the union result fields. Existing fresh
declaration and sibling-reuse controls remain legal.
The primary, generated-scope, and route-context suites pass 458 tests; the
full query runtime suite passes 4,785 tests, with DB TypeScript, targeted lint,
and formatting checks green.

This checks those two source placements at construction. The traversal also
handles union-from and joined QueryRef sources; no new public-row or temporal
witness is claimed for them. The broader alias-scope gaps remain in the
coverage map.

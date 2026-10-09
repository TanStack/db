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

With the candidate repairs, all 98 DB query suites pass (4,079 tests),
including the generated scope oracle's fixed and random campaigns. The DB
TypeScript, ESLint, and Prettier checks pass with the worktree's pinned
dependencies linked.
This is bounded evidence, not alias-scope closure. Other aggregate and
ordering expressions, other optimizer rewrites, RIGHT/FULL joins, broader
lazy-target paths, cancellation, and real-provider request handling retain
the owners and limits in the coverage map. The no-includes metadata lookup
count remains an unquantified performance observation; no throughput law or
repair is claimed for it.

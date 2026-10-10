# Issue #2072: ancestor alias shadowing

Reviewed implementation: `fd7aa208a`, based on `origin/main` at
`2ab7f3e5`. This record ships with the implementation it reviews. The
contract owners are `packages/db/src/query/live/ARCHITECTURE.md` §Identity and
law 1, `packages/db/tests/query/includes-oracle.property.test.ts` with its
scope companion, and `packages/db/tests/query/includes-alias-shadowing-oracle.test.ts`.
The independent oracle-enforcement correction below reviews `c0e42b168`.

## Question and rival predictions

Issue #2072 reports that a reusable `q.from({ item: items })` query cannot be
joined beneath another query whose source is also named `item`. The existing
`DuplicateAliasInSubqueryError` was intentional: removing its guard on the
original implementation let alias text select the wrong source. The reporter
also wants to compose helpers without managing a global alias generator.

The proposed law is lexical. A source alias is a name in one query scope. A
reference captured by a callback names the source that supplied it, even if a
nested query later declares the same name. Same-scope source aliases and the
branch aliases of one `unionAll()` remain unique. Structured plans with an
explicit projection are alpha-equivalent when their references are renamed
with their sources. Implicit namespaced rows and functional callback inputs
still expose the user's alias; functional callbacks are alpha-equivalent only
when their behavior is alias-equivariant.

| Design | Prediction for the shadowed correlated child | Prediction for public aliases |
| --- | --- | --- |
| Keep ancestor rejection | Construction throws before publication. | No child row to inspect. |
| Remove the guard and resolve by alias text | A child can read its own row where a captured parent was intended. Operand order can change the wrong result. | Internal alias rewriting can leak into implicit rows or callback input. |
| Bind each reference to its lexical source | The child sees its own row and the captured parent independently. | Implicit rows and callback input retain the declared keys. |

The first design was the established contract. The second was a diagnostic
guard bypass, not a proposed repair. The third is the user-authorized contract
revision tested here.

## Experiment and result

The implementation assigns a binding ID when it creates each `CollectionRef`
or `QueryRef`. Callback-created `PropRef`s retain that ID across helper
placement and optimizer copies. Parent-reference discovery, correlation
extraction, predicate pushdown, compiled parent-context lookup, and query
identity use the binding. Source input lookup continues to use `SourceId`.
Public aliases remain the user's strings.

The role-based model in the exact-output oracle reads only maps of locks and
votes. Direct and implicit-join forms match `vote.lockId` to `lock.id`. The
`QueryRef` and union left branch also match `vote.lockName` to `lock.name`;
the union right branch selects vote 11 by ID and joins it by `lockId`. The
production driver uses `Query` and `createLiveQueryCollection`.
It compares all enumerable key names and user values, including the presence
of virtual keys, plus multiplicity after preload
and after child insertion, parent insertion, a child insertion for that new
parent, a child move, child deletion, and parent deletion. The finite matrix
crosses direct, nested `QueryRef`, union, and implicit joined children with
shadowed or renamed aliases, both equality operand orders, and eager or
on-demand child sources. Focused witnesses cover one helper placed twice,
grandparent capture through a nested include, grouping, functional callback
input, semantic query identity, and a local child equality beside a real
correlation.

The primary scope oracle also runs its fixed-seed and random campaigns with
ancestor shadowing legal. It compares a canonical naming with plain
recomputation, a generated naming with the canonical result, and on-demand
requests by Collection. Its output normalizer deliberately omits virtual
fields, so the new exact-output owner checks public keys separately. The
reported `item`/`item` join and a joined-`QueryRef` multiplicity case are
asserted in `validate-aliases.test.ts`; same-scope and union-branch duplicate
rejection stays there.

| Probe | Observation |
| --- | --- |
| Original implementation | The exact issue form throws `DuplicateAliasInSubqueryError`. With only the guard bypassed, a correlated shadowed child publishes empty arrays with child-first equality; reversing operands can publish parent IDs instead of child IDs. Both are public-row failures. |
| Repaired implementation | The scope campaigns, exact-output cases, original issue form, and affected query suites pass. |
| Lost-binding mutant | Ignoring projected binding lookup survives the direct child: its equality was extracted before evaluation. It fails the nested `QueryRef` case at the **initial public-row comparison** with empty children. This distinguishes path reach from a vacuous green test. |
| False-correlation mutant | Treating an equality between two local child refs as a parent-child correlation fails the local-equality witness at the **initial public-row comparison** with empty children. |
| Alias boundary | The shadowed and renamed explicit projections agree with the role model. Their implicit joined children have the distinct declared keys `lock` and `vote`, as the public shape requires. A functional callback sees the declared `lock` key and a child vote's ID, lock ID, and lock name. |
| Identity boundary | An explicit child projection has the same query identity after consistent `lock`→`vote` renaming. `child.id = child.id` and `child.id = capturedParent.id` have different identities despite identical selected field names. |
| Dropped `QueryRef` inner predicate | Removing only its captured `lockName = parent.name` condition leaves the required outer `lockId = parent.id` correlation legal. Vote 11 then appears incorrectly under lock 1. The check fails at the **initial public-row assertion**. |
| Dropped union left predicate | Removing only its captured name condition leaves the outer `lockId` join and parent filter legal. The nonempty right branch still supplies vote 11; the left now supplies an extra copy. The check fails at the **initial public-row assertion**. |
| Parent-shaped functional input | Replacing the callback's child value with a parent-shaped lock leaves the `lock` key present but makes the child-specific predicate false. The check fails at the **initial public-row assertion** with empty children. |

### Independent review correction

The first exact-output oracle had three enforcement gaps. The `QueryRef`
inner and outer predicates both constrained `lockId`, so deleting the inner
predicate left the same public rows. The union's outer join and parent filter
implied its left predicate, while its right branch was empty. The functional
callback checked only its input key, so a parent row under `lock` looked valid.
These were false-green oracle designs; the review found no new production bug.

The revised finite grammar keeps the outer `lockId` correlation required for
include admission and gives each recursive inner plan an independent captured
`lockName` predicate. Vote 11 matches lock 1 by ID but not by name. The union
right branch contributes vote 11 at initial publication, and a later move
makes both branches contribute it under lock 2. The functional callback reads
child fields, filters vote 11, and records its input values. The three
temporary wrong-query controls above reached the intended public comparison
and failed by assertion, rather than by setup error or timeout.

## Bug-class boundary and remaining work

The demonstrated claim is contract × history × path × observation: lexical
binding preservation for the finite direct, `QueryRef`, union, implicit join,
nested include, and grouped paths above; eager and controlled on-demand
sources; initial publication and the named writes; enumerable public key names,
user values, multiplicity, and query identity. Virtual metadata values are
outside this alias-scope comparison. The primary generated owner extends
the alias/topology and source-write grammar within its stated limits. No
reachable counterexample remains in these exercised cells. Passing the random
campaign is not a universal proof.

The coverage map retains owners and needed witnesses for arbitrary deeper
nested includes, include-inside-subquery forms, `having`, RIGHT/FULL joins,
publication events, unload, ordered windows, lazy join loading through merged
alias remapping, and temporal demand. The controlled on-demand fixture does
not establish a real backend's acquisition schedule. React `useLiveQuery`
receives this builder/compiler behavior, but the exact issue form is asserted
here at the live Collection boundary rather than in a mounted React hook.

## Oracle guide audit

- **ORC-001:** The revised architecture law is the authority. The exact-output
  oracle and coverage map state the bounded claim and open cells.
- **ORC-002:** The role model recomputes from source maps; it does not import
  binding, compiler, optimizer, or output-classifier logic.
- **ORC-003:** Opening prose states the law; adjacent comments explain the
  role model, legal finite grammar, real production driver, public recorder,
  and comparison checkpoints. The primary generated owner names its companion.
- **ORC-004:** Every finite matrix member reconstructs from the four form,
  two alias, two operand-order, and two source-mode axes. Renamed controls
  ablate shadowing; reversing equality distinguishes direction-dependent
  mistakes; the original guard distinguishes admission from execution. IDs
  are 1–3 for parents and 10–15 for children, with one orphan. Initial votes
  include a matching ID with a mismatching name; a later move creates union
  branch overlap. Writes cover new, moved, and deleted rows. Same-scope and
  union-branch repeats are nearby invalid cases. The primary generated grammar
  retains its documented
  three-name pool, bounded rows/writes, fixed and random runs, and replay.
- **ORC-005:** Real live Collections are read at initial and named write
  checkpoints. The recorder retains every enumerable key and duplicate child.
  The callback recorder sees vote 11 before its predicate excludes that row.
- **ORC-006:** Both temporary production mutants above fail at the intended
  public-row assertion. The direct-case survival of the lost-binding mutant
  is recorded, rather than counted as a kill. Three later wrong-query controls
  each fail at initial public-row comparison after the independent review.
- **ORC-007:** The important generated property is the existing scope owner;
  it runs the same grammar and check at fixed seed `1715` and without a seed.
  `TANSTACK_DB_ORACLE_PROPERTY=includes.scoped-alpha-renaming` plus
  `TANSTACK_DB_ORACLE_SEED` and `TANSTACK_DB_ORACLE_PATH` directly replay a
  shrink. The new exact-output matrix is finite and does not claim a generated
  campaign.
- **ORC-008:** The exact-output model retains one row per source ID so a later
  put, move, or delete can distinguish states. It adds no model-only lifecycle
  state. The primary owner is stateless recomputation.
- **ORC-009:** `lock` and `vote` are lexical aliases in production; `locks`
  and `votes` are model source roles. The model's maps are current source rows,
  not `SourceId`s, binding IDs, or D2 relation nodes.
- **ORC-010:** The primary owner preserves an assertion and cleanup failures
  together. The exact-output owner uses `withHistoryCleanup` for the same
  failure fidelity and releases each Collection.
- **ORC-011:** A shared alias bug could make both shadowed and renamed plans
  wrong in the same way. Independent role recomputation is the second
  formulation; exact public-key checks catch an alias rewrite hidden by the
  primary normalizer.
- **ORC-012:** This versioned record documents each applicable obligation and
  the bounded closure claim.
- **ORC-013:** A captured parent and a local child with the same alias are a
  legal witness; the renamed control preserves explicit results, while the
  implicit joined output distinguishes names that are public. Vote 11
  distinguishes the recursive inner predicate from the outer key correlation.
  Same-scope and union duplicates distinguish the adjacent rejection boundary.
- **ORC-014:** The on-demand fixture supplies the `loadSubset` premise. The
  claim is limited to that controlled provider; real adapter scheduling is an
  open receiving boundary in the coverage map.

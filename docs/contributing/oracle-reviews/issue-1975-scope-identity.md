# Issue #1975: alias scope identity

Reviewed head: `18abceee4` (`origin/main`) plus the working-tree repair on
branch `red/issue-1975-materialize-alias`. Owner:
`packages/db/tests/query/includes-oracle.property.test.ts`
(`includes alpha-renaming across sibling scopes`), with grammar, model,
driver, and observation in
`packages/db/tests/query/includes-scope-identity-oracle.ts`. Alias
validation is owned by `packages/db/tests/query/validate-aliases.test.ts`.

## Defect and cause

A live query returned no rows when an include reused an alias from a joined
`from()` subquery that received a pushed-down predicate. The optimizer copied,
wrapped, or collapsed `CollectionRef` objects with `new CollectionRef(...)`,
which mints a fresh `SourceId`. Before #1877 the compiler compiled the user's
original subquery and discarded the optimized copy, so the orphaned IDs were
never read. #1877 compiles the optimized copy when it differs. The compiler
then missed every orphaned `SourceId` and fell back to alias text.
`bindSourceInputs` had written every scope's input under its alias, so the
lookup returned a sibling scope's source with the same name.

## Repair

- `optimizer.ts`: the four copy, wrap, and collapse sites reuse the existing
  `CollectionRef` (lines near 500, 848, 935, and 945).
- `compiler/index.ts` and `compiler/joins.ts`: `bindSourceInputs` maps
  caller-supplied alias keys to `SourceId`s once and no longer publishes
  alias keys; both source lookups read `allInputs[sourceId]` only. A lost
  identity now raises `CollectionInputNotFoundError`.
- `compiler/index.ts` `validateQueryStructure`: no scope inside an include
  can reuse an alias its ancestors can see, including a subquery alias. This
  covers the include itself, its `unionAll()` branches, and its `from()` and
  join subqueries, which can read the parent row through their callbacks.
  The builder previously accepted these namings and returned wrong rows.
  Top-level `from()` subqueries see no ancestor, so they may still reuse names.
- `compiler/index.ts` `validateQueryStructure`: one query cannot give two of
  its sources the same alias. Two joins with one alias were accepted before.
- An include sees its ancestors' from and join aliases, but not the aliases
  inside a parent's `unionAll()` branches. A union row holds the branches'
  projected fields, so those names belong to sibling scopes. An earlier
  revision of this change rejected an include that reused a branch alias, which
  base `18abceee4` accepted with correct rows. The `unionParent` topology now
  guards that legal naming.

## Bug-class boundary

- **Contract:** ARCHITECTURE.md normative law 1 and §Identity: renaming an
  accepted alias cannot change an explicitly projected result, and a plan
  rewrite preserves `SourceId`.
- **Histories:** the owner grammar (three topologies; zero to two joins;
  LEFT or INNER; zero to two predicates in separate or combined form; plain,
  ordered-and-limited, or DISTINCT bodies; include form, source, and filter;
  outer spread or fields; eager or on-demand finite providers; up to four
  source writes).
- **Production path:** `createLiveQueryCollection` through optimizer,
  compiler, and live builder.
- **Observations:** complete public rows after preload and after each write,
  compared with recomputation and across namings; per-Collection
  `loadSubset` WHERE clauses for on-demand sources.

## Evidence

| Check                         | Result                                                                                                                                                                                                                                                                                        |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Original reproduction         | Issue query returns `[]` on `18abceee4`, `[1]` with the repair. Bisected first bad commit: `40a5aea56` (#1877).                                                                                                                                                                               |
| Pinned witnesses              | All 13 behavioral witnesses (issue rows plus six topologies in eager and on-demand modes) fail on `18abceee4` and pass with the repair.                                                                                                                                                       |
| Campaigns                     | Fixed seed `1715` and the random campaign (80 runs each) fail on `18abceee4` and pass with the repair.                                                                                                                                                                                        |
| Optimizer site mutants        | Reverting site 500, 848, 935, or 945 alone fails the owner (4, 13, 13, and 13 tests). The pure-wrapper witness is the only witness that reaches site 500.                                                                                                                                     |
| Identity-only binding         | With it, each optimizer site mutant also fails the existing suite with `CollectionInputNotFoundError` (3, 53, 146, and 59 tests) instead of returning wrong rows. With the optimizer repair in place it is behavior-equivalent; its value is converting a future identity loss into an error. |
| Include shadowing             | Four rejection witnesses (include, nested include, include `unionAll()` branch, include `from()` subquery) fail on `18abceee4` and pass with the repair; a sibling-reuse control passes on both. |
| Generated rejection | One in four scenarios draws any naming; illegal ones must be rejected, and shadowing ones with `DuplicateAliasInSubqueryError`. At a 10x budget this check found the duplicate-join acceptance, and it fails when include `from()` visibility or the same-scope check is reverted. Reverting union-branch visibility is caught only by its pinned `validate-aliases.test.ts` witness, because the include level already checks branch aliases. |
| Union scopes | Reintroducing branch aliases into an include's visible set fails both `unionParent` witnesses and both campaigns at the default budget. A derived branch alias and a same-named union join return the same rows as a renamed join; `validate-aliases.test.ts` pins both legal namings. |
| Model calibration             | Planted model faults (ignore child filter, LEFT as INNER, drop join duplicates) fail only at "canonical naming against recomputation".                                                                                                                                                        |
| Request calibration           | An alias-dependent WHERE routing mutant fails only at "loadSubset requests per Collection".                                                                                                                                                                                                   |
| Ablation                      | Restricting the earlier grammar to all-distinct names made both campaigns pass on the unrepaired code; the failure needs cross-scope reuse.                                                                                                                                                   |
| Enumeration (earlier grammar) | Failures needed a joined subquery with a pushed source predicate and an include reusing the subquery source or join alias. Outer-alias collisions alone never failed.                                                                                                                         |
| Full suite                    | `pnpm --filter @tanstack/db test` passes.                                                                                                                                                                                                                                                     |

## Guide conformance (ORC-001 to ORC-014)

- **ORC-001:** Law, authority, and limits are in the owner's opening comment.
- **ORC-002:** The recomputation model reads plain arrays and never consults
  aliases, plans, or `SourceId`s.
- **ORC-003:** The contract and campaigns are in the owner. The grammar,
  model, driver, and observation are in named sections of the companion.
- **ORC-004:** Reconstruction: every pinned witness is a grammar member.
  Ablation and enumeration are recorded above. Range: IDs 1–4, three parts,
  four refs and notes, and a three-name pool chosen for frequent collisions.
  Exclusion: the legality test rejects shadowing, same-scope reuse, and
  repeated `unionAll()` branch names.
- **ORC-005:** Real live-query Collections are compared at named checkpoints.
  Failure messages carry the checkpoint, the write, and the naming.
- **ORC-006:** Site mutants, a hostile routing mutant, and planted model
  faults are each rejected at the intended checkpoint.
- **ORC-007:** `generatedCampaigns` runs the same property with a fixed seed
  and without one. Replay with `TANSTACK_DB_ORACLE_PROPERTY=includes.scoped-alpha-renaming`
  plus `TANSTACK_DB_ORACLE_SEED` and `TANSTACK_DB_ORACLE_PATH`. The property
  is registered in `oracle-config.ts` and `oracle-replay-manifest.ts`.
- **ORC-008:** Not applicable: the model is a stateless recomputation.
- **ORC-009:** The companion's opening comment maps slots, roles, aliases, and
  `SourceId`.
- **ORC-010:** Cleanup failures join the primary failure in an
  `AggregateError` whose `cause` is the violated law.
- **ORC-011:** Shared-fault hypothesis: every naming of one shape could be
  wrong in the same way. The recomputation model is the second formulation
  that distinguishes it.
- **ORC-012:** This record.
- **ORC-013:** The pinned wrapper witness distinguishes "reuse references
  where the optimizer copies" from "reuse references except during
  collapse".
- **ORC-014:** The on-demand provider is controlled. Its premise is a
  `loadSubset` WHERE clause naming Collection fields. Real-provider
  reception of that premise belongs to the load-subset owners.

## Open in-scope cells

These legal forms are in the bug class but outside the owner's grammar. Probes
during review passed on both revisions, so none is a known counterexample, but
none is protected by this owner:

- nested includes, and includes inside a `from()` subquery;
- join subqueries outside the wrapper topology, and joined subqueries with
  `groupBy` or `having`;
- outer RIGHT and FULL joins;
- publication events, observer timing, and unload under reused names;
- ordered windows and lazy join loading, whose lazy-target lookup reads
  `aliasRemapping`, a map merged by alias across include scopes;
- temporal demand, cancellation, and progressive loading.

The identity-only binding makes a lost `SourceId` raise an error in any of
these forms. That is the current protection against silent wrong rows there.

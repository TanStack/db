# Issue #1898 relation-filter review

## Scope and evidence

Base: `afbeb44eef48d92b6e30ae5fd2843b938ee9163c`. The issue and its
September 25 author comment contain 26 distinct claims, proposals, and open
questions. The executable owner is
`packages/db/tests/query/ordered-work-oracle.property.test.ts`; the ordered
lifecycle and pagination oracles are adjacent owners. This review covers one
direct LEFT join to a Collection with direct root ordering. It does not prove
remote relation filtering or a changed-FK failure. Finite continuation also
requires an order index; without one, the existing full-source fallback can
still apply after an underfilled prefix.

Recent merged work covered adjacent paths: #1893 fixed indexed multi-term
paging, #1903 replaced fragmented lazy join demand after churn, and #1904
defined the custom-collation full-source boundary. None removed the
cross-alias full-source branch exercised here.

Before this change, the new `some`, `none`, joined-only, and to-one work cells
all requested a full root source. The anti-join Effect cell also emitted a
matched root that was absent from the independent result. After the change,
the focused owner passes all 86 tests. A controlled mutant that removes the
joined-demand gate starts three root pages before the child settles where the
oracle permits one; it also publishes an incorrect anti-join window. Restoring
the gate makes those cells pass. A 42-root fixture stops after fewer than ten
requests when the first roots satisfy the joined filter.

## Lossless issue ledger

The IDs follow the issue body (`I`) and author comment (`C`) in source order.
`fixed-now` refers to the accompanying implementation. `deferred` and
`design-decision` remain tracked by [issue #1898](https://github.com/TanStack/db/issues/1898).

| ID | Disposition | Evidence, limit, or next step |
| --- | --- | --- |
| I01 | fixed-now | The original direct LEFT-join query requested an unbounded root snapshot. The oracle now requires a finite first page and checks the independent result. |
| I02 | fixed-now | A controlled unresolved child request plus a disabled-gate mutant proves root pagination can outrun child demand. |
| I03 | deferred | Specify `LoadSubsetOptions.relations`, including the superset rule for adapters that ignore a hint. No hint is emitted in this change. |
| I04 | design-decision | `every(p) = none(not p)` holds for a two-valued predicate and an empty relation. Define nullable expression semantics before making it an adapter law. |
| I05 | deferred | The compiler now permits local finite paging for one direct LEFT join. It does not extract AND conjuncts into remote relation hints or cover joined subqueries. |
| I06 | deferred | Once hints exist, propagate the same hint through initial, refill, repair, and tie requests; test request identity and acquisition release. |
| I07 | fixed-now | Root continuation waits for unsettled lazy demand or a joined subscription load. Settlement and status changes rerun the loader. |
| I08 | fixed-now | A joined-side delete now reruns ordered loading and refills both Collection and Effect windows. |
| I09 | deferred | Include future relation hints in exact demand identity so narrowed and unrestricted acquisitions cannot cover one another. |
| I10 | deferred | The reported honored-hint request and row counts are fixture measurements. Test a real hint-aware adapter after the API exists. |
| I11 | fixed-now | Without a relation hint, local evaluation reaches exact pages from a finite prefix; a 42-root fixture stops early. The author's precise prototype counts are not universal laws. |
| I12 | already-fixed | Eager local Collections already returned the correct result; the oracle retains that control. |
| I13 | deferred | This change proves a `some` child deletion refills the window. Add insert/delete histories for `some`, `none`, and nullable `every` semantics. |
| I14 | fixed-now | The controlled gate mutant overfetches before child settlement. The reported 40 ms and 40-row values are timing-specific observations. |
| I15 | design-decision | Decide whether a future relation hint applies to unlimited queries; this implementation only changes finite windows. |
| I16 | design-decision | The query-wide gate can delay an unrelated include. Measure dependency-specific latency before adding per-join state. |
| I17 | deferred | Joined subqueries and unsupported plans retain full-source fallback. Direct-join `OR`/`NOT` uses the same local prefix law but needs dedicated oracle cells; remote hint extraction must stay conservative. |
| I18 | deferred | Verify cursor and offset coverage when another query has installed root rows and when a backend narrows rows by relation. |
| C01 | fixed-now | A direct to-one PK equality join has the same full-source branch and now pages finitely. A distinct root-FK fixture remains useful. |
| C02 | design-decision | `some(conjunct)` is exact when the conjunct fails on a missing joined row; require a semantic proof and nullable tests before emitting the hint. |
| C03 | design-decision | `none(not conjunct)` for a conjunct that passes on a missing row requires at most one matching child. Multiple matches give a counterexample. |
| C04 | refuted | A sentinel `getKey({id: sentinel}) === sentinel` probe cannot establish uniqueness: a key function can return `tenant:id` for real rows while passing that probe. Use an explicit uniqueness contract. |
| C05 | deferred | The comment reports honored/ignored hints, skip, eager, and live coverage. This change covers local paging, eager control, and some live updates; the full hint matrix remains. |
| C06 | deferred | InstantDB's 30 s and 1.5 s measurements are external observations; no in-repository backend trace verifies them. |
| C07 | design-decision | A filtered prefix of `offset + limit` can cover a cursor window if offset bounds the count of passing rows before the cursor. Prove that premise for each adapter and document the strategy. |
| C08 | confirmed-open | A current-main probe with both children installed and child `loadSubset` returning without writes updated correctly after a root FK change. The exact failing precondition is unknown; a clarification request is posted on the issue. |

Totals: 7 fixed-now, 1 already-fixed, 10 deferred, 6 design-decision,
1 refuted, and 1 confirmed-open; 26 source items accounted for.

## Remaining design work

The largest next step is a safe relation hint. It needs a syntax classifier, a
proof that hints only narrow to a superset of the local result, request plumbing
through tie and repair paths, and exact demand identity. The sentinel key probe
from the comment must not certify to-one joins. A second investigation should
reproduce the changed-FK case under the author's adapter behavior before
altering the lazy-join lifecycle.

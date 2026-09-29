# PR #1924 dotted-path review

## Reviewed state and bounded claim

- Original reviewed PR head: `04d8b8a87583bdf3ea9e8931f20fa9661e7c6a01`.
- Reviewed executable repair head: `8bfc800c873073bb8c06e841e69ec69d153a95a7`.
- Base: `origin/main` at `6e151b0e57d63e2535cdf8e02518690d453214bc`.
- Executable owners: `packages/db/tests/query/index-path-collision-oracle.test.ts` and the focused compiler witness in `packages/db/tests/query/compiler/lazy-targets.test.ts`.

The PR protects complete property-path segments when a dotted scalar property
and a nested property have the same dotted display. Its bounded public oracle
checks numeric AND predicates, selected-field ordering, Collection subscription
callbacks, and live-query callbacks. The compiler witness checks that a union
source's coalesced lazy demand retains both target paths. It does not establish
all path-identity sites, a public on-demand adapter history for the lazy target,
or arbitrary path segments, nullish values, collation, and incremental updates.

The full PR's physical production-source diff against this base is 7 added and
6 deleted lines, net **+1**. The review repair itself changed two production
lines in place, net zero. Tests, this record, the coverage map, package script,
and changeset are excluded from production weight.

## External review ledger

| ID | Raw review claim | Evidence at original head | Disposition and destination |
| --- | --- | --- | --- |
| 1924-01 | `lazy-targets.ts:257` still joins path segments and should use `JSON.stringify(path)`. | The actual file is `query/compiler/lazy-targets.ts`. A same-source `UnionFrom`/`coalesce` witness expected `[['a.b'], ['a', 'b']]` but received only `[['a.b']]`. This is an assertion failure at the compiler target boundary. | **fixed-now** in `224a17c2`; the focused test passes and the coverage map owns the remaining public on-demand witness. |
| 1924-02 | Serialization is duplicated at three sites; extract `serializePath`. | The repetition is real, and the review missed a fourth cache in `createRefProxyWithSelected`. That cache had a separate public failure: a selected-field order sorted by the dotted scalar twice. Reverting its one-line repair made the oracle fail at exact key order. | **deferred** helper extraction. The five one-line `JSON.stringify(path)` uses now span separate proxy, planner, and compiler boundaries. A shared import would add code without changing this behavior. This record preserves the suggestion for a future coordinated encoding change. The missed cache itself was fixed in `224a17c2`. |

The review found one genuine remaining compiler collision and a true but weak
duplication observation. It identified a viable one-line fix for the former,
but cited the wrong directory, supplied no same-path evidence, and missed the
selected-field proxy cache. The reviewer is technically useful on localized
code reading; evidence depth and bug-class reach are limited. Hire
recommendation for independent high-stakes review: **no** on this sample.

## Oracle guide audit at the reviewed executable head

| Requirement | Outcome |
| --- | --- |
| ORC-001 authority and limits | The oracle header cites the public live-query guide's AND filters, selected fields, and computed ordering, plus the live-query architecture's physical-index boundary. Its known omissions and the coverage map bound the claim. |
| ORC-002 independent judgment | The model filters and sorts plain rows with direct JavaScript property reads. It imports no production predicate classifier or index logic. |
| ORC-003 visible responsibilities | The opening contract, model, bounded cases, production drivers, and exact key/order refinements remain in the executable file. The compiler boundary has its own focused witness and named limit. |
| ORC-004 generated grammar controls | Not triggered as a generated property: the oracle enumerates a fixed 3×3 row table and fixed `it.each` cases. These fixtures reconstruct the known dotted/nested collision. The values 0, 10, and 25 straddle the named bounds. No random or legal-history grammar is claimed. If the finite table is read as a generated-property claim, ablation and exclusion evidence remains open. |
| ORC-005 production path and observation | Public direct reads, Collection callbacks, and live-query results compare exact keys or exact order. Each direct indexed case spies on the installed nested BTree index's `lookup` and observes a call after index addition. The lazy-target test directly observes compiler output; it makes no public-row claim. |
| ORC-006 checker calibration | At the original head, the new lazy-target test failed with one target instead of two. After the repair, restoring the old `$selected` cache key temporarily made the public order check fail (`0-25` before `10-0`); this was an assertion failure at the named checkpoint. The original PR's grouped-range and callback proxy RED results are recorded in the coverage map. Temporary reversions were removed. |
| ORC-007 fixed/random campaigns | Not triggered: these are bounded enumerations and a focused compiler test, not important generated properties. |
| ORC-008 model minimality | Not triggered: the reference recomputes from fixed rows and adds no stateful model state. |
| ORC-009 vocabulary mapping | Not triggered: the model's flat and nested field reads are local data descriptions, not combined or split production concepts. |
| ORC-010 failure fidelity and cleanup | Pass. The harness registers each acquired resource and attempts cleanup in reverse order after success or failure. If an assertion and cleanup both fail, `AggregateError.cause` preserves the primary mismatch and `errors` retains cleanup failures. A hostile control proves both diagnostics survive and both releases run. No shrinker or capture process is used. |
| ORC-011 second formulation | Not triggered: this review named no plausible semantic fault shared by production and the direct JavaScript model that a second formulation would separate. |
| ORC-012 review evidence | This versioned record identifies outcomes and limits for ORC-001–011 against executable head `8bfc800c`. The coverage map owns the focused compiler boundary and public adapter omission. |

The bounded claim is: complete property-path identity × the fixed numeric rows
and coalesced target pair × direct query/index, selected proxy, callbacks, and
compiler deduplication × exact public keys/order or exact compiler target paths
at the named checkpoints. The original indexed and callback failures, the
adjacent `$selected` failure, and the compiler target failure are distinguishing
witnesses. A known reachable public on-demand counterexample has not been
established by this review; that history remains an in-scope evidence gap for
the lazy-target coverage owner. The record does not claim global closure of
every path-key use in the query compiler.

## Verification and remaining scope

- Before repair: the compiler target test failed with one target where two were expected. The `$selected` exact-order oracle failed when its cache key was restored to dotted joining.
- After repair: 69 tests passed across the collision oracle, lazy-target unit tests, ref-proxy tests, and union-all tests.
- Changed-file ESLint, Prettier, and `git diff --check` passed.
- Package `tsc --noEmit` reported 41 worktree-wide errors, including db-ivm source files outside the db package's `rootDir`; none named changed files. This run is not a clean typecheck receipt.

The remaining public on-demand adapter witness is assigned to the lazy-target
coverage-map row. No request to extract a shared serializer is part of this
repair.

## Second external review: correlated reference paths

This follow-up checked the later review against PR head `b602188f` before
editing. The review correctly noticed that the earlier repair did not cover two
builder deduplication sites. The architecture's route-context law requires
every distinct parent reference to reach the child query. A property path is a
sequence of segments, so [`a.b`] and [`a`, `b`] cannot share a deduplication
key.

| ID | Review claim | Executable evidence | Disposition and destination |
| --- | --- | --- | --- |
| B1 | The lazy-target collision was fixed with RED/GREEN evidence. | The original reviewed head emitted only one of the two same-source targets. The existing compiler witness now requires both and passes. | **already-fixed** by `224a17c2`; keep the focused compiler owner and its public on-demand limit in the coverage map. |
| B2 | `builder/index.ts:1275` still merges dotted and nested correlated refs. | With line 1336 repaired and line 1275 restored to dotted joining, a nested public include using ancestor aliases [`p.q`, `x`] and [`p`, `q`, `x`] lost the second value (`undefined` versus `22`). | **fixed-now** by segment-safe deduplication at this site. The route-context oracle owns the public witness. |
| B3 | `builder/index.ts:1336` still merges dotted and nested parent refs. | At `b602188f`, a one-level public include returned `nested: undefined` rather than `22`. Changing only this key to `JSON.stringify(ref.path)` made the same assertion pass. | **fixed-now** at this site. The oracle also checks a parent update after initial materialization. |
| B4 | `compiler/index.ts:2241` still merges dotted and nested include result routes. | A public conditional projection with result paths [`a.b`] and [`a`, `b`] returned both child results. A temporary mutant that bypassed `getUniqueIncludesRoutingKey` lost the flat child at the exact public assertion. The same allocator is used for projected source and direct include routes at lines 649 and 676. | **refuted for the stated public path**: this key is a unique internal routing name, and the allocator disambiguates equal dotted spellings. Preserve the public route test and its parent-key/child-insert checkpoints. |
| B5 | A shared `serializePath` helper would close every remaining site. | The two true builder collisions are fixed in place. The compiler's routing names are already unique; its dotted spelling is display text for an allocator, while the builder keys represent path identity. The source also has dotted joins for warning text, not identity. | **deferred** helper extraction in this record. A coordinated path-encoding change can revisit it if further identity sites need the same rule. |
| B6 | The dotted-path bug class was not globally closed. | B2 and B3 were reachable public failures at the reviewed head. Their fixed witnesses cover one-level and nested `toArray` includes, ancestor aliases, initial results, and selected updates. B4 is a passing public route control with a killed wrong allocator. | **fixed-now for the reported live sites, with bounded coverage**. Arbitrary path segments, other recursive source forms, every materialization form, and public on-demand adapter histories remain outside these witnesses in the coverage map. |

The follow-up changes two existing production lines, net zero. Across the full
PR relative to the reviewed `origin/main` base, physical production source is
9 added and 8 deleted lines, net **+1** (one explanatory comment). This does
not meet a net-negative production-code target; removing a useful comment to
change the count would not simplify the implementation. Tests and contract
documentation are reported separately.

At the follow-up worktree, the includes route-context oracle, bounded indexed
path oracle, and lazy-target compiler suite passed together: 114 tests. Changed
production/test ESLint and `git diff --check` passed. The package typecheck
could not resolve `@tanstack/db` in two existing conformance contracts in this
isolated worktree; it named no changed file. The PR's CI is the remaining type
validation gate.

After merging current `main`, the same three suites plus the newly merged
subquery user-value oracle passed together: 134 tests. The oracle campaign
keeps both this PR's indexed-path owner and `main`'s new subquery owner.

The second reviewer found two real public bugs beyond the original local fix
and identified the correct class of collision. The compiler routing claim and
shared-helper prescription overreached: they did not account for the allocator
or distinguish identity keys from display keys. Accuracy is mixed; depth and
signal are stronger than the first review because B2 and B3 were important
omissions. Hire recommendation for independent high-stakes review remains
**no** on this sample without executable same-path checks.

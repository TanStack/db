# PR #1924 dotted-path review

## Reviewed state and bounded claim

- Original reviewed PR head: `04d8b8a87583bdf3ea9e8931f20fa9661e7c6a01`.
- Reviewed executable repair head: `224a17c2d56caf5af421086b33b92f7e9e7ab14e`.
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
| ORC-010 failure fidelity and cleanup | **Open harness gap:** subscription unsubscribe and live-query cleanup remain after assertions, so a mismatch can skip release. The current tests do not preserve secondary cleanup diagnostics. No shrinker or capture process is used. |
| ORC-011 second formulation | Not triggered: this review named no plausible semantic fault shared by production and the direct JavaScript model that a second formulation would separate. |
| ORC-012 review evidence | This versioned record identifies outcomes and limits for ORC-001–011 against executable head `224a17c2`. The coverage map owns the focused compiler boundary and public adapter omission. |

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
- After repair: 68 tests passed across the collision oracle, lazy-target unit tests, ref-proxy tests, and union-all tests.
- Changed-file ESLint, Prettier, and `git diff --check` passed.
- Package `tsc --noEmit` reported 41 worktree-wide errors, including db-ivm source files outside the db package's `rootDir`; none named changed files. This run is not a clean typecheck receipt.

The remaining public on-demand adapter witness is assigned to the lazy-target
coverage-map row. The ORC-010 cleanup gap is assigned to the indexed-predicate
oracle owner. No request to extract a shared serializer is part of this repair.

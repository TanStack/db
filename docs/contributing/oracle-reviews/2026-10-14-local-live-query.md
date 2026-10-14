# Local-only live-query review

Implementation head: `4ec786c7f37c8cb92344292bf405626a4187d069`.
The contract is the opt-in API proposal in the live-query architecture's
“Local-only evaluation” section. This review establishes bounded implementation
evidence, not upstream acceptance of that API.

The independent reviewer found an identity collision between local
`queryKey: ['rows']` and fetching `queryKey: ['rows', 'localOnly']`.
The regression failed before separate mode tracking and passes with it; the
reviewer's reproduction returns different Collections and one fetching load.
The local-subscription status regression likewise rejected `loadingSubset`
after another owner started the source and passes with the restart-listener
fix. The focused re-review reported no remaining blockers or should-fix issues.

## Oracle evidence

The numbered obligations refer to `docs/contributing/oracle-tests.md`.

- ORC-001–003: the oracle states the proposed local-evaluation law, authority,
  driver and limits. Array filter/join/sort/slice computes expected values
  independently of the compiler and subscription machinery. Comparisons preserve
  projected values, duplicates, and order; only Collection virtual fields are
  omitted.
- ORC-004: the grammar documents unique IDs 1–6, ranks 0–3, parent IDs 1–3,
  limits 0–4 and one to five replacements. Duplicate source keys are excluded.
  Empty/nonempty, matching/unmatched, ties, closed/underfilled windows and
  growth/shrink traces are reconstructible. Eager/on-demand changes loading
  semantics; indexed/unindexed changes planning; window/join/include changes
  relational shape. Every trace subscribes, preloads, replaces rows, moves
  windows and restarts the query. Arbitrary interleavings are not claimed.
- ORC-005: real Collection and live-query entry points provide all modeled rows
  before settled window comparisons. Immediate post-subscribe observations check
  readiness and zero source startup. Pinned histories observe incremental
  reorder/delete, provider error, and a pending fetching peer. No missing source
  fact was identified for these local snapshots.
- ORC-006: changing the local source subscription to `localOnly: false` fails
  the source-start assertion, not setup or a timeout. Seed `112919`, path
  `0:0:0:0:0`, shrinks to one empty replacement with limit zero. The mutation
  is restored; the ordinary suite passes.
- ORC-007: all twelve mode/index/shape lanes run fixed seed `112919` and random
  campaigns with the same ten-run budget, scaled by the standard multiplier.
  Direct seed/path replay reproduces the source-start failure under the mutant.
  No `fc.commands` replay path is applicable.
- ORC-008–009: the reference is stateless recomputation over input arrays;
  there is no additional lifecycle model state or renamed subsystem state.
- ORC-010: `withOracleCleanup` preserves the primary failure and cleanup errors;
  the reduced mutant witness retains the source-start assertion.
- ORC-011: no shared semantic fault requiring a second relational formulation was
  identified. Array recomputation is already separate from incremental execution.
- ORC-012: this record ties the verdict and outstanding scope to the exact
  implementation head above. It makes no general bug-class closure claim.
- ORC-013: the adjacent idle/started, empty/populated and zero/nonzero-window
  cases distinguish memory readiness from provider readiness. The fetching-peer
  witness distinguishes local suppression from globally disabling acquisition.
  No broader numerical boundary claim is made.
- ORC-014: controlled adapters establish core behavior only. The Query Collection
  integration separately receives explicit initialization and `writeUpsert`
  ingestion without invoking its fetcher. Remote provider protocols, arbitrary
  nested plans and non-React framework scheduling remain outside this evidence.

Replay the captured generated case from `packages/db`:

```sh
TANSTACK_DB_ORACLE_SEED=112919 TANSTACK_DB_ORACLE_PATH=0:0:0:0:0 TANSTACK_DB_ORACLE_PROPERTY=local-live-query.on-demand.false.window pnpm exec vitest run --coverage.enabled=false tests/local-live-query-oracle.test.ts
```

The restored implementation passes that history. Reapplying the described
subscription mutation rejects it at source startup.

## Validation

The local oracle passes 27 tests, including both generated campaigns. Selected
core regression runs pass 1,450 and 575 tests respectively (overlapping suites).
The final React selection passes 111 tests including type assertions; the
render-cut suite also passed in the earlier 120-test selection. The real Query
Collection ingestion test passes at runtime and typecheck. Core and React
builds, core test typechecking, formatting, and the 405-name mangle check pass.
Package lint has no errors; remaining warnings are in untouched files.

## Upstream standards comparison

Reviewed correction: `c17de4a0544e84d29d5e3d80098ec4b4586a7509`.
The independent reviewer confirmed the fixture repair. All 27 local oracle
tests, core test typechecking, scoped lint and formatting pass.

This correction supersedes the ORC-004 index-planning claim above.
The independent comparison found a fixture reach gap: automatic indexing did
not establish an index on the local window path. An index-presence assertion
failed with the automatic-only fixture. The fixture explicitly creates a rank
index, and the generated campaigns check its presence before subscribing.
Local queries bypass provider order optimization; these lanes establish result
parity with and without an available index, not distinct ordered loader plans.

Merged precedents support the boundaries used here:

- [#2060](https://github.com/TanStack/db/pull/2060) separates source retention
  from acquisition and checks core and React ownership boundaries.
- [#2115](https://github.com/TanStack/db/pull/2115) separates query readiness
  from background source readiness.
- [#2132](https://github.com/TanStack/db/pull/2132) checks that configured oracle
  dimensions actually reach the claimed cases, motivating the index assertion.
- [#2119](https://github.com/TanStack/db/pull/2119) distinguishes product-law
  proposals from defects under accepted contracts. The local-only law remains
  an API proposal; ordinary fetching-query laws are unchanged.

These are merged-code precedents, not maintainer endorsement of this API.

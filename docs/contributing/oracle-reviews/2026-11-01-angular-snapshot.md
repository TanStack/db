# Angular synchronous snapshot evidence

This self-review covers the Angular changes on `angular-fixes`, based on
`95dbf663877cc0040ae8a502d34ee2448391379c`. The branch also includes the
effect-cleanup refactor and breaking Angular 20 minimum. Tested source SHA-256:
`94a4dddccbb3048fee3c0660319951159a530cdb899188b3519b3a467f1e0f70`.
Test SHA-256:
`730c8aa77c20435c7cf7fadff011e027c942bbbf1431e24538e63c02ee93266d`.

- **Law:** synchronous Angular reads describe the current query, including
  before subscription effects run. Rows, keyed state, Collection, status, and
  health must agree. The maintainer authorized this change on 2026-11-01;
  `packages/db/tests/conformance/contract.ts` records its Angular-only cut.
- **Reach:** fixed and random campaigns each ran 36 histories: 16 shared
  regressions plus 20 generated histories. In fixed/random order, initial reads
  and pre-attachment source writes reached 36/36 histories each; direct
  Collections 9/7; findOne 18/17; pooled reads 2/2; enabled replacements 22/26;
  disabled reads 15/16; re-enabling 12/13; settled updates 36/36.
- **RED:** from `packages/angular-db`, run
  `../../node_modules/.bin/vitest --run tests/snapshot-conformance-oracle.test.ts`
  with the adapter from the base commit. Both campaigns fail by row assertion
  before attachment: `data()` is empty while `collection()` contains rows.
  Fixed seed `1101`, shrink path `0:0:0:0` reduces to callback/list/unpooled,
  initial value 0, selections `[0, 0]`.
  Direct replay with `TANSTACK_DB_ORACLE_PROPERTY=angular.current-snapshot`,
  `TANSTACK_DB_ORACLE_SEED=1101`, and `TANSTACK_DB_ORACLE_PATH=0:0:0:0`
  executes only that history and reproduces the row mismatch on the base adapter.
- **GREEN:** the same command passes with the snapshot adapter. The whole
  package passes 97 tests with one existing TODO. `tsc --noEmit -p
  packages/angular-db/tsconfig.json`, changed-file lint, ESLint for changed
  TypeScript, and formatting checks pass.
- **Mutant:** deleting the post-subscribe `invalidate()` preserves the early
  cached value after a source write before attachment. Both campaigns fail the
  row comparison after effect setup; this is an assertion failure after the
  driver's bounded wait, not the test runner's timeout. Seed `1101`, path
  `0:0:2:1:0` reduces to the same two-selection history.
- **Limits:** three synchronous eager fixture rows, finite equality groups,
  one ordered query, no joins/includes, and Angular JIT TestBed. No SSR,
  browser-rendering, asynchronous-provider, or cross-framework synchronous
  claim. Existing shared conformance remains the owner for settled behavior,
  errors, required inputs, and teardown. Pooled view and materialized public
  Collection IDs/health-node identities differ by design; the new oracle
  compares health meaning across them, preserving existing identity checks.

The size comparison against the base commit reports 1023 to 881 gzip bytes
(-142 bytes), and -134 brotli bytes for the Angular package. This is the
reactivity patch's production bundle, excluding dependency bundles and tests.

## Oracle rubric assessment

| Requirement | Evidence or limit |
| --- | --- |
| ORC-001 | Shared contract, maintainer authority, and limits above and beside the oracle. |
| ORC-002 | Fixture-row filtering supplies membership; public Collection observations supply the snapshot-coherence relation. No adapter state or query evaluator computes expected membership. |
| ORC-003 | Opening contract, pure row model, legal histories, real Angular driver, and shared comparison remain distinguishable in the test. |
| ORC-004 | Regressions reconstruct populated swap, disable, empty re-enable, and return. Removing forms, shape, pooling, or the pre-attachment write loses a named path. Groups are 0/1/empty-2/null; initial values are -2 through 2; histories have 2 through 6 selections. Updates after destruction are outside the legal grammar. |
| ORC-005 | Public injectLiveQuery and real environment-injector effects; reads before effects, after attachment, and after mounted writes. Source rows already exist at the synchronous cut. |
| ORC-006 | Original copied-signal adapter and missing-invalidation mutant fail row assertions. |
| ORC-007 | Fixed seed 1101 and unseeded campaigns share options, regressions, grammar, checker, and budget. Shared oracle replay variables select the property and shrink path. |
| ORC-008 | No adapter state machine is mirrored: membership is stateless filtering of fixture rows. |
| ORC-009 | Uses glossary terms. Health meaning explicitly omits identity across pooled view/materialization, not within one query. |
| ORC-010 | ScenarioLifetime preserves primary and cleanup failures and ends the injector before source cleanup. |
| ORC-011 | No named shared semantic fault requiring another formulation; numeric equality on three fixture rows is independent of adapter lifecycle code. |
| ORC-012 | This record describes the tested patch and bounded evidence, not universal correctness. |
| ORC-013 | Populated versus empty/disabled selections and a write between read/attach distinguish stale-data and missed-invalidation designs. |
| ORC-014 | The receiving boundary is Angular's actual JIT scheduler. External-provider and browser claims remain outside scope. |
| ORC-015 | createOracleReach checks all nine declared receiving states; counts above. |
| ORC-016 | Fixed regressions and both campaigns share the same model, driver, and comparison; no separate expected answers. |

## Stability, work, and the separate observer PR

The diagnostic `snapshot-performance.test.ts` instruments real Angular computed
executions and core snapshot reads without replacing snapshot behavior. It
tracks container identities across warmup and measurement phases, so reading an
existing container through another snapshot is not counted as a new allocation.
For 1000 synchronous rows, unchanged reads reuse the same core snapshot, data,
and Map and execute no additional Angular computations. Ten row writes before
reading build one full snapshot; reading after every write builds ten.

This branch includes an intermediate `rowState` computed. Angular's defensive
Map copy follows the observer's row-state reference rather than every full
snapshot. Against the current main-branch observer, metadata snapshots still
supply new row containers, so health reports still rerun row consumers. Keeping
those containers stable belongs to the independent `observer-snapshot-caching`
branch. This PR does not require that change or promise metadata-only identity
that the current core cannot supply. Both branches together were exercised by
the generated Angular metadata receiving checks before the split; those
integration results do not stand in for either branch's standalone evidence.

The defensive copy remains because the public Angular state type is mutable;
this PR does not expose the observer's cached Map as writable state. Scalar
field computations may reevaluate after a notification while unchanged
readiness/Collection consumers and the readiness effect skip execution. These
are finite work counts, not heap bytes, elapsed runtime, or browser rendering.

Validation uses Node 24.8.0 from `.nvmrc` and pnpm 11.1.0 from `package.json`.
The changeset declares a major Angular package change because raising the
minimum supported framework version is breaking. No observer production code,
observer cache changeset, or core metadata-identity requirement belongs to this
branch.

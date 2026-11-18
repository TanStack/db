# Convex cross-adapter receiving review, 2026-11-17

## Frozen test slice and production boundary

Reviewed Git HEAD: `92a1493e0f45dbfd1fc3a51460ccb9228d8f787d`.
This is test-only work on the dirty PR review worktree. No Convex production
source changed. Existing Direct work and shared-owner edits belong to their
respective authors. Runtime: Node `v24.19.0`, installed Convex SDK `1.49.0`,
Vitest `5.1.0`, one worker. There is no runtime shim or Node 26 requirement.

The pre-edit inventory recorded these production hashes before any local test
edit: `src/index.ts` =
`f0e1f520c42024c5aa65f6430d396edef54d528b0fffeb382c5d8ed23e20be02`;
`src/options.ts` =
`8e1989d2d54605f1566c7e5ad867195cb8aa22876f9b2d5016bd992ff8a1ed81`;
`src/subscription.ts` =
`96db535b1f0137214b45fde220c2db2a60d0ed26a4119cb1a6a584a18bdabae5`.
Pre-edit conformance driver =
`08ac6a29dc7c30f4ae32bbd88875633dd99e72390cc35fa17f4607e6c3fe4c0d`.
The snapshot owner was clean before this task; its HEAD/pre-edit hash is
`1876e6d0894c3d4609c5b1d0dd91012ea1a480e7cce73f8b226e5e92eb9040b5`.

## Law and public receiving inventory

Authority is [the public guide](../../collections/convex-collection.md),
particularly Subscribe to a query, Write through Convex mutations, and Errors
and cleanup; the glossary's initial gate, reload, applied receipt and cleanup
contracts; and the existing snapshot/lazy-pagination owners in the coverage map.

| Boundary | Receiving judgment and path |
| --- | --- |
| Eager readiness, distinct delivery errors, recovery and resources | Existing shared eager model/checker; actual JavaScript, React `watchQuery`, and `onUpdate`-only wrapper over installed SDK and controlled WebSocket. Five randomized constructions per path require all four new states. Explicit actual sync entry stamps each query listener's run. |
| Complete replacement and first gate | Shared eager reload model/checker and gate model/checker; all three client paths. Complete empty/nonempty query results, omissions, changed overlap and optimistic settlement. Fresh server failure is tested on preload/reload; recovery starts another run. |
| Initial receipt cleanup | Unchanged shared initial-receipt model/suite from the Direct test package, received through actual Convex SDKs in native Node children. A wrapping receipt is held/applied; cleanup invalidates the source before its rejection. Actual `unhandledRejection` events are compared. |
| Select admission/refusal | Existing primary snapshot owner extended with a complete-result model. Actual SDK input reaches real `select`; first/middle/last throws, initial versus live refusal, legal numeric/string projected keys, coherent public publications, same-run live recovery, initial recovery through reload, listener release and readiness rows. |
| On-demand ownership, receipt settlement and cancellation | Existing Convex lazy-pagination owners remain primary: native receipts, load outcome, abort/replay and failure histories were run. Their distinct prefix/cursor contract is preserved. |
| Mutation acceptance and shared client | Existing ownership, SDK cache and SDK tests were run. Real SDK mutation timestamp barriers and either sibling cleanup preserve the surviving query listener. The offline acceptance owner also ran. |
| Persisted startup | Existing shared controlled/Node-SQLite receivers ran; complete-query replacement and network-first behavior retain their common judgment. Existing OPFS receiving witness is preserved; this task makes no fresh browser execution claim. |

The following Direct policies cannot transfer by renaming the adapter:

- Query scope is not a full-table stream union. Two Convex queries with distinct
  arguments can return disjoint arrays. Neither Collection may acquire the
  other's rows. The Direct shared-client model requires both complete table rows.
- `select` may change key representation. A projection from numeric `1` to
  string `selected:1` is valid. Direct's changed-id refusal would reject it.
- A live disjoint complete result B removes A. Direct's decode model folds B
  onto A. A live Convex select throw is recoverable and retains its listener;
  Direct's parser refusal stops its run. The snapshot owner judges Convex here.
- A cached query error does not fail a new subscription (maintainer decision,
  2026-11-02, preserved in the public guide and coverage owner). Minimal witness:
  peer ready -> query error -> second subscriber, with no new server transition.
  The second subscriber stays loading. Existing eager cached-error histories
  retain that receiving witness. The generic gate's shared entry is not that
  premise, so the new gate registration explicitly chooses fresh/reload.
- Reload can accept a cached valid query result before a later server failure.
  To test a fresh terminal initial gate, the receiver holds new adapter entry
  after old-run retirement. Real QueryRemoved acknowledgment clears the SDK
  cache in that gap. The next QueryFailed is the new run's first result.
- Convex has no Direct stream-incidence/priority mapper API or checkpoint
  confirmation token. It automatically awaits the same client's query
  acceptance after a fulfilled handler. Existing Convex owners judge that law.

## Executed comparison results

All commands ran in `packages/convex-db-collection` and used
`node ../../node_modules/vitest/vitest.mjs run <files> --coverage.enabled=false
--maxWorkers=1`.

| Files | Result | Stable captured log |
| --- | --- | --- |
| Existing eager-live-source and persisted-startup receivers | 748 passed, 156.35 s in the pre-edit inventory run | Captured task tool output; final preserved-campaign rerun in progress below |
| New lifecycle, generic fresh/reload gate, native initial receipt | 294 passed, 68.64 s | `/private/tmp/pr2377-convex-focused-corrected.log` |
| Shared complete reload receiving triple | 309 passed, 20.87 s; sibling lifecycle setup failed before comparison in this first launch | `/private/tmp/pr2377-convex-eager-receiving.log` |
| Snapshot + ownership + SDK/cache + lazy native receipt/load outcome/abort/failure + offline | 245 passed, 16.24 s | `/private/tmp/pr2377-convex-contracts.log` |
| Final lifecycle + complete reload + generic gate + snapshot, after failure-fidelity controls | 683 passed, 64.34 s | `/private/tmp/pr2377-convex-final-receivers.log` |

The exact nine-file neighboring command selected:
`snapshot-oracle.property.test.ts`, `ownership-oracle.property.test.ts`,
`sdk-cache-oracle.test.ts`, `sdk.test.ts`,
`lazy-paging-native-receipt-oracle.property.test.ts`,
`lazy-paging-load-outcome-oracle.property.test.ts`,
`lazy-paging-abort-replay-oracle.property.test.ts`,
`lazy-paging-failure-history-oracle.property.test.ts`, and
`offline-oracle.property.test.ts`, all under `tests/`.

Own `tsc --noEmit -p packages/convex-db-collection/tsconfig.test.json` and scoped
ESLint passed. `pnpm lint:changed`'s script reported a contemporaneous Neon
oracle registration issue outside this slice; the root coordinator was notified.

## Reach and calibration

Every new generated property runs fixed and fresh campaigns with the same
model, production driver, checker and budget. Five lifecycle constructions per
client enforce minimum-five entries for distinct error identities, changed
recovery, unchanged recovery and final resource release. Every construction's
fresh output retains its required-state obligation in the shared campaign map.
Each missing-state control binds its exact construction, and the checker rejects
its omitted observation. Other receiver states use one randomized construction
per state and both named/generated checks, as the shared suites prescribe.

A fixed two-error history binds the wrong-receiver identity calibration; it
reaches the shared HEALTH-1 comparison before any recovery. The shared reload
suite calibrates omitted replacement, wrong row/optimistic cuts and missing
states. The gate suite rejects a falsely fulfilled initial gate. The snapshot
receiver rejects a leaked selected prefix and missing states. It also preserves
a completed raw product observation when later SDK disposal fails: a cleanup
failure alone has its own verdict, while an injected product mismatch plus
secondary cleanup diagnostic retains the product verdict. The initial receipt
suite retains its detached-error and cleanup-diagnostic calibrations unchanged.

These are wrong-observation/receiver calibrations, not a claim that production
was mutated. No production defect was reproduced, so there is no production
repair RED/GREEN or bug-class closure claim.

Generated reach counts (excluding the separately printed guaranteed
constructions) from the final receiving and native receipt runs:

- `adapter.convex.eager-reload.javascript` fixed seed 2367: `{"changed-overlap":17,"empty-result":14,"fresh":21,"fresh-held":14,"no-mutation":34,"omitted-row":22,"persisting-mutation":46,"reload-empty":28,"reload-empty-held":13,"reload-retained":31,"reload-retained-held":19}`
- `adapter.convex.eager-reload.javascript` random seed: `{"changed-overlap":25,"empty-result":18,"fresh":20,"fresh-held":12,"no-mutation":34,"omitted-row":23,"persisting-mutation":46,"reload-empty":23,"reload-empty-held":14,"reload-retained":37,"reload-retained-held":20}`
- `adapter.convex.eager-reload.react` fixed seed 2367: `{"changed-overlap":17,"empty-result":14,"fresh":21,"fresh-held":14,"no-mutation":34,"omitted-row":22,"persisting-mutation":46,"reload-empty":28,"reload-empty-held":13,"reload-retained":31,"reload-retained-held":19}`
- `adapter.convex.eager-reload.react` random seed: `{"changed-overlap":20,"empty-result":17,"fresh":25,"fresh-held":15,"no-mutation":30,"omitted-row":22,"persisting-mutation":50,"reload-empty":22,"reload-empty-held":15,"reload-retained":33,"reload-retained-held":20}`
- `adapter.convex.eager-reload.wrapped` fixed seed 2367: `{"changed-overlap":17,"empty-result":14,"fresh":21,"fresh-held":14,"no-mutation":34,"omitted-row":22,"persisting-mutation":46,"reload-empty":28,"reload-empty-held":13,"reload-retained":31,"reload-retained-held":19}`
- `adapter.convex.eager-reload.wrapped` random seed: `{"changed-overlap":16,"empty-result":16,"fresh":29,"fresh-held":17,"no-mutation":33,"omitted-row":18,"persisting-mutation":47,"reload-empty":23,"reload-empty-held":15,"reload-retained":28,"reload-retained-held":15}`
- `adapter.convex.eager-lifecycle.javascript` fixed seed 2377: `{"delivery-error-identities-retained":26,"delivery-error-recovered-with-row-change":28,"delivery-error-recovered-without-row-change":26,"sync-run-resources-released":40}`
- `adapter.convex.eager-lifecycle.javascript` random seed: `{"delivery-error-identities-retained":21,"delivery-error-recovered-with-row-change":21,"delivery-error-recovered-without-row-change":20,"sync-run-resources-released":40}`
- `adapter.convex.eager-lifecycle.react` fixed seed 2377: `{"delivery-error-identities-retained":26,"delivery-error-recovered-with-row-change":28,"delivery-error-recovered-without-row-change":26,"sync-run-resources-released":40}`
- `adapter.convex.eager-lifecycle.react` random seed: `{"delivery-error-identities-retained":19,"delivery-error-recovered-with-row-change":17,"delivery-error-recovered-without-row-change":18,"sync-run-resources-released":40}`
- `adapter.convex.eager-lifecycle.wrapped` fixed seed 2377: `{"delivery-error-identities-retained":25,"delivery-error-recovered-with-row-change":27,"delivery-error-recovered-without-row-change":25,"sync-run-resources-released":40}`
- `adapter.convex.eager-lifecycle.wrapped` random seed: `{"delivery-error-identities-retained":29,"delivery-error-recovered-with-row-change":28,"delivery-error-recovered-without-row-change":30,"sync-run-resources-released":40}`
- `convex.snapshot` fixed seed 20261022: `{"duplicate-rejected":150,"empty-result":150,"equal-looking-typed-keys":150,"initial-duplicate-rejected":150,"initial-valid":150,"mixed-key-types":150,"numeric-keys":150,"omitted-field":150,"omitted-key":150,"reintroduced-key":150,"selected-key-representation":150,"string-keys":150,"valid-after-error":150}`
- `convex.snapshot` random seed: `{"duplicate-rejected":150,"empty-result":150,"equal-looking-typed-keys":150,"initial-duplicate-rejected":150,"initial-valid":150,"mixed-key-types":150,"numeric-keys":150,"omitted-field":150,"omitted-key":150,"reintroduced-key":150,"selected-key-representation":150,"string-keys":150,"valid-after-error":150}`
- `convex.snapshot-projection.javascript` fixed seed 2377: `{"initial-refused":10,"initial-valid":11,"live-refused":12,"live-valid":7,"new-run-valid-after-refusal":10,"numeric-selected-key":19,"refusal-first":8,"refusal-last":12,"refusal-middle":8,"same-run-valid-after-refusal":12,"string-selected-key":21}`
- `convex.snapshot-projection.javascript` random seed: `{"initial-refused":9,"initial-valid":10,"live-refused":10,"live-valid":11,"new-run-valid-after-refusal":9,"numeric-selected-key":20,"refusal-first":8,"refusal-last":12,"refusal-middle":3,"same-run-valid-after-refusal":10,"string-selected-key":20}`
- `convex.snapshot-projection.react` fixed seed 2377: `{"initial-refused":10,"initial-valid":11,"live-refused":12,"live-valid":7,"new-run-valid-after-refusal":10,"numeric-selected-key":19,"refusal-first":8,"refusal-last":12,"refusal-middle":8,"same-run-valid-after-refusal":12,"string-selected-key":21}`
- `convex.snapshot-projection.react` random seed: `{"initial-refused":15,"initial-valid":6,"live-refused":9,"live-valid":10,"new-run-valid-after-refusal":15,"numeric-selected-key":23,"refusal-first":13,"refusal-last":7,"refusal-middle":8,"same-run-valid-after-refusal":9,"string-selected-key":17}`
- `convex.snapshot-projection.wrapped` fixed seed 2377: `{"initial-refused":10,"initial-valid":11,"live-refused":12,"live-valid":7,"new-run-valid-after-refusal":10,"numeric-selected-key":19,"refusal-first":8,"refusal-last":12,"refusal-middle":8,"same-run-valid-after-refusal":12,"string-selected-key":21}`
- `convex.snapshot-projection.wrapped` random seed: `{"initial-refused":18,"initial-valid":10,"live-refused":7,"live-valid":5,"new-run-valid-after-refusal":18,"numeric-selected-key":22,"refusal-first":11,"refusal-last":15,"refusal-middle":5,"same-run-valid-after-refusal":7,"string-selected-key":18}`
- `adapter.convex.eager-gate.javascript` fixed seed 2377: `{"javascript:fresh":12,"javascript:fresh:recovery":4,"javascript:reload":18,"javascript:reload:recovery":11}`
- `adapter.convex.eager-gate.javascript` random seed: `{"javascript:fresh":21,"javascript:fresh:recovery":12,"javascript:reload":9,"javascript:reload:recovery":5}`
- `adapter.convex.eager-gate.react` fixed seed 2377: `{"react:fresh":12,"react:fresh:recovery":4,"react:reload":18,"react:reload:recovery":11}`
- `adapter.convex.eager-gate.react` random seed: `{"react:fresh":11,"react:fresh:recovery":5,"react:reload":19,"react:reload:recovery":10}`
- `adapter.convex.eager-gate.wrapped` fixed seed 2377: `{"wrapped:fresh":12,"wrapped:fresh:recovery":4,"wrapped:reload":18,"wrapped:reload:recovery":11}`
- `adapter.convex.eager-gate.wrapped` random seed: `{"wrapped:fresh":16,"wrapped:fresh:recovery":4,"wrapped:reload":14,"wrapped:reload:recovery":10}`
- `adapter.convex.initial-receipt.javascript` fixed seed 2377: `{"after-application":6,"empty-source":4,"held-receipt":6,"nonempty-source":8}`
- `adapter.convex.initial-receipt.javascript` random seed: `{"after-application":7,"empty-source":2,"held-receipt":5,"nonempty-source":10}`
- `adapter.convex.initial-receipt.react` fixed seed 2377: `{"after-application":6,"empty-source":4,"held-receipt":6,"nonempty-source":8}`
- `adapter.convex.initial-receipt.react` random seed: `{"after-application":6,"empty-source":3,"held-receipt":6,"nonempty-source":9}`
- `adapter.convex.initial-receipt.wrapped` fixed seed 2377: `{"after-application":6,"empty-source":4,"held-receipt":6,"nonempty-source":8}`
- `adapter.convex.initial-receipt.wrapped` random seed: `{"after-application":3,"empty-source":6,"held-receipt":9,"nonempty-source":6}`

## Classification and limits

The failed development launches were not production RED evidence. Unknown
property registration, a constructed history without required typed fields,
undeclared reach observations, a Node worker resolved through jsdom's URL,
and virtual Collection metadata included in an application-row comparison were
setup/recorder defects. They were corrected without changing production or an
accepted product expectation. The cached-valid reload result described above
was a missing initial-gate premise and required a receiving schedule correction.

ORC-001/002/003: named authorities, independent complete-result reference and
literate receiving boundaries. ORC-004: bounded first/middle/last refusal,
initial/live outcomes, selected key representation and disjoint complete results;
illegal refusal indices are normalized into the generated legal domain.
ORC-005: installed SDK, actual callbacks and public row/status/health/resource
cuts. ORC-006: named wrong-observation controls rejected. ORC-007: fixed/fresh
campaign parity and shared direct replay routes. ORC-008/009: no new production
state machine; authored coordinates and phases map explicitly to query results,
initial gates and sync runs. ORC-010: raw observations retain secondary cleanup
diagnostics and native workers separate setup failure from oracle verdict.
ORC-011: no named shared semantic fault calls for a second formulation.
ORC-012: this exact-head record supplements the executable owners; independent
review is pending. ORC-013: changed/unchanged recovery and adjacent refusal
positions distinguish the wrong rules. ORC-014: the actual SDK receives the
controlled protocol premise, but no deployed-backend or fresh browser claim is
made. ORC-015: constructed reach, bound missing-state controls and counts above.
ORC-016: new registrations use oracleProperty/shared oracle suites; no added unit
examples in oracle files. Existing budgets and receiving witnesses are preserved.

The evidence does not establish arbitrary cloud reconnect/auth failures,
unscheduled browser timing, arbitrary cursor grammars, concurrent mutations,
Direct stream policies or cross-adapter semantic equivalence. The existing
backend/OPFS owners retain their separate receiving scope. There is no known
reachable Convex production counterexample from these runs.

## Frozen author slice

The following SHA-256 values identify the test slice sent for independent
review. Production hashes above remain unchanged.

```json
{
  "packages/convex-db-collection/package.json": "191957a5eaf41044fdadad4db8f00cd0f26374b5105f9106cb91a487db5cb11f",
  "packages/convex-db-collection/tests/conformance-driver.ts": "901d5a8a15c8c93218ad9d40490d420d279d3d3ba906bad6814be355d8f00d7d",
  "packages/convex-db-collection/tests/eager-lifecycle-receiving-oracle.property.test.ts": "3d19c7d7603873ac3e9844bd6a97c66c0ac25147dff7bc76726ecc7b966e6461",
  "packages/convex-db-collection/tests/eager-reload-driver.ts": "9e89aa7c0b8d7944fc196edd7199a8182eebd37d1fc52451fcc9c2e1fecbd0bb",
  "packages/convex-db-collection/tests/eager-reload-conformance-oracle.property.test.ts": "1e60f8ec34bd1837bd476b64bca6d2577589dc43be4cf5c7eaad2dc143327899",
  "packages/convex-db-collection/tests/eager-gate-conformance-oracle.property.test.ts": "9cf010e11348f686ecb0a78d2205fe1cfcd2c4860e00e20720447a2c3280cd4d",
  "packages/convex-db-collection/tests/initial-receipt-driver.ts": "d2aa89b761ac64dc43051070a224e9acaad0d78299b8be24b85429db7e37b505",
  "packages/convex-db-collection/tests/initial-receipt-worker.ts": "3f6e6098f463f646769a886ca146022062d2242ae07cc821ad8ea82d1478a036",
  "packages/convex-db-collection/tests/initial-receipt-conformance-oracle.property.test.ts": "2477371d03a4e4e9b77a4e6b4316784875da8fa863d19b63aa7561f5dc35baa2",
  "packages/convex-db-collection/tests/snapshot-oracle.property.test.ts": "4748f0140eb269c6375224e4431ea421d3203102ed656dc0677ea01852188a41"
}
```


## Independent review amendment, 2026-11-17

The initial frozen slice above received independent enforcement review from
`oracle_diff_enforcement` and law/observation review from `oracle_diff_laws`.
They identified four test gaps, all repaired without a production change:

1. Initially refused selection recovered through reload, but its readiness
   callback rows were not compared. Every history now checks its first ready
   callback, including recovery. A bound missing-readiness control rejects this
   precise omission under `selected complete result`.
2. The projection receiver assigned its completed raw result after in-body
   cleanup. It now captures all product cuts before teardown and records final
   releases in a `finally` block. Two actual receiver-driver controls inject a
   cleanup failure after real cleanup, alone and with a leaked publication.
   The first reports `receiving cleanup`; the second preserves the primary
   `selected complete result` violation and secondary cleanup diagnostics.
3. The native receipt launcher discarded completed output on a later nonzero
   exit. It now parses the observation first and appends the exit diagnostic.
   Shared bound controls run the actual worker, write its result, then exit 1;
   the mismatch variant also records a detached rejection. The shared judgment
   preserves the product mismatch ahead of the exit diagnostic.
4. Mapping observed rows to only `id` and `value` hid extra application fields.
   The recorder now removes only the four reserved Collection virtual fields.
   A bound adapter-write control adds a field omitted by `select` at the real
   sync boundary and is rejected at `first complete result` on every SDK path.

These repairs preserve the law and generated history domains. They improve
ORC-005 observation fidelity and ORC-010 failure fidelity. No production RED or
production bug-class closure is claimed. The wrong adapter-write and receiver
controls fail at the named shared comparison, rather than through setup or
process failure.

After these amendments, from `packages/convex-db-collection`:

```sh
node ../../node_modules/vitest/vitest.mjs run tests/snapshot-oracle.property.test.ts tests/initial-receipt-conformance-oracle.property.test.ts --coverage.enabled=false --maxWorkers=1
```

Result: **266 passed**, **92.23 s**, including all three SDK paths and the
new actual fault controls. Strict package TypeScript passed. The variable-only
TypeScript correction to the extra-field control preserves that executed
runtime behavior. Scoped ESLint and branch lint feedback are recorded by their
separate diagnostics below.

The final preserved eager-live-source plus persisted-startup run also finished:
**748 passed**, **158.23 s**, with the current explicit run-stamped listener
recorder. This supersedes the earlier in-progress note without changing its
pre-edit evidence.

Five guarded direct replays each recorded exactly one nonzero successful
execution with path `0`, unit `random seed: generated`, and a clean process exit:

| Property | Campaign seed |
| --- | --- |
| `adapter.convex.eager-lifecycle.javascript` | 2377 |
| `adapter.convex.eager-reload.javascript` | 2367 |
| `adapter.convex.eager-gate.javascript` | 2377 |
| `convex.snapshot-projection.javascript` | 2377 |
| `adapter.convex.initial-receipt.javascript` | 2377 |

Each command uses the same form, substituting the property, seed and file:

```sh
TANSTACK_DB_ORACLE_PROPERTY=convex.snapshot-projection.javascript TANSTACK_DB_ORACLE_SEED=2377 TANSTACK_DB_ORACLE_PATH=0 TANSTACK_DB_ORACLE_UNIT='random seed: generated' node --import tsx ../db/tests/oracle-replay.ts tests/snapshot-oracle.property.test.ts --coverage.enabled=false --maxWorkers=1
```

These replays establish the common registration routes. They do not claim a
fresh replay of each client-specific property or reproduce a product defect.

### Amended frozen fingerprints

The earlier map remains the original reviewed slice. The following map is the
amended slice sent for independent rereview; all ten owned files are included.

```json
{
  "packages/convex-db-collection/package.json": "191957a5eaf41044fdadad4db8f00cd0f26374b5105f9106cb91a487db5cb11f",
  "packages/convex-db-collection/tests/conformance-driver.ts": "901d5a8a15c8c93218ad9d40490d420d279d3d3ba906bad6814be355d8f00d7d",
  "packages/convex-db-collection/tests/eager-lifecycle-receiving-oracle.property.test.ts": "3d19c7d7603873ac3e9844bd6a97c66c0ac25147dff7bc76726ecc7b966e6461",
  "packages/convex-db-collection/tests/eager-reload-driver.ts": "9e89aa7c0b8d7944fc196edd7199a8182eebd37d1fc52451fcc9c2e1fecbd0bb",
  "packages/convex-db-collection/tests/eager-reload-conformance-oracle.property.test.ts": "1e60f8ec34bd1837bd476b64bca6d2577589dc43be4cf5c7eaad2dc143327899",
  "packages/convex-db-collection/tests/eager-gate-conformance-oracle.property.test.ts": "9cf010e11348f686ecb0a78d2205fe1cfcd2c4860e00e20720447a2c3280cd4d",
  "packages/convex-db-collection/tests/initial-receipt-driver.ts": "c203133840551b75221f68de7562ad8775ced0f26c86e95c203d0570a466cbe4",
  "packages/convex-db-collection/tests/initial-receipt-worker.ts": "0838b84009667a824d350945762499acf4960b1abccd476d6a91615045e0b064",
  "packages/convex-db-collection/tests/initial-receipt-conformance-oracle.property.test.ts": "d6309afe1256024c493bf5d071ab679b9baf41a94d7b832a8df858e56ad8522f",
  "packages/convex-db-collection/tests/snapshot-oracle.property.test.ts": "a92ce38add10d2399c742fded6f2b768bdec7d247e758e344d70c759dec0fa74"
}
```

The amended shared receipt suite/model and captured execution logs have these
SHA-256 values:

```json
{
  "packages/powersync-direct-collection/tests/initial-receipt-oracle-suite.ts": "8235a59f906073dea22f6f66f679353bb5c7cda9a88d849ab9d713fc2afc20f3",
  "packages/powersync-direct-collection/tests/initial-receipt-oracle.ts": "c75895abae5fe1e8485b8bcae83e25681cfddcce8f8883ba3b1b281cec79b4c1",
  "/private/tmp/pr2377-convex-preserved-campaigns.log": "d8ecec0c93c142d4a924952b6edd5480ac9a3b0a2ec73b00a7a853d7e8c6bb17",
  "/private/tmp/pr2377-convex-amended-fidelity.log": "68c9dc224f1f0e62b343d0c076c839796c3f0c878ba8391927cce099942003ca",
  "/private/tmp/pr2377-adapter.convex.eager-lifecycle.javascript-replay.log": "e58163da70af76340e7556b0628e3e7a43a6b4e5f2c68f5aec36d101f737658f",
  "/private/tmp/pr2377-adapter.convex.eager-reload.javascript-replay.log": "a98d2a08a66032138d051b290d1ddc621583a236a344760199ad9330960a4bf5",
  "/private/tmp/pr2377-adapter.convex.eager-gate.javascript-replay.log": "89f02b52a0bde490c55edb13fa07b76fd690dae688c5d3b49e0cc7472cc96e38",
  "/private/tmp/pr2377-convex.snapshot-projection.javascript-replay.log": "6741d7febcae832a16aa29af66c8a9e36cb65f1f3c0de39ac330eb92faa9454a",
  "/private/tmp/pr2377-adapter.convex.initial-receipt.javascript-replay.log": "2d5572d59d2552842cfaeaef5e424d99702ff8c75763411ff887a23419993dc8"
}
```

Final exact-source projection rerun: **176 passed**, **9.06 s**. Strict package TypeScript, scoped ESLint, and the final branch lint feedback script each returned no diagnostics. Their log fingerprints are:

```json
{
  "/private/tmp/pr2377-convex-amended-types.log": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "/private/tmp/pr2377-convex-amended-lint.log": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "/private/tmp/pr2377-convex-final-lint-changed.log": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "/private/tmp/pr2377-convex-final-projection-exact.log": "01f2f11ed2cc822f111093c1727a07fd5157152e0652ac0f52ff7cc437d82401"
}
```


### Independent enforcement rereview verdict

`oracle_diff_enforcement` approved amended slice digest
`a9252b67dff7acc5ac2c598c245b9c6b7982f8b82f97cfccdadeafeef6ad7fc2`.
The reviewer independently verified all ten source hashes, the shared receipt
suite/model and eight execution-log hashes. It independently executed **18 of
18** actual extra-field, recovered-readiness, late-projection-cleanup and
post-record worker-exit controls across JavaScript, React and wrapped SDK paths
(248 unrelated test units skipped). It confirmed completed product violations
survive teardown and nonzero exit. No enforcement finding remains within this
reviewed scope. The verdict makes no product-defect or portfolio-closure claim.

### Independent law and receiving-path rereview verdict

`oracle_diff_laws` approved the ten amended source hashes above after tracing
the laws to the public Convex collection guide and the existing snapshot owner.
The selected complete-result rule, initial terminal refusal, live recoverable
refusal, cached-error exclusion and native receipt scope remain suitable at their
declared boundaries. The installed JavaScript, React and wrapped SDK paths
receive actual controlled protocol transitions; the receipt wrapper makes no
durability claim.

The review found that recording only `id` and `value` concealed leaked source
fields. The amendment preserves all application fields and rejects an actual
sync-write mutant that adds a field omitted by `select`. The reviewer verified
every amended source hash, inspected recovered readiness and cleanup/exit
priority, then independently ran the following command on Node **24.19.0**:

```sh
node ../../node_modules/vitest/vitest.mjs run tests/snapshot-oracle.property.test.ts tests/initial-receipt-conformance-oracle.property.test.ts --coverage.enabled=false --maxWorkers=1 -t 'adapter leaks a field omitted by select|initial refusal recovery requires rows inside readiness|actual projection teardown|actual post-record worker failure'
```

Result: **18 passed**, **248 skipped**, **3.96 s**, no type errors. This runs
the amended field-leak, recovered-readiness, actual teardown and native late-exit
controls on all three SDK paths. No supported law, receiving-path or observation
finding remains in this slice. The existing backend and OPFS owners retain their
separate scope; this verdict does not establish arbitrary cloud failures,
browser scheduling or blanket adapter-portfolio closure.

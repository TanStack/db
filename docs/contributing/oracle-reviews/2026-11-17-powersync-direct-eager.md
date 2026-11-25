# PowerSync direct eager oracle review

This record binds the test-only eager oracle extension for
[PR #2377](https://github.com/TanStack/db/pull/2377) to production head
`92a1493e0f45dbfd1fc3a51460ccb9228d8f787d` and the six-file snapshot below.
Production was unchanged throughout the inventory, extension, RED runs, and
independent test-instrument review. The production `src/index.ts` SHA-256 was
`4cafcd3e53977c30511a85e1482be2e0bda2ad75ab0788d1d49e71a8db78761f`.

**Verdict: approved for the test-instrument production-repair gate.** This is
not recovery closure or approval of the adapter's complete oracle portfolio.
The original recovery counterexample remains RED. Successful recovery reach
and all missing-state calibrations on a clean baseline remain required after
the production repair.

## Law and pre-edit receiving inventory

The primary owner is
[`eager-live-source-oracle.ts`](../../../packages/db-adapter-conformance/src/eager-live-source-oracle.ts),
under the [coverage map's](../oracle-coverage.md) “Adapter conformance: eager
live sources (#2118)” entry. Its authority is the Collection sync callback
contract in `packages/db/src/types.ts`, the
[glossary's status and health terms](../glossary.md), and the adapter law set
version 18. The direct receiver is new in this PR.

- **HEALTH-1/2:** a recoverable current-result error joins the public failure
  reason. Each distinct still-open reported error remains, oldest first, and
  the public problem's cause is its newest still-open failure. A valid complete
  delivery clears the recovered source's failures, including when no row
  changed. Status and published rows remain usable.
- **RETRY-1:** the existing `matchesFailure` retry policy may omit later
  attempts of an already reported outage. This freedom does not permit
  dropping a different delivery error.
- **LIFE-2/10:** each provider resource acquired by an ended sync run is
  released exactly once. The stream lease, table listener, and status listener
  are independent resources; counting leases alone cannot establish listener
  cleanup.
- Existing READY, PUB, and FID laws, the Map/phase model, JSON value domain,
  and normal campaign budget remain in force.

This inventory was recorded before the eager edits:

| Receiving path | Controlled premise | Observation cut and owed result |
| --- | --- | --- |
| Direct eager Collection, real `@powersync/standalone-client` 0.1.1 | Valid NDJSON checkpoints on one open fetch response, including resolved-stream errors followed by a healthy checkpoint | After SDK protocol consumption and propagation: public rows, status, error identities, and every publication; changed-row and unchanged-row recovery, with one or several open errors |
| Same SDK receiver at initial failure, cleanup, and restart | Actual SDK allocation/removal calls are recorded without replacing their behavior | Failed-run, retired-run, and final-cleanup cuts: every table listener, status listener, and lease released once; active resources unreleased |
| Existing reference eager receiver | Existing controlled push source and full generated grammar | Existing shared judgment and declared states remain valid |
| Existing Convex eager receiver | Existing controlled raw query subscription | Existing delivery-error and retry judgment remains valid |

The original package suite had 170 passing tests on Node 26. An SDK probe
supplied an error and then a healthy checkpoint on one response
(`requests === 1`); `waitForSync()` recovered. The adapter-level observation
retained the earlier public stream error. The former direct driver excluded
`delivery-error` on the incorrect premise that this recovery required a new
connection.

## Instrument and bounded grammar

The receiver enables the existing shared `delivery-error` action. It delivers
an error-bearing completed checkpoint, then can deliver a healthy checkpoint
on the same SDK response. The driver uses the real adapter configuration,
Collection, and SDK. Its fake service controls protocol premises.

The shared checker distinguishes mandatory delivery-error identities from
optional later retry reports. Its resource ledger records actual matching
release invocations, including duplicate calls. It judges ended-run resources
at the existing comparison cuts and all resources at final cleanup.

Five randomized constructions preserve the original reach obligations and
include two distinct delivery errors before changed-row recovery, plus an
error before unchanged-row recovery. Their order varies with the construction
salt. The constructions use the former four suffix slots; the independent
random campaign retains the full shared language. Each builder returns a fresh
array. The normal budget remains **400 generated histories in each fixed/fresh
campaign**, with seed **2118** and a **twelve-element** grammar. An outage can
be one grammar element containing several attempts, so element count differs
from expanded step count.

Keys range over 1–5, titles over three values, complete deliveries over zero to
four rows, and live batches over zero to three changes. Optional notes can be
added or removed. All seven JSON value kinds remain. Delivery errors are
accepted only after readiness in an active connected run; a pre-ready
`delivery-error` action is skipped by the model. Later complete snapshots are
also skipped because this receiver does not declare `complete-snapshot`.

The added observation states are:

- `delivery-error-identities-retained`
- `delivery-error-recovered-with-row-change`
- `delivery-error-recovered-without-row-change`
- `sync-run-resources-released`

The checker emits them from observed public health/rows or actual resource
records, and only for receivers that explicitly declare them. Five builders
provide minimum-five machinery. The existing per-builder missing-state
controls extend to these declarations and to fresh generated constructions.
They still need a complete clean-baseline execution after production repair.
The current RED prevents completed construction reach counts; no successful
recovery reach count is claimed here.

## RED and direct replay

The commands were run from `packages/powersync-direct-collection`, using:

```sh
NODE26=/Users/kyle.mathews/.npm/_npx/bac97da9607b7ef2/node_modules/node/bin/node
"$NODE26" ../../node_modules/vitest/vitest.mjs run \
  tests/eager-live-source-conformance-oracle.property.test.ts \
  --coverage.enabled=false --testNamePattern fixed --reporter verbose
```

Result: **6 failed, 180 skipped, no type errors**, 8.59 s. All five constructed
units and the generated unit fail the shared HEALTH-2 comparison. A shrunk
construction is:

```json
[
  { "kind": "snapshot", "rows": [] },
  { "kind": "delivery-error" },
  { "kind": "changes", "changes": [] },
  { "kind": "snapshot", "rows": [] }
]
```

At **step 2**, expected `failureReason.errors` is empty. Actual failure causes
still contain `PowerSync stream "rows" failed: conformance delivery error 0`.
The final snapshot is skipped after readiness. The healthy empty changes
checkpoint is the distinguishing observation: “clear only after a row change”
is also wrong under this law.

The exact replay was executed again after the independent-review correction:

```sh
TANSTACK_DB_ORACLE_SEED=2118 \
TANSTACK_DB_ORACLE_PATH=0:2:1:5:4:6:6:6:4 \
TANSTACK_DB_ORACLE_PROPERTY=adapter-conformance.eager-live-source.powersync-direct \
TANSTACK_DB_ORACLE_UNIT='random seed: all eager states, randomized construction 1' \
"$NODE26" ../../node_modules/vitest/vitest.mjs run \
  tests/eager-live-source-conformance-oracle.property.test.ts \
  --coverage.enabled=false \
  --testNamePattern 'random seed: all eager states, randomized construction 1'
```

Result: **1 failed, 188 skipped, no type errors**, 731 ms, at the same
**HEALTH-2, step 2** comparison. The initial generated unit used seed 2118,
path `1:0`, and failed at step 4 of its legal constructed history. These are
semantic comparison failures, not setup failures or timeouts.

## Calibration and neighboring results

The fixed history `snapshot [] -> delivery-error -> delivery-error` uses the
same model, SDK driver, and comparison as the campaign. A bound wrong-receiver
calibration changes the public health observation to retain only the first
error. The shared comparison rejects it under HEALTH-1; retry-report freedom
cannot make this wrong answer pass.

```sh
"$NODE26" ../../node_modules/vitest/vitest.mjs run \
  tests/eager-live-source-conformance-oracle.property.test.ts \
  --coverage.enabled=false \
  --testNamePattern 'two distinct delivery errors remain open|a receiver drops a later delivery-error identity'
```

Final result: **3 passed, 186 skipped, no type errors**, 1.34 s. The independent
reviewer separately ran the same identity/fixed/bound calibration and obtained
three passing tests.

| Working directory | Command after `"$NODE26" ../../node_modules/vitest/vitest.mjs` | Result |
| --- | --- | --- |
| `packages/powersync-direct-collection` | `run tests/collection.test.ts --coverage.enabled=false` | 14 passed, no type errors; 1.82 s |
| `packages/db-adapter-conformance` | `run tests/reference-adapter-oracle.property.test.ts --coverage.enabled=false --testNamePattern 'fixed seed 2118: generated\|random seed: generated'` | 32 passed, 960 skipped; 234.03 s |
| `packages/convex-db-collection` | `run tests/eager-live-source-conformance-oracle.property.test.ts --coverage.enabled=false --testNamePattern 'fixed seed 2118: generated\|random seed: generated'` | 6 passed, 534 skipped, no type errors; 109.34 s |

These neighboring generated runs include fixed and fresh campaigns. Earlier
full reference/Convex runs exposed an instrumentation mistake: the shared
observer emitted undeclared optional reach labels to older receivers. Explicit
`additionalStates` fixed that mistake. The table records the subsequent
targeted reruns, not a final full calibration-suite run.

Prettier on the six files, scoped ESLint, and the root command
`"$NODE26" scripts/agent-lint-feedback.mjs` all finish successfully. Both lint
commands emit no diagnostics after the final correction.

## Omitted-listener mutant

The hostile source mutant removes **only** cleanup's `unlisten()` call:

```diff
         lease?.release()
-        unlisten()
```

The separate aborted-registration `unlisten()` remains. Before the extension,
the mutant survived six fixed-seed campaign units, including 400 generated
histories. The old shared comparison accepted snapshot/change while the SDK
remained `syncing` after cleanup. That was a missing resource observation, not
evidence that listener release was optional.

With the strengthened ledger, this history reaches final cleanup:

```json
[
  { "kind": "snapshot", "rows": [{ "id": 1, "title": "a", "value": "one" }] },
  { "kind": "changes", "changes": [{ "type": "upsert", "row": { "id": 1, "title": "b", "value": "two" } }] }
]
```

A Vite pre-load substitution supplies the mutated source to the real driver.
The witness requires `checkEagerLiveSourceHistory(driver, history)` to reject
with `{ law: 'LIFE-2/LIFE-10 (provider resources)', step: 2 }`; its `finally`
block removes the deliberately orphaned listener. Thus the witness has no
independent row expectation. The executed command was:

```sh
"$NODE26" ../../node_modules/vitest/vitest.mjs run \
  --config /private/tmp/pr2377-unlisten-mutant-lfmrapre/red-witness.config.ts \
  --coverage.enabled=false
```

Final result: **1 passed**, 1.09 s, because the witness requires the intended
comparison failure. Output:
`MUTANT REJECTED at final cleanup by LIFE-2/LIFE-10 (provider resources)`.
The independent reviewer separately reproduced this result. Classification:
**assertion rejection at the intended final cleanup comparison**, not a
timeout, setup failure, or unrelated runtime failure.

The mutant source SHA-256 is
`511c29f390cadb3e47e9e91fc99b47b54652bf7ba3200a2dafaf9c43943c9a36`;
configuration SHA-256 is
`932751341152ce686e3c7a04941595954cdfc2b53f54537237d64e7bba0ca056`;
witness SHA-256 is
`640185ba18934c6ee4fec9b1ad91983e5be28da35f3d2e7722f28c610d2d5a12`.
These hashes, mutation, history, assertion, command, and result preserve the
critical evidence without requiring an external scratch log.

## Independent review and approved snapshot

The independent enforcement reviewer found one P2 issue: resource run identity
was inferred from lease allocation count. Allocating a lease before a status
listener would incorrectly tag that listener as belonging to the next run.
The final receiver wraps the configuration's `sync()` entry and increments an
explicit run counter before calling the adapter. All resource allocations
record that counter. Resource count and allocation order remain free; the
original per-lease observation stays separate.

The reviewer independently verified all six final hashes and approved the
instrument slice for the production-repair gate. The SHA-256 of the JSON
manifest below, serialized with two-space indentation and a final newline, is
`697c929a765dbb863946f1569944863eb6c15f26f91e10a1e22df7ff168d4370`:

```json
{
  "packages/db-adapter-conformance/src/eager-live-source-oracle.ts": "4cf5d868ee8ec99c678b51b30c456653ebaf58e498f9735ccd2ba79c5390626d",
  "packages/db-adapter-conformance/tests/eager-live-source-framework-oracle.ts": "84f11150cc8cf5e4a3ff08267a6701ef570cb5acf52618622605740803bfe71e",
  "packages/db-adapter-conformance/tests/eager-live-source-oracle-suite.ts": "a3da7e932dc9dbb4b21c9333b913e32cd28d97d13bd7edee313027afad886388",
  "packages/powersync-direct-collection/tests/conformance-driver.ts": "7a58cbdb68c4d8168ca06a244d21767673ccc34069f6bd051e8c21a23981be0e",
  "packages/powersync-direct-collection/tests/eager-live-source-history-oracle.ts": "fab669e7388051af47198acacc1e476f074d7a4ba3dd547be39ebb5c8197eb5c",
  "packages/powersync-direct-collection/tests/eager-live-source-conformance-oracle.property.test.ts": "831ce5b1c91aadc4f35cddb916a0645e665296059bce4738ede32da4107896ca"
}
```

## ORC-001–016 applicability

The independent review found ORC-001–010, 014, and 016 satisfactory within
this slice. ORC-013/015's machinery and authored distinguishing constructions
were satisfactory, with the execution limits below. This versioned record
supplies the ORC-012 evidence that was pending at the review verdict.

| Requirement | Applicability and outcome |
| --- | --- |
| ORC-001: authority and limits | Applies. HEALTH, RETRY, and LIFE authority and the exact controlled SDK boundary are stated above and beside the executable owner. No product law was changed to match output. |
| ORC-002: independence | Applies. The shared Map/phase model remains independent. Failure identity and one-release obligations come from the contract; the driver only supplies protocol input and observations of real SDK calls. |
| ORC-003: responsibilities | Applies. Owner, history grammar, receiver, and comparison remain distinguishable literate modules. Their prose describes the changed law and observation cuts. This record supplements those explanations. |
| ORC-004: grammar controls | Applies. Reconstruction is shown by the RED replay and shared fixed two-error history. Ablating the second identity defeats the identity law; omitting a release defeats LIFE. Empty versus changed recovery distinguishes row-change-only clearing. Bounded domains and skipped invalid phases are stated above. The main random language is retained; clean-baseline generated reach controls remain pending after repair. |
| ORC-005: path and observation | Applies. Positive executions reach the real adapter/Collection/SDK and the named HEALTH/LIFE comparisons. Every publication remains recorded. The one-response SDK probe confirms healthy checkpoint information arrives; no unresolved missing-input hypothesis was identified for this controlled checkpoint. |
| ORC-006: calibration | Applies. Bound first-error-only observation corruption is rejected under HEALTH-1. Omitted-unlisten source mutant is rejected under LIFE at final cleanup. Both outcomes are comparison rejections. Recovery RED itself is not counted as a completed source-mutant campaign. |
| ORC-007: campaigns and replay | Applies. Registration retains seed 2118 and a fresh campaign with the same 400-run property. Exact seed/path replay was executed and preserves HEALTH-2 step 2. Full repaired fixed/fresh executions remain pending. No `fc.commands` replay path is involved. |
| ORC-008: minimality | Applies to the added checker bookkeeping. A second distinct delivery error versus a later optional retry attempt changes the mandatory public failure list, so the delivery-error index distinction is necessary. Resource run identity determines whether cleanup is owed; explicit sync-entry stamping preserves allocation-order freedom. The independent row/phase model is unchanged. |
| ORC-009: vocabulary | Applies. Sync run maps to one configuration `sync()` invocation. Resource records map separately to table listeners, status listeners, and stream leases. A protocol checkpoint is a controlled delivery; it is not equated with Collection publication. |
| ORC-010: fidelity and cleanup | Applies. Shrinking and direct replay preserve HEALTH-2 at step 2. The shared checker retains its primary mismatch and secondary cleanup diagnostics. The mutant witness explicitly removes its deliberately orphaned listener afterward. |
| ORC-011: second formulation | Conditional trigger absent after independent review: no named plausible shared-semantic fault requiring a second formulation remains in this slice. The SDK receiver is not claimed as a second independent model. |
| ORC-012: review evidence | Applies. This versioned record binds the reviewed head, six source hashes, commands, results, counterexample, mutant classification, and every numbered outcome. No bug-class closure is claimed while the known recovery counterexample remains. |
| ORC-013: reusable boundaries | Applies. One versus two errors distinguishes a first-only failure frame; changed versus empty checkpoint distinguishes row-change-only recovery; final cleanup distinguishes lease-only cleanup from release of all acquired resources. The intended identity/resource checks ran. Successful recovery witnesses and their full campaign evidence remain pending. |
| ORC-014: controlled handoff | The real SDK receives controlled NDJSON checkpoints. This record makes no browser or deployed-service claim, so that further handoff is outside this slice. Such claims remain unresolved with the eager owner until a receiving witness supplies the material premise. |
| ORC-015: declared reach | Applies. Four added states use actual observations, five fresh-object builders, and per-builder missing-state controls. Completed recovery counts and all missing-state calibrations remain unverified because unchanged production fails first. Both full fixed/fresh campaigns and all calibrations are required after repair. |
| ORC-016: law-only files | Applies. The two-error fixed replay uses the shared model/driver/check with no separate expected answer. Wrong-receiver calibration feeds that same judgment. No ordinary unit test was added to an oracle file. |

## Remaining limits

This is Node 26 evidence over real `@powersync/standalone-client` 0.1.1 and a
controlled service, in eager mode, with per-batch changes and JSON values.
Browser behavior, deployed service behavior, parse conversion/refusal,
on-demand loads, mutation confirmation, reload, and persisted composition need
their own assigned receiving evidence. The ledger sees resources exposed at
the tested SDK boundary and does not infer hidden SDK resources.

The recovery law remains open in the eager owner until the repaired production
passes both normal campaigns, all declared reaches with measured counts, all
missing-state calibrations, and a relevant recovery mutant. The independent
gate approval does not waive those requirements or close the broader portfolio.


## 2026-11-23 correction: request-scoped subscription results

The [request-fixture review](2026-11-23-powersync-request-fixtures.md) supersedes
this record's same-response subscription-error and SDK checkpoint-event
dependency claims. The real service resolves subscription arguments once per
HTTP request. Transient delivery failure interrupts transport, and SDK 0.1.1
already exposes recovery on an unchanged empty successor checkpoint. Historical
commands and verdicts above retain their original scope and premises; they do
not establish a missing SDK event for a legal service history. The corrected
eager and shared-client receivers preserve recovery and distinct-error checks
through actual successor requests. Node Map compatibility remains a separate
SDK concern.

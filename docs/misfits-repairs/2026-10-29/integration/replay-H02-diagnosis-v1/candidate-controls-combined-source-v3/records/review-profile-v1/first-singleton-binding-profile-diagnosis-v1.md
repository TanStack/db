# First singleton: independent provenance failure diagnosis

The actual `inline-park-root` invocation failed because the shared verifier
unconditionally requires the older progress receiver's startup cut and
instruments. This is a harness profile defect. It supplies no product RED or
GREEN and no candidate-state credit. The first failed run, combined-v2 freeze,
input-v1 freeze, and earlier source verdicts remain unchanged. This diagnosis
is an additive supplement outside the canonical cutoff.

## Preserved actual evidence

The result freeze is
`candidate-controls-baseline-batch-preparation-v1/inline-park-root-result-freeze-v1.json`,
SHA256 `cfd7d4c32192a39d315c7318bc599aeeedc167f4f729cd919ab23a17257b572c`.
The exact actual completion tool return is chunk `714eb7`, exit 1. The root's
initial tool return and actual completion are retained in the run's
`root-actual-tool-return.json`; a pending session was not mistaken for exit.

The outer `outcome.json` reports exit 1, no signal, no heap detection,
`identityMatched=true`, `remainingGroup=0`, and zero cleanup errors. Elapsed
time is about 3.38 seconds and sampled aggregate RSS is 713,981,952 bytes. This
is not a wall, heap, or RSS cutoff. Root's retained probes report the named
original parent/worker identities and owned groups absent; they do not claim
an escaped-descendant census. This reviewer ran no new process probe.

The native worker's test reports pass/exit 0, but the supervising baseline test
rejects `bindingStatus=unresolved` at baseline test line 316. Raw transport has
328 sequential receipts: three epoch starts/ends, one initial view, six semantic
actions, two authored cuts, eight callback deliveries, and exactly one positive
`worker-cleaned`. No raw worker error is present. These physical records do not
override failed provenance or turn the invocation into a product GREEN.

The verifier writes exactly these six failures:

```text
actual evaluated-module startup inventory missing
required evaluated receiving instrument missing: packages/query-db-collection/tests/queued-answer-progress.receiving.test.ts
required evaluated receiving instrument missing: packages/query-db-collection/tests/queued-answer-progress-driver.ts
required evaluated receiving instrument missing: packages/query-db-collection/tests/queued-answer-progress-oracle.ts
required evaluated receiving instrument missing: packages/db/tests/query/load-subset-retained-publication-oracle.ts
required evaluated receiving instrument missing: scripts/h02-progress/witness-premise.ts
```

`first-singleton-binding-profile-facts-v1.json`, SHA256
`ccda8b46fffd761159b413eb631cb1fa7791953c1a0a4101746ecb7b39e0e139`,
independently rehashes 26 selected preserved assets, including both outer
captures, original stdout/stderr, result/recipe/program/freeze, transport,
inventories, seal, and supervisor records. It also independently verifies
twenty relevant pre-history bindings: seventeen approved completion/common
instruments and the three production entry sources. All twenty have evaluated
registry evidence, correct original/loader hashes, actual V8 source containing
the exact retained loader body, and matching sealed script identity. No check
in that fact artifact failed. This is a selected binding check, not independent
revalidation of every one of the run's 1,974 retained assets or every loaded
module.

## Cause and correct profile boundary

Frozen `verify-bindings.mjs:100` always demands
`evaluated-driver-start.json`. Lines 258–266 always demand the progress-specific
entry, driver, model, retained-publication owner, and witness-premise module.
Line 306 only throws those accumulated errors; it is not the first faulty
condition. The completion supervisor invokes this verifier at line 519 without
a distinct profile. All six inspected source files still match the failed-run
freeze in the fact artifact.

The completion entry awaits its dynamic driver import, calls
`__h02SealBindings`, and only then drives the program. Its seal captures
`evaluated-pre-history.json`, binds original/loader/V8 source, requires the
inspector acknowledgements, and disconnects the inspector before the program.
The driver does not call the older progress driver's `captureBindings('driver-start')`.
The actual run has pre-history and after-all inventories, each with 179 registry
modules. The seal's hash matches the exact pre-history inventory. Missing the
older driver-specific cut is therefore expected for this receiver.

The completion profile's expected instrument set must be a static list tied to
the frozen receiver, not a set inferred from whichever modules happened to load:

| Role | Required instrument paths |
| --- | --- |
| Entry and physical driver | `queued-answer-completion.receiving.test.ts`, `queued-answer-completion-driver.ts`, `queued-answer-completion-baseline-driver.ts` under `packages/query-db-collection/tests/` |
| Fixture and physical observation/receipt wiring | `queued-answer-completion-fixture.ts`, `queued-answer-completion-attachments.ts` in that test directory |
| Authored intervals and independent model | `queued-answer-completion-baseline-history-oracle.ts`, `queued-answer-completion-history-oracle.ts`, `queued-answer-completion-oracle.ts` in that test directory |
| Shared candidate receipt instrument | `scripts/h02-progress/candidate-controls.ts` |
| Imported oracle utilities | `packages/db/tests/oracle-reach.ts`, `oracle-config.ts`, `oracle-replay-witness.ts`, `oracle-declaration.ts` in that test directory |
| Independent expression interpretation | `packages/db/tests/reference-expression-oracle.ts` |
| Common startup and transport | `scripts/h02-progress/source-binding.setup.ts`, `startup-inspector.mjs`, `receipt-transport.mjs` in that script directory |

All seventeen are actually evaluated with code in the preserved pre-history
cut. The three common required production entry sources remain
`packages/db/src/index.ts`, `packages/db-ivm/src/index.ts`, and
`packages/query-db-collection/src/query.ts`. The generic verifier must continue
to examine every observed approved production/instrument module, including
later cuts, with the same original-byte, transformed-byte, actual-V8, and sealed
startup checks. The static required list is an additional expected-path check.

The original `queryCase` predicate uses `worker-start.history.kind === 'query'`.
The completion worker instead records `mode='baseline-constituent'` and its
exact program. Its old key-prefix/empty-options/stack receipt counts are zero;
those old progress callback assertions were not this receiver's observation
lane. Preserve the original progress assertions. Do not import its modules or
fabricate its callbacks to satisfy completion provenance. Completion's actual
provider/source-load/output/public callback bindings remain required by its
driver; this diagnosis does not claim independent completion proof of the
older key-prefix law.

## Missing test dimension and exact next repair path

The existing `scripts/h02-progress/bindings-calibration.test.mjs` authors only
progress fixtures and a driver-start cut. It can pass while every lawful
completion receiver is rejected. Earlier source identity/import scans prove
that expected bytes were frozen, and the pure domain/dispatch controls prove
their extracted checks; neither tests whether the verifier's expected profile
matches the selected receiving entry. The independent source review missed
that profile suitability gap. This actual failure exposes the missing
instrument test dimension; it is not a reason to relax provenance.

The native author's proposed narrow successor addresses that dimension:

1. Add explicit `progress-v1` and `completion-baseline-v1` verifier profiles.
   Retain the original progress default for original callers. Require exactly
   one worker-start and reject unknown/cross-profile mode or history. The frozen
   completion supervisor must pass its constant completion selector; the exact
   recipe must pin `bindingProfile='completion-baseline-v1'` for audit.
2. Require the static completion seventeen instruments plus the three common
   production entries to be evaluated at the pre-history cut. For this exact
   entry the awaited import finishes before sealing. This is a selected fixture
   operational premise, not a new general product law. Preserve progress's
   existing cut/list/key/stack and later-evaluation semantics.
3. Extend the existing offline calibration file first. An authored completion
   fixture must reject the frozen old verifier, then pass the corrected
   completion profile without any old progress module or driver-start cut.
   Reject each missing or unevaluated completion required path, missing/wrong
   startup cut, missing/unknown/wrong selector, worker-mode mismatch, and
   cross-profile substitution. Retain common original/loader/V8/seal/transport
   corruption checks and reject completion required paths appearing only later.
   Keep the original progress calibration results and semantics.
4. Run only separately admitted offline checks in the author's coordinated
   source-work slot. Authored source byte strings must never be imported or
   evaluated as production. Offline use of the preserved actual records must
   read them and write a new result or operate on separate copies: the verifier
   currently writes `binding-verification.json` inside its input directory.
   Running it directly on the failed directory would destroy evidence.
5. Freeze the narrow source successor and one new exact `inline-park-root`
   recipe/output leaf. Its existing program may remain byte-identical. The new
   selector/source identity requires a new recipe and combined freeze. Obtain
   independent source/input review before any root runtime admission. Do not
   amend combined v2, input v1, or the failed run in place.

The proposed edited paths are only `verify-bindings.mjs`, the existing bindings
calibration file, `queued-answer-completion-supervisor.ts`, and
`completion-parent.mjs`, plus additive source/input records. The implementation
and its RED/GREEN instrument results are still pending; this report supplies
no successor acceptance or retry authority.

All raw20 candidate states remain UNREACHED. State14 mapping remains proposed.
The actual-helper/no-active-operation neighbor is still required and UNREACHED.
No metadata credit transfers. No production/model/oracle expectation change,
canonical import, install, Git mutation, native retry, or resource increase was
performed by this diagnosis.

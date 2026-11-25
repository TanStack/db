# Receiving diagnostic failure fidelity

This is a bounded instrumentation amendment to PR 2377, whose original head is
`92a1493e0f45dbfd1fc3a51460ccb9228d8f787d`. It changes diagnostic capture and
cleanup reporting. It does not change a product law, reference model, generated
history, accepted comparison condition, provider event, or observation cut.
The accompanying [snapshot](2026-11-18-receiving-cleanup-fidelity-snapshot.json)
contains the exact source hashes, original-to-repaired deltas, caller inventory,
actual-function control outcomes, and evidence artifact hashes.

## Law and boundary

ORC-010 in `docs/contributing/oracle-rubric.md` requires three distinguishable
results: preserve the primary law and checkpoint, retain secondary cleanup
failures, and release resources. An unknown thrown value is not necessarily
printable: `String(Object.create(null))` throws. Proxy prototype/conversion
traps, throwing Error or AggregateError properties, cyclic aggregate details,
and JSON conversion can also throw during diagnostic capture.

The repair belongs in the instrument. Product error identity and row/ID
encodings are not changed. No product RED or new generated reach is claimed:
these ordinary controls exercise the actual diagnostic functions with explicit
inputs. They do not establish a new provider or browser receiving witness.

## Caller inventory and disposition

The initial inventory contains 231 changed or untracked package TS/JS files.
It searched error conversion, cleanup catches, retainers, detached-rejection
recorders, and diagnostic serialization. The snapshot retains every initial
path and all 49 files calling the cleanup helpers, including ordinary tests.
Those are caller-file counts, not oracle-owner counts.

| Caller family | Disposition |
| --- | --- |
| `db/tests/oracle-cleanup.ts` | Shared total formatter and retainer independently approved by the shared-helper reviewer. It guards conversion, prototype/property access, cycles and depth. This audit consumes that helper. |
| Native PowerSync `receiving-cleanup.ts`, Direct `persisted-initial-receipt-driver.ts`, Electric `cross-adapter-receipt-driver.ts` | Thin retainers now delegate to the shared retainer. This avoids reading untrusted `AggregateError.errors` before entering the guarded formatter. It retains prior diagnostics, the recorded row and error arrays, and all cleanup attempts. |
| Shared `on-demand-streams-driver.ts` | Request rejection recording and the completed-result catch use the total formatter. The catch retains prior diagnostics and formats the complete caught value without inspecting its aggregate details. Its existing body and cleanup schedule remain intact. |
| Convex snapshot receiver and initial-receipt worker | Cleanup catches retain the raw observation and earlier diagnostics; unknown failures use the shared formatter. |
| TrailBase mutation-events SDK receiver | Each existing cleanup wrapper uses the total formatter before later wrappers run. |
| Electric installed-SDK snapshot receiver | Its cleanup observer uses the total formatter so reporting a failed release cannot stop subsequent releases. |
| Shared eager framework bridge | Guarded exception classification rethrows an uninspectable original thrown value by identity. A known `ConformanceViolation` retains its law, step, expected and actual observations, with total aggregate diagnostics. |
| Shared eager conformance source | The private toolkit's detached-rejection and console recorders, mismatch reason descriptions, and JSON error-message serialization now use guarded diagnostics. The module imports the existing pure formatter directly; no shared module moved across a product boundary. |
| Electric snapshot shrink/calibration capture | `violationCheckpoint`, `asError`, and `unaccepted` now handle arbitrary setup/provider failures without a diagnostic conversion replacing them. Ordinary `Error` identity remains intact in `asError`. |
| Native/Direct PowerSync, Electric, RxDB Node workers and browser/OPFS detached recorders | Their existing callbacks use the total formatter. Event registration, event suppression where already present, removal and observation cuts are unchanged. The snapshot lists every edited path. |
| Neon worker and browser detached recorders | The Neon author owns the equivalent two-call amendment and its separate controls/actual-host evidence. See the Neon final evidence record. |
| Direct main/cursor persisted-demand retainers, nested cleanup loops and attempt/error diagnostics | Packaging and the cursor author own these amendments and their actual-retainer controls. This audit notified both owners of the nested and request-diagnostic sites; their final inventories and receiving evidence remain separate. |
| RxDB mutation/shared-client/initial-receipt receivers, Electric mutation/decoder receivers, LocalStorage receiver and remaining generic cleanup callers | Already use the shared retainer or exhaustive cleanup helper without an additional unsafe unknown-value conversion at the cleanup boundary. Host parent wrappers append literal process-exit diagnostics to parsed raw observations; they do not format an unknown thrown value. |

The remaining `String` uses have a separate disposition. Row/ID/provider
encodings and decoder/mutation error transports represent product observations;
this diagnostic amendment does not change their representation. The three
mutation registrar catches call the shared mutation checker, whose thrown
failure is an `AssertionError`; their conversion therefore has a finite Error
throw domain. Native decoder refusal matching and reload error observations
likewise consume the declared fixture Error values. Numeric IDs, bigint txids,
SQL encodings, request URLs and string bodies do not consume unknown failures.
These are scope arguments from the called boundary, not dismissals based on a
line's age. The eager watcher was repaired even though its lines predated the
receiving extension, because the new receiving families call it.

## Executed controls

| Instrument | Before repair | After repair | Observation |
| --- | --- | --- | --- |
| Three imported thin retainers, ordinary Vitest controls | 9 failed, 12 passed | 21 passed | Wrong row/error arrays survive by identity; prior diagnostics remain; every later cleanup runs; incomplete body failures retain original cause and secondary error identity. |
| Actual source callback/catch controls | 49 failed, 59 passed | 108 passed | Six unusual-reason controls per unique diagnostic node, including request rejection, completed-result catches, cleanup wrappers, observer callbacks and detached recorders. |
| Actual shared eager framework function | 4 failed, 4 passed | 8 passed | Original law/step/raw identity plus cleanup details; raw Proxy and hostile aggregate-cause values rethrow by identity. |
| Actual detached/console watcher | 6 failed, 12 passed | 18 passed | Completed raw result, diagnostic, listener removal, console restoration and later cleanup. |
| Actual `ConformanceViolation` constructor/message serializer | 3 failed, 3 passed | 6 passed | Original law, checkpoint and exact raw actual value survive cyclic JSON values and throwing conversion hooks. |
| Actual Electric shrink/calibration capture helpers | 10 failed, 8 passed | 18 passed | Checkpoint/error diagnostics survive unknown values and hostile inspection; ordinary Error identity stays. |

The source-function controls extract the exact TypeScript function or callback,
transpile it, and invoke it with explicit dependencies. They exercise the
actual recorder code. They do not run an SDK, transport, Chromium event loop,
or provider campaign. The watcher control supplies a local process/console
surface, and verifies its removal/restoration calls. A nonstandard thrown value
is fault injection at the diagnostic boundary, not a product-law mutant.

A provisional count of 132 source controls counted five browser callbacks again
at their listener-removal call. The corrected unique count was 102. Six direct
request-rejection callback controls bring the final unique count to 108. The
snapshot records this correction; no duplicate is credited as another path.

Commands run from the review worktree include:

```sh
node node_modules/vitest/vitest.mjs run --config .review-2377/cleanup-format.vitest.config.mts --coverage.enabled=false --typecheck.enabled=false --maxWorkers=1
node .review-2377/cleanup-source-controls.mjs original
node .review-2377/cleanup-source-controls.mjs repaired
node .review-2377/cleanup-framework-controls.mjs original
node .review-2377/cleanup-framework-controls.mjs repaired
node .review-2377/cleanup-watcher-controls.mjs original
node .review-2377/cleanup-watcher-controls.mjs repaired
node .review-2377/cleanup-violation-controls.mjs original
node .review-2377/cleanup-violation-controls.mjs repaired
node .review-2377/cleanup-electric-classifier-controls.mjs original
node .review-2377/cleanup-electric-classifier-controls.mjs repaired
pnpm exec tsc --noEmit -p packages/db-adapter-conformance/tsconfig.json
pnpm lint:changed
```

The ordinary retainer test is retained in
`packages/db-adapter-conformance/tests/receiving-cleanup-format.test.ts`.
Original source text and executable diagnostic controls live in the review
workspace's `.review-2377` artifacts. The versioned snapshot retains exact
source deltas and every control outcome, so the original result is not silently
replaced by the repaired source.

## Limits and dependency carry

These controls establish finite diagnostic failure fidelity for the named
functions and inputs. They do not establish arbitrary getter behavior,
unbounded aggregate graphs, total raw-value transport, or all future cleanup
implementations. The formatter deliberately bounds nested diagnostic depth and
marks unprintable details. No product expectation was relaxed to obtain GREEN.

Normal Error diagnostics in the three thin retainers now show messages instead
of stacks. Existing receiving comparisons require the diagnostic to remain
separate and contain its failure; no product Error observation changes. The
remaining changes preserve the ordinary message output and extend formatting
to previously unprintable inputs.

The proposed evidence carry is bounded: prior normal-provider comparisons may
carry across this diagnostic-only dependency amendment after independent
review of the exact source deltas. Earlier manifests remain historical. The
source-function controls above are not replacements for the receiver campaigns
or evidence that those campaigns were rerun. The final shared and adapter
hashes are in the snapshot; the root reviewer owns the overall final manifest.

Final verification: scoped ESLint, the conformance package TypeScript check, and
`pnpm lint:changed` passed. Independent reviewer `oracle_diff_enforcement`
reran all control families and 24 additional constructor inputs, approved every
entry in the final 24-source map, and approved bounded normal-provider evidence
carry. Its exact evidence artifacts are hashed in the snapshot. The final
conformance source hash is `abc07901fc6ab979c6f41bade19b1211c3bf8db1c35d8857f98869b5050aea49`.
A provisional `0529bec2` source was corrected after lint rejected a nullable
JSON return expression. Final `String(JSON.stringify(...))` converts only JSON's
primitive output inside the same guarded serialization; the final controls ran
on those bytes. Earlier freeze notices and manifests remain historical.

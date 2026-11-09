# Dependency compatibility receiving evidence, 2026-11-09

This record covers the Solid 1.9.18 and Electric client 1.5.28 repairs in
[PR #2374](https://github.com/TanStack/db/pull/2374), and the Electron example's
native-artifact isolation. It records bounded observations, not universal
compatibility or whole-PR merge readiness. Existing coverage owners, budgets,
and neighboring laws remain authoritative.

## Reviewed revision and environment

Pre-repair oracle-extension commit:
`d4448ca49c3db623b63005ad7f2e3c35cdbc85df`, following production baseline
`6e931cfa367af698d0de304d7e1e18fe8ddc562d`.

**Final repair commit: c767674b5a7351d3410181ece26faa10b263b9f0.** The source fingerprints below identify the implementation in that commit.
Do not substitute a later head without checking them.

| Reviewed source | SHA-256 |
| --- | --- |
| `packages/solid-db/src/store-materialization.ts` | `4135a6e40f3802acba21d643fddb1f57487a6f1428318113d86c2300efd8b0a7` |
| `packages/electric-db-collection/src/electric.ts` | `e78caac9bf4f12c72f4ce7227c55480b8a11dd25ae4c9f37ae89ee6aefc751b5` |
| `examples/electron/offline-first/scripts/rebuild-electron.mjs` | `ba185abaf6275b512373d7695a4689e8e6b4519549489b3f379f3ef8b51787d5` |
| `examples/electron/offline-first/electron/main.ts` | `0546e20de46109d674753dd441db80d78c828cce5a1d073ccd74929db3a2059d` |

The two adapter fingerprints match their frozen final candidate copies.
The Electron main-process fingerprint includes the final type-import order
correction, which does not change its emitted JavaScript. Tests
were extended and formatted during review; test identity follows the final
repair commit rather than an earlier uncommitted test fingerprint.

A later review adds an invariant comment beside Solid's revision bump.
TypeScript emission with comments removed matches the repair commit exactly.
The fingerprints above continue to identify the named repair commit.

Local package installation remained shared and unchanged. Exact upgraded
Solid/Electric distribution files, retrieved through the authorized CI
artifact, were extracted under `/tmp/dependency-compat-runtimes`. Scratch Vite
configs alias those real runtimes into the repository's production drivers.
The local runner is Vitest 3.2.4; the upgraded CI graph uses Vitest 5.1.0.
Scratch runs disable coverage and typechecking and use at most two workers.
These runs establish the named host/SDK boundaries; final-head CI must check
the complete upgraded dependency graph and its actual runner.

The local size comparison against `origin/main` measured the two adapter
repairs with the same installed tooling on both sides. Solid adds 161 gzip
bytes and 149 Brotli bytes; Electric adds 85 gzip bytes and 78 Brotli bytes.
The combined increase is 246 gzip bytes and 227 Brotli bytes. The Solid signal
replaces obsolete reserved-name seeding; Electric separates accepted-cursor
capture from applied waiting. This comparison excludes dependency-closure size
changes from the upgrade and is not a runtime performance result.

The command forms used for these local runs are:

```sh
pnpm --config.verify-deps-before-run=false --dir packages/solid-db exec vitest run --config /tmp/dependency-solid-db-vitest.config.mts --maxWorkers=2
pnpm --config.verify-deps-before-run=false --dir packages/electric-db-collection exec vitest run --config /tmp/dependency-electric-db-collection-vitest.config.mts --maxWorkers=2
```

Focused runs add the named test files and `-t` selectors described below.
Temporary paths name the inspected session evidence. The verdict-critical
results and limits are retained here so they do not depend on those files
remaining available.

## Solid: accepted own data and tracked consumers

**Law and authority.** The shared framework
[`row-snapshot-oracle.ts`](../../../packages/db/tests/conformance/row-snapshot-oracle.ts)
requires current results to follow admitted source values while borrowed and
retained source rows remain intact. The Solid
[`row-materialization-oracle.test.tsx`](../../../packages/solid-db/tests/row-materialization-oracle.test.tsx)
receives that law through callback, config, and supplied-Collection inputs. An
own user field named `__proto__` has ordinary data meaning. Its tracked
consumer must follow replacement, own undefined, omission, and readmission.
Unchanged neighbors stay quiet, and ordinary stable roots retain identity.

The helper's separate visibility law preserves descriptor enumerability for
direct `createRowStore().value` consumers. Core normalizes public root
descriptors, so a public hook test alone cannot establish that helper law.

**Repair.** Solid's protected native setter refuses `__proto__` writes. The
adapter removes its former native-node seeding for that name. It defines or
deletes the field only on detached owned raw objects, and uses a revision
signal through the existing read facade for value, membership, ownness, and
key observations. Native guards and `$RAW`/`$PROXY` identities remain intact.
Other fields still use native updates. `Object.is` distinguishes signed-zero
values when deciding whether the special field's listeners need notification.

### Finite grammar and controls

The independent expected value uses a model stage and authored payload, never
the materializer's native nodes or change classifier. Its five stages are
initial, replacement, own undefined, omission, and readmission. These are model
checkpoints mapped to the corresponding public row writes.

| Dimension | Domain and semantic contribution |
| --- | --- |
| Public input | Callback, config, supplied Collection; removing one loses that receiving path. |
| Field name | Ordinary and `__proto__`; the ordinary control distinguishes general admission from the reserved-name shortcut. |
| Initial state | Own value, own undefined, absent; removing one loses first-read or first-admission behavior. |
| Payload | Scalar, signed zero, object, array; these distinguish scalar equality, signed-zero invalidation, and detached container exposure. |
| Helper visibility | Six original payload kinds × initially hidden/visible × both field names; removing the reserved key loses the facade shape-notification witness. |

The public grammar exhausts `3 × 2 × 3 × 4 = 72` histories. The helper grammar
exhausts `6 × 2 × 2 = 24`. Reconstruction includes the original stale reserved
field, absent-to-own, own-undefined, omission/readmission, `0 → -0`, and the
hidden/visible descriptor transitions. The helper retains payload and root
identity while visibility changes. Initial source ownness and retained source
values are compared independently of the framework output.

The ranges are these finite payload classes and stage sequences, not arbitrary
JavaScript values or schedules. In-place source edits and nested native-only
mutable-source writes are excluded. The helper family excludes accessors,
hidden symbols, and frozen-descriptor mutation; public normalization is not
credited as helper descriptor admission. Cycles and arbitrary getter bodies
retain their preceding coverage limits.

### Reach and results

Every public history asserts all ten reaches: `initial-source-shape`,
`tracked-initial`, `first-replacement`, `own-undefined`, `omission`,
`readmission`, `retained-source`, `quiet-neighbor`, `tracked-own-keys`, and
`prototype-preserved`. Each input supplies 24 histories reaching each state;
the three inputs supply 72 per state. Every helper history asserts `unchanged`,
`hidden`, `visible`, and `visibility-restored`: 12 histories per field name,
24 per state overall. These are finite enumeration counts with enforced
`assertReached()` minima, not inferred random sampling or console reach logs.

| Execution | Result and classification |
| --- | --- |
| Original production, extended receiving checks with exact upgraded Solid | 45 failed, 39 passed, 262 skipped; intended shared value, tracked reserved-field, and helper visibility assertions. `/tmp/solid-upgraded-oracle-red.log`. |
| First repair, shared conformance and materialization files | 346 passed. `/tmp/solid-upgraded-oracle-green.log`. This precedes the signed-zero addition. |
| Signed-zero extension on the unchanged candidate comparator | 6 failed, 12 passed, 249 skipped; `+0` observed where `-0` was owed. `/tmp/solid-signed-zero-red.log`. |
| Object.is-sensitive repair, same signed-zero selection | 18 passed, 249 skipped. `/tmp/solid-signed-zero-green.log`. |
| Final full upgraded-runtime Solid package | 426 passed in 8 files. `/tmp/solid-upgraded-full-green.log`. |
| Get-only facade mutant, public reserved-field selection | Survived: 72 passed. `/tmp/solid-get-only-mutant.log`. Public normalization does not distinguish helper visibility. |
| Same mutant, helper visibility selection | 12 failed, 12 passed; intended `Object.keys` visibility comparisons. `/tmp/solid-get-only-visibility-mutant.log`. |

The signed-zero issue was found independently by code review and simplification
review. A direct exact-runtime helper probe also separated current raw `-0`
from a stale tracked `+0`. The shared grammar was then extended, run RED on
the unchanged comparator, and repaired. No expectation was changed to excuse
the stale value. Ordinary-name controls were retained.

The original native-guard implementation is the principal hostile control.
The get-only mutant demonstrates why value checks cannot replace the helper
visibility owner. No existing work budget was lowered: the original
32-enumerations-per-distinct-container bound remains in place.

## Electric: accepted cursor at successful demand settlement

**Law and authority.** The Electric guide's
[cleanup and resume safety](../../../docs/collections/electric-collection.md#cleanup-and-resume-safety)
contract, existing persisted-launch receiving witnesses, and the subset
applied-settlement law require usable continuation evidence for completed
source acquisition. At successful demand settlement, rows and the accepted
snapshot handle/offset must have applied. Tagged cold starts retain scoped
recovery policy; a subset does not certify a complete global baseline.

The real upgraded SDK delivers snapshot rows to subscribers before advancing
its public accepted cursor. The subscriber therefore lacks the new accepted
position. Reading raw HTTP headers earlier would bypass the SDK's acceptance
semantics. The repair stages resume metadata after physical `requestSnapshot`
fulfillment, before the next serialized request can advance the shared cursor.
The load retains the exact applied receipt and waits for it outside the
physical request queue.

The row and metadata operations remain separate transactions. The supported
checkpoint is successful demand settlement. No crash-atomic row/cursor commit
or intermediate publication atomicity follows.

### Generated grammar and controls

`expectedResumeCheckpoint` derives handle/offset from authored HTTP response
positions, and tag policy from the authored lane. It does not read SDK state
or adapter metadata to compute its expected answer. Rows use authored payloads.
The initial live request remains unanswered so it cannot repair a missing
cursor before the comparison.

| Axis | Bounds, reconstruction, and ablation |
| --- | --- |
| Position/payload | Base 1–30, gap 1–5, name length 1–8; positions increase by the positive gap. The smallest original failure reconstructs with base/gap 1 and a one-character name. Removing distinct positions loses stale-cursor detection. |
| Tags | Tagged and untagged; tagged fresh launch must retain a reset marker rather than certify the incomplete baseline. Removing tags loses that protection. |
| Consumer | Direct subset and public live-query preload; both run apply/hold/reject. Removing either loses its actual settlement path. |
| Empty second response | Empty/nonempty; the empty neighbor establishes cursor progress without a new row write. It is deliberately redundant in reject lanes, which stop on the first failed checkpoint. |
| Metadata delivery | Apply, hold, reject; hold distinguishes early success and reject preserves the named durability error with its storage cause. |
| Cursor consumer | Held first checkpoint across one admitted cursor demand's two physical snapshots; the second request must start before that checkpoint is released. It tests queue progress, not a second independent demand. |

There are 24 direct/live-query lanes and four cursor-held lanes: 28 total.
Each uses the same property, recorder, comparison and budget of eight histories
twice, fixed seed `20261109` then an unseeded campaign. This is 448 checkpoint
histories and 56 test registrations. Cursor apply/reject combinations are not
registered because this additional receiving schedule specifically isolates
progress while application is held. Regressing positions, malformed HTTP
frames, and a newly admitted sibling crossing the persistence hydration barrier
are outside this grammar. Existing owners retain their corresponding laws.

Reconstruction includes cold missing cursor, advanced stale cursor, empty
snapshot progress, tagged fresh launch, delayed durable application, rejected
application, and two physical requests under one held cursor demand. The
second physical request supplies a valid distinguishing witness for queue
waiting. An earlier sibling-demand experiment could not cross persisted
hydration admission while the checkpoint was held. An optimistic-storage-held
variant had the same premise problem. Both were discarded as unreached test
designs, not reported as product deadlocks or successful mutant kills.

### Per-path reach

Every individual lane emits and enforces each applicable reach 16 times across
the two normal campaigns. The final log contains 448 checkpoint reach records.

| Receiving path | Cold cursor | Advanced cursor | Fresh-launch demand | Held checkpoint | Rejected checkpoint | Next physical request |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Direct | 128 | 128 | 128 | 64 | 64 | 0 |
| Live-query preload | 128 | 128 | 128 | 64 | 64 | 0 |
| Cursor-held demand | 0 | 64 | 64 | 64 | 0 | 64 |
| Total | 256 | 320 | 320 | 192 | 128 | 64 |

Reject lanes deliberately assert rejection and stop; they do not claim later
advance/restart reach. Cursor lanes replace `cold-cursor` with `next-request`
because the first response is still held when the second physical request
starts. The two existing rotation campaigns run separately in the final focused
selection and are not included in the 448 checkpoint total.

### RED, GREEN, and hostile controls

| Execution | Result and classification |
| --- | --- |
| Original production after correcting the HTTP persistence fixture | 52 failed, 45 skipped: all 48 fixed/random registrations for the first 24 checkpoint lanes plus four existing persisted-launch tests fail intended metadata/premise assertions. `/tmp/electric-upgraded-oracle-red-v3.log`. Earlier setup-error attempts are not RED evidence. |
| Repaired candidate, same selection | 52 passed, 45 skipped. `/tmp/electric-upgraded-oracle-green-v3.log`. |
| Final 28 checkpoint lanes plus existing rotation campaigns | 58 passed, 32 skipped; 56 checkpoint tests supply the 448 histories above. `/tmp/electric-checkpoint-neighbors-green-v3.log`; selector `persists each completed\|releases retired SDK resources`. |
| Final full Electric package | 898 passed in 21 files, 131.16 seconds. `/tmp/electric-final-package-green.log`. An earlier full run passed 890 tests before adding the four cursor lanes. |
| Await metadata application inside the physical request tail | Rejected by progress timeout at `next physical snapshot while checkpoint is held`, after the held-checkpoint premise; one selected random test fails. `/tmp/electric-queue-await-mutant.log`. This is a progress failure, not a row assertion. |
| Remove scoped/fresh-generation reset protection | Intended assertion: actual `kind: resume`, expected `kind: reset` after the tagged fresh-launch demand. `/tmp/electric-scoped-reset-mutant.log`. |
| Remove explicit direct snapshot-receipt awaiting | Survived: all 16 selected rejection tests pass because the persistence wrapper independently transitions to its terminal durability error and rejects the demand. `/tmp/electric-missing-receipt-mutant.log`. This fixture does not isolate direct receipt retention from wrapper terminal-error propagation. |

The retained receipt prevents an already-settled rejection from disappearing
from the existing pending-receipt map before the load observes it. The
surviving mutant is not evidence that this mechanism was independently
calibrated. A different persistence/error policy would require its own
receiving witness before claiming that isolation. The present external result
remains enforced by the real wrapper used in these histories.

### Replay and harness limits

The selected cursor mutant shrank to base 1, gap 1, one-character name, with
seed `20261109` and path `0:0:0:0:0`. The direct/guarded replay commands select
`electric.sdk-resume-checkpoint.false.cursor.false.hold` and that seed/path.
Both repaired replays pass one selected registration. Each log contains seven
actual checkpoint history executions during fast-check 3 path traversal;
neither establishes singleton history execution.

The guarded replay lookup was extended for the concrete SDK lane names.
The initial full replay suite had 116 passing checks and one source-registry
recognition failure. Validation was extended to check the six name segments,
tag/consumer/empty/delivery domains, cursor-hold restriction, and the actual
registration loops/template. The focused registry selection then passed three
tests, with 114 skipped (`/tmp/dependency-final-replay-owner-green.log`). This
was a harness recognition repair, not a product counterexample or a waiver.
Final complete replay validation remains for the final-head check.

The first violation/checkpoint/history is preserved through shrinking by
`sameViolation`; a candidate failing elsewhere cannot replace it. Cleanup
releases the held durable gate, queries, Collections and HTTP resources, then
checks no active HTTP remains. Retained primary errors and cleanup diagnostics
are separate. Successful path replays do not supply normal campaign reach.

## Query Core: public callers follow silent-cancellation replacements

Query Core 5.107.1 includes upstream
[PR #12489](https://github.com/TanStack/query/pull/12489). Its stated contract
makes imperative fetch callers follow a replacement after silent cancellation,
while preserving cancellation of the raw `Query.promise`. An ordinary ownership
test required the earlier `fetchQuery` rejection. The Collection callers already
passed their unchanged pending and applied-row assertions.

The unchanged test fails at that external-caller assertion with the exact
5.107.1 tagged sources, matching final-head CI, and passes with installed
5.90.20. The corrected test requires the replacement row for `fetchQuery` and
also checks that the raw promise rejects with `CancelledError`. This retains
a cancellation witness rather than accepting either outcome. No adapter,
oracle model, history grammar, comparison, or run budget changes.

The complete ordinary and oracle ownership files pass 496 tests with the
5.107.1 tagged-source receiver and Vitest 3.2.4. Restoring the old Query Core
runtime makes the updated external-caller assertion fail. These are provider
compatibility controls, not a newly discovered Collection defect. Final CI
must still receive the published distribution with the upgraded runner.

## Electron: preserve the Node participant during an Electron rebuild

The original external finding is that pnpm shares the native package with
Node consumers, while rebuilding in the example's workspace graph can rewrite
that shared artifact for Electron. Copying only the example's direct package
is insufficient if the actual rebuilder still traverses workspace or ancestor
links. The law is artifact preservation: preparing Electron must leave a fresh
Node consumer usable, and Electron must resolve its isolated prepared copy.

The final script copies the native package into an ignored `.electron-native`
root, sets both `buildPath` and `projectRootPath` to that root, links only its
direct helper dependencies, and uses the installed Electron version. The main
process resolves the prepared native constructor from that isolated root.

`node /tmp/prep-pr-electron-final-script-probe.mjs` exercises the exact final
script with its `@electron/rebuild` import redirected to an instrumented wrapper
around the real 4.2.1 implementation. Options, module walking, copy/symlink
operations, installer discovery and the prebuild subprocess execute normally.
Only the external native installer is controlled: it writes distinct Node and
Electron markers, and compiler/header fallback is forbidden.

| Subject | Actual selected package set | Fresh Node participant afterward |
| --- | --- | --- |
| Original shared rebuild | Shared pnpm native package | Electron marker: preservation violation. |
| Initial copy repair without `projectRootPath` | Isolated copy and original shared package | Electron marker: preservation violation, despite correct isolated runtime require. |
| Exact final script | Isolated copy only | Original Node marker; isolated runtime resolves Electron marker. |

The final script passes repeat preparation, then a new Node subprocess still
reads the original Node marker. Both original and repaired scripts exit zero;
the marker observation, not exit status, distinguishes the original defect.
No installed shared binary was modified by the controlled probe. The exact
script fingerprint above matched before and after execution. The inspected
log is `/tmp/prep-pr-electron-final-script-probe.log`.

This establishes actual rebuild selection, filesystem isolation, runtime path,
repeat preparation, and fresh-process preservation in the finite pnpm fixture.
Marker bytes do not establish native ABI loading, prebuild/compiler availability,
other operating systems, or concurrent preparations. The permanent desktop CI
step constructs SQLite in a fresh Node process, prepares and constructs it in
Electron from the isolated root, then constructs it in another fresh Node
process. That final-head real native receiving result is still required.

## ORC-001 through ORC-016 disposition

This table audits the changed Solid/Electric owners within the stated scope.
It does not retroactively certify every neighboring property in their files.

| Requirement | Disposition and evidence |
| --- | --- |
| ORC-001 Authority and limits | Satisfied within scope: shared borrowed-row/current-result and Electric resume/applied-settlement contracts are named above; controlled SDK, helper and native limits remain explicit. |
| ORC-002 Independent judgment | Satisfied: Solid expected stages/payloads and Electric authored response positions/tag policy do not reuse production classifiers or SDK state. Source admission is observed separately. |
| ORC-003 Literate responsibilities | Satisfied for changed families: opening law/limits, pure expected-value helpers, finite/generated grammar, actual receiving driver and settled comparison are visible together. Electric prose was corrected after moving campaigns into lane registrations. |
| ORC-004 Grammar controls | Satisfied within bounded domains: reconstruction, each axis's ablation, numeric/value ranges, redundant rejection-lane empty axis, and excluded histories are stated above. No arbitrary-domain closure is claimed. |
| ORC-005 Production path and observation | Satisfied at named cuts: three real Solid hook inputs plus direct helper; real Electric SDK over controlled HTTP through direct/live-query/cursor paths and the actual persistence wrapper. Cursor information is taken only after the SDK accepts it. |
| ORC-006 Calibration | Satisfied for stated external laws by original-code, signed-zero, visibility, queue-progress and reset controls. Direct-receipt mechanism calibration remains unresolved because that mutant survives the wrapper's separate rejection path. |
| ORC-007 Campaigns and direct replay | Electric fixed/random budgets and machinery match; property/seed/path replay executed. Local traversal ran seven histories, so singleton execution is not established. Solid changed families are finite exhaustive grammars, not random campaigns; fixed/random parity is not triggered for them. |
| ORC-008 Stateful-model minimality | Not triggered by a new reference state machine: changed expectations are pure stage/position functions. Fixture hold/interception/queued state controls distinct actual events; deleting it would erase held application or the same cursor demand's second request. |
| ORC-009 Vocabulary mapping | Satisfied within scope: model stages map to public writes, requestSnapshot calls are physical requests, demand settlement is separate from provider return and durable application. Cursor consumer explicitly means one admitted demand with two requests. |
| ORC-010 Failure fidelity and cleanup | Existing sameViolation and lifetime helpers retain primary checkpoint/history and release resources. Mutant outcomes above distinguish assertions, progress timeout, survival and unreached experiments. |
| ORC-011 Independent second formulation | No unresolved shared semantic fault requires a second model for these small expected-value functions. Ordinary-name controls, raw/current versus tracked observations, source retention, fresh-launch HTTP and durable metadata provide distinct observations; they are not advertised as a second independent model. |
| ORC-012 Review evidence | This versioned record retains every disposition and known limit, source fingerprints, per-path reach and mutant classifications. The repair SHA is recorded above. Final-head CI remains an explicit completion item. |
| ORC-013 Distinguishing boundary witness | Satisfied in bounded scope: signed zero versus ordinary scalar, own undefined versus omission, empty versus nonempty snapshots, held versus applied metadata, and first versus advanced accepted cursor each reject a plausible wrong rule. |
| ORC-014 Controlled-premise handoff | Real Solid host and real upgraded Electric SDK supply native tracking/framing premises. HTTP and persistence storage remain controlled. Electron real walker plus controlled installer has no real ABI claim; final desktop CI supplies that remaining handoff. No real backend/native SQLite closure is inferred. |
| ORC-015 Declared reach | Satisfied in normal campaigns/finite enumerations by per-history assertions and the per-path counts above. Replay bypasses normal reach and supplies no campaign credit. |
| ORC-016 Law-only oracle files | Changed regressions are new inputs to the existing shared expected-value/driver/comparison families, not standalone fixed expected-answer tests. The temporary direct signed-zero and Electron marker probes are diagnostic evidence, not replacements for those owners or CI. |

## Review evaluation and remaining work

Independent code review and simplification review both confirmed the signed-zero
issue; they are one defect, not two findings. Code review also confirmed the
original Electron shared-artifact finding and rejected the incomplete copy-only
repair. The final exact script then passed its controlled receiving probe.
The Electric post-request checkpoint design had no further confirmed production
defect in the inspected scope. Every surviving or unreached mutant above is
retained without relabeling it as a kill. No oracle budget or accepted
observation was narrowed to obtain GREEN.

Before merge readiness, check final-head CI on the upgraded graph and retain
the actual Electron native result. The release-tool evidence is linked below. Existing prior-head CI success does not establish
these later repairs. These completion items do not erase the local results.

## Release-tool compatibility

The [separate Changesets review record](2026-11-09-changesets-publish-compatibility.md)
retains unchanged-production RED, all 85 repaired command/HTTP passes, 32 ordinary
controls, declared reach and both hostile-control rejections. It states exact
publisher/source hashes and the distinction between tagged-source toolchain
evidence and the published distribution's pending final-head CI receiving path.

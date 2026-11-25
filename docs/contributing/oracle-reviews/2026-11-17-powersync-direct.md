# Direct PowerSync oracle and production repair record

This work reviews PR #2377 at
`92a1493e0f45dbfd1fc3a51460ccb9228d8f787d`, against
`origin/main` at `21c52a07e6da3d388054224700cc69a800372f30`.
The local branch is `powersync-standalone-package`. No commit, push or remote
review comment is part of this work.

## Oracle-first review gate

The original package suite passed 170 tests on native Node 26 while public
probes exposed failures in stream health, initial readiness and cleanup.
The user required strengthening the oracles and independent review of the
test-only diff before changing production.

The first completed gate retained the two original source hashes:

```text
4cafcd3e53977c30511a85e1482be2e0bda2ad75ab0788d1d49e71a8db78761f  src/index.ts
73a8f7e6112f4d3192ce309c9f5bce8bb0f0eedb371ad4b755130dec13437495  src/subsets.ts
```

The [test-only snapshot](2026-11-17-powersync-direct-test-snapshot.json)
records all 65 test/support/config files at that gate. Its SHA-256 is
`c34d03b9751648c53ca5a221e93e098e806578bf37eac3c1cae754553a18d61d`.
Each independent reviewer inspected our changes against the PR head, rather
than repeating the review of the original PR.

| Instrument | Independent review and original-production evidence |
| --- | --- |
| [Eager health/lifecycle](2026-11-17-powersync-direct-eager.md) | Approved after correcting resource run attribution; same-connection recovery RED, distinct-error calibration GREEN, omitted-table-unlisten mutant rejected at LIFE-2/LIFE-10. |
| [Reload and initial receipt](2026-11-17-powersync-direct-reload.md) | Approved after enforcing every recovery path and preserving primary failures across late teardown; original gate and receipt defects RED on actual receiving paths. Existing Direct/RxDB/PowerSync successful reload suites each passed 103 tests. |
| [Mutation confirmation/cancellation](2026-11-17-powersync-direct-mutation.md) | Approved after adding both intermediate acknowledgment cuts; 242 Node and 242 Chromium tests passed unchanged production, plus four guarded replays. |
| [Decode/refusal](2026-11-17-powersync-direct-decode.md) | Approved after removing generic resource cardinality and observing readiness callbacks; 105 tests per runtime and both guarded replays passed unchanged production. |
| [Persistence](2026-11-17-powersync-direct-persistence.md) | Approved after preserving observations across worker/host teardown; startup 208 Node and 28 OPFS tests passed, actual held receipt cleanup RED on all three hosts, injected cleanup controls passed. |
| [On-demand ownership](2026-11-17-powersync-direct-on-demand.md) | Approved after observing SDK resources before rescue and retaining public rejection diagnostics; original source fails ownership, held-receipt and mapper-cleanup comparisons on every required path. |
| [Shared client](2026-11-17-powersync-direct-shared-client.md) | Approved after preserving lawful allocation/release choices; 47 tests each on Node/Chromium and both guarded replays passed unchanged production. |

The linked records retain law authority, bounded histories, per-path reach,
exact commands/replays, mutants, ORC-001–016 outcomes and frozen hashes.
Calibration clean-baseline failures on already-RED histories are explicitly
separate from mutant kills. Setup failures and interrupted runs supply no
behavioral evidence.

## Production repair scope

The accepted laws require:

- Initial stream rejection ends the current load/reload with an error, including
  a lease already failed before the Collection acquired it.
- Every distinct reported stream failure stays open until recovery or the last
  affected lease releases. Releasing one shared lease preserves another's error.
- A stream failure after provider synchronization cannot disappear while an
  applied receipt is held by optimistic settlement.
- Cleanup from `getSubscriptions` prevents subsequent acquisition.
- Cleanup rejecting an abandoned initial receipt creates no detached rejection.

The source repair reuses existing cleanup and error paths. It catches the entire
initial continuation, tracks sets of errors by lease, and checks ownership before
clearing a shared cause. Immutable set snapshots fence asynchronous recovery.
Provider synchronization enables error reporting before application settlement;
request admission is checked again after the user mapper returns.

The dependency uses `Map.prototype.getOrInsertComputed`; the original Node 24
run failed at that builtin, while native Node 26 runs without a shim. The initial
repair added a Node 26 minimum, but the maintainer rejected that compatibility
change: TanStack DB supports all maintained Node versions. The added engine
restriction and public Node 26 requirement were removed. The SDK still needs an
upstream compatibility repair and release; running the evidence on Node 26 does
not establish support on older maintained versions. Four calls in its shared
standalone internals can use a local lazy Map helper instead of requiring the
new builtin. The PR's `.nvmrc` bump was also restored to the existing main-branch
value, `24.8.0`; changing the development default is a separate tooling decision.
Public parse documentation distinguishes loading error from a terminal health
error after readiness.

## Receiving checkpoint amendment

The first production attempt passed unwrapped on-demand tests, but the persisted
receiver reported a stale retired stream after a changed error. Causal
instrumentation found six health calls issued and only five delivered when the
child query's cleanup fulfilled. The wrapper deliberately serializes these calls
after startup. Its sixth call removed the stale cause five microtasks later.

The law and comparison were retained. Before revising the receiving instrument,
the reviewed source patch was saved and both production source files restored
byte-for-byte to the original head. The reviewed receiving amendment joins actual
issued health-call deliveries, independently of expected health. The final public
source-cleanup/resource cut stays unchanged. Its original-production RED and
independent re-review are recorded with the on-demand evidence before reapplying
the same source patch. The amendment passed independent review; original Node
comparisons remained RED (285 failed, 378 passed), as did the affected actual
Chromium comparisons (32 failed, 14 passed, 175 skipped). No receiving-premise
failure supplied that evidence. The append-only
[amendment snapshot](2026-11-17-powersync-direct-handoff-amendment-snapshot.json)
retains its 14 hashes; its SHA-256 is
`19cd654d8903ed3fbd8ae796c57be59d0a43218a2d9854649784f4b52b54a520`.

## Final coverage audit

The first repaired validation passed 1,538 Node tests, all 1,062 browser tests
across valid runs, TypeScript and both package builds. The final hostile audit
then identified an unproved post-mapper AbortSignal guard and missing receiving
histories for on-demand decoding and mapping. Both source files were restored to
the original hashes again before extending those instruments. The earlier
passing results remain historical, rather than evidence for tests authored later.

A public explicit-signal probe reached an aborted request while the source
remained ready. Original production transiently acquired and immediately released
a lease, with no HTTP request, retained resource or public readiness outcome.
Independent law review found no authority for prohibiting that transient
allocation. The extra post-mapper abort guard was removed from the repair;
the existing entry abort check and proved post-mapper source-admission check
remain. This is a bounded observation, not a universal equivalence claim or an
oracle kill. The corrected query-cleanup probe waits for the mapper to assign
its cleanup promise, then awaits that actual promise. All four variants release
their one acquired lease, abort the request and reject the retired query's
preload. The earlier probe could await an unassigned value; its apparent leak
was not a production counterexample.

The decode amendment now runs the same model through an actual on-demand query,
distinguishing an already-ready source from its pending initial query. All 207
checks passed on original production in both Node and Chromium. Independent
review approved its six frozen files, 47 per-mode states and guarded replays.

The mapper amendment adds equal/distinct parameter tuples, single-stream priority
forwarding, cached rows from an empty mapper and an isolated mapper failure with
an unaffected peer and successful retry. Review separated actual request dispatch
from correct priority in reach, and added current query status rather than
relying on an earlier fulfilled preload. It also found and reproduced a false
green: `fail(mapperError); throw mapperError` retained ready statuses and rows but
set terminal source health that the recorder did not inspect. The corrected
recorder and comparison reject that same decorator at the mapper-rejected,
mapper-retried and retry-retired checkpoints. Both reviewers independently
repeated the probe and approved the final slice.

The exact final original-production mapper gates registered 1,011 Node tests
across three receivers and 674 browser tests across two receivers. The affected
Node selection gave 51 failures, 303 passes and 657 skips; Chromium gave 34
failures, 202 passes and 438 skips. These are 60 semantic RED results across five
paths and 25 calibration failures whose selected clean baselines were already
broken. There were no setup, host, missing-delivery or receiving-premise errors.
Empty/throwing mapper, distinct-parameter and priority neighbors and the new
wrong-value/current-status/terminal-health controls passed on every path.

The [final test-only snapshot](2026-11-17-powersync-direct-final-test-snapshot.json)
retains all 67 test/support/config files immediately before the scoped repair was
applied. SHA-256:
`42ca68d5bd599187b1d3a5a70abb20ba4e7b396e1165e760f5c723ef66fd70da`.
It supplements the earlier snapshots. The final production hashes are:

```text
a30e71beb96fade6c5714a300ea76628386dd0b9b1ea04ad60ccf3ee9ae074fa  src/index.ts
00fb4cb1976ec8b384d01e1fbb483768204bc40b69a3dcc19ed21b4356b3e380  src/subsets.ts
```

Independent production review approved these exact hashes, including removal of
the unnecessary guard, with no remaining actionable source finding in scope.

## Deferred SDK event dependency

The user selected an SDK event API change and deferred same-connection recovery
until its release. SDK 0.1.1 suppresses `ready` to `ready` notifications and can
apply an unchanged or empty checkpoint without a table callback. The existing
recovery oracle and exact HEALTH-2 counterexample remain RED. No polling,
installed-package patch or relaxed health judgment is introduced.

The [SDK proposal](2026-11-17-powersync-standalone-checkpoint-api.md) and
[reviewable patch](2026-11-17-powersync-checkpoint-events.patch) prepare the missing
event separately. An SDK release and the subsequent adapter integration remain
required before claiming closure of that class.

The SDK proposal itself passed 33 tests and strict scoped TypeScript checking,
including independent review and executed reentry/membership mutants. It remains
a local patch, with no change to the installed SDK or remote repository.

## Validation and limits

The final explicit 12-file Node portfolio passed **1,988/1,988** on native Node
26.13.1. A single full eight-file actual Chromium run passed **1,396/1,396**,
including worker/OPFS persistence and both eager/on-demand decoding. The final
67 test fingerprints and both production fingerprints still matched afterward.
Full package TypeScript checking and ESM/CJS builds also passed. The ordinary
health-handoff helper checks passed 3/3. These results concern the repaired
portfolio; the generic eager recovery oracle intentionally remains RED.
Final `pnpm lint:changed` and `git diff --check` exit zero. That recorded lint
run used Node 24 and printed the subsequently removed engine warning; runtime
tests and builds used native Node 26. No lint errors or lowered-run-budget
warnings were reported. Runtime compatibility on the other maintained Node
versions remains unverified and blocked by the SDK builtin noted above.

Its guarded final replay executed exactly once and rejected HEALTH-2 at step 2:
complete empty result, stream failure, healthy unchanged empty checkpoint. The
coordinates remain seed `2118`, path `0:2:1:5:4:6:6:6:4`, property
`adapter-conformance.eager-live-source.powersync-direct`, unit
`random seed: all eager states, randomized construction 1`.

Full adapter TypeScript checking passed after building the local persistence-core
declarations. The named replay manifest checks passed 70/70. A wider replay
self-test run passed 121/124 before registry fixes; one unrelated receiving test
could not load the unbuilt `better-sqlite3` native addon. The two manifest failures
were corrected and the complete manifest group passed. Native-addon setup is not
an oracle rejection.

The repository size comparison against the original PR head measured the source
repair at 1,477 gzip bytes, versus 1,422 before: +55 gzip and +53 brotli bytes.
The normal app and all existing app scenarios were unchanged. Consolidating
failure normalization into `stop` reduced duplication; the remaining growth
buys distinct-error ownership, stale-recovery fencing and post-mapper admission.
No polling state or replacement lifecycle was added. Separately, the 67 frozen
test/support/config files grow by about 278 kB of raw source, and documentation
and review artifacts grow by about 288 kB. These files do not enter the shipped
bundle measurement.

## Evidence block

- **Law:** loading failures settle the initial gate; applied subset readiness
  waits for visible rows; every owned stream failure remains represented until
  recovery or final release; mapper failure affects its request; cleanup admits
  no new work for the ended sync run. Authority is the public Direct collection
  contract, core sync callback/receipt contract and glossary, cited beside each
  linked independent model. The SDK-deferred recovery obligation stays open.
- **Reach:** final fixed/fresh campaigns pass each declared reach obligation on
  each receiver. In particular, all 15 on-demand states have minimum-five reach
  per campaign on each of five receivers. Decode has 47 per-mode states across
  Node and Chromium; the initial gate has 12 distinct generated states and the
  receipt family has four across its required hosts. Linked family records
  retain per-path counts rather than using another host's reach as credit.
- **RED:** original-source comparisons fail at the intended law checkpoints on
  Node and actual Chromium, including persisted receiving paths. The final
  mapper gate gives 60 semantic REDs across five receivers. Failing clean
  calibration baselines, missing premises and teardown diagnostics are kept
  distinct from semantic kills. Exact commands and guarded coordinates are in
  the linked family records.
- **GREEN:** final source hashes above pass 1,988 Node and 1,396 Chromium checks,
  full TypeScript, builds and the recorded helper/manifest checks. Raw final
  logs are `.review-2377/production-final-amended-node.log` and
  `.review-2377/browser-production-final-full.log`.
- **Mutant:** the original implementation is rejected by the strengthened
  comparisons. The executed omitted-table-unlisten mutant is rejected by
  LIFE-2/LIFE-10. The mapper terminal-failure decorator that previously passed
  now fails at all three intended result comparisons. SDK event mutants and
  their distinct upstream scope are recorded separately.
- **Limits:** numeric one-field stream parameters and single-stream priority
  forwarding do not specify conflicting-priority merge semantics. The
  persisted empty-mapper held cut proves outer load admission; wrapper
  serialization can mask omission of the adapter's own applied wait there.
  Unwrapped receivers supply that adapter-boundary witness. Saved-demand
  coverage and durable offline reopen still need the separate Direct witness
  recorded in the coverage map. No universal adapter-law migration is claimed.

## Reproduce the final Node portfolio

From `packages/powersync-direct-collection`, using Node 26:

```sh
node ../../node_modules/vitest/vitest.mjs run \
  tests/collection.test.ts \
  tests/decode-refusal-oracle.property.test.ts \
  tests/eager-reload-conformance-oracle.property.test.ts \
  tests/initial-receipt-oracle.property.test.ts \
  tests/mutation-confirmation-oracle.property.test.ts \
  tests/mutation-confirmation-cancellation-oracle.property.test.ts \
  tests/on-demand-streams-conformance-oracle.property.test.ts \
  tests/on-demand-streams-persisted-conformance-oracle.property.test.ts \
  tests/persisted-initial-receipt-cleanup.test.ts \
  tests/persisted-initial-receipt-oracle.property.test.ts \
  tests/persisted-startup-conformance-oracle.property.test.ts \
  tests/shared-client-conformance-oracle.property.test.ts \
  --coverage.enabled=false --typecheck.enabled=false
node ../../node_modules/typescript/bin/tsc --noEmit
```

The generic eager file is intentionally absent from that GREEN command. Its
guarded replay above remains RED. Actual Chromium commands and runtime details
are in the persistence record. The final size command, from the repository root,
was `node scripts/size-compare.mjs --base HEAD --exact-base --packages
powersync-direct-collection --files --rebuild`; it rebuilt the working packages
after the standalone build. `.review-2377/production-final-size-rebuilt.log`
retains the result.

The evidence is bounded to the histories and runtime paths in the coverage map.
The SDK itself receives controlled legal protocol data. No deployed PowerSync
service, arbitrary concurrency, every framework scheduler or every storage host
is established. The explicitly deferred same-connection recovery counterexample
prevents a claim that the entire stream-health class is closed.


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

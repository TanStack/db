# On-demand stream oracle: test-only RED evidence

Reviewed production head: `92a1493e0f45dbfd1fc3a51460ccb9228d8f787d`.
The source adapter remains unchanged. This record describes the test-only gate;
it claims no repaired GREEN result, production-mutant kill or bug-class closure.
The parent owns the coverage-map/registry/replay-manifest integration.

## Law and authority

Distinct logical subset owners may share provider streams. Retiring one owner
cannot remove the only source failure while another ready owner retains a
failed stream. A failure supported solely by retired owners must disappear.
Recovery clears prior failures even when the SDK supplies new Error identities.
Successful subset readiness waits for applied source rows. An error received
after provider synchronization but before application cannot produce a healthy
successful initial query; rejecting that query remains permitted. Public cleanup
invalidates a sync run synchronously, including cleanup from getSubscriptions,
and leaves no provider work retained for that ended run.

Authority is `docs/collections/powersync-direct-collection.md` (On-Demand Sync
and Errors), `docs/guides/error-handling.md` (reportError/reportHealthy), and the
project glossary's logical subset owner, demand retirement, applied settlement
and cleanup. The eager live-source family excludes on-demand loading; this
family fills that boundary rather than changing the eager law.

The model records an authored query-to-stream incidence relation, not the SDK's
leases, acquisition cache, error object identities or adapter branches. SDK
leases may report only their first failed stream. Accordingly health is an
admissible set: at least one failure while a retained ready demand is failed;
every reported stream must remain supported by a retained failing demand.
Count, first-versus-latest choice and duplicate Error identities are free.

## Grammar, public receiving paths and cuts

One shared family owns the law/model/grammar/comparison:
`packages/db-adapter-conformance/tests/on-demand-streams-oracle.ts`.
Its shared driver creates actual public source and live-query Collections,
starts real query preloads, creates a real optimistic transaction for the held
application boundary, and invokes public query/source cleanup. The real installed
`@powersync/standalone-client` 0.1.1 receives controlled NDJSON HTTP responses.
Wrappers only record actual SDK acquisition/release/error/wait calls and actual
commit receipts; they neither provide rows/readiness nor calculate expected
answers. Active stream inventory is acquired-minus-released real SDK leases.
Public SDK/source states and this inventory are captured before fixture rescue.

Ownership histories cross same/partial/disjoint streams, either failing owner
or all, either retiring owner, unchanged/changed errors and optional recovery.
Settlement histories put the error before provider sync, between sync and
application, or after application. Admission histories clean up during mapping
or after successful application. Coordinates 0..10000 vary names, 1..3 rows
vary result size, and values -20..20 supply legal writes. Zero source rows are
outside the held-application premise, which needs an actual write receipt.
The row comparison judges IDs and readiness, not complete value fidelity.

Removing overlap loses shared-error retirement; removing failing/retiring side
loses isolated retirement; removing changed errors loses stale identity cleanup;
removing recovery loses outage settlement; removing timing merges provider and
applied settlement; removing admission timing loses synchronous user-callback
cleanup reentry. Invalid timings, a third logical owner, a recovery-only history
without an outage, and a held application without source writes are excluded
constructively. Fixed witnesses reconstruct the original two bugs, independent
retirement, mapper cleanup and ordinary loaded cleanup. Generated constructions
retain free coordinates while supplying each required relationship.

Cuts are loaded, failed, changed-error, owner-retired, recovered,
receipt-held/failed-visible-load, failed-initial-load and source-cleaned-up as
applicable. At owner-retired, the active SDK stream union must equal the retained
owner's streams. Every history also awaits public source cleanup and observes
empty SDK inventory plus idle SDK and cleaned-up source, before fixture teardown
can rescue a leaked lease. This catches a shared-stream leak that would still
have the same stream union while a sibling remains. The held receipt is a real
public commit receipt. Its optimistic hold begins after the remote demand is
admitted, before source delivery, so persisted startup hydration is not blocked.

Required receiving paths share the same model, grammar, budgets and comparison:

- Unwrapped Node SDK: `adapter.powersync-direct.on-demand-streams`.
- Persisted controlled storage: suffix `.persisted-controlled`.
- Persisted actual Node SQLite: suffix `.persisted-node-sqlite`.
- Actual Chromium, unwrapped: suffix `.chromium`.
- Actual Chromium with public persistence wrapper and worker/OPFS:
  suffix `.persisted-chromium-opfs`.

Persistence changes only the receiving path through public
persistedCollectionOptions. No saved-row/restart durability follows from these
public cuts; the persisted-startup owner retains that responsibility. A real
PowerSync Service is not exercised. Controlled HTTP conformance is not evidence
of deployment configuration or remote-service behavior.

## Reach and RED

Each property declares ten states, with five fresh-object randomized constructed
builders per state in both fixed-seed 2377 and random campaigns. A WeakMap ledger
also checks each builder's generated outputs, since the pinned framework does
not associate those fresh outputs with builder obligations. Every builder has a
bound missing-state calibration. Known product failures make some selected
clean baselines fail; those calibration failures are not mutant kills.

`subsets-final-reach-measured.log` records an additional diagnostic using the
same constructions/production driver/model/check. It separately checks actual
state reach while retaining known semantic mismatches as data. For each Node
host and both fixed/random seeds, the ten counts are shared-error-retained 5,
independent-error-retired 15, partial-overlap-retired 5,
stream-error-before-sync 5, stream-error-before-application 5,
stream-error-after-application 5, error-identity-changed 10, stream-recovered 5,
mapping-cleanup 5 and loaded-cleanup 5. These diagnostic counts are measured
receiving evidence, not a semantic GREEN claim; they supplement the normal
campaigns' enforced construction obligations.

The full Node command is run from packages/powersync-direct-collection with
Node 26 at `/Users/kyle.mathews/.npm/_npx/bac97da9607b7ef2/node_modules/node/bin/node`:

```sh
NODE26 ../../node_modules/vitest/vitest.mjs run \
  tests/on-demand-streams-conformance-oracle.property.test.ts \
  tests/on-demand-streams-persisted-conformance-oracle.property.test.ts \
  --coverage.enabled=false --typecheck.enabled=false
```

Logs retain original and reduced public cuts. Original witnesses expose loss of
shared health at owner-retired, false healthy success at failed-visible-load,
and public cleanup ending with source cleaned-up but SDK still syncing.
Nearby independent retirement, before-sync rejection, after-application error
reporting and ordinary loaded cleanup pass. Changed Error identities also expose
stale retired failures and failures surviving provider recovery.

The first persisted attempt blocked empty hydration by starting the optimistic
mutation too early. Its setup timeout is explicitly not product RED. The corrected
shared schedule starts the query and waits for actual getSubscriptions admission,
then starts the mutation before provider data. `subsets-persisted-setup-attempt.log`
and `subsets-persisted-fixed-diagnostic.log` retain the rejected setup evidence;
`subsets-persisted-fixed-red.log` and the final campaigns use the corrected path.

## ORC checklist

- ORC-001: authority/limits above and beside the model/registration.
- ORC-002: independent authored incidence, no production semantic helper/model
  imports. Production parseLoadSubsetOptions is used only to drive real requests.
- ORC-003: contract/model/grammar/driver/check prose is adjacent in named modules.
- ORC-004: reconstruction, axis ablation, bounds and invalid neighbors above.
- ORC-005: actual public Collections, SDK callbacks, real receipt and public cuts;
  no missing provider fact hypothesis remains at those cuts. Deployed-service
  behavior is outside this controlled-HTTP boundary.
- ORC-006: clean-neighbor calibrations reject false healthy state, retained SDK
  work after cleanup, missing required reach and cleanup diagnostics. Production
  still fails the semantic baseline, so failing bound calibrations are not kills.
- ORC-007: same fixed/random property and run budget 60; checked seed/path/unit
  replays are appended below for every receiving host.
- ORC-008: equal rows cannot merge distinct stream incidence: owner retirement
  distinguishes same/partial/disjoint. Provider-sync success cannot merge with
  application: releasing the held optimistic transaction distinguishes them.
- ORC-009: left/right model owners mean distinct logical equality demands;
  incidence combines query-to-provider mapping, not production acquisition state.
  mapping/loaded cleanup are history premises; SDK/source states remain canonical.
- ORC-010: completed cuts survive teardown failures. Suite compares semantic law
  first, retaining secondary cleanup strings in the raw result; if semantic law
  passes, cleanup diagnostics fail independently. A calibration supplies both
  a false healthy result and cleanup diagnostics to check semantic priority.
  Fixture rescue occurs after raw public cleanup cuts and cannot erase them.
- ORC-011: no named shared semantic fault with a different practical formulation
  has been proposed for this bounded incidence law. Fresh reviewer findings are
  handled before production; this does not claim exhaustive semantic independence.
- ORC-012: this exact-head record covers all numbered requirements and open work.
- ORC-013: shared versus independent retirement distinguishes removing all errors
  from removing the retired owner's claim; pre-sync/held/post-application errors
  distinguish provider completion from applied settlement; mapper/loaded cleanup
  distinguish reentrant admission from ordinary resource release.
- ORC-014: the real SDK supplies lease callbacks, stream Error reuse/changes and
  wait settlements. Controlled persistence is received by real Node SQLite and
  actual Chromium worker/OPFS; those browser results are appended separately.
  There is no controlled-to-deployed-Service claim.
- ORC-015: ten states, five distinct randomized builders each, generated-output
  ledger, bound missing-state controls and measured receiving counts above.
  Full clean-baseline calibration GREEN remains blocked by production defects.
- ORC-016: fixed histories share the same model/driver/check, with no separate
  expected answer. Temporary diagnostic probes are archived outside discovery.

## GREEN, mutants, limits and remaining work

GREEN and production-mutant evidence are intentionally pending. The parent must
approve the test-only review gate before changing production. Restoring original
production after a future repair should reject the same checkpoints. New
calibrations judge wrong traces; they are not claimed as production-mutant runs.
The semantic bug class remains open while these reachable counterexamples exist.

Known limits: two equality demands, up to three streams and three source rows,
one optimistic insert, one outage, finite error replacement/recovery, one source
Collection in this family, and one final cleanup. Arbitrary request/cache shapes,
reload/restart, default/passive streams and shared-client peer Collections require
their separate receiving owners. No elapsed-time bound, complete value fidelity,
durability-across-restart or real remote-service claim follows.

## Receiving review amendments before production

A fresh receiving-path reviewer found two gaps in the test diff, before any
production repair. The first was fixture rescue of a leaked multi-owner SDK
lease. Active SDK stream inventory is now judged at owner retirement, and every
history has a post-public-cleanup cut before fixture rescue. A clean-neighbor
calibration injects a retained SDK stream and syncing provider after cleanup and
is rejected at the intended semantic checkpoint. A missing inventory field is
also rejected, including when the expected set is empty.

The second gap was discarded preload rejection diagnostics. The recorder now
classifies each public rejection before browser serialization using the real
SDK's `instanceof StreamError`, and copies its stream.name and messages. SDK
StreamError.name is `Error`, so name alone is deliberately not the category
observation. The independent model permits only an authored failed stream and
its exact authored outage message (`rejected-1-<stream>`). Three independent
calibrations change category, stream and messages on the clean before-sync
construction; each must be rejected. The documented contract promises these
fields, not identity with an SDK-owned Error object, so no identity constraint
was invented. The initial ordinary shape probe is retained outside discovery.

The complete inventory browser campaigns ran unchanged production:
`subsets-browser-inventory-pre-edit.log` has 190 failures and 244 passes across
434 tests, with no receiving/host/page setup failure. The newly registered
fixture-rescue calibration was then run independently on both browser hosts:
`subsets-browser-rescue-calibration.log`, 2 passed and 434 skipped. This is one
complete run of all prior histories and checks, plus the new calibration; it
is not claimed as one 436-test normal invocation.

Both browser paths have checked direct replay logs:
`subsets-chromium-checked-replay.log` and
`subsets-persisted-chromium-opfs-checked-replay.log`. Each selects campaign seed
2377, shrink path `0:0:0:0`, unit `random seed: shared-error-retained construction 1`,
with its exact receiving property ID. Each executes one run/one driver execution
and reproduces the original shared-owner failure at owner-retired. The replay
logs retain the actual public trace; the framework's printed interface alone
is not cited as evidence.

The rejection-fidelity addition changes observations/checks only on rejected
query cuts. Browser receiving is therefore rerun over all before-sync and
before-application constructions, their relevant fixed history and the three
new calibrations. Existing ownership/admission/cleanup cuts and budgets are
unchanged; their completed full campaigns and checked replays above retain their
original evidence. The affected-slice result is appended when complete.

## Final Node gate and checked replays

The final complete Node run on unchanged production uses 221 tests per receiver,
663 total: 285 failed and 378 passed, in 6.03 seconds. There are no receiving
premise failures. Of the failures, 195 are intended semantic comparisons against
known product defects and 90 are bound calibrations whose selected clean
baselines already fail those same defects; the latter are not calibration kills.
All three category/stream/message diagnostic corruptions pass their calibration
on all three receivers. `subsets-final-node-red.log` is the complete log.

Each following exact replay was executed after the rejection-fidelity addition.
Every replay selects only one unit, reports one failed comparison and leaves
all other tests skipped. Commands use the same Node 26 executable and Vitest
flags as above, with unit `random seed: generated`:

| Receiving property | Campaign seed | Shrink path | Reproduced mismatch |
| --- | ---: | --- | --- |
| adapter.powersync-direct.on-demand-streams | -1072223574 | 2:0:0:0:0:0:0:0 | Recorded in subsets-final-replay-direct.log |
| adapter.powersync-direct.on-demand-streams.persisted-controlled | -1688972466 | 0:0:0:0 | Recorded in subsets-final-replay-controlled.log |
| adapter.powersync-direct.on-demand-streams.persisted-node-sqlite | 1621620866 | 0:0:0:0:0:0:0:0 | Recorded in subsets-final-replay-node-sqlite.log |

Set TANSTACK_DB_ORACLE_PROPERTY, TANSTACK_DB_ORACLE_SEED,
TANSTACK_DB_ORACLE_PATH and TANSTACK_DB_ORACLE_UNIT to the row's coordinates.
Direct replay uses tests/on-demand-streams-conformance-oracle.property.test.ts;
both persisted receivers use
 tests/on-demand-streams-persisted-conformance-oracle.property.test.ts.
The replay logs retain the exact command, history, public expected/actual cuts
and mismatch. A reduced retirement/recovery failure remains the same modeled
law and checkpoint; no setup timeout substitutes for its comparison.

Focused ESLint and pnpm lint:changed pass. Package typecheck reports only the
existing browser wa-sqlite-driver unresolved @tanstack/db-sqlite-persistence-core
module (two sites) and resulting implicit-any SQL parameter. No on-demand file
has a type error. The full output is subsets-typecheck.log; this is a bounded
on-demand validation statement, not a package-wide typecheck GREEN.

## Final browser rejection slice and independent review

The affected Chromium rejection-fidelity slice completed on both unwrapped and
persisted worker/OPFS receivers: 32 failed, 58 passed and 352 skipped out of 442
registered tests, in 16.69 seconds. The failures retain the already known held
application semantic defect and its bound-calibration failing clean baselines;
they are not new diagnostic-fidelity failures. All category/stream/message
corruptions and clean before-sync witnesses pass. The complete log is
subsets-browser-rejection-fidelity.log. It supplements the complete inventory
campaigns, not a replacement for their ownership/admission/cleanup evidence.

Independent reviewer oracle_diff_paths approved the scoped code/law against all
12 entries in subsets-final-file-hashes.txt after confirming both receiving
corrections. Its independent Node run of clean before-sync plus the three
diagnostic calibrations passed 12/12 across the three Node receivers. Its
independent mapping-cleanup check also recorded the intended semantic RED:
cleaned-up source, syncing SDK and activeStreams [common-0]. Approval concerns
the test-only instrument and its bounded evidence, not production readiness or
bug-class closure. Parent owns final global manifest and production gate.

## Recovery decision and boundary

The user deferred same-connection recovery until the SDK supplies the required
checkpoint event API. The law remains: a healthy provider checkpoint that ends
a stream failure must clear that stream's source-health failures. Its reachable
counterexample remains documented RED; this test work does not authorize polling
or silently retire the law. The parent records that product decision and open
owner in the global coverage map.

This family's existing stream-recovered receiving schedule explicitly closes
the HTTP provider request, waits for a new actual SDK request, and supplies a
healthy checkpoint. It therefore supplies reconnect recovery evidence, not a
same-connection receiving witness. Error identity retirement, held application,
reentrant cleanup and the other laws above remain independently required. No
same-connection closure is inferred from the reconnect schedule.

## Exact scoped file snapshot

The following SHA-256 values identify the code/law snapshot independently
reviewed above. Production index.ts and subsets.ts remain original.

```text
9d01642d402de72153166ad841d6b475e3edb1024f87039cf22f83cd46192123  packages/db-adapter-conformance/tests/on-demand-streams-oracle.ts
c11b579081695cdea4cf1394f087d3fb49900017608baa971b3766f480389cfe  packages/db-adapter-conformance/tests/on-demand-streams-driver.ts
cb23d4692c42010f2fa30bf7a42a9a2fd6442d94beffcf451f9950aaf049b6ee  packages/db-adapter-conformance/tests/on-demand-streams-oracle-suite.ts
c1a75d9d9fc605ff5f79e628428b24665b54958690a3d102b88f99cf092f6d20  packages/powersync-direct-collection/tests/on-demand-service.ts
70e583b1616cdf2b2363691e2715baa19a3490189760da339b4661b6b1838032  packages/powersync-direct-collection/tests/on-demand-streams-driver.ts
e2c17b7a6388760823ed770cce5f388c14ffa93635c8468b0d00b2b725dea045  packages/powersync-direct-collection/tests/on-demand-streams-persisted-driver.ts
f612397701661be4eefe740fbfcfb8d975869ebfe742f7ff0574b62b03f3746b  packages/powersync-direct-collection/tests/on-demand-streams-conformance-oracle.property.test.ts
c90017d3f4b4b61b33290f15c542dd600e7516a99e680beeac7c80d3d94c849d  packages/powersync-direct-collection/tests/on-demand-streams-persisted-conformance-oracle.property.test.ts
7800e67373cff0aecb4986911b810251d93cbd8f2c46e10cafda19715faf8201  packages/browser-db-sqlite-persistence/e2e/powersync-direct-subsets-oracle.browser.test.ts
a697d01bc4c2146f35ff7466176f08f6944dfa40a21eac794d1bc54a99f1731f  packages/browser-db-sqlite-persistence/e2e/powersync-direct-persisted-subsets-oracle.browser.test.ts
4cafcd3e53977c30511a85e1482be2e0bda2ad75ab0788d1d49e71a8db78761f  packages/powersync-direct-collection/src/index.ts
73a8f7e6112f4d3192ce309c9f5bce8bb0f0eedb371ad4b755130dec13437495  packages/powersync-direct-collection/src/subsets.ts
```

## Ordered persistence report handoff amendment

A first production attempt made the direct receiver green, but persisted
changed-error retirement still failed. A causal scratch diagnostic located an
observation error. The real source issued two reportHealthy calls for the
retired owner's two Error identities. At query.cleanup fulfillment, persistence
had forwarded the first call and still queued the second. Both controlled
storage and Node SQLite recorded six health calls issued and five delivered;
the stale retired Error disappeared when the sixth call reached core, five
microtasks later. Per-call delivery acknowledgments reached the same result
without reading health to decide when to stop. The diagnostic is retained at
.review-2377/persisted-health-handoff-diagnostic.log and its archived probe.

The original inventory's immediate owner-retirement wording is historical. For
persisted receivers, the current receiving cut is after public query cleanup
and after delivery of every source health call already issued by that
controlled retirement. The public persistence guide's Errors and limits section
preserves report meaning but does not promise that child-query cleanup drains
the source wrapper's asynchronous report queue. The persisted-readiness owner
also states ordered delivery. The wrapper's afterStartup queue explains the
separate bridge boundary; its current output is not authority for expected
health values. This is an evaluation/checkpoint correction under the
adversarial review repair-location table, not a change to the health law.

Before authoring that correction, the parent saved the production attempt in
.review-2377/production-reviewed-attempt.patch and restored original index.ts
and subsets.ts bytes. The model, history grammar, fixed witnesses, declared
states, run budgets and expected health remain unchanged. New source changes
were not used to shape a passing expectation.

The receiver now records issue immediately before the source calls persistence,
and delivery after persistence forwards the same method and raw Error value
to core. A finite captured set of per-call acknowledgments establishes the
receiving premise. The instrument does not inspect health, calculate expected
values, count arbitrary turns or wait for a later provider event. Raw results
retain issued/delivered/pending counts beside each affected comparison.
Controlled provider delivery and query cleanup issue their relevant calls
before that target is captured; the driver supplies no later provider event
until after the comparison. Unwrapped sources omit this hook entirely, and the
shared driver adds no await to their original timeline.

Final release reports are delivered while the source remains active, before
public source cleanup can invalidate queued callbacks. The resource observation
still follows the same public source cleanup promise, before fixture rescue.
Admission cleanup keeps its original public cleanup boundary; it does not wait
for callbacks that cleanup may lawfully discard.

The ordinary helper calibration file
packages/db-adapter-conformance/tests/health-report-handoff.test.ts has three
passing checks: missing acknowledgment fails even when forwarding returned,
another Error cannot acknowledge the target, and later reports do not extend
the captured target. Missing acknowledgments are receiving-premise failures,
not semantic production-mutant kills. They use a short diagnostic timeout only
to prove the instrument cannot pass without its delivery evidence.

The restored original production remains RED through the amended instrument:

- Full Node: 663 tests, 285 failed and 378 passed, in 8.70 seconds; zero missing
  acknowledgments or setup failures. The same 195 semantic defects and 90
  bound-calibration failing clean baselines remain. Complete log:
  .review-2377/health-handoff-original-node-red.log.
- Affected actual Chromium worker/OPFS receiving: 32 failed, 14 passed and 175
  skipped out of 221 tests, in 79.46 seconds. The failures are 22 original
  semantic comparisons and 10 selected-clean-baseline calibration failures;
  the independent-retirement neighbor passes. Raw comparison handoffs record
  issued equal to delivered and pending zero. There are no missing-ack,
  host, setup or receiving-premise failures. Complete log:
  .review-2377/browser-handoff-original-affected.log.
- The three handoff controls pass. Focused lint passes, and package tsc exits
  zero under the current dependency/build state. This supersedes the earlier
  unresolved-module typecheck result without rewriting that historical result.

These results show that waiting for actual callback delivery preserves the
original defect's failure at the intended comparison. They do not claim a
repaired GREEN result. The same saved production patch may be reapplied only
after independent review approves this exact receiving amendment.

The amendment's exact scoped snapshot follows. Its model and suite hashes are
identical to the original test gate, and its production hashes are original.

```text
9d01642d402de72153166ad841d6b475e3edb1024f87039cf22f83cd46192123  packages/db-adapter-conformance/tests/on-demand-streams-oracle.ts
214aa23c736c4b994741c92871b3b71802989aea68bda14358a20952261411e9  packages/db-adapter-conformance/tests/on-demand-streams-driver.ts
cb23d4692c42010f2fa30bf7a42a9a2fd6442d94beffcf451f9950aaf049b6ee  packages/db-adapter-conformance/tests/on-demand-streams-oracle-suite.ts
c1a75d9d9fc605ff5f79e628428b24665b54958690a3d102b88f99cf092f6d20  packages/powersync-direct-collection/tests/on-demand-service.ts
9bcae7b5e5d3784c0809f928102d454b6297dac6816c3f4364e3aceadb5423cc  packages/powersync-direct-collection/tests/on-demand-streams-driver.ts
d3f04b5c8cf3009e9efc70c3da7136fe89d89a473ce01572a7b17e0064e84082  packages/powersync-direct-collection/tests/on-demand-streams-persisted-driver.ts
f612397701661be4eefe740fbfcfb8d975869ebfe742f7ff0574b62b03f3746b  packages/powersync-direct-collection/tests/on-demand-streams-conformance-oracle.property.test.ts
c90017d3f4b4b61b33290f15c542dd600e7516a99e680beeac7c80d3d94c849d  packages/powersync-direct-collection/tests/on-demand-streams-persisted-conformance-oracle.property.test.ts
7800e67373cff0aecb4986911b810251d93cbd8f2c46e10cafda19715faf8201  packages/browser-db-sqlite-persistence/e2e/powersync-direct-subsets-oracle.browser.test.ts
a697d01bc4c2146f35ff7466176f08f6944dfa40a21eac794d1bc54a99f1731f  packages/browser-db-sqlite-persistence/e2e/powersync-direct-persisted-subsets-oracle.browser.test.ts
4cafcd3e53977c30511a85e1482be2e0bda2ad75ab0788d1d49e71a8db78761f  packages/powersync-direct-collection/src/index.ts
73a8f7e6112f4d3192ce309c9f5bce8bb0f0eedb371ad4b755130dec13437495  packages/powersync-direct-collection/src/subsets.ts
9ee1acac3abe1948c4c9683ed1002b33f083b24cb681b409931228bcee228fa1  packages/db-adapter-conformance/tests/health-report-handoff.ts
6fad1e971d06085c8056c2ed2080f57ee62afc94619765747210ca9b681cd093  packages/db-adapter-conformance/tests/health-report-handoff.test.ts
```

Independent reviewer oracle_diff_paths approved the exact-hash handoff
amendment. It confirmed that the instrument waits only for already-issued
callbacks to reach core, records delivery counts, never polls expected health,
and preserves both the unwrapped timeline and model. It independently passed
the three helper controls and confirmed original Node semantic RED. Its final
remaining prerequisite was the original-production Chromium comparison; the
completed affected OPFS result above satisfies that prerequisite. The reviewed
production patch may now proceed to reapplication and separate GREEN checks.

## Reapplied production result and measured reach

After the receiving amendment passed independent review and the restored-original
Node/OPFS RED gate, the parent reapplied the exact saved production patch.
`.review-2377/production-final-node.log` records the explicit 12-file Node
validation: **1538/1538 passed**, in 37.58 seconds. This includes **221/221** for
each of unwrapped Node, persisted controlled storage and persisted Node SQLite,
so all **663/663 on-demand tests pass**. The three ordinary handoff controls also
pass; package typecheck and build are GREEN. The earlier interrupted broad run
is not cited as GREEN.

The table reports actual reach in the final normal Node campaigns, aggregated
from each campaign's constructed-unit records and ordinary generated-unit
record. Fixed histories and calibrations are excluded. A history may enter
several states, so columns do not sum to a history count. Each state has five
separately enforced randomized constructions per campaign; their contributions
are five each, except independent-error-retired (15) and error-identity-changed
(10), which also occur in other constructions.

| Declared state | Fixed 2377, each Node receiver | Random, direct Node | Random, controlled persistence | Random, Node SQLite |
| --- | ---: | ---: | ---: | ---: |
| shared-error-retained | 14 | 10 | 9 | 14 |
| independent-error-retired | 28 | 27 | 29 | 28 |
| partial-overlap-retired | 12 | 13 | 12 | 9 |
| stream-error-before-sync | 11 | 11 | 14 | 14 |
| stream-error-before-application | 9 | 12 | 10 | 9 |
| stream-error-after-application | 17 | 11 | 10 | 12 |
| error-identity-changed | 21 | 24 | 20 | 23 |
| stream-recovered | 16 | 13 | 13 | 17 |
| mapping-cleanup | 12 | 11 | 12 | 11 |
| loaded-cleanup | 7 | 15 | 14 | 13 |

The final actual Chromium worker/OPFS persisted receiver also passes **221/221**
on the amended receiving instrument and approved source patch, in 108.29
seconds, exit zero. Its complete log is
`.review-2377/browser-production-persisted-final-green.log`. Its fixed campaign
has the same reach column above. Its random total reaches, in table order, are
11, 26, 15, 11, 11, 10, 21, 14, 14 and 12. All five constructions per state in
both campaigns and every calibration pass. This is actual worker/OPFS evidence;
it does not infer durability across restart or deployed-service behavior.

The original RED comparisons above serve as the original-implementation mutant:
restoring that implementation rejects shared error retirement, held application,
changed-error retirement/recovery and mapper cleanup through the same model,
driver and comparison. This bounded evidence closes those exercised source
repair cells. Same-connection recovery remains the explicitly deferred SDK API
boundary described earlier; a green reconnect schedule does not close it.

Final source hashes for the applied result:

```text
a30e71beb96fade6c5714a300ea76628386dd0b9b1ea04ad60ccf3ee9ae074fa  packages/powersync-direct-collection/src/index.ts
65792b89c427219806dab3f24ac1ae55c8ec3eef580bdc12055a9887fdb6d10c  packages/powersync-direct-collection/src/subsets.ts
```

## Mapper-contract amendment after the historical GREEN runs

The earlier GREEN sections describe their recorded snapshots. A later
completeness review found three unexercised public mapper dimensions: stream
parameters/priority, an empty mapping reading donor-cached rows, and a throwing
mapper followed by retry. Production was restored to its original bytes before
extending this same primary owner. The pre-edit inventory and ordinary probe
logs are preserved under `.review-2377/`; none of the probes remains in package
test discovery.

A proposed post-mapper abort check was also challenged. A public
`subscribeChanges(listener, { includeInitialState: false })` subscription followed by
`requestSnapshot({ signal })` let the mapper synchronously abort the actual
request while the source remained `ready`. Original production briefly acquired
one SDK lease, then retained no stream and made no HTTP request. The abort
contract does not forbid that transient acquisition. This bounded trace supplies
no reason for an extra post-mapper signal guard; the proposed production guard
was withdrawn. A preliminary query-cleanup probe did not await its asynchronously
assigned cleanup promise. Correctly awaiting the actual callback and promise
also showed matching acquisition/release, rather than the originally suspected
leak. These probes are not semantic RED evidence and do not support a
zero-transient-allocation law.

### Laws, independent coordinates, and receiving cuts

The existing on-demand contract says that equal stream names and parameters
share demand, and the documented stream configuration accepts parameters and a
priority override (`docs/collections/powersync-direct-collection.md`, stream
configuration and On-Demand Sync). The model now authors equal or distinct
single-field numeric parameter tuples under the same stream name. Its identity
encoding is a label for those authored coordinates, independent of SDK
normalization and resource bookkeeping. Loaded observations compare the actual
HTTP subscriptions with the distinct authored coordinates. Real SDK error causes
and acquired-minus-released inventories retain the same public name/parameter
coordinates through peer retirement. Prior name-only, partial-overlap,
changed-error and reconnect histories remain intact. A single-stream history
checks priorities 1–3 at the real HTTP request; no conflicting-priority merge
policy is invented.

An empty mapper result owns no provider stream. A ready donor first supplies
cached rows, then supplies changed values behind a genuinely held applied
receipt. The cached-only right query stays pending while that receipt is held,
and its later successful rows must contain the changed donor values, not the
older cache or the optimistic row. Retiring the donor while this reader remains
ready leaves the retained stream inventory empty. The source's table listener
can still keep the SDK provider session running, so this cut does not demand an
`idle` provider status. Final public source cleanup still demands `idle` and an
empty inventory before fixture rescue.

The receiving cut is explicit. Unwrapped Node/Chromium reach the actual empty
mapper and a fulfilled real SDK wait while the donor receipt remains pending.
Persistence can serialize subset restore before upstream mapping: its
controlled, Node SQLite, and Chromium worker/OPFS receivers therefore record
actual outer `loadSubset` admission and public query pending while that receipt
is held. After release they require the actual empty mapper, real SDK wait and
changed cached rows. Results record `emptyMappingBoundary` as `provider-wait` or
`load-admission`. The wrapped cut does not claim that the upstream adapter's
post-wait path executed while held, and cannot earn that path's mutant credit.

A throwing mapper is a failed request, not a source failure or a new provider
owner. The receiver authors one Error, throws it before acquisition, and
classifies the public query rejection by exact raw Error identity. The retained
donor stays ready with its rows, health and streams intact. A fresh right query
then retries successfully, reads the shared source rows, and releases
independently. These histories extend the same logical incidence and applied
settlement model; no second model copies adapter resource machinery.

Five states were added: `parameter-equal-retained`,
`parameter-distinct-retired`, `priority-forwarded`, `empty-mapping-applied`, and
`throwing-mapper-retried`. Each has five fresh randomized constructions and
bound missing-state controls. The prior ten states, all constructions and fixed
histories, the 60-run budget, and fixed/random campaign parity remain intact.
Five fixed inputs replay the shared model/driver/comparison. Four additional
wrong-observation controls reject dropped priority, premature empty-request
fulfillment, stale cached values, and a replacement mapper Error.

The grammar reconstructs the known shared-failure trace with an equal parameter
tuple, the independent-retirement neighbor with distinct tuples, and all three
mapper schedules. Removing parameter equality loses same-name identity;
removing the single priority loses forwarding; removing the held donor update
loses applied settlement; removing retry loses recovery from mapping failure.
The bounded tuple domain has one integer field and equal/adjacent-distinct
values. Priorities are 1–3. Malformed mapping returns, non-Error throws,
conflicting priorities, arbitrary parameter objects and a third logical owner
are outside this amendment. Source cleanup and mapper throws are separate legal
actions; an abort with no public leak is not classified as either defect.

### Original-production receiving gate

The unchanged source hashes for every gate below were:

```text
4cafcd3e53977c30511a85e1482be2e0bda2ad75ab0788d1d49e71a8db78761f  packages/powersync-direct-collection/src/index.ts
73a8f7e6112f4d3192ce309c9f5bce8bb0f0eedb371ad4b755130dec13437495  packages/powersync-direct-collection/src/subsets.ts
```

Frozen affected selector:

```text
mapper|parameters|parameter-|priority-forwarded|empty-mapping|throwing-mapper|priority omission|cached-only
```

Node 26 runs the two normal on-demand receiver files with that selector,
`--coverage.enabled=false --typecheck.enabled=false`. The complete log is
`.review-2377/mapping-contract-original-node-frozen.log`. Actual Chromium runs
the two existing browser registrations with the same selector; its log is
`.review-2377/browser-mapping-original-affected.log`.

| Receiving path | Semantic RED | Calibration clean-baseline RED | Passed | Skipped |
| --- | ---: | ---: | ---: | ---: |
| Unwrapped Node SDK | 12 | 5 | 99 | 219 |
| Controlled persistence | 12 | 5 | 99 | 219 |
| Node SQLite | 12 | 5 | 99 | 219 |
| Actual unwrapped Chromium | 12 | 5 | 99 | 219 |
| Actual Chromium worker/OPFS | 12 | 5 | 99 | 219 |

Each registration contains 335 tests. Node totals are 51 failed, 297 passed and
657 skipped; browser totals are 34 failed, 198 passed and 438 skipped. Every
semantic RED is the existing health-loss class on equal-parameter peer
retirement (ten generated constructions plus one fixed replay per receiver), or
the existing mapper-triggered source-cleanup leak (one fixed replay per
receiver). The five calibration failures per receiver fail their clean
baseline, so they are not checker kills. There are zero receiving setup,
receipt, health-acknowledgment or host-premise failures. Distinct parameters,
priority, empty mapping and mapper throw/retry all pass, including all four new
wrong-value calibrations on all five paths.

For each receiving path, each of the four passing new states records five
non-fixed construction reaches in the fixed campaign and five in the random
campaign. The equal-parameter state occurs in every failing generated
construction's raw `reached` result before the shared semantic comparison
rejects its health observation. Full normal repaired campaigns and clean
missing-state controls remain a separate GREEN obligation; failed baselines
cannot discharge it.

The original equal-parameter failure was directly replayed with
`TANSTACK_DB_ORACLE_SEED=2377`, `TANSTACK_DB_ORACLE_PATH=0:0:0:0:0:0`, property
`adapter.powersync-direct.on-demand-streams`, and unit
`random seed: parameter-equal-retained construction 1`. It again fails at
`owner-retired`: the retained failed stream's source health is empty.
`.review-2377/mapping-contract-original-direct-replay.log` contains that exact
one-test replay (334 tests skipped), preserving the law and cut after shrinking.
The adjacent distinct-parameter retirement passes the same comparison.

The exact frozen receiving instrument is:

```text
372b40b09ccac255c7fdad2d0580521684544909b3259ba502be390e9a7a8b68  packages/db-adapter-conformance/tests/on-demand-streams-oracle.ts
16f9c25f989f12fe65f9a105c988b8b15daa20ea6d975987a4f9d1df557192a5  packages/db-adapter-conformance/tests/on-demand-streams-driver.ts
9e19a5822f8aa06009d3a9a968d9aeb51ebf17d8f4bcc8854d96167244da7910  packages/db-adapter-conformance/tests/on-demand-streams-oracle-suite.ts
ef0b55b74fd7cc948060078e3589cdc58a664e21558e99740db8ff86cac0428d  packages/powersync-direct-collection/tests/on-demand-streams-driver.ts
94df5c1a4f95f059c371b7533be04903e37d4a78a91b89626e2c75b383600575  packages/powersync-direct-collection/tests/on-demand-streams-persisted-driver.ts
b450bb75bc08c408be00a1309035b127841bdf5187aaa820c3c2e8349278df4e  packages/powersync-direct-collection/tests/on-demand-service.ts
```

The amendment's package typecheck and focused ESLint pass on these exact bytes.
Independent path and adversarial reviews and repaired GREEN evidence are
recorded separately when complete. The same-connection recovery deferral above
remains open pending the SDK event API; parameterized reconnect recovery does
not close it. These histories continue to make no deployed-service,
restart-durability or framework-scheduling claim.

The independent path reviewer approved the six frozen mapper hashes above after
verifying the receiving cuts and running a separate 36/36 Node neighbor/control
selection across the three Node receivers. The review accepts the numeric-tuple
and single-priority bounds, and explicitly withholds wrapped adapter-race mutant
credit from the persisted admission checkpoint. `pnpm lint:changed` also exits
zero; its only output besides the command is the shell Node 24 engine warning.

### Final premise-based reach and current-query observation amendment

Before production was reapplied, the reviewers approved two further test-only
improvements. The new priority state is now `priority-requested`: an authored
priority plus actual HTTP dispatch establishes reach, while the shared result
comparison alone decides whether the forwarded priority is correct. This keeps
a dropped-priority defect at its semantic comparison instead of misclassifying
it as an unexercised premise.

Mapper observations now also read each live-query Collection's current public
status and the source's status. The retained donor must still be `ready` at
mapper rejection, retry and independent release; successful cached-only results
must be currently ready. An earlier fulfilled preload would not establish this
if the query later crashed while keeping rows. A fifth wrong-value control
changes the current donor status to `crashed` at `mapper-rejected` while retaining
its fulfilled preload observation, and the same shared checker rejects it.

The final frozen model/driver/suite hashes supersede only their corresponding
hashes above; the direct/persisted/service receiver hashes and original source
hashes remain unchanged:

```text
4f882d2174be4dcb741223e1c84f07442b50c6d43c1b97551a564d1478638b8f  packages/db-adapter-conformance/tests/on-demand-streams-oracle.ts
63e08783510ebb3635286220c3c5d7db2c843148551a53f1a6b448c5aabe40aa  packages/db-adapter-conformance/tests/on-demand-streams-driver.ts
6bd6ab24bc317ff8214fe35a9c2fe0554a925ea60895041c0299a5fef8010247  packages/db-adapter-conformance/tests/on-demand-streams-oracle-suite.ts
ef0b55b74fd7cc948060078e3589cdc58a664e21558e99740db8ff86cac0428d  packages/powersync-direct-collection/tests/on-demand-streams-driver.ts
94df5c1a4f95f059c371b7533be04903e37d4a78a91b89626e2c75b383600575  packages/powersync-direct-collection/tests/on-demand-streams-persisted-driver.ts
b450bb75bc08c408be00a1309035b127841bdf5187aaa820c3c2e8349278df4e  packages/powersync-direct-collection/tests/on-demand-service.ts
```

The final selector replaces `priority-forwarded` with `priority-requested`; its
other alternatives are unchanged. Every registration now has 336 tests. The
final unchanged-production Node gate in
`.review-2377/mapping-contract-original-node-final.log` reports 51 failed,
300 passed and 657 skipped across 1008 registered tests. Its classification is
unchanged: 36 semantic RED comparisons and 15 failed calibration clean baselines,
with zero receiving-premise failures. Each passing added state's five builders
reaches five non-fixed histories in each fixed/random campaign on each Node
path (24 state/campaign/path groups, all five). The retained equal-parameter
raw results still reach their state and fail source health at `owner-retired`.
The added current-query-status control passes on every Node path.

Both independent reviewers approved these exact final hashes. The path reviewer
also ran 39/39 Node neighbors and controls across all three Node receivers; the
adversarial reviewer ran 13/13 direct neighbors and controls, with 323 skipped
(`.review-2377/mapping-final-independent-neighbors.log`). Neither found a
supported blocker. Their approval preserves the numeric parameter bounds,
single-priority claim, and explicit persisted admission versus unwrapped
upstream-wait observation distinction. The final focused ESLint and package
typecheck pass.

### Terminal source-health observer repair

A final hostile path check exposed an actual false green in that previous
observer: a mapper wrapper could call the real `params.fail(mapperFailure)`,
then rethrow the same Error. After readiness, a terminal source error preserves
public ready status and rows. The earlier recorder read only
`health.failureReason`; all five mapper history cuts and the exact rejection,
retry and release therefore passed while `source.health.error` was present.
This violates the request-scoped mapper-failure law and poisons the retained
peer. The health glossary distinguishes the terminal `error` slot from a
retrying `failureReason`; ready status alone cannot stand in for either.

The exact no-source-edit fault injection is archived as
`.review-2377/probes/terminal-mapper-health-probe.mjs`. It runs as Node 26
`--import tsx --input-type=module` stdin from the direct package. The before
record `.review-2377/terminal-mapper-health-before-repair.log` reports
`terminalSourceErrorObserved: true` and `violations: []`. Production stayed
original while the observer was repaired.

Every cut now serializes `sourceError: Boolean(collection.health.error)`.
The independent model requires this slot absent at active mapper cuts: initial
loaded donor, held/cached empty mapping, mapper rejection, successful retry and
independent retirement. It does not tighten settlement-initial source-error
ownership choices. A bound wrong-observation control sets this boolean true at
`mapper-rejected` while keeping ready source/query statuses, earlier successful
donor preload, rows and failureReason unchanged.

The identical fault injection after the repair reports the same terminal source
error and exactly three intended semantic mismatches: `mapper-rejected`,
`mapper-retried` and `retry-retired` each have `sourceError: true` instead of
false. `.review-2377/terminal-mapper-health-after-repair.log` preserves those
results. This is a checker/production-driver fault injection, not a production
source mutant or a new product defect. It demonstrates that the observation
and shared comparison now reject the named wrong design at its public cut.

The exact terminal-health amendment hashes are:

```text
4aea947e5799b99c075acd0c383e29cadbf0ac317a1e5a11d92f24b59f3c89b0  packages/db-adapter-conformance/tests/on-demand-streams-oracle.ts
e42fbdd39a55505f15b49cb17451ada2983a45e97faf1537b7f0cc4737f26244  packages/db-adapter-conformance/tests/on-demand-streams-driver.ts
093306144c8ab558d089c279c73730e4391ff97be6f883ec649144995a9aa20e  packages/db-adapter-conformance/tests/on-demand-streams-oracle-suite.ts
ef0b55b74fd7cc948060078e3589cdc58a664e21558e99740db8ff86cac0428d  packages/powersync-direct-collection/tests/on-demand-streams-driver.ts
94df5c1a4f95f059c371b7533be04903e37d4a78a91b89626e2c75b383600575  packages/powersync-direct-collection/tests/on-demand-streams-persisted-driver.ts
b450bb75bc08c408be00a1309035b127841bdf5187aaa820c3c2e8349278df4e  packages/powersync-direct-collection/tests/on-demand-service.ts
```

The receiver count is now 337 tests, with every prior state, builder, fixed
history, budget and calibration retained. The unchanged-production Node gate in
`.review-2377/mapping-terminal-original-node.log` reports 51 failed, 303 passed
and 657 skipped across 1011 tests. Its 36 semantic RED comparisons, 15 failed
calibration clean baselines and zero receiving-premise failures are unchanged.
The new terminal-health control passes on all three Node receivers.

Both reviewers independently approved the exact eight-file manifest, including
unchanged original source hashes. Both reran the identical archived decorator
and observed the same three intended result mismatches. The path reviewer ran
42/42 Node neighbors and controls across three receiving paths; the adversarial
reviewer ran 14/14 direct neighbors and controls with 323 skipped
(`.review-2377/mapping-terminal-independent-neighbors.log`). The focused ESLint
and package typecheck pass. This closes the confirmed observer false green for
terminal source poisoning in the declared mapper histories; it retains every
receiving and parameter-domain limit above.

The exact terminal-health amendment also completed both actual Chromium
receiving gates on unchanged original production:
`.review-2377/browser-mapping-terminal-original-affected.log` records 34 failed,
202 passed and 438 skipped across 674 tests, in 47.57 seconds. Its 24 semantic
failures are 22 equal-parameter health comparisons and two mapper-triggered
source-cleanup comparisons; its ten failed calibrations are the same
clean-baseline failures. There are zero unexpected, host, acknowledgment or
receiving-premise failures. Both new terminal-error controls pass, and the raw
serialized cuts include explicit `sourceError: false` fields. The path reviewer
inspected this exact gate and reverified all eight hashes before clearing the
source-repair gate. These runs precede the repaired GREEN campaign and do not
claim that a failed clean baseline demonstrates a calibration kill.

## Final approved-source GREEN after all mapper amendments

The approved final source omits the unproved extra post-mapper signal guard and
retains the source-cleanup guard whose original RED witness is recorded above.
Its exact bytes are:

```text
a30e71beb96fade6c5714a300ea76628386dd0b9b1ea04ad60ccf3ee9ae074fa  packages/powersync-direct-collection/src/index.ts
00fb4cb1976ec8b384d01e1fbb483768204bc40b69a3dcc19ed21b4356b3e380  packages/powersync-direct-collection/src/subsets.ts
```

The final on-demand instruments remain the exact six-file terminal-health
manifest above (`4aea947e` model, `e42fbdd3` shared driver, `09330614` suite,
`ef0b55b7` direct driver, `94df5c1a` persisted driver and `b450bb75` transport).
This final evidence follows all original-production gates and independent
reviews; it preserves the historical earlier GREEN snapshots above.

The complete explicit Node portfolio is **1988/1988 GREEN** across 12 files,
exit zero, in 38.55 seconds. Its three on-demand registrations are each
**337/337**, totaling **1011/1011**. The complete trace is in
`.review-2377/production-final-amended-node.log`.

The complete actual Chromium portfolio is **1396/1396 GREEN** across eight
files, exit zero, in 215.48 seconds. Both unwrapped and real worker/OPFS
on-demand registrations are **337/337**, totaling **674/674**. Its complete
trace is `.review-2377/browser-production-final-full.log`. This is an actual
full browser run, including current query status, terminal source-error,
parameter identity, priority, empty mapping and mapper retry comparisons and
all their bound checker controls.

The following table sums each campaign's separately recorded construction units
and ordinary generated unit. Literal fixed histories and calibrations are
excluded. Every fixed-2377 total is identical across all five receivers; each
random column is measured from its own fresh campaign. A single history may
reach several states, so the columns do not sum to a history count.

| Declared state | Fixed 2377, each receiver | Random Node | Random controlled persistence | Random Node SQLite | Random Chromium | Random worker/OPFS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| shared-error-retained | 22 | 24 | 21 | 23 | 22 | 19 |
| independent-error-retired | 39 | 34 | 35 | 33 | 35 | 34 |
| partial-overlap-retired | 10 | 8 | 8 | 10 | 11 | 8 |
| stream-error-before-sync | 9 | 10 | 9 | 10 | 7 | 9 |
| stream-error-before-application | 8 | 9 | 11 | 9 | 10 | 8 |
| stream-error-after-application | 8 | 7 | 10 | 7 | 10 | 12 |
| error-identity-changed | 24 | 19 | 22 | 21 | 19 | 20 |
| stream-recovered | 13 | 19 | 12 | 18 | 16 | 14 |
| mapping-cleanup | 9 | 8 | 8 | 9 | 11 | 13 |
| loaded-cleanup | 9 | 10 | 9 | 11 | 9 | 6 |
| parameter-equal-retained | 13 | 15 | 11 | 11 | 14 | 9 |
| parameter-distinct-retired | 14 | 10 | 13 | 10 | 13 | 12 |
| priority-requested | 8 | 8 | 9 | 6 | 6 | 9 |
| empty-mapping-applied | 7 | 7 | 9 | 6 | 6 | 9 |
| throwing-mapper-retried | 6 | 10 | 6 | 11 | 8 | 8 |

All **150** state/campaign/receiving-path groups (15 states × two campaigns ×
five receivers) have five independently enforced fresh-object construction
reaches from their own five named builders. Every normal campaign passes. Every
missing-state control and wrong-observation calibration passes its clean baseline
and then rejects the required corruption. Ordinary generated histories add the
remaining reaches in the table. Parsed raw totals and construction obligations are preserved in
`.review-2377/on-demand-final-reach.json` and
`.review-2377/on-demand-final-required-reach.json`.

The unchanged-production RED runs above are the original-implementation hostile
mutant for the repaired source class: the same final model and receiving paths
reject equal-parameter retained failure and mapper-triggered source cleanup at
their public observation cuts, then pass these final source bytes. The explicit
terminal-health fault injection independently proves the repaired observer
rejects terminal source poisoning while rows, ready statuses and the earlier
preload remain unchanged. Failed original clean-baseline calibrations remain
classified as baseline failures, not mutant kills; their final repaired runs
now pass.

These results close the exercised ownership, applied settlement, cleanup and
mapper observation cells through the named five paths. They do not claim
universal proof, arbitrary parameter/priority domains, deployed-service
behavior, framework scheduling or restart durability. Persisted empty-mapping
held cuts remain outer load admission, while unwrapped held cuts reach the
upstream mapper and provider wait. Reconnect recovery is covered;
same-connection recovery remains the maintainer's explicit SDK-event dependency
and is not closed by this GREEN portfolio.


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

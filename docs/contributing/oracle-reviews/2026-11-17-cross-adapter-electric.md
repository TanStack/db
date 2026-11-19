# Electric receiving review for PR 2377

Reviewed base: `92a1493e0f45dbfd1fc3a51460ccb9228d8f787d` (PR 2377).
Electric production source is unchanged from that head. This review adds receiving
coverage and repairs test instruments; it does not claim a production defect or
a production repair. The final source manifest and run evidence are recorded in
the accompanying snapshot. Independent review results are appended below.

## Applicable contracts and rejected transfers

The shared eager live-source owner governs readiness, health, typed row values,
source failures, waits and resource release. Both Electric configurations retain
their original 400-run fixed/random campaigns and declared constructions. Node
and real Chromium run the installed ShapeStream against the HTTP protocol
fixture and use the same shared judgment at every original checkpoint.

The complete-result reload owner applies to Electric's must-refetch/truncate
path. A resumed cursor first receives HTTP 409/must-refetch, then the complete
insert stream and up-to-date. Delivering inserts as if they were a complete
answer on a resumed cursor would be an invalid fixture. The terminal gate owner
runs fresh and reload entry, with app onError returning or throwing. Its shared
failed-subscription entry does not transfer: each Electric Collection owns a
new filtered ShapeStream; it does not join an already failed cached client.

The shared mutation-confirmation owner applies to Electric's explicit awaitTxId
and discarded handler return. The complete finite Electric grammar has 42
histories: CRUD, an untouched peer, success, rejection before/after the backend
write, explicit/absent txid confirmation and discarded legacy return. Public
rows, handler work, actual SDK refresh/snapshot calls, transaction state,
settlement and exact handler error are judged at entered, server-written,
confirmation-requested, confirmation-accepted, settled and late-confirmed cuts.
The recorder preserves all application fields except the four reserved
Collection virtual root fields. A wrong extra field is observable.

The existing installed-SDK snapshot owner is Electric's on-demand receiving
owner. The snapshot Map, overlapping payload replacement, request/source health
distinction, retry/outage grammar and retired-evidence restart checkpoints were
extracted into `sdk-snapshot-delivery-oracle.ts` for the same judgment in both
hosts. Its original width 2..4 grammar, seed 20260917, 40-run fixed/random budgets,
construction and Node calibrations remain. PowerSync named-stream lease and
getSubscriptions incidence laws do not map onto SQL snapshot demand, nor does
PowerSync cached-client table union/passive startup map onto separate filtered
Electric shapes. Those are rejected transfers, not skipped Electric claims.

Electric's field parser and getKey contracts require a different decoder law
from Direct PowerSync's raw-ID-preservation rule. An app parser may transform
`source:1` to `app:1`; getKey then selects that application identity. Executed
witness `.review-2377/cross-electric-decoder-key-witness.log` reaches ready with
`{id:'app:1',value:7}`. The receiving decoder owner therefore permits that valid
neighbor while judging applicable thrown-parser atomicity. It spans eager and
requestSnapshot, initial/live, valid/throw, a successfully parsed prefix before
refusal, and one valid next use. It observes every publication on refusal,
whole application rows including own undefined fields, exact parser refusal,
Collection status, source health.error versus failureReason and exact cause,
next status/health, run count and final provider release. Eager app onError
give-up stops that sync run; a failed snapshot parser remains request-owned.
A later valid answer uses a new eager run or another acquisition in the same
on-demand run. These distinctions are not inferred from a history label.

The initial-receipt law is parameterized by its actual storage premise.
Electric certifies restored keys before source HTTP processing, so holding
persisted restore cannot reach an admitted source receipt. The receiving driver
instead holds the public persistence adapter's actual applyCommittedTx after
restore and returns the wrapper's real receipt unchanged. A signal-less admitted
Electric write may legally finish after cleanup. Both neighboring premises run:

- `heldReceiptOutcome:'rejected'`: after cleanup begins, the held public storage
  method throws; the actual wrapper receipt rejects and produces no detached
  rejection or post-cleanup publication.
- `heldReceiptOutcome:'applied'`: no storage fault is injected; the admitted
  transaction finishes after cleanup, its actual receipt settles, and rows stay
  cleaned up. Cleanup alone is not asserted to cancel admitted writes.

The after-application schedule waits for actual receipt application, not merely
preload: Collection readiness follows acceptance before that applied cut.
Controlled storage, actual Node SQLite and Chromium worker/OPFS receive the same
receipt model/check. Browser mode-specific persistence resolution occurs before
the storage hold/fault is installed.

## Evidence and test-instrument repairs

The initial unchanged-source eager/startup run passed 533 tests; the installed
SDK owner passed 259. The expanded Node run passed 626 tests across the complete
SDK owner and four new receiving runners, including fixed/random campaigns,
constructions, finite mutation enumeration and controls. Final browser and
replay results are appended below.

No executed mismatch established an Electric production defect. Earlier failures
were setup failures or unsuitable expectations: stale fixture handles after409,
a held-restore schedule that admitted no source receipt, using preload for an
applied receipt cut, a browser persistence factory not yet resolved for its
mode, and a raw-ID rule contrary to getKey. The first expanded eager browser
attempt also encountered the SDK's HTTP browser advisory in a strict log
comparison, plus Vite navigation while source imports were changing. The eager
fixture now uses HTTPS and unique provider handles. These runs are not RED
production evidence.

Independent law/path review identified and repaired instrument gaps: row
projection erased extra application fields; JSON equality erased own undefined
fields; an aggregate health boolean did not distinguish stopped versus retrying
source health; recovery rows alone did not establish recovered health; and
teardown could erase completed raw observations before the receiving comparison.
The recorders retain full application data, source classification/cause and
next-use health. Decoder/mutation use retainOracleCleanupObservation, and actual
cleanup-only/combined mismatch controls prove the original product result stays
primary. Refresh instrumentation restores SDK methods even after later failures
and installs only after Collection construction succeeds.

## Requirements audit

| Requirement | Evidence and limit |
| --- | --- |
| ORC-001 | Authorities are the existing eager/reload/mutation/receipt owners, Electric parser/onError/getKey contract and glossary; rejected transfers above retain source-specific semantics. |
| ORC-002 | Shared independent eager/Map/reload/receipt/mutation judgments remain; decoder recomputes authored coordinates without SDK classifications, queues or production semantic helpers. |
| ORC-003 | Each owner states its law, bounded grammar, real production path and comparison cuts beside executable code. |
| ORC-004 | Decoder axes reconstruct all 8 mode/phase/outcome cells, late prefix refusal and transformed-key neighbor. Removing mode loses request/source health; phase loses ready retention; outcome loses atomicity/validity; refusalIndex loses prefix; count 1..4 spans first/late refusal. Invalid indices are normalized inside count. Reload/gate/receipt retain shared grammars and mutation enumerates its entire finite domain. |
| ORC-005 | Installed ShapeStream parses actual HTTP; snapshot delivery includes actual SDK snapshot/subset boundaries. Recorders can represent partial publication, extra fields, distinct health slots, exact cause and settlement. No concrete missing-source-information hypothesis remains at the claimed cuts. |
| ORC-006 | Bound controls reject omitted truncate, partial parser publication, extra string/undefined fields, wrong retryable source classification, wrong cause, retained recovery health, discarded-return refresh work, missing constructed states, and actual cleanup-only/combined failures. No production mutant is claimed. |
| ORC-007 | All generated receiving families retain fixed/random parity and direct guarded replay. Exact commands/results are recorded below and in the snapshot. Finite mutation enumeration has no shrink-path claim. |
| ORC-008 | Decoder is a stateless coordinate recomputation. Existing stateful models are unchanged; their health/request/run distinctions remain observable at the documented next action. |
| ORC-009 | Sync run, source/request health, accepted/applied receipt and publication use glossary terms; provider wire keys and application keys are explicitly distinct. |
| ORC-010 | Shared receiving judgments preserve product-first cuts. Decoder/mutation retain raw result plus teardown diagnostics; receipt retains actual completed result. Actual combined controls and browser diagnostics controls exercise fidelity. The snapshot amendment retains the same checkpoint plus secondary teardown diagnostics. |
| ORC-011 | No reviewer named a plausible shared semantic fault requiring a distinct second formulation. Concerns found were missing observations or unsuitable donor policy and were repaired at those locations. |
| ORC-012 | This versioned record is tied to the exact base and final source manifest. No universal proof or production bug-class closure is claimed. |
| ORC-013 | Required states distinguish held/applied and rejected/applied receipt outcomes, initial/live gate and parser failures, refused prefix/valid transformed key, and explicit/absent/late confirmation. The existing snapshot grammar retains fifth-attempt outage neighbors and independently enforced constructions. |
| ORC-014 | Real SDK, Node SQLite, Chromium and worker/OPFS are exercised at their stated boundaries. A controlled HTTP provider is not evidence that a live Electric server emits every authored frame. |
| ORC-015 | Every new generated owner declares states and randomized fresh-object constructions with bound missing-state controls. Mutation's enumerated source records its declared states. Counts and existing eager minima remain in raw run logs and final snapshot. |
| ORC-016 | Registrations use oracleProperty, shared conformance registrars or an oracle-named registration module. Fixed histories and controls reuse the same judgments; no independent unit-test expected-answer table is inserted. |

## Limits

The evidence covers the declared controlled protocol histories, not an arbitrary
Electric service, retry policy, schema validation or concurrent handlers. The new
decoder owner excludes progressive fetchSnapshot and persistence. The receipt
family covers three authored keys and startup cleanup, not saved-row durability
or concurrent tabs. Eager value kind exclusions retain Postgres int4 and float8
column-domain limits. On-demand snapshot observations remain at the original
applied-delivery/restart cuts; they do not establish every intermediate consumer
callback or arbitrary predicate order. The shared cached-client and named-stream
policies remain owned by their applicable adapters.

## Final execution record

All commands ran from `packages/electric-db-collection` on Node 24.19.0 with
`--maxWorkers=1 --coverage.enabled=false --typecheck.enabled=false`.
Executable source hashes are frozen in
`2026-11-17-cross-adapter-electric-snapshot.json`; Electric production has zero
diff from the reviewed base. The JSON also retains commands, log digests,
generated reach and replay execution witnesses.

| Command target | Result |
| --- | --- |
| `tests/eager-live-source-conformance-oracle.property.test.ts tests/persisted-startup-conformance-oracle.property.test.ts` |533 passed, 205.52s after final HTTPS/handle fixture change. |
| `tests/electric-sdk-delivery-oracle.property.test.ts tests/cross-adapter-*.property.test.ts` |626 passed, 105.60s before the last two decoder boundary controls. |
| `tests/electric-sdk-delivery-oracle.property.test.ts` after snapshot diagnostics amendment |312 passed, 48.66s; preserves the original snapshot cleanup/setup and all other SDK families. |
| SDK owner filtered to `electric.sdk-decoder-delivery` after final subscriber recorder amendment |55 passed, 3.14s. |
| Complete Chromium config before final focused amendments |653 passed; one 400-history eager fixed campaign timed out at the 120s runner limit, with no product mismatch. |
| Chromium snapshot family plus that exact eager fixed campaign, with 300s eager runner limit |19 passed, 129.57s. The 400-run budget and seed 2118 are unchanged. |
| Chromium decoder after final subscriber recorder amendment |55 passed, 6.29s. |
| Reload and gate after required provider-consumption barrier amendment |153 passed, 18.69s. |
| Chromium reload and gate after required provider-consumption barrier amendment |153 passed, 506 unrelated checks unselected, 56.28s. |

The focused amendments cover every changed executable path and both new actual
decoder faults. There is no claim that a final monolithic complete-browser
command ran green: the complete run and focused reruns together cover the final
registered checks. The browser runner now allows 300s for each eager campaign.

Strict scoped TypeScript and scoped ESLint passed. `pnpm lint:changed` passed.
The whole Electric package TypeScript command still reports exactly three
TS2307 errors in pre-existing db-collection-e2e imports of the unbuilt Electric
package (`moves-oracle.suite.ts` twice, `progressive.suite.ts` once); no new
owned source has a type error. Dynamic cross-adapter oracle runners are excluded
from Vitest's type-test collector while remaining in TypeScript's program.

Sixteen guarded direct replays passed, eight Node and eight Chromium properties.
Each uses seed 2377, shrink path `0`, unit `random seed: generated`, and reports an
async witness with exactly one execution. Mutation confirmation remains an
exhaustive finite campaign and has no shrink-path replay claim. A typical
command is:

```sh
TANSTACK_DB_ORACLE_PROPERTY=adapter.electric.eager-reload \
TANSTACK_DB_ORACLE_SEED=2377 TANSTACK_DB_ORACLE_PATH=0 \
TANSTACK_DB_ORACLE_UNIT='random seed: generated' \
node --import tsx ../db/tests/oracle-replay.ts \
--maxWorkers=1 --coverage.enabled=false --typecheck.enabled=false \
tests/cross-adapter-reload-oracle.property.test.ts
```

The intentional dropped-SDK-row mutant was directly replayed with the same
seed/path on `electric.sdk-snapshot-delivery`, adding
`TANSTACK_DB_ELECTRIC_SDK_DELIVERY_FAULT=snapshot-rows`. Its one executed witness
failed at the original semantic checkpoint `snapshot 0 applied rows`; it did not
fail during setup or through a timeout. The unchanged driver replay at the same
coordinates passes. This is calibration evidence, not production RED evidence.

The final enforcement amendment replaced eager decoder expected-row polling
with a forwarding recorder of completion of an actual ShapeStream subscriber
callback whose batch contains `up-to-date`. It preserves messages and callback results, then allows bounded host
propagation before recording public rows/status. A wrong int4 parser and a
suppressed markReady both now reach the same semantic comparison and are
rejected for values/status rather than timing out. Their model expectations are
unchanged. Snapshot receiving now transports actual teardown diagnostics via an
optional Electric cleanup hook, while keeping the original comparison checkpoint
primary; actual cleanup-only and combined faults verify both outcomes.

**Law:** the applicable existing eager/reload/mutation/receipt judgments and
Electric-specific parser/getKey law described above.

**Reach:** all declared generated states were reached in each normal receiving
campaign and each constructed obligation was enforced. Fixed generated counts
include decoder: 8/6/1/4 eager cells,4/2/1/4 on-demand cells, prefix 8 and valid
transformed key 16; snapshot: subset retries 33, pauses 30, live outage 23,
throw-led 23, throw-crossed 22 and retired-evidence 40. Each receipt variant has
12 generated histories (held 6/applied 6, empty 4/nonempty 8). Reload has 80 generated
histories with all 11 states; gate has 30 with all 8 states. Mutation enumeration
reaches CRUD 14 each, fulfilled 24, reject-after 12, reject-before 6 and txid/late
confirmation 18 each. Fixed/random counts and eager states are in the snapshot.

**RED:** no accepted-law Electric production RED was found. Setup failures and
rejected donor expectations above are excluded from this claim.

**GREEN:** the command results above exercise unchanged Electric production.

**Mutant:** dropped rows, omitted truncate, wrong parser values, missing
readiness, partial parser publication, extra fields, incorrect health/cause,
retained recovery health, refresh work from discarded returns and cleanup
masking are rejected at their named comparisons. The direct dropped-row replay
records one failed async witness at its original checkpoint.

**Limits:** the bounded source, requestSnapshot, complete-result reload,
mutation and persisted startup-cleanup paths described above; no live-service,
progressive parser, arbitrary concurrency or universal closure claim.

### Reload delivery amendment

A later shared-driver review found that an empty result with no commit and no
readiness callback could wait before the comparison. The required receiver
`propagate` now runs immediately after source entry. Electric supplies completion
of its actual SDK subscriber callback for an `up-to-date` batch. A
`must-refetch` batch alone cannot satisfy it. Replacing the staged result first
drains the retired callback, then records the next required completion. The
barrier does not read Collection rows, status or the load promise. Electric's
callback processes the messages synchronously and parks acceptance/application
continuations separately, so the barrier does not wait for an optimistic
transaction's held publication.

The actual SDK calibration suppresses both adapter `commit` and `markReady`
for a fresh empty result. Node and Chromium both return a raw observation with
zero submitted commits, zero readiness calls and a pending load. The shared
comparison rejects it with `load pending after complete source application`
and `complete source submission not reached`; neither run times out. The same
empty history without suppression passes the same comparison in both hosts.
The full reload/gate reruns above pass after this amendment. These are
test-instrument controls against unchanged Electric production.

The commands are `node --import tsx .review-2377/electric-empty-liveness.ts`,
with `--browser` for Chromium and `--clean` for the unmodified neighbor. The
snapshot records the script and all four logs with their SHA256 values.

## Independent law and receiving-path verdict

`oracle_diff_laws` approved the final receiving slice after verifying all 50
source hashes in the accompanying snapshot, including unchanged Electric
production, the shared dependencies and the last decoder recorder amendment.
The reviewed `sha256` map, encoded as compact JSON with sorted keys, has SHA256
`65dbbf57e5c1909e30f0dd106fcccca91b934e650cdff80e51471d466d21cbac`.
The review independently traced complete-result replacement, parser failure,
request/source health, mutation settlement and receipt cleanup to their public
contracts and existing executable oracle owners. It rejected the transfer of
Direct PowerSync's raw-key and cancellation assumptions to Electric.

The review identified the field-projection, own-undefined-field, health-slot,
exact-cause, next-use-health and completed-observation cleanup gaps described
above. All are repaired. The final eager decoder recorder counts only a
completed actual subscriber callback whose batch contains `up-to-date`;
`must-refetch` alone cannot open the complete-result observation cut. A wrong
parser value and missing readiness reach the semantic comparison rather than
an expected-value polling timeout.

Independent executions on Node 24.19.0, with one worker, were:

- Both complete decoder and finite mutation properties: **103 passed** at their
  earlier frozen core slice. Both decoder campaigns reached all ten declared
  states; mutation enumeration reached all eight. Later recorder amendments
  were inspected and the actual new boundary controls were executed again.
- Held receipt after cleanup, controlled storage and native SQLite, rejected
  and applied outcomes: **8 passed**. This confirms both explicit premises;
  cleanup is not treated as universal receipt cancellation.
- The complete Chromium installed-SDK snapshot property: **18 passed**, 641
  unrelated tests unselected, **6.17 s**. Both 40-history campaigns and their
  constructions reached all seven states. Actual dropped-row and cleanup-only
  and combined mismatch controls preserved the original comparison.
- The final wrong-parser and missing-readiness controls: **2 Node passed** and
  **2 Chromium passed**, at `afterAttempt` and `status` respectively.

The final independent logs and SHA256 values are:

```text
61c6f2ef197219d7730872a5963e6110315662973bba8b13ff8a661753b5a21e  .review-2377/electric-laws-snapshot-browser.log
d2fde77a0a5870b58b879c5750a554fdd8af5fbc91dcabd984ebfff1435a3b4c  .review-2377/electric-laws-decoder-boundary-node.log
e241c82d44b9647ed72e5019e9811a55edbec3df7ebc0ed6c8b81f2014047fcc  .review-2377/electric-laws-decoder-boundary-browser.log
```

No supported law, receiving-path or observation finding remains in the reviewed
slice. The author's final full decoder and eager/startup runs were inspected as
additional evidence, not counted as independent executions. The source and
host limits above remain; this approval makes no Electric production-defect,
live-service or universal adapter-portfolio closure claim.

### Independent reload-delivery amendment verdict

`oracle_diff_laws` approved the narrow required-provider-barrier amendment after
independently verifying all 50 current source hashes. The refreshed snapshot's
`sha256` map, encoded as compact JSON with sorted keys, has SHA256
`68df481da15f72bf090ab7a66936e55cf5198af6d436d0abcb8e22e77d286a04`.
Only the shared reload driver and Electric reload receiving driver changed
from the preceding 50-file approval. The earlier verdict remains evidence for
its recorded snapshot.

The receiving barrier records completion of an actual SDK subscriber callback
containing `up-to-date`, excluding a `must-refetch` callback. The previous run's
completion is drained before selecting the next completion. Source inspection
confirmed that the Electric callback processes this fixture's messages without
awaiting applied visibility; receipt acceptance and application remain separate
shared-driver observations. A missing commit or readiness callback cannot
prevent this provider premise from completing.

Four independent calibration executions passed: the actual empty-result missing-commit and
missing-readiness mutant, plus its clean neighbor, in Node and Chromium. Both
mutants returned the pending raw observation with zero submitted commits and
zero readiness calls; the unchanged shared comparison rejected it for pending
load and missing complete submission. Both clean neighbors passed that same
comparison. These were comparison results, not timeout kills. Independent logs
and SHA256 values are:

```text
323a5d5b992db08666eecafd397ceaf6f3d80185bc60da774b62febeec82a9fa  .review-2377/electric-laws-empty-liveness-node.log
c1eedfaf7f5a08730dd4dbbb1a2b6d19bf0cb3d4c95fb59b7c84cb2d225b1ef4  .review-2377/electric-laws-empty-liveness-clean-node.log
0f6f68d811c3d060a909ba0f363ac4311a0e1b2debca72dc29add20c02d78799  .review-2377/electric-laws-empty-liveness-browser.log
34a6e59f1db081a357509ca6b30c3cb4393572818dd00d60e7764f5975c8e5b2  .review-2377/electric-laws-empty-liveness-clean-browser.log
```

No supported finding remains in this narrow Electric receiving amendment.
The shared recorder's general calibration gate, other adapters' receiving cuts,
and the existing Electric limits retain their separate scope.

### Independent enforcement verdict

`oracle_diff_enforcement` separately approved the decoder's final subscriber
completion recorder and actual wrong-parser/missing-readiness controls. It ran
both controls on Node and Chromium: two passed in each host at the semantic
`afterAttempt`/`status` comparisons. The reviewed decoder driver, decoder suite
and browser registration hashes are retained in the final source manifest.
The independent decoder logs have SHA256 values:

```text
8a867c931eb14a7d33f3d37e7956b213ef6f374cd1f5476dbc64402b62a0e453  .review-2377/enforcement-electric-decoder-amended-node.log
d1e56540934ab5cad40824c5da45eeff04cb9b03325e0cb39851b793bf47cde3  .review-2377/enforcement-electric-decoder-amended-browser.log
```

The reviewer also independently inspected the narrow reload receiver amendment
at `c6509dfb27eba0416380aa66577470b0994d8b0b67e9cfec18875e170ae1dc90`,
with shared driver
`3e178cd5823a690646f98301701fb84b4eee8fb6cbd7cde0f8b2a70ba6e96b0e`.
Its actual empty-result missing-commit/readiness controls ran independently in
Node and Chromium and returned the expected semantic mismatch with no timeout.
The full 153-test affected runs in each host remain author executions. This
verdict approves those named amendments within the final manifest, with the
earlier review's scope and stated limits retained.

The independent reload-control log digests are:

```text
6da803c0a7cc2ab367a1544b43026a36dbaa528b6fb25e0af70db26ba62ec5c6  .review-2377/enforcement-electric-empty-liveness-node.log
f50890927cd3b48474dcc280c337147f5f2c905c00f5f31e4bff0b75ed65448b  .review-2377/enforcement-electric-empty-liveness-browser.log
```

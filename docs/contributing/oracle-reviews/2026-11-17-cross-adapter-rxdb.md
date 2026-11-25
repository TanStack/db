# RxDB receiving-path audit, 2026-11-17

## Pre-edit inventory

This inventory precedes every RxDB test or production edit in this audit.
The working tree is `pr-2377-review`; production is initially unchanged.
The audit uses Node 24 with one Vitest worker. A native-addon setup failure
does not count as a semantic RED result.

Authority: `docs/collections/rxdb-collection.md` promises automatic mirroring,
reactive provider updates, optimistic rollback on error and persistence through
the built-in mutation handlers. `RxDBCollectionConfig` supplies an RxCollection
and `syncBatchSize`. The glossary supplies initial-gate, health, cleanup,
reload, accepted-transaction and applied-receipt laws. Existing shared owners
retain their laws and independent judgments.

| Family | Applicability and existing receiving path | Required observation and host gate |
| --- | --- | --- |
| Eager live source | Applicable; controlled RxCollection, real RxSchema/query matcher/sort comparator, per-change commits | Rows inside ready notification and each publication; exact error causes and resource release on startup/live failure. Run strengthened shared campaign on original production. A real installed RxDB storage path must receive any newly claimed SDK premise. |
| Successful eager reload | Applicable; real installed RxDB memory storage receiver exists | Retained/empty startup, omission and changed overlap at reload fulfillment and applied settlement; Node and existing actual Chromium receiver. |
| Initial gate | Applicable; initial storage query can fail; an RxJS stream can fail before or after readiness | Loading failure is final for its run; post-ready failure preserves ready rows and records terminal health. Reuse shared eager judgments; require a real RxDB wrapper delivering those boundaries. |
| Initial applied-receipt cleanup | Applicable; initialFetch awaits commit receipts and startup drains buffered events | Cleanup while receipt is held versus after application; final cleaned-up rows and actual detached host errors. Reuse host-independent receipt model/check; Node process and actual Chromium host. Persisted wrapper paths also require Node SQLite and OPFS cuts where applicable. |
| Persisted startup | Applicable; real RxDB memory storage plus controlled and Node SQLite persistence already registered | Public/durable/reopen rows at startup, source complete result and refresh; rerun Node gates and existing actual Chromium OPFS witness. |
| Persisted baseline lifecycle | Applicable; real RxDB memory source plus controlled/Node SQLite persistence already registered | Cleanup/reload/source failure during hydration; accepted work, exact failure cause and resource ownership; existing Chromium OPFS receiver. |
| Capability admission | Applicable; existing shared receiver | Missing/false protocol members fail before source delivery; legal forms complete source startup on controlled/Node SQLite/OPFS. |
| Mutation confirmation | Applicable; public insert/update/delete call built-in bulkUpsert/incrementalPatch/bulkRemove handlers | Actual handler Promise decides outcome; provider event acceptance and settlement remain separate. Require generated CRUD, before/after write failures and event-before/after-handler cuts through real installed RxDB. Shared owner needs an RxDB adapter classification; no fake explicit checkpoint API. |
| Shared provider/client | Applicable as two Collections reading one RxCollection | Both see its whole table; cleanup one does not release the other's listener; later direct RxDB write reaches survivor. Existing shared suite currently assumes Direct stream masks and checkpoint requests and needs an explicit full-collection receiving mode. |
| Authored decode/refusal | Not applicable to the Direct parse law | RxDBCollectionConfig has no parse/deserializer option. RxDB ingress clones JSON and strips metadata. JSON fidelity remains in eager owner; storage schema refusal is applicable mutation-handler evidence, not a fabricated Date decoder contract. |
| On-demand streams/acquisition | Not applicable | RxDB adapter has no loadSubset implementation; public docs describe hydrating everything into memory. `syncMode` inherited from BaseCollectionConfig does not implement physical on-demand acquisition. |

No cross-adapter completeness claim follows from registration names alone.
Remote RxDB replication, every RxDB storage engine, multi-tab transport and
deployed servers remain separate provider boundaries. This audit must preserve
those limits while filling the applicable local receiving paths.

## Evidence

### Original-production receiving gate

The audit added receiving evidence and made no RxDB production change. The
unchanged files have SHA-256 values:

- `src/rxdb.ts`: `c78f7409f9e539a6bf575718f36a91309c191b18638be29a7d87b481914e65f7`.
- `src/helper.ts`: `2f9ea08c629d376c89e2f8619abe7d121789905b4b5be04276fa1f393bf95d1b`.

The [receiving snapshot](2026-11-17-rxdb-receiving-test-snapshot.json) records
the reviewed Git head, exact test/configuration and shared-owner hashes, log
hashes, and every declared reach count for the nonpersisted additions. Its
initial SHA-256 is
`3723199da0d242cb8c9d0b0c265209b4958ca6831b78af9d700b59294a67af5e`.
The persisted receipt receiver has its
[separate snapshot](2026-11-17-rxdb-persisted-receipt-test-snapshot.json).
These snapshots describe uncommitted slices on the named head; a later edit
requires an additional evidence entry.

All commands used Node 24.19.0, Vitest 5.1.0, one worker and disabled coverage.
The focused Node command from the RxDB package was:

```sh
pnpm exec vitest run tests/initial-receipt-oracle.property.test.ts tests/shared-client-oracle.property.test.ts tests/eager-gate-conformance-oracle.property.test.ts tests/mutation-source-batch-oracle.property.test.ts tests/persisted-initial-receipt-oracle.property.test.ts tests/receiving-cleanup.test.ts --maxWorkers=1 --coverage.enabled=false
```

It passed 290 tests across six files before the persisted receiver's final
post-record calibrations were added. That count includes 56 preliminary
persisted receipt tests. The four nonpersisted receiving families and three
ordinary harness controls account for 234 passing tests. Their source hashes
are frozen in the receiving snapshot. The actual Chromium command was:

```sh
pnpm exec vitest run --config vitest.browser-oracles.config.ts --maxWorkers=1
```

It passed 259 tests across five files, including 28 OPFS receipt tests. The
four nonpersisted families account for 231 passing tests. Logs are
`.review-2377/rxdb-final-new-node-original.log` and
`.review-2377/rxdb-final-browser-original.log`.

| Receiving family | Node / Chromium tests | Judgment and observed boundaries |
| --- | --- | --- |
| Bare initial receipt cleanup | 28 / 28 | Existing shared receipt model/check; a real persisting optimistic transaction holds the actual core receipt. Cleanup occurs while pending or after application. The recorder stays active through real database removal and eight native task turns. |
| Shared RxCollection | 49 / 49 | New full-table membership judgment; two actual RxDB change-stream subscriptions. Compare both startup cuts, retired peer, survivor after real provider delete/insert events, and each subscription release. |
| Eager initial gate | 47 / 47 | Existing shared gate model/check; real storage query and RxJS subscription, with query rejection or stream error injected at the first-query hold. Compare fresh/reload failure and recovery in a new run. |
| Built-in mutation source batches | 107 / 107 | Existing optimistic-history model/check unchanged. Real `bulkUpsert`, `incrementalPatch`, and `bulkRemove` supply handler results and source events. Compare mutation admission, source acceptance, settlement, later source delivery, and cleanup. |

Existing receiving owners also ran on unchanged production:

- Eager live source and successful reload: 249 tests passed
  (`.review-2377/rxdb-existing-core-original.log`).
- Persisted startup, baseline lifecycle and capability admission: 428 tests
  passed (`.review-2377/rxdb-existing-persisted-original.log`).
- Existing actual Chromium reload witness: all 24 RxDB histories passed.
- Existing persisted-baseline OPFS witness: 66 tests passed; 58 PowerSync
  sibling cases were skipped by the RxDB selector
  (`.review-2377/rxdb-existing-baseline-opfs-original.log`).
- Existing OPFS startup and capability pages: two runs in the same persistent
  browser profile each compared 32 startup and 22 capability histories with
  zero violations, artifacts or host errors. The shared Chromium host disabled
  Vite watching for this repeat. Results are in
  `.review-2377/rxdb-existing-opfs-host-results.json` and its stable-original
  log. The earlier stock spec failed its host busy-response guard during
  concurrent Vite reloads; that experiment is a host failure, not semantic RED.

No confirmed RxDB production counterexample emerged from these runs. The
earlier attempt to assign RxDocument's getter-only `incrementalPatch` member
failed during fixture setup. The corrected receiver wraps `findOne().exec()`
and delegates the actual document method. Setup failures and leaked setup
databases from that attempt do not establish a product defect.

### Reach and grammar controls

The snapshot retains each state's count separately for fixed campaign seed
2377 and the fresh random campaign. Every required construction runs through
the production driver, model and shared check. A WeakMap associates each fresh
constructed history with its required state; the comparison checks generated
construction outputs as well as the framework's seeded constructions.
Missing-state calibrations remove each required state and must fail.

| Family | Declared receiving states | Minimum observed count per state, Node fixed / random; Chromium fixed / random |
| --- | --- | --- |
| Bare receipt | Held receipt, application before cleanup, empty source, nonempty source | 5 / 6; 5 / 4 |
| Shared RxCollection | Join before/after readiness, either retired peer, empty/nonempty initial table, empty later table, changed overlap, omission, paginated startup | 11 / 10; 11 / 11 |
| Initial gate | Each query/stream × fresh/reload failure, and each corresponding new-run recovery | 2 / 3; 2 / 4 |
| Mutation source batch | CRUD, three outcomes, peer/no peer, either source-delivery order, and all 15 legal CRUD × outcome × order cells | 2 / 3; 2 / 2 |

Reconstruction: receipt histories express both cleanup schedules with empty
and nonempty results. Shared histories express before/after-ready join, either
retired peer, empty replacement, changed overlap and omission. Gate histories
express query/stream failure on a fresh or retained reload run, then optional
new-run recovery. Mutation histories express every legal CRUD/outcome/order
cell, including a real provider write whose handler later rejects and an event
held until after handler settlement. There was no additional confirmed RxDB
counterexample to reconstruct.

Ablation: removing receipt timing loses pending-receipt cancellation; removing
empty input loses the empty authoritative snapshot. Removing shared join timing
loses a loading peer, membership overlap loses changed values, omission loses
deleted keys, peer identity loses symmetric release, and batch size loses a
second storage page. Removing gate source type loses either query-Promise or
Observable failure; removing entry/recovery loses retained reload or new-run
admission. Removing any mutation operation loses its built-in handler; removing
outcome loses rollback or accepted-write-on-rejection; removing event order
loses success/rejection before source delivery; removing the untouched peer
loses unrelated-row preservation.

Ranges: receipt membership uses the shared three-key bit mask and bounded
reason values. Shared initial/later masks are 0–7, batch size is 1 or 2, and
both peer identities occur. Mutation coordinates range from -100 to 100; model
numeric keys 1 and 2 map to provider string keys `"1"` and `"2"`. The gate
grammar uses the shared bounded source rows. Empty input, zero-valued payloads,
one row, paginated rows and changed overlap are in-domain margins.

Exclusions: before-write refusal has no source event, so the mutation grammar
rejects an after-settlement-event variant for that outcome. Shared retirement
names only peer 0 or 1; it never invents a third subscription. Shared-provider
cached terminal verdicts are not RxDB semantics, so gate registration declares
fresh and reload entries only. This does not exclude ordinary shared table
behavior, which the distinct full-table owner judges.

### Comparison calibration and failure fidelity

Bound calibrations reject wrong peer-ready rows, cleanup closing the survivor,
a lost later provider write, stale rows at mutation settlement and loss of the
handler's exact rejection relation. They also reject detached receipt errors,
lost cleanup diagnostics, and missing constructed reach. These are executed
wrong-observation rejections at the intended comparisons, not claims of a
production source mutant kill.

Independent reviewer `runtime_sync` found that a final teardown exception could
discard a completed observation before external comparison (ORC-010). The
drivers now use `retainOracleCleanupObservation` from the shared core harness.
It retains the completed observation and separate `cleanupErrors`; an
incomplete body keeps its primary exception. The shared owner compares the
primary public mismatch before secondary cleanup diagnostics.

Three ordinary harness controls execute actual receiving teardown: a receipt
mismatch plus database removal failure, wrong shared rows plus database removal
failure, and a native child-process rejected Promise scheduled after actual
database removal. The last control exposed a late recorder snapshot; moving
the copy after teardown and native task drains retains that detached error.
All three passed in the focused original-production run. The shared-client
bound calibration separately proves a primary mismatch survives a secondary
cleanup diagnostic.

### Replay and normal discovery

Guarded direct mutation replays succeeded in Node and actual Chromium. Both
used property `adapter.rxdb.mutation-source-batch` (Chromium suffix
`.chromium`), seed 2377, shrink path `0`, and campaign unit
`random seed: generated update:reject-after-write:after-settlement`.
Each replay's execution witness reports exactly one nonzero execution and one
comparison; it does not run the normal campaigns first. Logs are
`.review-2377/rxdb-mutation-direct-replay.log` and
`.review-2377/rxdb-mutation-browser-direct-replay.log`.

Scoped ESLint and package `tsc --noEmit` passed. Normal Vitest file discovery
includes every new Node receiver and excludes all actual-browser files through
`**/*-oracle.browser.test.ts`; those run with the dedicated Chromium config.
Global campaign and replay registration are owned by the cross-adapter
integration change.

### Numbered review outcomes

| Requirement | Outcome and evidence |
| --- | --- |
| ORC-001 | Laws/limits cite RxDB public docs, glossary boundaries and existing shared owners. No Direct decoder, subset or stream-union promise is invented. |
| ORC-002 | Receipt, gate and mutation reuse established independent judgments; shared membership is authored full-table recomputation without SDK queries or adapter classifiers. |
| ORC-003 | Opening and local prose distinguish laws, model projection, legal history, receiving driver and comparison cuts. |
| ORC-004 | Reconstruction, ablation, bounds and invalid adjacent forms are recorded above. |
| ORC-005 | Real SDK calls and subscriptions, exact failure relation, receipt state and receiving counters establish the named cuts. Event-after-settlement histories record the held boundary before later delivery; no earlier source fact is inferred from later rows. |
| ORC-006 | Bound wrong-row/error/resource/receipt observations fail their named comparison. Fixture setup failures are classified separately above. |
| ORC-007 | Fixed seed 2377 and fresh random campaigns use the same generators, model, recorder, check and budget. Guarded direct replay has a positive execution witness. No `fc.commands` grammar needs command replay coordinates. |
| ORC-008 | Existing state models are unchanged. The new shared judgment is stateless recomputation; retirement and join inputs are retained because the next public cut distinguishes them. |
| ORC-009 | Numeric-to-string key mapping and source-event versus handler-settlement boundaries are explicit. The full-table model does not rename Direct stream ownership as RxDB behavior. |
| ORC-010 | Shared cleanup envelope and three real paired/late failure controls preserve primary mismatch and secondary teardown diagnostics. |
| ORC-011 | No reviewer has identified a specific semantic fault shared by the reused model and production that needs a second formulation. No unconditional second-model claim is made. |
| ORC-012 | This record, snapshots, original-production results and independent review entries preserve the exact evidence and limits. No RxDB product bug-class closure is claimed. |
| ORC-013 | Held versus applied receipt, empty versus replacement rows, either retired peer, before/after-ready join, and before/after-settlement source delivery distinguish the nearby wrong rules through the same checks. |
| ORC-014 | Node and actual Chromium receive the same laws and comparisons. Storage/query/event facts use installed RxDB memory storage; persistence adds actual SQLite/OPFS. Injected terminal stream/query errors remain explicit controlled boundary faults, with no claim that every remote RxDB transport produces them. |
| ORC-015 | Per-state counts are versioned; fresh constructed objects carry required-state checks in the ordinary generated path, and missing-state controls fail. The 15 mutation receiving cells have individual obligations. |
| ORC-016 | Oracle files contain law campaigns and their calibrations. Concrete harness assertions remain in ordinary `receiving-cleanup.test.ts`. |

### Bounded conclusion

This evidence fills the applicable local RxDB receiving families identified by
the pre-edit inventory. Direct-style authored decoding and on-demand physical
acquisition do not exist in this adapter's API. Real remote replication,
arbitrary third-party RxDB storage engines, concurrent tabs, competing writers,
multiple concurrent CRUD requests, schema-validation refusal and field deletion
are outside these new receiving histories. Existing value-fidelity and core
optimistic owners retain their broader judgments; this receiving audit does not
retire them or prove every composition of their histories. The adapter needed
no production repair from the executed RxDB comparisons.

### Follow-up: mutation cleanup and persisted receipt evidence

Independent review identified a second ORC-010 gap after the initial receiving
snapshot. The mutation recorder awaited query and source cleanup before it
returned its completed product trace. A failure there could replace a prior
settlement mismatch. The shared optimistic cleanup cut observes request
outcomes and receipt settlement; it does not require cleanup exceptions to
discard earlier observations.

The recorder now returns the product trace before cleanup attempts. The shared
cleanup envelope performs query/source cleanup, then appends that cleanup cut,
and preserves teardown failures beside the completed trace. A fourth ordinary
harness control executes a real RxDB update, supplies wrong settled rows to the
shared comparison, completes actual source cleanup and then throws. The shared
optimistic check reports the original `rows` violation, and `cleanupErrors`
retains the separate injected failure.

The repair passed 111 Node tests (107 mutation-law tests and all four ordinary
harness controls) and the same 107 mutation-law tests in actual Chromium.
Logs are `.review-2377/rxdb-review-cleanup-node.log` and
`.review-2377/rxdb-review-cleanup-browser.log`. Scoped ESLint passed. These runs
supersede the mutation/ordinary-harness portion of the first snapshot; the
unchanged receipt, shared and gate slices retain their earlier evidence.

The persisted receipt receiver separately completed 60 Node tests and 28 OPFS
tests, including actual post-record teardown fault controls. Its
[final snapshot](2026-11-17-rxdb-persisted-receipt-final-test-snapshot.json)
and [review record](2026-11-17-cross-adapter-rxdb-persisted-receipt.md) supersede
the preliminary 56-test evidence above. These counts give 295 Node tests and
259 actual Chromium tests for the added receiving/harness slices, without
counting the unchanged existing owners again.

The reviewer also required the final mutation verdict to render secondary
diagnostics, rather than leave them only on the raw observation. The receiving
check now preserves the shared owner's primary law, checkpoint and value diff,
and appends separately labeled cleanup/host diagnostics to its difference.
The paired ordinary control invokes that same receiving check and verifies
the original `rows` law at `step 2 (settle)` plus the rendered cleanup failure.
Independent reruns passed 111 Node and 107 Chromium tests after this repair:
`.review-2377/rxdb-independent-final-mutation-verdict-node.log` and
`.review-2377/rxdb-independent-final-mutation-verdict-chromium.log`.

The [final receiving snapshot](2026-11-17-rxdb-receiving-final-test-snapshot.json),
SHA-256
`426b34582c932ec2aa3a6482ee1770ec176c5a8110436e389e1bb43e97f9cad5`,
supersedes the first snapshot's mutation/control sources. It separates
RxDB-owned files from shared dependencies. The shared eager gate judgment
changed during the broader audit; final RxDB receiving reruns passed the same
47 Node and 47 Chromium tests against that version. Its independent owner
review remains separate from this receiving review. Final scoped ESLint and
package `tsc --noEmit` both passed.

All four new nonpersisted family replay routes were checked in both hosts.
Receipt selected `random seed: generated held-receipt`; shared selected
`random seed: generated changed-overlap`; gate selected
`random seed: query fresh terminal gate`. Each used seed 2377 and path `0`
and reported exactly one executed comparison. Mutation was replayed again
after the final verdict repair, also with exactly one execution. The final
snapshot records all eight replay logs.

The existing `rxdb.test.ts` actual AJV extra-field refusal examples for insert
and update remain as supplemental SDK receiving evidence. The new generated
mutation law covers adapter handler/source-event ordering and arbitrary
handler/provider rejection; its injected before-write rejection is not a
claim about SDK schema-validation internals. This audit makes no changed
validation-behavior claim and introduces no RxDB production repair class.

### Evidence parser correction

Independent review found that the final snapshot's anchored reach-log parser
missed generated rows preceded by Vitest reporter dots. The executable reach
checks had passed; the evidence extraction was incomplete. The
[corrected snapshot](2026-11-17-rxdb-receiving-final-test-snapshot-v2.json),
SHA-256
`8208df540aa6e462b1cd4fea5d4763f0bd6c93ac322f9935b89e9429a98a9bbe`,
preserves the same source/configuration hashes and supersedes only that
extraction. It finds the property text anywhere in each line and adds each
JSON reach row once.

The independent final mutation logs each contain 26 reach rows per campaign:
25 constructions plus the generated aggregate. Each fixed/random campaign
therefore records 85 mutation histories, not only its constructions. All 25
declared states reached at least twice in each fixed campaign; random minima
were three for Node and two for Chromium. The latest gate rerun's minima were
two/two in Node and two/one in Chromium; the required minimum is one. The
original passing source enforcement and budgets are unchanged.

### Independent package verdict

Independent reviewer `runtime_sync` approved the bounded RxDB-owned receiving
slice at corrected snapshot `8208df54…98a9bbe`. All 34 owned test/configuration
hashes and both unchanged production hashes matched. No package-source finding
remained after the final 111 Node and 107 Chromium mutation/control runs. The
distinct added receiving/harness slice totals 295 Node and 259 Chromium tests.
The [independent runtime review](2026-11-17-cross-adapter-rxdb-independent-runtime.md)
and [immutable evidence](2026-11-17-rxdb-independent-runtime-evidence.json)
record its ORC outcomes, exact logs and reach.

This package verdict is conditional on the broader audit's independent final
review/freeze of shared dependencies. Shared receipt/gate owners changed during
that audit; the package verdict does not approve those edits. It also does not
credit generated SDK schema refusal or RxDB-handler × persisted-wrapper
mutation histories. Required `pnpm lint:changed` passed after the source edits;
the final append-only review records add no executable behavior.

# RxDB persisted initial-receipt receiving evidence

The test-only receiver is frozen in
`2026-11-17-rxdb-persisted-receipt-final-test-snapshot.json`, SHA-256
`4329aa02575ac506152491d9ebcbe72f0bcdc7bf77a81eb91f4b4dddb48202b9`.
The unchanged RxDB source hash is
`c78f7409f9e539a6bf575718f36a91309c191b18638be29a7d87b481914e65f7`.
The earlier `rxdb-persisted-receipt-test-snapshot.json` is preliminary evidence;
it does not contain the final teardown observation or native fault controls.

## Law and receiving boundary

The existing Direct initial-receipt oracle owns the judgment. Authority is the
glossary's cleanup/applied-receipt contract and Collection lifecycle contract.
This receiver supplies the explicit **rejected held receipt** premise. It does
not assert that cleanup cancels an already accepted transaction.

The real RxDB memory-storage query supplies the initial complete result. The
persisted wrapper's first baseline read remains held before that transaction's
admission. RxDB receives the actual asynchronous receipt from `params.commit`;
the driver returns that same receipt without adding a signal. Cleanup starts
before releasing the baseline read. The receipt then rejects naturally. The
neighboring schedule releases the read and awaits actual application before
cleanup. Empty and nonempty source results use the same path.

Controlled persistence, real Node SQLite, and actual Chromium worker/OPFS use
one receiving driver and the same shared grammar, model, and comparison.
Native detached-error recording remains live through source disposal and
persistence close. Each host drains eight task turns before copying its final
error array; the browser removes its listener afterward. Completed observations
retain secondary teardown diagnostics through `retainOracleCleanupObservation`.

## Execution and reach

Default runtime: Node 24.19.0. Individual Vitest runs use one worker.

| Receiving path | Result | Fixed generated counts: held / applied / empty / nonempty | Random generated counts |
| --- | --- | --- | --- |
| Controlled persisted wrapper | 30 tests passed | 6 / 6 / 4 / 8 | 9 / 3 / 4 / 8 |
| Node SQLite persisted wrapper | 30 tests passed | 6 / 6 / 4 / 8 | 4 / 8 / 4 / 8 |
| Chromium worker/OPFS | 28 tests passed | 6 / 6 / 4 / 8 | 7 / 5 / 4 / 8 |

Every path additionally executed each of the four randomized constructed states
once per fixed/random campaign. The shared run budget remains 12 generated
histories per campaign, fixed seed 2377 plus an unseeded campaign. Missing-state
controls reject each omitted constructed state. The receiving projection does
not use the grammar's `reason` coordinate: the real wrapper owns its rejection
reason, and this law compares receipt disposition rather than error labels.

Commands, from `packages/rxdb-db-collection`:

```sh
node ../../node_modules/vitest/vitest.mjs run tests/persisted-initial-receipt-oracle.property.test.ts --coverage.enabled=false --typecheck.enabled=false --maxWorkers=1
node ../../node_modules/vitest/vitest.mjs run --config vitest.browser-oracles.config.ts tests/persisted-initial-receipt-oracle.browser.test.ts --coverage.enabled=false --typecheck.enabled=false --maxWorkers=1
```

Local execution logs are `.review-2377/rxdb-persisted-receipt-final-node.log`
and `rxdb-persisted-receipt-final-chromium.log`. Original production is GREEN;
there is no product RED or production repair in this slice. An initial missing
Node-environment directive and a blocked localhost bind were setup failures,
not semantic RED results. Both were corrected before the credited runs.

## Sensitivity, replay, and limits

Shared raw-checker calibrations reject a detached receipt rejection and retain
that primary mismatch beside a secondary teardown failure. Two bound controls
per Node host execute actual post-record child-process failure, both alone and
with an actual delayed native rejection after raw recording/source disposal.
They verify the primary product checkpoint survives the secondary worker exit.
An actual Chromium delayed rejection is also rejected as `detachedErrors` by
the same comparison; its clean neighbor passes. The local execution is recorded
in `.review-2377/rxdb-persisted-receipt-recorder-calibration.log`.

Disabling RxDB's `firstApplied.catch` survived an exploratory sensitivity run.
This is equivalent for original-promise detached errors in this bounded path:
`persisted.ts#visibleAfterDurable` installs `visible.catch` before exposing that
receipt. After cleanup, RxDB's `isStopped` check returns before
`Promise.all(applied)`. No rejecting source continuation is taken here. This
receiver therefore makes **no source-continuation-handler closure claim**.
Actual active source-query failure remains owned by RxDB's eager-gate receiver;
the ordinary source-receipt handler also remains in production.

Guarded Node SQLite and Chromium OPFS replays with seed 2377, path `0`, unit
`random seed: generated` each witnessed exactly one execution. Logs are
`rxdb-persisted-receipt-node-replay.log` and
`rxdb-persisted-receipt-chromium-replay.log`. These exercise the same model and
receiving paths. They do not establish arbitrary never-settling receipt
behavior; the held-baseline abandonment premise must settle the actual receipt.

The evidence covers one initial transaction, three source keys, empty results,
two cleanup cuts, the three named storage hosts, and native error recording.
It does not cover saved-demand completeness, remote replication, concurrent
tabs, accepted receipts held after admission, or arbitrary source failures.
Applicable primary owners retain those separate obligations.

ORC-001 through ORC-010 and ORC-012 through ORC-016 use the shared owner's law,
independent source-mask model, history grammar, comparisons, calibrations,
replay, and reach checks, with the receiving premises and observations above.
ORC-011 requires no second semantic model: the concrete shared-fault hypothesis
here concerned recorder suppression, addressed by native event faults rather
than another lifecycle implementation. No oracle budget was lowered.

## Independent review

The enforcement reviewer approved the exact final snapshot on 2026-11-17 after
verifying all 15 file hashes, including unchanged production. Its independent
Node selection passed 8/8 held-receipt and post-record worker-failure controls;
actual Chromium/OPFS held-receipt selections passed 2/2. It inspected the full
60 Node and 28 Chromium tests, reach, and native error cuts. Approval is bounded
to genuine wrapper-deferred abandonment/application and recorder fidelity. The
review explicitly accepted the catch-deletion equivalence argument above and
made no source-handler closure claim.

The exact-snapshot law review is recorded when its verdict completes.

## Type-check amendment

The approved `4329aa02575ac506152491d9ebcbe72f0bcdc7bf77a81eb91f4b4dddb48202b9`
snapshot remains immutable. A final package check found weak-type generic
inference at the cleanup helper call. The sole receiving-source change adds
the explicit `InitialReceiptObservation` type argument; emitted JavaScript,
law, grammar, observations, and comparisons are unchanged.

The amended snapshot is
`2026-11-17-rxdb-persisted-receipt-final-test-snapshot-v2.json`, SHA-256
`3a3e34a6f281b15c52e19bce841ba2f4f45d245cd77483a5e968bdc74283dfa8`.
Its other 14 file hashes match the prior snapshot, including production.
`tsc --noEmit -p packages/rxdb-db-collection/tsconfig.json` and scoped ESLint
both pass; logs are `rxdb-persisted-receipt-final-types-v2.log` and
`rxdb-persisted-receipt-final-lint-v2.log` under `.review-2377/`.
The unchanged runtime campaigns above remain the semantic evidence.

The law reviewer approved the exact v2 snapshot after verifying all 15 hashes
and clean type/lint logs. The enforcement reviewer verified the sole type-only
receiving-source delta and carried its approval to that owned slice. A later
concurrent change to the shared initial-receipt registration suite requires its
own stable dependency freeze; neither verdict silently approves that later
shared change. The independent runtime verdict and actual late native-error
control are recorded in `2026-11-17-cross-adapter-rxdb-independent-runtime.md`.

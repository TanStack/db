# Direct PowerSync persistence receiving review, 2026-11-17

This record covers persistence receiving instruments for
[PR #2377](https://github.com/TanStack/db/pull/2377), reviewed against original
production commit `92a1493e0f45dbfd1fc3a51460ccb9228d8f787d`. The test-only
snapshot is identified by the SHA256 inventory below. The direct adapter's
production diff remained empty throughout these executions.

The original persisted-startup behavior passes on controlled storage, Node
SQLite and actual Chromium worker/OPFS. Cleanup of a pending initial source
receipt fails the separate receipt law on all three paths: the real wrapper
rejects the receipt and an adapter continuation produces a detached abort
rejection. The original-production sections preserve that pre-repair evidence;
the final section records later production verification and its limits.

## Authority, owners and inventory before edits

The SQLite guide's [Use with a sync adapter](../../guides/sqlite-persistence.md#use-with-a-sync-adapter)
permits decorating a Collection sync adapter with `persistedCollectionOptions`.
The [persisted-startup coverage owner](../oracle-coverage.md#adapter-conformance-persisted-startup-2367)
and its [independent set model](../../../packages/db-adapter-conformance/tests/persisted-startup-oracle.ts)
supply READY-3/PUB-7 complete replacement, durable acceptance and network-first
fallback judgments. A direct PowerSync table is a whole-Collection source: its
complete answer replaces the entire saved baseline. Peer-scope and SQLite-SDK
batching premises do not transfer to this adapter.

The separate [initial-receipt owner](../../../packages/powersync-direct-collection/tests/initial-receipt-oracle.ts)
derives cleanup and applied-receipt expectations from the Collection API,
[glossary](../glossary.md), subscription lifecycle contract and optimistic-history
contract. Cleanup invalidates an eager sync run, cancels its pending receipt,
leaves the public Collection empty and cleaned up, and handles the rejecting
continuation. The neighboring legal schedule applies the receipt before cleanup.
The model deliberately makes no row or readiness claim while the receipt is
held: persisted restore can independently publish and mark ready.

Before test edits, the receiving inventory required the following distinct
production boundaries. A controlled result alone was not accepted for the real
storage or browser claim.

| Receiving path | Controlled premise | Required observations |
| --- | --- | --- |
| Controlled persistence | Hold the first persisted row read; deliver an actual SDK checkpoint around restore or network-first fallback | Saved fallback; public and durable first result; refresh fulfillment and durable refresh; local-only reopen; row-read count |
| Node SQLite | The same row-read hold around actual SQLite operations | The same shared startup judgments, independently of controlled storage |
| Chromium worker/OPFS | The same row-read seam with actual worker reads, writes and close | The same startup cuts and finite histories; native browser diagnostics; fixture artifact cleanup |
| Actual pending receipt on each host | Keep the first persisted row read held while a real SDK complete answer commits | Actual wrapper receipt created and pending/applied; cancellation rejection; public state and detached errors after cleanup |

The direct adapter does not call `hydrateBaseline`. Therefore a law about an
adapter-owned hydration continuation cannot establish this receipt premise. The
new receiver instead records the actual wrapper `commit(signal)` receipt. It
does not replace that receipt or manufacture its rejection. Native Node
`unhandledRejection` events are isolated from Vitest in child processes; the
browser records native `unhandledrejection` events and preserves host page errors.
No browser feature polyfills are injected.

## Original-production startup GREEN

The Node registration reuses the shared grammar, model, composition driver,
checkpoints and bound calibrations. Each host runs its fixed histories plus an
80-history seed-2367 campaign and an equal-budget fresh campaign. The browser
enumerates all 26 shared finite histories with the shared checker; it adds
determinism/reach checks rather than a second expected answer. The browser does
not claim the Node campaigns' random coverage.

| Command, from the named package | Result |
| --- | --- |
| `@tanstack/powersync-direct-collection`: `node ../../node_modules/vitest/vitest.mjs run tests/persisted-startup-conformance-oracle.property.test.ts --coverage.enabled=false --maxWorkers=1` | 208 passed, controlled and Node SQLite together, 10.18 s |
| `@tanstack/browser-db-sqlite-persistence`: `node ../../node_modules/vitest/vitest.mjs run --config vitest.adapter-oracles.config.ts e2e/powersync-direct-startup-oracle.browser.test.ts --maxWorkers=1` | 28 passed, actual Chromium worker/OPFS, 11.20 s |

Executions used Node v26.13.1 and installed Google Chrome. Chromium tests ran
with local Vite listeners permitted. The independent enforcement reviewer
repeated the complete Node registration: 208 passed in 10.05 s.

The following measured counts are the ordinary 80-history campaign counts,
excluding constructed histories. The shared suite separately enforces the
constructed histories' declared states and calibrates missing-state failures.

| Declared state | Controlled fixed | Controlled fresh | SQLite fixed | SQLite fresh | Browser finite histories |
| --- | ---: | ---: | ---: | ---: | ---: |
| empty baseline | 6 | 13 | 6 | 8 | 4 |
| empty result | 39 | 38 | 39 | 36 | 6 |
| network-first fallback | 23 | 22 | 23 | 22 | 6 |
| network-first source result | 52 | 50 | 52 | 51 | 10 |
| omitted row | 63 | 46 | 63 | 55 | 22 |
| overlapping update | 27 | 32 | 27 | 34 | 10 |
| persisting mutation | 69 | 69 | 69 | 67 | 13 |
| response before restore | 42 | 35 | 42 | 45 | 16 |
| restore before response | 38 | 45 | 38 | 35 | 10 |

These are neighboring GREEN results. They do not establish receipt cleanup,
on-demand stream ownership, mutation confirmation or untested intermediate
publication behavior. Startup wrong-answer controls reject stale first-result
durability, saved fallback loss, delayed durability until refresh, and missing
constructed reach through the same shared comparison.

## Actual receipt RED and adjacent schedule

The [persisted receiver](../../../packages/powersync-direct-collection/tests/persisted-initial-receipt-driver.ts)
holds the first row read, preloads the wrapped Collection and sends a real SDK
complete answer. The observed wrapper receipt must exist before cleanup. In the
held schedule cleanup occurs before releasing the read. In the adjacent schedule
the read is released and preload finishes before cleanup. Both schedules then
wait for receipt settlement and native detached-error delivery before observing.

The shared grammar varies all eight source membership masks, both cleanup
schedules and bounded metadata. Empty/nonempty source and held/applied receipt
states have randomized constructions. The wrapper determines its real abort
reason; generated metadata is not evidence of distinct native error identities.

All three paths reproduce this shrunk held-receipt observation for source mask 0:

```json
{
  "receiptCreated": true,
  "receiptPendingAtCleanup": true,
  "receiptAppliedBeforeCleanup": false,
  "receiptRejected": true,
  "finalStatus": "cleaned-up",
  "finalRows": [],
  "detachedErrors": [
    "AbortError: Sync transaction was aborted before application"
  ]
}
```

The shared verdict is law `initial receipt cleanup`, checkpoint `after cleanup`,
difference `detachedErrors`; the expected detached-error list is empty. A
single-row held history independently reproduces the same violation. The
after-application schedule observes an applied receipt before cleanup, no receipt
rejection, empty cleaned-up public state and no detached errors on all hosts.

After the instrument correction described below, the complete registration ran
12 histories per generated unit with seed 2377 and an equal-budget fresh campaign,
all randomized constructions, fixed histories and bound calibrations:

| Receiver/property suffix after `adapter.powersync-direct.initial-receipt-cleanup.` | Complete reviewed result |
| --- | --- |
| `persisted-controlled` | 11 failed, 17 passed of 28 |
| `persisted-node-sqlite` | 9 failed, 19 passed of 28 |
| Both native hosts | 20 failed, 36 passed of 56; no type errors; 27.76 s |
| `chromium-opfs` | 9 failed, 19 passed of 28; 14.67 s |

Every product counterexample has the detached-error difference above. A bound
calibration that selects an already-failing clean held history reports that
clean-run failure; it is not claimed as a successful mutant kill. The
after-application and teardown-priority controls pass. Fresh histories account
for different failure counts in earlier discovery runs. Since original
production fails, there is no claim of a complete successful receipt reach
campaign. Each checked held replay below positively reaches the receipt premise.

The complete native command is the startup Node command with file
`tests/persisted-initial-receipt-oracle.property.test.ts`. The complete browser
command is the startup browser command with file
`e2e/powersync-direct-persisted-receipt-oracle.browser.test.ts`.

### Checked direct replays

Each of the three property suffixes above was replayed with seed `2377`, shrink
path `0:0`, and unit `random seed: generated held-receipt`. The checked guard
reported the exact property, `numRuns: 1`, `executions: 1`, `failed: true`.
The nonzero exits are reached semantic RED results, rather than filtered tests
or setup failures. For either native property, from the direct adapter package:

```sh
TANSTACK_DB_ORACLE_PROPERTY=adapter.powersync-direct.initial-receipt-cleanup.persisted-controlled \
TANSTACK_DB_ORACLE_SEED=2377 TANSTACK_DB_ORACLE_PATH=0:0 \
TANSTACK_DB_ORACLE_UNIT='random seed: generated held-receipt' \
node --import tsx ../db/tests/oracle-replay.ts \
  tests/persisted-initial-receipt-oracle.property.test.ts \
  --coverage.enabled=false --maxWorkers=1
```

Replace only the property suffix with `persisted-node-sqlite` for that host.
For `chromium-opfs`, run from the browser package:

```sh
TANSTACK_DB_ORACLE_PROPERTY=adapter.powersync-direct.initial-receipt-cleanup.chromium-opfs \
TANSTACK_DB_ORACLE_SEED=2377 TANSTACK_DB_ORACLE_PATH=0:0 \
TANSTACK_DB_ORACLE_UNIT='random seed: generated held-receipt' \
node --import tsx ../db/tests/oracle-replay.ts \
  --config vitest.adapter-oracles.config.ts \
  e2e/powersync-direct-persisted-receipt-oracle.browser.test.ts --maxWorkers=1
```

## Instrument correction and independent review

Independent reviewer `oracle_diff_enforcement` confirmed a P2 ORC-010 defect:
late cleanup could discard a completed raw receipt result before the shared
comparison. The affected boundaries were inner source teardown, outer OPFS
database/artifact teardown, native storage close, and a nonzero worker exit
after an emitted record.

`retainInitialReceiptCleanup` now retains the completed observation and adds
separate `cleanupErrors`. The Node transport also accepts a completed record
before reporting a subsequent nonzero exit as a secondary diagnostic. Before-result
setup/body failures still throw. The shared suite first judges the product;
only a passing product observation can make receiving cleanup the primary law.
Bound calibrations inject cleanup alone and product-plus-cleanup corruption,
checking primary law `initial receipt cleanup` at checkpoint `after cleanup` for
the latter. Cleanup-only errors report `receiving cleanup` separately.

The ordinary instrument regression file is deliberately outside an oracle file.
It injects actual storage-close and post-record worker failures on controlled
and Node SQLite hosts, plus a wrong receipt observation followed by throwing
cleanup. Five checks passed in 3.25 s with no type errors. The independent
reviewer reran those five checks and both shared priority calibrations through
both native hosts: **9 passed, 52 skipped, no type errors, 2.03 s**. Four isolated
native worker invocations independently confirmed held versus applied receipts
on both hosts. The reviewer inspected the browser RED reports and the 14-file
fingerprint and found no remaining actionable startup/receipt finding.

Scoped ESLint completed with no warnings. The repository `lint:changed` script
completed with exit 0. Initial missing built-output imports and a denied local
listener were setup failures; neither is counted as RED. Test-only TSX source
aliases fixed the native worker's import setup.

## ORC applicability and limits

| Requirement | Evidence or limit |
| --- | --- |
| ORC-001 | Authority, whole-Collection mapping, named cuts and limits are stated above and beside executable owners. No new product contract was inferred from output. |
| ORC-002 | Startup uses the shared independent set model; receipt expectations depend on the authored cleanup schedule, not the adapter's continuation or persistence branches. |
| ORC-003 | Separate literate owners, grammars, production drivers, registrations and comparisons identify their responsibilities. This report supplements executable prose. |
| ORC-004 | Startup crosses baseline/result masks, order, render fallback and disjoint mutation. Receipt reconstructs empty/nonempty held/applied histories; removing cleanup timing loses the adjacent distinction. Domains are three keys and one initial transaction. `cleanupAt: before-commit` is outside the grammar's two legal cleanup schedules. A legal held schedule without a pending actual receipt is an unmet receiving premise, not product RED. |
| ORC-005 | Actual SDK checkpoints reach the public wrapped Collection. Startup observes the first result, durability, refresh and reopen; receipt observes actual receipt lifecycle and public cleanup. No concrete missing-source-information hypothesis remained at these cuts. |
| ORC-006 | Shared startup wrong-answer controls and receipt detached-error/priority controls use the same comparison. Original production itself is the reached wrong design for receipt cancellation. Clean-history calibration failures are classified separately. |
| ORC-007 | Both native registrations and receipt browser registration run fixed/fresh equal-budget campaigns. Three checked receipt replays each execute one requested RED history. Startup browser coverage is explicitly finite/enumerated. |
| ORC-008 | No new stateful reference machine was introduced. Startup retains the existing independent set model; receipt is a stateless schedule-to-observation expectation. |
| ORC-009 | The source is whole-Collection ownership. Persisted restore is distinct from an adapter-owned hydration continuation. Pending/applied receipt, cleanup and observation terms follow the glossary. |
| ORC-010 | Confirmed and repaired in the instrument; actual teardown fault regressions and bound priority calibrations pass, as independently rerun. |
| ORC-011 | No reviewer named a plausible shared semantic fault requiring a different second formulation for this slice. Multiple storage hosts are receiving witnesses, not independent second models. |
| ORC-012 | This versioned record binds the original production commit, exact test snapshot, results, review and open repair gate. It makes no product bug-class closure claim. |
| ORC-013 | Held versus applied receipts distinguish cancellation handling from unconditional continuation success/failure. Startup replacement/omission and fallback histories distinguish stale merge or delayed durability. |
| ORC-014 | Controlled, actual Node SQLite and actual Chromium worker/OPFS supply the named storage/runtime premises with shared judgment. The real installed SDK uses controlled HTTP; a deployed PowerSync service remains outside the claim. |
| ORC-015 | Startup reach counts and enforced constructions are reported above. Receipt has declared held/applied/empty/nonempty states and missing-state calibrations, but original production prevents a complete GREEN reach claim; each checked held replay executes once. |
| ORC-016 | Fixed histories use the shared model/driver/comparison. Supplemental instrument examples remain in the ordinary cleanup test file. |

This slice excludes concurrent tabs/writers, arbitrary failed I/O, deployed
PowerSync servers, SQLite-SDK batching, peer scopes and every intermediate
publication. Other direct-adapter owners cover eager reload, decoding, mutation
confirmation and on-demand streams; startup GREEN supplies none of those claims.
The later on-demand receiving extensions use the same public persistence wrapper
but do not establish saved-row or reopen durability.

At this original-production checkpoint, the open product repair gate was the
receipt law across all three receiving paths, not instrument readiness. A later
repair must pass the complete shared campaigns, declared reach, calibrations and
checked replays on each path. The original detached-error behavior is the hostile
design that those same cuts must continue to reject. The original checkpoint
contained no repaired-production GREEN or post-repair mutant claim.

## Exact reviewed snapshot

The independent reviewer verified these 14 SHA256 entries. The inventory text's
SHA256 is `e78c66c0b1de0571eb903f3bcedf9127a1ae8937a92488a8ed211cd8aa297b78`.
The source files were rechecked against it before this record was written.
The page includes unrelated direct-adapter bindings; its hash identifies the
reviewed page snapshot, not a review claim for those other owners.

```text
c33b98a47a5ce3321dd124b7d6ac8c346f1c2c8b8feb9de9c986fcc3a8476162  packages/powersync-direct-collection/tests/persisted-startup-driver.ts
33aba8a91516e161ba4ed1fc13993786c119a92fda946180817c73fe8ba3411b  packages/powersync-direct-collection/tests/persisted-startup-conformance-oracle.property.test.ts
ed6594285727f700a4df0bb75a96554f01b231a2d003ce632f924ce23ec68200  packages/powersync-direct-collection/tests/initial-receipt-oracle.ts
9e13747e0bbc4ea94ae16ad5e00f749e1e802349c6ce4c5a887b8ddf97373a11  packages/powersync-direct-collection/tests/initial-receipt-oracle-suite.ts
a00f29653ccaae8c3be8eb67f64ccf5fa81f77b4555d4ef94b210d3fe59314d0  packages/powersync-direct-collection/tests/persisted-initial-receipt-driver.ts
b06ae465031990e6200747d43dbed689b494597ced7070c92a4c1d0e8b0dc61a  packages/powersync-direct-collection/tests/persisted-initial-receipt-node-driver.ts
2e888b83d1d72a321073b9636b6d09d62cb100bdd24a805e08dcab32dc6e518a  packages/powersync-direct-collection/tests/persisted-initial-receipt-worker.ts
7ea314b49d46bb43b3747d9498e7db88874e599c95328d7083ca9f1a21bfb88d  packages/powersync-direct-collection/tests/persisted-initial-receipt.tsconfig.json
dcc8068db2ddf388566a0b9c3b0d3f785bfd2e9ddc563c219a6811047cc9163e  packages/powersync-direct-collection/tests/persisted-initial-receipt-oracle.property.test.ts
a823caa8db41b78947b7d8b1943789cf0490b8cebfea920f380f11e2b1b8b63c  packages/powersync-direct-collection/tests/persisted-initial-receipt-cleanup.test.ts
88e4f0e1902ed45102adc2cb00e223a2df1daa6d7541c190733daf119d416621  packages/browser-db-sqlite-persistence/e2e/powersync-direct-startup-oracle.browser.test.ts
c266d210ccba96a6b6770c7d88f06cd0ab3dc8bd60e5b5cf8b86f292b4a6ac3b  packages/browser-db-sqlite-persistence/e2e/powersync-direct-persisted-receipt-oracle.browser.test.ts
94c8b9c17a2861bbe9a14f07e5a7cb24848652fe6a295bed25fca2181b197eb9  packages/browser-db-sqlite-persistence/e2e/powersync-direct-receiving.opfs.ts
b96e34fef3fca0c1bd85b32ef735a308d4b9a90dff9cf811cbf884b64d48499d  packages/browser-db-sqlite-persistence/e2e/powersync-direct-receiving.opfs.html
```

Local `.review-2377/` logs support this versioned evidence: startup
`persistence-node-pre-edit.log` and `persistence-browser-pre-edit.log`; reviewed
receipt `persisted-receipt-node-reviewed-pre-edit.log` and
`persisted-receipt-browser-reviewed-pre-edit.log`; exact replays
`persisted-receipt-{controlled,node-sqlite,opfs}-checked-replay.log`; instrument
`persisted-receipt-cleanup-fault.log`; lint
`persisted-receipt-cleanup-lint.log` and `persistence-lint-changed-final.log`.
They are supporting artifacts; the authority, verdict, counterexample, counts,
reproduction interface, limits and reviewed fingerprints are preserved here.

## Earlier production verification and health-report receiving amendment

After the original-production oracle gate and independent reviews completed,
the production patch was applied. The tested production SHA256 values were:

```text
a30e71beb96fade6c5714a300ea76628386dd0b9b1ea04ad60ccf3ee9ae074fa  packages/powersync-direct-collection/src/index.ts
65792b89c427219806dab3f24ac1ae55c8ec3eef580bdc12055a9887fdb6d10c  packages/powersync-direct-collection/src/subsets.ts
```

An initial actual Chromium run selected all eight direct-adapter browser wrapper
files. It completed with 1,030 passed and 32 failed of 1,062 tests in 175.95 s.
Seven files passed completely, totaling 841 tests: persisted receipt, persisted
startup, unwrapped on-demand streams, eager reload/gate, mutation confirmation,
decode refusal and shared-client receiving. The one failing file was persisted
on-demand streams. The run-start and run-end production fingerprints matched
the values above. The supporting log is `browser-production-green.log`; its
filename is not a claim that this first invocation passed completely.

The remaining failures exposed an observation-cut gap in that persisted
receiver. Child-query cleanup does not join persistence's ordered asynchronous
health-report queue. The recorder could inspect public health after a lease was
released but before all already-issued `reportHealthy` calls reached core.
The parent restored the original production files before amending the receiving
instrument. The shared on-demand law, history grammar, budgets and expected
health values remained unchanged.

The [health-report handoff helper](../../../packages/db-adapter-conformance/tests/health-report-handoff.ts)
now records each source-issued report before persistence and acknowledges the
same callback method and raw error identity when persistence forwards it to
core. A receiving cut captures the already-issued reports and waits for their
acknowledgments. It does not wait for an expected health value, add a provider
event, poll the SDK, or require later reports. Three ordinary helper tests cover
missing acknowledgment, wrong acknowledgment and the captured-target boundary.
Public source cleanup still precedes fixture rescue; pending release reports
are drained while the source is active. The independent on-demand review and
exact amendment snapshot are recorded in the
[on-demand review](2026-11-17-powersync-direct-on-demand.md) and
[handoff amendment snapshot](2026-11-17-powersync-direct-handoff-amendment-snapshot.json).

The amended receiver was first checked on restored original production using
the persisted browser file and filter
`error-identity-changed|stream-recovered|failure between provider|subscription mapper|exclusive failure retires`.
It completed with 32 failed, 14 passed and 175 skipped in 79.46 s
(`browser-handoff-original-affected.log`). Twenty-two semantic comparisons still
rejected the original changed-error ownership, shared-error retirement,
held-application or cleanup-admission behavior. Ten bound calibrations selected
an already-failing clean baseline. The independent-retirement neighbor passed.
Recorded handoffs had equal issued/delivered counts and zero pending reports at
the cuts; there was no missing-acknowledgment, setup, host or premise failure.
This was reached original-production RED after the instrument amendment, not a
post-fix adjustment of expected health.

After review approved the amendment, the parent reapplied exactly the production
patch fingerprinted above. The final actual Chromium worker/OPFS invocation was:

```sh
# From packages/browser-db-sqlite-persistence, using Node v26.13.1.
node ../../node_modules/vitest/vitest.mjs run \
  --config vitest.adapter-oracles.config.ts \
  e2e/powersync-direct-persisted-subsets-oracle.browser.test.ts --maxWorkers=1
```

It completed **221 passed of 221, exit 0, in 108.29 s**, including both 60-history
generated campaigns, every constructed-state check, fixed history and bound
calibration (`browser-production-persisted-final-green.log`). The production
fingerprints still matched after the run. Measured ordinary generated reach is
below. These counts exclude the five enforced randomized constructions per
state in each campaign; all those constructions and missing-state calibrations
also passed.

| Declared state | Fixed seed 2377 | Fresh campaign | Enforced constructions per campaign |
| --- | ---: | ---: | ---: |
| error identity changed | 11 | 11 | 5 |
| independent error retired | 13 | 11 | 5 |
| loaded cleanup | 2 | 7 | 5 |
| mapping cleanup | 7 | 9 | 5 |
| partial overlap retired | 7 | 10 | 5 |
| shared error retained | 9 | 6 | 5 |
| stream error after application | 12 | 5 | 5 |
| stream error before application | 4 | 6 | 5 |
| stream error before sync | 6 | 6 | 5 |
| stream recovered | 11 | 9 | 5 |

The resulting browser evidence is **841 unaffected passing tests from the
eight-file invocation plus 221 passing tests from the final amended persisted
receiver**, covering all 1,062 browser tests across those valid runs. This is
not described as a single all-green eight-file invocation. The initial seven
passing files were not changed by the persisted receiving-cut amendment.

The final amendment's receiving-file SHA256 values were:

```text
9ee1acac3abe1948c4c9683ed1002b33f083b24cb681b409931228bcee228fa1  packages/db-adapter-conformance/tests/health-report-handoff.ts
6fad1e971d06085c8056c2ed2080f57ee62afc94619765747210ca9b681cd093  packages/db-adapter-conformance/tests/health-report-handoff.test.ts
214aa23c736c4b994741c92871b3b71802989aea68bda14358a20952261411e9  packages/db-adapter-conformance/tests/on-demand-streams-driver.ts
d3f04b5c8cf3009e9efc70c3da7136fe89d89a473ce01572a7b17e0064e84082  packages/powersync-direct-collection/tests/on-demand-streams-persisted-driver.ts
9bcae7b5e5d3784c0809f928102d454b6297dac6816c3f4364e3aceadb5423cc  packages/powersync-direct-collection/tests/on-demand-streams-driver.ts
```

This amendment adds ORC-005 observation timing and ORC-014 receiving evidence;
it does not revise the governing law. Original RED plus final GREEN and retained
calibrations establish the exercised browser histories at those cuts. Native-host
post-repair results and broader bug-class closure belong to the parent review
and each executable owner's final evidence. SDK-native recovery behavior outside
the controlled service schedules remains outside this browser verification.

## Final browser validation after the completed amendments

This section supersedes the earlier 1,062-test browser aggregate as the final
validation result. After the mapper and on-demand decode amendments completed
their original-production gates and independent reviews, the parent froze the
[final 67-file test snapshot](2026-11-17-powersync-direct-final-test-snapshot.json).
Its SHA256 is
`42ca68d5bd599187b1d3a5a70abb20ba4e7b396e1165e760f5c723ef66fd70da`.
The final scoped production repair has these source SHA256 values:

```text
a30e71beb96fade6c5714a300ea76628386dd0b9b1ea04ad60ccf3ee9ae074fa  packages/powersync-direct-collection/src/index.ts
00fb4cb1976ec8b384d01e1fbb483768204bc40b69a3dcc19ed21b4356b3e380  packages/powersync-direct-collection/src/subsets.ts
```

The optional extra post-mapper request-signal guard was removed from the scoped
repair after law review: a transient acquisition that leaves no stream or HTTP
work did not establish the proposed exact-zero-acquisition law. The existing
entry abort check and post-mapper source-active guard remain. No exact-zero
acquisition expectation was added to force a test distinction.

The final mapper observations also distinguish a prior successful preload from
the query's current status, count priority dispatch independently of the
priority-value comparison, and observe terminal source health explicitly as
`sourceError: Boolean(collection.health.error)`. A wrong terminal error with
ready/current statuses preserved is rejected. On restored original production,
the exact final terminal-observer slice ran both Chromium paths and produced
34 failed, 202 passed and 438 skipped of 674 in 47.57 s. Its failures classify as
22 equal-parameter retained-peer health violations, two source-cleanup stream
leaks and ten bound calibrations selecting that failing clean baseline. Both
new terminal-health controls passed. No host, setup, premise or acknowledgment
failed (`browser-mapping-terminal-original-affected.log`). Earlier mapper
revisions remain historical; their results are not substituted for this gate.

After the final gate and approval, one complete actual Chromium invocation ran
all eight direct-adapter browser wrapper files against the source hashes above:

```sh
# From packages/browser-db-sqlite-persistence, using Node v26.13.1.
node ../../node_modules/vitest/vitest.mjs run \
  --config vitest.adapter-oracles.config.ts e2e/powersync-direct- --maxWorkers=1
```

**All eight files and all 1,396 tests passed, exit 0, in 215.48 seconds.** This
includes both 337-test on-demand browser receivers, expanded eager/on-demand
decode refusal, actual OPFS startup and initial-receipt cleanup, eager reload
and terminal gates, shared-client behavior, mutation confirmation and
cancellation. The execution log is `browser-production-final-full.log`.
All 67 test fingerprints and both final production fingerprints were checked
before and after the run and matched. No test or production source was edited
during this validation.

The versioned [final browser reach record](2026-11-17-powersync-direct-final-browser-reach.json)
preserves the exact command, result, test/source fingerprints, all 19 ordinary
generated or enumerated campaign summaries, and measured constructions for
the stream and receipt receivers. Its SHA256 is
`57d0bdd657feb6958a7d6468335b0d278c6b44a121c841eea66670f88775ba67`.
The record is the durable result; the local execution log is supporting evidence.

For the two on-demand browser paths, measured ordinary 60-history reach is
below. Their fixed-seed counts are equal because the same seed, grammar and
comparison run on both paths. Each state additionally has five enforced
randomized constructions in each normal campaign on each path; all those
checks and calibrations passed.

| Declared state | Fixed seed 2377, each path | Fresh Chromium | Fresh Chromium/OPFS |
| --- | ---: | ---: | ---: |
| empty mapping applied | 2 | 1 | 4 |
| error identity changed | 14 | 9 | 10 |
| independent error retired | 19 | 15 | 14 |
| loaded cleanup | 4 | 4 | 1 |
| mapping cleanup | 4 | 6 | 8 |
| distinct parameters retired | 9 | 8 | 7 |
| equal parameters retained | 8 | 9 | 4 |
| partial overlap retired | 5 | 6 | 3 |
| priority requested | 3 | 1 | 4 |
| shared error retained | 12 | 12 | 9 |
| stream error after application | 3 | 5 | 7 |
| stream error before application | 3 | 5 | 3 |
| stream error before sync | 4 | 2 | 4 |
| stream recovered | 8 | 11 | 9 |
| throwing mapper retried | 1 | 3 | 3 |

The actual OPFS initial-receipt receiver now completes its full successful reach
campaign, rather than only the original reached RED witnesses:

| Declared state | Fixed seed 2377, 12 histories | Fresh, 12 histories | Additional enforced constructions per campaign |
| --- | ---: | ---: | ---: |
| after application | 6 | 7 | 1 |
| empty source | 4 | 3 | 1 |
| held receipt | 6 | 5 | 1 |
| nonempty source | 8 | 9 | 1 |

All receipt missing-state and teardown-priority calibrations passed. The final
startup receiver enumerated the same 26 histories and reproduced the nine
browser reach counts reported in the original startup table. The expanded
decode receiver reached the on-demand source-ready/query-pending boundary in
38 fixed-seed and 41 fresh ordinary histories, with its per-mode/per-position
constructions and refusal controls also passing. Other families' measured
campaign summaries remain separate in the versioned reach record rather than
being inferred from another receiving path.

This final GREEN is bounded to the frozen histories, production paths and
observations. The direct eager browser wrapper covers reload and terminal
gates; it does not run the deferred generic HEALTH-2 recovery lane. SDK-native
recovery beyond the controlled service schedules remains deferred. Persisted
on-demand receiving still makes no saved-demand or reopen-durability claim.
Native-host final results and any broader bug-class closure require the parent
review and the corresponding owners' evidence.

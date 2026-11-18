# Native PowerSync decoder production review

Independent reviewer: `/root/parse_oracle_author`. Reviewed workspace base:
`92a1493e0f45dbfd1fc3a51460ccb9228d8f787d`. This review concerns the native
`packages/powersync-db-collection/src/powersync.ts` decoder repair at SHA-256
`7781cf0834530b48cd7be9db052261964866bf92a6a44adb2c15fe0aa6e282de`.
The reviewer made no production, model, grammar, comparison or dependency edits.

Verdict: approved for the bounded native decoder repair. No actionable
production-source finding was confirmed. This verdict follows the author's
final receiving GREEN and source-mutant results; it does not approve unrelated
adapter changes or claim a complete native adapter portfolio.

## Contract and source inspection

`src/definitions.ts` declares failure to deserialize and apply incoming changes
fatal because it leaves the Collection inconsistent with its source. Its
`syncBatchSize` contract permits streaming initial pages. The glossary defines
loading error, terminal sync error, cleanup and a fresh sync run. These
authorities require refusing the faulty page while retaining already accepted
pages, stopping the failed run, and permitting recovery in a new run.

The run-local failure marker retains even a falsy thrown value. Only
`deserializeSyncRow` is caught by the new fatal wrapper; ordinary load-hook
refusal and retryable SQL tracking errors retain their existing classifications.
The same wrapper handles initial rows and both current and previous live rows.
Queued changes, reconciliation, physical release and later subset admission
check the terminal marker. The after-hook check retains ownership of a cleanup
callback acquired while refusal occurred. Tracking disposal uses the existing
shared disposal promise, and public cleanup joins it. A new sync invocation
creates a fresh marker.

Source inspection found no later same-run commit path for the uncommitted
refused page under the declared initial-read or single-live-transaction
histories. Earlier committed receipts remain obligations of core. This is a
bounded source argument, not evidence for arbitrary concurrent provider work.

## Evidence inspected

The pre-edit instrument gate is preserved in
[`2026-11-17-cross-adapter-powersync-pre-edit-snapshot.json`](2026-11-17-cross-adapter-powersync-pre-edit-snapshot.json),
manifest SHA-256
`0baa5eeb747d9d3485fbd31d274395c824e239c2eaf4d291643a94b39a1b306e`.
The independent instrument reviewer approved Node and Chromium semantic RED
before production edits. The original source was
`c4960f0c00aae28400de1811285458995c5b61591bd7ce42353f99ad6ab47068`.

The final 39-file manifest is preserved in
[`2026-11-17-cross-adapter-powersync-final-snapshot.json`](2026-11-17-cross-adapter-powersync-final-snapshot.json),
manifest SHA-256
`4704e028f0ae43de6751f4660e405ed766960a4873fedd911f0fd1e55744e827`.
The reviewer independently checked all 39 current files against that manifest.

Author runs were inspected, rather than independently rerun in full:

| Receiving run | Result |
| --- | --- |
| Node, four receiving files | 669 passed |
| Chromium, three receiving files | 637 passed |
| Ordinary and existing oracle neighbors, eleven files | 1081 passed |
| Isolated original source | Three semantic failures, six passing controls |
| Fatal health without abort/disposal | Three semantic failures, six passing controls; retained watcher |
| Later subset fulfills after refusal | Two semantic failures, seven passing controls; later admission |

Every cited mutant failed at `after native source batch`, law `native batch
decoding`. Actual log differences identify health/cause, watcher release,
same-run resumption or new demand admission. None is credited merely for a
setup failure, timeout or crash. Isolated source resolution and stack traces
identify the copied production entry point. The frozen shared source stayed
at the reviewed hash.

The reviewer independently executed this command with Node 24.19.0 from the
native package:

```sh
pnpm exec vitest run tests/batch-decode-conformance-oracle.property.test.ts tests/on-demand-sync.test.ts tests/load-hooks.test.ts --maxWorkers=1 --coverage.enabled=false -t 'empty-subset-after-refusal 1|live refusal retains the prior native snapshot|does not publish a provisional or rejected subset|an aborted load writes no rows|does not acquire a subset released during startup|rebuild|physical release|cleanup'
```

Result: three files passed, 51 tests passed, 417 deselected, no type errors.
This checks the selected shared-model refusal/restart histories and ordinary
neighbors for pending or reentrant hook cleanup, rejected/aborted subset
admission, tracking rebuild and physical-release retry. It adds no new
expected answer to the oracle.

Local execution logs under `.review-2377/` have these SHA-256 values:

| Log | SHA-256 |
| --- | --- |
| `native-powersync-independent-production-selected.log` | `bc697b69c7e89fc4289aa575f245fcbcc1bc431d1549dbc62e919befde5387b5` |
| `native-powersync-repair-receiving-green-v2.log` | `dd65a2f963f9b966b596937eca0aec4bc6bc254a3c466441814ba51e0c2a0e7d` |
| `native-powersync-repair-receiving-green-browser-v2.log` | `60f3aa75aa41d794282bdd94234b3fed2c4ae6e3c2d0ba1c072d652ae9db4ad2` |
| `native-powersync-decoder-original-isolated-mutant.log` | `93f43a1505f3265d5733f75a4cff53d4005cfba4e6514a2cb78e86570650a8f8` |
| `native-powersync-decoder-health-only-isolated-mutant.log` | `11bc39352af574ce1d5e7cf8fe3f3aaf99d8de2e1c25b4b5785485ee38a9b92b` |
| `native-powersync-decoder-stopped-load-isolated-mutant.log` | `3263423c75dba6e5b7325d5fee4cbe110d18c756104b74d2b37fe0045f5efb00` |
| `native-powersync-repair-neighbors-green.log` | `fdabef1fe2304aec94c7a1887ed670cbeddbb23cb00519547cf0f3b90b9c8a51` |

## Limits

The approved evidence covers one native table, initial reads or one live SQL
transaction, one to six authored rows, batch sizes one to four, eager and
on-demand decoding, legal transformed keys/Date/boolean values, synchronous
schema success/throw/issues, corrected source rows, later empty/nonempty
requests, and explicit cleanup/restart. It does not establish retained reload
refusal, persisted decoder publication, arbitrary concurrent subset owners,
local mutation confirmation, every storage implementation, or deployed
PowerSync replication. Those contracts keep their existing owners in the
[coverage map](../oracle-coverage.md); this repair does not retire them.

The reviewer also inspected the completed eleven-file neighbor GREEN, which
includes existing eager health, eager reload, persisted startup and baseline,
readiness, transactor, correctness, on-demand and hook tests. Repository
`pnpm lint:changed` passed after the independent record was added. Any edit to
the frozen source or the manifest's instruments requires review of that
amendment before reusing this verdict.

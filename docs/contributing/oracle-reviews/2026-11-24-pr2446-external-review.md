# PR #2446 external review evaluation

Reviewed production: `248161de8b7b390f7668e54e5f675a63d8f0be3a`.
This record evaluates the ten hypotheses supplied on November 24. It does not
claim a complete review of the PR. The source hashes at the end bind the repair
evidence to its production implementation.

Tests use Node 22.23.5, standalone PowerSync 0.1.1, native PowerSync Node 0.21.0,
PowerSync Web 2.6.0 and Convex 1.49.0. Browser witnesses use real Chromium and
worker/OPFS storage. Provider protocols are controlled fixtures over installed
SDKs. They do not establish behavior against a deployed PowerSync service.
The existing Direct test-only Map shims remain a host premise. These results do
not establish unshimmed Node 22 compatibility of the installed standalone SDK.

## Laws, experiments and inferences

### A rejected acquisition keeps its cause and accepted rows keep their obligations

The source cancellation and applied-settlement contract requires an acquisition
to await the rows it accepted. Rejected acquisitions establish no result.
Core cancellation ends the logical request immediately. The adapter still owes
the application of accepted rows and the required rejection of its raw promise.
These are distinct observation cuts.

The on-demand owner formerly crossed stream failure with a successful held
receipt. It did not cross failure with an unrelated durable rejection. Its
resource ledger also ignored released SDK waits. The new request-boundary
histories compose the actual SDK, Collection subscriptions, real persisted
receipts, SQLite failure and cancellation.

On unchanged production, a rejected stream and a healthy peer's delivered rows
created a pending persistence receipt. Rejecting that durable operation replaced
the stream's error in both the raw load and public subset result. The direct
subscription's signal remained current. Node SQLite and worker/OPFS rejected
the same history at the error-cause comparison.

The repair separates a failed acquisition from cancellation of an accepted
baseline. It captures the successful checkpoint's receipt before awaiting it.
A cancellation after a partial priority checkpoint also drains the already
accepted baseline. A secondary receipt rejection cannot replace the provider
failure or cancellation's `AbortError` category. Exact identity of the SDK's
internal abort error is diagnostic, not a promised cancellation result.
A fully synchronized acquisition does not look up a newer
unrelated receipt during rejection.

Independent review rejected the first repair: deleting the second receipt wait
alone let a ready-listener abort precede the successful wait's continuation.
The next experiment also found partial-priority delivery before full stream
synchronization. Both wrong designs now fail real Node and Chromium witnesses.
The later-held-receipt control distinguishes the final repair from waiting for
all future source work. Core subscription readiness and a surviving peer remain
strict observations. Conservative raw draining of a prior shared baseline has
no newly invented latency budget.

Owners: `db-adapter-conformance/tests/on-demand-streams-oracle.ts` and its suite;
Direct's `request-boundary-driver.ts` supplies installed-SDK receiving paths.

### Cleanup releases the wait owned by the run or acquisition

An application status listener can change the SDK's requested generation before
the adapter's later ready listener runs. Its `waitForSync()` then remains
pending. The old shared-client oracle counted leases and listeners but omitted
these continuations. The on-demand input ledger also treated released waits as
irrelevant input obligations.

Generated actual-SDK histories reproduced pending waits after Collection cleanup
and after release of one acquisition beside a healthy peer. Both Node and
Chromium failed the resource comparison. Ordinary repeated ready notifications
do not accumulate unbounded waits: a checkpoint resolves the preceding ones.

The repair threads the existing acquisition signal into stream-health records.
Eager waits use the sync-run signal. It adds no controller lifecycle or retry
state. Releasing a demand cancels its wait. Cleanup cancels the run's waits.
Record identity still prevents an older continuation from clearing a newer
stream error.

Owner: `db-adapter-conformance/tests/shared-client-oracle.ts`, with Direct's
shared-client and request-boundary receiving drivers.

### Partial updates need a complete durable baseline

The FIFO owner already modeled source commit order and preservation of unseen
fields after a failed persisted demand. It did not abort after the baseline
snapshot returned, observe physical row materialization, or precede that demand
with an ordinary sparse update of an unread cached key.

The alleged silent-success abort is false: `break` exits the operations loop,
then application observes the aborted signal and rejects. Generated controlled,
Node SQLite and worker/OPFS histories reach that exact await boundary, compare
the rejected receipt and error class, and prove later independent work remains
usable.

The work concern was real. One partial update materialized 3 rows with no
unrelated rows and 35 with 32 unrelated rows. Correct rows did not expose that
cost. An initial repair that trusted an accepted row's presence was wrong:
ordinary sparse source writes can leave a partial public row while SQLite
retains its unseen fields. The new generated prelude rejected that repair on
controlled storage, real SQLite and OPFS.

The final repair adds an optional `rowKeys` materialization hint to atomic resume
reads. SQLite projects encoded storage keys inside the existing transaction.
Generic adapters may return additional rows. Omission of the option preserves
the complete read. Position, reset, collection metadata and whole-cache
certification retain their original scope.

Each replay transaction requests every partial-update key and owns its projected
baseline. This avoids a one-shot key union that misses a transaction appended
during the awaited read. Encoded-key deduplication preserves numeric/string keys
and signed zero. Query chunks use the actual transaction driver's binding cap.
The unfiltered branch retains its original direct array assignment, avoiding a
large argument expansion and an extra copy.

The FIFO grammar now has eleven axes, including ordinary sparse predecessors,
multiple partial keys and a new transaction appended while a baseline read is
held. SQLite returns one stored row for a one-key baseline and two for a two-key
baseline across 0–32 unrelated rows. The appended transaction needs two reads
and two rows. These are row-materialization measurements, not latency or query
planner guarantees.

Owners: `persisted-source-fifo-oracle.ts`, its browser-safe driver,
`sqlite-resume-snapshot-oracle.test.ts` and the shared
`resume-row-projection-oracle.ts` judgment. The projection check also observes
actual SQL result cardinality before decoding. A SELECT-all-then-filter mutant
keeps correct values but fails that check.

### Convex successors use accepted predecessors before publication

`acceptedSyncedEntries()` includes accepted but unapplied source transactions.
Persistence hands the source transaction to core before fulfilling its durable
acceptance. Therefore removing an accepted proposal does not open the alleged
baseline gap.

The existing deferred oracle released every proposal together. It now also
hands one proposal to core, lets the acceptance-removal callback run, and emits
its successor while a real optimistic transaction still holds publication.
Installed-SDK Node SQLite and worker/OPFS receivers compare accepted rows,
actual durable rows and the unchanged public snapshot at every revision.
Inserted-predecessor omission and deleted-predecessor resurrection controls fail
the same independent six-revision judgment.

The cost finding was accurate but conflated two operations. The full accepted-row
Map copy is redundant. The scan remains necessary to remove newly authoritative
omissions, including later hydration seeds, while preserving rows outside the
source's scope. The repair keeps only deferred effects in a sparse overlay.
Tombstones override core lookup and survive through write classification.

For a two-row answer and unrelated suffix sizes 0, 4, 32 and 256, both versions
visit 2, 6, 34 and 258 accepted rows. Full accepted-row Map copies fall from one
to zero. Existing work oracles counted provider acquisitions, not CPU allocation.
No new O(answer-size) work promise is claimed.

Owners: the lazy paging baseline/deferred owner and its new actual persisted
acceptance receivers. The source-row and publication model remains independent
of the sparse-overlay implementation.

### A fatal native decoder refusal does not commit its staged page

Native PowerSync does begin a transaction before deserializing its rows. Refusal
leaves it open. Core permits open sync transactions until retirement. The native
adapter stops that run, releases tracking, and rejects later demands.

The existing oracle already checked initial/live refusal, accepted earlier pages,
exact error, tracking release and cleanup/restart. The new late-hydration crossing
tests whether uncommitted staging incorrectly gains authority over hydration
seeds. Twelve same-path probes confirm one open transaction and zero commits,
but no public corruption or blocked restart. The generated model passes on real
Node and browser SQLite.

The comment now states the narrower true fact: a failed SQLite read opens no
transaction. No balanced-begin policy or decode-preflight mechanism was added.
The oracle also gained all-builder missing-state controls and a nonempty
publication check for its guaranteed-fresh hydration key.

## Lossless finding dispositions

Every original item keeps its source-order ID. No proposed fixes were supplied
in the original review.

| ID | Original concern | Technical verdict and action | Why the prior oracle did not report it |
| --- | --- | --- | --- |
| R01 | Diverted abort silently succeeds after the resume read. | Refuted at the exact cut on all three hosts. Keep generated cancellation and next-use coverage. | The exact await cut was missing, but production already rejected correctly. |
| R02 | Every qualifying partial update loads the entire persisted collection. | Confirmed cost. Replace full materialization with bounded complete key projections. | No row-read cardinality observation. The rejected presence shortcut exposed a further missing ordinary-partial prelude. |
| R03 | Synchronous `acquireStreams` error callback hits the TDZ. | Refuted for installed SDK 0.1.1. Fresh and cached-error callbacks follow acquisition return. | The review assumed a collaborator timing that this SDK does not provide. Actual timing now has a witness. |
| R04 | A shared rejected receipt replaces the request's error. | Confirmed public failure and repaired. Preserve accepted-row obligations across full and priority checkpoints. | Request failure, unrelated durable rejection and cancellation timing were separate histories. |
| R05 | Native refusal leaves a sync transaction open. | Internal observation confirmed. Public consequence unsupported. Clarify the read-failure comment. | No balanced-begin law existed. Public late hydration was the useful missing crossing. |
| R06 | Convex loses accepted but unapplied proposal rows. | Refuted on the exact accepted-removal cut through real persistence. | Existing projection was correct. Successor delivery after one acceptance callback was missing. |
| R07 | Convex copies and scans the complete accepted Collection. | Confirmed cost. Remove the copy and preserve the necessary authority scan. | Row tests and provider-request work tests do not measure transient Map allocation. |
| R08 | Health waits survive cleanup without cancellation. | Confirmed on actual SDK cleanup and acquisition-release paths. Reuse existing owning signals. | Ledgers omitted wait continuations or ignored them after release. |
| R09 | The no-stream comment misstates eager readiness. | Clarify the comment. Empty eager leases settle without remote input, through the lease promise. | Passive cached readiness was already covered. This was prose ambiguity. |
| R10 | `.nvmrc` changes Node 24.8.0 to 22.23.5. | Accepted design. Retain the user's explicit Node 22 instruction. | This is configuration intent. Main CI reads `.nvmrc`; it is not an oracle failure. |

Totals: six `fixed-now`, three `refuted`, one `accepted-design`. No finding was
dropped, merged away or deferred. These totals describe this review's items,
not every pre-existing release or CI dependency of the PR.

The context items also survive the audit. C01 correctly called all ten items
unverified hypotheses. C02's medium-effort setting does not supply evidence.
C03 names the covered source packages but establishes no TrailBase finding.
C04's test/CI skim explains the missing oracle analysis. C05 correctly disclosed
the unsupported synchronous-callback premise. C06 is not an independent AGENTS
compliance review. C07's three suggested priorities did not reproduce a public
correctness defect. C08 is answered for every row above.

## Verification and independent challenge

- Before production edits, all behavioral items had a bound whole-review plan.
  Actual required receiving paths supplied RED or same-path disproof.
- The final FIFO campaign passes 454 checks on recording and Node SQLite paths.
  Each of eleven states reaches 279 histories per host and campaign.
- The concrete snapshot campaign passes 273 checks. Each projection state
  reaches at least 25 histories per fixed/random campaign.
- The combined worker/OPFS FIFO and projection campaigns pass 155 checks.
  The final SQL-work projection selection passes 78 checks. Each of their
  declared states reaches 29 histories per campaign.
- Native decoding passes 547 checks per host. Final stricter hydration and
  all-builder controls pass 347 checks per host. New hydration states reach
  25 histories per campaign on each host.
- Convex passes 1,872 checks across 24 Node files. Actual persisted browser
  acceptance and neighbors pass 52 checks; Node persisted neighbors pass 42.
- Direct's final boundary family passes 71 checks per host. Its new/shared
  earlier phase passes 329 per host, with further five-path receiving checks
  after the cancellation refinements. Phase-qualified counts are not summed.
  The original cancellation-only implementation may emit a different
  `AbortError` instance. That is permitted and is not a mutant kill. The
  original provider-error substitution remains rejected on both hosts.
- Fixed/random campaigns, original replay coordinates and corrupted-observation
  controls use the same production drivers and comparisons. Original defects,
  the presence shortcut, premature cancellation and SELECT-all/filter designs
  are rejected at their intended comparisons.

Two independent reviewers challenged the diff. They found and helped repair
missing per-builder/per-state controls, vacuous notification checks, a missing
durable receiving premise, raw-result loss during later execution/cleanup
failure, incomplete accepted baselines, and cancellation before full delivery.
They also prevented production ordering from being added to satisfy incidental
test-array order.

One historical browser run had two mapper-admission premise timeouts. Later
full and exact runs passed. The exact historical cause remains unproven. A
controlled 2,200 ms valid persistence delay reproduced the weak setup bound.
The fixture now drains actual pending storage work before timing mapper
admission. It preserves the provider-wait and product comparisons.

All numbered oracle obligations apply as follows: ORC-001–007 have contract,
independent judgment, literate layers, bounded histories, actual receiving cuts,
calibration and fixed/random replay evidence. ORC-008–009 preserve minimal
domain state and glossary mappings. ORC-010 now preserves completed results
before later execution or cleanup failures. No shared semantic-fault hypothesis
requires a second formulation under ORC-011. This record supplies ORC-012.
Neighboring cuts and host witnesses supply ORC-013–014. Constructed histories
and individually omitted states supply ORC-015. Ordinary fixture unit tests
remain outside oracle definitions under ORC-016.

## Cost, limits and reviewer assessment

Compared with the reviewed head, the three changed runtime bundles add 217 gzip
bytes: Convex 54, Direct 58 and SQLite persistence 105. The typical app and every
measured app scenario remain unchanged. The sparse overlay removes an O(N)
transient copy. Bounded storage projections avoid full-row materialization.
Existing signals and transaction-local state replace proposed new lifecycle
machinery. The small byte increase buys these behaviors; no new retry queue,
baseline-completeness cache or controller lifecycle remains.

These finite campaigns do not prove arbitrary remote schedules, multi-tab
writers, all value domains or every host. Storage materialization counts are not
wall-clock or physical query-plan guarantees. Generic persistence adapters can
ignore the optional hint. Known SDK/runtime release requirements and whole-PR
CI readiness remain separate from this ten-item evaluation.

The reviewer supplied useful candidate bugs, especially R04 and R08, and
accurate cost observations. It was candid that no finding was confirmed.
Its priorities rested on incorrect or unsupported premises, and it did not
trace the oracle chain. No proposed fixes were supplied to assess. The hiring
recommendation is **no hire for an autonomous final-review role on this
evidence**, with useful value as a hypothesis generator followed by executable
verification.

Final source hashes and check receipts follow the reproduction commands.

## Reproduction commands

Use the repository's Node 22.23.5 target. Commands run from the repository root.
The original RED commands ran with the extended oracles and unchanged reviewed
production. Running them on this repair checks GREEN instead.

```sh
pnpm --filter @tanstack/powersync-direct-collection exec vitest run \
  tests/request-boundary-conformance-oracle.property.test.ts \
  tests/shared-client-conformance-oracle.property.test.ts \
  --coverage.enabled=false --maxWorkers=1

pnpm --filter @tanstack/db-sqlite-persistence-core exec vitest run \
  tests/persisted-oracle.test.ts \
  tests/persisted-source-fifo-sqlite-oracle.test.ts \
  -t 'sqlite-persistence.source-fifo-order' \
  --coverage.enabled=false --maxWorkers=1

pnpm --filter @tanstack/db-sqlite-persistence-core exec vitest run \
  tests/sqlite-resume-snapshot-oracle.test.ts \
  --coverage.enabled=false --maxWorkers=1

pnpm --filter @tanstack/browser-db-sqlite-persistence exec vitest run \
  --config vitest.adapter-oracles.config.ts \
  e2e/persisted-source-fifo-oracle.browser.test.ts \
  e2e/resume-row-projection-oracle.browser.test.ts --maxWorkers=1

pnpm --filter @tanstack/browser-db-sqlite-persistence exec vitest run \
  --config vitest.adapter-oracles.config.ts \
  e2e/powersync-direct-request-boundary-oracle.browser.test.ts \
  e2e/powersync-direct-shared-client-oracle.browser.test.ts --maxWorkers=1

pnpm --filter @tanstack/convex-db-collection test:oracles
pnpm --filter @tanstack/powersync-db-collection exec vitest run \
  tests/batch-decode-conformance-oracle.property.test.ts \
  --coverage.enabled=false --maxWorkers=1
```

The original R04 failure has history `coordinate=0, rowCount=1,
schedule=receipt-durable-failure, statusChanges=1`, seed `2446`, path
`0:0:0:1`, unit `random seed: generated receipt-durable-failure`.
The original R08 eager history is `join=active, first=1, second=1, next=0,
retire=0, waitReentry=before-cleanup`, seed `2377`, path `0:0:0:0:0`.
Later grammar extensions retain these histories. Historical shrink coordinates
describe the recorded grammar, not network replay.

Setup errors, already-failing calibration baselines, timed-out admission
premises and deliberately permitted abort-instance mutations are not counted
as kills or product RED. The same comparisons reject the actual cause,
settlement, resource and row-materialization defects.

## Final production source and checks

| Source | SHA-256 |
| --- | --- |
| `packages/convex-db-collection/src/options.ts` | `94f33225cf719c39fc1f300795bd1d77cbeeb55dc572951551b8a5f41438c4fd` |
| `packages/db-sqlite-persistence-core/src/persisted.ts` | `97918cc8e5def67dfab6b2b2ed7ce41f5361dc55e3e4851ebb0471cf05ba5ed7` |
| `packages/db-sqlite-persistence-core/src/sqlite-core-adapter.ts` | `d41b47a41245c27c24cceff0ccb2318acfa4a6b28d2b673b4e3185fe62d303f5` |
| `packages/electron-db-sqlite-persistence/src/protocol.ts` | `faf77d7f12a99ec87c357a3173f05ccc453c472a5894c662a521bcf953da1a17` |
| `packages/electron-db-sqlite-persistence/src/renderer.ts` | `67eb4824fdc0a24d804b31be77327ae97cd0fa947df6e97f7403189b7fd26cfb` |
| `packages/powersync-db-collection/src/powersync.ts` | `ab4d693844873a04dabe6e3279a8221026ff249826ca48bbf9483dce2fcef95f` |
| `packages/powersync-direct-collection/src/index.ts` | `ac87297f28223ef3d77d6a4418485297d388ac3b623790c17e79e9dfa27c5c76` |
| `packages/powersync-direct-collection/src/subsets.ts` | `42b78f404f569854b15c6b4962e72ad0309c4c02dc2188c0d2756fca5ece24f9` |

Core, Convex, Direct, Electron and browser package TypeScript checks pass.
Scoped ESLint, `pnpm lint:changed`, the replay registry's 124 checks and
`git diff --check` pass. The final browser projection work/failure controls
pass 78 checks. Both independent reviewers report no remaining actionable
finding in their reviewed scopes. Exact SDK abort-instance equality was
removed as an unsupported expectation; a distinct real cleanup `AbortError`
passes the same comparison on both hosts.

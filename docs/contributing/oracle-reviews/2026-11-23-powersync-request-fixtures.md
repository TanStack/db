# PowerSync request-fixture correction: 2026-11-23

This change corrects the service premise used by the Direct health receivers.
Its production parent is `45f6db78dd9ee2b9b9b71509c5ef012c284bcdbc`.
The lawful receiving histories then exposed a separate persistence FIFO defect.
That defect is reproduced in the primary owner before its production repair.

## Why the earlier RED did not establish the SDK defect

The [upstream review](https://github.com/powersync-ja/powersync-js/pull/1221#pullrequestreview-5971808899)
correctly identified an impossible service history. Subscription errors describe
argument resolution. The service constructs that resolution once per HTTP
request and supplies it in the first checkpoint. Transient delivery failures
instead interrupt transport. The earlier eager fixture changed a subscription
from healthy to rejected and healthy again inside one response.

Authority: [BucketParameterState at the reviewed service revision](https://github.com/powersync-ja/powersync-service/blob/b12e7776fd842c58cc774f3af97eb05ffbdb47c5/packages/service-core/src/sync/BucketChecksumState.ts#L550-L556).
The [verification comment](https://github.com/powersync-ja/powersync-js/pull/1221#issuecomment-7115651374)
reports that SDK 0.1.1 already exposes recovery after transport interruption and
an unchanged empty successor checkpoint. Those observations establish no
checkpoint-event release dependency. The prior evidence records retain their
original commands and receive dated corrections.

## Separate judgments

The reference and Convex receivers retain the generic result-error law. Direct
uses its existing retry-policy capability for transient response-body errors.
The eager owner preserves changed and unchanged recovery, all value domains,
publications, restart and resource checks. The same registration now receives
actual Chromium observations as well as Node observations.

A new request-resolution guard rejects changing subscription outcomes/messages
inside one response. It also rejects a bucket when every requested/default
subscription is rejected. It groups parameterized subscriptions by stream name
and retains their actual request indices. Identical repeated descriptions remain
permitted for fixture idempotence stress. This narrow guard is not a full wire
validator: data outside the latest checkpoint can be legal.

On-demand rejection, changed rejection and recovery now cause actual successor
requests. Health uses an independent stream-incidence judgment plus a separate
connection outage. Query rejection may own the stream error, but cannot excuse
an unknown source cause or a missing connection outage. Demand retirement cannot
heal that outage. The independent connection judgment folds authored request
subscriptions/resolutions and completed, non-superseded HTTP inputs, alongside
actual delivered transport interruption. It does not use SDK ready status,
product lease state or reportHealthy to author expected recovery. A cold
acquisition may retire during replay and still reject its query. A later
successful no-scope checkpoint can then heal its connection. A confirmed-empty
donor keeps a live failed scope and cannot use that permission. The existing applied-settlement model and its held-receipt
receiving cuts remain distinct from health.

Table rows follow authored successful bucket support. In the on-demand fixture,
each successful stream supports the authored rows. All subscriptions rejected
means no supported bucket. The shared-client family instead authors separate
alpha/beta masks, including equal, partial and disjoint support. It observes both
Collections after rejection, changed rejection, healthy-peer updates/deletions,
request-open recovery, applied recovery, either retirement, and later delivery.
It checks terminal errors, scoped failures, distinct rejection messages in
oldest-first order across connection and stream categories, the newest public
cause, and resource release separately. Later retry reports remain optional
under RETRY-1. If reported, they occupy their authored chronological position
and remain in the open frame until recovery or release. Actual SDK Error
identities supply the recorded attempt ordinals.

The design experiment found 41 identical public SDK observations for two source
histories: loss of rejected alpha bucket support, and loss of that support plus
a healthy beta deletion of the same row. The adapter cannot distinguish those
removal causes at its public SDK boundary. The existing all-synced-table contract
permits the table removal in both. Ignoring removals during failure would hide a
healthy peer's deletion. A stronger selective-retention promise needs a separate
contract decision and sufficient provider information. This change makes no
claim that such a stronger policy is implemented.

## Grammar and sensitivity

Direct eager retains 400 histories in both fixed/fresh campaigns, seed 2118,
and five constructions per required state. On-demand retains 60 per campaign,
seed 2377, five constructions per state and all five receiving hosts. Shared
client retains 40 per campaign, seed 2377 and all nine original states. It adds
nine states with five fresh constructions each. Every construction has a bound
missing-state control, including generated outputs.

The failure branch exists only for two active stream owners. It varies rejected
owner, changed error, healthy-peer update/deletion, no/changed/unchanged recovery,
row support and retirement. Passive joins still require an active donor and
retire only the passive Collection. Removing the support relation loses shared
row causes. Removing the error axis loses fixed-lease health. Removing the
request-open cut accepts premature healing. Zero through three later rows,
one through three initial rows, singleton deletion and empty recovery provide
the bounded margins. No subscription outcome change occurs in one response.
The connection input projection records only whether an actual request retained
a failed requirement. Healthy subset identity and duplicate adjacent identical
inputs cannot change this judgment. Their ordering relative to interruption
remains, and identities still have separate ownership checks. This projection
removes legal replay schedule noise without ignoring a health observation.
The wire matrix also requires matching checkpoint/completion IDs. That control
was RED twice when unsupported rows still inflated only the declared target.

Bound calibrations reject false clearing of scoped errors, a terminal peer,
frozen healthy-peer rows, lost or reordered rejection messages, an incorrect
newest cause, premature healing, stale unchanged recovery and missing reach.
On-demand additionally rejects unknown/missing connection health even when a
query rejects. The fixture guard itself had four failing parent tests before
its repair and all six passing afterward. Broader runs then exposed unsupported
row data on a no-scope successor and a missing default-stream descriptor. The
wire matrix now checks empty scopes, all rejected scopes and mixed successful
support, and the default-only Collection retains its actual SDK receiving test.
A no-scope or all-rejected checkpoint emits no row-data messages.

The saved-demand receiver now distinguishes all-rejected bucket withdrawal from
exact-only rejection beside a healthy id donor. Withdrawal records an authored
primary-model source deletion, not an adapter truncate or backend deletion.
Exact-only rejection keeps nonempty overlapping durable rows but cannot certify
the failed demand. Three reopen schedules and a bound false-readiness mutant
exercise that additional receiving cell. A RED setup failure is not counted
as a semantic mutant kill.

## Persistence ordering found by the lawful receiver

The original Chromium/worker/OPFS loaded cut sometimes returned no public rows
although the SDK held a row and all source receipts had fulfilled. The source
had committed a delete, then an update restoring the same baseline value.
An earlier subset read was waiting ahead of the delete in the apply mutex.
When that read started, the newer update joined its hydration replay queue.
The read replayed the update before the older delete's ordinary mutex turn.
Both writes were external source transactions. Core applied the order it received.

README **Source replay ordering**, the glossary's accepted/deferred sync
transaction definitions, and the **Sync metadata session** maintainer decisions
of 2026-10-22 and 2026-10-23 require global source commit order. A storage read
may delay a source write but cannot reorder it. The same log fold predicts the
result independently of the persistence queues.

The primary FIFO driver and registration now live in
`packages/db-sqlite-persistence-core/tests/persisted-source-fifo-oracle.ts`.
The existing `persisted-oracle.test.ts` registration and the new
`persisted-source-fifo-sqlite-oracle.test.ts` receiver share that driver, grammar,
model, and comparison. The native receiver reads final rows and metadata from
real Node SQLite. Its read/write gates decorate SQLite's actual scoped loans,
including ordinary-work scheduling and `afterQueuedWork`.

Six grammar axes retain same-key and disjoint commits, then add equal-value
restoration, restoration across a queued hydration, a failed read beside an
older disjoint commit, and an independent aborted successor. Each generated
history shuffles all axes and varies both bounded titles. The failed-read
patch always changes its title, so its durable-order check cannot mistake a
permitted no-op elimination for reordering. Same-key comparisons permit that
elimination. Five fresh builders per axis put their required axis first.
Their omission controls and generated-output checks use measured read admission.

The held-read premise checks that the older receipt is pending and its durable
write has not started. Reach records the newer commit while that real read
remains open. The original held-publication comparison remains. Final cuts
check receipts, public and durable rows, pending markers, Collection status,
changing disjoint-write order, and the failed-read partial update's metadata.

Before production edits, both the controlled primary and real SQLite receiver
failed at their own semantic checkpoints: restoration lost the row, and the
failed-read history reversed durable order. Separately, the pre-edit Direct
Node receivers passed 1,194 checks. The real Chromium trace recorded the queue
inversion and a loaded-row comparison failure. These are separate verdicts.
A saved-window durability failure was also recorded and remained unclassified
at the start of the repair.

The repair keeps a commit that overlaps hydration behind an earlier ordinary
source commit. Its existing read binding remains available. At its actual FIFO
turn, the existing baseline/replay helper reconstructs fields a failed read
could not install. The helper now accepts an explicit transaction list as well
as the existing hydration queue. It checks terminal state before reading and
uses the existing failure classifier for ordinary replay. No second queue,
retry generation, or recovery state machine is introduced.

The simple ordering barrier was rejected: it fixed restoration but lost hidden
public fields and metadata after a failed read. Unconditional fail-stop in the
new path was also rejected: it crashed an independently aborted transaction.
The final native oracle rejects both designs, alongside the original defect.
After repair, both FIFO properties pass their fixed and random campaigns,
construction reach, per-builder omission controls, and determinism checks.
At the pre-integration framework revision, all six states reached 34
generated/constructed histories per host and campaign: 30 constructions and
four ordinary histories. Fixed regressions do
not supply those counts. The run budget remains four, seed 18,530,101.

Independent review of the exact production source and shared/native oracle
found no actionable defect. The reviewer ran 125 native checks, a recorded
seed/path/unit replay, 12 scope/failure/independent-abort cases, both crossings,
and five adjacent predecessors: disjoint, delete, partial update, truncate,
and snapshot. The latter checks complete rows and metadata and found no
baseline resurrection. Scope/terminal checks found no read after terminal
failure and no use of an expired scoped adapter.

## Validation

`pnpm size:compare --packages db-sqlite-persistence-core --files` compares
against merge-base `21c52a07e` on the fetched `origin/main`. The persistence
package grows from 49,123 to 49,182 gzip bytes: +59 gzip bytes and +68 brotli
bytes. Every app scenario remains unchanged. The isolated comparison with the
production parent `45f6db78d` gives the same +59 gzip and +68 brotli bytes.

The helper refactor reuses the existing partial-baseline algorithm instead of
adding another recovery path or state machine. The smaller barrier-only design
failed hidden-field and metadata comparisons. The extra admission branch and
baseline-at-turn call account for the remaining shipped growth. Tests and contract documentation have separate costs: test/support source
adds 2,208 lines and removes 494. Documentation adds 461 lines and removes 12.
The production diff adds 35 lines and removes nine.
The completed runs use Node 22.23.5. These results overlap and are not a sum:

| Run | Result |
| --- | --- |
| Primary FIFO, native SQLite receiver, and selected grammar/calibrations | 255 passed |
| Complete persistence-core package | 4,205 passed across 105 files, 49 existing expected failures, one skip, two todos, type checks passed |
| Complete Direct package | 3,021 passed across 21 files, type checks passed |
| Direct eager/shared-client/on-demand/saved-demand Chromium receivers | 1,368 passed across five files |
| Query, Electric, native PowerSync, TrailBase, Convex saved demand and Convex peer, Node SQLite | 162 passed |
| Convex saved-demand peer, Chromium/OPFS | 12 passed |
| Cross-adapter saved-demand Chromium/OPFS | 150 passed on complete retry |
| Scoped core and Direct TypeScript | Passed |
| Oracle lint and scoped ESLint | Passed, no lowered run budget |

An initial cross-adapter browser page did not initialize before its 30-second
startup limit. No history ran in that attempt. An isolated page/history check
then passed without source changes. The complete 150-test family then passed without source changes.
The timeout is setup evidence, not a semantic oracle verdict.
A focused rerun of prior CI failures then reproduced the RxDB baseline page
startup failure. Vite logged newly optimized RxDB/RxJS dependencies and a page
reload request. The host intentionally disables reloads to preserve an active
history. Reusing another entry's dependency cache let that discovery occur
only after navigation.

Each host now owns a fresh temporary Vite cache. Teardown closes the browser
and server before removing that cache, including failed startup. No timeout,
readiness predicate or product comparison changes. Both prior CI files pass
all 255 checks with cold isolated caches; the cache directories are removed.
Independent source review found no actionable resource or observation issue.
The final type-checked helper also passes all four cleanup calibrations and a
Direct persisted-ownership and Query saved-demand receiving histories with
fresh caches. Core, Direct,
and browser TypeScript and scoped ESLint pass.

The original implementation and both wrong repairs failed at the intended
native semantic comparisons, rather than setup, timeout, or missing reach.

## Review scope and limits

The first independent review found missing omission controls for builders 2–5,
unobserved terminal peer health, no pre-checkpoint recovery cut, an omitted new
connection outage for the previously healthy peer, and inflated retirement reach
after recovery. The implementation corrects each and keeps bound calibrations.
A second independent review checks the complete instrument before publication.

ORC-001–003: the guide's table-wide row contract, Errors contract, Collection
health contract and service request semantics supply separate authorities.
The independent models do not import SDK classifiers or state transitions.
Contract, model, grammar, driver and checker remain adjacent literate modules.
ORC-004–005: bounded grammar controls and actual SDK/host receivers are described
above. Provider receipt, application and public observations remain separate.
ORC-006–007: bound mutants and unchanged fixed/fresh budgets retain the shared
replay interface. ORC-008–009: scoped stream health, connection health and SDK
table membership are independent observations, not copies of provider state.
ORC-010: existing primary-failure and secondary-cleanup preservation remains.
ORC-011: the indistinguishable-removal experiment challenges the proposed
stronger retention law, rather than treating production agreement as authority.
ORC-012–015: this versioned record, exact snapshot, observed reach, adjacent
recovery/empty-data cuts and real Chromium/storage witnesses bound the result.
ORC-016: fixed regressions and calibrations reuse the primary driver/model/check.
Ordinary guard unit tests remain outside oracle files.

The scope is controlled service input over real SDK/Node/Chromium and selected
storage hosts. There is no deployed-service, arbitrary transport, schema,
arbitrary-concurrency, or complete-portfolio proof. Native Map compatibility and the
previous Neon and TrailBase SDK findings remain separate. The persistence repair reuses the existing baseline helper to limit shipped
code growth. Final compressed-byte measurements are recorded with validation.
Tests and documentation grow separately from shipped code.

The FIFO partial-update witness commits during its own subset restore. An
internal baseline repair for that transaction does not establish a restore
binding for an unrelated undemanded row. The sync-session owner's legal
histories exclude an ordinary update of an absent source row; its legal
commit-reordering exception writes that update's own fields. The additional
review therefore did not turn an unrelated absent-row update into a new
read-before-every-partial-upsert promise.

## Reproduction commands

Use Node 22.23.5. The ordinary commands run fixed and random campaigns and their
shared comparisons. The Direct package's test-only SDK Map shims remain in use.

```sh
pnpm --dir packages/db-sqlite-persistence-core exec vitest run \
  --coverage.enabled=false tests/persisted-oracle.test.ts \
  tests/persisted-source-fifo-sqlite-oracle.test.ts \
  -t sqlite-persistence.source-fifo-order --maxWorkers=1
pnpm --dir packages/powersync-direct-collection exec vitest run \
  --coverage.enabled=false --maxWorkers=2 --fileParallelism=false
CI=1 PLAYWRIGHT_CHANNEL=chrome \
  pnpm --dir packages/browser-db-sqlite-persistence exec vitest run \
  --config vitest.adapter-oracles.config.ts \
  e2e/powersync-direct-persisted-subsets-oracle.browser.test.ts \
  e2e/powersync-direct-persisted-demand-oracle.browser.test.ts --maxWorkers=1
```

A captured native RED replays directly through the repaired comparison with
these settings. It is GREEN on the repair.

```sh
TANSTACK_DB_ORACLE_SEED=18530101 \
TANSTACK_DB_ORACLE_PATH=0:0:0 \
TANSTACK_DB_ORACLE_PROPERTY=sqlite-persistence.source-fifo-order.node-sqlite \
TANSTACK_DB_ORACLE_UNIT='random seed: hydration-delete-reinsert construction 1' \
  pnpm --dir packages/db-sqlite-persistence-core exec vitest run \
  --coverage.enabled=false tests/persisted-source-fifo-sqlite-oracle.test.ts
```

## Reviewed source snapshot

The code parent is `45f6db78dd9ee2b9b9b71509c5ef012c284bcdbc`. These SHA-256
values identify the independently reviewed FIFO source snapshot:

| Source | SHA-256 |
| --- | --- |
| `packages/db-sqlite-persistence-core/src/persisted.ts` | `8c2b41152ca12a57f3667bddb14642e4ba0a00999d2dc0c49030fd48b05b72a5` |
| `packages/db-sqlite-persistence-core/tests/persisted-source-fifo-oracle.ts` | `3a23b83522e8abbe203541218b237970ff8a34877691a0b10ee9df099a780c20` |
| `packages/db-sqlite-persistence-core/tests/persisted-source-fifo-sqlite-oracle.test.ts` | `ae334d94c5d8e40b17429c7996e281fba1eae5b312f6de51c115c2eb4122d640` |
| `packages/db-sqlite-persistence-core/tests/persisted-durability-model-oracle.ts` | `48677c8ece81d11511a0c0256b979da9710140f88e6adccdf7115b26879c62a2` |

## Publication snapshot

The reviewed implementation is commit `06c990597dd15db04cff5b3392b316b72affe663`. Final formatting of three
oracle modules preserved their parsed emitted JavaScript syntax. The production,
shared FIFO owner, native receiver, and model hashes above are unchanged.
All final receiving and size jobs completed. Exact oracle-package archives
supplied the size baselines with unchanged versions and integrity.
No dependency-install workaround or private diagnostic artifact is published.

## Integration with current main

The follow-up merges `origin/main` at `371e40d48`. The persistence production
source remains identical to the reviewed repair. Main upgrades the oracle
framework to `6d05f05`, with five bases per construction and an ordinary
generated unit drawn only from the arbitrary. All existing run budgets and
seeds remain. No construction-base override is added for these new properties.
The primary and real SQLite FIFO properties pass 250 checks with the new
framework on Node 22. All six states are measured 154 times per host and
campaign: 30 builders on five bases, plus four ordinary generated histories.
The original implementation still fails the native restoration comparison.
The previous generated-unit seed/path coordinates remain historical evidence
for the earlier framework; the new arbitrary-only generated stream can shift
those coordinates. Explicit traces and the constructor-first RED remain.
The Direct CI job and real Chromium receivers are rerun with the new defaults.

The merge keeps main's split CI scheduling. Direct has `collections-5`, with
its eager fixed/random/other units and remaining files, in both PR and release
matrices. The assignment check covers all 28 package test scripts. Adapter
browser CI receives 120 minutes for the full portfolio with the retained five
construction bases; other browser and host job limits stay unchanged.

### Completed post-integration verification

The Node 22.23.5 reruns preserve the framework's five-base default, both
campaigns, and all run budgets. They finish with these results:

| Run | Result |
| --- | --- |
| Exact `node scripts/ci-tests.mjs test collections-5` command | 3,021 passed across the split eager campaigns and 20 remaining files, no type errors |
| Direct eager, shared-client, on-demand, persisted on-demand, and saved-demand Chromium receivers | 1,368 passed across five files |
| Named replay manifest | 70 passed |
| Guarded native SQLite FIFO replay | One requested history passed, seed 18,530,101, path `0`, unit `random seed: hydration-delete-reinsert construction 1` |
| Guarded Direct eager Chromium replay | One requested history passed, seed 2,118, path `0`, unit `random seed: generated` |

CI on `ac6b6653a` found two registration omissions and a type-import ordering
error. Commit `03b29859d42436cb79f4393070c0f31c7f5c4427` names the native FIFO
and Direct eager Chromium replay owners, supplies their exact random-campaign
selectors and the Chromium runner configuration, and fixes import ordering.
Both guarded replays record one execution with the requested property, seed,
and path. Independent review approves those routes. The 70 manifest checks,
`pnpm lint:changed`, and pre-commit ESLint pass. These changes do not alter
production, the oracle laws, generated histories, comparisons, or run budgets.

### Detached-error recorder imports

CI on `34fb2efe85da8d3f4727b64b0f32a116e77dda7b` exposed a missing
`describeOracleCleanupError` import in the RxDB receipt worker. Both existing
`mismatch-and-cleanup` calibrations entered its native rejection listener and
failed with `ReferenceError` before it could emit its observation. The browser
entry had the same missing import. Ordinary successful histories never call
that listener, which explains why those histories passed.

Both entries now import the existing formatter. All 26 files that reference it
were checked for the same omission. The unchanged receipt oracle passes all
60 checks across controlled and real Node SQLite hosts on Node 22.23.5. Its
Chromium worker/OPFS receiver passes all 28 checks. Independent review approves
the import repairs. No production behavior, expected observation, history
grammar, comparison, or run budget changes.

The same CI job separately reproduces the documented TrailBase SDK numeric
decoding defect. Seed 2,118 and path `24:6:6:6:6:4:4:4` reduce to a complete
snapshot containing `Number.MAX_VALUE`, followed by an empty snapshot. The SDK
fails before the first ready cut. Fresh seed 493,398,782 and path
`2:3:2:4:8:8:12` instead expose lost fields after a live SSE update with that
value. These are semantic failures at READY-3 and FID-1, respectively. They
remain visible with the complete numeric domain; the receiving tests are not
relaxed to make CI pass.

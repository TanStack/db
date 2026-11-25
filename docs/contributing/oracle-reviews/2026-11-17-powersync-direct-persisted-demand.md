# Direct receiving: saved demand and offline reopen

Current evidence is the v13 neutral receiving gate at the end of this record:
35 semantic failures on each original-source host, then GREEN on both repaired
hosts, with three hostile mutants rejected. The v3/v4 requirement to preserve
dormant A after successful B is superseded by the documented lawful cache policy.
Earlier snapshots and classifications remain historical, including five old-cut
OPFS failures whose individual causes remain unclassified.

This record adds the previously omitted persisted on-demand receiving boundary.
Its first gate uses the already reviewed Direct repair as unchanged production:
`index.ts` SHA256 `a30e71beb96fade6c5714a300ea76628386dd0b9b1ea04ad60ccf3ee9ae074fa`
and `subsets.ts` SHA256 `00fb4cb1976ec8b384d01e1fbb483768204bc40b69a3dcc19ed21b4356b3e380`.
The earlier 1,396-test browser result does not establish this new boundary.

## Law and receiving inventory

The authority is [On-demand Collections offline](../../guides/sqlite-persistence.md#on-demand-collections-offline),
the glossary's persisted demand coverage definition, and the primary owner
`packages/db-sqlite-persistence-core/tests/persisted-demand-coverage-oracle.test.ts`.
An exact load that reached applied settlement and saved its rows can settle
from those rows after reopen when its own wait passes or its upstream fails.
Overlapping rows, a pending or failed load, and a never-requested demand do not
certify completeness. A deleted row invalidates the recorded count; a replaced
limited-window row invalidates its recorded keys.

The receiving paths run public `powerSyncCollectionOptions` through public
`persistedCollectionOptions`, with the installed standalone SDK and controlled
PowerSync HTTP protocol. The Node path uses disk-backed `node:sqlite`, closing
and reopening the file. Chromium uses actual wa-sqlite worker/OPFS connections,
closing and reopening the same file. Every sync run constructs a fresh SDK,
Collection, and persistence adapter. No receiver installs coverage metadata.

Nine first-run histories are crossed with three second-run schedules:

- Completed exact demand; completed empty demand; no demand; completed donor
  demand whose rows overlap; donor followed by a pending exact demand; donor
  followed by a failed exact demand; completed demand followed by deletion;
  completed ordered window; completed window followed by a replacement below
  its retained boundary.
- A provider that remains pending with a zero wait; a provider pending across
  a 1,000 ms wait; an actual SDK stream rejection before a 60,000 ms wait.

The independent provider log records authored rows and deletions, plus actual
Direct load settlement. A fresh SDK's immediate empty in-memory listener is
not a provider reset: no remote reset or authoritative checkpoint supplied it.
Treating the adapter's own truncate as source authority would erase the law's
premise when the adapter incorrectly discards a saved cache.

The primary shared model and `coverageViolations` judge every public cut.
A small extraction in that same model exposes its row projection for durable
observations; both projections use the same source-row replay. It imports no
production persistence classifier. The receiving files define no second
completeness model or table of expected answers.

## Frozen test-only gates

The initial [eight-file snapshot](2026-11-17-powersync-direct-persisted-demand-test-snapshot.json)
is historical. Independent enforcement review found two instrument defects:
outer cleanup could replace a completed semantic result, and one first-run
checkpoint polled for expected deleted/replacement rows. Both were repaired
before any new-class production edit.

The [amended nine-file snapshot](2026-11-17-powersync-direct-persisted-demand-test-snapshot-v2.json)
has SHA256 `7a001ec8fd0676c84678ff677564b4f7f4e3fb103b30f768cfd2b7bf2d510634`.
All nine fingerprints were verified after its gate. Cleanup retains completed
records with separate diagnostics; two ordinary fault tests exercise that
helper. Source-change cuts now await provider consumption, four finite task
turns, and actually-issued applied receipts. They do not read expected rows to
decide when to compare. Five bound calibrations reject false readiness, false
preload settlement, invented durable rows, a cleanup-only failure, and a
product mismatch accompanied by a later cleanup failure.

Using Node v26.13.1, the exact Node gate from
`packages/powersync-direct-collection` is:

```sh
node ../../node_modules/vitest/vitest.mjs run \
  tests/persisted-demand-conformance-oracle.test.ts \
  tests/persisted-demand-cleanup.test.ts \
  --coverage.enabled=false --typecheck.enabled=false --maxWorkers=1
```

The exact real Chromium gate from `packages/browser-db-sqlite-persistence` is:

```sh
node ../../node_modules/vitest/vitest.mjs run \
  --config vitest.adapter-oracles.config.ts \
  e2e/powersync-direct-persisted-demand-oracle.browser.test.ts --maxWorkers=1
```

**Node: 24 semantic failures, 12 passed, 36 total, exit 1, 25.12 s.**
**Chromium/OPFS: 24 semantic failures, 10 passed, 34 total, exit 1, 41.14 s.**
Each host has six before-deadline coverage mismatches, one after-deadline
coverage mismatch, and seventeen before-deadline durability mismatches.
The three never-requested histories, reach, determinism, and all five
calibrations pass. Node additionally passes both cleanup fault tests. There
are no setup or missing-premise failures in these amended gates.

The [versioned original reach record](2026-11-17-powersync-direct-persisted-demand-original-reach.json)
preserves commands' result classifications, source/test fingerprints and
measured state counts. Its SHA256 is
`bc2c97b98604b9d41dc1f420062396fd2cb43148045e080a056cfcc0a89939d4`.
Local supporting logs are
`.review-2377/direct-demand-node-amended-original-gate.log` and
`.review-2377/direct-demand-browser-amended-original-gate.log`.
An individual finite-history replay appends `-t 'covered, held, wait 0$'`.

Both hosts measured the following per-history reach. Repeated cuts within one
history count once; calibration executions do not add independent histories.
The enumerated property's reach test requires every declared state.

| Declared state | Histories per host |
| --- | ---: |
| covered offline | 6 |
| uncovered offline | 18 |
| covered but short of rows | 3 |
| window covered offline | 6 |
| window holds other rows | 3 |
| tie-boundary load uncovered | 2 |
| covered load waits for the deadline | 4 |
| uncovered load fails with its upstream | 6 |
| completed exact first load | 12 |
| completed empty first load | 3 |
| pending exact first load | 3 |
| failed exact first load | 3 |
| overlapping first load | 9 |
| closed and reopened storage | 27 |

## Classification and remaining work

At the distinguishing cut, reopening SQLite before constructing Direct still
returns the saved row values. Constructing a fresh Direct adapter then erases
the rows and coverage before any provider answer. Covered nonempty, covered
empty, and covered-window demands consequently fail offline readiness.
Uncovered overlapping rows disappear as well. These are reachable failures
of the new receiving boundary, not evidence that the original cache failed to
commit or that the OPFS host failed to start.

The first repair candidate belongs in Direct's treatment of its uninitialized
SDK table snapshot. Independent reviewers must approve the frozen receiving
law and evidence before production changes. At this record's initial entry,
the new class remains RED; no GREEN or class-closure claim is made.

The model extraction's existing primary owner also ran successfully: 231 tests
passed in 39.20 s. A repeat against the final frozen value-projection export
passed all 231 tests again, exit 0, in 39.22 s
(`.review-2377/direct-demand-primary-final-model.log`). Scoped receiving lint
and Direct package TypeScript checking pass.

These witnesses establish connection close/reopen with fresh SDKs, not process
restart or browser navigation. They cover the default single-process
coordinator and controlled HTTP, not a deployed PowerSync service, multi-tab
coordination, cache-claim expiry, or SDK-native same-connection recovery.
Node 26's native iterator API permits this receiving experiment; it does not
establish compatibility with the package's supported older Node runtime.

## Oracle guide outcome

ORC-001–003: the public persistence law, shared independent model, and adjacent
driver prose identify authority, abstractions and limits. ORC-004: the finite
history product is explicit; each first-run premise has an ablation purpose,
and a checkpoint before HTTP acquisition is excluded. ORC-005: actual requests,
fresh SDKs, independent pre-startup durable reads, per-load waits, public query
status, preload settlement and full durable row values are recorded.
ORC-006: all five wrong-observation controls pass. ORC-007 does not apply to
bounded enumeration. ORC-008–009: no primary model state is added; the durable
projection reuses its source-row abstraction. ORC-010: helper fault tests and
dual-corruption calibration preserve product verdicts before cleanup evidence.
ORC-011 has no named unresolved shared semantic fault requiring another model.
ORC-012: this versioned record is tied to the manifest and reports RED and
unresolved repair. ORC-013: exact versus overlapping/pending/failed demands,
zero versus positive waits, empty completeness, lost counts and changed window
keys supply adjacent distinguishing witnesses. ORC-014: actual SQLite and
OPFS paths reuse the primary model/checker. ORC-015: all fourteen declared
states have measured and enforced enumerated reach. ORC-016: oracle files
register laws only; cleanup helper examples remain in an ordinary test file.

## Independent pre-edit enforcement approval

The independent enforcement reviewer approved snapshot-v2
`7a001ec8fd0676c84678ff677564b4f7f4e3fb103b30f768cfd2b7bf2d510634` after
verifying all nine file hashes and both unchanged production hashes. The
reviewer independently ran `covered, held, wait 0` on Node and actual Chromium
worker/OPFS. Each reached the intended before-deadline coverage mismatch:
saved `a1,a2` before adapter startup, then an empty durable snapshot and a
pending query. A sandboxed browser-listener `EPERM` attempt was classified as
setup failure and rerun successfully with local listener/Chromium access; it
does not supply RED evidence.

The reviewer independently passed all five bound calibrations and both helper
cleanup tests, checked the complete amended original logs and all fourteen
reach counts, and confirmed that both reported instrument defects were
repaired. This approval covers the instrument and pre-edit gate. It does not
claim production GREEN or broader portfolio closure. The separate adversarial
law review remains pending at this entry.

## Independent pre-edit law approval

The separate adversarial reviewer also approved the same snapshot-v2 for source
repair. The reviewer confirmed that provider-checkpoint facts are the suitable
independent authority: a fresh SDK's empty in-memory table has no remote
completeness evidence and cannot erase durable exact-demand obligations.
The primary model's "source log" means authoritative boundary facts. A
receiving driver can project those facts from provider checkpoints; an
adapter-produced reset does not establish its own authority. The reviewer
confirmed the declared abstraction, unchanged primary row-fold semantics,
actual OPFS path, cleanup controls, semantic RED classifications and reached
states under the bounded single-process scope.


## First remote checkpoint after reopen: pre-edit extension

Before changing production, the receiving grammar gained four histories. Each
completes exact demand A and closes SQLite. After reopening, two histories
refresh A with only `a2`, without a wire `REMOVE` for saved `a1`. Two load
disjoint demand B with `b1`. Each transition runs with waits of 0 and 1,000 ms.
The provider subscriptions carry distinct `group` and `id` parameters, so A
and B are distinguishable at the actual SDK boundary.

The primary model predicts final durable `[a2]` for the exact A refresh and
`[a1,a2,b1]` for B. Original production happens to produce `[a2]` for the A
refresh, but `[b1]` for B: its first transaction globally truncates the table.
The earlier offline mismatch is the registrar's first verdict. The production
record retains all three cuts, including `after first remote checkpoint`, so
the later omission and preservation obligations remain inspectable. The
independent enforcement reviewer reconstructed both final observations through
the actual disk-backed Node production driver with no cleanup errors.

The initial [snapshot-v3](2026-11-17-powersync-direct-persisted-demand-test-snapshot-v3.json)
gate exposed an instrument error: the two exact-A histories reached the primary
model's `coverage recorded twice` state without declaring it. Both hosts had
26 semantic mismatches and two reach-registration failures. Those two failures
were not semantic RED evidence. The amendment declares that existing model
state; it changes no source facts, comparison, expectation or production code.

The [snapshot-v4](2026-11-17-powersync-direct-persisted-demand-test-snapshot-v4.json)
SHA256 is `3a9f82aa91f12b25b219e1b0679711c4770112ba906f23592eee57ba1477100b`.
All nine test fingerprints and both unchanged production fingerprints were
verified after both gates. The commands remain the exact Node and Chromium
commands above, now running all 31 histories.

**Node: 28 semantic failures, 12 passed, 40 total, exit 1, 30.63 s.**
**Chromium/OPFS: 28 semantic failures, 10 passed, 38 total, exit 1, 47.66 s.**
Each host has seven before-deadline coverage mismatches, twenty before-deadline
durability mismatches, and one after-deadline coverage mismatch. There are no
setup, missing-premise or reach-registration failures in these completed gates.
An earlier sandboxed Chromium attempt failed to bind `127.0.0.1`; it supplies
no product evidence. The gate with localhost access completed on real Chromium.

The [versioned refresh reach record](2026-11-17-powersync-direct-persisted-demand-refresh-original-reach.json)
has SHA256 `85646993b1d4c120432a691a944cc38acfba9becb16c14222fe4fe5c01f3b74b`.
Supporting logs are `.review-2377/direct-demand-node-refresh-v4-original-gate.log`
and `.review-2377/direct-demand-browser-refresh-v4-original-gate-escalated.log`.
Both hosts measured and enforced all seventeen declared states:

| Declared state | Histories per host |
| --- | ---: |
| covered offline | 8 |
| uncovered offline | 20 |
| covered but short of rows | 3 |
| window covered offline | 6 |
| window holds other rows | 3 |
| tie-boundary load uncovered | 2 |
| covered load waits for the deadline | 5 |
| uncovered load fails with its upstream | 6 |
| completed exact first load | 16 |
| completed empty first load | 3 |
| pending exact first load | 3 |
| failed exact first load | 3 |
| overlapping first load | 9 |
| closed and reopened storage | 31 |
| exact remote refresh omits a saved row | 2 |
| other demand checkpoint after saved load | 2 |
| coverage recorded twice | 2 |

Both independent reviewers approved this amended gate after verifying every
test and source fingerprint. The enforcement reviewer independently reran exact
A and B registrar histories and reconstructed their final-cut primary-model
projections. The adversarial reviewer confirmed the scope law. Their approvals
permit a repair attempt; they do not establish repaired GREEN or class closure.

This extension distinguishes a scoped repair from two plausible wrong designs:
merging forever keeps omitted `a1`; global replacement on B erases saved A.
Ordered-window and cursor refresh after reopen remain an information-boundary
question: a limited response cannot establish omissions for the whole filter.
The existing offline ordered-window witnesses do not establish that later
refresh behavior. No production repair or new closure claim is made here.


## Cache policy correction before production edits

The v3/v4 extension overclaimed dormant-row retention after a successful
checkpoint. The independent law reviewer challenged that claim against the
SQLite guide. Its [on-demand coverage rules](../../guides/sqlite-persistence.md#on-demand-collections-offline)
permit source cache eviction and explicitly end every demand's coverage after
a truncate or snapshot transaction. A successful B load need not preserve A's
cache forever. This correction does not permit a fresh SDK's empty initial
listener to erase saved rows before any successful provider answer.

The proposed Direct policy now appears beside its public on-demand option:
merge cached SDK rows while waiting; after the first successful load with a
nonempty stream list, replace the cache with the SDK's current table once.
That reset can evict dormant rows and ends their coverage. Later checkpoints
apply ordinary changes. This avoids inventing stream-to-row provenance or a
second window evaluator in the adapter. The installed SDK resolves an empty
stream lease immediately, without a checkpoint, so an empty mapper cannot
supply reset authority.

The independent law reviewer approved that policy within the existing source
reset freedom. Its rival predictions are explicit: early reset loses valid
offline coverage; merge-only retains an omitted old row; an empty successful
lease cannot prove a remote snapshot; and coverage from a reset cache cannot
certify an evicted demand, even when another earlier demand overlapped it.

The revised finite grammar has 37 histories: the original 27, the four v4
first-checkpoint transitions, two ordered-window refreshes, two overlapping
saved-demand/B-eviction/third-run-failure histories, and two empty-mapper
reopens. The primary model itself is unchanged. At the authored successful
checkpoint it receives the proposed cache snapshot fact. It receives no
snapshot fact for initial SDK registration, failure, or an empty mapper.

A separate actual-reset ledger records source `truncate` and snapshot
transactions. The check rejects an unconfirmed reset of a saved cache before
using the actual reset clock to classify in-flight load currentness. Thus an
unauthorized reset cannot erase the promised obligation by making its own
loads obsolete. Bound calibration checks that independent reset judgment.
The production driver pumps the same authored rows into actual successor HTTP
requests when an allowed reset replays a demand; it waits on actual applied
receipts, never on expected query rows.

The [v5 snapshot](2026-11-17-powersync-direct-persisted-demand-test-snapshot-v5.json)
full gates had 34 semantic mismatches and one instrument failure per host.
Its invented-row calibration also activated the new reset checker and hit the
wrong intended difference. The amendment clears only that corrupted trace's
reset ledger, so the invented-row control again isolates the row projection.
No product comparison, history, model rule, or production source changed.

The [v6 snapshot](2026-11-17-powersync-direct-persisted-demand-test-snapshot-v6.json)
SHA256 is `2993e14e59a1b08f61e23a780e280a20dd71bee0b384ef311aae36e4e97cc1b2`.
It freezes nine instrument files, the public policy text, and both unchanged
production fingerprints. The original-source Node and actual OPFS gates are
running at this entry. Production remains unchanged; no GREEN or closure is
claimed. Actual cursor requests have a separate receiving driver under review;
an offset-only query does not establish that path.


## Completed v7 original-source gate

The lint-only amendment replaces the promise-callback completion boolean with
an explicitly mutable receipt object. The [v7 frozen snapshot](2026-11-17-powersync-direct-persisted-demand-test-snapshot-v7.json)
SHA256 is `28fa9818f83fcf96e3ba129beded03177b0647ce82e5d9cde4f085494d97e97e`.
Both completed host gates verify all ten test/document hashes and both original
production hashes afterward.

**Node: 34 semantic RED, 13 passed, 47 total, exit 1, 40.81 s.**
**Chromium/OPFS: 34 semantic RED, 11 passed, 45 total, exit 1, 60.21 s.**
Every failure reaches the independent check at `before successful provider
checkpoint`: saved-cache reset without a successful nonempty provider
checkpoint. There are no instrument, calibration, setup or reach failures.
The three never-requested histories, reach, determinism and all six bound
calibrations pass; Node additionally passes both cleanup controls.

The [versioned v7 reach record](2026-11-17-powersync-direct-persisted-demand-cache-policy-v7-original-reach.json)
SHA256 is `418a1fa21d32eca628ac84c579d798e296cf9637b1397ade8e67269767846bdd`.
It records all 21 declared state counts separately for each host. Reopen is
reached by 37 histories, exact omission and other-demand checkpoints by four
each, source snapshot ending coverage by eight, and each new overlap,
empty-mapper and post-eviction failure state by two. Every declared state has
nonzero enforced enumeration reach.

Logs are `.review-2377/direct-demand-v7-node-original-gate.log` and
`.review-2377/direct-demand-v7-browser-original-gate.log`; the commands are the
same exact Node/Chromium commands above. Scoped TypeScript checking passes;
the lint-only completion-holder edit also passes scoped ESLint.

The independent law reviewer approved this exact v7 gate after checking all
hashes and both host logs. The reviewer confirmed that permitted source cache
eviction and the empty-mapper exception follow the accepted contract, and that
the actual reset ledger cannot erase its own obligation through currentness.
This approval covers the main filter, ordered omission, overlap and eviction
receiving paths. Separate cursor receiving evidence and the independent
instrument review are still pending at this entry. No source change, repaired
GREEN, hostile-mutant rejection or class closure is claimed yet.

## Completed v8 original-source gate

The independent instrument reviewer required one coherent public observation
cut. The v8 amendment captures query rows and status, preload settlement,
elapsed load waits, source events and sent requests in the same task. Only
then does it await durable rows. The third-session cut follows the same rule.
This avoids mixing public facts from before a slow durable read with waits
and settlement recorded after it.

One additional covered-demand history delays that durable observation by
1,100 ms, across the 1,000 ms public wait deadline. It uses the same primary
model and comparison. The receiving grammar now enumerates 38 histories and
declares 22 states. The new measured state is `durable observation crossed the
public wait deadline`; each host reaches it once.

The [v8 frozen snapshot](2026-11-17-powersync-direct-persisted-demand-test-snapshot-v8.json)
SHA256 is `0a880e430b35e278bbd9194dcc4bb50f63e4e27c0909a24a0f949a712c0c92e3`.
It preserves the primary model, documented Direct cache policy and original
production source. Both completed host gates verify all ten instrument/document
hashes and both original production hashes afterward.

**Node: 35 semantic RED, 13 passed, 48 total, exit 1, 46.19 s.**
**Chromium/OPFS: 35 semantic RED, 11 passed, 46 total, exit 1, 67.63 s.**
Every failure reaches `before successful provider checkpoint` and reports the
same unauthorized saved-cache reset. All six bound calibrations pass. There
are no setup, calibration, reach or other instrument failures.

The [versioned v8 reach record](2026-11-17-powersync-direct-persisted-demand-cache-policy-v8-original-reach.json)
SHA256 is `96886e907356c01cd4fbe1785f8c7aa20f758b3214664c540cf03252e0592e61`.
It records each declared state's nonzero enumeration reach per host. Reopen
is reached by all 38 histories; the remaining counts retain the v7 witnesses,
with the added covered delayed-observation history.

Logs are `.review-2377/direct-demand-v8-node-original-gate.log` and
`.review-2377/direct-demand-v8-browser-original-gate.log`. The commands remain
the exact Node/Chromium commands above. Scoped ESLint and package TypeScript
checking pass; `pnpm lint:changed` also exits successfully.

The independent law reviewer approved this exact v8 snapshot and reach record.
The reviewer verified every frozen hash, both coherent public cuts and both
host logs. The v7 law/model/cache-policy approval carries forward. The independent
instrument reviewer also approved exact v8 after checking every frozen hash,
the coherent cuts and both logs. The reviewer independently ran the delayed
history on Node and actual Chromium; each reached the intended semantic RED.
The separate cursor receiver's final original-source gate remains pending at
this entry. Production is unchanged. Repaired GREEN, production mutant rejection
and bug-class closure remain subsequent gates. The instrument closeout also
requires a repaired delayed-read baseline and rejection of a mixed-cut mutant.

## First repair attempt and renewed instrument gate

After both main v8 and cursor v3 original-source gates were independently
approved, the first repair used one pending-replacement flag. The on-demand
initial listener merged SDK rows. Only the first active successful nonempty
stream lease replaced the table, consuming the flag before truncate reentry.
An abort fence preceded that callback. The source fingerprints were
`1ec1defd6f1584be75b647f243c820f31db0b1e03eaa7fabaf3185b27c4076c1`
and `b153929c2cd2bec9a3ca9645fd363b41bbf10a9acf357ce6b277b6bb0c591505`.

Those runs were **not GREEN**: Node had 9 failures and 39 passes; actual OPFS
had 4 failures and 42 passes. Logs are
`.review-2377/direct-demand-v8-node-green.log` and
`.review-2377/direct-demand-v8-browser-green.log`; their filenames name the
attempted gate, not its result. A permitted first replacement exposed three
recorder gaps that the earlier unauthorized reset had hidden:

- The driver recorded an aborted original acquisition's rejection as an active
  source failure and kept that acquisition among the query's owed loads.
  The glossary's abort law says its later outcome decides nothing.
- The first-save provider logged the same authored row fact again for each
  successor transport. That redundant event count also varied between runs.
- The receipt-only pump could stop before an actual successor SDK wait began.
  A later physical acquisition then lacked its intended provider input.

The correction changes the receiving instrument, not the primary coverage
model. Every physical attempt and its outcome remains diagnostic. Only actual
un-aborted acquisitions supply the current query's load obligations, including
simultaneous limited and tie-boundary work. An aborted rejection does not
supply an active `failed` source fact. Each logical provider row change is
authored once; transport reanswers deliver the same fact.

The provider barrier now observes the exact SDK wait promises production
starts, their abort/release, and actual issued applied receipts. It acquires no
extra lease and starts no extra wait. It returns the original SDK promises
without inserting another await boundary. It reanswers actual successor HTTP
requests and requires four native task boundaries with stable request/wait
revisions and no pending SDK input or receipt. Its premise does not depend on
expected rows, adapter success or query readiness. A checkpoint captures its
target stream and request counter before awaiting consumption.

The first-run successful and rejected input cuts now use that same neutral
barrier. Declared completed/failed reach comes from actual source outcomes;
the driver no longer waits for an expected query status to establish them.
Public observations and waits still use v8's coherent synchronous cut.

The [v9 snapshot](2026-11-17-powersync-direct-persisted-demand-test-snapshot-v9.json)
records the main amendment. Review then found one remaining expected-error
poll in the first rejected run. The [v10 snapshot](2026-11-17-powersync-direct-persisted-demand-test-snapshot-v10.json)
removes it and uses the neutral rejection barrier. Its SHA256 is
`59e85882728e136ee8a6573801b41e7a8c2f28d87aecaa17e40866370ccfe243`;
the shared driver is
`5a7c0b8dbcd0bbdd5cca12ec6b562d7d2499250c7aedf79fd27ca7ce1b60ca3b`.
The law, primary model, history grammar, comparison and run budgets are
unchanged. The original `a30e71…` / `00fb4c…` production source was restored
before the renewed gates. Both v10 original-source host runs are in progress
at this entry. The independent law reviewer approved the exact instrument
semantics, pending completed original evidence. No repaired GREEN or closure
is claimed.

### Completed v10 renewed original-source evidence

Both exact gates completed on restored `a30e71…` / `00fb4c…` production.
**Node: 35 semantic RED, 13 passed, 48 total, exit 1, 43.99 s.**
**Chromium/OPFS: 35 semantic RED, 11 passed, 46 total, exit 1, 59.77 s.**
Every mismatch is the unauthorized saved-cache reset before a successful
provider checkpoint. All six bound calibrations pass. There are no setup,
barrier, timeout, calibration, reach or other instrument failures.

All ten instrument/document hashes and both original production fingerprints
match the frozen v10 manifest after the runs. The
[v10 reach record](2026-11-17-powersync-direct-persisted-demand-cache-policy-v10-original-reach.json)
SHA256 is `52f26b4abfb777830fe3c3faa99d8fbca193f100d3e3c5b9229393df3cc3640e`.
All 22 declared states have measured nonzero enumeration reach. Every one of
the 38 histories reopened storage; the delayed durable cut crosses its
deadline once per host. The other counts retain the v8 witnesses.

Logs are `.review-2377/direct-demand-v10-node-original-gate.log` and
`.review-2377/direct-demand-v10-browser-original-gate.log`. Scoped ESLint
passes. Package TypeScript checking crossed another agent's in-progress
on-demand grammar extension, so that whole-package check remains pending;
the preceding driver-and-cleanup check had passed. `pnpm lint:changed` exits
successfully. The independent law reviewer reapproved the exact completed
gate after verifying all hashes and both host results. The independent
instrument review remains pending at this entry.

### Completed v11 final neutral-cut gate

The final cut amendment removes the empty-mapper branch's wait for load
settlement. It drains actual issued receipts and observes whether the actual
mapper returned no streams. It delivers no provider checkpoint. This measures
`empty mapper after saved load` without requiring the tested result first.
The primary model still judges public readiness and durable rows.

The [v11 manifest](2026-11-17-powersync-direct-persisted-demand-test-snapshot-v11.json)
SHA256 is `275b56b2c26c99d2419481b07fbda0fc80b3b31d317ab50f5b3b4f17c6b719ce`;
the driver is `8317dbeb0a4d3ee91a93b74ac4da629c7cc184fe49b4973bc983af7a0e4b10bc`.
Both independent reviewers verified the exact narrow diff from v10. The
cursor v4 original evidence carries under this explicit dependency amendment:
its path never executes the empty-mapper or main receiver branch. The
counter and accessor add no cursor scheduling or semantic change.

Both complete original-source gates ran again with all twelve frozen hashes
verified afterward. **Node: 35 semantic RED, 13 passed, 48 total, 43.74 s.**
**Chromium/OPFS: 35 semantic RED, 11 passed, 46 total, 60.28 s.**
Both exit 1. Every mismatch remains the unauthorized precheckpoint reset;
all six calibrations pass, with no setup, barrier, timeout or reach failure.
The [v11 reach record](2026-11-17-powersync-direct-persisted-demand-cache-policy-v11-original-reach.json)
SHA256 is `fb2c5cd25785dd4a707b2005deebaa531af6ad38d74985b5a1c2922e6716ca52`.
All 22 states have measured reach across 38 reopens, including the delayed
durable cut once per host. Logs are
`.review-2377/direct-demand-v11-node-original-gate.log` and
`.review-2377/direct-demand-v11-browser-original-gate.log`.

The independent law reviewer approved this exact completed gate after checking
every hash, both logs and the reach record. The independent enforcement
reviewer also approved the exact completed gate and cursor carry amendment.
That reviewer independently ran the empty-mapper zero-wait history on Node
and actual Chromium/OPFS: each reached the intended durability RED without an
outcome-dependent wait, with measured mapper reach.

An isolated Node Vite loader also ran the v10 instrument against the preserved
first repair: **48 tests passed, exit 0, 44.70 s**. Its log,
`.review-2377/direct-demand-v10-isolated-first-repair-node.log`, prints both
actual loaded production hashes (`1ec1def…` / `b153929…`). Canonical source
remained original for the renewed gates. This is provisional repaired evidence;
final source, exact v11 both-host GREEN, source mutants, the mixed-cut instrument
mutant and the adjacent mapper-abort receiving slice remain open.


## v13: neutral receiving input and final saved-demand evidence

The [v13 exact dependency snapshot](2026-11-17-powersync-direct-persisted-demand-test-snapshot-v13.json)
has SHA256 `29e9681a4959863e222e6dc482ccb4a82ef61c6cae20b647c741bd89b60ebf6c`.
The [versioned reach and result record](2026-11-17-powersync-direct-persisted-demand-neutral-reach-v13.json)
has SHA256 `5bb682f9310b68a566661bf3df6f1f6386b0296707d302f695e18a4f524adf27`.
The independent primary model, 38-history grammar and six comparisons/calibrations
are unchanged from the approved lawful cache-policy gate.

The old provider/receipt cut did not include actual persistence operations. A
controlled 50 ms delay in delivery of a real OPFS adapter result produced an
exact-refresh mismatch with `loadSubset` still pending at the public cut. This
establishes that the old cut can precede persisted replay work. It does not
retrospectively explain the five earlier OPFS failures, which remain individually
unclassified. The latency fault is absent from every normal v13 campaign.

The new neutral helper observes only actual SDK waits, source commit receipts and
persistence operations, recursively including adapters resolved by Collection or
mode. Default forwarding keeps original promises, arguments and receivers. The
checkpoint pump captures the revision of the request that actually consumed each
delivery and supplies the same authored input only to a genuinely different,
open successor. Four stable native task turns permit their finite continuations.
No expected rows, load outcome or readiness decides when to compare. Public
status, preload, physical loads and per-load waits remain captured synchronously
before the durable read. Seven ordinary controls tested the gate helper; an
eighth subsequently tested an additive continuation API for a different, held
application receiver.

Both final full gates executed helper `32c503f4` and main driver `bc39df92`.
Afterward helper `7c66fc31` added only the `continue` property, forwarding the
unchanged private drain with an already consumed request revision. Main and
cursor never call it. Independent review verified the exact additive diff and
all eight controls, and approved carrying their evidence through that unused API
addition. The exact gate helper is preserved as
`.review-2377/direct-input-receiving-v13.ts`.

The original source pair is `index.ts` `a30e71be` / `subsets.ts` `00fb4cb1`.
The repaired canonical pair is `index.ts` `1ec1defd` / `subsets.ts` `20f8ed31`;
their full fingerprints are in the snapshot. The candidate pair was fixed
before the final gates and verified unchanged after them. Isolated source-loader
logs positively identify both original files on Node and in the actual Chromium
inner Vite server. They do not modify canonical files. `fsModuleCache: false`
prevents transformed-source reuse across saved-source variants.

Using the Node 26 executable recorded earlier, candidate Node from
`packages/powersync-direct-collection`:

```sh
node ../../node_modules/vitest/vitest.mjs run \
  tests/persisted-demand-conformance-oracle.test.ts \
  tests/persisted-demand-cleanup.test.ts tests/direct-input-receiving.test.ts \
  --exclude '**/cursor-persisted-demand-cleanup.test.ts' \
  --coverage.enabled=false --typecheck.enabled=false --maxWorkers=1
```

Candidate actual Chromium/OPFS from `packages/browser-db-sqlite-persistence`:

```sh
node ../../node_modules/vitest/vitest.mjs run \
  --config vitest.adapter-oracles.config.ts \
  e2e/powersync-direct-persisted-demand-oracle.browser.test.ts \
  --fsModuleCache=false --maxWorkers=1
```

Original Node uses the same comparison and cleanup files with
`DIRECT_SOURCE_PREFIX=direct-demand-pre-repair`,
`--config ../../.review-2377/direct-saved-source.config.ts`, and the same coverage,
typecheck, cleanup exclusion and worker options. Original actual Chromium uses
that source prefix with
`--config ../../.review-2377/direct-mapper-browser-source.config.ts`, the same
browser file, `--fsModuleCache=false --maxWorkers=1`. Both loaders record each
served source SHA256 in the source-witness JSONL paths named by the reach record.

| Host | Original source | Repaired source |
| --- | --- | --- |
| Disk-backed Node SQLite | 35 semantic RED, 15 PASS, 50 total; 47.47 s | 57/57 GREEN; 48.39 s, including seven helper controls and four cleanup controls |
| Actual Chromium OPFS | 35 semantic RED, 11 PASS, 46 total; 79.40 s | 46/46 GREEN; 86.99 s |

Every host measured all 22 declared states. Each traversed 38 real storage
close/reopens, and the slow durable observation crossed its public wait deadline
once. All six calibrations passed. There were no missing-input, setup or timeout
failures in these renewed gates. The full reach counters are retained in the
versioned JSON rather than inferred from test counts.

Three renewed hostile mutants use the same comparison: never replacing the
saved cache gives one exact-refresh row mismatch; allowing an empty mapper to
authorize replacement gives two unauthorized-reset mismatches; moving preload
and wait capture past the delayed durable read gives one readiness mismatch.
The last mutant is generated from exact driver `bc39df92`, changing only those
two public-cut fields, and positively logs loaded driver SHA256 `4f8b685c`.
Seven selected histories pass with correct final production and the correct
observer. These are healthy baseline controls, not a fourth mutant.

**Law:** the SQLite offline exact-demand coverage law and documented Direct
cache policy stated above. **Reach:** 38 legal histories and all 22 measured
states on each host. **RED:** the renewed original pair gives 35 semantic
unauthorized-reset failures per host. **GREEN:** the repaired pair passes all
46 property/reach/calibration tests on both actual receiving hosts, plus Node
cleanup and helper controls. **Mutant:** all three variants fail at their
intended semantic cuts. **Limits:** this is bounded enumeration over controlled
HTTP with the installed SDK, fresh same-process connections and the default
single-process coordinator. It does not establish process restart, deployed
service behavior, cache-claim expiry, multiple tabs or universal history
coverage. Cursor, mapper-abort and decoder receiving evidence remain separate.

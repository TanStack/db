# PR 2258: second oracle review, decisions and enforcement

Evaluation baseline: `f1a39978e2822a96e5add42136a88674c7bc5d17`, 2026-10-26.
This record supplements the [initial review](pr-2258-gc-retention.md); it does
not rewrite that review's historical results. The appended round-2 entry in
[the fingerprint manifest](pr-2258-gc-retention.sources.json) binds the final
sources. The repair revision is the commit that first adds this record.

## Contract decisions and the three revisions

The maintainer made two explicit decisions in this chat after examining rival
laws and concrete histories. First-usable-idle retirement stays a fixture
scheduling assumption. Public retention deadlines remain strict, without a new
public first-callback liveness guarantee. Pending manual transactions do not
retain Collections: callers keep a subscription while they need draft
visibility. Restart after GC does not guarantee restoration of the prior draft
projection. The separate earlier decision still applies: rolling back a
transaction that never left `pending` preserves its existing GC deadline.

Here, main is `5649a07d468117891193c2e4cde9c7706308b1cd`, the submitted PR is
`f19f4908a3c0b8a91a696a2a77076e91230e4205`, and the evaluation baseline is
`f1a39978`. Historical source inspection is distinguished from executed evidence.

| Rule | Main / submitted PR / evaluation baseline | Authority and implication |
| --- | --- | --- |
| Persisting transactions retain every touched Collection | Main lacks the hold; submitted PR adds it; baseline implements it | New explicit policy in this PR, motivated by issue 2256. Main's GC can discard ongoing work. |
| Full fresh gcTime after the final persisting hold ends | Main has no transaction renewal; submitted PR adds it; baseline enforces it | Stronger than merely waiting for the handler. It is an intentional PR retention promise. |
| Obsolete idle work respects a renewed deadline | Submitted PR can retire at 121ms despite renewed eligibility at 221ms; baseline cancels obsolete work | Consequence of the new full-interval promise. Historical controlled/native RED and repair are in the initial record. |
| Fast settlement preserves residual startup grace | Main has a startup floor; submitted PR can overwrite it with gcTime 1; baseline preserves the absolute horizon | Existing 50ms startup promise composed with the new holder. It does not grant a fresh 50ms after every settlement. |
| A real last unsubscribe ends startup handoff grace | All three use gcTime after the last subscriber | Prior pooled-GC oracle prose independently states the handoff rule. Public wording is now clearer. |
| Pending rollback preserves its existing deadline | Main preserves; submitted PR refreshes; baseline preserves | Explicit earlier maintainer decision, rather than an unambiguous pre-PR prohibition. |
| Pending drafts do not retain; caller owns visibility | All three omit pending drafts from GC holds | Historical behavior alone was insufficient authority. The maintainer explicitly chose this policy in round 2. |
| First usable idle must immediately retire | All three schedulers do so in the synchronous fixture; the model selects that cut | Fixture expectation only. A safe scheduler that needs another turn does not thereby violate the public contract. |
| Cleanup stays empty when old transactions settle | Baseline resurrects a surviving sibling during or after cleanup; this repair suppresses that overlay | Existing cleanup/discard promise, not a new law. Confirmed with the expanded oracle before production edits. |

A diagnostic pending-draft history exposed two legal source forms. After GC,
readiness-only restart leaves the draft absent; an empty source commit rebuilds
it. Isolated main has the same immediate observations. This is not a PR
regression or a required restoration repair under the chosen lifetime policy.
The generated subscribed-draft lane instead enforces the supported workflow:
retain the row across the unheld deadline, unsubscribe, then observe normal GC.

## Laws, experiments and repairs

The review was considered as a whole before edits. The plan combined exact row
observations with warm/cold preload, sibling order and asynchronous cleanup
dimensions. Production remained unchanged until the expanded oracle and the
real-provider receiving path ran. This exposed a previously missed production
interaction, H03.

| Law / gap | Decisive experiment | Repair and inference |
| --- | --- | --- |
| E01: cleanup clears public rows | Three hostile observations agree on status/phases but retain key 1 after automatic or explicit cleanup. Old checker accepts all three: calibration RED 3 | Shared checker requires empty keys at cleanup start and after retirement. Same comparison runs in generated, native and provider drivers. |
| E03: settled optimistic rows drop without source support | Old nonretired checker accepts stale completed and failed rows: calibration RED 2 | Exact key membership equals independently supplied source keys plus active optimistic inserts. Missing, duplicate, extra and stale keys are rejected; independently known source rows remain valid. Original two-Collection comparison is also exact. |
| H02: interacting owners and release causes | Expanded grammar crosses repeated warm preload with queued idle/persisting work; failed cold preload with both sibling orders; cleanup with settlement | First complete campaigns reveal H03. Final campaigns reach all 25 states; the six raw preload/cleanup scopes remain accounted for below. |
| H03: cleanup must not republish a discarded projection | Two persisting inserts, held adapter cleanup, then one handler completes: sibling key 1 reappears. Cleanup fully settles before a handler completes with a pending sibling: key 2 reappears | Lifecycle query identifies cleanup through final retirement. Active overlay skips that discarded run while settled transaction pruning still runs. Both cuts are GREEN after repair. |
| R01 / original R09: real Electric confirmation survives the unheld GC deadline | Actual assigned PostgreSQL txid remains uncommitted across the deadline. Handler stays persisting, caller pending, optimistic row visible. COMMIT supplies genuine Electric confirmation | New registered provider driver shares the model/checker. Four histories pass before and after H03 repair. No-hold runtime mutant fails all four at the intended shared comparison. |

H03's first attempted refactor deleted settled entries while iterating SortedMap.
Existing sibling histories immediately rejected the resulting skipped overlay.
The repair keeps the existing deferred pruning pass. Clearing tracked
transactions wholesale would also lose unsettled ownership and affect later
restart, so it was not used. No new lifecycle state, queue or recovery machine
was added.

The remaining holds, last release and handoff horizon determine the independent
deadline. `cleaningUp` distinguishes synchronous row discard from asynchronous
adapter settlement; the public status retains its prior value during that
interval. A legal cleanup-settle action distinguishes these states. The driver
checks public rows synchronously at cleanup start, then rows, phases, exact
tracked transaction identities, preload outcomes/errors, cleanup promise and
public status at each relevant cut. It permits only old transaction settlement,
rollback, elapsed time and idle after retirement; new admission/restart remains
outside that lane.

## Reach, calibration and receiving paths

The final fixed seed is 20261026. Both fixed and random boundary campaigns run
250 histories using the same grammar/driver/checker. Declared minimum is one
history per state; removing a dimension cannot silently turn the test green.

New dimensions: gcTime 1/10/49/50/51/100ms, ages 0–80ms, release gaps 0–60ms,
preload count 1–3, independent sibling outcomes/order, failed preload as first
or last release, held versus settled adapter cleanup, pending/persisting
survivors, and subscribed pending drafts. Disabled values remain
0/-1/Infinity/-Infinity/NaN. Deadline-minus-one and deadline observations come
from the model. Concurrent cold calls share their public promise; exact source
error identity is observed. No expected deadline comes from production flags.

| Declared state | Fixed | Random |
| --- | ---: | ---: |
| queued-idle-renewal | 15 | 20 |
| startup-release-before-floor | 48 | 48 |
| last-unsubscribe-short | 9 | 17 |
| pending-rollback | 37 | 32 |
| pending-does-not-hold | 30 | 42 |
| sibling-persisting | 90 | 89 |
| preload-last-release | 21 | 14 |
| disabled-gc | 19 | 19 |
| delayed-commit | 14 | 19 |
| write-started-sync | 4 | 9 |
| late-release-short | 62 | 44 |
| warm-preload-persisting | 20 | 12 |
| warm-preload-queued-idle | 20 | 12 |
| warm-preload-repeated | 20 | 12 |
| preload-failure-held | 23 | 15 |
| preload-failure-last | 21 | 15 |
| sibling-oldest-first | 42 | 42 |
| sibling-newest-first | 48 | 47 |
| async-cleanup-settlement | 39 | 37 |
| async-cleanup-pending-idle | 39 | 37 |
| retired-settlement | 10 | 18 |
| retired-sibling-held | 10 | 18 |
| pending-subscription-held | 12 | 22 |
| pending-last-unsubscribe | 12 | 22 |
| concurrent-preload | 46 | 28 |

Reconstruction preserves the initial three reports, repeated warm overlap,
failed-final-preload, and both cleanup settlement timings. Ablation of each new
dimension loses the corresponding named reach/checkpoint. Single-transaction
cleanup remains a neighboring lane; sibling lanes construct two transactions
to retain meaningful reach. Settling an unstarted pending handler and
unsubscribing without an owner remain illegal. Restart after discarded pending
projection is outside the claimed row lifetime, by the maintainer's decision.

All five new source mutants fail by assertion at the intended checkpoint:

| Wrong design | Distinguishing rejection |
| --- | --- |
| Remove cleanup overlay guard | Generated and both reconstructed cleanup histories reject resurrected keys |
| Suppress overlay only while adapter cleanup is pending | Held-cleanup witness passes; post-cleanup witness rejects key 2 |
| Return early from transaction notification during cleanup | Rows stay empty, but exact tracked identities reject unpruned settled transactions |
| Omit warm-preload refresh | Repeated warm preload retires early at 144ms |
| Omit failed-preload hold release | Failed-final-preload misses retirement at 225ms in the controlled fixture |

The final frozen-grammar guard-removal replay is seed 20261026, path
`1:0:0:0:0:0:0:0:0:0`: exactly one selected history fails on the mutant, then
passes after byte-for-byte source restoration. Earlier shrink paths are bound
to their earlier grammar revisions and are not represented as final replays.
Wrong-result calibration is distinct from source mutants. Original unchanged
production RED, attempted-repair RED, mutant RED and repaired GREEN were retained
separately; no setup failure or timeout is counted as an assertion kill.

Electric receiving histories use gcTime 10/100ms × no subscriber/last unsubscribe.
Actual PostgreSQL 16 and Electric 1.8.1 supply the provider boundary, with the
installed SDK 1.5.15. A second SQL connection proves the uncommitted row is not
visible. Genuine `awaitTxId` acknowledges after COMMIT; caller settlement then
exposes the source fields, `$synced` and `$hasPendingWrites`. The driver supplies
expected source keys from its own SQL action history, never observed rows.
Idle delivery is controlled; elapsed timers and provider I/O are real. Node
environment avoids the existing jsdom/native-fetch AbortSignal mismatch. The
existing E2E glob registers the new file. DB was rebuilt from the worktree for
both the unchanged-production and repaired-provider runs.

The provider no-hold runtime fixture produces four intended retirement
comparison failures. Its temporary copy was removed without production edits.
Native Chromium separately passes the existing three histories with actual idle
provenance/budget and cancellation receipts. Startup's receiver observes safety
at 10ms and does not establish eventual cleanup. Native and provider premises
are each witnessed; their combined browser/provider execution is not claimed.

## Loss audit and reviewer assessment

The append-only task ledger retains the four raw reports, their original
claims, source locations, technical verdicts, actions and durable value. The
final audit returned to all four raw reports and found E03 had been omitted
from the first headline summary; it was added and repaired. H03 is a separately
recorded sibling discovered by the planned oracle extension.

| ID | Claim / disposition | Evidence or durable destination |
| --- | --- | --- |
| E01 | Retired-row comparison omission: fixed-now | Exact cleanup keys plus three RED/GREEN calibrations; original cleanup path also observes rows |
| E02 | Throwing settlement callback skips renewal: refuted for the reported path | Callback unsubscribes and throws exact error at 90ms; unsubscribe renews gcTime. No claim about every possible callback |
| E03 | Live checker accepts stale settled rows: fixed-now | Complete/fail calibration RED 2, exact membership GREEN; missing/extra/duplicate controls |
| A01 | First-idle law authority: accepted-design | Explicit maintainer choice, fixture-specific scheduling prose |
| A02 | Startup handoff wording ambiguity: fixed-now | Prior pooled contract authority; public gcTime wording clarified |
| A03 | Pending nonholding lacked separate authority: accepted-design | Explicit maintainer decision, public config/manual draft guide, subscribed-draft generator |
| A04 | Cleanup start differs from settled status: accepted-design | Public cleanup/glossary; held async adapter observations, without imposing synchronous final status |
| R01 | Duplicate of original R09 receiving gap: duplicate, canonical work fixed-now | Genuine-provider driver, baseline/final GREEN 4 and runtime-mutant RED 4 |
| H01 | Pending restart differs by source form: accepted-design | Both source forms remain legal; no restoration promise after discarded projection |
| H02 | Missing generated dimensions: fixed-now | All six raw scopes: queued warm/reuse; failed siblings both orders; cold-success boundary matrix; cold-failure boundary matrix; warm-persisting matrix; held cleanup/settlement |
| H03 | Cleanup resurrects unsettled sibling projection: fixed-now | Both original RED cuts, repaired GREEN and original/narrow/pruning mutants |

Round-2 accounting: 11 items = 5 fixed-now + 4 accepted-design + 1 refuted +
1 duplicate. The duplicate's canonical original R09 is now repaired; it does
not erase the obligation. No deferred or confirmed-open round-2 item remains
within the declared boundaries. The original 12-item review's R09 evidence gap
is superseded by the executed provider witness here, preserving its historical
open verdict in the initial record.

CodeRabbit's two reviews, 5656398687 at 425192752 and 5656525995 at f1a39978,
had 18 positive file notes and two successive wording suggestions. The first
wording was already fixed; the second is fixed here. The mutable summary's
docstring metric is not the repository's proportional literate-oracle policy;
relevant prose is present. All startGCTimer callers take no argument. Its
suspected leftover latestWindowRequest mapping corresponds to a real private
member and passes the generated cache check. Earlier fingerprint baseline is
intentional; this evaluation appends its own binding. The final PR description
must describe the actual oracle/native/provider scope. These seven distinct
summary/review items remain in the local ledger, including useful nonblocking
suggestions; no bot feedback is silently dropped.

Hire the enforcement reviewer for precise checker calibration and qualified
callback refutation. Hire the histories reviewer for distinguishing legal
source forms and testing main before claiming regression. Hire the receiving
reviewer for precise native/provider evidence; its original blanket approval of
all model policy was too broad and is superseded by the explicit decisions.
Hire the authority reviewer for separating prior promises, PR additions and
undecided laws. The independent final challenger found no additional supported
defect and ran 67 tests across five files with stable source hashes. CodeRabbit
provided useful wording feedback but missed the substantive checker/cleanup
gaps; this sample does not support a substantive hire recommendation for it.

## Validation and limits

Production changes
are confined to the cleanup query and overlay fence; tests/documentation grow
separately. The five source mutants and real-provider runtime mutant were
restored. No install override or lockfile workaround was needed.

The original rubric audit remains applicable, with these updates: ORC-001/009
now cite the explicit timing/draft decisions and cleanup split; ORC-002 keeps
source-key premises independent; ORC-003/004 expose the expanded grammar and
its ablation/exclusions; ORC-005 checks exact keys and intermediate cleanup
cuts; ORC-006 adds checker/source/provider calibrations; ORC-007 preserves
equal-budget campaigns and final direct replay; ORC-008 justifies cleaningUp
through a distinguishing cleanup-settle continuation; ORC-010 retains cleanup
failures separately; ORC-012 is this source-bound record; ORC-013 includes the
new deadline-adjacent preload cuts; ORC-014 now has the genuine-provider
receiver; ORC-015 enforces all 25 states. ORC-011 has no remaining named shared
semantic-fault hypothesis needing a second formulation: the authority issues
were explicitly decided, and the exact-row reference is independent.

Cleanup rejection, source recovery after preload failure, cleanup interrupting
a pending preload, paced/offline restoration, multiple provider transactions,
persistence-wrapper/provider combinations, and arbitrary legal permutations
are not established by these bounded campaigns. A proposed deferred-held-row
counterexample was checked against the real persisted wrapper: it clears its
deferred-publication list synchronously before cleanup awaits, while core clears
queued/held rows. Keeping that predicate true artificially would contradict the
current collaborator lifetime. No extra defensive machinery was added for it.
The existing cleanup-restart and optimistic ownership oracles retain those
neighboring contracts; passing these samples is not a universal proof.


Final local verification:

- Full DB run: 287 files and 13,808 tests passed; one guarded index-update replay
  child timed out under concurrent validation. No type errors. Its isolated
  rerun passed all 38 guarded replay tests with no type errors. The original
  timeout remains visible; the combined full run is not mislabeled GREEN.
- Independent final challenge: five files, 67 tests passed, including the two
  GC properties, checker calibration, cleanup-restart and transaction ownership.
- Native Chromium: all three histories passed on scratch port 42879. The
  configured port was occupied. Initial scratch import-path failure was setup,
  not product RED; the corrected config preserved the driver/model/checker.
- Actual Electric/Postgres: four histories passed before and after repair; all
  four no-hold runtime mutants failed the intended comparison.
- DB main/test TypeScript projects, Electric TypeScript, focused ESLint,
  changed-file oracle lint, mangle-cache check and whitespace check passed.
- `pnpm size:compare --packages db --files`: whole PR versus merge base
  427a7c31e, DB +85B gzip/+114B brotli; typical app +84B gzip/+60B brotli.
  The added cleanup fence pays for distinguishable discarded-projection
  ownership while preserving existing transaction pruning. The attempted
  deletion refactor failed SortedMap iteration and was rejected. Clearing
  unsettled tracking or returning before pruning would break neighboring laws.
  Existing shared-clock consolidation remains; no extra recovery state was added.

The final pushed head and its CI are tracked separately; this local record
claims bounded tested behavior, not that green local checks imply merge readiness.

Test source growth versus the evaluation baseline: 28,143 uncompressed bytes.
Documentation/changeset/manifest source growth: 25868 uncompressed bytes.

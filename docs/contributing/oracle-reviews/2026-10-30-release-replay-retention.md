# Release replay retention and generated final catch-up

The release workflow for `e75f8455a78bc33c43376288218e9912dc2a3f4c`
failed before publication. Its two failures have different causes.
The DB property exposed a production retention defect. The browser property
passed its behavior comparisons but missed a required state. Neither failure
establishes a regression in the callback-metadata size refactor: the DB
counterexample also fails on the exact release source.

## Law and the first divergent observation

Authority: live-query `ARCHITECTURE.md`, **Replay participants and failure**,
and normative law 9. A query's subscriptions to one source share publication.
Every acquisition started under that replay participates. A failed held demand
keeps the last complete result. Sibling success cannot decide its verdict.
Demand retirement or successful own replacement are the neighboring controls.

The original `replay.ordered-failed-replay` counterexample uses seed
`-533188721`, path `428:3:3:6`. Its commands hold loads, truncate markers,
settle the two oldest loads successfully, fail the newest load, then remove
marker 1. The scenario has descending order, offset 1, limit 2, no ties or
peer, an anti-join and an inline include over on-demand markers. At quiet
loading, the expected retained snapshot is empty; production publishes row 1.

The adapter receipts distinguish production failure from demand retirement.
The include held no demand at truncate. It later acquires marker key 1 while
the sibling join replay is loading. That include acquisition fails and remains
held and un-aborted. Its sibling later succeeds. Only cleanup unloads the
failed acquisition, after the mismatching observation. The old guard looked
only for a failed sibling replay. The repair also recognizes a loading replay
that still withholds publication. Ordinary failures outside replay retain their
existing request-error behavior.

## Primary owner and experiment order

`load-subset-replay-refinement-oracle.test.ts` remains the primary owner.
The change retains the subscription-scoped verdict and successful-coverage
corrections previously reviewed on PR 2312. Those corrections concern the
model, not a new production promise: shared publication does not merge replay
verdicts. Their two finite calibrations remain in the same owner.

Before the runtime edit, a new constructive finite grammar produced the
intended RED on unchanged main. The failing assertion reports one measured new
sibling failure and the same empty-snapshot/row-1 mismatch. The first reach
recorder incorrectly excluded retired historical acquisitions; the corrected
pre-edit run measures acquisitions actually held at truncate. Both logs remain.

The final grammar has 48 histories: two order directions, three widths, one or
two successful pre-failure settlements, and four later actions (none, marker
change, rank move, or another marker replay). Every history uses the existing
model, driver, retention comparison after each command, quiet checkpoint, and
final authoritative recovery. No expected row set was added to the histories.

The initial repair trial passed all retention comparisons but failed the newly
declared own-coverage reach. The final recorder observes same-subscription key
coverage, rather than predicate object identity: a later demand may construct
new request data. The grammar also includes an explicit later replay control.
This post-trial reach work does not retroactively establish a pre-edit recovery
reach gate. The original retention RED and the receiving path were obtained
before production changed.

Final measured reach: 44 histories with a first-demand failure under a loading
sibling; 33 with retirement of such failed demand; 12 with later successful
coverage by its own subscription. The three states belong to this constructive
grammar. Adding them to the shared result type initially made the unconstrained
campaign demand them by accident; the explicit owner assignment corrects that
without removing any pre-existing reach obligation.

The original-guard mutant fails at the intended quiet retention comparison,
with the same one measured new sibling failure. It was restored in a `finally`
block and the repaired source hash was checked. Setup errors are recorded
separately and are not RED or mutant rejection evidence.

## Browser grammar repair

`multi-tab-electric-oracle.test.ts` owns the existing five browser laws.
The failed 80-history random campaign missed **reset-abandoned source recovered
during final catch-up**. Its fixed campaign reached that state four times.
A previous stop/peer prefix constructs other required states, but this state
still depended on an unconstrained 8–24-step tail.

The repair keeps that prefix, tail, 80-run budgets, model, comparisons and reach
minimum. A suffix creates a fresh handle, recovers and catches up every tab,
delivers a new change to one tab without committing it, then resets its
reservation. The existing final delivery must observe the abandoned commit's
failure before restarting and checking convergence. Two/three tabs, source tab,
key and recovery method vary. Removing the partial delivery or reset loses the
premise; committing before final catch-up moves the failure to a different cut.
The original named final-delivery replays remain unchanged.

## Review and limits

This is an author self-review. The earlier independent diagnosis supplied the
receipt trace; it is not an independent review of the final implementation.

- ORC-001/002/003/005/009: accepted architecture law, existing independent
  row/retention model, literate grammar and real Collection sync boundary;
  subscription identities and requested keys are adapter receipts.
- ORC-004/013/015: finite direction/width/settlement/change grammar reconstructs
  the reported witness and adjacent controls. Absent replay is the ordinary
  failure neighbor; obsolete or retired requests cannot count as held failures.
  Browser suffix ablations lose its stated premise. Reach is measured.
- ORC-006/010: original guard rejected at the retention assertion; original
  failure, initial reach-only failures and setup errors remain distinguishable.
  Existing fixture cleanup remains in place.
- ORC-007: existing fixed/random properties and direct seed/path interface are
  unchanged. The new 48-cell grammar is finite enumeration, not a random
  property. Browser fixed/random campaigns retain the same 80-run grammar.
- ORC-008: no new semantic model state. New receipt fields serve reach only.
  Retained subscription distinction is required because sibling success and
  own success permit different verdicts.
- ORC-011: no new shared semantic fault hypothesis. Independent adapter trace
  rejected the alternative retirement explanation of this failure.
- ORC-012/014/016: this record states the bounded claim and the unchanged
  controlled premises. Histories use the shared comparison, with no unit-test
  expected answers.

Core evidence is limited to live-query Collection publication with one ordered
source, a one-level inline include, and the controlled core sync adapter. This
change does not claim Effect failure disposal, provider delivery, framework
scheduling, arbitrary joins or deeper recursion. Those paths have separate
owners; the modified builder failure path serves live-query Collections.
Browser evidence uses real SQLite, BroadcastChannel and coordinator code in one
Node process with controlled Electric streams. It does not establish installed
SDK/HTTP, real browser multi-process timing, on-demand row contents or existing
known-gap closure. No laws, assertions, run budgets or reach minima are weakened.

## Final commands, results and source binding

Local runs use saved configs under `/private/tmp/callback-metadata/release-replay-repair` to resolve the exact worktree source with cached dependencies. Every command sets `pnpm_config_verify_deps_before_run=false`; Vitest uses one worker.

| Check | Command or selector | Result |
| --- | --- | --- |
| Pre-edit primary RED | `pnpm exec vitest run --config <scratch>/vitest.config.mjs -t 'keeps new include failures behind a loading sibling replay'` | Intended quiet retention mismatch; measured first-demand sibling failure 1. |
| Final finite grammar | Same command | PASS, 48 histories, failure/retirement/own-recovery reach 44/33/12. |
| Original guard mutant | Same command with only the old guard restored | Intended quiet retention mismatch, measured failure 1. Repaired source restored and hash verified. |
| Full primary owner | `pnpm exec vitest run --config <scratch>/vitest.config.mjs` | 43 passed, two accidental new-reach obligations failed. After explicit ownership correction, both affected fixed/random campaigns passed. All 45 tests pass across those runs. |
| Core neighbors | Saved `neighbors.config.mjs` | 21 tests in three files pass, covering replay refinement, failure boundaries and request errors. |
| Browser fixed/random campaigns | `pnpm exec vitest run --config <scratch>/browser.config.mjs -t 'keeps reserved commits lawful'` | Both pass. Final catch-up recovery reached 80/80 histories in each campaign. |
| Browser final-delivery controls | Same config with the two existing final-delivery selectors | Both existing shared-model replays pass. |
| Focused TypeScript | `pnpm exec tsc --noEmit -p <scratch>/db-types.json` and `browser-types.json` | Both pass. |

The browser campaign retains 80 runs for each seed mode. Its expected injected stream errors are diagnostics, not comparison failures. The first two browser setup failures, the initial reach-only failures, and the intermediate TypeScript literal-inference error remain separate from RED/GREEN evidence.

The following SHA256 fingerprints bind the main-based executable evidence to PR 2318 commit `0e5a5234b9fe4a26244a0e52d3862916a7f4ce7e`. The callback branch port has separate source fingerprints and results in [its evidence record](callback-metadata.md#release-blocking-loading-sibling-replay-port-2026-10-30).

| File | SHA256 |
| --- | --- |
| `packages/db/src/query/live/collection-config-builder.ts` | `bb1b62aaf00aed1dc5eaa5e537671d92bb99def7a53a6e951ef38f73b00f5088` |
| `packages/db/src/collection/subscription.ts` | `bd171bdc97b38a79ebbc81d7fb605267787308559ad4c0646dff1e072a43798a` |
| `packages/db/tests/query/load-subset-replay-refinement-oracle.test.ts` | `e5ce4a77fe8d16f4b0d26f4c71fdadb53b2779c8e7e8313a7eb32d2de3ebdd38` |
| `packages/browser-db-sqlite-persistence/tests/multi-tab-electric-oracle.test.ts` | `67c16d284522417f1a77e0a36efcc552b718f858ea8ec00771f001f001160782` |

Focused ESLint reports zero errors and two existing `no-shadow` warnings. Prettier, whitespace, and `pnpm lint:changed` pass. No run budget decreased or disappeared.

## Subscription-scoped request-error checker repair

CodeRabbit review 5719714297 covered repair head
`0e5a5234b9fe4a26244a0e52d3862916a7f4ce7e`. Its one behavioral
finding identified a false-green request-error classification. Architecture
law 16 and the glossary's request-error rule already scope a lazy demand's
error to that demand. A sibling subscription asking for or loading the same
source keys cannot decide it. Shared publication does not merge verdicts.
The existing complete authoritative source-recovery control still decides the
held demands together; an individual sibling verdict does not supply it.

The old account stored successful keys by source alone. Both its later-request
and later-coverage exemptions omitted subscription identity. The repair keeps
that identity in the recorded successful acquisition and requires it in both
exemptions. This is an oracle enforcement repair. Production is unchanged.

The existing 96-history sibling-success grammar varies direction, join form,
width, replay source and settlement order. A receipt probe found four histories
with eight observation cuts where the old account exempted an error the scoped
account owed. Production listed the exact injected error at all eight cuts.
The cut concerns a later sibling request; the experiment did not establish a
later successful sibling-coverage cut with an otherwise owed request error.
An initial reach counter for that stronger premise correctly failed at zero.
It remains in the scratch evidence. The final declared reach names the actual
sibling-request error comparison and reaches four histories. The existing
successful-sibling-coverage reach also remains four.

Calibration supplies a wrong public observation to the same health comparison:
omit the injected error only at those distinguishing cuts. The old account
accepts it. The scoped account rejects it at `after settle: request error`,
with expected true and actual false. A broader temporary production mutant
that suppressed every ready-query replay error already failed the old checker;
it is not evidence for this newly repaired gap. Both temporary sources were
restored. The real production owner passes all 45 tests, including fixed and
random campaigns, with the stronger classifier. The reported seeds and paths
from issues 2294 and 2315 each pass the direct replay interface as well. These
are bounded replay results, not closure of either whole issue or provider
adapter conformance from issue 2118.

ORC review (author self-review): 001/002/003 use the accepted demand-scoped
law, independently evaluated request keys and explanatory local prose.
004/013 retain all 96 legal histories and their direction/join/width/source/
settlement neighbors; collapsing subscription identity is the wrong rule.
005/006/015 exercise the real Collection sync path and public health error
identity after each command, measure four distinguishing histories and reject
the targeted omission. 007 retains all fixed/random campaigns, budgets and
seed/path replays. 008/009 retain subscription identity because equal source
keys can have different demand verdicts. 010 retains primary mismatch and
cleanup separation. 011 has no new shared production/model semantic-fault
hypothesis: the defect was an exemption before the assertion. 012 is this
versioned bounded record. 014 keeps the controlled core boundary and makes no
provider/framework handoff claim. 016 adds no unit expectation or standalone
fixture. No law, comparison, budget or prior reach minimum was weakened.

The checker evidence is stored under
`/private/tmp/callback-metadata/release-replay-repair/review-5719714297`.
Commands use the saved `vitest.config.mjs` for the full primary owner and
`-t 'retains sibling replay failures through successful coverage'` for the
finite calibration, with one worker and dependency verification disabled.
The amended primary owner SHA256 is `a2ab454ff5a77aa47bf57cbd590b67a2a5602d3dd6897af051fb1819b9482ce7` on both branches. The earlier
table binds the original repair evidence. Its runtime and browser hashes remain
unchanged; callback runtime hashes remain bound by its separate port record.


## First-demand admission and terminal grammar review (2026-11-02)

This amendment evaluates all nine findings from the human-supplied review of
`ec25fc4f117c0b20fa0827f33b2a400a6e77a36a`. The original review was unverified;
its examples were hypotheses. This is an author self-review. The raw review,
append-only nine-item ledger, source bindings and complete logs are retained in
`/private/tmp/callback-metadata/release-replay-repair/nine-item-review-20261102`.

### Law, experiment and inference

**Law and authority.** ARCHITECTURE **Replay participants and failure**, law 9,
requires new demand started under a sibling's replay to share publication.
**Atomic window publication** separately permits a move to reject once a waited
replay fails. The earliest-error promise is that replay's own earliest still
deciding failure, an explicit maintainer decision already present on release
base `e75f8455a78bc33c43376288218e9912dc2a3f4c`; it imposes no global failure order
across independent subscription verdicts. Laws 16/17 scope request errors to
the failed demand. Publication retention and operation success are different
judgments.

**Experiment before production.** The existing primary owner gained a provider
settlement selector and a 48-history grammar: direction, width, include/sibling
settlement order, success/failure and presence of a waiting move. An unmarked
sixth parent remains eligible after the sibling succeeds. All 48 histories fail
on unchanged ec25 at the existing public retention assertion: row 6 publishes
while the retained result is empty and include work remains held. The mismatch
can occur before include failure, so changing only `failDemand` cannot close
this ordering. Earlier probes without the persistent parent passed; obsolete
speculative includes retired, or other held loads masked the publication cut.
Those passing probes were not treated as refutations. Both 96-history error
campaigns passed before production changed. The real core receiving path is an
ordered live-query Collection, its join and one-level inline include over real
Collections with controlled adapter promises. No new framework/provider promise
requires a different receiving driver for this admission repair.

**Repair.** First demand now creates its own replay hold when a sibling replay
still loads, before calling the adapter. Setup itself holds publication through
reentrancy, and the existing participant machinery handles settlement, abort,
retirement and retry. Sibling success can no longer remove this subscription's
hold. The failure fallback remains for the existing failure path.

**Reach.** The final selector chooses active, un-aborted acquisition receipts;
it drains other work while keeping the selected include held. The 48 histories
reach 24 late active settlements and 12 retry starts while a sibling loads.
The selector and retry counters were corrected after the first runtime trial;
the original 48-history public-retention RED remains the pre-edit gate. Do not
claim the corrected reach counters ran before that trial. The first full run
passed all behavior comparisons but had three reach-only failures: one selector
included retired speculative requests, and two unconstrained campaigns inherited
new obligations owned by the constructive grammar. These were corrected without
removing any pre-existing reach or minimum.

New-sibling classification, failure and retirement reach no longer read model
barriers. The driver snapshots acquisitions at the actual truncate and uses
adapter starts, failures, aborts and unloads. The original 48-cell grammar now
measures 44 failures, 9 same-truncate failed-demand unloads during commands, and
12 later own recoveries. The historical retirement count 33 was model-derived;
it is not the count of this stricter receipt witness. Final cleanup and a newer
truncate's physical-acquisition renewal supply no retirement reach. Semantic
retention, request-error and recovery comparisons remain unchanged.

**Calibration.** Disabling admission reproduces the intended retention RED.
Reporting the latest own failure instead of the earliest fails error identity.
Omitting an actually observed public error after successful sibling coverage
fails the ordinary owed-request-error assertion. The removed model-only
`replayScopeViolation` assertion proved no production behavior; its replacement
evidence is this public observation calibration, not a second model invariant.
All temporary subjects were restored in `finally` and their hashes verified.

### Browser terminal regimes

The old suffix's fixed 80-history run reaches zero stopped-source restarts at
final catch-up. Its existing final comparisons do exercise a lagging-row rewrite
in 46 histories, so the review's assertion that both regimes are absent is too
broad. The missing stopped-source reach is a grammar failure, not a production
mismatch. A terminal dimension now keeps the original arbitrary final state or
constructs a reset-abandoned commit or a stopped source. The 24-step stop prefix,
8–24-step arbitrary tail, 80 accepted histories per campaign, all comparisons,
existing minima and known-gap handling remain. The constructive endings add
`4 + 2 * tabCount` steps (8 or 10); an untouched ending adds none.

The real SQLite/coordinator driver measures both final branches. Fixed/random
campaigns pass with final stopped-source restart reach 53/42, lagging-row rewrite
58/52 and reset-abandoned final recovery 22/35. Temporary omission of final
restart fails the public source-head comparison; omission of final commit fails
an ordinary durable/public comparison. This is the separate release CI reach
repair described earlier, not evidence about include admission. Sampling the
terminal dimension is bounded evidence, not a universal guarantee of reach for
every possible future random seed. Required minima continue to fail any campaign
that misses a declared state.

### Lossless item accounting

| ID | Technical judgment | Action and durable value |
| --- | --- | --- |
| R1 | Confirmed production and history gap; the narrower failure-only fix missed admission. | Fixed first-demand admission and added settlement order with a persistent parent. Original-admission mutant fails retention. |
| R2 | Rejection despite eventual successful retry is allowed by Atomic window publication. An already failed operation need not become successful. | Accepted design. Keep rejection separate from shared retention; the new admission path participates normally rather than depending on synthetic failed completion. Retry reach is explicit. No success-after-retry promise was added. |
| R3 | The self-check follows directly from the model's guarded deletion loop and does not calibrate production. Existing health comparisons have independent sensitivity. | Removed the redundant model self-check. A wrong actual health observation is rejected at the owed-error comparison. |
| R4 | Cross-subscription earliest-error ordering is not promised. The scope change aligns with an existing maintainer decision. Its reporting needed to be explicit. | Accepted design; coverage map now cites the authority and records the comparison correction. A latest-own-error mutant fails. A claim that no assertion changed would be inaccurate: the old source-wide expectation was corrected, not preserved. |
| R5 | Stopped-tab final recovery was absent; lagging-row final rewriting was reached. The suffix still removed arbitrary final states. | Added terminal regimes and actual branch reach. Kept the separate browser release-CI purpose explicit. Final restart/commit mutants fail. |
| R6 | The claim of receipt-only reach was inaccurate because classification read model barriers. | All newly claimed reach comes from actual adapter receipts and truncate/command boundaries. Model-based historical counts are not relabeled as receipt measurements. |
| R7 | Confirmed duplicate classifier. | One classifier serves both marker adapter paths. |
| R8 | Confirmed incomplete explanatory comment. | Comment now names sibling settlement and retirement. Architecture clarifies admission before adapter reentry. |
| R9 | Confirmed missing suffix length. | Prose states prefix, arbitrary tail and optional 8/10-step ending separately. |

Totals: seven `fixed-now`, two `accepted-design` (R2/R4); no deferred finding.
R4's reporting correction is complete even though its proposed extra product
obligation is not accepted. Every original claim and suggested repair has a
separate ledger entry. No global source-wide error order or automatic success
of an already failed operation was introduced.

### Reviewer assessment and limits

Qualified hire. The reviewer found a real admission defect and useful test
integrity, reach and prose problems. The proposed admission location was sound.
The review explicitly labeled its production claims unverified. It still
confused operation rejection with publication retention, missed an explicit
maintainer decision, and overstated the browser reach loss. Executable probes
and authority checks are needed before treating its downstream claims as facts.

The claim remains bounded by this owner's finite histories, one ordered source,
one-level include, no peer for retention, controlled core adapter and named
public checkpoints. Existing initial-readiness, abort, retirement, request-error,
error-identity and convergence checks remain. This is not Effect disposal,
arbitrary provider, framework, deep-include or multi-process browser closure.
An evaluated review does not establish whole-PR readiness: final pushed CI and
integration with the actual main branch must be assessed separately. Neither
PR is authorized to merge by this review.


### Final validation and source binding

The browser counts above bind the earlier expanded-grammar run in
`browser-expanded.log`. Final runs use the same grammar, comparisons and
original 80-accepted-history budgets. Their measured final branches are:

| Branch/run | Stopped-source restart | Lagging-row rewrite | Reset-abandoned final recovery |
| --- | ---: | ---: | ---: |
| Repair fixed | 53 | 58 | 22 |
| Repair random | 48 | 52 | 31 |
| Callback fixed | 53 | 58 | 22 |
| Callback random | 46 | 58 | 31 |

On each branch, one fresh full primary run passes all 46 tests, the three
neighboring files pass 21 tests, and the browser selection passes both
campaigns plus both existing final-delivery replays (four tests). Focused core
and browser TypeScript, ESLint, formatting, whitespace and `pnpm lint:changed`
pass on both branches. ESLint retains two existing shadow warnings. Whole
repository `pnpm test`, builds and installs did not run. Local Vitest is cached
3.2.4; these runs do not replace final-head CI.

Callback browser setup initially missed Electric, debug and SQLite resolution.
A subsequent scratch mapping separated the mock from the adapter's SDK module,
so no controlled stream started. Those runs are setup failures, not behavioral
RED. The final mapping resolves both SDK imports to the same installed module
and runs the callback branch's actual sources. No repository dependency file
or installation changed.

The repair is based on `ec25fc4f117c0b20fa0827f33b2a400a6e77a36a`; the port is
based on `a2e75c30402deb815abd01783ea816a2edfe3ea8`, which already integrates
main `85392bd1d349aa3bb77c9c11ffba671f0b2d2a84`. Both final trees share these
SHA256 bindings:

| Source | SHA256 |
| --- | --- |
| `packages/db/src/collection/subscription.ts` | `5cd5a8759dc38bf70c88ed756b6886e474afef5ad02f4419bd0f5d1ab6b39dc0` |
| `packages/db/tests/query/load-subset-replay-refinement-oracle.test.ts` | `d3c4edf87d4f046d888887ab4dea6e16ed40571a8e4334850427573d92c51271` |
| `packages/browser-db-sqlite-persistence/tests/multi-tab-electric-oracle.test.ts` | `3184cd014be5ab6222350525bbd3d09a78b46e49c5e8b17fdde6ffbc417f26c5` |

The containing commit versions this evidence; final commit IDs and all changed
path hashes are additionally bound in the scratch `final-binding.json` and the
published PR descriptions. The builder differs between branches because the
callback branch retains its plural joined-dependency gate. This review changes
only its explanatory comment. Compiler and Solid source/test paths are
unchanged from each branch's starting head. Earlier runtime fingerprints and
size figures remain historical, because admission intentionally changes runtime.

### Oracle guide audit for this amendment

This is author self-review, not an independent external review.

- ORC-001/002/003: the architecture and existing maintainer decisions supply
  authority. The independent source-row/barrier model and server log remain
  separate from real drivers. Local prose explains the new grammar and cuts.
- ORC-004/013: direction, widths 1–3, both settlement orders, success/failure and
  waiting/no-waiting moves reconstruct the new core witness. Removing the
  persistent parent masks it through retirement; removing order variation
  misses sibling-first publication. Browser arbitrary/reset/stop endings keep
  the prior arbitrary domain and distinguish final recovery branches. Aborting
  an acquisition excludes it from the active demand premise. Closing a tab for
  good remains outside the existing browser convergence claim.
- ORC-005/006: core compares actual public rows and request errors after commands,
  quiet loading and authoritative recovery. SQLite/coordinator compares durable
  and public rows/status at existing cuts. Admission, own-error, owed-error,
  final-restart and final-commit controls reject at intended assertions, not
  setup or timeout. All temporary subjects were restored.
- ORC-007: fixed and random campaigns retain the same generators, comparisons
  and budgets. The existing direct seed/path interface and two final-delivery
  replays remain. The new 48-cell core grammar is bounded enumeration, so it
  does not need a second random copy. Existing related-issue seed/path results
  remain bounded historical evidence.
- ORC-008/009: removing model-only calibration state cannot change a promised
  result. Acquisition receipt state belongs to the driver and measures reach,
  not expected publication. Publication stays source-shared while verdicts stay
  subscription-owned. These distinctions use the glossary's demand/acquisition
  boundary and the documented barrier abstraction.
- ORC-010: finite enumeration preserves every mismatch in an AggregateError,
  with its first failure as cause. Existing cleanup still releases real resources.
  Setup and reach failures remain separate from behavioral mismatches.
- ORC-011: the concrete shared-fault hypothesis was model-derived reach. The
  repair measures actual adapter receipts independently of model barriers. No
  additional shared semantic fault requiring a second model was identified.
- ORC-012/015: this versioned record reports limits, the original public RED,
  final GREEN, hostile controls, both branches' hashes and declared reach. New
  constructive reach is not imposed on unrelated arbitrary campaigns.
- ORC-014: the claims end at controlled core adapters and Node-host real SQLite/
  coordinator code. Controlled Electric streams and peer-reset messages supply
  premises. No real-provider or browser-process handoff claim follows.
- ORC-016: new finite histories use the existing shared model/driver/comparison.
  Final-delivery replays carry inputs without separate expected values. No unit
  assertion or concrete type assertion was added to an oracle.

No raw review item is deferred. The remaining limitations are the owners'
explicit controlled and finite boundaries, not a known reachable violation of
the repaired admission law. Final pushed CI and repair integration with actual
main remain separate readiness obligations. No merge authorization follows.


## Final-catch-up provenance and deferred sibling resumption review (2026-11-02)

This amendment evaluates CodeRabbit review **5738453581** on repair head
`b73f8e865bdda471df9dc77cc471e927143a41a9`. Its callback port starts from
`0b53825d4c19446fa3f346c1575820498804da9c`. The incremental run
`9a64a058-a898-4ac9-8d4c-4ecc87fdea30` selected eight files and skipped five
similar files. Selection does not establish eight fresh reviews. This is an
author self-review of the resulting oracle changes. No product law or shipped
source changes in this amendment.

### Law, experiment, and inference

**R1: eventual convergence needs an honest reach premise.** Browser owner Law 2
and the coverage map promise the server head after every open stream catches
up. Durable/server divergence alone does not show that an older tab overwrote
a newer peer commit. Instrumenting the old grammar on unchanged production
recorded 58 final divergence repairs: 57 had no older-over-newer peer overwrite,
and one had it. The fixed campaign accepted 80 histories and initiated 81,
because the existing known-gap classifier discarded one history. These are
diagnostic counts, not a production RED or a new product defect.

The owner now retains that old observation as `durable divergence repaired
during final catch-up`. Separate provenance records the delivered message's
server-log version, source handle, and committing tab. A differing older
same-key change must overwrite a newer peer commit. The marker remains until
the key reaches server head; a full snapshot resets this provenance. Final
rewrite reach counts only after the existing real durable/public comparison
passes. Provenance is independent model-side instrumentation over delivered
messages, not a production coordinator classification.

The terminal dimension adds `lagging` beside the existing arbitrary, reset,
and stop endings. It starts a fresh handle, catches up every tab, establishes
the chosen key, catches up every tab again, makes two updates, lets a peer
commit both, and lets the selected tab commit only the older update. Final
catch-up must repair that actual overwrite. The new suffix has `6 + 3*tabCount`
steps (12 or 15). Reset/stop still add `4 + 2*tabCount` (8 or 10), and arbitrary
adds zero. The original 24-step stop prefix, arbitrary 8–24-step tail, model
predictions, comparisons, known gaps, 80-run budgets, and minima remain.

The omission mutant suppresses only the final up-to-date commit while actual
older-over-newer overwrite evidence remains. It fails the ordinary durable and
public row comparison at `after final delivery to tab A` (v2 instead of v3).
It is an intended assertion failure, not a setup error or timeout. The captured
seed is `952051961`, shrink path `4:0:0:1:1:1:1:1:1:1:1:1:1:1:1:1`.
The shared direct replay interface reproduces that same mismatch. The oracle
file is restored after each temporary calibration.

**R2: resumed deferred demand must progress after applied coverage.** Authority
is ARCHITECTURE law 15 (no acquisition before an own subscriber/preload), law 9
(shared replay publication), and Initial demand (readiness after coverage).
The alleged completion cycle is refuted on its actual path. Existing
`startTruncateReplayDemand` removes `parkedParticipant` and decrements its
attempt before starting acquisition. The initial-result waiter can then wait
for completion without participating in the completion it awaits.

The deferred-acquisition owner adds a finite 32-history grammar over a real
same-source LEFT self-join. It crosses subscriber/preload, one/two rows,
literal/held-Promise root and sibling results, and oldest/newest settlement.
The query starts its sync run without a reader and asserts zero acquisitions.
Its first source acquisition writes synchronously. This creates demand in the
second subscription while that subscription still defers acquisition and a
sibling replacement holds publication. A request-entry spy measures the actual
deferred-to-joined transition, with reach one required in every history.

Held provider promises keep initial-query readiness pending. After controlled
successes, the query must be ready, any preload must fulfill, and public rows
must equal the independent self-join projection of input IDs. The driver allows
no later truncate, abort, window move, or extra preload to rescue the history.
All 32 pass against unchanged production on both branches. Leaving the parked
participant installed makes all 32 fail the readiness assertion with `loading`
instead of `ready`. Production bytes are restored afterward. The review's
major production repair is unnecessary; its durable value is this coverage.

### Executed GREEN and calibration evidence

On each branch, the complete deferred-acquisition owner passes **540 tests**,
including the new 32 histories. Both browser campaigns accept **80 histories**
per branch. The two existing final-delivery replays pass on both branches.
Repair ran its missing second replay separately after the first selector chose
only three tests. Callback ran all four tests in one invocation.

| Branch/campaign | Final stopped-source restart | Durable divergence repair | Actual older-peer overwrite repair | Reset-abandoned final recovery |
| --- | ---: | ---: | ---: | ---: |
| Repair fixed | 36 | 63 | 25 | 16 |
| Repair random | 34 | 60 | 18 | 25 |
| Callback fixed | 36 | 63 | 25 | 16 |
| Callback random | 38 | 66 | 25 | 18 |

Earlier records describing 46, 52, or 58-style final counts as lagging rewrites
are historical divergence counters. They do not establish older-over-newer
peer overwrite coverage. This correction preserves their original records and
does not retroactively strengthen that evidence.

Focused core/browser TypeScript, ESLint, formatting, whitespace, and
`pnpm lint:changed` validate the follow-up. Callback's first browser TypeScript
attempt lacked local module paths. Temporary links to already installed cached
modules repair setup and are removed afterward. No dependency install, manifest
or lockfile change occurs. Local Vitest is cached 3.2.4; CI uses 4.1.12. Full
repository tests and builds are not run for this oracle-only amendment.

### Grammar controls and oracle self-review

Reconstruction: the old arbitrary/reset/stop regimes remain reconstructible.
The lagging suffix reconstructs an actual older commit over a newer peer and
leaves it for the final comparison. The deferred grammar reconstructs the
reviewed parked demand during real sibling resumption. Ablation: remove either
update, the peer commit, or the selected older commit and the overwrite premise
is lost. Remove the deferred start or synchronous first delivery and the parked
sibling path is lost. Promise axes distinguish pending readiness from literal
completion; settlement order distinguishes the two active acquisition gates.

Range: browser histories retain two/three tabs, keys 1–3, every existing stop
kind and tail action, plus all four endings. Deferred histories bound one/two
rows and two source subscriptions with both public initiating paths. Zero rows
cannot create the reported keyed sibling demand and is outside this lane; the
existing broad owner retains empty/no-provider regimes. Exclusion: the suffix
commits an update only after establishing its key; it never fabricates an
update to a missing row. The deferred lane never starts provider work before
the first reader and never settles an acquisition that was not issued.

| Requirement | Outcome for this amendment |
| --- | --- |
| ORC-001 | Existing Law 2 and ARCHITECTURE laws 9/10/15 authorize results. Limits below remain explicit. |
| ORC-002 | Input-ID self-join recomputation and server-message commit provenance use no production semantic classifier. |
| ORC-003 | Contract, model, histories, driver, and checkpoints remain visible beside executable code. |
| ORC-004 | Reconstruction, ablation, range, and exclusion appear above. |
| ORC-005 | Real core live-query Collection and real SQLite/coordinator paths compare readiness, rows, and durable/public state. Supplied messages contain the source facts needed at each cut. |
| ORC-006 | Parked-participant and actual-final-commit omissions fail their intended assertions; neither is a setup failure. |
| ORC-007 | Browser fixed/random campaigns use the same property, grammar, recorder, comparison, and 80-run budget. Direct seed/path mutant replay reproduces the row mismatch. The 32-case finite enumeration needs no random campaign. |
| ORC-008 | Provenance is reach instrumentation, not a change to expected product state. Equal row divergence can have different commit origins, so provenance distinguishes which coverage claim applies. |
| ORC-009 | Comments map provenance to delivered message position/tab/handle and distinguish demand from acquisition and completion. |
| ORC-010 | Existing browser failure/cleanup handling remains. Calibration scripts restore exact bytes in finally. The deferred driver restores its spy, settles held gates, and cleans Collections. |
| ORC-011 | No shared semantic-fault hypothesis needs a second formulation. The independent self-join result and explicit commit provenance address the two named hypotheses. |
| ORC-012 | This versioned record binds the reviewed parent heads, evidence, dispositions, and every applicable requirement. |
| ORC-013 | Divergence without an older overwrite is the neighboring false-positive case. Literal versus held results and both settlement orders distinguish readiness boundaries. |
| ORC-014 | Claims cover controlled core acquisition. The SQLite/coordinator tests run in Node with controlled Electric messages. No HTTP provider, framework, or browser-process handoff claim follows. |
| ORC-015 | Browser reach requires each retained minimum plus honest divergence and actual overwrite states. Every deferred history requires one actual deferred joined demand. |
| ORC-016 | Histories share independent projection/comparison or the existing generated driver. No standalone fixed expected rows or type assertions enter an oracle. |

### Loss audit, reviewer assessment, and readiness

The two inline findings are fully accounted: **one fixed-now** (R1 test
integrity), **one refuted** (R2 production cycle), with its missing receiving
history added. No deferral or open in-scope finding remains from this review.
The raw audit also retains summary/risk duplicates, five related-issue links,
the informational docstring metric (0%, one function, four files, four
unsupported), run metadata, and generator/autofix suggestions. No boilerplate
command runs. Related links do not establish issue closure.

The reviewer earns a qualified hire recommendation for oracle scrutiny. R1
correctly distinguishes a classifier's premise from ordinary convergence. R2
identifies a useful lifecycle intersection but overlooks the existing participant
removal, so its major severity and proposed production fix lack support. Use
runtime witnesses before relying on this reviewer for lifecycle merge decisions.

Evidence covers finite core resumption and controlled-stream Node persistence
histories at named cuts. It does not prove arbitrary provider failures,
framework schedules, browser processes, every join shape, or the existing
excluded/pinned known gaps. No new product behavior or shipped source changes.
Current-head CI after the oracle commits and actual-main repair integration
remain separate readiness requirements. No merge or publication is authorized
by this review.

## Compressed-size refactor on current main (2026-11-02)

The maintainer requested negative compressed bundle size for this repair. Both
branches now include main `035a5260ef994ce3aabed77a3f09b35c71482a9a` through normal
merge commits. Their merged trees exactly matched the preceding clean scratch
integration trees before this refactor.

The subscription constructs its acquisition record once, including for detached
demand. It captures the replay attempt once, uses the existing attempt finisher
for its setup hold, and shares the existing uncaught-error reporter. Replay
failure collection retains the same membership checks and Map insertion order
without intermediate filter/map arrays. Acquisition admission has one result
return after its cancellation, release, or participation branch. The replay
factory reads the current sync-run generation itself instead of receiving the
same value from every caller.

This is an internal refactor under architecture laws 9, 10, 15 and 16. The
accepted behavior, oracle models, history grammars, comparisons, reach minima
and run budgets do not change. The original production RED and hostile-mutant
evidence above remains historical. This refactor introduces no new behavior or
bug-class closure claim, so it uses existing applicable owners without changing
their expectations.

On each branch, one final-source run passes 1,787 tests in 11 files: replay
refinement, its fixed neighbors, deferred acquisition, lifecycle history and
publication, subscription replay, lifecycle ownership and cells, adapter
ownership, preload indexing and index reuse. Focused TypeScript, ESLint,
formatting, whitespace and `pnpm lint:changed` pass. Each branch uses one Vitest
worker, for two total. Local Vitest is cached 3.2.4, while CI uses 4.1.12. No
install, lockfile edit, full repository build or full `pnpm test` run occurs.

The existing `pnpm size:compare --base 035a5260ef994ce3aabed77a3f09b35c71482a9a
--exact-base --packages db --files` command measures the targeted production
build and app scenarios. The repair's package gzip changes from 109,825 to
109,824 bytes, a decrease of 1 byte. Its package Brotli decreases by 114 bytes.
Its typical app gzip changes from 96,410 to 96,399 bytes, a decrease of 11 bytes.
Every measured app scenario decreases with gzip. Typical app Brotli increases
by 14 bytes, and some other Brotli scenarios increase. The package-only `--dev`
measure, which includes development code as CI does, decreases by 2 gzip bytes
and 19 Brotli bytes. These local measures do not replace the remote size check.

The callback port's package gzip decreases by 59 bytes and package Brotli by
38 bytes against the same main. Its typical app gzip decreases by 75 bytes.
Typical app Brotli increases by 26 bytes. Its earlier size figures retain their
original historical bindings.

The finite core histories and current-main indexing checks supply the bounds
of this verification. Existing provider, framework, browser-process and deeper
history limits remain. Browser and Solid receiving evidence above retains its
historical source binding. Final-head CI and external review coverage remain
separate from these local results.

## Integration after the callback port (2026-11-02)

The repair's production code, oracle coverage and patch Changeset landed on
main through [#2312](https://github.com/TanStack/db/pull/2312). This section
records #2318's subsequent integration of main
`30e85464ed2b9b12c5f10981a062427a1fc8daaa` with a normal merge commit.

The conflict resolution retains main's coverage map, including later callback,
framework, SSR and numeric-window records. It also retains the historical
source binding in this review. Against that main commit, the resulting change
is this integration record only. Production, tests, manifests, the lockfile and
Changesets are identical to main. The earlier RED, GREEN, mutant and size
results keep their stated historical bindings. No new runtime verification or
bug-class closure is claimed by this document update. New-head CI and review
readiness must be checked before the requested merge.

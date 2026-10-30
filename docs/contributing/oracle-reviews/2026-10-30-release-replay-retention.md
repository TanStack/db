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

The following SHA256 fingerprints bind the executable evidence to this change. The commit containing this record supplies its immutable Git identity.

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

# Starting prompts for the remaining misfit clusters

Instructions clarified November 10, 2026 after [agent feedback](https://gist.github.com/KyleAMathews/75bbadfbc449d798c9f0b9691a540406#gistcomment-6466940). Historical survey status captured October 30, 2026; #2315 added at 13:23 MDT and #2317 at 15:26 MDT; #2329 added November 2. Paste one prompt into a new session. Each
prompt points back here for the shared rules and its evidence. The first eight
sessions continue investigated work; the later sessions cover the rest of the
survey. These are handoffs, not declarations that every reported bug still exists.

**November 2 additions:** [14 newly captured open items](misfits-survey/refresh-2026-11-02/categories.md) now have [session-specific additions and standalone starting prompts](misfits-survey/refresh-2026-11-02/session-prompt-updates.md). Read that addendum with the relevant prompt below. It separates reported bugs from capability, compatibility, documentation and performance questions; nine older items are now closed or merged without a semantic-closure claim.

**November 3 additions:** [#2344/#2347 intake](misfits-survey/supplement-2344-2347.md) adds Electric SDK retry reach to B20 and a standalone deleted-payload retention/storage investigation as B30. These are starting prompts; no new reproduction or product API decision is implied.

**November 3 draft addition:** [#2349 intake](misfits-survey/supplement-2349.md) adds standalone B31 for nested optimistic prototype preservation. Keep draft isolation and runtime shape together; the report establishes no extra-notification regression.

**November 4 additions:** [#2352/#2353 intake](misfits-survey/supplement-2352-2353.md) adds separate B16 freshness and overlapping-owner row-retention tracks, with B18 coordinating the ordered fallback receiver. PR #2354 is handled in another session and excluded.

**November 9 additions:** [Twelve eligible new items](misfits-survey/intake-2026-11-09.md) add B32–B41. Your PRs #2354/#2378 are excluded. Aggregate bug #2365/proposed fix #2375 share one cluster; the new storage, delivery, startup, extraction and adapter-capability boundaries stay distinct.

**November 10 additions:** [Eleven eligible new items](misfits-survey/intake-2026-11-10.md) add B42–B49: three narrow pairs and five standalone topics. All your currently open PRs are excluded from this intake.

## Required skills

Resolve oracle-authoring, oracle-review, evaluate-review, and prep-pr from the current checkout or installed skill catalog.
Do not use another machine's absolute skill paths. Report a required missing skill explicitly.

## Shared session rules

1. Work on TanStack/db in an isolated worktree. Inspect existing worktrees and
   their local changes before choosing a fresh checkout or continuing an old
   one. Record the actual baseline commit; old worktree names do not identify
   current main. Preserve uncommitted work and installation workarounds.
2. Before any reproduction, create `intake-ledger.md`. Cover every primary, comparison, and context issue or PR.
   Record its current state, latest relevant comment URL, claimed law, baseline, and current reproduction status.
   Mark unknowns. Do not select one issue until the ledger covers every listed item.
   Refresh the assigned GitHub issues/PRs, including comments and current state.
   Read the matching section of the [survey][survey] and relevant pilot/repair
   reports. Follow their cited evidence as needed, rather than ingesting the
   entire repair archive. The [repair overview][status] contains historical
   pending questions that have since been answered; the decisions below prevail.
3. Read applicable AGENTS.md, the glossary, oracle rubric, coverage map and
   primary owner's limits in your checkout. Load [oracle-authoring][authoring] before
   editing an oracle or its grammar/driver/comparison; load oracle-review before
   reviewing one. Read the full live-query ARCHITECTURE.md before analyzing
   materialization. For Collection lifecycle work, read the stable
   collection-subscription-lifecycle-grammar-oracle.ts entry point first.
4. Start with the accepted law and its authority. Separate product bugs,
   coverage gaps, model/harness defects, feature requests and contract decisions.
   A cluster is a lead, not proof of a shared cause. Missing oracle prose alone
   does not make an established promise a feature.
5. Repair confirmed accepted-law bugs, prioritizing them over features. Before
   production edits, extend the primary independent oracle, declare and measure
   generated reach, and obtain unchanged-production assertion RED at the right
   public checkpoint and required receiving boundaries. Then obtain GREEN and
   a hostile-mutant failure. Preserve original budgets, comparisons, error
   identity, ownership and neighboring laws. Setup failures, timeouts, OOMs and
   zero-test selectors do not supply semantic RED. Coverage-only work may stay
   production GREEN; do not invent a product failure.
6. Leave a concise report with baseline, issue-by-issue disposition, law and
   enforcement gaps, exact commands/seeds/paths/reach, patch or commit, mutant,
   limits and remaining feature questions. Preserve findings and qualifications
   in a lossless ledger. Use [evaluate-review][evaluate-review] for external review findings and
   [prep-pr][prep-pr] when preparing a PR. Do not merge or close issues on the strength of
   these prompts. Do not implement a new product promise without a decision.

7. An addendum does not replace the primary task. Change that scope only when the session header explicitly assigns another task.
8. Saved commands and seed/path values are historical inputs. Check the decoded history against the literal counterexample.
   A pass with a different history supplies no reproduction evidence. Replay the literal history through the shared checker when needed.
9. Resolve paths from your checkout. Fetch archived evidence through [the handoff guide][p2-handoff].
   Record missing evidence once. Continue supported current-main investigation. Keep unavailable historical claims unverified.
   Preserve required skill and receiving-run admission requirements.

The [investigation workflow][workflow] and [pilot summary][pilot] provide more
detail if needed. Prefer the smallest experiment that distinguishes the
competing explanations.

## Decisions every overlapping session must retain

- **Raw Collection publication:** raw reads and raw subscribers observe applied
  source transactions, including truncate and partial replay writes. Failed
  acquisition does not retract accepted writes. Live-query Collections and
  Effects retain their complete-result publication barriers. Read the
  [latest maintainer decision][raw-decision] before interpreting old replay REDs.
- **Raw-publication reference:** the [repair record][raw-repair] describes historical validation on `c351fc04d7f70dc59bf92ecbed310f899b9511cd`.
  The cross-machine handoff preserves its source on `codex/misfits-raw-publication-reference`.
  Consult [the handoff guide][p2-handoff] for its exact commit and limits.
  It has no new PR or execution result from this handoff. Do not duplicate it or claim complete closure of #2294/#2310.

- **Adapter compatibility:** no new staging API or changed applied-receipt
  semantics is approved. The earlier atomic-Collection-retention proposal is
  superseded, not the law for new work.
- **Ordered work:** keep `T ≤ N + 2P` and all 16 original transfer fixtures and
  budgets. The proposed `2N + P − 1` bound was rejected. A successful
  positive-limit load whose requested forward scope has matches must return at
  least one row. Capped replies remain legal; core completes leading ties.
- **Window changes:** preserve the existing window-change barrier, including
  when an optimistic edit removes a row while the next window is loading.
- **Queued-answer progress:** processing must return control so an already
  queued finite backend answer can run, while preserving cached-row ownership
  and atomic graph publication. Permanently conflicting caches remain a
  separate policy question.
- **Accepted optional changes:** shared metadata test reach helper: add; named
  replay reach options: add; optional follower ownership refactor: skip. Do not
  repeat these questions. Later unrelated optional suggestions have no implied
  approval.

## Where to start

| Session | Concrete remaining task                                          | Coordination                                                        |
| ------- | ---------------------------------------------------------------- | ------------------------------------------------------------------- |
| P1      | Ordered pagination algorithm within the existing transfer bound  | Own ordered algorithm/model edits; coordinate P2, P4, B13–B17       |
| P2      | Queued backend answer starvation                                 | Own progress witness; reconcile publication source with P4          |
| P3      | Follower recovery composed with replay/persistence               | Own follower/native receiving; coordinate P4 and P6                 |
| P4      | Live-query replay, includes convergence and #2315 error identity | Own graph replay judgment; coordinate B15; use the new raw boundary |
| P5      | Retirement PR #2302 review closeout                              | Separate existing PR work; coordinate ordered lifecycle owner       |
| P6      | Metadata PR #2303 correction/review closeout                     | Separate existing PR work; coordinate persistence owner             |
| P7      | Subset errors: enforcement versus stronger policy                | Diagnose first; no current accepted-law violation established       |
| P8      | Source metadata lost across a controlled peer notice (#2317)     | Own sync-metadata session witness; coordinate P3/P6 and #2272       |

P5/P6 can start independently. P1/P2/P4 share laws and test owners; establish
one writer per owner before overlapping edits. P3 can reproduce standalone work
immediately, but its combined result depends on the actual replay/publication
source selected. The backlog prompts below can begin with read-only diagnosis
in parallel. An overlap is a reason to exchange witnesses, not fork the model.

## P1 — Ordered pagination and source-prefix correctness

**Primary (the task):** #2214, #2182, #2183.

**Comparison items:** #2335.

**Context only:** #2138, #2155, #2174, #2185, #2186.

```text
Primary task: #2214, #2182, #2183.
Comparison items: #2335.
Context items: #2138, #2155, #2174, #2185, #2186.

Before any reproduction, write intake-ledger.md. Cover every primary, comparison, and context issue or PR. Record its current state and latest relevant comment with URLs. Record its claimed law and current-main baseline. Record whether it may still reproduce. Mark unknowns explicitly. Do not select one issue until the ledger covers all listed items. Additions do not replace the primary task.

Saved seed/path commands are historical inputs. Check that the decoded history matches the reported literal counterexample. A pass with another history supplies no reproduction evidence. If coordinates differ, replay the literal history through the shared oracle checker.

Read the shared rules in docs/misfits-survey-session-prompts-2026-10-30.md or the gist preamble: https://gist.github.com/KyleAMathews/75bbadfbc449d798c9f0b9691a540406. Use the handoff guide for evidence fetch instructions. If evidence is missing, record that fact once. Continue supported investigation from issue reports and current main. Keep unavailable historical claims unverified. Do not invent historical results or bypass required receiving-run admission.

Continue ordered pagination for TanStack/db #2214/#2182/#2183 and the listed provider/peer variants. First identify the smallest current-code counterexample and the exact missing source-prefix evidence. Develop an algorithm that preserves all original N + 2P transfer gates and budgets; do not port the historical candidate blindly. Positive progress does not certify arbitrary page boundaries. Read authoritative applied source rows, including rows hidden by optimism, and fence source/generation changes. Preserve leading ties, peer ownership and the active window-change barrier. No new extent/key-expression adapter API is approved.

After the intake ledger, compare #2335's separate cursor/two-term refetch witness. These coordinates are unverified on current main: property query-db.refetch-ordered-prefix, seed 1114808614, path 22:0:3:5:5:1:8:10:9:10:1:4:5:4:7:7:8:6:8:8:8:8:8:8. Use the captured dependency-build prerequisite and command. Distinguish Query DB page reporting, core prefix repair and the model's coverage authority before changing any rule. Compare with #2214 without assuming a common cause. Preserve shared model/driver/comparison, existing budgets and work bounds; obtain RED/GREEN and a hostile mutant at the same source-coverage checkpoint for any repair. Coordinate B18/P5 rather than creating a duplicate owner.

Deliver a discriminating model/witness and measured algorithm results, then repair only after the oracle-first gate. If still blocked, state the exact missing fact or contract decision and rival predictions; do not claim general impossibility from the rejected candidates.
```

### Additions and evidence — read after the intake ledger

Saved commands and seed/path values below are historical inputs. Check their decoded histories before interpreting results.

Existing work: `.worktrees/codex-misfits-repair-ordered`.

**November 2 addition:** [#2335](https://github.com/TanStack/db/issues/2335) reports a missing source Collection row after cursor refetch with two order terms, limit 1 and offset 0. It shares #2214's ordered-prefix oracle and observation, with a distinct history. The report leaves Query DB refetch reporting, core ordered repair and the model's coverage expectation unresolved. [Intake and exact replay](misfits-survey/supplement-2334-2335.md). P1 owns this investigation; B18/P5 coordinate shared files. Neither its occurrence in #2302 CI nor its reported persistence after merging #2333 establishes cause or closure.

Start with the [progress decision and strategy][ordered-strategy],
[algorithm account][ordered-account] and [next validation plan][ordered-next].
Later artifacts in the same directory refine the account; refresh them before
selecting a candidate. The historical correctness candidate passed 1,002 checks
but failed 16 work gates, including first transfer `6 > 5`. Later A21 evidence
(320 histories, 960 read-return cuts) establishes source-read facts, not a
validated pagination algorithm or an impossibility proof.

**November 10 agent feedback (not independently reproduced here):** [the second gist comment](https://gist.github.com/KyleAMathews/75bbadfbc449d798c9f0b9691a540406#gistcomment-6466940) reports that the saved #2335 seed/path passes on `caa936d5a` after decoding a different history. The literal counterexample reportedly still fails. Its proposed Query DB page-reporting cause remains unverified here. Neither #2214 nor #2182 was checked for that cause. Refresh all P1 primary issues before selecting a repair.

## P2 — Queued backend answer progress

**Primary (the task):** H02: finite queued backend answer progress.

**Comparison items:** none listed.

**Context only:** #2294, #2241.

```text
Primary task: H02: finite queued backend answer progress.
Comparison items: none listed.
Context items: #2294, #2241.

Before any reproduction, write intake-ledger.md. Cover every primary, comparison, and context issue or PR. Record its current state and latest relevant comment with URLs. Record its claimed law and current-main baseline. Record whether it may still reproduce. Mark unknowns explicitly. Do not select one issue until the ledger covers all listed items. Additions do not replace the primary task.

Saved seed/path commands are historical inputs. Check that the decoded history matches the reported literal counterexample. A pass with another history supplies no reproduction evidence. If coordinates differ, replay the literal history through the shared oracle checker.

Read the shared rules in docs/misfits-survey-session-prompts-2026-10-30.md or the gist preamble: https://gist.github.com/KyleAMathews/75bbadfbc449d798c9f0b9691a540406. Use the handoff guide for evidence fetch instructions. If evidence is missing, record that fact once. Continue supported investigation from issue reports and current main. Keep unavailable historical claims unverified. Do not invent historical results or bypass required receiving-run admission.

Investigate the finite queued-backend-answer starvation witness (H02). The maintainer requires processing to return control for an already queued answer while preserving cached-row ownership and atomic live-query publication. Reproduce on an identified current baseline and distinguish the semantic progress assertion from watchdog, setup and heap failures. Read the new raw-publication decision before reusing old retention checks.

Build the smallest legal generated history that queues the answer, reaches processing and detects whether that answer runs. Pair it with ownership and coherent-publication controls; do not delete valid cached rows or assume an arbitrary yield repairs the class. Confirm the relevant receiving path before production edits. Deliver RED/GREEN/mutant evidence, or the precise remaining premise. Permanently conflicting caches are outside the approved progress decision.
```

### Additions and evidence — read after the intake ledger

Saved commands and seed/path values below are historical inputs. Check their decoded histories before interpreting results.

Related to the #2294 investigation. Do not assume #2241 has the same cause.
Start with the [H02 diagnosis][h02], [V3 handoff][h02-handoff],
[result qualification][h02-qualification] and [later source diagnosis][h02-v5].
Check newer `canonical-current-main-v7/` and candidate-control artifacts under
the same diagnosis directory before resuming.

Historical helper worktrees include `codex-misfits-h02-progress-main-v1` and
`codex-misfits-h02-candidate-controls-v1` under the main repo's `.worktrees/`.
The bounded V7 progress failure is not candidate GREEN. Older OOM/task-starvation
diagnostics and the V3 ownership packet have different evidentiary limits.

## P3 — Follower cache rotation and persistence composition

**Primary (the task):** #2139.

**Comparison items:** none listed.

**Context only:** #2329, #2085, #2272, #2281, #2283, #2317, #2298, #2209, #2267.

```text
Primary task: #2139.
Comparison items: none listed.
Context items: #2329, #2085, #2272, #2281, #2283, #2317, #2298, #2209, #2267.

Before any reproduction, write intake-ledger.md. Cover every primary, comparison, and context issue or PR. Record its current state and latest relevant comment with URLs. Record its claimed law and current-main baseline. Record whether it may still reproduce. Mark unknowns explicitly. Do not select one issue until the ledger covers all listed items. Additions do not replace the primary task.

Saved seed/path commands are historical inputs. Check that the decoded history matches the reported literal counterexample. A pass with another history supplies no reproduction evidence. If coordinates differ, replay the literal history through the shared oracle checker.

Read the shared rules in docs/misfits-survey-session-prompts-2026-10-30.md or the gist preamble: https://gist.github.com/KyleAMathews/75bbadfbc449d798c9f0b9691a540406. Use the handoff guide for evidence fetch instructions. If evidence is missing, record that fact once. Continue supported investigation from issue reports and current main. Keep unavailable historical claims unverified. Do not invent historical results or bypass required receiving-run admission.

Continue follower cache-rotation recovery around TanStack/db #2139. Revalidate the frozen v2 patch against current main, then compose it with the actual accepted replay/raw-publication source. Keep PR #2298's merged repair as baseline context. Exercise all retained demands, ownership, crossing loads, applied receipts, actual coordinator behavior and native Node/Chromium receiving. Explicitly close or reproduce SIB002; do not inherit standalone evidence as proof of composition.

Preserve diagnostics and separate native setup failures from semantic failures. Keep the skipped optional follower refactor unapplied. Deliver an oracle-first narrow repair plus combined/native evidence and a prep-pr result when ready. Treat #2209's stronger global ordering/permanent-lagging policy, #2267's unknown-partial policy and new retry/demand policies as separate decisions.

Coordinate with P8 on #2317's source-facing metadata failure across controlled peer notices. Exchange witnesses and reconcile shared persisted-wrapper edits; do not infer that standalone follower GREEN covers the metadata-session law or the separate #2272 real-coordinator path.
```

### Additions and evidence — read after the intake ledger

Saved commands and seed/path values below are historical inputs. Check their decoded histories before interpreting results.

B20 owns [#2329](https://github.com/TanStack/db/issues/2329), a campaign reach miss in the Browser multi-tab receiving oracle. Coordinate edits to that test; the report does not establish a follower/data-correctness defect.

Issue #2139, adjacent #2085, #2272, #2281, #2283, #2317.
PR #2298 is already merged; do not redo it. Existing work:
`.worktrees/codex-misfits-repair-follower`.
Read the [follower report][follower], [v2 freeze][follower-freeze],
[candidate integrity correction][follower-integrity], [v9][integration-v9],
[v10][integration-v10] and [native shutdown diagnosis][native-shutdown].

The standalone v2 quarantines owner notices until all retained demands reacquire
and waits for applied rows across a load. V1 incorrectly treated an Error named
`AbortError` as retirement; actual signal/release governs retirement. Historical
standalone GREEN does not close the combined `SIB002` composition; C3 was still
unexecuted at the recorded cut. Normal OPFS failures remain in v10; the cold Vite
optimizer diagnosis supports a bounded host correction, not blanket native GREEN.

P8 owns the new [#2317 metadata-session witness][issue-2317]. It shares the
persisted peer boundary but observes source-facing row metadata through a
controlled notice. No common cause with follower rotation is established;
coordinate any shared wrapper edits and keep real-coordinator #2272 separate.

## P4 — Remaining live-query replay, preload and includes convergence

**Primary (the task):** #2294, #2310, #2315.

**Comparison items:** none listed.

**Context only:** #2309, #2314, #2318.

```text
Primary task: #2294, #2310, #2315.
Comparison items: none listed.
Context items: #2309, #2314, #2318.

Before any reproduction, write intake-ledger.md. Cover every primary, comparison, and context issue or PR. Record its current state and latest relevant comment with URLs. Record its claimed law and current-main baseline. Record whether it may still reproduce. Mark unknowns explicitly. Do not select one issue until the ledger covers all listed items. Additions do not replace the primary task.

Saved seed/path commands are historical inputs. Check that the decoded history matches the reported literal counterexample. A pass with another history supplies no reproduction evidence. If coordinates differ, replay the literal history through the shared oracle checker.

Read the shared rules in docs/misfits-survey-session-prompts-2026-10-30.md or the gist preamble: https://gist.github.com/KyleAMathews/75bbadfbc449d798c9f0b9691a540406. Use the handoff guide for evidence fetch instructions. If evidence is missing, record that fact once. Continue supported investigation from issue reports and current main. Keep unavailable historical claims unverified. Do not invent historical results or bypass required receiving-run admission.

Determine what remains of TanStack/db #2294/#2310 at the live-query boundary after the clarified raw-Collection law. Raw commits may be visible while live queries retain their complete result. Review the validated uncommitted raw repair before arranging any explicit transfer; do not duplicate it or import obsolete stronger-retention expectations.

Start by replaying the outstanding preload/includes histories on the selected source. Supply a genuine quiet full-window recovery checkpoint and compare the full public graph, including includes, stable facades and downstream subscribers. Repair missing model inputs or error attribution independently of product bugs; preserve exact own-replay failure identity and obsolete-response exclusion. Extend generated reach, establish current RED before production edits, then GREEN and hostile mutants. No new adapter staging API or changed commit receipt is approved. Deliver issue-level closure limits and the smallest production repair, if one remains.

Include both #2315 saved replays: the original rejected/throwing history and the November 2 rejection-only comment (seed 112008075, path 431:3:2:3:3:6). Use their respective captured commands. Verify it on the recorded revision and the selected current source; do not assume it is the earlier R03 defect. Record replay/subscription/window-operation identities and failure relevance at the deciding settlement cut. Generate both rejected and synchronously throwing include loads while varying which failed demand still decides the move. Establish whether production or the model misattributes that failure before editing either rule. Preserve exact Error identity, the shared model/driver/comparison and original budgets; show GREEN and a mutant at the same identity checkpoint. Coordinate B15 rather than creating a second oracle owner.
```

### Additions and evidence — read after the intake ledger

Saved commands and seed/path values below are historical inputs. Check their decoded histories before interpreting results.

Issues #2294, #2310, and [#2315](https://github.com/TanStack/db/issues/2315). Read the [latest raw decision][raw-decision] and
[local repair][raw-repair] first, then the [replay review report][replay-report],
[R03 diagnosis directory][replay-r03] and [initial/preload repair][replay-preload].
Historical worktrees include `codex-misfits-repair-replay` and
`codex-misfits-replay-latest-main-v3` under the main repo's `.worktrees/`.

R03's old cut had 13 complete finite histories and an incomplete aborted-cover
trace with zero quiet full-window recovery reach. `R03-E7-QUIET01` was a
checkpoint/account gap, not production RED. Root scalar publication does not
prove include/facade recovery. Old G01 original-defect and G02 incomplete-repair
failures are distinct. The revised raw-law cleanup/restart replay now passes;
this does not close all of #2310. Cross-session research named
`field-trip-adapter-conformance/replay-convergence-design-2026-10-30.md` was
referenced earlier; its absolute location is not verified in this handoff.

**New #2315 witness:** this belongs to the survey's Ordered loader / failed
requests and recovery cluster, with P4 owning its replay error-attribution
investigation and B15 contributing witnesses. The issue reports an assertion
failure at PR #2309 head `a5c4986a14dc6c6a90ed9b194457edefba9a4a48`:
property `replay.ordered-failed-replay`, seed `963116110`, path
`318:2:1:6:5:7:6:6:6:6:9`. Its history is hold → truncateMarkers → window(0,1)
→ newest rejection → markerThrows → move(4,1), with descending order, initial
limit 2, includes and on-demand markers, no peer, and `joined:none`.
Move 1 rejects with the later `marker load threw` Error. Production versus model
attribution is unresolved; similarity to the earlier R03 finding is not a
shared-cause diagnosis. See the [captured supplement][issue-2315].

**Additional #2315 witness, November 2:** [comment 6579843541](https://github.com/TanStack/db/issues/2315#issuecomment-6579843541) reports a rejection-only mismatch without `markerThrows`: ascending, offset 0, limit 1, initially preloaded, on-demand markers and includes, with no peer, tie or join. History: hold → truncateMarkers → window(0,1) → reject newest → reject oldest and stop holding. Property `replay.ordered-failed-replay`, seed `112008075`, path `431:3:2:3:3:6`; reportedly reproduced on PR #2314 head `c9c04f88a46b76225f2ddb51f2a70f0eee15c7fb` and main `85392bd1d`. Production propagation versus model participant/failure attribution remains unresolved. [Capture and exact command](misfits-survey/refresh-2026-11-02/updates/issue-2315-comment-6579843541.md). Keep this separate from the older rejected/throwing history and PR #2318's sibling-retention report; a common cause is unestablished.

The reporter's baseline control selectively restored eleven existing #2309
production files to merge-base; it was not a clean checkout of the whole
baseline. Neither the merged commit nor current releases were replayed in the
report. This handoff captures the report and does not claim a new local RED.
Reporter command, from `packages/db` at the recorded revision:

```sh
TANSTACK_DB_ORACLE_PROPERTY=replay.ordered-failed-replay TANSTACK_DB_ORACLE_SEED=963116110 TANSTACK_DB_ORACLE_PATH=318:2:1:6:5:7:6:6:6:6:9 node --import tsx tests/oracle-replay.ts tests/query/load-subset-replay-refinement-oracle.test.ts --maxWorkers=2 --coverage.enabled=false
```

## P5 — Retirement PR #2302 review closeout

**Primary (the task):** #2302.

**Comparison items:** none listed.

**Context only:** #2222.

```text
Primary task: #2302.
Comparison items: none listed.
Context items: #2222.

Before any reproduction, write intake-ledger.md. Cover every primary, comparison, and context issue or PR. Record its current state and latest relevant comment with URLs. Record its claimed law and current-main baseline. Record whether it may still reproduce. Mark unknowns explicitly. Do not select one issue until the ledger covers all listed items. Additions do not replace the primary task.

Saved seed/path commands are historical inputs. Check that the decoded history matches the reported literal counterexample. A pass with another history supplies no reproduction evidence. If coordinates differ, replay the literal history through the shared oracle checker.

Read the shared rules in docs/misfits-survey-session-prompts-2026-10-30.md or the gist preamble: https://gist.github.com/KyleAMathews/75bbadfbc449d798c9f0b9691a540406. Use the handoff guide for evidence fetch instructions. If evidence is missing, record that fact once. Continue supported investigation from issue reports and current main. Keep unavailable historical claims unverified. Do not invent historical results or bypass required receiving-run admission.

Continue review closeout for TanStack/db PR #2302 and issue #2222. Fetch the actual PR head and all review threads, then run evaluate-review against the current candidate. Preserve every finding and its disposition. The earlier alleged publication failure was refuted by matching Collection/Effect probes; do not ship a repair based on that withdrawn diagnosis. Inspect the local oracle/checker/reach corrections and revalidate any changed source or composition.

Reconcile the unpublished follow-up with the published PR, resolve the remaining concrete prep-pr items, and use prep-pr for any update. Present an optional unresolved simplification only after making its benefit and patch reviewable. Deliver the exact recommended PR delta and evidence. Do not assume merge approval or close neighboring lifecycle issues without their witnesses.
```

### Additions and evidence — read after the intake ledger

Saved commands and seed/path values below are historical inputs. Check their decoded histories before interpreting results.

[#2302](https://github.com/TanStack/db/pull/2302) addresses #2222.
At this handoff it is open, head `5e3cb22a4c94c9c64889bc6537976a62b8341dcf`,
branch `codex/misfits-repair-retirement`. Refresh before editing.
Existing worktree: `codex-misfits-repair-retirement` under the main repo's
`.worktrees/`. Read the [review evaluation][retirement-review],
[independent audit][retirement-audit], [current-main integration][retirement-integration]
and [remaining prep-pr delta][retirement-prep].

Matching Collection/Effect probes refuted the reported publication failure;
coverage/checker/reach gaps were repaired and the local current-main composition
passed 104 tests plus statics. The local follow-up is unpublished. Optional S01
was still open at the recorded cut; do not invent an answer.

## P6 — Metadata PR #2303 correction and review closeout

**Primary (the task):** #2303.

**Comparison items:** none listed.

**Context only:** #2281, #2317.

```text
Primary task: #2303.
Comparison items: none listed.
Context items: #2281, #2317.

Before any reproduction, write intake-ledger.md. Cover every primary, comparison, and context issue or PR. Record its current state and latest relevant comment with URLs. Record its claimed law and current-main baseline. Record whether it may still reproduce. Mark unknowns explicitly. Do not select one issue until the ledger covers all listed items. Additions do not replace the primary task.

Saved seed/path commands are historical inputs. Check that the decoded history matches the reported literal counterexample. A pass with another history supplies no reproduction evidence. If coordinates differ, replay the literal history through the shared oracle checker.

Read the shared rules in docs/misfits-survey-session-prompts-2026-10-30.md or the gist preamble: https://gist.github.com/KyleAMathews/75bbadfbc449d798c9f0b9691a540406. Use the handoff guide for evidence fetch instructions. If evidence is missing, record that fact once. Continue supported investigation from issue reports and current main. Keep unavailable historical claims unverified. Do not invent historical results or bypass required receiving-run admission.

Continue TanStack/db PR #2303 review closeout with evaluate-review. Reconcile the published materialization change with the newer current-main evaluation, which withdrew the production diagnosis and retained an oracle model-input correction with zero production delta. Refresh main and the PR before deciding the actual remaining patch; do not add a duplicate production fix.

Preserve all six review dispositions, verify the shared metadata test helper the maintainer already approved, and distinguish the separate optional runner suggestion. Revalidate the corrected model/receiving comparison and its calibration, then use prep-pr to prepare an accurate replacement diff/title/body as warranted. Deliver the exact recommended update and bounded evidence; do not infer that #2281 or the whole persistence cluster is closed.

Keep #2317's source-facing sync-metadata-session failure distinct from this PR's earlier materialization diagnosis. P8 owns that witness; coordinate shared metadata/wrapper edits without assuming either report resolves the other.
```

### Additions and evidence — read after the intake ledger

Saved commands and seed/path values below are historical inputs. Check their decoded histories before interpreting results.

[#2303](https://github.com/TanStack/db/pull/2303), related to #2281, is open at
head `ea769ec8d3b4c1bffc286e1d88b1b0c553c5cc5f`, branch
`codex/misfits-repair-metadata`, at this handoff. Refresh before editing.
Existing worktrees include `codex-misfits-repair-metadata` and
`codex-metadata-review-current-main`. Read the [current evaluation][metadata-review],
[claim correction][metadata-account], [handoff receipt][metadata-handoff]
and [candidate freeze][metadata-freeze].

The local review accounts for six items: four fixed, one refuted, one optional
runner suggestion. Its 86 tests and statics/calibration/replays passed. The
current-main candidate has **zero production delta**: the original production
recovery diagnosis was withdrawn; a separate missing model-input gap was fixed.
The published PR still contains the older materialization change.

The new [#2317 report][issue-2317] has its own P8 investigation under the
sync-metadata session model. The withdrawn #2303 production diagnosis does not
dispose of this new source-facing metadata mismatch, and no common cause is
established.

## P7 — Query subset error visibility and recovery

**Primary (the task):** #540, #2270, #2271.

**Comparison items:** none listed.

**Context only:** none listed.

```text
Primary task: #540, #2270, #2271.
Comparison items: none listed.
Context items: none listed.

Before any reproduction, write intake-ledger.md. Cover every primary, comparison, and context issue or PR. Record its current state and latest relevant comment with URLs. Record its claimed law and current-main baseline. Record whether it may still reproduce. Mark unknowns explicitly. Do not select one issue until the ledger covers all listed items. Additions do not replace the primary task.

Saved seed/path commands are historical inputs. Check that the decoded history matches the reported literal counterexample. A pass with another history supplies no reproduction evidence. If coordinates differ, replay the literal history through the shared oracle checker.

Read the shared rules in docs/misfits-survey-session-prompts-2026-10-30.md or the gist preamble: https://gist.github.com/KyleAMathews/75bbadfbc449d798c9f0b9691a540406. Use the handoff guide for evidence fetch instructions. If evidence is missing, record that fact once. Continue supported investigation from issue reports and current main. Keep unavailable historical claims unverified. Do not invent historical results or bypass required receiving-run admission.

Investigate TanStack/db #540/#2270/#2271. Separate the accepted shared-source health/explicit reload contract from proposed subset-local passive error attribution, healthy-peer isolation and automatic same-run recovery. Refresh the pilot findings on current code. Extend the existing owner with overlapping failure/recovery and real generated initial-load receiving histories; keep exact Error identity and health as separate observations.

Return a compact bug-versus-feature matrix with authority and a distinguishing witness for each disputed behavior. Repair only confirmed accepted-law bugs after oracle RED. If the implementation meets the existing promise, leave the stronger recovery/attribution choices as explicit product questions instead of manufacturing a bug.
```

### Additions and evidence — read after the intake ledger

Saved commands and seed/path values below are historical inputs. Check their decoded histories before interpreting results.

Issues #540, #2270, #2271. Read the [pilot report][errors]. Existing pilot:
`codex-misfits-pilot-errors` under the main repo's `.worktrees/`.
No current accepted-law production violation was established. Shared-source
health and explicit live-query reload worked; the error-identity checker had a
false-green gap repaired, followed by 5,184 histories. Overlapping failure/recovery
and generated initial-load real receiving evidence remain incomplete.

## P8 — Persisted metadata session reads across peer notices

**Primary (the task):** #2317.

**Comparison items:** none listed.

**Context only:** #2341, #2342, #2303, #2314, #2272.

```text
Primary task: #2317.
Comparison items: none listed.
Context items: #2341, #2342, #2303, #2314, #2272.

Before any reproduction, write intake-ledger.md. Cover every primary, comparison, and context issue or PR. Record its current state and latest relevant comment with URLs. Record its claimed law and current-main baseline. Record whether it may still reproduce. Mark unknowns explicitly. Do not select one issue until the ledger covers all listed items. Additions do not replace the primary task.

Saved seed/path commands are historical inputs. Check that the decoded history matches the reported literal counterexample. A pass with another history supplies no reproduction evidence. If coordinates differ, replay the literal history through the shared oracle checker.

Read the shared rules in docs/misfits-survey-session-prompts-2026-10-30.md or the gist preamble: https://gist.github.com/KyleAMathews/75bbadfbc449d798c9f0b9691a540406. Use the handoff guide for evidence fetch instructions. If evidence is missing, record that fact once. Continue supported investigation from issue reports and current main. Keep unavailable historical claims unverified. Do not invent historical results or bypass required receiving-run admission.

Investigate and repair TanStack/db #2317's source-facing metadata mismatch after a peer row notice. First reproduce the saved property/seed/path above on the recorded head and unchanged archive baseline, then on your selected current source. Preserve the first failure at step 11; later suffix actions are not needed to reach it. Confirm the source read-your-writes/serialization law and determine whether production, model inputs or the receiving driver causes the mismatch before editing expectations or production. PR #2314 is baseline context; do not assume its indexing changes caused this.

Extend the existing sync-metadata-session owner and persisted receiver with generated nearby histories varying nested source writes, metadata-free upserts, truncate, collection metadata changes, release and same-key/disjoint-key peer notices. Measure reach at the source-facing metadata.row.get cut, including the unchanged row's retained metadata; use no-peer and lawful serialization controls. Keep this trace as input to the shared model/driver/comparison, preserve budgets and existing expected-failure accounting, and show unchanged-production RED, repaired GREEN and a hostile mutant at that same checkpoint. If the defect is in the instrument, document the authority and rival predictions for its correction.

Coordinate shared wrapper/metadata edits with P3 and P6. Do not conflate this with follower rotation or the withdrawn #2303 diagnosis. Bound closure to source-facing metadata on the exercised controlled path; durable row loss and two real browser coordinators are not established by this witness. Keep #2272's receiving gap explicit. Use prep-pr when a repair is ready.
```

### Additions and evidence — read after the intake ledger

Saved commands and seed/path values below are historical inputs. Check their decoded histories before interpreting results.

[#2341](https://github.com/TanStack/db/issues/2341) adds a separate durable transaction observation obligation under this same sync-metadata owner. Use its November 2 follow-up prompt below; it is not #2317's source-facing failure or evidence of a new production defect. Release P08 in #2342 is a different identifier.

Issue [#2317](https://github.com/TanStack/db/issues/2317) belongs to **SQLite
persistence / Electric multi-tab coordination**. Read the [captured report and
scope][issue-2317]. This is a new source-facing metadata witness, separate from
P3 follower ownership and P6's PR #2303 review closeout.

The report supplies property `sync-metadata-session.persisted-peers`, seed
`346038028`, path `36:2:4:6:10:14:16:14:14:13:13:13`. At zero-based step 11,
a peer row notice for key 1 preserves its expected metadata but key 2's earlier
`{s:3}` becomes absent from `metadata.row.get`. The shared model expects source
read-your-writes and own reads in serialization order. Root cause is undiagnosed.

Reported matching replays: PR #2314 head
`a0d2c4e3780307a770ef7734b64a2d4adf5bd3ce` and unchanged merge-base
`bfd1da1a7e752d66fd667adfd3cdf54f60732b22`. The baseline used a complete
`git archive`, identical installed dependencies and package source aliases.
Neither production nor oracle changed between the reported replays; each ran
one failing history, 37 other passing tests and one existing expected failure.
These executions are attributed to the reporter; this handoff ran no replay.

The existing owner is
`packages/db/tests/sync-metadata-session-oracle.ts`; the persisted receiver is
`packages/db-sqlite-persistence-core/tests/sync-metadata-session-persisted.test.ts`.
It drives `persistedCollectionOptions` with an in-memory adapter and a controlled
coordinator peer notice. This does not establish durable row loss or two real
browser coordinators. #2272 owns that separate receiving obligation.
Reporter command, from the repository root at the recorded revisions:

```sh
TANSTACK_DB_ORACLE_PROPERTY=sync-metadata-session.persisted-peers TANSTACK_DB_ORACLE_SEED=346038028 TANSTACK_DB_ORACLE_PATH=36:2:4:6:10:14:16:14:14:13:13:13 pnpm --filter @tanstack/db-sqlite-persistence-core exec vitest run tests/sync-metadata-session-persisted.test.ts --coverage.enabled=false --typecheck.enabled=false --maxWorkers=2
```

## Backlog sessions — the other survey clusters

These prompts start with diagnosis. Their issue numbers identify inventory
leads, not freshly verified open defects. Apply the shared rules and refresh
their full issue/PR sources before choosing a repair.

### B01 — Optimistic inserts and stable view keys

**Primary (the task):** #19, #734.

**Comparison items:** none listed.

**Context only:** none listed.

```text
Primary task: #19, #734.
Comparison items: none listed.
Context items: none listed.

Before any reproduction, write intake-ledger.md. Cover every primary, comparison, and context issue or PR. Record its current state and latest relevant comment with URLs. Record its claimed law and current-main baseline. Record whether it may still reproduce. Mark unknowns explicitly. Do not select one issue until the ledger covers all listed items. Additions do not replace the primary task.

Saved seed/path commands are historical inputs. Check that the decoded history matches the reported literal counterexample. A pass with another history supplies no reproduction evidence. If coordinates differ, replay the literal history through the shared oracle checker.

Read the shared rules in docs/misfits-survey-session-prompts-2026-10-30.md or the gist preamble: https://gist.github.com/KyleAMathews/75bbadfbc449d798c9f0b9691a540406. Use the handoff guide for evidence fetch instructions. If evidence is missing, record that fact once. Continue supported investigation from issue reports and current main. Keep unavailable historical claims unverified. Do not invent historical results or bypass required receiving-run admission.

Investigate TanStack/db #19 and PR #734: which stable identity guarantees already apply while an optimistic insert becomes authoritative? Compare public row/view identity across confirmation, key changes, failure and rollback. Use the optimistic-history owner; separate broken existing identity from a proposed new key API. Deliver the smallest generated distinguishing witness and repair an established bug only after RED.
```

#### Additions and evidence — read after the intake ledger

Saved commands and seed/path values below are historical inputs. Check their decoded histories before interpreting results.

### B02 — Record writes, optimistic status and persistence

**Primary (the task):** #20, #661.

**Comparison items:** none listed.

**Context only:** none listed.

```text
Primary task: #20, #661.
Comparison items: none listed.
Context items: none listed.

Before any reproduction, write intake-ledger.md. Cover every primary, comparison, and context issue or PR. Record its current state and latest relevant comment with URLs. Record its claimed law and current-main baseline. Record whether it may still reproduce. Mark unknowns explicitly. Do not select one issue until the ledger covers all listed items. Additions do not replace the primary task.

Saved seed/path commands are historical inputs. Check that the decoded history matches the reported literal counterexample. A pass with another history supplies no reproduction evidence. If coordinates differ, replay the literal history through the shared oracle checker.

Read the shared rules in docs/misfits-survey-session-prompts-2026-10-30.md or the gist preamble: https://gist.github.com/KyleAMathews/75bbadfbc449d798c9f0b9691a540406. Use the handoff guide for evidence fetch instructions. If evidence is missing, record that fact once. Continue supported investigation from issue reports and current main. Keep unavailable historical claims unverified. Do not invent historical results or bypass required receiving-run admission.

Investigate TanStack/db #20/#661. Map what callers can currently observe about row mutation, persistence and settlement, including concurrent writes and rejection. Distinguish incorrect optimistic visibility/settlement from requests for new per-record status. Extend the existing optimistic model for any accepted-law gap and obtain a real receiving witness before a production repair. Deliver the bug/feature split and evidence.
```

#### Additions and evidence — read after the intake ledger

Saved commands and seed/path values below are historical inputs. Check their decoded histories before interpreting results.

### B03 — Transaction validation, rollback and failure feedback

**Primary (the task):** #22, #487.

**Comparison items:** none listed.

**Context only:** none listed.

```text
Primary task: #22, #487.
Comparison items: none listed.
Context items: none listed.

Before any reproduction, write intake-ledger.md. Cover every primary, comparison, and context issue or PR. Record its current state and latest relevant comment with URLs. Record its claimed law and current-main baseline. Record whether it may still reproduce. Mark unknowns explicitly. Do not select one issue until the ledger covers all listed items. Additions do not replace the primary task.

Saved seed/path commands are historical inputs. Check that the decoded history matches the reported literal counterexample. A pass with another history supplies no reproduction evidence. If coordinates differ, replay the literal history through the shared oracle checker.

Read the shared rules in docs/misfits-survey-session-prompts-2026-10-30.md or the gist preamble: https://gist.github.com/KyleAMathews/75bbadfbc449d798c9f0b9691a540406. Use the handoff guide for evidence fetch instructions. If evidence is missing, record that fact once. Continue supported investigation from issue reports and current main. Keep unavailable historical claims unverified. Do not invent historical results or bypass required receiving-run admission.

Investigate TanStack/db #22/#487. Establish the admission, atomic mutation and rollback laws; test validation failure, mutation-function failure and overlapping optimistic transactions at public cuts. Separate corrupt or partially published results from requests for new validation/error-reporting APIs. Extend the primary mutation/optimistic owners, then repair only demonstrated accepted-law failures. Report each source claim and the exact observable contract.
```

#### Additions and evidence — read after the intake ledger

Saved commands and seed/path values below are historical inputs. Check their decoded histories before interpreting results.

### B04 — Item-level list rendering

**Primary (the task):** #50, #126.

**Comparison items:** none listed.

**Context only:** none listed.

```text
Primary task: #50, #126.
Comparison items: none listed.
Context items: none listed.

Before any reproduction, write intake-ledger.md. Cover every primary, comparison, and context issue or PR. Record its current state and latest relevant comment with URLs. Record its claimed law and current-main baseline. Record whether it may still reproduce. Mark unknowns explicitly. Do not select one issue until the ledger covers all listed items. Additions do not replace the primary task.

Saved seed/path commands are historical inputs. Check that the decoded history matches the reported literal counterexample. A pass with another history supplies no reproduction evidence. If coordinates differ, replay the literal history through the shared oracle checker.

Read the shared rules in docs/misfits-survey-session-prompts-2026-10-30.md or the gist preamble: https://gist.github.com/KyleAMathews/75bbadfbc449d798c9f0b9691a540406. Use the handoff guide for evidence fetch instructions. If evidence is missing, record that fact once. Continue supported investigation from issue reports and current main. Keep unavailable historical claims unverified. Do not invent historical results or bypass required receiving-run admission.

Investigate TanStack/db #50/#126. Determine the promised framework notification and row-identity behavior, then measure a minimal list update through the real binding. Distinguish missed/stale updates from an optimization request for finer rendering granularity. Keep framework scheduling and derived results separate. Deliver an executable behavioral witness or a clearly bounded performance/API proposal; do not create a new rendering guarantee merely to call current behavior a bug.
```

#### Additions and evidence — read after the intake ledger

Saved commands and seed/path values below are historical inputs. Check their decoded histories before interpreting results.

### B05 — Electric metadata for generic mutations

**Primary (the task):** #96, #103.

**Comparison items:** none listed.

**Context only:** none listed.

```text
Primary task: #96, #103.
Comparison items: none listed.
Context items: none listed.

Before any reproduction, write intake-ledger.md. Cover every primary, comparison, and context issue or PR. Record its current state and latest relevant comment with URLs. Record its claimed law and current-main baseline. Record whether it may still reproduce. Mark unknowns explicitly. Do not select one issue until the ledger covers all listed items. Additions do not replace the primary task.

Saved seed/path commands are historical inputs. Check that the decoded history matches the reported literal counterexample. A pass with another history supplies no reproduction evidence. If coordinates differ, replay the literal history through the shared oracle checker.

Read the shared rules in docs/misfits-survey-session-prompts-2026-10-30.md or the gist preamble: https://gist.github.com/KyleAMathews/75bbadfbc449d798c9f0b9691a540406. Use the handoff guide for evidence fetch instructions. If evidence is missing, record that fact once. Continue supported investigation from issue reports and current main. Keep unavailable historical claims unverified. Do not invent historical results or bypass required receiving-run admission.

Investigate TanStack/db #96/#103. Trace which Electric metadata crosses collection configuration, mutation admission and generic mutation handling. Find the accepted metadata/type contract and its primary coverage owner before proposing an API. Separate lost existing metadata from missing generic mutation capabilities. Exercise the actual adapter/type boundary and deliver the narrow bug repair or explicit feature questions. Coordinate persistence metadata edits with P6 if they share an owner.
```

#### Additions and evidence — read after the intake ledger

Saved commands and seed/path values below are historical inputs. Check their decoded histories before interpreting results.

### B06 — Generated fields and read/write payloads

**Primary (the task):** #456, #465, #878, #1115, #2340.

**Comparison items:** none listed.

**Context only:** none listed.

```text
Primary task: #456, #465, #878, #1115, #2340.
Comparison items: none listed.
Context items: none listed.

Before any reproduction, write intake-ledger.md. Cover every primary, comparison, and context issue or PR. Record its current state and latest relevant comment with URLs. Record its claimed law and current-main baseline. Record whether it may still reproduce. Mark unknowns explicitly. Do not select one issue until the ledger covers all listed items. Additions do not replace the primary task.

Saved seed/path commands are historical inputs. Check that the decoded history matches the reported literal counterexample. A pass with another history supplies no reproduction evidence. If coordinates differ, replay the literal history through the shared oracle checker.

Read the shared rules in docs/misfits-survey-session-prompts-2026-10-30.md or the gist preamble: https://gist.github.com/KyleAMathews/75bbadfbc449d798c9f0b9691a540406. Use the handoff guide for evidence fetch instructions. If evidence is missing, record that fact once. Continue supported investigation from issue reports and current main. Keep unavailable historical claims unverified. Do not invent historical results or bypass required receiving-run admission.

Investigate TanStack/db #456/#465/#878/#1115. Separate read shape, insert/update input, defaults and server-generated values. Locate existing runtime and compile-time laws; test whether accepted inputs and returned authoritative rows obey them. For type coverage, generate legal inputs and apply an independent type law rather than adding examples inside an oracle. Deliver confirmed compatibility bugs separately from proposed schema/payload features.
```

#### Additions and evidence — read after the intake ledger

Saved commands and seed/path values below are historical inputs. Check their decoded histories before interpreting results.

[#2340](https://github.com/TanStack/db/issues/2340) adds a historical live-query mutation-input type witness. Its detailed prompt is in the November 2 release follow-ups below; preserve required published-read metadata and keep its checking-order-sensitive handler symptom separate.

### B07 — PowerSync settlement and backend confirmation

**Primary (the task):** #900, #1526.

**Comparison items:** none listed.

**Context only:** none listed.

```text
Primary task: #900, #1526.
Comparison items: none listed.
Context items: none listed.

Before any reproduction, write intake-ledger.md. Cover every primary, comparison, and context issue or PR. Record its current state and latest relevant comment with URLs. Record its claimed law and current-main baseline. Record whether it may still reproduce. Mark unknowns explicitly. Do not select one issue until the ledger covers all listed items. Additions do not replace the primary task.

Saved seed/path commands are historical inputs. Check that the decoded history matches the reported literal counterexample. A pass with another history supplies no reproduction evidence. If coordinates differ, replay the literal history through the shared oracle checker.

Read the shared rules in docs/misfits-survey-session-prompts-2026-10-30.md or the gist preamble: https://gist.github.com/KyleAMathews/75bbadfbc449d798c9f0b9691a540406. Use the handoff guide for evidence fetch instructions. If evidence is missing, record that fact once. Continue supported investigation from issue reports and current main. Keep unavailable historical claims unverified. Do not invent historical results or bypass required receiving-run admission.

Investigate TanStack/db #900/#1526. Distinguish local durable success, optimistic settlement and server confirmation; establish which boundary the PowerSync adapter actually promises. Build a real receiving witness with delayed confirmation, rejection and restart where supported. Do not treat local persistence as backend acknowledgment. Repair violated existing promises after oracle RED; keep stronger server-confirmation capabilities as feature/contract questions.
```

#### Additions and evidence — read after the intake ledger

Saved commands and seed/path values below are historical inputs. Check their decoded histories before interpreting results.

### B08 — Agent skills and server examples

**Primary (the task):** #1333, #1336.

**Comparison items:** none listed.

**Context only:** none listed.

```text
Primary task: #1333, #1336.
Comparison items: none listed.
Context items: none listed.

Before any reproduction, write intake-ledger.md. Cover every primary, comparison, and context issue or PR. Record its current state and latest relevant comment with URLs. Record its claimed law and current-main baseline. Record whether it may still reproduce. Mark unknowns explicitly. Do not select one issue until the ledger covers all listed items. Additions do not replace the primary task.

Saved seed/path commands are historical inputs. Check that the decoded history matches the reported literal counterexample. A pass with another history supplies no reproduction evidence. If coordinates differ, replay the literal history through the shared oracle checker.

Read the shared rules in docs/misfits-survey-session-prompts-2026-10-30.md or the gist preamble: https://gist.github.com/KyleAMathews/75bbadfbc449d798c9f0b9691a540406. Use the handoff guide for evidence fetch instructions. If evidence is missing, record that fact once. Continue supported investigation from issue reports and current main. Keep unavailable historical claims unverified. Do not invent historical results or bypass required receiving-run admission.

Investigate TanStack/db #1333/#1336. Validate the cited Electric/TanStack Start examples and agent instructions against current public APIs. Fix reproducible documentation/example defects with a runnable check where practical. Distinguish missing teaching material or new example scope from product bugs, and do not introduce an API merely to make an example easier. Deliver a small documentation patch or a precise proposal for the remaining feature work.
```

#### Additions and evidence — read after the intake ledger

Saved commands and seed/path values below are historical inputs. Check their decoded histories before interpreting results.

### B09 — Effects delivery, readiness and replay

**Primary (the task):** #1394, #2117, #2277.

**Comparison items:** none listed.

**Context only:** none listed.

```text
Primary task: #1394, #2117, #2277.
Comparison items: none listed.
Context items: none listed.

Before any reproduction, write intake-ledger.md. Cover every primary, comparison, and context issue or PR. Record its current state and latest relevant comment with URLs. Record its claimed law and current-main baseline. Record whether it may still reproduce. Mark unknowns explicitly. Do not select one issue until the ledger covers all listed items. Additions do not replace the primary task.

Saved seed/path commands are historical inputs. Check that the decoded history matches the reported literal counterexample. A pass with another history supplies no reproduction evidence. If coordinates differ, replay the literal history through the shared oracle checker.

Read the shared rules in docs/misfits-survey-session-prompts-2026-10-30.md or the gist preamble: https://gist.github.com/KyleAMathews/75bbadfbc449d798c9f0b9691a540406. Use the handoff guide for evidence fetch instructions. If evidence is missing, record that fact once. Continue supported investigation from issue reports and current main. Keep unavailable historical claims unverified. Do not invent historical results or bypass required receiving-run admission.

Investigate TanStack/db #1394/#2117 and PR #2277. Map initial delivery, readiness, replay, handler completion and disposal to their existing oracle owners. Exercise public Effect observations under partial source commits and failures while preserving complete-result barriers. Read the latest raw-publication decision and coordinate P4/P5 before shared edits. Treat durable-cursor delivery in #1394 as a separate capability unless existing authority entails it. Deliver remaining bugs and coverage gaps separately from new delivery semantics.
```

#### Additions and evidence — read after the intake ledger

Saved commands and seed/path values below are historical inputs. Check their decoded histories before interpreting results.

### B10 — Electric write confirmation and optimism

**Primary (the task):** #337, #1602, #2120, #2244, #2304.

**Comparison items:** none listed.

**Context only:** #2298.

```text
Primary task: #337, #1602, #2120, #2244, #2304.
Comparison items: none listed.
Context items: #2298.

Before any reproduction, write intake-ledger.md. Cover every primary, comparison, and context issue or PR. Record its current state and latest relevant comment with URLs. Record its claimed law and current-main baseline. Record whether it may still reproduce. Mark unknowns explicitly. Do not select one issue until the ledger covers all listed items. Additions do not replace the primary task.

Saved seed/path commands are historical inputs. Check that the decoded history matches the reported literal counterexample. A pass with another history supplies no reproduction evidence. If coordinates differ, replay the literal history through the shared oracle checker.

Read the shared rules in docs/misfits-survey-session-prompts-2026-10-30.md or the gist preamble: https://gist.github.com/KyleAMathews/75bbadfbc449d798c9f0b9691a540406. Use the handoff guide for evidence fetch instructions. If evidence is missing, record that fact once. Continue supported investigation from issue reports and current main. Keep unavailable historical claims unverified. Do not invent historical results or bypass required receiving-run admission.

Investigate TanStack/db #337/#1602/#2120/#2244. Establish the adapter's transaction confirmation and optimistic handoff laws. Distinguish promise settlement, source acceptance, applied visibility and provider confirmation. Generate reordered/delayed confirmations and failure histories through the actual Electric boundary. Do not redo merged PR #2298; verify whether it already covers any claim. Deliver current defects with receiving REDs and a separate list of stronger requested confirmation policies.
```

#### Additions and evidence — read after the intake ledger

Saved commands and seed/path values below are historical inputs. Check their decoded histories before interpreting results.

### B11 — Framework SSR and hydration

**Primary (the task):** #1963, #1964, #1965, #2322, #2323.

**Comparison items:** none listed.

**Context only:** #2334.

```text
Primary task: #1963, #1964, #1965, #2322, #2323.
Comparison items: none listed.
Context items: #2334.

Before any reproduction, write intake-ledger.md. Cover every primary, comparison, and context issue or PR. Record its current state and latest relevant comment with URLs. Record its claimed law and current-main baseline. Record whether it may still reproduce. Mark unknowns explicitly. Do not select one issue until the ledger covers all listed items. Additions do not replace the primary task.

Saved seed/path commands are historical inputs. Check that the decoded history matches the reported literal counterexample. A pass with another history supplies no reproduction evidence. If coordinates differ, replay the literal history through the shared oracle checker.

Read the shared rules in docs/misfits-survey-session-prompts-2026-10-30.md or the gist preamble: https://gist.github.com/KyleAMathews/75bbadfbc449d798c9f0b9691a540406. Use the handoff guide for evidence fetch instructions. If evidence is missing, record that fact once. Continue supported investigation from issue reports and current main. Keep unavailable historical claims unverified. Do not invent historical results or bypass required receiving-run admission.

Investigate TanStack/db #1963 (Vue), #1964 (Solid), #1965 (Angular). Read the shared framework conformance contract and each receiving driver. Separate an already promised SSR/hydration behavior from support that would be new. For existing promises, exercise server snapshot, client hydration, query identity and disposal on each actual framework path; one framework's scheduling cut proves nothing about another. Deliver per-framework evidence and the smallest common repair, if justified.
```

#### Additions and evidence — read after the intake ledger

Saved commands and seed/path values below are historical inputs. Check their decoded histories before interpreting results.

#2334 is a separate core observer cleanup/restart witness coordinated by B23. Its empty hydration seed establishes no server hydration or framework-adapter failure; keep that distinction when sharing hydration-oracle evidence.

### B12 — Offline subset coverage and readiness

**Primary (the task):** #2102, #2211, #2284.

**Comparison items:** none listed.

**Context only:** none listed.

```text
Primary task: #2102, #2211, #2284.
Comparison items: none listed.
Context items: none listed.

Before any reproduction, write intake-ledger.md. Cover every primary, comparison, and context issue or PR. Record its current state and latest relevant comment with URLs. Record its claimed law and current-main baseline. Record whether it may still reproduce. Mark unknowns explicitly. Do not select one issue until the ledger covers all listed items. Additions do not replace the primary task.

Saved seed/path commands are historical inputs. Check that the decoded history matches the reported literal counterexample. A pass with another history supplies no reproduction evidence. If coordinates differ, replay the literal history through the shared oracle checker.

Read the shared rules in docs/misfits-survey-session-prompts-2026-10-30.md or the gist preamble: https://gist.github.com/KyleAMathews/75bbadfbc449d798c9f0b9691a540406. Use the handoff guide for evidence fetch instructions. If evidence is missing, record that fact once. Continue supported investigation from issue reports and current main. Keep unavailable historical claims unverified. Do not invent historical results or bypass required receiving-run admission.

Investigate TanStack/db #2102/#2211/#2284. Determine what persisted rows and coverage evidence authorize while offline, and what readiness promises on reconnect. Separate authoritative coverage from rows merely present in cache. Exercise absent/partial/complete persisted coverage, restart and late source answers through the actual persistence wrapper. Coordinate P3 on shared owners. Repair accepted-law violations after RED; record any new offline availability/readiness policy as a separate decision.
```

#### Additions and evidence — read after the intake ledger

Saved commands and seed/path values below are historical inputs. Check their decoded histories before interpreting results.

### B13 — Relation filters and join acquisition

**Primary (the task):** #2123, #2124, #2130, #2241, #2242.

**Comparison items:** none listed.

**Context only:** none listed.

```text
Primary task: #2123, #2124, #2130, #2241, #2242.
Comparison items: none listed.
Context items: none listed.

Before any reproduction, write intake-ledger.md. Cover every primary, comparison, and context issue or PR. Record its current state and latest relevant comment with URLs. Record its claimed law and current-main baseline. Record whether it may still reproduce. Mark unknowns explicitly. Do not select one issue until the ledger covers all listed items. Additions do not replace the primary task.

Saved seed/path commands are historical inputs. Check that the decoded history matches the reported literal counterexample. A pass with another history supplies no reproduction evidence. If coordinates differ, replay the literal history through the shared oracle checker.

Read the shared rules in docs/misfits-survey-session-prompts-2026-10-30.md or the gist preamble: https://gist.github.com/KyleAMathews/75bbadfbc449d798c9f0b9691a540406. Use the handoff guide for evidence fetch instructions. If evidence is missing, record that fact once. Continue supported investigation from issue reports and current main. Keep unavailable historical claims unverified. Do not invent historical results or bypass required receiving-run admission.

Investigate TanStack/db #2123/#2124/#2130/#2241/#2242. First isolate the reported hang from proposed relation-filter paging/hint capabilities. Read live-query architecture and existing join/acquisition owners. Construct the smallest legal join history that distinguishes missing demand, insufficient source evidence and queued-answer starvation; do not assume H02 explains it. Coordinate P1/P2/P4 before editing shared machinery. Deliver accepted-law bugs and new acquisition/paging features separately, with an actual receiving witness for any repair.
```

#### Additions and evidence — read after the intake ledger

Saved commands and seed/path values below are historical inputs. Check their decoded histories before interpreting results.

### B14 — On-demand optimism and preload visibility

**Primary (the task):** #2148, #2169, #2184.

**Comparison items:** none listed.

**Context only:** none listed.

```text
Primary task: #2148, #2169, #2184.
Comparison items: none listed.
Context items: none listed.

Before any reproduction, write intake-ledger.md. Cover every primary, comparison, and context issue or PR. Record its current state and latest relevant comment with URLs. Record its claimed law and current-main baseline. Record whether it may still reproduce. Mark unknowns explicitly. Do not select one issue until the ledger covers all listed items. Additions do not replace the primary task.

Saved seed/path commands are historical inputs. Check that the decoded history matches the reported literal counterexample. A pass with another history supplies no reproduction evidence. If coordinates differ, replay the literal history through the shared oracle checker.

Read the shared rules in docs/misfits-survey-session-prompts-2026-10-30.md or the gist preamble: https://gist.github.com/KyleAMathews/75bbadfbc449d798c9f0b9691a540406. Use the handoff guide for evidence fetch instructions. If evidence is missing, record that fact once. Continue supported investigation from issue reports and current main. Keep unavailable historical claims unverified. Do not invent historical results or bypass required receiving-run admission.

Investigate TanStack/db #2148/#2169/#2184. Distinguish raw optimistic visibility, live-query acquisition completeness and preload/window publication. Preserve the maintainer's existing window-change barrier when an optimistic edit removes a row during loading. Generate mutation/settlement interleavings at those distinct public cuts using existing owners. Coordinate P1/P4. Deliver a current accepted-law failure or an explicit feature question; do not weaken the barrier to obtain a desired immediate row update.
```

#### Additions and evidence — read after the intake ledger

Saved commands and seed/path values below are historical inputs. Check their decoded histories before interpreting results.

### B15 — Failed ordered requests and recovery

**Primary (the task):** #2165, #2191, #2315, #2318.

**Comparison items:** none listed.

**Context only:** none listed.

```text
Primary task: #2165, #2191, #2315, #2318.
Comparison items: none listed.
Context items: none listed.

Before any reproduction, write intake-ledger.md. Cover every primary, comparison, and context issue or PR. Record its current state and latest relevant comment with URLs. Record its claimed law and current-main baseline. Record whether it may still reproduce. Mark unknowns explicitly. Do not select one issue until the ledger covers all listed items. Additions do not replace the primary task.

Saved seed/path commands are historical inputs. Check that the decoded history matches the reported literal counterexample. A pass with another history supplies no reproduction evidence. If coordinates differ, replay the literal history through the shared oracle checker.

Read the shared rules in docs/misfits-survey-session-prompts-2026-10-30.md or the gist preamble: https://gist.github.com/KyleAMathews/75bbadfbc449d798c9f0b9691a540406. Use the handoff guide for evidence fetch instructions. If evidence is missing, record that fact once. Continue supported investigation from issue reports and current main. Keep unavailable historical claims unverified. Do not invent historical results or bypass required receiving-run admission.

Investigate TanStack/db #2165/#2191/#2315. Map the accepted failure, old-result retention, explicit retry/window-change and receipt rules. P4 owns #2315's pending-move error-attribution investigation: include comment 6579843541's rejection-only witness (seed 112008075, path 431:3:2:3:3:6) alongside its rejected/throwing include-load witnesses and coordinate before model edits; similarity to the earlier R03 failure is not proof of a common cause. Reproduce current behavior with failed own receipts, obsolete late answers and a genuine quiet recovery cut. Coordinate P1/P4/P7 and reuse their primary owners; source health is not the same as an individual replay's error. Deliver exact current failures and oracle-first repairs, separating optional automatic recovery policy from required recovery behavior.
```

#### Additions and evidence — read after the intake ledger

Saved commands and seed/path values below are historical inputs. Check their decoded histories before interpreting results.

### B16 — Query acquisition ownership and cancellation

**Primary (the task):** #2160, #2162, #2188, #2352, #2353.

**Comparison items:** none listed.

**Context only:** #1935, #2268, #2354.

```text
Primary task: #2160, #2162, #2188, #2352, #2353.
Comparison items: none listed.
Context items: #1935, #2268, #2354.

Before any reproduction, write intake-ledger.md. Cover every primary, comparison, and context issue or PR. Record its current state and latest relevant comment with URLs. Record its claimed law and current-main baseline. Record whether it may still reproduce. Mark unknowns explicitly. Do not select one issue until the ledger covers all listed items. Additions do not replace the primary task.

Saved seed/path commands are historical inputs. Check that the decoded history matches the reported literal counterexample. A pass with another history supplies no reproduction evidence. If coordinates differ, replay the literal history through the shared oracle checker.

Read the shared rules in docs/misfits-survey-session-prompts-2026-10-30.md or the gist preamble: https://gist.github.com/KyleAMathews/75bbadfbc449d798c9f0b9691a540406. Use the handoff guide for evidence fetch instructions. If evidence is missing, record that fact once. Continue supported investigation from issue reports and current main. Keep unavailable historical claims unverified. Do not invent historical results or bypass required receiving-run admission.

Investigate TanStack/db #2160/#2162/#2188. Separate logical demand, acquisition lease, observer lease, unload and transport cancellation. Exercise overlapping owners, release/reacquire, synchronous rejection, cleanup and late completion with the actual QueryClient adapter. Prove remaining leases preserve rows and released work cannot gate current readiness. Coordinate ordered/replay writers before shared oracle edits. Deliver existing ownership/cancellation bugs separately from stronger transport-cancellation guarantees.
```

#### Additions and evidence — read after the intake ledger

Saved commands and seed/path values below are historical inputs. Check their decoded histories before interpreting results.

**November 4 additions:** [#2352](https://github.com/TanStack/db/issues/2352) concerns configured freshness on a second acquisition of an identical populated subset. [#2353](https://github.com/TanStack/db/issues/2353) concerns rows lost when the old ordered full-source fallback owner releases while its replacement holds the same subset. Keep these as separate bug judgments. [Intake and controls](misfits-survey/supplement-2352-2353.md). B16 owns both; B18/P1/P5 coordinate #2353's ordered receiving path.

```text
Primary task: #2160, #2162, #2188, #2352, #2353.
Comparison items: none listed.
Context items: #1935, #2268, #2354.

Before any reproduction, write intake-ledger.md. Cover every primary, comparison, and context issue or PR. Record its current state and latest relevant comment with URLs. Record its claimed law and current-main baseline. Record whether it may still reproduce. Mark unknowns explicitly. Do not select one issue until the ledger covers all listed items. Additions do not replace the primary task.

Saved seed/path commands are historical inputs. Check that the decoded history matches the reported literal counterexample. A pass with another history supplies no reproduction evidence. If coordinates differ, replay the literal history through the shared oracle checker.

Read the shared rules in docs/misfits-survey-session-prompts-2026-10-30.md or the gist preamble: https://gist.github.com/KyleAMathews/75bbadfbc449d798c9f0b9691a540406. Use the handoff guide for evidence fetch instructions. If evidence is missing, record that fact once. Continue supported investigation from issue reports and current main. Keep unavailable historical claims unverified. Do not invent historical results or bypass required receiving-run admission.

Investigate #2352 as a reported freshness bug at the existing Query DB shared-subset acquisition boundary. Establish the accepted Query Collection contract for acquiring an already populated identical subset: Query sharing is intended, and a logical acquisition is not automatically a new QueryObserver mount. Reproduce the supplied on-demand staleTime:0 case on recorded current main before changing production; observe actual fetches, applied source rows and both old/new live queries after the backend adds a row. Verify configured refetchOnMount true/false/always/function, stale/fresh results, enabled behavior, already-fetching and concurrent-acquisition deduplication, and the reported staleTime:null control against the supported contract. Focus/reconnect and empty/populated controls distinguish this case. The reporter's local patch is testimony, not a selected design. Extend the primary acquisition/freshness oracle with independent freshness/time/backend state as needed and legal generated reacquisition histories; show measured reach, parent RED, repaired GREEN and a hostile mutant at the applied-row/public-query checkpoint for any fix. Preserve exact-request sharing, ownership, application receipts and cancellation. Keep #1935's broader subscribe/lifetime proposal distinct and classify any genuine contract gap before approving a new promise. The Node witness does not prove React Native/Hermes receiving; record that limit. No new API is requested by this task.
```

```text
Primary task: #2160, #2162, #2188, #2352, #2353.
Comparison items: none listed.
Context items: #1935, #2268, #2354.

Before any reproduction, write intake-ledger.md. Cover every primary, comparison, and context issue or PR. Record its current state and latest relevant comment with URLs. Record its claimed law and current-main baseline. Record whether it may still reproduce. Mark unknowns explicitly. Do not select one issue until the ledger covers all listed items. Additions do not replace the primary task.

Saved seed/path commands are historical inputs. Check that the decoded history matches the reported literal counterexample. A pass with another history supplies no reproduction evidence. If coordinates differ, replay the literal history through the shared oracle checker.

Read the shared rules in docs/misfits-survey-session-prompts-2026-10-30.md or the gist preamble: https://gist.github.com/KyleAMathews/75bbadfbc449d798c9f0b9691a540406. Use the handoff guide for evidence fetch instructions. If evidence is missing, record that fact once. Continue supported investigation from issue reports and current main. Keep unavailable historical claims unverified. Do not invent historical results or bypass required receiving-run admission.

Investigate #2353 as a reported remaining-owner row-retention bug through the actual QueryClient adapter and ordered full-source fallback. Reproduce the external Node witness on recorded current main after inspecting its backend; observe source rows and both windows across new subscribe, shared full-source acquisition and old release. Generate overlapping owner/release/reacquire histories, both sort directions, NULL page-end and locale-sort fallback, matching index controls, nonidentical subsets, unordered overlaps and release-before-new-acquire. Establish the independent ownership law and whether core ordered release or Query DB lease/unload handling violates it before choosing a repair. Preserve valid full-source fallback, remaining-owner rows, atomic window publication and existing transfer/work budgets; avoiding NULL or locale order does not close the ownership report. Extend the primary acquisition lifecycle oracle and add the ordered receiving witness through shared model/driver/comparison as required. Show parent RED, measured generated reach, repaired GREEN and a hostile wrong-owner-release mutant. Coordinate B18/P1/P5 on shared owners and #2160; keep #2352's freshness rule and #2268's work-count question separate, with no common-cause or closure inference from their links. Node/core GREEN does not prove Vue binding receiving; retain that limit. PR #2354 is handled elsewhere and is outside this assignment.
```

### B17 — Persisted legacy-owner migration

**Primary (the task):** #2180, #2181.

**Comparison items:** none listed.

**Context only:** none listed.

```text
Primary task: #2180, #2181.
Comparison items: none listed.
Context items: none listed.

Before any reproduction, write intake-ledger.md. Cover every primary, comparison, and context issue or PR. Record its current state and latest relevant comment with URLs. Record its claimed law and current-main baseline. Record whether it may still reproduce. Mark unknowns explicitly. Do not select one issue until the ledger covers all listed items. Additions do not replace the primary task.

Saved seed/path commands are historical inputs. Check that the decoded history matches the reported literal counterexample. A pass with another history supplies no reproduction evidence. If coordinates differ, replay the literal history through the shared oracle checker.

Read the shared rules in docs/misfits-survey-session-prompts-2026-10-30.md or the gist preamble: https://gist.github.com/KyleAMathews/75bbadfbc449d798c9f0b9691a540406. Use the handoff guide for evidence fetch instructions. If evidence is missing, record that fact once. Continue supported investigation from issue reports and current main. Keep unavailable historical claims unverified. Do not invent historical results or bypass required receiving-run admission.

Investigate TanStack/db #2180/#2181. Establish which persisted formats and legacy ownership records current compatibility promises cover. Build real old-format inputs and observe migration, retained rows, new ownership and restart through the receiving persistence/Query boundary. Distinguish unsupported old state from data loss or incorrect ownership under a supported migration. Coordinate P3/P6. Deliver a bounded compatibility matrix and oracle-first repair where the accepted migration law fails.
```

#### Additions and evidence — read after the intake ledger

Saved commands and seed/path values below are historical inputs. Check their decoded histories before interpreting results.

### B18 — Remaining ordered loading lifetimes

**Primary (the task):** #2223, #2260, #2268, #2296.

**Comparison items:** none listed.

**Context only:** #2353, #2352, #2346, #2335, #2302, #2214, #2222.

```text
Primary task: #2223, #2260, #2268, #2296.
Comparison items: none listed.
Context items: #2353, #2352, #2346, #2335, #2302, #2214, #2222.

Before any reproduction, write intake-ledger.md. Cover every primary, comparison, and context issue or PR. Record its current state and latest relevant comment with URLs. Record its claimed law and current-main baseline. Record whether it may still reproduce. Mark unknowns explicitly. Do not select one issue until the ledger covers all listed items. Additions do not replace the primary task.

Saved seed/path commands are historical inputs. Check that the decoded history matches the reported literal counterexample. A pass with another history supplies no reproduction evidence. If coordinates differ, replay the literal history through the shared oracle checker.

Read the shared rules in docs/misfits-survey-session-prompts-2026-10-30.md or the gist preamble: https://gist.github.com/KyleAMathews/75bbadfbc449d798c9f0b9691a540406. Use the handoff guide for evidence fetch instructions. If evidence is missing, record that fact once. Continue supported investigation from issue reports and current main. Keep unavailable historical claims unverified. Do not invent historical results or bypass required receiving-run admission.

Triage the remainder of TanStack/db #2214/#2222/#2223/#2260/#2268/#2296 with the ordered-loading pilot report. P1 owns #2214 algorithm work and P5 owns #2222/PR #2302: contribute witnesses instead of duplicating edits. The pilot classified the original #2296 investigation as an oracle continuation-classifier defect, not an established request leak. The November 3 comment adds a distinct baseline-reproducible oracle failure; that earlier diagnosis does not classify the new trace or establish a shared cause; #2268's exact traces were already fixed. Refresh those findings. Investigate obsolete later-page receiving for #2223 and distinguish #2260's stronger work policy from accepted limits. Deliver an item-level current disposition and repair only demonstrated remaining defects.
```

#### Additions and evidence — read after the intake ledger

Saved commands and seed/path values below are historical inputs. Check their decoded histories before interpreting results.

**November 4 coordination:** [#2353](https://github.com/TanStack/db/issues/2353) is primarily B16’s overlapping-owner row-retention investigation. Contribute the actual ordered full-source fallback receiving path for NULL/locale triggers and preserve existing fallback/work/publication laws. Do not duplicate B16 model edits, assume a shared cause with #2268, or treat #2352 freshness as the same bug.

Start with the [ordered-loading pilot][loading-pilot].

**November 3 #2296 update:** [Comment 6617143865](https://github.com/TanStack/db/issues/2296#issuecomment-6617143865) adds a second request-authority counterexample, reportedly reproducible on both #2346 and recorded main. Keep the earlier pilot diagnosis limited to its original witness. [Captured update](misfits-survey/updates/issue-2296-comment-6617143865.md). The issue remains in B18; no new item, common cause or public resource leak is established.

```text
Primary task: #2223, #2260, #2268, #2296.
Comparison items: none listed.
Context items: #2353, #2352, #2346, #2335, #2302, #2214, #2222.

Before any reproduction, write intake-ledger.md. Cover every primary, comparison, and context issue or PR. Record its current state and latest relevant comment with URLs. Record its claimed law and current-main baseline. Record whether it may still reproduce. Mark unknowns explicitly. Do not select one issue until the ledger covers all listed items. Additions do not replace the primary task.

Saved seed/path commands are historical inputs. Check that the decoded history matches the reported literal counterexample. A pass with another history supplies no reproduction evidence. If coordinates differ, replay the literal history through the shared oracle checker.

Read the shared rules in docs/misfits-survey-session-prompts-2026-10-30.md or the gist preamble: https://gist.github.com/KyleAMathews/75bbadfbc449d798c9f0b9691a540406. Use the handoff guide for evidence fetch instructions. If evidence is missing, record that fact once. Continue supported investigation from issue reports and current main. Keep unavailable historical claims unverified. Do not invent historical results or bypass required receiving-run admission.

Investigate both #2296 histories through the existing ordered-loader.request-authority owner in packages/db/tests/query/ordered-source-loader-state-oracle.test.ts. For the November 3 witness, replay seed -416164704, path 2540:0:3:3:8:8:12:12:13 on a recorded fresh baseline; compare with the comment's reported main 1443dc92e5417394acbdc98b782caa9802848ce6 and PR head 5911d5e00af0d947b36ac739f73016a6129d38cf. The new trace reaches checkAuthorityCase with requests [2,3] still held after authoritative request 4 succeeds, with joined work and releaseReenters. Retain it separately from the original requests-[3,4]-after-5 trace and the pilot's continuation-classifier diagnosis. Establish the covering-read authority and legal observation checkpoint while joined work defers a reentrant pass, then determine whether production retirement, the oracle's coverage premise or its checkpoint is wrong. A baseline oracle assertion failure is not proof of incorrect public rows or a measured production resource leak. Exercise the corresponding real-subscription receiving path before claiming public resource closure. Preserve both shared-model inputs and extend nearby generated joined/reentrant histories with controls; measure reach, obtain RED/GREEN and hostile-mutant rejection for the actual repair, and retain existing budgets and comparisons. Do not lower coverage or treat later green random CI or #2346's disposition as closure. Coordinate P1/P5 on shared loader ownership; deliver separate dispositions for the two traces and their public receiving limits.
```

[#2335](https://github.com/TanStack/db/issues/2335) adds a cursor/two-term source-coverage witness under P1. Coordinate its existing ordered-prefix oracle with P1/P5; the reported #2302 CI context does not establish that PR as its cause. [Targeted intake](misfits-survey/supplement-2334-2335.md).

### B19 — Oracle ownership and contribution enforcement

**Primary (the task):** #2234, #2264.

**Comparison items:** none listed.

**Context only:** none listed.

```text
Primary task: #2234, #2264.
Comparison items: none listed.
Context items: none listed.

Before any reproduction, write intake-ledger.md. Cover every primary, comparison, and context issue or PR. Record its current state and latest relevant comment with URLs. Record its claimed law and current-main baseline. Record whether it may still reproduce. Mark unknowns explicitly. Do not select one issue until the ledger covers all listed items. Additions do not replace the primary task.

Saved seed/path commands are historical inputs. Check that the decoded history matches the reported literal counterexample. A pass with another history supplies no reproduction evidence. If coordinates differ, replay the literal history through the shared oracle checker.

Read the shared rules in docs/misfits-survey-session-prompts-2026-10-30.md or the gist preamble: https://gist.github.com/KyleAMathews/75bbadfbc449d798c9f0b9691a540406. Use the handoff guide for evidence fetch instructions. If evidence is missing, record that fact once. Continue supported investigation from issue reports and current main. Keep unavailable historical claims unverified. Do not invent historical results or bypass required receiving-run admission.

Investigate TanStack/db #2234/#2264. Map each requested contribution/evidence rule to current documentation, lint/hook enforcement and CI. Find concrete false-green or false-positive inputs; distinguish a broken existing rule from proposed stricter governance. Use small calibration fixtures and the actual receiving hook/lint path. Deliver the smallest enforcement/documentation correction and its limits without suppressing oracle lint rules or inventing a new approval ceremony.
```

#### Additions and evidence — read after the intake ledger

Saved commands and seed/path values below are historical inputs. Check their decoded histories before interpreting results.

### B20 — Declared reach and seed replay reliability

**Primary (the task):** #2287, #2289, #2290, #2329, #2347.

**Comparison items:** none listed.

**Context only:** #2346, #2334.

```text
Primary task: #2287, #2289, #2290, #2329, #2347.
Comparison items: none listed.
Context items: #2346, #2334.

Before any reproduction, write intake-ledger.md. Cover every primary, comparison, and context issue or PR. Record its current state and latest relevant comment with URLs. Record its claimed law and current-main baseline. Record whether it may still reproduce. Mark unknowns explicitly. Do not select one issue until the ledger covers all listed items. Additions do not replace the primary task.

Saved seed/path commands are historical inputs. Check that the decoded history matches the reported literal counterexample. A pass with another history supplies no reproduction evidence. If coordinates differ, replay the literal history through the shared oracle checker.

Read the shared rules in docs/misfits-survey-session-prompts-2026-10-30.md or the gist preamble: https://gist.github.com/KyleAMathews/75bbadfbc449d798c9f0b9691a540406. Use the handoff guide for evidence fetch instructions. If evidence is missing, record that fact once. Continue supported investigation from issue reports and current main. Keep unavailable historical claims unverified. Do not invent historical results or bypass required receiving-run admission.

Investigate TanStack/db #2287/#2289/#2329 and PR #2290. #2329 records a Browser SQLite multi-tab campaign that missed reset-abandoned recovery during final catch-up after all property comparisons passed. At main 85392bd1d349aa3bb77c9c11ffba671f0b2d2a84, CI run 41453553336/job 125304468568 reached reset abandonment 14 times, source failure 5 times and final-catch-up recovery 0 times; the fixed campaign and both recovery regressions passed. No failing CI seed/path is available and the local replay did not complete. Construct the reset/final-catch-up interaction with generated variations and nearby controls through the existing model, driver and comparison; preserve the 80-run budget, reach minimum, fixed/random parity and fixed regressions. Demonstrate actual reach and sensitivity before claiming the grammar repair. Coordinate P3 on the Browser SQLite/Electric receiving path; this CI miss establishes no shared production cause with its data-correctness reports. Verify that declared reach measures actual intended transitions, and saved seeds/paths select and execute the same shared judgment. Distinguish original histories, shrinks, fixed examples and zero-test selection. Calibrate with a missed premise and a known wrong observation. Deliver a minimal runner/instrument repair plus replay evidence; do not count bookkeeping events as semantic reach or lower campaign budgets.
```

#### Additions and evidence — read after the intake ledger

Saved commands and seed/path values below are historical inputs. Check their decoded histories before interpreting results.

**November 3 addition:** [#2347](https://github.com/TanStack/db/issues/2347) reports a sampling gap in Electric SDK snapshot retry reach. No row/health comparison failed. This direct Collection/ShapeStream driver does not instantiate the shared observer; PR #2346 is CI context, not an established cause.

```text
Primary task: #2287, #2289, #2290, #2329, #2347.
Comparison items: none listed.
Context items: #2346, #2334.

Before any reproduction, write intake-ledger.md. Cover every primary, comparison, and context issue or PR. Record its current state and latest relevant comment with URLs. Record its claimed law and current-main baseline. Record whether it may still reproduce. Mark unknowns explicitly. Do not select one issue until the ledger covers all listed items. Additions do not replace the primary task.

Saved seed/path commands are historical inputs. Check that the decoded history matches the reported literal counterexample. A pass with another history supplies no reproduction evidence. If coordinates differ, replay the literal history through the shared oracle checker.

Read the shared rules in docs/misfits-survey-session-prompts-2026-10-30.md or the gist preamble: https://gist.github.com/KyleAMathews/75bbadfbc449d798c9f0b9691a540406. Use the handoff guide for evidence fetch instructions. If evidence is missing, record that fact once. Continue supported investigation from issue reports and current main. Keep unavailable historical claims unverified. Do not invent historical results or bypass required receiving-run admission.

Investigate #2347 through the existing electric.sdk-snapshot-delivery model, SDK production driver and comparison in packages/electric-db-collection/tests/electric-sdk-delivery-oracle.property.test.ts. Replay seed -387674631 without a shrink path: path replay intentionally disables aggregate reach checks. The reported 40-history campaign misses live-outage-crossed-by-throw; the independent input grammar replay has six histories with at least five live attempts and zero fifth-attempt throws. Make required retry reach dependable through shared deterministic histories with generated variations and nearby controls in fixed/random campaigns. Measure the actual fifth SDK attempt throwing at the existing observation cut, preserve every reach requirement and the 40 generated histories per campaign, and retain wrong outage/health calibration. Verify the reported seed through the same judgment and retain exact baseline/commands/reach. A zero-reach guard failure is no production behavior RED, and a passing input-only replay is no actual SDK reach proof. Coordinate B20 instrument ownership and the Electric receiver; keep B23 observer correctness separate.
```

New CI witness: [#2329](https://github.com/TanStack/db/issues/2329), added November 2, 2026. [Intake and evidence](misfits-survey/supplement-2329.md).

[#2334](https://github.com/TanStack/db/issues/2334) separately reports that the observer hydration property is absent from the `oracle-config.ts` path-replay registry. Its current instructions pin seed `2087400494`, path `4:0:2:3` in the random campaign; environment replay selectors do not select it. B23 owns the observer/model correctness question. Coordinate any replay-registry correction with that owner, preserve the original budget and shared judgment, and verify actual selection rather than counting a passing zero-test invocation.

### B21 — Test CPU time, waits and timeouts

**Primary (the task):** #2238, #2274, #2275, #2276.

**Comparison items:** none listed.

**Context only:** none listed.

```text
Primary task: #2238, #2274, #2275, #2276.
Comparison items: none listed.
Context items: none listed.

Before any reproduction, write intake-ledger.md. Cover every primary, comparison, and context issue or PR. Record its current state and latest relevant comment with URLs. Record its claimed law and current-main baseline. Record whether it may still reproduce. Mark unknowns explicitly. Do not select one issue until the ledger covers all listed items. Additions do not replace the primary task.

Saved seed/path commands are historical inputs. Check that the decoded history matches the reported literal counterexample. A pass with another history supplies no reproduction evidence. If coordinates differ, replay the literal history through the shared oracle checker.

Read the shared rules in docs/misfits-survey-session-prompts-2026-10-30.md or the gist preamble: https://gist.github.com/KyleAMathews/75bbadfbc449d798c9f0b9691a540406. Use the handoff guide for evidence fetch instructions. If evidence is missing, record that fact once. Continue supported investigation from issue reports and current main. Keep unavailable historical claims unverified. Do not invent historical results or bypass required receiving-run admission.

Investigate TanStack/db #2238/#2274 and PRs #2275/#2276. Profile current representative runs and identify work, scheduling waits and host/setup effects separately. Preserve oracle histories, comparisons, reach and budgets. Prefer removing redundant work or replacing unjustified waits with meaningful public checkpoints. Deliver measured before/after runtime and semantic equivalence evidence; a larger timeout alone or reduced coverage is not a performance repair. Coordinate shared host resources with native persistence runs.
```

#### Additions and evidence — read after the intake ledger

Saved commands and seed/path values below are historical inputs. Check their decoded histories before interpreting results.

### B22 — Pagination API and index configuration

**Primary (the task):** #2291, #2292, #2314, #2316, #2326.

**Comparison items:** none listed.

**Context only:** none listed.

```text
Primary task: #2291, #2292, #2314, #2316, #2326.
Comparison items: none listed.
Context items: none listed.

Before any reproduction, write intake-ledger.md. Cover every primary, comparison, and context issue or PR. Record its current state and latest relevant comment with URLs. Record its claimed law and current-main baseline. Record whether it may still reproduce. Mark unknowns explicitly. Do not select one issue until the ledger covers all listed items. Additions do not replace the primary task.

Saved seed/path commands are historical inputs. Check that the decoded history matches the reported literal counterexample. A pass with another history supplies no reproduction evidence. If coordinates differ, replay the literal history through the shared oracle checker.

Read the shared rules in docs/misfits-survey-session-prompts-2026-10-30.md or the gist preamble: https://gist.github.com/KyleAMathews/75bbadfbc449d798c9f0b9691a540406. Use the handoff guide for evidence fetch instructions. If evidence is missing, record that fact once. Continue supported investigation from issue reports and current main. Keep unavailable historical claims unverified. Do not invent historical results or bypass required receiving-run admission.

Investigate TanStack/db #2291/#2292. Demonstrate current offset/window and index-configuration capabilities through public APIs, then separate wrong existing results from requested ergonomics or new capabilities. Coordinate P1 on ordered semantics and preserve N + 2P and window barriers. Deliver a bug/feature matrix and a small executable witness for any accepted-law violation; do not redesign pagination to bypass the unresolved algorithm.
```

#### Additions and evidence — read after the intake ledger

Saved commands and seed/path values below are historical inputs. Check their decoded histories before interpreting results.

### B23 — Framework binding conformance

**Primary (the task):** #1699, #1728, #2327.

**Comparison items:** #2334.

**Context only:** #2310, #2328, #2302, #2333.

```text
Primary task: #1699, #1728, #2327.
Comparison items: #2334.
Context items: #2310, #2328, #2302, #2333.

Before any reproduction, write intake-ledger.md. Cover every primary, comparison, and context issue or PR. Record its current state and latest relevant comment with URLs. Record its claimed law and current-main baseline. Record whether it may still reproduce. Mark unknowns explicitly. Do not select one issue until the ledger covers all listed items. Additions do not replace the primary task.

Saved seed/path commands are historical inputs. Check that the decoded history matches the reported literal counterexample. A pass with another history supplies no reproduction evidence. If coordinates differ, replay the literal history through the shared oracle checker.

Read the shared rules in docs/misfits-survey-session-prompts-2026-10-30.md or the gist preamble: https://gist.github.com/KyleAMathews/75bbadfbc449d798c9f0b9691a540406. Use the handoff guide for evidence fetch instructions. If evidence is missing, record that fact once. Continue supported investigation from issue reports and current main. Keep unavailable historical claims unverified. Do not invent historical results or bypass required receiving-run admission.

Investigate TanStack/db framework-binding PRs #1699/#1728. Refresh their state, read the shared conformance contract and each receiving framework's driver, then map readiness, query identity, replacement and disposal obligations. Reproduce claimed failures on actual framework scheduling cuts; do not carry one framework's GREEN across another boundary. Coordinate B11 where hydration overlaps. Deliver current PR dispositions, missing receiving coverage and the narrow accepted-law repair, using evaluate-review for review findings and prep-pr for changes.
```

#### Additions and evidence — read after the intake ledger

Saved commands and seed/path values below are historical inputs. Check their decoded histories before interpreting results.

**November 2 addition:** [#2334](https://github.com/TanStack/db/issues/2334) is a standalone core observer lifecycle correctness witness, coordinated here rather than added to the framework cluster. With an empty hydration seed, the granular observer follows attach → ready → write b@0 → cleanup → restart → write b@0; its view stays empty where the model expects b. The report leaves observer behavior versus restarted-Collection model expectations unresolved. B11 is context only, B20 owns the separate replay-registry limit, and #2310 concerns a different raw Collection observation boundary. Keep #2328's reference/performance lead separate. [Intake and exact reproduction](misfits-survey/supplement-2334-2335.md).

```text
Primary task: #1699, #1728, #2327.
Comparison items: #2334.
Context items: #2310, #2328, #2302, #2333.

Before any reproduction, write intake-ledger.md. Cover every primary, comparison, and context issue or PR. Record its current state and latest relevant comment with URLs. Record its claimed law and current-main baseline. Record whether it may still reproduce. Mark unknowns explicitly. Do not select one issue until the ledger covers all listed items. Additions do not replace the primary task.

Saved seed/path commands are historical inputs. Check that the decoded history matches the reported literal counterexample. A pass with another history supplies no reproduction evidence. If coordinates differ, replay the literal history through the shared oracle checker.

Read the shared rules in docs/misfits-survey-session-prompts-2026-10-30.md or the gist preamble: https://gist.github.com/KyleAMathews/75bbadfbc449d798c9f0b9691a540406. Use the handoff guide for evidence fetch instructions. If evidence is missing, record that fact once. Continue supported investigation from issue reports and current main. Keep unavailable historical claims unverified. Do not invent historical results or bypass required receiving-run admission.

Investigate #2334 through the existing observer hydration model, production driver and comparison. Also retain the older unfiled October 29 signal in docs/misfits-survey/intake/observer-hydration-cleanup-restart-2026-10-29/signal.md in the survey worktree: seed -843508256, printed path 88:0:0:3:9:12:17, crash and two cleanup/restart cycles. These are distinct neighboring histories under one owner, with no established common cause. Establish the authority for observer responsibility across Collection cleanup/restart before changing production or the model. Replay seed 2087400494, path 4:0:2:3 using the report's explicit random-campaign pin; its property is currently absent from the path-replay registry, so do not assume environment selectors execute it. Preserve the campaign budget and retain the shrunk history as shared-model input. Generate nearby legal lifecycle histories to distinguish stale observer attachment from a wrong model lifetime expectation, and demonstrate a hostile-mutant failure at the same public observer checkpoint for any repair. No receiving framework or hydration-seed claim follows from this empty-seed core witness. Coordinate B20 on registration and P4/P5 on Collection boundaries; #2302/#2333 are reported baseline/CI context, not proof of a common cause or closure. Deliver the production-versus-model disposition and instrument gap separately.
```

## November 2 release follow-ups — #2337–#2342

**Fresh revalidation completed:** read [the executed main results](misfits-investigations/revalidate-2337-2342/summary.md) and each issue report before starting. Frozen origin/main is `baabf57a0f110d57ad9bb7b81148466b18fbe0d1`; all six issues remain open and have public updates. Use these results instead of historical RED counts. #2337 runtime empty-record cases and #2338 union-spread cases now pass within their retained scopes. #2339/#2340 have installed receiving REDs. #2341 remains a durable observation gap. #2342 has an actual documented callback receipt violation plus its two still-missing generated receiving cuts; no shipped-adapter-wide bug is established. Preserve source/Bundler versus installed/NodeNext distinctions and all passing controls.

[Targeted classification and evidence](misfits-survey/supplement-2337-2342.md). These are current-main revalidation and instrument tasks, with no new product feature approval or current production-failure verdict. B24–B26 were reserved by the earlier refresh; B25 is made explicit below. These are prompts, not created chats.

### B27 — #2337: Subquery literals / undefined and empty records

**Primary (the task):** #2337.

**Comparison items:** none listed.

**Context only:** #2171, #2187.

```text
Primary task: #2337.
Comparison items: none listed.
Context items: #2171, #2187.

Before any reproduction, write intake-ledger.md. Cover every primary, comparison, and context issue or PR. Record its current state and latest relevant comment with URLs. Record its claimed law and current-main baseline. Record whether it may still reproduce. Mark unknowns explicitly. Do not select one issue until the ledger covers all listed items. Additions do not replace the primary task.

Saved seed/path commands are historical inputs. Check that the decoded history matches the reported literal counterexample. A pass with another history supplies no reproduction evidence. If coordinates differ, replay the literal history through the shared oracle checker.

Read the shared rules in docs/misfits-survey-session-prompts-2026-10-30.md or the gist preamble: https://gist.github.com/KyleAMathews/75bbadfbc449d798c9f0b9691a540406. Use the handoff guide for evidence fetch instructions. If evidence is missing, record that fact once. Continue supported investigation from issue reports and current main. Keep unavailable historical claims unverified. Do not invent historical results or bypass required receiving-run admission.

Revalidate #2337 from the retained PR #2171 release deferral record. Restore the complete dependent literal model/driver/runner/factory slices together from the accepted local snapshot codex/rc-oracle-followup at db38b4e009146af53e46aeeef3206269f5968af8 and verify its manifest; do not assume a public branch exists. Establish the law and current behavior separately for explicit undefined, missing properties, null, empty records and absent joined rows. Retain root, QueryRef, correlated runtime and source-public type checkpoints and positive controls. Historical 18/72/280 RED counts are not current validation. For surviving defects extend generated distinguishing cases, measure reach, show parent RED, repaired GREEN and a hostile mutant at the intended comparison; keep runtime and type claims separate. Coordinate B25 on shared query/type owners, preserving #2187 as a separate remote-wire question.
```

#### Additions and evidence — read after the intake ledger

Saved commands and seed/path values below are historical inputs. Check their decoded histories before interpreting results.

### B25 — #2338: Callback metadata / static receiving types

**Primary (the task):** #2338.

**Comparison items:** none listed.

**Context only:** #2312, #2340, #2337.

```text
Primary task: #2338.
Comparison items: none listed.
Context items: #2312, #2340, #2337.

Before any reproduction, write intake-ledger.md. Cover every primary, comparison, and context issue or PR. Record its current state and latest relevant comment with URLs. Record its claimed law and current-main baseline. Record whether it may still reproduce. Mark unknowns explicitly. Do not select one issue until the ledger covers all listed items. Additions do not replace the primary task.

Saved seed/path commands are historical inputs. Check that the decoded history matches the reported literal counterexample. A pass with another history supplies no reproduction evidence. If coordinates differ, replay the literal history through the shared oracle checker.

Read the shared rules in docs/misfits-survey-session-prompts-2026-10-30.md or the gist preamble: https://gist.github.com/KyleAMathews/75bbadfbc449d798c9f0b9691a540406. Use the handoff guide for evidence fetch instructions. If evidence is missing, record that fact once. Continue supported investigation from issue reports and current main. Keep unavailable historical claims unverified. Do not invent historical results or bypass required receiving-run admission.

Revalidate #2338 through the existing virtual-row-fields receiving-type owner, restoring its model, support and appended generated-source receiver together from the retained release record. Distinguish direct-source metadata from newly authored projected shapes and retain required metadata on legitimate published source/read results. Preserve actual observed callback types, ordinary diagnostics, source controls, union/discriminant cases, generated reach and calibration; a source annotation hiding a leak is not a repair. Treat the historical 672/12 REDs, 6,240 states and 43 controls as baseline testimony, not a current run. Runtime repair #2312 does not discharge source-public, installed or framework static receiving. For surviving defects show parent RED, GREEN and a hostile type mutation rejected by the same independent law. Coordinate B06/#2340 and B27/#2337 without merging their distinct contracts.
```

#### Additions and evidence — read after the intake ledger

Saved commands and seed/path values below are historical inputs. Check their decoded histories before interpreting results.

### B28 — #2339: Public types / inferred Collection declaration emission

**Primary (the task):** #2339.

**Comparison items:** none listed.

**Context only:** #1012, #393.

```text
Primary task: #2339.
Comparison items: none listed.
Context items: #1012, #393.

Before any reproduction, write intake-ledger.md. Cover every primary, comparison, and context issue or PR. Record its current state and latest relevant comment with URLs. Record its claimed law and current-main baseline. Record whether it may still reproduce. Mark unknowns explicitly. Do not select one issue until the ledger covers all listed items. Additions do not replace the primary task.

Saved seed/path commands are historical inputs. Check that the decoded history matches the reported literal counterexample. A pass with another history supplies no reproduction evidence. If coordinates differ, replay the literal history through the shared oracle checker.

Read the shared rules in docs/misfits-survey-session-prompts-2026-10-30.md or the gist preamble: https://gist.github.com/KyleAMathews/75bbadfbc449d798c9f0b9691a540406. Use the handoff guide for evidence fetch instructions. If evidence is missing, record that fact once. Continue supported investigation from issue reports and current main. Keep unavailable historical claims unverified. Do not invent historical results or bypass required receiving-run admission.

Revalidate #2339 using the complete original unannotated inferred factory and inferred Collection-value exports retained in the release record. Use strict NodeNext declaration emission for .mts and .cts against actual installed tarballs; record exact compiler/package versions and diagnostics. Generate legal row/key shapes through the public-type owner, preserving factory and value forms and both receiving module formats. A readonly toArray-only public view is a limited positive control, not full Collection emission. Do not annotate inferred exports to hide private compiler/live types or LIVE_QUERY_INTERNAL leaks. Show current parent RED before any repair, GREEN and a hostile fault control; report source-public versus built/installed limits. Historical #1012/#393 are closed context, not current regressions or runtime failure evidence. Coordinate B25/B06 only for shared public type edits.
```

#### Additions and evidence — read after the intake ledger

Saved commands and seed/path values below are historical inputs. Check their decoded histories before interpreting results.

### B06 — #2340: Collection mutations / generated fields and read-write payloads

**Primary (the task):** #2340.

**Comparison items:** none listed.

**Context only:** #2338, #2264.

```text
Primary task: #2340.
Comparison items: none listed.
Context items: #2338, #2264.

Before any reproduction, write intake-ledger.md. Cover every primary, comparison, and context issue or PR. Record its current state and latest relevant comment with URLs. Record its claimed law and current-main baseline. Record whether it may still reproduce. Mark unknowns explicitly. Do not select one issue until the ledger covers all listed items. Additions do not replace the primary task.

Saved seed/path commands are historical inputs. Check that the decoded history matches the reported literal counterexample. A pass with another history supplies no reproduction evidence. If coordinates differ, replay the literal history through the shared oracle checker.

Read the shared rules in docs/misfits-survey-session-prompts-2026-10-30.md or the gist preamble: https://gist.github.com/KyleAMathews/75bbadfbc449d798c9f0b9691a540406. Use the handoff guide for evidence fetch instructions. If evidence is missing, record that fact once. Continue supported investigation from issue reports and current main. Keep unavailable historical claims unverified. Do not invent historical results or bypass required receiving-run admission.

Include #2340 under B06. Restore the original no-select live-query/onInsert business-row witness from the release record and revalidate on current main before changing types. Extend the public metadata type and mutation-handler admission owners across core/live factories and actual framework configs. Preserve required readonly virtual metadata on published reads while judging authored mutation inputs independently. Keep plain input TS2345 separate from reusable UpdateMutationFn<Row> admission: historical TS2322/TS2769 passed diagnostics-first fresh Programs, so it is not a stable CLI RED. Preserve diagnostic and observed-type checking orders or establish a stable discriminator. Runtime schema receiver GREEN proves no public mutation-type contract. Keep source-public, installed and framework receiving explicit; show parent RED/GREEN/mutant for surviving defects. Coordinate B25/#2338 and B19/#2264; schema/payload feature requests remain separate.
```

#### Additions and evidence — read after the intake ledger

Saved commands and seed/path values below are historical inputs. Check their decoded histories before interpreting results.

### P8 — #2341: SQLite persistence / Electric multi-tab coordination

**Primary (the task):** #2341.

**Comparison items:** none listed.

**Context only:** #2317, #2281, #2272.

```text
Primary task: #2341.
Comparison items: none listed.
Context items: #2317, #2281, #2272.

Before any reproduction, write intake-ledger.md. Cover every primary, comparison, and context issue or PR. Record its current state and latest relevant comment with URLs. Record its claimed law and current-main baseline. Record whether it may still reproduce. Mark unknowns explicitly. Do not select one issue until the ledger covers all listed items. Additions do not replace the primary task.

Saved seed/path commands are historical inputs. Check that the decoded history matches the reported literal counterexample. A pass with another history supplies no reproduction evidence. If coordinates differ, replay the literal history through the shared oracle checker.

Read the shared rules in docs/misfits-survey-session-prompts-2026-10-30.md or the gist preamble: https://gist.github.com/KyleAMathews/75bbadfbc449d798c9f0b9691a540406. Use the handoff guide for evidence fetch instructions. If evidence is missing, record that fact once. Continue supported investigation from issue reports and current main. Keep unavailable historical claims unverified. Do not invent historical results or bypass required receiving-run admission.

Track #2341 as a separate instrument obligation under the existing sync-metadata session oracle and persisted/native receivers; coordinate P8/P6/P3. Revalidate the recorded coverage-map limit on the selected current source. Generate read-hold histories with buffered commits, eventual application and abandonment, plus nearby controls. Observe actual durable transactions at their receipt/boundary independently of the production metadata classifier. Calibrate a deliberately wrong durable write followed by repair: final equality must not conceal the transient violation. Preserve source-facing comparisons, tab-local seed versus explicit durable metadata laws, unknown-author recovery, abandonment rules, existing budgets, measured generated reach and fixed/random replay parity. This is no new production RED; if a defect emerges, retain the trace and obtain parent RED before repair, GREEN and a hostile mutant. Keep #2317 source-facing, #2281 resurrection and #2272 host/coordinator scope distinct.
```

#### Additions and evidence — read after the intake ledger

Saved commands and seed/path values below are historical inputs. Check their decoded histories before interpreting results.

### B29 — #2342: Adapter receiving / applied receipts and lazy child readiness

**Primary (the task):** #2342.

**Comparison items:** none listed.

**Context only:** #2118, #2317.

```text
Primary task: #2342.
Comparison items: none listed.
Context items: #2118, #2317.

Before any reproduction, write intake-ledger.md. Cover every primary, comparison, and context issue or PR. Record its current state and latest relevant comment with URLs. Record its claimed law and current-main baseline. Record whether it may still reproduce. Mark unknowns explicitly. Do not select one issue until the ledger covers all listed items. Additions do not replace the primary task.

Saved seed/path commands are historical inputs. Check that the decoded history matches the reported literal counterexample. A pass with another history supplies no reproduction evidence. If coordinates differ, replay the literal history through the shared oracle checker.

Read the shared rules in docs/misfits-survey-session-prompts-2026-10-30.md or the gist preamble: https://gist.github.com/KyleAMathews/75bbadfbc449d798c9f0b9691a540406. Use the handoff guide for evidence fetch instructions. If evidence is missing, record that fact once. Continue supported investigation from issue reports and current main. Keep unavailable historical claims unverified. Do not invent historical results or bypass required receiving-run admission.

Revalidate #2342's two retained release cuts independently against current main through their existing coverage-map owners. Release P08: exercise the actual custom-adapter fenced callback holding an establishing applied receipt before load settlement. Release P14: judge the actual lazy child-ready call outcome against the existing source-health model rather than catching/discarding a throw. Preserve accepted owners, fresh-run neighbors, omitted-callback reach controls, laws and budgets. Add legal generated histories and measure actual receiving reach; calibrate by omitting/corrupting each actual callback/outcome so the same comparison rejects it. Record each cut separately; later work may already discharge one. These are historical coverage obligations, not newly reproduced production defects. Only if a production defect is exposed obtain parent RED before repair, GREEN and a hostile mutant. Coordinate P4 for replay/receipt boundaries and P7 for source health; #2118's broader proposal is separate, and release P08 must not be confused with metadata P8/#2317.
```

#### Additions and evidence — read after the intake ledger

Saved commands and seed/path values below are historical inputs. Check their decoded histories before interpreting results.

## November 3 standalone retention investigation

### B30 — #2344: Deleted payload retention and storage growth

**Primary (the task):** #2344.

**Comparison items:** none listed.

**Context only:** none listed.

```text
Primary task: #2344.
Comparison items: none listed.
Context items: none listed.

Before any reproduction, write intake-ledger.md. Cover every primary, comparison, and context issue or PR. Record its current state and latest relevant comment with URLs. Record its claimed law and current-main baseline. Record whether it may still reproduce. Mark unknowns explicitly. Do not select one issue until the ledger covers all listed items. Additions do not replace the primary task.

Saved seed/path commands are historical inputs. Check that the decoded history matches the reported literal counterexample. A pass with another history supplies no reproduction evidence. If coordinates differ, replay the literal history through the shared oracle checker.

Read the shared rules in docs/misfits-survey-session-prompts-2026-10-30.md or the gist preamble: https://gist.github.com/KyleAMathews/75bbadfbc449d798c9f0b9691a540406. Use the handoff guide for evidence fetch instructions. If evidence is missing, record that fact once. Continue supported investigation from issue reports and current main. Keep unavailable historical claims unverified. Do not invent historical results or bypass required receiving-run admission.

Investigate #2344 on a recorded fresh baseline. First identify the accepted deletion, tombstone, replay and retention laws and existing independent oracle owners through the coverage map. Logical Collection deletion alone does not establish physical or secure SQLite erasure. Reproduce the reported 1.0.0-rc.1.2 local-only persistedCollectionOptions setup without sync, using utils.acceptMutations and the supplied Node better-sqlite3 example. Observe both logical row absence and actual durable tombstone/applied_tx payloads, keeping reporter claims distinct from your evidence. Separate indefinite tombstone payload retention from bounded applied_tx replay retention (reported defaults: 1000 rows / 24 hours); inspect same-key rewrite, reset/truncate and catch-up needs before judging safety. Measure write/delete storage growth with relevant controls. Scope Node, browser OPFS and Expo receiving separately; do not infer them from a Node-only result. Distinguish a defect under an accepted retention promise from requests for key/version-only tombstones, pruning policy, local truncate/purge or table removal. No new API or secure-erasure guarantee is approved. For confirmed bugs extend the primary independent oracle and generated histories before production changes, measure reach, show unchanged-production RED, repaired GREEN and a hostile-mutant failure at the durable observation boundary. Preserve peer catch-up, recovery and replay laws; coordinate P3/P6/P8 where machinery overlaps without merging causes or closure claims. Deliver the law/bug/feature distinction, current reproduction, enforcement gaps and limits, with explicit decisions needed for stronger retention or purge capabilities.
```

#### Additions and evidence — read after the intake ledger

Saved commands and seed/path values below are historical inputs. Check their decoded histories before interpreting results.

[#2344](https://github.com/TanStack/db/issues/2344) reports full deleted values retained in local-only SQLite tombstones and temporarily in applied transaction replay data. It remains standalone; sharing persistence machinery with peer recovery does not establish a shared defect.

## November 3 standalone draft investigation

### B31 — #2349: Nested draft values and prototype preservation

**Primary (the task):** #2349.

**Comparison items:** none listed.

**Context only:** #1714, #1800, #2346.

```text
Primary task: #2349.
Comparison items: none listed.
Context items: #1714, #1800, #2346.

Before any reproduction, write intake-ledger.md. Cover every primary, comparison, and context issue or PR. Record its current state and latest relevant comment with URLs. Record its claimed law and current-main baseline. Record whether it may still reproduce. Mark unknowns explicitly. Do not select one issue until the ledger covers all listed items. Additions do not replace the primary task.

Saved seed/path commands are historical inputs. Check that the decoded history matches the reported literal counterexample. A pass with another history supplies no reproduction evidence. If coordinates differ, replay the literal history through the shared oracle checker.

Read the shared rules in docs/misfits-survey-session-prompts-2026-10-30.md or the gist preamble: https://gist.github.com/KyleAMathews/75bbadfbc449d798c9f0b9691a540406. Use the handoff guide for evidence fetch instructions. If evidence is missing, record that fact once. Continue supported investigation from issue reports and current main. Keep unavailable historical claims unverified. Do not invent historical results or bypass required receiving-run admission.

Investigate #2349 on a recorded fresh baseline. Find the primary draft oracle and its documented original-class-instance limitation through the coverage map; establish the accepted runtime-shape preservation, mutation isolation and native-value laws before editing. Reproduce the supplied real Collection setup: hold onUpdate pending, edit draft.payload.count without touching payload.leaf, observe the optimistic row, confirm through sync and await transaction settlement. Preserve class, null-prototype and plain-object controls at before-edit, pending and confirmed checkpoints. The report records two publications for every control, so prototype loss/restoration is the stated bug; do not claim an extra-notification regression without a distinct witness. Read #1714/#1800 to identify the earlier class-instance repair's actual boundary, not to infer duplication or closure. The report attributes the draft-copy loss to deepClone() in proxy.ts and records no diff against main at 1443dc92e5417394acbdc98b782caa9802848ce6; verify those claims on your baseline rather than blaming #2346's stricter row comparison. Extend the existing independent draft oracle with generated nested sibling edits and nearby nesting/value variations, measure actual reach, and observe both untouched runtime shape and stored-original isolation. Include direct writes through drafted nested values so a prototype-preserving alias cannot pass, and retain existing native-value and pending/settlement laws. Obtain unchanged-production RED before repair, repaired GREEN and hostile mutants for both prototype loss and aliased originals through the same judgment. Keep closure bounded by the generated histories, public Collection and draft paths, checkpoints and supported value domain. Deliver current bug disposition, authority, missing enforcement/coverage, exact replay evidence and limits; use prep-pr for any proposed fix. No new product API is requested by this prompt.
```

#### Additions and evidence — read after the intake ledger

Saved commands and seed/path values below are historical inputs. Check their decoded histories before interpreting results.

[#2349](https://github.com/TanStack/db/issues/2349) reports prototype loss in untouched sibling values during a nested optimistic update, followed by restoration after sync confirmation. It is standalone; #1714/#1800 are historical boundary context and #2346 is discovery context.

## November 9 new-item sessions — B32–B41

[Classification and captured discussions](misfits-survey/intake-2026-11-09.md). User-owned PRs #2354/#2378 are excluded and handled by other sessions. The new sessions distinguish reported bugs, proposed capabilities and packaging policy; routine release PR #2380 has no repair prompt. No item has been reproduced by this intake.

### B32 — OPFS interrupted-writer recovery

**Primary (the task):** #2357.

**Comparison items:** none listed.

**Context only:** none listed.

```text
Primary task: #2357.
Comparison items: none listed.
Context items: none listed.
Upstream context: wa-sqlite #392/#393, using the repository links in #2357.

Before any reproduction, write intake-ledger.md. Cover every primary, comparison, and context issue or PR. Record its current state and latest relevant comment with URLs. Record its claimed law and current-main baseline. Record whether it may still reproduce. Mark unknowns explicitly. Do not select one issue until the ledger covers all listed items. Additions do not replace the primary task.

Saved seed/path commands are historical inputs. Check that the decoded history matches the reported literal counterexample. A pass with another history supplies no reproduction evidence. If coordinates differ, replay the literal history through the shared oracle checker.

Read the shared rules in docs/misfits-survey-session-prompts-2026-10-30.md or the gist preamble: https://gist.github.com/KyleAMathews/75bbadfbc449d798c9f0b9691a540406. Use the handoff guide for evidence fetch instructions. If evidence is missing, record that fact once. Continue supported investigation from issue reports and current main. Keep unavailable historical claims unverified. Do not invent historical results or bypass required receiving-run admission.

Investigate #2357 through the exported openBrowserWASQLiteOPFSDatabase and actual bundled browser worker. This SQL-only recovery witness bypasses Collection and coordinator behavior; keep it distinct from Electric peer metadata, B30 payload retention and B34 shared-handle scheduling. Establish the last-committed-state and interrupted-transaction authority, then reproduce an already-open surviving handle after another tab closes mid-write, with a newly opened survivor control, journal presence, committed-row/integrity observations and a later survivor write/reopen. Verify actual npm/built worker provenance; changing an application peer dependency need not replace embedded VFS code. Treat upstream wa-sqlite #392/#393 and the reporter's patch/RED/GREEN counts as testimony until checked. Extend the appropriate independent SQL/storage recovery owner, declare generated interrupted-writer reach, show parent RED, repaired GREEN and a hostile missing-journal mutant. Chromium observations do not prove Firefox/Safari or the untested COMMIT window. Coordinate P3/P6 on browser fixtures and B20 only on reach; choose a vendored patch versus release uptake after inspecting the actual dependency boundary, without conflating their safety evidence.
```

#### Additions and evidence — read after the intake ledger

Saved commands and seed/path values below are historical inputs. Check their decoded histories before interpreting results.

[#2357](https://github.com/TanStack/db/issues/2357)

### B33 — PowerSync rejected delivery and pending writes

**Primary (the task):** #2358.

**Comparison items:** none listed.

**Context only:** #2118.

```text
Primary task: #2358.
Comparison items: none listed.
Context items: #2118.

Before any reproduction, write intake-ledger.md. Cover every primary, comparison, and context issue or PR. Record its current state and latest relevant comment with URLs. Record its claimed law and current-main baseline. Record whether it may still reproduce. Mark unknowns explicitly. Do not select one issue until the ledger covers all listed items. Additions do not replace the primary task.

Saved seed/path commands are historical inputs. Check that the decoded history matches the reported literal counterexample. A pass with another history supplies no reproduction evidence. If coordinates differ, replay the literal history through the shared oracle checker.

Read the shared rules in docs/misfits-survey-session-prompts-2026-10-30.md or the gist preamble: https://gist.github.com/KyleAMathews/75bbadfbc449d798c9f0b9691a540406. Use the handoff guide for evidence fetch instructions. If evidence is missing, record that fact once. Continue supported investigation from issue reports and current main. Keep unavailable historical claims unverified. Do not invent historical results or bypass required receiving-run admission.

Investigate #2358 as a reported rejected-deserialization, health and mutation-progress bug. Read the PowerSync lifecycle owner and source-health/adapter-conformance contracts and verify the claimed missing delivery-error/schema grammar dimension. Reproduce the already-ready collection receiving a poison row, later valid rows, a pending local write and a restart, with a no-poison control. Observe actual Collection health/status, delivery/application and transaction settlement at justified checkpoints; the reporter's 15-second wait alone is not universal nontermination proof. Separate required visible fatal error and pending-operation outcomes from a new skip-and-continue policy: documentation reportedly calls deserialization fatal, so do not silently approve skipping. Extend independent generated rejected-delivery histories and neighboring pending-write/reload cases before production edits, measure reach, obtain parent RED/GREEN and a hostile swallowed-error mutant through actual adapter receiving. Coordinate B07 on settlement, P7 on source health and #2118's conformance owner without inferring backend-confirmation semantics or editing another session's PR. Node SQLite and real browser/service receiving remain separately bounded.
```

#### Additions and evidence — read after the intake ledger

Saved commands and seed/path values below are historical inputs. Check their decoded histories before interpreting results.

[#2358](https://github.com/TanStack/db/issues/2358)

### B34 — Shared application SQL scheduling capability

**Primary (the task):** #2363.

**Comparison items:** none listed.

**Context only:** none listed.

```text
Primary task: #2363.
Comparison items: none listed.
Context items: none listed.

Before any reproduction, write intake-ledger.md. Cover every primary, comparison, and context issue or PR. Record its current state and latest relevant comment with URLs. Record its claimed law and current-main baseline. Record whether it may still reproduce. Mark unknowns explicitly. Do not select one issue until the ledger covers all listed items. Additions do not replace the primary task.

Saved seed/path commands are historical inputs. Check that the decoded history matches the reported literal counterexample. A pass with another history supplies no reproduction evidence. If coordinates differ, replay the literal history through the shared oracle checker.

Read the shared rules in docs/misfits-survey-session-prompts-2026-10-30.md or the gist preamble: https://gist.github.com/KyleAMathews/75bbadfbc449d798c9f0b9691a540406. Use the handoff guide for evidence fetch instructions. If evidence is missing, record that fact once. Continue supported investigation from issue reports and current main. Keep unavailable historical claims unverified. Do not invent historical results or bypass required receiving-run admission.

Investigate #2363 as a capability/support-boundary request, not an executed data-loss report. Establish whether direct application SQL on the persistence's shared handle is supported and what execute completion and transaction isolation promise. The reported rollback/outbox scenario was discovered by code reading without a standalone reproduction. Build the smallest distinguishing shared-handle schedule before asserting a bug. Compare a supported driver export, a queued callback/accessor and a documented restriction without choosing a new API during intake. Keep driver transactions, callback failure/reentrancy and application-owned tables distinct from internal persistence tables. Coordinate P3/P6 on scheduling boundaries and B32 on the shared opener only; interrupted-writer VFS recovery is a different law. Deliver current capability, evidence and the API/policy decision needed. Do not implement a new public promise without a maintainer decision.
```

#### Additions and evidence — read after the intake ledger

Saved commands and seed/path values below are historical inputs. Check their decoded histories before interpreting results.

[#2363](https://github.com/TanStack/db/issues/2363)

### B35 — Optional TypeScript peer policy

**Primary (the task):** #2364.

**Comparison items:** none listed.

**Context only:** none listed.

```text
Primary task: #2364.
Comparison items: none listed.
Context items: none listed.

Before any reproduction, write intake-ledger.md. Cover every primary, comparison, and context issue or PR. Record its current state and latest relevant comment with URLs. Record its claimed law and current-main baseline. Record whether it may still reproduce. Mark unknowns explicitly. Do not select one issue until the ledger covers all listed items. Additions do not replace the primary task.

Saved seed/path commands are historical inputs. Check that the decoded history matches the reported literal counterexample. A pass with another history supplies no reproduction evidence. If coordinates differ, replay the literal history through the shared oracle checker.

Read the shared rules in docs/misfits-survey-session-prompts-2026-10-30.md or the gist preamble: https://gist.github.com/KyleAMathews/75bbadfbc449d798c9f0b9691a540406. Use the handoff guide for evidence fetch instructions. If evidence is missing, record that fact once. Continue supported investigation from issue reports and current main. Keep unavailable historical claims unverified. Do not invent historical results or bypass required receiving-run admission.

Investigate #2364 as packaging policy with a reported installation-cost consequence. Verify the fifteen named package manifests, runtime imports and published metadata, then reproduce JavaScript-only installation under npm, default pnpm peer handling and Bun as appropriate. Measure the actual compiler dependency footprint without assuming the reporter's platform/version size is universal. Distinguish a minimum supported declaration compiler from a runtime dependency, and state the compatibility effects of optional peer metadata. No row/settlement failure is reported. Deliver the smallest packaging decision and validation, keeping existing supported TypeScript versions and package-manager behaviors explicit; do not recast the request as a query-type bug or add an oracle where no behavioral model is warranted.
```

#### Additions and evidence — read after the intake ledger

Saved commands and seed/path values below are historical inputs. Check their decoded histories before interpreting results.

[#2364](https://github.com/TanStack/db/issues/2364)

### B36 — Nullish aggregate semantics

**Primary (the task):** #2365, #2375.

**Comparison items:** none listed.

**Context only:** none listed.

```text
Primary task: #2365, #2375.
Comparison items: none listed.
Context items: none listed.

Before any reproduction, write intake-ledger.md. Cover every primary, comparison, and context issue or PR. Record its current state and latest relevant comment with URLs. Record its claimed law and current-main baseline. Record whether it may still reproduce. Mark unknowns explicitly. Do not select one issue until the ledger covers all listed items. Additions do not replace the primary task.

Saved seed/path commands are historical inputs. Check that the decoded history matches the reported literal counterexample. A pass with another history supplies no reproduction evidence. If coordinates differ, replay the literal history through the shared oracle checker.

Read the shared rules in docs/misfits-survey-session-prompts-2026-10-30.md or the gist preamble: https://gist.github.com/KyleAMathews/75bbadfbc449d798c9f0b9691a540406. Use the handoff guide for evidence fetch instructions. If evidence is missing, record that fact once. Continue supported investigation from issue reports and current main. Keep unavailable historical claims unverified. Do not invent historical results or bypass required receiving-run admission.

Investigate #2365 and evaluate PR #2375 using evaluate-review, with every captured finding preserved. The new cluster owns nullish aggregate inputs; it does not merge all null/literal topics. Establish the accepted aggregate contract and current aggregate-select/db-ivm owners. Distinguish the reported mixed-value avg denominator and min/max zero-coercion bug from sum (the supplied mixed-value sum is already 300), all-null/empty aggregate policy and static result nullability. The PR preserves avg/sum zero under Aggregate<number> and explicitly asks whether no-value avg should become null; that type/behavior change is undecided. Do not impose SQL's every-empty-result rule without authority. Verify claimed parent RED, GREEN, generated reach and mutants through the actual selected aggregates. Captured reviews leave changed-route and HAVING-filtered reach concerns; direct nullable min/max type fixes do not prove wrapped-expression/join nullability, and fixed type assertions are not generated type coverage. Preserve budgets, independently judge whether compared outputs actually exercise selected aggregate branches, and cover neighboring legal value/nullish transitions. Joins, optimistic writes and type-generation limits must remain explicit until addressed. An open proposed fix or a bot-addressed finding does not close the issue.
```

#### Additions and evidence — read after the intake ledger

Saved commands and seed/path values below are historical inputs. Check their decoded histories before interpreting results.

[#2365](https://github.com/TanStack/db/issues/2365), [#2375](https://github.com/TanStack/db/pull/2375)

### B37 — PowerSync managed SQLite tables

**Primary (the task):** #2366.

**Comparison items:** none listed.

**Context only:** #2118.

```text
Primary task: #2366.
Comparison items: none listed.
Context items: #2118.

Before any reproduction, write intake-ledger.md. Cover every primary, comparison, and context issue or PR. Record its current state and latest relevant comment with URLs. Record its claimed law and current-main baseline. Record whether it may still reproduce. Mark unknowns explicitly. Do not select one issue until the ledger covers all listed items. Additions do not replace the primary task.

Saved seed/path commands are historical inputs. Check that the decoded history matches the reported literal counterexample. A pass with another history supplies no reproduction evidence. If coordinates differ, replay the literal history through the shared oracle checker.

Read the shared rules in docs/misfits-survey-session-prompts-2026-10-30.md or the gist preamble: https://gist.github.com/KyleAMathews/75bbadfbc449d798c9f0b9691a540406. Use the handoff guide for evidence fetch instructions. If evidence is missing, record that fact once. Continue supported investigation from issue reports and current main. Keep unavailable historical claims unverified. Do not invent historical results or bypass required receiving-run admission.

Investigate/review PR #2366 as new managed-table direct:true support in the existing SDK/SQLite adapter. It is distinct from B40's SQLite-free transport despite the word direct. Establish existing adapter laws the newly supported storage form must preserve, covering diff tracking, eager/on-demand filters, transactions, mutation confirmation, migration/reopen, disposal and metadata restrictions. Use evaluate-review for the captured findings, retaining author-addressed export/docstring claims as testimony; verify actual oracle coverage rather than substituting the 206-unit-test claim. The captured description lacks the requested Oracle Coverage section. Real SQLite and mixed table/view receiving, public API exposure and schema-trigger boundaries need their own evidence. Coordinate B07/B33 and #2118 on shared laws, not an assumed shared bug. Deliver capability scope and readiness/coverage limits; no adoption or new API approval follows from classification.
```

#### Additions and evidence — read after the intake ledger

Saved commands and seed/path values below are historical inputs. Check their decoded histories before interpreting results.

[#2366](https://github.com/TanStack/db/pull/2366)

### B38 — Full-read authority across persisted hydration

**Primary (the task):** #2367.

**Comparison items:** none listed.

**Context only:** none listed.

```text
Primary task: #2367.
Comparison items: none listed.
Context items: none listed.

Before any reproduction, write intake-ledger.md. Cover every primary, comparison, and context issue or PR. Record its current state and latest relevant comment with URLs. Record its claimed law and current-main baseline. Record whether it may still reproduce. Mark unknowns explicitly. Do not select one issue until the ledger covers all listed items. Additions do not replace the primary task.

Saved seed/path commands are historical inputs. Check that the decoded history matches the reported literal counterexample. A pass with another history supplies no reproduction evidence. If coordinates differ, replay the literal history through the shared oracle checker.

Read the shared rules in docs/misfits-survey-session-prompts-2026-10-30.md or the gist preamble: https://gist.github.com/KyleAMathews/75bbadfbc449d798c9f0b9691a540406. Use the handoff guide for evidence fetch instructions. If evidence is missing, record that fact once. Continue supported investigation from issue reports and current main. Keep unavailable historical claims unverified. Do not invent historical results or bypass required receiving-run admission.

Investigate #2367 as a reported startup full-read/baseline-hydration reconciliation bug. The metadata already contains current query owners; do not treat it as a legacy-owner migration merely because ownership is persisted. Establish when a completed full Query result is authoritative over owned persisted rows that hydrate later, then reproduce two sessions where server row a disappears, the next full read returns b before hydration, and a survives both startup and explicit refetch. Judge actual public rows and durable mirror/owner metadata across startup orderings with fast/held source and hydration controls, including completed empty results. Extend the appropriate independent persisted reload and Query reconciliation owner(s) rather than cloning production key bookkeeping. Declare generated full-read-before-hydration reach, obtain parent RED before repair, GREEN and a hostile late-hydration resurrection mutant. Coordinate B16 on Query ownership, B12 on cache/readiness and P3/P8 on persistence receiving, without claiming a peer-reset/common cause. The supplied Node shim uses node:sqlite instead of the actual browser worker; browser/OPFS receiving is a separate obligation. Preserve accepted startup ordering, authoritative-source rows, offline policy and publication laws; a delay-only fix or final refetch control alone does not close the class.
```

#### Additions and evidence — read after the intake ledger

Saved commands and seed/path values below are historical inputs. Check their decoded histories before interpreting results.

[#2367](https://github.com/TanStack/db/issues/2367)

### B39 — Supabase adapter proposal

**Primary (the task):** #2376.

**Comparison items:** none listed.

**Context only:** #2118.

```text
Primary task: #2376.
Comparison items: none listed.
Context items: #2118.

Before any reproduction, write intake-ledger.md. Cover every primary, comparison, and context issue or PR. Record its current state and latest relevant comment with URLs. Record its claimed law and current-main baseline. Record whether it may still reproduce. Mark unknowns explicitly. Do not select one issue until the ledger covers all listed items. Additions do not replace the primary task.

Saved seed/path commands are historical inputs. Check that the decoded history matches the reported literal counterexample. A pass with another history supplies no reproduction evidence. If coordinates differ, replay the literal history through the shared oracle checker.

Read the shared rules in docs/misfits-survey-session-prompts-2026-10-30.md or the gist preamble: https://gist.github.com/KyleAMathews/75bbadfbc449d798c9f0b9691a540406. Use the handoff guide for evidence fetch instructions. If evidence is missing, record that fact once. Continue supported investigation from issue reports and current main. Keep unavailable historical claims unverified. Do not invent historical results or bypass required receiving-run admission.

Evaluate PR #2376 as a new private PostgREST/Realtime adapter, PR 1 of 4, using evaluate-review for captured reviews. Mocked focused tests and upstream paging/registry fix claims do not establish a main-branch bug or real-backend conformance. Preserve the stated later-work boundaries: local Supabase e2e/CI, queryOnce, docs/changeset and publication. Compare eager/on-demand loading, cap-aware stable paging, URL-bounded IN splitting, converters, writes and Realtime ownership with accepted adapter laws. Captured inline findings concerning composite keys, sync factory handling, abort-runtime compatibility, NULL ordering and rejected upserts have no captured response; retain them without accepting them as verified bugs. Identify independent owners/receiving gaps before repair claims, and distinguish capability scope from correctness of proposed behavior. Coordinate Query/ordered and #2118 owners only where the proposal actually crosses them; no publication or feature approval is authorized by the classification.
```

#### Additions and evidence — read after the intake ledger

Saved commands and seed/path values below are historical inputs. Check their decoded histories before interpreting results.

[#2376](https://github.com/TanStack/db/pull/2376)

### B40 — SQLite-free PowerSync protocol adapter

**Primary (the task):** #2377.

**Comparison items:** none listed.

**Context only:** #2118.

```text
Primary task: #2377.
Comparison items: none listed.
Context items: #2118.

Before any reproduction, write intake-ledger.md. Cover every primary, comparison, and context issue or PR. Record its current state and latest relevant comment with URLs. Record its claimed law and current-main baseline. Record whether it may still reproduce. Mark unknowns explicitly. Do not select one issue until the ledger covers all listed items. Additions do not replace the primary task.

Saved seed/path commands are historical inputs. Check that the decoded history matches the reported literal counterexample. A pass with another history supplies no reproduction evidence. If coordinates differ, replay the literal history through the shared oracle checker.

Read the shared rules in docs/misfits-survey-session-prompts-2026-10-30.md or the gist preamble: https://gist.github.com/KyleAMathews/75bbadfbc449d798c9f0b9691a540406. Use the handoff guide for evidence fetch instructions. If evidence is missing, record that fact once. Continue supported investigation from issue reports and current main. Keep unavailable historical claims unverified. Do not invent historical results or bypass required receiving-run admission.

Evaluate PR #2377 as a new powersync-direct-collection protocol client, not managed SQLite-table support in B37. Establish begin/write/commit, acquisition, mutation settlement and confirmWrites logical-snapshot promises independently, including online-only limits, eager/on-demand paths and error/cleanup behavior. The PR uses mocked-service adapter conformance; distinguish that from real protocol/service receiving. Review Node 24.22.2 and modern Map API runtime compatibility, docs and initial-publication/no-changeset scope as separate decisions. Coordinate B07 and #2118 on confirmation law without imposing the SQLite adapter's local-persistence semantics. Use evaluate-review for captured review findings, then report capability readiness and required decisions; do not adopt the new package or publish it as part of classification.
```

#### Additions and evidence — read after the intake ledger

Saved commands and seed/path values below are historical inputs. Check their decoded histories before interpreting results.

[#2377](https://github.com/TanStack/db/pull/2377)

### B41 — Simple comparison extraction rejects nonliterals

**Primary (the task):** #2381.

**Comparison items:** none listed.

**Context only:** none listed.

```text
Primary task: #2381.
Comparison items: none listed.
Context items: none listed.

Before any reproduction, write intake-ledger.md. Cover every primary, comparison, and context issue or PR. Record its current state and latest relevant comment with URLs. Record its claimed law and current-main baseline. Record whether it may still reproduce. Mark unknowns explicitly. Do not select one issue until the ledger covers all listed items. Additions do not replace the primary task.

Saved seed/path commands are historical inputs. Check that the decoded history matches the reported literal counterexample. A pass with another history supplies no reproduction evidence. If coordinates differ, replay the literal history through the shared oracle checker.

Read the shared rules in docs/misfits-survey-session-prompts-2026-10-30.md or the gist preamble: https://gist.github.com/KyleAMathews/75bbadfbc449d798c9f0b9691a540406. Use the handoff guide for evidence fetch instructions. If evidence is missing, record that fact once. Continue supported investigation from issue reports and current main. Keep unavailable historical claims unverified. Do not invent historical results or bypass required receiving-run admission.

Investigate #2381 through the public extractSimpleComparisons contract and independent expression owner. A column/function RHS reportedly becomes value:null although unsupported comparisons should throw; a genuine literal null must still extract as null. Reproduce direct IR eq/negated gt and actual on-demand loadSubset receiving separately on recorded main. Generate supported literal values, nonliteral RHS shapes, supported/unsupported operators and negation with an independent representability law rather than mirroring the helper's branches. Verify backend filters are not silently substituted. Obtain parent RED, measured generated reach, repaired GREEN and hostile nonliteral-as-null and literal-null-rejection mutants. The suggested two-line undefined fallback is a candidate, not validated repair evidence. Coordinate adapter receivers and B27 only for shared expression concepts; local literal-value semantics and aggregate null handling remain distinct laws.
```

#### Additions and evidence — read after the intake ledger

Saved commands and seed/path values below are historical inputs. Check their decoded histories before interpreting results.

[#2381](https://github.com/TanStack/db/issues/2381)

## November 10 new-item sessions — B42–B49

[Classification and captured discussions](misfits-survey/intake-2026-11-10.md). Your currently open PRs are excluded and remain with their existing sessions. These prompts distinguish reported defects, proposed capabilities and the validation-cost policy question. No reproduction was run during intake.

### B42 — Include DISTINCT within each parent

**Primary (the task):** #2385, #2387.

**Comparison items:** none listed.

**Context only:** #2273.

```text
Primary task: #2385, #2387.
Comparison items: none listed.
Context items: #2273.

Before any reproduction, write intake-ledger.md. Cover every primary, comparison, and context issue or PR. Record its current state and latest relevant comment with URLs. Record its claimed law and current-main baseline. Record whether it may still reproduce. Mark unknowns explicitly. Do not select one issue until the ledger covers all listed items. Additions do not replace the primary task.

Saved seed/path commands are historical inputs. Check that the decoded history matches the reported literal counterexample. A pass with another history supplies no reproduction evidence. If coordinates differ, replay the literal history through the shared oracle checker.

Read the shared rules in docs/misfits-survey-session-prompts-2026-10-30.md or the gist preamble: https://gist.github.com/KyleAMathews/75bbadfbc449d798c9f0b9691a540406. Use the handoff guide for evidence fetch instructions. If evidence is missing, record that fact once. Continue supported investigation from issue reports and current main. Keep unavailable historical claims unverified. Do not invent historical results or bypass required receiving-run admission.

Investigate #2385 and evaluate PR #2387 using evaluate-review for captured findings. Read the live materialization ARCHITECTURE.md in full before code or includes-oracle analysis, then establish the per-parent child-relation law through the coverage map and scope-identity/context-transport owners. Distinguish equal projected values under different parent routes, equal correlation values with distinct full route identity, and direct child DISTINCT versus a distinct derived source (#2273). Keep #2273's existing standalone ownership; common spelling does not establish common cause. Independently check reported parent RED, generated reach, GREEN and hostile cross-parent-deduplication rejection rather than accepting PR counts. Generate neighboring parent/context edits and add receiving witnesses where the claim crosses toArray/materialize/include forms. Nested/windowed cases currently have focused evidence only; optimistic, paginated and lazy histories remain explicit limits. Preserve top-level DISTINCT, parent membership and child deletion/update behavior. Coordinate P4 without editing another session's PR. An open fix or minimal-risk bot review is not closure evidence.
```

#### Additions and evidence — read after the intake ledger

Saved commands and seed/path values below are historical inputs. Check their decoded histories before interpreting results.

[#2385](https://github.com/TanStack/db/issues/2385), [#2387](https://github.com/TanStack/db/pull/2387)

### B43 — Filtered include joins preserve keyed lazy demand

**Primary (the task):** #2386, #2388.

**Comparison items:** none listed.

**Context only:** #2321.

```text
Primary task: #2386, #2388.
Comparison items: none listed.
Context items: #2321.

Before any reproduction, write intake-ledger.md. Cover every primary, comparison, and context issue or PR. Record its current state and latest relevant comment with URLs. Record its claimed law and current-main baseline. Record whether it may still reproduce. Mark unknowns explicitly. Do not select one issue until the ledger covers all listed items. Additions do not replace the primary task.

Saved seed/path commands are historical inputs. Check that the decoded history matches the reported literal counterexample. A pass with another history supplies no reproduction evidence. If coordinates differ, replay the literal history through the shared oracle checker.

Read the shared rules in docs/misfits-survey-session-prompts-2026-10-30.md or the gist preamble: https://gist.github.com/KyleAMathews/75bbadfbc449d798c9f0b9691a540406. Use the handoff guide for evidence fetch instructions. If evidence is missing, record that fact once. Continue supported investigation from issue reports and current main. Keep unavailable historical claims unverified. Do not invent historical results or bypass required receiving-run admission.

Investigate #2386 and evaluate PR #2388 using evaluate-review, preserving both unresponded inline findings and later reviewer qualifications. Read live materialization ARCHITECTURE.md before analyzing code/oracles. Establish the acquisition-work promise: a source-local predicate should narrow a keyed lazy load rather than replace its key restriction; genuinely parent-reading subqueries may need another route. Distinguish reported broad work from incorrect final rows, and exercise plain joins as a control. Locate the independent includes work-counter owner, generate filtered joined/from-side and binding-context variations, measure reach and verify parent RED/GREEN plus a hostile dropped-key-predicate mutant. A structural checker must distinguish the actual join key from another equality property. Check binding IDs through collection subqueries independently; no captured reply resolves that concern. Keep simultaneous filters on both sides, fn.where filters and post-preload live updates visible as currently excluded evidence, not silently closed cases. Coordinate P4/B13 and #2321's separate batching-performance work; do not infer shared cause or approve broader compiler changes.
```

#### Additions and evidence — read after the intake ledger

Saved commands and seed/path values below are historical inputs. Check their decoded histories before interpreting results.

[#2386](https://github.com/TanStack/db/issues/2386), [#2388](https://github.com/TanStack/db/pull/2388)

### B44 — React Suspense initial success and failure lifetimes

**Primary (the task):** #2396, #2397.

**Comparison items:** none listed.

**Context only:** #1343.

```text
Primary task: #2396, #2397.
Comparison items: none listed.
Context items: #1343.

Before any reproduction, write intake-ledger.md. Cover every primary, comparison, and context issue or PR. Record its current state and latest relevant comment with URLs. Record its claimed law and current-main baseline. Record whether it may still reproduce. Mark unknowns explicitly. Do not select one issue until the ledger covers all listed items. Additions do not replace the primary task.

Saved seed/path commands are historical inputs. Check that the decoded history matches the reported literal counterexample. A pass with another history supplies no reproduction evidence. If coordinates differ, replay the literal history through the shared oracle checker.

Read the shared rules in docs/misfits-survey-session-prompts-2026-10-30.md or the gist preamble: https://gist.github.com/KyleAMathews/75bbadfbc449d798c9f0b9691a540406. Use the handoff guide for evidence fetch instructions. If evidence is missing, record that fact once. Continue supported investigation from issue reports and current main. Keep unavailable historical claims unverified. Do not invent historical results or bypass required receiving-run admission.

Investigate #2396/#2397 as neighboring DbClient-backed useLiveSuspenseQuery startup reports. Keep two laws distinct: already-satisfied synchronous on-demand results should avoid unnecessary suspension under the accepted readiness contract, and a rejected initial acquisition should reach ErrorBoundary through a stable failed resource rather than repeatedly creating loads. Establish authority in the shared framework contract, React receiving driver and observer/resource lifecycle owners. Reproduce the supplied browser fixture and distinguish retained cached rows, sync result, async result and immediate rejection controls. Judge whether fallback/error appears and whether load count stabilizes at justified React checkpoints; reported 300 ms and 142 loads are observations, not universal timing laws. Extend independent generated lifecycle histories with receiving witnesses before repair claims. Preserve server non-admission/hydration, successful async suspension, retry/recovery and abandoned-resource cleanup; merely retaining errors forever can violate another law. Obtain parent RED, measured reach, GREEN and hostile unnecessary-suspension/failed-resource-eviction mutants. Coordinate B23/B11/P7; neither SSR nor ordered request recovery is an established common cause. Closed #1343 forwarding work does not establish failed-resource lifetime closure.
```

#### Additions and evidence — read after the intake ledger

Saved commands and seed/path values below are historical inputs. Check their decoded histories before interpreting results.

[#2396](https://github.com/TanStack/db/issues/2396), [#2397](https://github.com/TanStack/db/issues/2397)

### B45 — Joined demand exposes subset loading after readiness

**Primary (the task):** #2384.

**Comparison items:** none listed.

**Context only:** none listed.

```text
Primary task: #2384.
Comparison items: none listed.
Context items: none listed.

Before any reproduction, write intake-ledger.md. Cover every primary, comparison, and context issue or PR. Record its current state and latest relevant comment with URLs. Record its claimed law and current-main baseline. Record whether it may still reproduce. Mark unknowns explicitly. Do not select one issue until the ledger covers all listed items. Additions do not replace the primary task.

Saved seed/path commands are historical inputs. Check that the decoded history matches the reported literal counterexample. A pass with another history supplies no reproduction evidence. If coordinates differ, replay the literal history through the shared oracle checker.

Read the shared rules in docs/misfits-survey-session-prompts-2026-10-30.md or the gist preamble: https://gist.github.com/KyleAMathews/75bbadfbc449d798c9f0b9691a540406. Use the handoff guide for evidence fetch instructions. If evidence is missing, record that fact once. Continue supported investigation from issue reports and current main. Keep unavailable historical claims unverified. Do not invent historical results or bypass required receiving-run admission.

Evaluate PR #2384 as a proposed fix for isLoadingSubset remaining false while a ready live query later acquires lazy joined demand. Use evaluate-review for captured reviews. Establish the readiness-versus-current-demand loading law from existing core owners, then verify the new controlled generated oracle is independent and actually observes the public loading contribution across admission, settlement, replacement and retirement. Check parent RED/GREEN, declared reach and hostile ignored-pending-demand rejection. Preserve ready status and account only for live current contributions. The 1,119-test and byte-size claims remain testimony until checked. Provider/framework timing, nested includes, ordered windows, replay, callback reentrancy and transactional consistency are explicitly outside current evidence; add appropriate receiving/history coverage before expanding the claim. Coordinate P4/B23 and existing settlement owners without merging with include child membership or acquisition-work bugs.
```

#### Additions and evidence — read after the intake ledger

Saved commands and seed/path values below are historical inputs. Check their decoded histories before interpreting results.

[#2384](https://github.com/TanStack/db/pull/2384)

### B46 — Functional select validation cost and rejection policy

**Primary (the task):** #2399.

**Comparison items:** none listed.

**Context only:** #2321.

```text
Primary task: #2399.
Comparison items: none listed.
Context items: #2321.

Before any reproduction, write intake-ledger.md. Cover every primary, comparison, and context issue or PR. Record its current state and latest relevant comment with URLs. Record its claimed law and current-main baseline. Record whether it may still reproduce. Mark unknowns explicitly. Do not select one issue until the ledger covers all listed items. Additions do not replace the primary task.

Saved seed/path commands are historical inputs. Check that the decoded history matches the reported literal counterexample. A pass with another history supplies no reproduction evidence. If coordinates differ, replay the literal history through the shared oracle checker.

Read the shared rules in docs/misfits-survey-session-prompts-2026-10-30.md or the gist preamble: https://gist.github.com/KyleAMathews/75bbadfbc449d798c9f0b9691a540406. Use the handoff guide for evidence fetch instructions. If evidence is missing, record that fact once. Continue supported investigation from issue reports and current main. Keep unavailable historical claims unverified. Do not invent historical results or bypass required receiving-run admission.

Investigate #2399 as a measured-performance report with an open runtime validation policy question. Establish the authority for rejecting query-expression values returned from fn.select, including externally captured values deeply nested in returned records, before changing validateFnSelectResult. Reproduce production-build traversal cost with nested record pass-through and scaling controls; timings in the report are testimony. The proposed construction-counter/depth-limited fast path explicitly misses some deeply captured external query values, so do not call it equivalent or silently weaken the accepted contract. Compare designs against an independent result-validity law with generated nested values and measure both enforcement and work; preserve helpful typed diagnostics while treating runtime and static guarantees separately. Deliver the measured bottleneck, equivalent options and any maintainer decision required for a relaxation. Coordinate B25 on functional callback concepts, but keep reserved metadata/static typing and #2321 join batching separate.
```

#### Additions and evidence — read after the intake ledger

Saved commands and seed/path values below are historical inputs. Check their decoded histories before interpreting results.

[#2399](https://github.com/TanStack/db/issues/2399)

### B47 — Bounded ordered acquisition capability

**Primary (the task):** #2398.

**Comparison items:** none listed.

**Context only:** #2166, #2240.

```text
Primary task: #2398.
Comparison items: none listed.
Context items: #2166, #2240.

Before any reproduction, write intake-ledger.md. Cover every primary, comparison, and context issue or PR. Record its current state and latest relevant comment with URLs. Record its claimed law and current-main baseline. Record whether it may still reproduce. Mark unknowns explicitly. Do not select one issue until the ledger covers all listed items. Additions do not replace the primary task.

Saved seed/path commands are historical inputs. Check that the decoded history matches the reported literal counterexample. A pass with another history supplies no reproduction evidence. If coordinates differ, replay the literal history through the shared oracle checker.

Read the shared rules in docs/misfits-survey-session-prompts-2026-10-30.md or the gist preamble: https://gist.github.com/KyleAMathews/75bbadfbc449d798c9f0b9691a540406. Use the handoff guide for evidence fetch instructions. If evidence is missing, record that fact once. Continue supported investigation from issue reports and current main. Keep unavailable historical claims unverified. Do not invent historical results or bypass required receiving-run admission.

Investigate #2398 as an optional capability/performance request. The issue explicitly acknowledges correct documented current results and conservative broad fallback; do not classify that fallback as a proven bug. Reproduce the large leading tie and noncursor-representable Temporal.Instant examples on recorded main, then determine what an adapter must promise about the complete filter/order/offset/limit for safe bounded acquisition. Treat the prototype and API as proposals, including prefix rereads on growth, comparator/uniqueness admission and exclusions. Preserve existing transfer budgets, atomic publication, fallback correctness and adapter receipts; any new performance or support promise needs a maintainer decision. Coordinate P1/B18/B13, cross-link #2166's unique-leading-key redundant reads and #2240's comparator opt-in without reassigning them or assuming one repair. State evidence and capability-policy options before implementing a public API.
```

#### Additions and evidence — read after the intake ledger

Saved commands and seed/path values below are historical inputs. Check their decoded histories before interpreting results.

[#2398](https://github.com/TanStack/db/issues/2398)

### B48 — PowerSync numeric key capability and identity preservation

**Primary (the task):** #2392.

**Comparison items:** none listed.

**Context only:** #2358.

```text
Primary task: #2392.
Comparison items: none listed.
Context items: #2358.

Before any reproduction, write intake-ledger.md. Cover every primary, comparison, and context issue or PR. Record its current state and latest relevant comment with URLs. Record its claimed law and current-main baseline. Record whether it may still reproduce. Mark unknowns explicitly. Do not select one issue until the ledger covers all listed items. Additions do not replace the primary task.

Saved seed/path commands are historical inputs. Check that the decoded history matches the reported literal counterexample. A pass with another history supplies no reproduction evidence. If coordinates differ, replay the literal history through the shared oracle checker.

Read the shared rules in docs/misfits-survey-session-prompts-2026-10-30.md or the gist preamble: https://gist.github.com/KyleAMathews/75bbadfbc449d798c9f0b9691a540406. Use the handoff guide for evidence fetch instructions. If evidence is missing, record that fact once. Continue supported investigation from issue reports and current main. Keep unavailable historical claims unverified. Do not invent historical results or bypass required receiving-run admission.

Evaluate PR #2392 using evaluate-review and preserve every captured finding and author qualification. Separate new numeric collection-key support from the claimed load/eviction validation-admission transaction leak. Establish the accepted key/serializer identity law, supported numeric domain and mapping across lazy load, reload, outage recovery, unload and local writes; integer foreign-key joins are the new capability. A captured unresponded finding says SQLite text ID 001 coerces to numeric key 1 while String(mutation.key) targets ID 1: verify noncanonical IDs and custom serializer boundaries instead of assuming conversion is invertible. The author claims validation-before-begin for load/eviction but explicitly leaves diff-flush admission and persistent invalid-row retry/logging unchanged. Coordinate B33/#2358 on errors and progress, B07 on settlement and B37 on the existing SQLite adapter without broadening the repair claim. Fixed node:sqlite examples, claimed RED/GREEN/mutants and the assertion of no oracle owner require independent coverage-map review; add generated capability/receiving evidence before bug-class closure. Keep reported Windows symlink failure distinct from correctness and do not adopt the feature solely from a green test count.
```

#### Additions and evidence — read after the intake ledger

Saved commands and seed/path values below are historical inputs. Check their decoded histories before interpreting results.

[#2392](https://github.com/TanStack/db/pull/2392)

### B49 — Electric configurable awaitMatch history

**Primary (the task):** #2395.

**Comparison items:** none listed.

**Context only:** none listed.

```text
Primary task: #2395.
Comparison items: none listed.
Context items: none listed.

Before any reproduction, write intake-ledger.md. Cover every primary, comparison, and context issue or PR. Record its current state and latest relevant comment with URLs. Record its claimed law and current-main baseline. Record whether it may still reproduce. Mark unknowns explicitly. Do not select one issue until the ledger covers all listed items. Additions do not replace the primary task.

Saved seed/path commands are historical inputs. Check that the decoded history matches the reported literal counterexample. A pass with another history supplies no reproduction evidence. If coordinates differ, replay the literal history through the shared oracle checker.

Read the shared rules in docs/misfits-survey-session-prompts-2026-10-30.md or the gist preamble: https://gist.github.com/KyleAMathews/75bbadfbc449d798c9f0b9691a540406. Use the handoff guide for evidence fetch instructions. If evidence is missing, record that fact once. Continue supported investigation from issue reports and current main. Keep unavailable historical claims unverified. Do not invent historical results or bypass required receiving-run admission.

Evaluate draft PR #2395 as optional awaitMatch replay-history configuration, not an established memory defect. Establish separate laws for already-registered live predicates, late-predicate replay over retained messages, pending commit matching and transaction-ID evidence. Verify default 1000 compatibility, zero history, positive caps, pending messages and materialized descriptor copies through the independent lifecycle model and actual adapter driver; inspect reported RED/GREEN, generated reach and mutant claims. Preserve commit-boundary acknowledgement semantics. A message-count cap does not bound bytes, per-subset row lifetime or heap retention; application memory savings, GC timing, latency and real service delivery are expressly unmeasured. Coordinate B10 on confirmation and B30 on retention concepts without conflating deleted-row payload eviction. Captured bot response says the draft was not reviewed; no substantive external review findings were captured. Deliver capability/readiness limits without publishing or approving a new default.
```

#### Additions and evidence — read after the intake ledger

Saved commands and seed/path values below are historical inputs. Check their decoded histories before interpreting results.

[#2395](https://github.com/TanStack/db/pull/2395)

## Inventory remainder

The survey's unclustered/maintenance/unclear buckets remain separate. These
prompts account for the named clusters and the later #2294/#2310/#2315/#2317 work; they do
not claim every maintenance item needs a repair session. Re-triage those buckets
from the [inventory][survey] when desired.

[survey]: misfits-survey.md
[workflow]: misfits-cluster-investigation-workflow.md
[pilot]: misfits-investigations/pilot-2026-10-29/summary.md
[status]: misfits-repairs/2026-10-29/status.md
[raw-decision]: contributing/oracle-reviews/2026-10-30-raw-collection-publication-decision.md
[raw-repair]: contributing/oracle-reviews/2026-10-30-raw-collection-publication-repair.md
[ordered-strategy]: misfits-repairs/2026-10-29/ordered/strategy-progress-v1.md
[ordered-account]: misfits-repairs/2026-10-29/ordered/first-transfer-v2/semantic-gate-v3/guard8-account-v1/report-v1.md
[ordered-next]: misfits-repairs/2026-10-29/ordered/first-transfer-v2/semantic-gate-v3/guard8-account-v1/next-held-validation-plan-v1.md
[h02]: misfits-repairs/2026-10-29/integration/replay-H02-diagnosis-v1/report-v1.md
[h02-handoff]: misfits-repairs/2026-10-29/integration/replay-H02-diagnosis-v1/neighbor-ownership-current-main-v3/handoff-v1.md
[h02-qualification]: misfits-repairs/2026-10-29/integration/replay-H02-diagnosis-v1/neighbor-ownership-current-main-v3/result-qualification-v1.json
[h02-v5]: misfits-repairs/2026-10-29/integration/replay-H02-diagnosis-v1/v5-source-diagnosis-and-minimal-repair-v1.md
[follower]: misfits-repairs/2026-10-29/follower/report.md
[follower-freeze]: misfits-repairs/2026-10-29/follower/final-code-freeze-v2.json
[follower-integrity]: misfits-repairs/2026-10-29/prep-pr/follower-batch/publication-preparation/candidate-integrity-v2/report-v2.md
[integration-v9]: misfits-repairs/2026-10-29/integration/partial-v9-validation.md
[integration-v10]: misfits-repairs/2026-10-29/integration/partial-v10-validation.md
[native-shutdown]: misfits-repairs/2026-10-29/integration/native-shutdown-v1/EV-NATIVE-SHUTDOWN-001-result.md
[replay-report]: misfits-repairs/2026-10-29/prep-pr/replay-batch/evaluation/report-v3.md
[replay-r03]: misfits-repairs/2026-10-29/integration/combined-C2-R03-diagnosis-v1
[replay-preload]: misfits-repairs/2026-10-29/prep-pr/replay-batch/evaluation/initial-preload-repair-v1
[retirement-review]: misfits-repairs/2026-10-29/external-reviews-2026-10-30/retirement/report-v1.md
[retirement-audit]: misfits-repairs/2026-10-29/external-reviews-2026-10-30/retirement/independent-audit-v1.md
[retirement-integration]: misfits-repairs/2026-10-29/external-reviews-2026-10-30/retirement/integration-current-main-v1
[retirement-prep]: misfits-repairs/2026-10-29/external-reviews-2026-10-30/retirement/prep-pr-new-delta-v1
[metadata-review]: misfits-repairs/2026-10-29/external-reviews-2026-10-30/metadata/evaluation-current-main-v3.md
[metadata-account]: misfits-repairs/2026-10-29/external-reviews-2026-10-30/metadata/original-claim-accounting-addendum-v4.md
[metadata-handoff]: misfits-repairs/2026-10-29/external-reviews-2026-10-30/metadata/final-handoff-receipt-v3.json
[metadata-freeze]: misfits-repairs/2026-10-29/external-reviews-2026-10-30/metadata/current-main-candidate-freeze-v3.json
[errors]: misfits-investigations/pilot-2026-10-29/c-query-subset-errors/report.md
[loading-pilot]: misfits-investigations/pilot-2026-10-29/c-ordered-loading-lifetimes/report.md
[authoring]: ../.agents/skills/oracle-authoring/SKILL.md
[evaluate-review]: #required-skills
[prep-pr]: #required-skills
[issue-2315]: misfits-survey/supplement-2315.md
[issue-2317]: misfits-survey/supplement-2317.md
[p2-handoff]: https://gist.github.com/KyleAMathews/75bbadfbc449d798c9f0b9691a540406#file-p2-handoff-md

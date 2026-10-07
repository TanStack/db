# Issue 2056: full-mode recovery and subset demand

Review record, revision 1 — 2026-10-06. Reviewed head: `f43a16522c990134ae993235a312d2d5e433dc8a`.

Source: [issue #2056](https://github.com/TanStack/db/issues/2056), including its workaround, test offer, and #811 reference. The issue has no comments. This is an issue evaluation, not a PR review. The user authorized oracle changes, reproduction, and comparison of fixes; production implementation remains for their decision.

Worktree: `/Users/kyle.mathews/.codex/worktrees/evaluate-2056/tanstack-db`, branch `codex/evaluate-2056`, based on fetched `origin/main`. Dependencies installed from the lockfile offline with install scripts disabled. No branch or commit was pushed. Production source is restored byte-for-byte to the reviewed head. The changed tests intentionally fail on that head.

## Verdict and reviewer assessment

The reported capability mismatch is real and merits P1 treatment: a valid persisted restart rejects subset demand and live-query preload. The installed Electric SDK 1.5.15 reproduces it through the real Electric adapter and persistence wrapper. Tagged and untagged two-launch cases provide the distinguishing control.

The report overstates one causal step on current main. `subscribe()` already starts the stream. The receiving witness observes the full HTTP request before acquiring demand, then observes a ready source Collection with the correct replacement row alongside the rejected demand. Permanent `loading` and the necessity of deleting local data are not established here. The original Expo reproduction may have additional scheduling or version conditions.

Accuracy and signal are high; the report identifies the key mismatch, gives a useful restart sequence, and separates its workaround from a durable optimization. Analysis of settlement is incomplete. Readiness alone cannot discharge an applied-receipt obligation, and a one-time gate cannot cover later reset cycles. Hire recommendation from this debugging sample: **yes**, with a reservation about lifecycle and promise-boundary analysis; this single report does not assess broader engineering performance.

## Finding ledger

The original append-only ledger and raw JSON are in `review-evidence/issue-2056/`. IDs remain in source order, including the final footnote.

| ID | Original claim / proposed fix | Evidence and technical verdict | Disposition / PR action | Durable value and destination |
| --- | --- | --- | --- | --- |
| R1 | Tagged on-demand persistence works once, then fails on a new launch; Collection stays loading and every live query fails until data is cleared. | Core failure confirmed on main/adapter 0.5.5 with SDK 1.5.15. Both direct demand and public live-query preload reject. The source can still become ready with correct rows. The universal loading/deletion claim is not established. | `confirmed-open`, P1; select a repair. | Real-SDK two-launch receiver and the tag-history oracle. Exact Expo/version-specific hang remains under R6. |
| R2 | Loss of in-memory tags plus `requiresTagState: true` selects a full stream at initial offset. | Confirmed: the first launch durably writes the flag; a new descriptor and Collection request `log=full&offset=-1`. Untagged compatible resume requests changes-only at `2_0`. | `duplicate` of R1's mechanism; preserve the state distinction. | Resume evidence must account for tag membership. The coverage map now names the primary tag owner explicitly. |
| R3 | `loadSubset` calls `requestSnapshot`, which rejects in full mode before stream startup. | Illegal call and SDK rejection confirmed. Merely enforcing the SDK restriction makes three existing tests fail. “Before stream startup” is refuted for the tested current-main path: a full HTTP request already exists, and delivery can produce readiness. | `confirmed-open`, P1, for capability dispatch; retain the refuted causal clause separately. | Capability-aware mock and installed-SDK receiver. Final rows alone cannot establish successful acquisition. |
| R4 | Wait for first `markReady`, reject initial error, resolve collection abort. | A representative readiness-only prototype fixes the reported case but fails both held-application cuts. An applied-only startup gate fails a later same-run reset. Reporter supplied no patch, so these are evaluations of the described strategy, not their exact code. | `design-decision`: recommend a current-replacement applied gate. | Applied-settlement, reset-continuation, exact initial-error, and concurrent-cleanup witnesses in the Electric history owner. |
| R5 | Every tagged launch downloads the full shape; persist tag state with the resume state instead. | Current cold tagged recovery does use the full log. A durable tag ledger could avoid it, but storing the latest row headers is insufficient: silent moves can change selected membership and active conditions without a row write. | `design-decision`: separate optimization; it does not replace the capability repair for reset or uncertified baselines. | A future tag certificate must include complete selected membership/active conditions and be atomic with rows, offset, handle, shape identity, and key-set evidence. |
| R6 | Offered two-launch `node:test` witness uses Expo persistence over node:sqlite and a fake tagged server; fails 0.5.4 and passes their patch. | The offered fixture was not attached. Our SDK receiver uses the real persistence wrapper over the existing controlled durable-storage seam. It confirms the adapter problem but does not verify Expo, SQLite, a separate OS process, or the published 0.5.4 package. | `confirmed-open` evidence gap, within a declared external boundary. | Receiving owner: Expo persisted-collection E2E; obtain the reporter's fixture or reproduce the same schedule there. No need to delay the demonstrated adapter correction for that host claim. |
| R7 | #811 reports the same error in progressive mode. | Historical comparison is accurate. #811 is closed; its resolution identifies #852. Current progressive tests remain green with the strict provider mock. | `already-fixed` for the earlier progressive path; no duplicate progressive repair. | Preserve the broader lesson: dispatch from actual provider capability, not only configured sync mode. |

## What the report exposes about the laws

### L1. Acquisition must use the current provider session's capabilities

Authority: the installed SDK's `requestSnapshot` contract permits changes-only mode and rejects full mode. The adapter's full-recovery decision is necessary when persisted resume evidence is insufficient. The obligation is conditional on the chosen provider session; it does not require future designs to always choose full recovery if they can supply a valid complete certificate.

Primary owner: `electric-descriptor-isolation-oracle.test.ts`, specifically `runTagHistory`. It already generated eager/on-demand/progressive modes, warm/cold restart, reset/compatible resume, tagged/untagged/legacy evidence, and interrupted recovery. It already acquired a subset after restart. This was not chiefly a missing random input. Its permissive mock accepted an SDK-forbidden operation and returned success before the replacement existed. Tightening just that mock turned 3 of its original 30 tests red.

The repaired driver starts demand without requiring impossible early completion, allows persisted hydration to become visible while demand is pending, and asserts successful acquisition after full replacement. It retains partial-replacement, callback, durable-row, move-out, interrupted-restart, and post-completion demand observations. Bounded cases independently force cold tagged, cold legacy, untagged compatible, and explicit reset histories.

Receiving witness: `electric-sdk-delivery-oracle.property.test.ts` now reconstructs both launches through real `ShapeStream`, with direct demand and public live-query preload. It verifies the saved flag, actual HTTP mode/offset, correct source row, source readiness, and acquisition outcome. The tagged cases fail while the untagged cases pass. Authored HTTP messages and controlled durable storage remain explicit premises; a live service/native host is not inferred.

Encoding and enforcement: present for the named bounded and generated histories. The original implementation is rejected at subset settlement, not by a timeout or an unrelated setup error. This proves the mock restriction is material. It does not prove arbitrary native restart schedules.

### L2. Readiness, application, and replacement authority are different facts

Authority: `LoadSubsetFn` in `packages/db/src/types.ts` requires successful loads to await every receipt establishing their result. `SyncAppliedReceipt` describes visibility. `whenSyncAccepted` in `packages/db/src/sync-receipt.ts` deliberately lets Collection readiness precede application to avoid optimistic-transaction deadlock. Existing `publishes readiness once a held receipt is accepted` protects this distinction.

The main Electric oracle's opening prose incorrectly said readiness waited for applied receipts. It now matches the existing contract: acceptance before Collection readiness, application before subset success. Changing that prose does not change product policy.

The added law checker holds a real optimistic transaction, receives a complete source snapshot, observes Collection readiness while the source row is absent, and demands that subset settlement remain pending. Acquisitions before and after readiness matter: the latter must still account for a receipt created before its own commit cursor. Releasing the transaction must reveal the exact source row and allow success. Both cuts reject the readiness-only prototype at the explicit pending assertion.

A continuation starts a new demand after a same-run `must-refetch`. The previous completed snapshot cannot satisfy the new private replacement. The one-time applied gate fails this pending assertion. The candidate that renews its obligation on reset passes it. No change to global Collection readiness is necessary.

Encoding and enforcement: complete for those named cuts, including the distinguishing late acquisition and reset continuation. Empty full replacements, multiple resets overlapping held application, and independently cancelled sibling acquisitions still need dedicated witnesses before claiming closure across all such histories.

### L3. Failure and cleanup must settle retained waiters with the right authority

Authority: existing initial-error and cleanup laws in the Electric and Collection lifecycle owners. Two concurrent full-recovery demands reject with the exact initial stream error. Cleanup settles both and makes subsequent callbacks obsolete. Cleanup outcome is intentionally not constrained to one rejection shape; invalidation and quiescence are the relevant obligations here.

The checker distinguishes a provider error from cleanup. During development, an overstrong draft treated any error callback as invalidating all later provider callbacks. That is not the existing retry contract; the final test checks error settlement and reserves stale-callback assertions for cleanup.

Encoding and enforcement: named initial-error and cleanup schedules are enforced. General same-run recovery after errors, request-local abort timing, and native shutdown scheduling are outside these tests, not silently counted as green.

## Candidate fixes

All patches are evaluation artifacts under `review-evidence/issue-2056/`; none is applied to production in the final worktree.

| Option | Result | Assessment |
| --- | --- | --- |
| Wait only for first readiness | Reported restart and SDK receiver pass; both held-application cases fail. | Reject as a complete repair. Successful readiness is weaker than successful subset application. |
| Wait for initial full snapshot's applied receipt | Initial restart and both held-application cuts pass; another same-run reset exposes early success. | Better, but incomplete. |
| Wait for the current full replacement's applied receipt; renew the obligation after reset | All 238 runtime tests in the four affected suites pass, including public live-query consumers. Temporary prototype adds 31 production lines. | **Recommended direction.** Reuse the existing stream lifecycle and applied receipt; do not replace the lifecycle or change global readiness. Remaining scope is listed below. |
| Persist a complete tag certificate | Not implemented or experimentally validated. | Potential bandwidth optimization. Requires a separate storage/visibility design and migration coverage; full-mode demand handling is still needed for reset/uncertified evidence. |

Forcing changes-only mode or simply returning success removes the symptom by abandoning established obligations. Neither is an acceptable substitute for authoritative recovery or applied settlement.

The recommended prototype is deliberately reviewable, not declared ready to merge. It still needs the omitted boundary witnesses and review of per-request abort behavior, naming, and failure ordering. Its 31-line cost should be compared with simplifying existing completion machinery before final implementation. The user requested choices before a production repair, so these are open design/implementation items, not approved deferrals.

## Changes and verification

Changed production code: **zero final lines**. Three oracle files were strengthened, and their existing 81-line persistence fixture was moved into a shared 87-line support module. The support module owns no expected-result computation and is not a new oracle. Test net growth is 529 lines. This review record and the coverage-map entry are separate documentation weight.

- Original tag oracle: **30 passed**.
- Add only the SDK capability restriction: **3 failed, 27 passed**. Failures are the forbidden snapshot operation, not timeout/setup failures.
- Original other three suites: all runtime assertions passed (195 runtime tests), but the combined default run exited nonzero because fresh-worktree typechecking lacked the unbuilt package's self declaration. This is not reported as a clean baseline.
- Final oracles with unchanged main: **11 failed, 227 passed**. Six tag-history tests, three completion-law tests, and two real-SDK tagged restart tests fail at their promised behavioral comparisons.
- Readiness-only prototype: **2 failed, 6 passed** in the selected eight-case comparison; both failures are premature subset fulfillment under held application.
- One-time applied prototype: the same-run reset witness fails at `prior readiness is not replacement coverage`. The initial receipt checks pass.
- Reset-aware applied prototype: **238 passed** across descriptor isolation, SDK delivery, Electric histories, and recovery histories.
- Direct replay: seed `42712`, path `4:1:1:1`, property `electric.persisted-tag-history` reproduces the original violation with **1 failed, 30 skipped**. No fixed/random campaign precedes it.
- Focused TypeScript check with a temporary source alias for the unbuilt package self import: passes. Changed-test ESLint and formatting checks pass. The package lockfile was unchanged.

Runtime comparison command, from `packages/electric-db-collection`:

```sh
pnpm exec vitest run tests/electric-descriptor-isolation-oracle.test.ts tests/electric-sdk-delivery-oracle.property.test.ts tests/electric-oracle.property.test.ts tests/electric-recovery-oracle.test.ts --coverage.enabled=false --typecheck.enabled=false
```

Direct replay:

```sh
TANSTACK_DB_ORACLE_PROPERTY=electric.persisted-tag-history TANSTACK_DB_ORACLE_SEED=42712 TANSTACK_DB_ORACLE_PATH=4:1:1:1 pnpm exec vitest run tests/electric-descriptor-isolation-oracle.test.ts --coverage.enabled=false --typecheck.enabled=false
```

## Oracle-guide audit

| Requirement | Evidence / limit |
| --- | --- |
| ORC-001 authority | SDK mode restriction, LoadSubsetFn applied settlement, existing acceptance/readiness contract, and restart invalidation. Native and infinite-history limits are explicit. |
| ORC-002 independence | Existing row Maps/tag sets, exact source replacement rows, and controlled application obligations compute expected behavior. Production state-machine helpers are not copied into the model. |
| ORC-003 literate responsibilities | Opening/local prose names capability, settlement, history, real driver, and checkpoints. The shared persistence fixture remains driver support. |
| ORC-004 grammar | Existing 0–6 edits, keys 1–3, three tag names, full removal permutations, three sync modes, and four warm/cold × reset/resume paths remain. Tagged/legacy bits control recovery evidence; interruption controls retirement; edits vary payload and membership. Fixed cases reconstruct the report and reset/legacy neighbors. Updates target existing modeled keys; foreign/malformed moves are excluded. Longer histories and DNF restart are not claimed. |
| ORC-005 observations | Public and durable rows, actual SDK HTTP mode, raw promise outcomes, application hold, late demand, reset cut, error identity, and stale callback after cleanup. Query comparison retains payload values and cardinality; virtual metadata is outside this law. |
| ORC-006 calibration | Original SDK failure, readiness-only early success, and one-time gate early success at reset are rejected at explicit comparisons. Earlier wire-encoding/projection setup mistakes were corrected and are not counted as product RED evidence. |
| ORC-007 campaigns/replay | Tag fixed/random campaigns now have the same budget (10), generator, driver, and checker. Replay runs only the selected property; saved seed/path was executed. No new generated property was added. Other historical campaigns are not claimed comprehensively audited. |
| ORC-008 minimality | Existing tag model state is unchanged. Added promise outcome is an observation, not a replica state-machine copy. Before/after readiness and before/after applied receipt are legally distinguishable cuts. |
| ORC-009 vocabulary | Uses Collection readiness, acquisition, applied receipt, cleanup, restart, and truncate replay distinctly. Fresh descriptor/Collection stands in for loss of process-local state, not actual process restart. |
| ORC-010 fidelity/cleanup | SDK and receipt witnesses reuse `withElectricCleanup`/`atCheckpoint`. Primary tag owner retains existing finally cleanup. Replay reaches the same settlement mismatch. Injected cleanup-failure fidelity for the changed tag driver remains unverified. |
| ORC-011 alternate formulation | The real-SDK receiver challenges the permissive-mock hypothesis through actual HTTP dispatch. The held-application witness independently challenges readiness-as-application. No second full replica model is needed. |
| ORC-012 review evidence | This head-pinned record, raw report, append-only ledger, candidate patches, and exact run logs retain judgments and remaining boundaries. No bug-class closure is claimed. |
| ORC-013 distinguishing boundaries | Tagged versus untagged cold restart; explicit reset without tags; legacy unknown tag evidence; demand before versus after accepted readiness; same-run reset after completed recovery. Each rejects a named wrong design. |
| ORC-014 handoff | Mock capability restriction is received by installed SDK 1.5.15. Live-server subquery tag generation and Expo/native persistence have no new receiver here and remain explicitly open. |

## Remaining owners and loss audit

The coverage map records these witnesses as open: native Expo/SQLite and actual process relaunch; live Electric subquery/tag emission; missing/unknown key-set evidence with full-mode demand; empty full replacement; overlapping resets and held application; independent request aborts; persisted DNF active-condition reconstruction if tag certification is selected. Existing receiving owners are named there; no individual maintainer has been assigned.

Raw items were reread after the experiments. Accounting: **7 = 3 confirmed-open + 1 duplicate + 2 design-decision + 1 already-fixed**. No original item, workaround, test offer, or related-issue footnote was dropped. There are no `fixed-now` or `deferred` items. The subclaim about permanent loading is not conflated with the confirmed acquisition rejection.

Authorized reproduction, law audit, and candidate comparison are complete within the stated boundary. Production repair and whole-class closure are **not** complete; the user asked to review potential fixes first. Main still fails the strengthened tests, and the saved patches do not change that fact.

## Continuation: scoped on-demand recovery

Implementation worktree revision — 2026-10-07. Base head:
`0dfade1f600bd409019111cd89bf278d65a82d21` (#2059). The preceding
review verdict remains tied to its original head; this section records the
subsequent proposed contract and implementation. The user selected
bounded on-demand recovery after considering the full-shape cost. The Electric
guide now states the proposed change: when persisted resume evidence is
uncertified, the current SQLite wrapper keeps durable rows as cache but removes
them from the public source Collection, starts changes-only at `now`, and loads
only demanded subsets. This intentionally revises the former promise that all
cached rows remain visible through a cold full-shape replacement. Eager and
progressive recovery keep that promise and the full snapshot. The on-demand
full-stream fallback remains for a wrapper without scoped recovery support.

The implementation and its executable evidence are committed at
`7c2e6a4f640bbbef64c1045362b22346a8c46e21`. This audit reference is a
documentation follow-up, so the cited code revision remains immutable.

The first new receiver prediction was RED on the merged base: tagged direct
demand and live-query preload expected `log=changes_only` but observed `full`
(two failures, two compatible-resume controls passing). With the implementation,
the SDK receiver checks tagged, changed-shape, and malformed-state restart. It
observes a scoped HTTP request, no full baseline-row read, no local subset read,
applied demand settlement, stale B retained on disk but absent publicly, an
empty first or later B snapshot, and a third launch with no active demand. The
primary tag owner retains its generated restart grammar and distinguishes
durable cache from public rows when scoped recovery is selected. A separate
receiver checks that two concurrent demands invoke the installed SDK's
`requestSnapshot` one at a time; cursor tie/from legs also run in order.

Calibration: removing only the persistence hydration gate made all three
uncertified-cache receiver cases fail at the intended local-read assertion
before provider response. The original full-log dispatch failed at the HTTP
mode assertion. A controlled installed-SDK probe also showed that overlapping
responses can regress a shared row and offset when the later response arrives
first. A temporary production mutant that removed serialization was rejected by
automatic approval review, so this record does **not** claim an executed mutant
kill for the ordering witness. Its named invocation-order assertion and SDK
probe are narrower evidence.

Verification on this implementation revision: 367/367 tests pass across the five
affected Electric suites; 640 pass and one pre-existing TODO remains in the
SQLite persistence oracle; 6/6 sync-persistence capability tests pass. The
saved tag-history seed `42712`, path `4:1:1:1`, passes by direct replay. Electric
and SQLite persistence TypeScript checks pass; the Electric check uses a
temporary source alias for this fresh worktree's missing built self-declaration.
Changed source and oracle files pass ESLint and formatting checks. Production
weight is 119 added and 27 removed lines across Electric, persistence, and the
internal capability. The added state separates cache-authority from source
authority; a later demand legally distinguishes those states. The true full
stream's replacement gate and the shared SDK cursor queue are separate
obligations, not substitutes for quarantine.

| Guide requirement | Continuation evidence and limit |
| --- | --- |
| ORC-001 authority | The revised Electric guide is the proposed product authority in this branch; SDK capability, scoped source-snapshot meaning, and applied settlement remain established contracts. This is not yet a merged public guarantee. |
| ORC-002 independence | The A/B source Map predicts rows independently of Electric tag machinery and the persistence wrapper; the controlled adapter and HTTP server drive production only. |
| ORC-003 literate roles | The tag owner's opening/local prose and the SDK receiver's opening/local prose name law, model, histories, driver, public observations, and checkpoints. |
| ORC-004 grammar | The tag history's fixed/random generator, bounds, exclusions, and replay remain as recorded above. New lost-tag, changed-shape, malformed, empty-first/later, and idle cases are fixed receiving histories, not a new generated campaign. |
| ORC-005 path/observation | Real Collection, wrapper, and installed SDK see controlled HTTP; URLs, SQLite-adapter reads, durable rows, public rows, metadata, and acquisition outcomes are compared at named cuts. Native SQLite and live-service behavior are not inferred. |
| ORC-006 calibration | Original full-mode dispatch and the stale-hydration mutant fail at intended comparisons. The serialization mutant was not run; its claim remains bounded to the SDK probe and named order witness. |
| ORC-007 campaigns/replay | Tag fixed/random campaigns pass, and the saved seed/path was replayed directly after the repair. The new receiving examples do not claim generated-history coverage. |
| ORC-008 model state | The provider Map and durable cache are distinct because a later empty demand distinguishes them. The tag driver's scoped-recovery marker only selects the expected public/durable comparison under its generated history. |
| ORC-009 vocabulary | Collection, source snapshot, persisted restore, demand, applied receipt, public snapshot, and truncate replay retain glossary meanings. Local-only Collection clearing is not called an Electric source truncate. |
| ORC-010 failure fidelity | Existing lifecycle helpers preserve cleanup diagnostics. The stale-hydration mutant fails at the local-read assertion, not timeout or setup. |
| ORC-011 second formulation | The real SDK/HTTP path checks the controlled tag mock's capability assumption and the separate A/B cache model challenges a transport-only repair. Live-provider emission remains unverified. |
| ORC-012 review evidence | This continuation records new authority, predictions, RED, mutant outcome, GREEN, weight, and unresolved boundaries; the original ledger and earlier head-pinned findings remain intact. |
| ORC-013 boundary witnesses | Compatible untagged resume contrasts lost tags; changed shape and malformed evidence enter the same scoped path; empty-first/later and zero-demand cuts reject stale readmission and eager work. |
| ORC-014 handoff | Installed SDK receives the controlled provider frames. Live Electric tag emission, native Expo/SQLite, cross-tab invalidation during quarantine, and partial updates before a scoped baseline remain assigned in the coverage map. |

This evidence covers the controlled two- and three-launch on-demand paths,
bounded tag histories, full-mode fallback, and named public/durable observations.
It does not close arbitrary provider schedules, live service behavior, native
storage, or cross-tab recovery. No reachable in-scope counterexample is known
within the executed histories; the coverage map retains the other cells.

## Prep-PR review: coordinator authority during scoped recovery

Review continuation — 2026-10-07. Reviewed implementation head: `6f3149bf6`.
The review repair and its witnesses are committed at `5579d3005`.
The prep-PR review found a P1 counterexample to the scoped-source contract:
after an applied Electric subset snapshot, a coordinator notification could
reload an active paginated subset from empty SQLite cache and remove the public
source row. The old oracle omitted this coordinator cut. The review also found
one valid simplification: compute the on-demand changes-only decision once and
use it for both stream mode and the default offset. Two other simplification
ideas lacked a lifecycle witness and were not applied. The complete source-order
ledger is retained in the task's prep-PR review evidence.

The persistence oracle now crosses targeted, paginated, full-reload,
sequence-gap, and durable-reset notifications after applying a source row. It
fences coordinator processing and compares the public row with the source
model. The controlled installed-SDK receiver adds the paginated coordinator
cut after its scoped A snapshot. On the reviewed implementation, the targeted
and paginated cases failed at the post-invalidation public-row assertion. With
the repair, all five persistence cases and the installed-SDK receiver pass.
Removing each of the three recovery guards separately made a corresponding
controlled history fail; removing them together made all three scoped restart
cases fail at the SDK receiver's coordinator checkpoint. These are finite
mutant kills at named observations, not a claim about all coordinator schedules.

The repair keeps coordinator durable-cache notifications from hydrating,
truncating, or replacing public source rows while scoped recovery is active.
Electric source changes and demanded snapshots retain public authority in that
interval. Outside scoped recovery, coordinator invalidation follows its
existing path. Unknown and missing key-set evidence were also checked with a
held Node SQLite metadata read: startup avoids a full baseline read, leaves
cached rows unpublished, and applies only a demanded source snapshot.

Validation before merging the newer main branch: 647 Electric package tests
passed; the persistence oracle passed 645 tests with one existing TODO; the
persistence TypeScript check and changed-file ESLint passed with existing
warnings. The changed files passed formatting after the final oracle edit.
The coverage map names remaining native SQLite, real cross-tab transport,
live-service, and wider scheduling witnesses. This review closes the observed
controlled coordinator counterexample, not the whole scoped-recovery class.

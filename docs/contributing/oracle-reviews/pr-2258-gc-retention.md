# PR 2258: GC retention review and repair evidence

Reviewed commit: `f19f4908a3c0b8a91a696a2a77076e91230e4205`, PR [2258](https://github.com/TanStack/db/pull/2258).
Evaluation date: 2026-10-26. HEAD stayed at that commit during the experiments. The repair revision is the commit that first adds this record; its source fingerprints bind the evaluated tree without a self-referential commit hash. Publication was authorized after the review closeout. The [source fingerprints](pr-2258-gc-retention.sources.json) bind this evidence to the evaluated repair files.

## Laws, experiments, and inference

Automatic GC must respect the last release of a subscriber, pending preload, or persisting transaction. Eligibility begins after `gcTime`; host idle delivery determines when eligible cleanup runs. Startup without subscribers and preload completion establish a 50ms absolute handoff deadline. A real last unsubscribe removes that handoff constraint. Pending manual transactions do not retain a Collection. The maintainer explicitly decided during this evaluation that rollback without entering `persisting` preserves the existing deadline. Explicit cleanup remains the caller's authority.

Authority is `BaseCollectionConfig.gcTime`, the existing startup floor and preload contracts, and that explicit pending-rollback decision. The review correctly observed pending rollback refreshing retention, but its original claim of an already unambiguous public prohibition was too strong. The maintainer's decision resolves that policy question.

| Items and law | Existing oracle's actual reach | RED on unchanged production | Repair and distinguishing neighboring history |
| --- | --- | --- | --- |
| R01: obsolete idle work cannot bypass a renewed deadline | `advance` drained both elapsed timers and the idle polyfill; no transaction could intervene | Queued idle work, insert, settle, deliver idle: retired at 121ms instead of remaining active until 221ms. Chromium also retired at native core idle at 101ms instead of waiting until 201ms | Renewal cancels old timer and idle work. Complete, reject, and explicit persisting rollback run; a surviving sibling still holds the Collection |
| R02: settlement preserves the residual startup horizon | `gcTime` was always 100ms, above the 50ms floor | `gcTime=1`, fast settlement, idle at 10ms: retired instead of active. Generated delayed commit/settlement shrank to seed `20261026`, path `3:0:0:0`, idle at 49ms. Chromium reproduced the 10ms violation | Store one absolute handoff deadline. Check immediately before and at independently calculated eligibility. After late settlement or a real unsubscribe, an always-50ms delay fails |
| R03: pending rollback preserves the old deadline | Every manual write was committed inside its insert action | Pending insert, rollback at 90ms, native/controlled usable idle at 110ms: still active instead of retired at the original 100ms deadline | Capture whether rollback left `persisting`; only actual hold release renews retention. Delayed commit, pending-alone expiry, failure and persisting rollback remain distinct |

The oracle changes preceded production repairs. First the aggregate property and three reconstructions failed against unchanged production; the original two-Collection campaigns still passed. Then all three Chromium receivers failed at the intended public status comparisons. Proxy routing and sandbox port-binding failures were resolved before this gate; setup failures were not counted as RED.

The primary GC owner now has a companion independent law/model/checker in `packages/db/tests/collection-gc-retention-oracle.ts`, a generated controlled driver in `collection-gc-retention-oracle.property.test.ts`, and a native driver in `packages/db/e2e/collection-gc/`. The original two-Collection property retains shared-transaction and restart coverage. The boundary model stores logical holds, last release, transaction phases, and an absolute handoff deadline. It imports no production scheduler, GC classifier, or transition helper. Production callbacks never compute expected deadlines.

The controlled driver compares public `cleaned-up` status, active optimistic keys, and transaction phases after every legal action and microtask flush. It separates elapsed timer dispatch from idle delivery, including zero-budget and timed-out callbacks. Chromium saves native idle functions before Playwright installs elapsed clocks. It records the native budget core actually reads, checks after core callback delivery, and waits until outstanding native cleanup callbacks have delivered or been cancelled before a separate usable native observation. It shares the same expected-result computation. This establishes a native host boundary, not a real Electric provider boundary or a wall-clock latency guarantee.

## Grammar and declared reach

The boundary grammar varies release cause, `gcTime` in 1/10/49/50/51/100ms, age 0–80ms, complete/fail/rollback, a persisting sibling, zero to two no-budget idle periods, timeout delivery, eager versus write-started sync, pending rollback, delayed commit, and preload readiness. Disabled values include 0, -1, Infinity, -Infinity, and NaN. Original histories use two Collections, 1–14 commands, 20/60/120ms steps, and cleanup or success/failure drain.

Reconstruction uses the same model, driver, and checker for all three reported traces. Generated lanes reach the same violations through the new idle/phase/startup dimensions. Ablation: removing delayed idle loses R01; removing low delays or handoff age loses R02; removing pending/commit/rollback loses R03; removing siblings loses non-last release; removing real unsubscribe loses the distinguishing no-floor regime; removing preload loses a separate handoff owner; removing deadline-adjacent cuts admits unnecessary delay. The direct-write axis distinguishes write-started sync from an already eager sync. Disabled and idle-budget axes preserve neighboring GC and host contracts. Removing shared Collection writes from the original property loses retention for another touched Collection.

A nearby invalid history, settling a transaction before commit, is rejected by `gcActionLegal`; so are committing a settled transaction and unsubscribing a missing owner. Actions after retirement are excluded from the boundary lane; restart is exercised by the original property. This bounded grammar does not enumerate every legal permutation.

Each campaign asserts minimum reach of one history per declared state. Final normal run counts, fixed/random:

| Boundary state | Fixed 20261026 | Random |
| --- | ---: | ---: |
| queued-idle-renewal | 19 | 20 |
| startup-release-before-floor | 18 | 15 |
| last-unsubscribe-short | 9 | 7 |
| pending-rollback | 12 | 16 |
| pending-does-not-hold | 20 | 24 |
| sibling-persisting | 55 | 51 |
| preload-last-release | 22 | 15 |
| disabled-gc | 18 | 24 |
| delayed-commit | 25 | 19 |
| write-started-sync | 7 | 8 |
| late-release-short | 29 | 25 |

| Original property state | Fixed 20261024 | Random |
| --- | ---: | ---: |
| gc-due-while-persisting | 16 | 21 |
| retired-after-completion | 16 | 23 |
| retired-after-failure | 26 | 22 |
| retired-after-shared-settlement | 20 | 25 |
| settled-while-subscribed | 10 | 8 |
| cleanup-while-persisting | 13 | 12 |
| restarted-after-retirement | 13 | 8 |

Budgets are 150 histories per boundary campaign and 100 per original campaign. Random counts describe this execution, not a permanent distribution guarantee. Direct replay selects one campaign; both property IDs emitted exactly one `numRuns:1` witness for path `0`. The guarded runner also replayed `20261026 / 3:0:0:0` once: RED with the startup-floor mutant, GREEN after restoring the repair. Nonselected reconstructions and harness calibrations stand aside only during explicit replay.

## Calibration and verification

All six production mutants failed at intended public-status comparisons, not by timeout or setup failure. Production files were restored byte-for-byte after each:

| Wrong implementation | Rejected observation |
| --- | --- |
| Renew timer without cancelling old idle work | Premature retirement at stale idle delivery |
| Always impose 50ms after settlement | Missing retirement at the independently calculated deadline |
| Drop the startup floor | Retirement before the absolute startup horizon |
| Refresh on every failed transaction, including pending rollback | Missing retirement at the original deadline |
| Renew only after success | Failure/rollback retirement fails the renewed deadline law |
| Remove the persisting hold and settlement renewal | Original property: retirement while persisting; fixed seed 20261024, path `2:1:0:3:1:4` |

The cleanup calibration injects a primary checkpoint failure and a secondary adapter-cleanup failure. It proves every cleanup runs and that `AggregateError.cause` and `errors` preserve the primary and secondary diagnostics. This repairs a harness-integrity risk; no corresponding production defect was claimed.

Executed GREEN checks:

- Core suite: 287 files, 13,798 tests, no configured type errors. Final harness-only edits were followed by the two GC files: 8 tests, no type errors.
- Native Chromium: all three receiving histories pass, with request/delivery/cancellation premise checks. The existing browser E2E job now runs this receiver and uploads its evidence directory.
- Electric adapter: 252 runtime/type checks pass after building its generated declarations. Initial runtime assertions passed but declaration resolution failed; that initial run was not counted as GREEN.
- React conformance: 83 checks pass. Offline transactions: 20 files, 301 tests pass.
- Full DB `tsc --noEmit`, changed-file oracle lint, focused ESLint, private-member cache check, and diff whitespace check pass.

`pnpm size:compare --packages db --files` against merge-base `427a7c31e` on `origin/main`: DB +54B gzip/+128B brotli; typical app +58B gzip/+140B brotli. These are the entire PR plus repair deltas. Test/docs growth is excluded from shipped bytes. The repair adds 31,591 uncompressed bytes of oracle/test/driver source and 23,459 uncompressed bytes of documentation and changeset source relative to the reviewed head. The repair consolidates scheduling through the existing lifecycle entry points and shares the queue's elapsed clock, removing its per-instance clock field (24 fewer minified module bytes). Remaining growth pays for a distinguishable absolute handoff deadline and phase-specific release notification. Dropping that state or replacing it with a fresh 50ms delay fails calibration; no additional lifecycle state machine was added.

## Lossless review ledger

The task-local append-only intake retained each claim, severity, original location, and proposed fix before evaluation edits. This table records every source-order item from the raw review, including prose outside the numbered findings.

| ID | Original claim and proposed action | Verdict and disposition | Durable destination |
| --- | --- | --- | --- |
| R01 | P2 stale idle at lifecycle.ts:334–336; cancel/invalidate old work | Reproduced in controlled and native drivers; fixed-now | Lifecycle renewal and shared GC boundary owner |
| R02 | P2 startup floor at same lines; preserve grace without imposing it after unsubscribe | Reproduced; fixed-now with residual absolute grace | Shared model, low-delay/age grammar, deadline cuts |
| R03 | P3 pending rollback at transactions.ts:713–719; distinguish real hold release | Timing change reproduced; original authority qualified; maintainer chose preserve deadline; fixed-now | Public gcTime prose, transaction notification, pending/delayed-commit lanes |
| R04 | P3 direct replay executes twice; select one case | Original witness had duplicate executions; fixed-now, each target now emits one witness | Registration and replay manifest |
| R05 | Missing head-bound ORC-012 record; preserve requirement/calibration evidence | Confirmed; fixed-now in this tracked-path record and source fingerprints, pending commit with repair | This record |
| R06 | Missing idle/startup/pending reconstruction and incomplete grammar controls | Confirmed; fixed-now with dimensions and explicit reconstruction/ablation/range/exclusion analysis | Primary boundary property and grammar section above |
| R07 | Finally can hide mismatch or stop release; improve failure fidelity | Valid conditional harness risk, not a reproduced product bug; fixed-now and calibrated | Existing failure-preserving utility, controlled/native cleanup |
| R08 | No distinguishing startup threshold witness | Confirmed; fixed-now with low/equal/high delays and before/at deadline cuts | Boundary grammar and always-50/no-floor mutants |
| R09 | No native idle or real Electric awaitTxId/GC receiver | Native part fixed; real Electric receiver remains confirmed-open as an evidence gap, not a known production counterexample | Coverage-map Collection lifecycle row; Electric E2E registration |
| R10 | Exact retirement timing overclaims real-host promise | Confirmed wording issue; fixed-now, separate eligibility from idle opportunity | Public prose and both oracle contracts |
| R11 | Model `pending` means pending handlers rather than transaction phase | Valid ambiguity; fixed-now: original uses `pendingHandlers`, shared model uses actual phases | Both oracle models |
| R12 | Size author-reported and broad suites unrun | Accurate original limit; fixed-now for size/core/React/Electric/offline checks; other framework/provider schedules remain outside this evidence | Verification section and coverage map |

Loss audit: 12 raw items = 11 fixed-now + 1 confirmed-open. No raw item was merged away, refuted, deferred, or assigned an invented owner. R09 preserves its partial native repair and its remaining provider evidence separately. This is not permission to drop a promised integration path. It prevents claiming that this core/native experiment proves that provider path.

Independent challenge additionally caught an invented native idle-budget premise and missing late-release, delayed-commit, and disabled-value grammar distinctions during test authoring. Those were corrected; no extra production counterexample was found. A final fresh challenge independently ran 12 retention/queue tests and found no additional production bug.

## Rubric outcomes and limits

| Requirement | Outcome |
| --- | --- |
| ORC-001 | Laws and authority traced above; pending rollback authority is an explicit decision |
| ORC-002 | Shared reducer derives eligibility from logical holds and elapsed law, without production semantic imports |
| ORC-003 | Opening law, adjacent model/grammar/driver prose, and shared checker remain executable documentation |
| ORC-004 | Reconstruction, axis ablation, bounded ranges, and illegal neighbors recorded above |
| ORC-005 | Real public Collection paths; status, row visibility and phase checks after every action; native delivery checks. No missing core input hypothesis identified; no exhaustive information-sufficiency proof claimed |
| ORC-006 | Six wrong designs rejected at status comparisons; guarded mutant replay preserves the same checkpoint |
| ORC-007 | Equal-budget fixed/random campaigns plus exactly-once seed/path replay; no fc.commands replay path is applicable |
| ORC-008 | Holds, phases, sibling identity and handoff horizon each change a legal next action or public idle observation; retired state excludes unsupported boundary-lane restart |
| ORC-009 | Canonical Collection/transaction/cleanup vocabulary; model handoff and elapsed fields explicitly local |
| ORC-010 | Failure-preserving teardown plus injected primary/secondary failure calibration; native callback failures retained and page errors checked |
| ORC-011 | Not triggered: no concrete shared semantic fault requiring a different reference formulation was identified |
| ORC-012 | This reviewed-head record, source fingerprints, law/history/path/checkpoint limits and loss audit |
| ORC-013 | Before/at threshold cuts reject always-50 and no-floor rules, including true unsubscribe and late release |
| ORC-014 | Native Chromium supplies the controlled host's idle premise through the same model/checker. Actual Electric provider transfer remains open in R09 |
| ORC-015 | All seven original and eleven companion declared states reached in both normal campaigns; minimum enforced |

The new grammar does not generate warm-preload overlap, preload failure, commit after a pending transaction's Collection retired, or restoration of offline/paced mutations. Existing broader suites passing does not fill those exact GC history cells. The GC boundary owner is the receiving owner for preload/retirement history extensions; the Electric E2E registration is the receiving owner for real provider confirmation. No known reachable in-scope production counterexample remains in the exercised core/native domain. Finite campaigns and mutants are not universal closure proofs.

A real Electric/Postgres confirmation across GC eligibility remains unverified. At evaluation time the default Electric health endpoint on localhost:3000 and Postgres listener on port 54321 were unavailable. No provider setup failure was counted as evidence. A future witness must hold genuine confirmation past eligibility while the mutation persists, then observe successful caller settlement, Collection status, and renewed eligibility. An ordinary adapter awaitTxId test is not that witness.

Reviewer assessment: hire for substantive debugging. The two P2 findings were precise and experimentally supported, with high signal and useful test-gap diagnosis. The P3 observation was correct but initially stated stronger authority than the public prose supplied. Proposed repair directions were sound but needed residual-grace, idle-budget, late-release, and receiving-path analysis. The principal review was produced in this task; fresh independent challenges support its technical conclusions but do not make this an independently scored hiring trial.

At review closeout, before publication was authorized, published PR readiness was **not ready**. The published head still has the three confirmed defects, despite all 26 reported CI checks succeeding. Repaired working-tree readiness: **unproven**. Local repairs and bounded oracle coverage are complete for the exercised core/native paths, but had not yet been committed or pushed; final pushed-head CI and the named Electric integration witness have not been verified. Review accounting is complete; provider evidence remains open.

## Reproduction commands

```sh
pnpm --dir packages/db exec vitest run tests/collection-gc-transaction-oracle.property.test.ts tests/collection-gc-retention-oracle.property.test.ts --coverage.enabled=false
pnpm --dir packages/db test:collection-gc:browser
TANSTACK_DB_ORACLE_PROPERTY=collection-lifecycle.gc-retention-boundaries TANSTACK_DB_ORACLE_SEED=20261026 TANSTACK_DB_ORACLE_PATH=3:0:0:0 pnpm --dir packages/db exec node --import tsx tests/oracle-replay.ts tests/collection-gc-retention-oracle.property.test.ts --coverage.enabled=false --typecheck.enabled=false
pnpm exec tsc --noEmit --project packages/db/tsconfig.json
pnpm lint:changed
pnpm size:compare --packages db --files
```

In proxy-managed environments, native tests need localhost excluded from the proxy. Test logs and the original review were retained in task-local `/private/tmp/pr-2258-review/`; verdict-critical results are summarized here so the versioned evidence does not depend on those temporary files.


## Second review follow-up, 2026-10-26

The [second review and enforcement record](pr-2258-gc-retention-round2.md)
supersedes this evaluation's open provider cell and narrower grammar limits.
The maintainer chose fixture-specific first-idle timing and caller subscription
ownership of pending draft visibility. Expanded exact-row and cleanup histories
found and repaired sibling-row resurrection during and after explicit cleanup.
Real Electric/Postgres confirmation now has four executed receiving histories
and a no-hold runtime mutant rejected at the shared comparison. The original
results and open verdicts above remain a record of the earlier evaluation;
current sources are bound by the manifest's appended round-2 entry.

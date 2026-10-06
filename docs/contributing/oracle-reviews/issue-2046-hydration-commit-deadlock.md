# Issue 2046: source commits inside shared hydration scopes

The initial entry below records the frozen 24-core/12-browser candidate. The
[follow-up loss audit](issue-2046-hydration-loss-audit.md) supersedes its oracle
enforcement claims and results. In particular, the original aggregate receipt
check and browser cleanup capture were weaker than described here; the follow-up
preserves those losses and strengthens the executable checks.

## Scope and verdict

[Issue 2046](https://github.com/TanStack/db/issues/2046) reports one **P1
persistence deadlock**, expressed through nine claims below. The report is an
issue, not a pull request. Checked source:
`65992aacda530fde89f4c8ffa803b60cd708c425` (`origin/main`, fetched 2026-10-06).
The worktree branch is `codex/issue-2046-red-oracles`.

The current-main defect is confirmed through both the controlled persisted
history owner and real Chromium OPFS. The requested deliverable is red
reproductions. Production is unchanged; a temporary repair was calibrated and
then restored byte-for-byte. No issue comment, PR, push, or release was made.

## Reviewer assessment

The reporter accurately identified the default coordinator, the lost scoped
adapter, both hydration entry points, the effect on a peer Collection, and two
working controls. The report has high technical depth and signal, appropriate
urgency, and a narrow implied repair: honor the supplied scoped adapter while
retaining the registered adapter for ordinary commits. The calibration supports
that repair within the tested bounds. Strong positive hiring signal for debugging
and causal analysis, with the qualification that one report is limited evidence.

The release cutoff needs qualification. The repository changelogs list #1868
under core 0.3.0/browser 0.2.24, earlier than the report's core 0.4.0/browser
0.2.25 cutoff. This evaluation did not execute historical published packages,
so it does not establish the earliest affected release or pre-0.4.0 success.

## Finding ledger

The task-local append-only ledger was created from the complete issue body
before test edits. There were no issue comments. IDs preserve source order;
related observations are not treated as additional independent product defects.
All nine remain `confirmed-open` against unchanged production. For verified
control claims, that disposition refers to the associated open defect; those
controls need no behavior change.

| ID | Original claim / suggested remedy | Evidence | Technical verdict | PR action | Durable value / destination |
|---|---|---|---|---|---|
| R1 | A buffered startup commit hangs without rejection; source remains loading. Expected receipt and readiness progress. | Four core scoped startup histories fail at public-adapter reentry. Two real OPFS startup cases record pending receipt, source loading, peer loading, no receipt error. | Confirmed, P1. Illustrative ~100 ms timing is not promoted into a latency contract. | Leave red; repair remains open. | Primary routing matrix and OPFS receiver. |
| R2 | On-demand `subscribeChanges(..., { includeInitialState: true })` hydration also deadlocks; source stays ready. | Four core scoped subscription cases and two OPFS subscription cases reach the same cycle. Source ready, peer loading, receipt pending. | Confirmed, P1. Subscription status itself is already ready in the observed trace; it is not a settlement witness. | Leave red. | Subscription history axis and explicit hydration completion gate. |
| R3 | Other Collections sharing persistence cannot become ready. | Real peer b starts during a's held hydration. Its status is loading at all four cycle checkpoints; it reaches ready in every repaired history and every workaround control. | Confirmed, P1, for a peer queued behind the cycle. Does not imply already-ready peers become loading. | Leave red. | Public peer-status check in OPFS receiver. |
| R4 | SingleProcessCoordinator drops scopedAdapter and uses its scheduled adapter; BroadcastCollectionCoordinator forwards it. Implied fix: retain the scope. | Coordinator source and caller contract; causal reentry assertions; temporary scopedAdapter fallback repair makes all histories pass. | Confirmed, P1; proposed repair is narrow and idiomatic. | Keep production unchanged; repair open. | Routing assertion, calibration patch described below. |
| R5 | Shared scheduling + default coordinator + buffered hydration commit are required for the reported cycle. | Controlled unscheduled adapter cases pass. Real BrowserCollectionCoordinator cases pass. Moving the commit to onFirstReady passes. | Confirmed for this bounded cycle. Custom broken coordinators and other deadlocks are not excluded. | Retain all ablations. | All three grammar axes remain executable. |
| R6 | Commit from onFirstReady is a workaround. | Four real OPFS after-ready histories pass, crossing both coordinators and both baselines. | Confirmed control. | No behavior change. | Executable after-ready control. |
| R7 | Passing BrowserCollectionCoordinator is a workaround. | Six real OPFS cases pass, including both hydration phases and both baselines. | Confirmed control on one Chromium tab. | No behavior change. | Real coordinator receiving witness. |
| R8 | Introduced by 98639f03/#1868; first affected core/browser/DB versions are 0.4.0/0.2.25/0.11.0, earlier versions work, current main still broken. | #1868 added shared scheduling and the scoped coordinator argument without updating SingleProcessCoordinator. Main is executable RED. Changelog places #1868 under core 0.3.0/browser 0.2.24. | Current defect and causal change supported. Earliest-release and earlier-success assertions remain unverified and conflict with the changelog placement. | Do not claim a validated release cutoff. | Preserve historical evidence gap here; a release-bisect witness is needed before publishing a cutoff. |
| R9 | Empty database suffices; existing data does not remove the bug. | Both empty and one-row baselines reproduce in core and actual OPFS. Each browser case opens an isolated database. | Confirmed within the named baselines. | Retain both cases. | Baseline axis in both owners. |

## Law coverage and enforcement

**Authority.** `PersistenceAdapter.runInHydrationScope` requires nested work to
use the supplied unscheduled adapter and forbids retaining it past the callback.
`PersistedCollectionCoordinator.requestApplyCommittedTx` explicitly accepts
that adapter. The persisted-history contract promises durable or observably
failed source work. The applied-receipt and Collection-readiness contracts make
unreported self-deadlock unacceptable. No new recovery or product policy is
introduced.

**Original gap.** The primary `persisted-oracle.test.ts` recording adapter had
no shared hydration scope by default. It could flush buffered commits without
exposing coordinator reentry. `shared-logical-scheduling-oracle.test.ts`
exercised core-adapter scopes directly, without a wrapped source commit through
the default coordinator. The browser fairness grammar scheduled independent
persists and cold hydrations, not a persist awaited inside its owning hydrate.
Each separate test could be green while this composition was broken.

**Primary owner.** The appended `hydration source durability routing` matrix in
`packages/db-sqlite-persistence-core/tests/persisted-oracle.test.ts` adds 24
bounded histories: phase {startup, subscription, after-ready} × adapter
{scoped, unscheduled} × baseline {0,1} × source transaction count {1,2}.
Both source transactions insert distinct keys. The independent snapshot rule
is baseline plus source inserts; the independent routing rule forbids
reacquisition of an already-owned hydration scope. The model does not simulate
the production scheduler.

At the held-read cut, receipts remain pending and source inserts are absent
from public rows. At the durability-admission cut, an event records any
public-adapter call under the owning scope. That event competes against
successful completion; the original fails an assertion, not a test timeout.
On success, the oracle compares public rows, recording-adapter durable rows,
ordered mutation-key batches, receipt completion, and Collection readiness.
The fixture releases its diagnostic reentry gate in `finally`, allowing all
work and Collection cleanup to settle without replacing the original failure.

**Real-provider receiver.**
`packages/browser-db-sqlite-persistence/e2e/hydration-commit-oracle.opfs.spec.ts`
and its directly named page driver run 12 histories: the same three phases ×
{default, BrowserCollectionCoordinator} × {empty, one stored row}. The driver
uses `createBrowserWASQLitePersistence`, its real shared scheduler, actual
`BrowserWASQLiteDriver`, and Chromium OPFSCoopSyncVFS workers. Startup commits
inside `sync()`, matching the report. Subscription commits occur after a real
row SELECT completes but before its result returns to hydration. All wrapped
adapter calls forward to production unchanged. Source/peer readiness and
receipt settlement are observed; successful histories also read durable rows.
The subscription history awaits completion of the actual hydration scope,
since a `ready` subscription status alone does not establish load settlement.

The original reaches a real scheduled `applyCommittedTx` while hydration awaits
that call. The observation is frozen at that cycle, then the worker is closed.
Playwright closes each isolated page/context even on assertion failure. Success
also checks Collection cleanup and provider-close diagnostics. This is a
causal finite cycle witness, not a claim of proving unbounded eventuality by
waiting a chosen number of milliseconds.

**Encoding/enforcement answers.** The stated finite grammar is fully reachable
and its routing, held-read, and successful-result obligations are asserted at
the cuts above. Original main is the hostile subject: eight core routing
assertions and four real OPFS cycle assertions reject it. The temporary narrow
repair passes those same histories. No expected-failure marker, waiver,
classifier, timeout acceptance, or skipped failing case was introduced.
Successful durable-row checks prevent a coordinator from satisfying the law
merely by returning without storing the insert.

**Limits/open cells.** This reproduces one scheduler/coordinator bug class; it
does not close production repair. The bounded grammar does not establish
update/delete/truncate, metadata-only commits, failures, abort/cleanup races,
multiple scoped peers, distinct schema adapters, restarts, arbitrary payloads,
or other browsers/hosts. The persisted-history owner retains those source and
lifecycle dimensions as future witnesses; the OPFS owner retains the receiving
host cases. Exact release attribution needs historical package execution.
These limits are recorded in the coverage map, rather than erased by a green
calibration. No general claim of class closure is made.

## Calibration and exact verification

Temporary change, **not retained**:

```diff
 public async requestApplyCommittedTx(
   collectionId: string,
   tx: PersistedTx,
+  scopedAdapter?: HydrationPersistenceAdapter,
 ): Promise<ApplyCommittedTxResponse> {
-  const adapter = this.collectionAdapters.get(collectionId)
+  const adapter = scopedAdapter ?? this.collectionAdapters.get(collectionId)
```

| Run | Result | Interpretation |
|---|---|---|
| Complete persisted-history suite, original production + new matrix | 8 failed, 395 passed, 1 existing todo | Only the eight scoped hydration histories are red. |
| Real OPFS matrix, original production | 4 failed, 8 passed | Both hydration phases fail with default coordinator, with either baseline. Both workarounds pass. |
| Complete persisted-history suite, temporary repair | 403 passed, 1 existing todo | Same law, histories, and assertions. |
| Real OPFS matrix, temporary repair | 12 passed | Same actual provider/coordinator paths. |
| Restored production | Same 8 core and 4 OPFS failures | Final deliverable intentionally remains red. |
| Core package TypeScript + focused browser oracle TypeScript | Passed | Full browser package check requires unrelated Electric/pg dependencies unavailable in the partial dependency setup. |
| ESLint, changed TypeScript/config files | No errors | 22 pre-existing require-await warnings in the large primary oracle; none in the appended matrix. |
| Existing real OPFS cold-hydration control | Passed | Provider setup was independently checked. |

Runs used Node 24.19.0, Vitest 3.2.4, Vite 7.3.6, TypeScript 5.9.3,
Playwright 1.60.0, Chrome 154.0.8037.98, and wa-sqlite 1.5.0. Full frozen
installation failed on the configured registry and the public-registry
fallback. Cached tools were reused; source aliases target this worktree's
`db`, `db-ivm`, and persistence-core source, not another checkout's builds.
The lockfile remains unchanged.

Exact local commands, from the worktree root:

```sh
node node_modules/vitest/vitest.mjs run --config node_modules/.cache/issue-2046/vitest.config.ts --reporter=dot
node node_modules/typescript/bin/tsc --noEmit -p packages/db-sqlite-persistence-core/tsconfig.json
node node_modules/typescript/bin/tsc --noEmit -p /private/tmp/issue-2046-audit/browser-types.json
```

From `packages/browser-db-sqlite-persistence`:

```sh
PATH="$PWD/../../node_modules/.bin:$PATH" node node_modules/@playwright/test/cli.js test --config playwright.opfs.config.ts hydration-commit-oracle.opfs.spec.ts --reporter=line --timeout=15000
```

The ordinary package test glob includes the appended core matrix; the existing
Playwright OPFS configuration now registers the browser spec. The local source
alias runner and append-only working ledger remain ignored/task-local. Raw
source and logs are in `/private/tmp/issue-2046-audit/`.

## Oracle guide audit

| Requirement | Outcome |
|---|---|
| ORC-001 | Scope contract, coordinator API, and receipt/readiness authorities named; finite limits stated. |
| ORC-002 | Independent input-derived rows and no-reentry rule; no production scheduler model copied. |
| ORC-003 | Prose beside both executable owners identifies contract, relation, grammar, driver, and cuts. |
| ORC-004 | Bounded enumeration, not a random generated property. Reconstruction reaches both reported traces. Ablating scope, coordinator choice, or timing loses the relevant distinguishing cells. Baseline 0/1 and commit count 1/2 are explicit bounds. Open uncommitted transactions and storage failures are excluded. |
| ORC-005 | Real wrapper/default coordinator exercised in core; actual Chromium OPFS receiver supplies shared scheduling. Exact public rows, readiness, and receipt facts checked at named cuts. |
| ORC-006 | Original production rejected at the routing/cycle assertion; temporary repair passes. Setup failures during fixture development were not credited as RED evidence. |
| ORC-007 | Not applicable: finite matrices, no random generated property or shrinking. Test names directly select each history. |
| ORC-008 | No new stateful reference machine. Gates and scope flags are driver instrumentation, not semantic expected-state transitions. |
| ORC-009 | Glossary terms retained. Scoped/unscheduled describes the supplied adapter boundary; no new product lifecycle state. |
| ORC-010 | Core finally releases controlled gates and uses existing cleanup diagnostics. Browser freezes observations, closes worker/database, and relies on isolated page/context disposal on red assertions. No shrinker can replace the failure. |
| ORC-011 | Controlled single-process scope premise could hide production scheduling behavior. The real browser scheduler/SQLite receiver supplies that premise independently; browser coordinator and post-ready controls distinguish it. |
| ORC-012 | This record is tied to the exact source head and records all requirements. No production bug-class closure claim. |
| ORC-013 | Scoped versus unscheduled, during versus after hydration, and default versus browser coordinator distinguish the conditional routing law. |
| ORC-014 | Real Chromium OPFS startup/subscription cases receive the controlled core premise, including real row reads and the default shared scheduler. Other hosts remain outside the claim. |

## Loss audit and remaining work

Returned to the complete raw body, including its cause chain, condition list,
example, table, release assertions, database-reset note, and workarounds. Nine
items remain accounted for: **9 confirmed-open; 0 fixed-now; 0 stale; 0 refuted;
0 accepted-design; 0 deferred; 0 design-decision; 0 duplicate**. There is one
underlying P1 defect, not nine separate bugs. No permission to defer an
in-scope repair was inferred: this request explicitly asks for red reproduction.

The evaluation/reproduction work is complete on unchanged main. Production
repair is intentionally open. There is no blocking product-policy choice.
The historical release cutoff is an evidence gap, not a refutation or a
validated pre-0.4.0 compatibility claim. Worktree changes add tests, runner
registration, and contract evidence only; production line delta is zero.

Weight: production +0/-0; tests, fixtures, and runner registration +522/-0; contract/review documentation +241/-0.

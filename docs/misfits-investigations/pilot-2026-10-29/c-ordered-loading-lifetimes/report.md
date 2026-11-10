# Ordered loading / refetch, repair, and request lifecycle

Frozen baseline: `07bfc0eb2584fd83a3efc14ec1fb452954a829ea`. Mode: **INVESTIGATE**. No production repair, commit, push, issue mutation, or skill edit. All production mutants were isolated and restored. Eighteen initial source-order claims are preserved in `claims.jsonl`; this report does not combine their IDs.

## Current judgment

| Source | Current result | Category and action |
|---|---|---|
| #2214 | Exact seed/path still omits a backend row inside source coverage after the held mutation releases. | **product-bug**, confirmed-open. Exact evidence sent to the refetch owner; no competing edit to that oracle. |
| #2222 | An explicit qualifying source-order invalidation in the retirement callback is reached, but no replacement authority follows. | **product-bug**, confirmed-open at the core loader. Public wrong-row consequence and suggested epoch remedy remain unverified. |
| #2223 | In the bounded first-demand receiver, replay unloads each replaced physical acquisition; old transport rejection adds no acquisition. Later cursor-demand retirement is not exercised. | **coverage-gap**, broader allegation unverified. Extend the primary lifecycle/replay receiving path before deciding it. |
| #2260 | The attachment starts one full-source request before first settlement; its after-settlement control starts none. Both show 51 rows. | **contract-decision**. Current architecture explicitly requires full recovery for a genuine invalidation before any source request settled. A stronger bounded-first-result promise needs a decision. |
| #2268 | Both exact shrunk histories and existing unindexed generated campaigns pass. Restoring the exact removed prefix fallback recreates both source assertion values. | **product-bug**, already-fixed under the later adopted prefix-growth contract. Preserve two exact shared-checker replays. |
| #2296 | Original ledger RED is real, but request 5 is a deferred refill of the same repair as3/4. Replay bookkeeping cleared the oracle's continuation flag. | **model-harness-defect**. Corrected independently of production; exact replay and handoff/reset campaigns pass; original bookkeeping ablation fails. |

These are not one bug. #2214 is a Query DB receiving observation; #2222 is core debt progression; #2223 is acquisition versus logical-demand ownership; #2260 asks for a stronger pre-settlement work bound; #2268 is the already-adopted unindexed-growth behavior; #2296 is an oracle classifier defect.

## Laws, owners, and neighboring guarantees

The normative authority is `packages/db/src/query/live/ARCHITECTURE.md`, particularly “Ordered requests, continuation, and recovery”, source cancellation/applied settlement, and truncate replay. The glossary distinguishes a logical demand, physical acquisition, acquisition attempt, and transport. A transport can outlive abort; its late outcome does not revive its authority. Existing output alone did not authorize any expectation change.

- The request-authority owner is `ordered-source-loader-state-oracle.test.ts`: an outside-loader request ledger judges held repair acquisitions, covering authority, progress, error identity, ordering-epoch replacement, and work after drains/retries. It intentionally leaves pre-truncate ownership to replay.
- The value/work owner is `ordered-work-oracle.property.test.ts`: independent source rows and eligibility are sorted/filtered for public windows, while provider ledgers count requests. The no-full-source signalling-refetch guard currently includes unindexed windows.
- The Query DB receiving owner is `refetch-ordered-prefix-oracle.test.ts`: after a refetch behind an optimistic hold, its public window and source-prefix coverage checkpoint moves to the transaction's release. Another worker owns its changes.
- `collection-subscription-lifecycle-grammar-oracle.ts` supplies the shared logical-owner/acquisition-attempt model. `load-subset-replay-refinement-oracle.test.ts` supplies real ordered replay histories, retention, errors, convergence and release upper bounds. The #2223 supplemental probe reuses the first model; it does not create a replacement owner.
- `optimistic-history-oracle.ts` states accepted versus visible sync, held optimistic settlement, and release publication. It informs the #2214 checkpoint; this investigation does not diagnose that subsystem.

Neighboring laws retained: no early release of successful covering demand; no release twice; replay owns pre-truncate requests; a newer ordering epoch replaces stale continuation; a dead transport cannot regain authority; replacement retirement deletes do not themselves invalidate coverage; a distinct qualifying invalidation still matters; full-source reads remain available for failures, unexpressible boundaries and initial unproven coverage; prefix growth must terminate when another growth adds no rows. No run budget was lowered or removed.

The source-order IDs and their latest dispositions are in [claims.jsonl](claims.jsonl). In particular, **2214/C02** is the unverified #2206 cause hypothesis, and **2222/R01** is the unverified epoch-comparison remedy. Both are classified `non-behavioral` / `unverified` as proposals about the work; the distinct underlying defects **2214/C01** and **2222/C01** remain `product-bug` / `confirmed-open`. These hypothesis/proposal IDs do not add confirmed product findings. Append-only correction events preserve the earlier labels and explain the distinction.

## #2296: classify the refill by what caused it

E01 ran the source command with `-t 'random campaign'` and a replay path: **zero tests executed**,23 skipped. The module registers a replay campaign when PATH is present. This was invalid evidence, not GREEN. E02 corrected the selector and independently reproduced the exact `no leak` failure.

The shrunk history is retained by the shared driver: settle oldest success; settle oldest success; deferred report; shrink move; joinedBusy; settleNewest. Flags: unindexed,limit 1,settledFirst,syncRepair,joined,releaseTruncates,snapshotRows1,needsMore.

| Request | Observable role | Why it matters |
|---|---|---|
|0|Initial prefix 1|Its retirement triggers truncate.|
|1/2|Initial tie1 / prefix 2|Pre-truncate; replay owns these.|
|3|Post-truncate bounded repair prefix 1,refetch:true|Starts repair authority in ordering epoch 1.|
|4|Tie1,refetch:true|Same repair; joined work defers its next refill.|
|5|Prefix2,refetch:true|The deferred refill staged by4, not a new authority start.|

The diagnostic trace immediately after the last command records an owed continuation and a staged `more` with `continuesOrderedPrefixRepair:true`. Replay settlement finishes retirement; it does not run the graph pass that consumes that continuation. The old generic `run()` wrapper cleared `continuationOwed` whenever its callback issued no request and joined work was no longer pending. Calling it for `settleFullSourceReplay()` therefore made request 5 look like a new authority and falsely required release of3/4. Their retention inside their own repair chain follows the existing model law.

The correction calls `run(..., false)` for bookkeeping. Expected judgment remains an external ledger: no private loader state enters it. Temporary private-field diagnostics were removed. The flag now clears at truncate; synchronous/asynchronous settlement can stage it only for a request in the current truncate generation. Directed neighbors add reset before or after settlement. Issuing a request consumes the flag; a non-deferred graph pass that issues nothing clears it; an ordering-epoch move prevents it from classifying a replacement as a same-chain step. These guards constrain stale provenance in the exercised grammar; they are not a universal proof for every possible callback interleaving.

Evidence:

- **Law:** a chain refill retains the chain's acquisitions; only later covering authority retires them (architecture repair-chain rules and existing state model).
- **Reach:** fixed 200 histories reached deferred-refill11 and reset-continuation30. First random 200 reached15/23; final neighboring run reached13/37. These are callback reach counts; all comparisons in those handoff campaigns completed.
- **RED:** E02 exact baseline seed/path gives retained requests 3/4 after misclassified authority5. Final single-line bookkeeping ablation repeats this RED on the final reset-guarded harness (E20).
- **GREEN:** exact source seed/path E19 executes one test; handoff+reset campaigns, named pin and retained-acquisition calibration pass. Existing neighboring state suite is30 pass,2 known-RED #2222 tests deliberately unselected.
- **Mutant:** the original bookkeeping ablation fails; a separate no-retirement hostile loader calibration is rejected by the unchanged shared `no leak` judgment. The latter establishes leak sensitivity generally, not every classifier boundary.
- **Limits:** controlled subscription at the core boundary; no public row defect or measured production resource leak follows. #2223 and separate #2294/#2281 reports are not established duplicates.

Replay from `packages/db` after applying `oracle.patch`:

```sh
TANSTACK_DB_ORACLE_PROPERTY=ordered-loader.request-authority TANSTACK_DB_ORACLE_SEED=-845274422 TANSTACK_DB_ORACLE_PATH=2109:1:3:6:4:8:10:13:15 pnpm exec vitest run --coverage.enabled=false --typecheck.enabled=false --maxWorkers=1 tests/query/ordered-source-loader-state-oracle.test.ts -t 'replay campaign'
```

`calibrate-continuation-ablation.py --root <worktree> --out <log>` reproduces the removed-bookkeeping defect and restores the file in `finally`.

## #2222: a distinct invalidation during retirement is lost

The broad grammar already varied release throw, truncate, dispose and `loadMore` reentry. It did not invoke a qualifying source-order invalidation from the retirement callback. The added directed grammar varies indexed/unindexed,limit 1/2,synchronous/asynchronous repair,joined deferral,and needed rows. The callback is injected only once in the real acquisition release, not in request start.

E08 was an invalid experiment: initial injection was accidentally in the startThrows branch and reached0; random directed names were also unregistered. Both were corrected. E09 is the semantic RED on unchanged production: seed 20261029,path 0:0,indexed:false,limit 1,syncRepair:false,joined:false,needsMore:false,settledFirst:true,history invalidate/react. The release callback reaches `invalidateSourceOrdering()` once. After successful drain no authoritative start follows that newer invalidation. The failure is specifically the retirement-debt checkpoint, not a timeout or setup error.

Architecture says a newer qualifying mutation replaces the repair before publication/continuation. The loader checks replacement before releasing superseded acquisitions, then retirement's final idle transition clears debt without rechecking a callback's newer ordering epoch. This explains the witnessed request progression. The experiment does not show persistent wrong public rows: the fake's source rows remain fixed. That stronger consequence remains open, as does integration wiring from a real adapter invalidation to this core callback.

The `release-invalidation` reach is declared with minimum 20, but baseline RED stops the first generated history; only one reached callback is established. There is **no repaired production GREEN**, no closed-class claim, and no acceptance of the suggested epoch remedy. The patch intentionally leaves the two directed tests RED for a subsequent authorized implementation task. A receiving row witness and neighboring coverage of retirement-generated deletes remain necessary before public-consequence closure.

## #2214: exact receiving RED remains current

The first run could not resolve the unbuilt workspace package (E05). Successful `@tanstack/db-ivm` and `@tanstack/db` builds fixed setup; no install override was needed. E12 replays seed -116668131,path`71:3:0:2:1:1:2:3:0:5:5:4:0:0:0:0:3:1:2:4:4:7`,property`query-db.refetch-ordered-prefix`.

The counterexample preserves initial two unmarked rank 0 rows, held delete of1,upsert2,upsert1,refetch,release. At release step 4 the owner reports backend id2 (materialized rank 2,labela2) missing from the source although it sorts at or before the served window's end. This is the accepted coverage checkpoint; no assertion was changed. The same command also passed32 supplemental tests, with2 expected failures and1 skipped. Exact source RED was sent to the receiving owner through root. The proposed #2206 cause location was not independently diagnosed; no causal identity is claimed.

## #2268: already fixed, with sensitivity to the actual old design

Both reported seed campaigns pass current production (E03/E04), but changed grammars can invalidate a seed's meaning. I added **two exact shrunk source inputs** to the existing checker: plain rank 0,limit 1,ineligible upsert; and null rank,limit 2,ineligible upsert followed by move to1. These are new fixtures in the proposed patch, not baseline fixtures. The baseline had a nearby larger dup/refetch example. Both new fixtures and both existing unindexed generated campaigns pass (E13).

The current law has a traceable later authority. Commit `a07cd7373` on October28 (PR #2231) adopts the maintainer decision that an underfilled unindexed prefix doubles while growth adds rows and never takes a full-source fallback. Architecture now states that rule. An older October27 coverage-map paragraph allows unindexed fallback; it is stale relative to the later explicit decision and later map record. I did not use the stale paragraph to relax the guard. The ordered-work opening prose also still said fallback; the proposed patch corrects that prose. Shared coverage-map cleanup is left to root.

Two calibrations distinguish sensitivity:

1. An approximate mutant replaced only `count = last * 2` after the growth-stop checks with a full-source read. Both pins survived; the fixed generated campaign rejected wrong rows. This does not establish source-trace sensitivity.
2. Restoring the exact pre-a07 `loadPrefix` branch recreates the original source failures: plain rank 0 starts2 full reads against0; null/move starts2 against1. Fixed/random generated campaigns also reject the no-full work law (4 failures total). E15 is the decisive hostile mutant.

`calibrate-prefix-mutant.py` contains the exact replaced block, the serial test command, and a `finally` restore. The exact historical commit was not executed; this is a current-code hostile mutant reconstructing its removed branch. Original production SHA256 after both restores is`188382f75335916bb37ca53c72b469bc345b588082ca310a8390f4dbdaa2a450`. E13 and current seed runs are GREEN. This supports already-fixed for the two reported work traces under the accepted current law; it does not close every ordered work path. The comment's old5s shrinking timeout is source-reported historical harness friction, not a current semantic RED; current seed run finishes well below it.

## #2260: current behavior versus a stronger desired bound

The downloaded attachment is archived unchanged as `ownership-cleanup-repro.test.ts`. It was copied into the Query DB package as an ordinary supplemental reproduction, run, then removed from the worktree. E17 independently reproduces its setup: A owns100 rows; B holds its first ordered51-row request; A cleans up; B's page gate releases. B.size51 passes; exactly one unordered/unlimited full-source request violates the attachment's proposed zero bound. Its after-settlement delete control passes with no full request.

Architecture explicitly says a genuine invalidation before any request settled requires full-source recovery. A loaded-subsets *report* before any settlement is different: it is ignored because the inflight exact request still owes its result. Cached rows shared from A do not establish B's boundary. The attachment's observed work is valid; its proposed performance promise revises the existing authority rule. Recommendation: decide a narrower safe bounded-pre-first-result contract separately, with partial-write/failure, null boundary, same-page report and accepted-sync hold neighbors. The reported condition patch and its alleged14 neighboring failures were not rerun here; the remedy remains unvalidated and is not in the patch.

## #2223: bounded evidence for replay ownership, with an open receiving gap

The source report explicitly supplied no failing test. Inspecting the loader's dead-failure return alone does not establish a leaked acquisition because the subscription replay owns it. The archived `ordered-lifetimes-receiving-pilot.test.ts` uses a real indexed on-demand Collection and ordered live query, holds its first page, truncates, lets replay load, rejects the aborted old transport, then repeats three further truncates and cleans up.

Its expected first-demand acquisitions/releases come from imported `createLifecycleModel`/`reduceLifecycle`. `getLoadSubsetDemandKey` is used only to group the recorder's first-prefix options, not to decide expected ownership. Model/load-unload counts are2/1,3/2,4/3,5/4; old initial options are aborted and physically released once; all9 provider acquisitions (including ties outside the first-demand projection) have9 releases on cleanup. The late failure adds no demand. This is useful positive evidence that a replayed *still-wanted first prefix* is legitimate retained demand, not itself a leak.

It does **not** exercise a later cursor page whose logical demand should retire, an explicit replacement that makes that page obsolete, or every cross-subscription owner. Therefore the broader claim is unverified, not refuted or already-fixed. Needed witness: hold a later cursor page, replace/reset and fail its old transport, then retire that page's logical demand before further truncates; compare exact per-owner attempts and releases in the primary lifecycle/replay receiver. Do not change the state oracle's intentional pre-truncate exclusion to guess at subscription ownership. The probe is archived as supplemental investigation evidence outside the proposed oracle patch; it is not a new oracle owner or class closure.

## Patch, validation and remaining work

`oracle.patch` contains only four tracked test/registry files: state-owner correction and directed grammars/calibration; two registrations; two ordered-work shared-checker replays and stale opening prose correction. Registration meanings are precise: `ordered-loader.replay-continuation` exercises live deferred refill identity versus reset; `ordered-loader.retirement-invalidation` exercises a distinct explicit invalidation in the first real release callback. Root granted these exact registry entries. Pre-registration failures remain in E08.

Validation:30 neighboring state tests pass at unchanged10000/1000 budgets; exact #2296 replay passes;2 exact #2268 pins and2 unindexed campaigns pass; original-bookkeeping and exact old-fallback calibrations reject their respective defects. `pnpm lint:changed` passes, and `git diff --check` is clean. This is not an all-green patch: the newly exposed #2222 directed tests intentionally fail on frozen production. No production source diff remains. Package build artifacts are ignored setup outputs and excluded.

The shared parent inputs #2155 and #2186 were source-audited only. The indexed #2155 pin exists; the broad grammar still removes joined refetch peers, so an unindexed old seed cannot be borrowed as current closure. The held campaign pins provider `forward`, so it supplies no held+reporting-provider witness. These receiving gaps were sent to root. No extra tests or competing primary models were added for them.

Investigation mode prevents production repairs, so #2214/#2222 remain confirmed-open with exact evidence. Root coordinates their destination and fresh review. No assertion exclusion, law narrowing, budget reduction, dependency override, or unsolicited user permission flow was used.

## Signal quality and workflow lessons

The strongest reports supplied exact input, a named law, and an honest checkpoint: #2214 and #2296 replay directly. #2296 is especially useful because it explicitly limited its claim to a ledger mismatch, allowing the actual oracle defect to be found without inventing a public leak. #2222/#2223 source inspections were hypotheses; one now has a core RED, the other's broader consequence is still not established. #2260 supplied an excellent controlled attachment but its desired work bound conflicts with accepted initial recovery authority. #2268 supplied two valuable distinct shrinks and exposed stale contract prose after its behavior was fixed.

The workflow's lossless ledger and separate validity/action/durable-value judgments prevented three mistakes: accepting zero-selected replay as GREEN; treating a model false RED as a production leak; and relaxing an unindexed work law from a superseded coverage note. The remaining gap is economical receiving-path construction: initial-prefix ownership is much easier to witness than retirement of an obsolete later cursor demand. That scope distinction must survive the final disposition.

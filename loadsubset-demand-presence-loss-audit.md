# Demand-presence spike: loss audit

The frozen report preserves the observed timing loss, failed-segment retry caveat, and the main unmeasured gates. This scan recovered three narrower distinctions. They are omissions from the report's reduction, not new measured production defects. No judgment about restoring them is made.

## Frozen inputs and method

One fresh Field Lab `loss-audit` scan examined one selected bundle. Baseline: `dd8538509ed14a1658e02c66c282a7a0d2bacdd1`. Candidate record: `3cc7d592641801bc0a1923759dffb80c80958881`. Repository: `/Users/kylemathews/programs/tanstack-db/.worktrees/codex-loadsubset-minimal-stack`.

All source pointers below use candidate commit `3cc7d592` unless labeled otherwise. `report` means `loadsubset-demand-presence-experiment.md`; `tests` means `packages/db/tests/query/compiler/lazy-demand.test.ts`; `patch` means `loadsubset-demand-presence-experiment.patch`; `joins` means `packages/db/src/query/compiler/joins.ts`. The baseline and candidate `joins` blobs are identical.

The scanner read the Field Lab skill, loss-audit card, applicable instructions, and full live-query architecture before live-source analysis. Prior audits, refactor plan/TODO, sibling outputs, and earlier task discussion stayed hidden. D2 and demand-controller source was used only to check named timing, callback, and retained-state claims. No tests ran and no experimental patch was applied.

## Recovered distinctions

### 1. Two candidate timing cells never reach their output-weight check

**Support:** `tests:109–112` asserts the demand trace before checking `resultWeight()`. Both queued-message candidate cells fail the earlier assertion. `/tmp/tanstack-demand-presence-d2.json`, `testResults[0].assertionResults`, records these two failures with actual `[]` and expected `[[], ['shared']]`.

**Where lost:** `report:17–18` says output multiplicity is checked in the timing and equal-contributor cases without marking the two short-circuited candidate cells.

**Reduction rule:** Compression from “the suite contains an assertion” to “the candidate case checked it.” The preserved failure records support the demand discrepancy; they do not establish the final weight assertion in those two executions. This is a source-supported execution limit, not evidence that their output weight was wrong. The artifact stack uses a slightly different line number from the frozen formatted test; exact pre-format test bytes are not preserved in the admitted JSON.

### 2. Equal-contributor controls establish one demanded value, but do not assert which value

**Support:** `tests:119–151` checks transition counts, the first demand's length, final emptiness, and total output weight. It never compares the nonempty demand's member with the input value or its expected normalized value. The observer at `tests:48–57` discards unchanged sets using `Array.includes`, and the output sink at `tests:60–64` retains only total weight.

**Where lost:** `report:14–18` groups the number, signed-zero, Date, and byte fixtures under equal-valued contributor retention. It states the broad result-shape limit but leaves the demanded-value assertion limit implicit.

**Reduction rule:** Classifier flattening: a singleton of the wrong value could satisfy these cardinality assertions. This is an inference about what the assertions admit, not an observed wrong key. The report already preserves the distinct, separate limit that discarded unchanged callbacks can carry retry behavior (`report:50–53`); that is not counted again here.

### 3. The patch changes graph wiring as well as operator count

**Support:** Baseline/candidate-record `joins:431–463` feeds the tap's output back into `mainPipeline` or `joinedPipeline`, which then enters the join at `joins:467–469`. The patch's `@@ -426,29 +427,21 @@` and `@@ -456,10 +449,5 @@` hunks remove that assignment. The experimental filter/map/distinct/tap chain becomes a side branch, while the join consumes the active stream directly.

**Where lost:** `report:74–78` reduces this to one tap replaced by four operators and the associated maps.

**Reduction rule:** Compression of graph topology into operator counts. The supported distinction is the removed inline dependency. No runtime ordering failure is inferred: the report explicitly leaves synchronous adapter writes and reentry unmeasured (`report:56–58`).

## Preserved controls and bounded nulls

- The admitted artifacts report baseline **11/0**, experimental **9/2**, restored **11/0**, and final targeted **223/0**. The two experimental failures are exactly the queued-message cells. These are inspected historical records, not fresh test results. The final targeted record covers ten files; it does not establish a full experimental suite.
- Baseline, candidate record, and current worktree `joins` all hash to `9c34832f8dd50774fb446eee3d46a13c6d65872a`. The unchanged-production claim is supported for this file.
- The current patch matches the frozen patch blob `d335e829491fd1961319b7f8d976e4ad3c821aa6`. Read-only `git apply --check` succeeds against the restored worktree; `git apply --numstat` reports 14 additions and 26 removals. This establishes textual applicability, not runtime validity or reproduction of the reported bundle sizes.
- D2 `operators/distinct.ts:33–78` drains queued messages before emitting presence crossings. `operators/tap.ts:23–25` and `graph.ts:123–130` preserve per-message callbacks. `subset-demand-controller.ts:44–85` supports both the empty-demand release path and retry of failed coverage on unchanged keys. Those distinctions survive in the report.
- The report already separates source-counted maps/operators from heap and throughput measurements. It explicitly leaves full candidate tests, the 100x campaign, Effects/query parity, synchronous reentry, opaque reference keys, and physical cancellation unmeasured. No additional measured cost or gate result was recovered from the admitted bundle.

## Limits

This was a static source/artifact comparison, not an execution or adapter campaign. Bundle bytes, type-check success, and the earlier discarded fixture remain report claims where their underlying artifacts were outside the admitted set. The scan's selected focus on losses can make assertion limits seem like defects; none of the recovered limits proves a production failure. Treating the selected bundle as one source also preserves correlation among its report, tests, and patch. The scan stops here without redesign, ranking, or recommendations.


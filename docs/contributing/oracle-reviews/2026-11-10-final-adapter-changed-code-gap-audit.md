# Final PowerSync/RxDB changed-code gap audit

The bounded diagnostic sweep was stopped at the parent's request after **52 of
110 selected automatic operators** completed. It produced **22 kills,
18 survivors, one crash, ten timeouts and one unreached operator**. The remaining
58 operators are unrun or interrupted, with no verdict. Separately, the eight
authored startup/work/lifecycle controls were all killed. Two authored
live-iterator alternatives survived controlled storage, native SQLite and actual
Chromium OPFS. No new production defect is proved by this supplementary sweep.
No allowance has been granted.

| Adapter | Selected | Completed | Killed | Survived | Crashed | Timeout | Unreached | Unrun/interrupted |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| PowerSync | 51 | 4 | 0 | 2 | 1 | 1 | 0 | 47 |
| RxDB | 59 | 48 | 22 | 16 | 0 | 9 | 1 | 11 |

The adjacent [JSON evidence](2026-11-10-final-adapter-changed-code-gap-audit.json)
preserves all 746 static operators, the exact selected source spans, contextual
keys, source hashes, replacements, complete outcomes, omitted-selection reasons,
commands, artifact hashes and distinct unrun records. The selection includes
operators on changed executable expressions in the final batching repair; it
omits unchanged function bodies. This is partial discovery, not a whole-source
or universal closure claim.

## Anchored surviving distinctions

Every ID below resolves to an exact source SHA, span, anchor, operator and
replacement in the JSON. These are scoped decision candidates, not automatic
recommendations for a waiver.

| Candidates | Present distinction and risk | Needed evidence or decision |
| --- | --- | --- |
| powersync.ts:M41, rxdb.ts:M6, rxdb.ts:M11, rxdb.ts:M12 | Change the retained-reload snapshot predicate or option. Atomic publication and retained replacement may differ before the final cut. M12 changes captured observations; the other three show no captured difference. No production defect is established. | Generate and observe the intermediate retained-reload publication boundary, or obtain an exact maintainer allowance. |
| powersync.ts:M79 | Replace the required sync-write operation type with undefined. The public write protocol is not enforced for this PowerSync boundary by these two selected owners; rows alone do not distinguish it. | Add shared receiving validation of required operation type, or obtain an exact maintainer allowance. |
| rxdb.ts:M8, rxdb.ts:M65, rxdb.ts:M67 | Broaden source-key collection or the baseline-reconciliation guard. Extra collection/reconciliation can occur in retained or unwrapped runs; this persisted-startup campaign observes no difference. It does not prove equivalent behavior. | Distinguish retained/unwrapped source work and reconcile boundaries, or obtain an exact maintainer allowance. |
| rxdb.ts:M44, rxdb.ts:M45 | Remove the stop fence after an awaited source read. The true stopped branch of this specific fence is not reached by the selected histories. No evidence establishes what happens on source-read completion after retirement. | Generate retirement while the initial RxDB storage read is held, then release it, or obtain an exact maintainer allowance. |
| rxdb.ts:M60, rxdb.ts:M63, rxdb.ts:M86, rxdb.ts:M89 | Always attach the catch handler, including a hypothetical synchronous true receipt. The differentiating synchronous-receipt branch is not reached. A true receipt would not have catch; this campaign does not establish whether that receipt is legal at this boundary. | Exercise the legal synchronous receipt path or document its inapplicability with an exact maintainer allowance. |
| rxdb.ts:M87, rxdb.ts:M88, rxdb.ts:M90 | Omit the immediate catch handler for an omission-commit receipt. The selected histories do not distinguish rejected omission receipts and their reporting timing. This is a generator gap, not a demonstrated production error. | Exercise omission-receipt rejection at the relevant await/reporting boundary, or obtain an exact maintainer allowance. |
| rxdb.ts:M79 | Run one additional empty omission transaction at the end of the loop. Captured work differs but existing comparisons permit it. Whether this extra empty transaction violates an accepted work law requires an explicit authority decision. | Add a justified work comparison, or obtain an exact maintainer allowance. |

The live-iterator controls are `authored.live-iterator.powersync` and
`authored.live-iterator.rxdb`. Both commit configured-size omission batches while
iterating accepted rows instead of copying omitted keys first. Each survived a
previous-seven/next-empty, after-restore history on all three hosts. Positive
execution sentinels authenticate the exact transformed source. These results
establish survival for those histories; they establish neither unsafe behavior
nor equivalence. Source and returned-code hashes, line ranges and all artifact
paths are retained in the JSON.

## Runtime and unrun outcomes

The **12 non-assertion outcomes** are PowerSync M40 (crashed), M80 (timeout),
and RxDB M5, M10, M43, M59, M72, M80, M81, M84, M85 (timeouts) and M13
(unreached). They are not kills. M40 reports `Persisted startup driver did not
reach its premise`; that driver waits up to 2,000 zero-delay turns. The timeout
results report `run time limit`; several remove a required source value, begin
or commit and leave receiving operations unfinished. This does not identify an
assertion-level product-law failure.

The CLI first cuts a slow file at its clean-duration-scaled short limit, then
confirms it alone at the full limit. Observed full limits were approximately
55–57 seconds for PowerSync files and 15–21 seconds for RxDB files. Repeated
receiving waits and these confirmations made automatic discovery much slower
than the eight-control pilot. Shrinking time was not separately profiled.
The parent stopped both exact runner process trees; the termination record is
retained. All 58 candidates without a final result remain explicitly unrun or
interrupted. They are not waiver proposals.

## Receiving and instrument integrity

The snapshot is `/private/tmp/tanstack-db-2394-final-adapter-gap`, based on
`0e86c1fdae85520aff142f141f71ccf46a8ee8bd`, with final PowerSync source SHA-256
`c4960f0c00aae28400de1811285458995c5b61591bd7ce42353f99ad6ab47068` and RxDB
`c78f7409f9e539a6bf575718f36a91309c191b18638be29a7d87b481914e65f7`.
Each adapter's two clean passes captured 12 unique full test identities across
two owner files, all passed, with no setup or unhandled errors.

The isolated diagnostic transform uses two generated runs per campaign, fixed
seed 2367, no literal fixed histories and no checker calibrations. It retains
all canonical constructed-history builders, models, drivers, comparisons and
reach checks. These compact runs are supplementary; normal repository budgets
remain unchanged. It uses Node 24.22.1, forks and one context per adapter.
The isolated CLI contains the separately reviewed expected-failure,
complete-capture and full-title-identity repairs. The installed CLI is unchanged.

Final independent integrity verification found no changed hashes among 3,782
snapshot inputs, 1,191 copied build artifacts, two workspace bundles, two control
files, 13 instrument modules and five orchestration files, and no imports of live
checkout source. No new instrument flaw was demonstrated. This finding does
not promote runtime failures or unexecuted candidates into evidence of closure.

The eight authored controls rejected forced persisted snapshots, skipped restored
omissions, unbounded omission batches, raw provider IDs in PowerSync source-key
tracking and the RxDB post-hydration terminal-stream fence removal. The
batching evidence retained by the PR manifest and the
[lifecycle](2026-11-10-persisted-baseline-lifecycle.md) evidence remain the primary
normal-budget evidence. This stopped discovery audit does not replace them.

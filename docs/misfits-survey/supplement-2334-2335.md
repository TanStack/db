# Targeted intake: #2334 and #2335

Captured November 2, 2026, with both complete issue bodies and all conversation comments (zero each). This targeted intake adds two items to the cumulative ledger (153 → 155: 131 issues, 24 PRs). It does not refresh the earlier 144-open-item census or any prior capture. The cumulative buckets are 96 clustered, 28 standalone, 22 unclear, 6 maintenance and 3 duplicate/stale-looking; there are still 26 descriptive clusters.

| Issue | Primary classification | Investigation | Bug/feature boundary |
| --- | --- | --- | --- |
| [#2334](https://github.com/TanStack/db/issues/2334) | Standalone: core observer / cleanup and restart | B23; B11 context and B20 instrument coordination | Correctness counterexample; observer versus model unresolved. Separate path-replay registry gap. No new feature requested. |
| [#2335](https://github.com/TanStack/db/issues/2335) | Existing ordered loading / refetch, repair, and request lifecycle cluster | P1; B18/P5 coordination | Correctness counterexample; Query DB reporting, core repair or model expectation unresolved. No new feature requested. |

## #2334: granular observer across cleanup and restart

The [report](https://github.com/TanStack/db/issues/2334) describes an empty hydration seed followed by attach → ready → write b@0 → cleanup → restart → write b@0. At the final step the model expects b, but the granular observer view is empty. Seed `2087400494`, path `4:0:2:3`. The reporter reproduces it on main `a2c3854c3` and `a3c4d0676`, and after merging `9be51e037` (#2333); [CI](https://github.com/TanStack/db/actions/runs/41516335355/job/125520732865) ran in #2302 context.

“This property is not in the `oracle-config.ts` path-replay registry, so the replay environment variables do not select it.” Preserve that separate instrument limit. The report instructs pinning `{ seed: 2087400494, path: '4:0:2:3', endOnFailure: true }` in the existing random campaign rather than using an ineffective environment selector. Its [exact command and original report](supplement-2334-2335/batch-001-snippets.md) are retained.

The [October 29 local intake](intake/observer-hydration-cleanup-restart-2026-10-29/signal.md) already records a nearby granular empty-seed observer mismatch under the same executable owner: seed `-843508256`, printed path `88:0:0:3:9:12:17`, with a crash and two cleanup/restart cycles before an equal write. #2334 is a distinct shorter history with one cleanup/restart cycle and no crash. Retain both as inputs to the shared owner; their common cause is unresolved. The older local signal was outside GitHub counts, so this intake adds only the two newly captured issues.

The witness does not use server hydration data or a receiving framework. It stays standalone, like core observer performance PR #2328, with B23 coordination. B11 is context only. #2310 is a survey cross-link for cleanup/restart at the different raw Collection publication boundary; no shared cause or closure is established. This intake does not decide whether the observer must survive that lifecycle or whether the model improperly retains responsibility.

## #2335: cursor refetch and two-term prefix coverage

The [report](https://github.com/TanStack/db/issues/2335) uses cursor encoding, two order terms, rank ordering, limit 1 and offset 0. Following delete/upsert/invalidate/upsert/upsert, the first refetch leaves backend row 2 absent from the source Collection although it sorts at or before the window end. The remaining shrunk trace then upserts and refetches again. Seed `1114808614`, path `22:0:3:5:5:1:8:10:9:10:1:4:5:4:7:7:8:6:8:8:8:8:8:8`, property `query-db.refetch-ordered-prefix`.

It joins #2214 by the named ordered-prefix oracle and source-coverage observation; #2214's held-delete history remains distinct. The report leaves Query DB page reporting, core ordered repair and the model's prefix-coverage expectation open. It reports reproduction on main `a2c3854c3`, after merging `9be51e037` (#2333), and with main's loader plus only #2302's test changes. [CI](https://github.com/TanStack/db/actions/runs/41516335355/job/125520732875) and those controls are reporter evidence, not independently validated by this intake. The [retained report](supplement-2334-2335/batch-001-snippets.md) includes the dependency-build prerequisite and exact replay command.

P1 owns the source-prefix investigation; B18/P5 coordinate shared files. No evidence establishes #2302 as the cause, or #2333 as closing either report. Preserve the accepted transfer bound and publication barriers.

## Evidence and limits

[Extraction ledger](supplement-2334-2335/batch-001-ledger.md), [full attributes](supplement-2334-2335/batch-001-attributes.jsonl), [source snippets](supplement-2334-2335/batch-001-snippets.md), [assignments](supplement-2334-2335/assignments.json), and [capture bookkeeping](supplement-2334-2335/intake.json). Source statements are attributed. This intake did not inspect CI/source, replay either history, change an oracle or production, or determine issue closure.

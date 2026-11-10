# November 2 additions to investigation prompts

These are staged additions for parent integration into the [shared starting prompts](/Users/kyle.mathews/.codex/worktrees/collection-publication/tanstack-db/docs/misfits-survey-session-prompts-2026-10-30.md). This worker did not edit that file or the survey master files; parent integrations are separate. The [categorization](categories.md) and [assignments](clustering/assignments.json) account for all 14 newly captured open items. Source reports, PR validation statements and review findings remain attributed; this refresh performed no technical review or current-code validation.

Retain the shared rules and recorded decisions. In particular, raw Collection publication of applied source transactions differs from the complete-result barriers of live-query Collections/Effects; retain the existing window-change barrier. No new staging API or changed applied-receipt semantics is approved. Preserve the original ordered-work bound and existing progress/ownership decisions. A `fix:` title or automated New Features/Refactor label does not settle the bug-versus-capability boundary. Status-only closure is not semantic closure.

## Additions to affected existing sessions

### P4 — Remaining live-query replay, preload and includes convergence

**Post-census addition:** [#2315 comment 6579843541](https://github.com/TanStack/db/issues/2315#issuecomment-6579843541) supplies a [rejection-only witness](updates/issue-2315-comment-6579843541.md), seed `112008075`, path `431:3:2:3:3:6`, reportedly failing on #2314 and main without `markerThrows`. Preserve it alongside the original witness. P4/B15 must distinguish own-replay participants and the earliest failure that still decides the move before changing production or the model. Common cause is unestablished.

Add [PR #2318](https://github.com/TanStack/db/pull/2318) and [issue #2326](https://github.com/TanStack/db/issues/2326) as distinct leads. #2318 claims that failed include demand must continue to decide publication while a sibling replays a truncated source; #2326 reports a page move publishing parents before their on-demand includes settle. Keep these histories separate from #2315's failure-identity witness. #2318's reviewer link to #2315 is contextual, not a claim that one repair closes both.

For claimed existing behavior, identify the deciding public observation and apply the recorded complete-result/window-change barriers. #2326 explicitly questions how those barriers apply to new include demand; its uncertainty does not authorize weakening the existing decisions. Coordinate B22 on setWindow and binding retention, B14 on the optimistic window barrier, and B15 on failed-request witnesses. Raw-publication changes and prior issue closures do not establish current live-query closure.

Keep requested capabilities separate: #2326 alternatively asks for documented early-parent semantics and hook access to pending-move state. Record those as documentation/product questions rather than treating them as part of a presumed bug repair. #2318's SQLite final-catch-up reach amendment belongs with B20 instrument accounting, separately from its production claim.

### P5 — Retirement PR #2302 review closeout

The newly captured [published #2302 body](https://github.com/TanStack/db/pull/2302) continues to claim an ordered-window repair and separately qualifies its #2296 instrument correction. The local P5 handoff records an earlier alleged publication failure as refuted by matching Collection/Effect probes and an unpublished follow-up. Preserve both source records when refreshing the actual PR and local candidate; this categorization supplies no new verdict. Keep P5's existing ownership and B18 coordination.

### P6 — Metadata PR #2303 correction and review closeout

Preserve the local P6 caveat in full: the original production recovery diagnosis was withdrawn; a missing model input was corrected; the recorded current-main candidate has **zero production delta**, while the published PR still contains the older materialization change.

The November 2 [published #2303 body](https://github.com/TanStack/db/pull/2303) still claims a metadata repair for implicit equal re-inserts and scopes it to a #2281 metadata counterexample. Its fetched discussion does not record the withdrawal. Distinguish that published claim from the local P6 evaluation rather than presenting either as the other source. Reconciliation remains P6's task under its existing workflow. #2317/P8 is a separate source-facing metadata witness; neither the withdrawal nor this PR's claims dispose of it. Coordinate P3/P8 without inferring a common cause or closure of the wider multi-tab reports. The already approved metadata test helper and the separate optional runner suggestion retain their existing decisions.

### B10 — Electric write confirmation and optimism

Add [PR #2304](https://github.com/TanStack/db/pull/2304). Its concrete reported setup is a cold on-demand Electric stream starting at `offset=now`, with a backend write whose echo can precede that starting position and remain unconfirmed by `awaitTxId`. Keep reported existing confirmation failures and any reentrant-evidence follow-up individually attributed. The later persisted-startup reviewer concern is unverified testimony in this refresh.

Handle the proposed capability separately: the body explicitly calls `beforeMutation`/participant preparation a **stronger admission contract**, requires initial connectivity, and excludes an offline outbox. Determine existing authority before classifying any part as a required repair; do not infer approval for new admission/staging APIs or receipt semantics. Coordinate persistence startup with P3/P6 and treat the Neon guide's early-write confirmation concern as a separate adapter boundary.

### B11 — Framework SSR and hydration

Add [issue #2322](https://github.com/TanStack/db/issues/2322) and its explicitly linked [PR #2323](https://github.com/TanStack/db/pull/2323). The report concerns a disabled `useLiveQuery` callback returning `undefined`, error 253, and first browser hydration in a React `routerWithDbClient` application. Distinguish this claimed failure of an existing disabled snapshot from older Vue/Solid/Angular requests to add SSR support.

Keep the shared observer promise and each receiving framework's behavior separate. The author-reported core/React browser results were not reproduced by this refresh and do not establish every adapter's result. Coordinate B23 where framework snapshot/lifetime coverage overlaps. React error #422 in the issue is an error code, not a repository link.

### B20 — Declared reach and seed replay reliability

Add the **instrument-only portion** of [PR #2318](https://github.com/TanStack/db/pull/2318) as a related record. Its body says SQLite final-catch-up comparisons passed while random histories could miss required recovery reach; it also describes a separate subscription-scoped error-checker amendment. Compare the claimed campaign change with the existing #2329 lead before drawing any item-level conclusion. Do not call the reach miss a production defect or infer that #2318 resolves #2329. P4 owns the PR's failed-include publication claim.

### B22 — Pagination API and index configuration

Add [PR #2314](https://github.com/TanStack/db/pull/2314) as the explicit #2292 counterpart and [PR #2316](https://github.com/TanStack/db/pull/2316) as the explicit #2291 counterpart. #2314 principally adds output `autoIndex`/`defaultIndexType` configuration and says automatic indexing remains off by default. Its claimed Suspense sharing and preload-admission repairs are separate from that capability.

#2316 claims adapter-owned Collection retention for eligible outer limit/offset changes, plus distinct TopK/SSR and instrument follow-ups. Identify which behavior is already promised and which adds a capability; preserve all recorded window/work constraints. Retain the body's later-coverage qualification and attribute reviewer concerns without converting them into this refresh's findings. Coordinate B23 on bindings and B11 on SSR. [#2326](https://github.com/TanStack/db/issues/2326) remains in this descriptive pagination cluster, with P4 owning its include-publication question. The explicit page-control relationship does not make #2316 an include-publication repair.

### B23 — Framework binding conformance

Add [Angular PR #2327](https://github.com/TanStack/db/pull/2327) and its independent [core observer companion #2328](https://github.com/TanStack/db/pull/2328). Keep three accounts separate: the claimed current-query consistency/signal-reactivity repair, the breaking Angular minimum change from 16 to 20, and the performance improvement that preserves row-container references on metadata-only observer snapshots.

For claimed existing behavior, identify the authority for synchronous query/result consistency and receiving signal/lifetime obligations. For policy/capability work, retain the breaking support-range decision and distinguish already promised signal tracking from any added behavior. Automated New Features wording supplies no authority. #2328's core data-array/state-Map reuse remains a standalone performance lead even though this session coordinates it; its author-described lane uses synchronous direct Collections with string keys and does not eliminate all dirty-marking/notification work. The #2320 link is bot-suggested context, not a closure or scope expansion. #2312's Solid query-input follow-up is a cross-link to B25, not another primary callback-metadata assignment.

## Proposed starting prompts for distinct topics

B24–B26 are proposed identifiers for parent integration, not created chats. They use the existing shared rules. Standalone #2328 uses B23 coordination and does not require a new topic solely because its primary performance boundary is separate.

### Proposed B24 — Neon Realtime guide and supported versions

```text
Follow the shared rules in /Users/kyle.mathews/.codex/worktrees/collection-publication/tanstack-db/docs/misfits-survey-session-prompts-2026-10-30.md and the November 2 refresh categories/session additions. Investigate documentation PR #2308 as a Neon Realtime integration guide. Refresh its body and discussion, preserving the stated distinction between published @neon/realtime-tanstack support for DB 0.9 and the lack of 1.0 RC compatibility established by the captured guide. Separate documentation/example correctness, session/auth lifetime and write-confirmation claims from any requested adapter RC-support capability. Treat prose approvals and automated example concerns as source testimony; they do not establish a working deployment or a confirmed defect. Coordinate B10 only on shared confirmation vocabulary and keep the Neon receiving boundary separate. Deliver a concise documentation-versus-capability account with citations, the supported-version question and evidence limits. Do not silently remove the compatibility warning or introduce a product promise to satisfy the guide.
```

### Proposed B25 — Functional callback metadata and compiler contracts

```text
Follow the shared rules in /Users/kyle.mathews/.codex/worktrees/collection-publication/tanstack-db/docs/misfits-survey-session-prompts-2026-10-30.md and the November 2 refresh categories/session additions. Investigate PR #2312, beginning with its principal fn.select/fn.where/fn.having reserved-metadata boundary and query-placement/compiler-mode claims. Refresh the current body and discussion. Separate established callback laws from the author-described maintainer contract extensions; a fix title or prior automated review is not sufficient authority. Keep the separately claimed cache, ordered joined-dependency, loading-sibling replay and Solid query-input work individually accounted for. Coordinate P4/#2318 for replay publication, P1/B13 for ordered dependencies and B23 for Solid receiving. Deliver an authority-and-scope ledger with current source claims, supported distinctions and unresolved capability questions before deciding any repair scope. Do not duplicate those sessions' primary owners or treat one claimed follow-up as validation of every component.
```

### Proposed B26 — Lazy-join demand performance

```text
Follow the shared rules in /Users/kyle.mathews/.codex/worktrees/collection-publication/tanstack-db/docs/misfits-survey-session-prompts-2026-10-30.md and the November 2 refresh categories/session additions. Investigate performance report #2321: approximately 21,000 eager-local rows written in batches into a live query with several lazy left joins, with reported demand-recomputation work in setDemand/canonicalizeKeys. Preserve the reporter's explicit distinction that this is a performance issue rather than a correctness bug. Establish a bounded workload and applicable performance expectation, distinguishing reported timings/complexity from measurements on your selected baseline. Keep the suggested incremental demand API as a proposal rather than an accepted requirement. Coordinate B13/P4 if shared demand machinery or publication observations overlap, while preserving existing ownership and complete-result laws. Deliver a measured performance account and a separately stated API/capability question; do not reclassify an optimization request as an accepted-law failure without authority.
```

## Questions retained for integration

The material boundaries are the published/local #2302 and #2303 claim reconciliation; stronger admission in #2304; callback extensions in #2312; indexing capability versus incidental repairs in #2314; retention authority versus other claimed repairs in #2316; include-demand application of existing publication barriers and conditional hook state in #2326; Angular support policy versus signal correctness in #2327; reference identity/performance in #2328; and Neon guide/version support in #2308. These are classification questions, not new approval requests or findings from technical review.

## Later targeted intake: #2334 and #2335

The [targeted supplement](../supplement-2334-2335.md) and shared starting prompts now include both reports. P1 owns #2335's distinct cursor/two-term source-prefix witness (seed `1114808614`, property `query-db.refetch-ordered-prefix`); B18/P5 coordinate shared files. B23 coordinates standalone #2334's granular observer cleanup/restart witness (seed `2087400494`, path `4:0:2:3`), with B11 context only and B20 handling its separate missing path-replay registration. Use the explicit random-campaign pin documented by #2334 rather than an ineffective environment selector. Preserve both production-versus-model questions; no feature, shared cause or closure is established.

For #2334, retain the [older unfiled observer witness](../intake/observer-hydration-cleanup-restart-2026-10-29/signal.md) under the same executable owner (seed `-843508256`, printed path `88:0:0:3:9:12:17`). Its crash and two cleanup cycles distinguish it from the new single-cycle report. A common cause remains unresolved; the older local signal adds no GitHub item.

## Targeted release follow-ups #2337–#2342

[The supplement](../supplement-2337-2342.md) adds B27 for local literal semantics, B25 for static callback receiving, B28 for installed declaration emission, B06 for mutation input metadata, P8 for durable metadata observations, and B29 for the two retained adapter receiving cuts. The shared starting prompts now include these distinct scopes. All historical RED counts need current validation; #2341/#2342 are instrument gaps. Release P08 is not metadata P8/#2317. No stronger product contract is introduced.

## Fresh revalidation of #2337–#2342

[Read these executed results first](../../misfits-investigations/revalidate-2337-2342/summary.md), at frozen main `baabf57a0f110d57ad9bb7b81148466b18fbe0d1`. All six remain open with public updates. Preserve the passing subcases and source/installed/documentation/host boundaries rather than restarting from historical RED counts. #2342 now has a documented callback-path violation as well as its retained receiving gaps; do not infer shipped-adapter failure.

## November 3 targeted additions — #2344/#2347

[The supplement](../supplement-2344-2347.md) adds #2347 to B20 with seed-only Electric SDK retry reach, the 40-history budget and actual fifth-attempt observation requirements. New standalone B30 covers #2344: establish deletion/retention authority, distinguish indefinite tombstone payloads from bounded replay retention, and separate bugs from pruning/purge/local-truncate capability questions. The shared starting-prompt document now contains both handoffs. No reproduction, new API approval or common production cause is claimed.

## November 3 targeted addition — #2349

[The supplement](../supplement-2349.md) adds standalone B31 for nested optimistic draft prototype preservation. Its prompt retains class/null-prototype/plain controls, pending and confirmed observations, draft isolation and native-value laws. Historical #1714/#1800 and PR #2346 discovery context remain distinct from current reproduction, causal and additional-notification claims. The shared starting-prompt document includes the handoff; no new API or closure decision is implied.

## November 3 comment update — #2296

[The second request-authority witness](../updates/issue-2296-comment-6617143865.md) remains in ordered loading lifetimes/B18. It reportedly fails the same no-leak comparison on both PR and recorded main, but does not establish a shared cause, wrong public rows or a measured production resource leak. B18 now treats the earlier pilot continuation-classifier diagnosis as limited to its original scope, preserves both traces and requires a real-subscription receiver for any public resource claim. Counts stay at 164 captures and 26 clusters; the 144-item census remains unchanged.

## November 4 targeted additions — #2352/#2353

[The supplement](../supplement-2352-2353.md) adds two independent B16 tracks: shared-subset freshness (#2352) and overlapping-owner row retention through ordered fallback (#2353). The shared prompt includes both and cross-links B18 for the ordered receiving path. Preserve accepted sharing, freshness authority, row ownership, publication and work bounds. No new API/common-cause/closure verdict is approved. PR #2354 is handled in another session and excluded.

## November 9 eligible-item intake

[New classifications](../intake-2026-11-09.md) add 12 items, excluding user-owned PRs #2354/#2378: one aggregate cluster (#2365/#2375), nine standalone bug/capability/packaging boundaries and routine release PR #2380. Cumulative counts are **178: 103 clustered, 43 standalone, 22 unclear, 7 maintenance and 3 duplicate/stale-looking**; 149 issues, 29 PRs and 27 clusters. Ten prompts B32–B41 retain boundary and bug/feature distinctions. The November 2 census is untouched; a separate November 9 scoped enumeration accounts for every currently open eligible item, without refreshing old discussions or proving any repair.

## November 10 eligible-item intake

[New classifications](../intake-2026-11-10.md) add 11 eligible items, excluding every currently open user-owned PR. Three new pairs cover include DISTINCT scope, include join-key demand and React DbClient Suspense startup; five other topics remain standalone. Cumulative counts are **189: 109 clustered, 48 standalone, 22 unclear, 7 maintenance and 3 duplicate/stale-looking**; 155 issues, 34 PRs and 30 clusters. Eight prompts B42–B49 preserve separate bug and capability judgments. The November 2 census is unchanged. Separate November 10 enumeration accounts for every currently open eligible item without refreshing older discussions or proving any repair.

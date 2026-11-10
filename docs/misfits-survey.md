# TanStack DB — Signal Inventory Memo

## Reader's Guide

**November 2 refresh:** [The current census](misfits-survey/refresh-2026-11-02/source-manifest.json) contains **144 open items: 123 issues and 21 PRs**. [Fourteen items are new to this survey](misfits-survey/refresh-2026-11-02/categories.md): three issues and eleven PRs. Earlier discussed PRs can therefore be new to the inventory. Nine earlier captures are now closed or merged; their status is recorded below without a semantic-closure claim.

[Targeted additions #2334/#2335](misfits-survey/supplement-2334-2335.md) were captured after that census; no new open-item census was performed. #2334 is a standalone core observer cleanup/restart correctness witness (B23, with a separate B20 replay-registry limit); #2335 joins ordered loading/refetch (P1/B18). Neither establishes production versus model responsibility.

[Targeted #2337–#2342 intake](misfits-survey/supplement-2337-2342.md) adds four historical correctness follow-ups requiring current-main revalidation and two oracle receiving/observation obligations. #2340 joins read/write payloads; #2341 joins persisted metadata. The other four remain standalone. No new product feature, common cause or current production RED is established.

[Fresh revalidation of #2337–#2342](misfits-investigations/revalidate-2337-2342/summary.md) at `baabf57a0` is complete: all six remain open with public updates. The #2337 retained empty-record runtime cases and #2338 historical union-spread cases now pass; the remaining defects/gaps are bounded in the reports. #2342 additionally reproduces a documented callback receipt violation, without a shipped-adapter failure claim.

[November 3 targeted intake #2344/#2347](misfits-survey/supplement-2344-2347.md) adds an Electric SDK oracle reach sampling gap to B20 and a standalone deleted-payload retention/storage concern to B30. The latter keeps deletion-contract questions separate from proposed purge/pruning capabilities. Neither was independently reproduced in this intake.

[November 3 targeted intake #2349](misfits-survey/supplement-2349.md) adds a standalone nested-draft runtime-shape report (B31). It keeps prototype preservation and draft isolation distinct from additional-notification claims and from PR #2346 discovery context. The report was not independently reproduced during intake.

[November 3 #2296 comment update](misfits-survey/updates/issue-2296-comment-6617143865.md) adds a second baseline oracle failure under B18, with joined/reentrant history and unresolved common cause. It does not establish wrong public rows or a measured resource leak; the earlier pilot diagnosis does not resolve this new trace. The #2296 table row reflects its refreshed metadata and one comment; the frozen census is unchanged.

[November 4 targeted intake #2352/#2353](misfits-survey/supplement-2352-2353.md) adds two reported Query DB acquisition bugs to B16: stale shared-subset reuse and rows lost when an older ordered fallback owner releases. B18 coordinates #2353’s ordered path. Freshness and row ownership remain separate judgments, with no common cause established. PR #2354 is handled elsewhere and excluded.

**November 9 additions:** [Twelve newly classified eligible items](misfits-survey/intake-2026-11-09.md) add one aggregate cluster, nine standalone bug/capability/packaging boundaries and one routine release PR. [Scoped accounting](misfits-survey/intake-2026-11-09/current-open-accounting.json) enumerates 161 open items: 147 previously captured, 12 newly classified and two excluded user-owned PRs (#2354/#2378). The November 2 census remains historical; older discussion captures were not refreshed.

**November 10 additions:** [Eleven newly classified eligible items](misfits-survey/intake-2026-11-10.md) add three narrowly scoped clusters and five standalone bug/capability/performance topics. [Scoped accounting](misfits-survey/intake-2026-11-10/current-open-accounting.json) enumerates 172 open items: 155 previously captured eligible items, 11 newly classified items and 6 excluded user-owned PRs. Prior captures remain historical; older discussions were not refreshed.

The cumulative ledger retains **189 captured items: 155 issues and 34 PRs**, including those nine historical captures. Every current open item has one [primary assignment](misfits-survey/refresh-2026-11-02/clustering/current-open-assignments.json). New extraction includes complete discussions and PR reviews; inherited extraction and historical enrichment retain their original dates. The [updated session additions](misfits-survey/refresh-2026-11-02/session-prompt-updates.md) separate bug claims, capability questions, performance, documentation, and compatibility policy.

This is a signal inventory, not design analysis. Groupings organize cited open
reports for maintainer use. They do not establish common causes or verified
behavior. Historical items provide context without establishing current bugs.
Use the memo by pointing a separate follow-up session at one cluster or
standalone item. The inventory makes no design or closure recommendations.

### Prior capture history

**Completed October 29, 2026.** The original census captured **121 open
issues and 13 open PRs**, including [#2294](https://github.com/TanStack/db/issues/2294).
The user-supplied [#2296](https://github.com/TanStack/db/issues/2296),
[#2310](https://github.com/TanStack/db/issues/2310),
[#2315](https://github.com/TanStack/db/issues/2315),
[#2317](https://github.com/TanStack/db/issues/2317), and
[#2329](https://github.com/TanStack/db/issues/2329) supplements brought the preceding snapshot
to **139 captured items: 126 issues and 13 PRs** (latest addition November 2, 2026).
**26 descriptive clusters contain 85 items**;
23 remain standalone high-signal items,
22 unclustered/unclear,
6 maintenance, and
3 duplicate/stale-looking. Every captured item has exactly one primary
assignment. Bounded historical enrichment searched all 26 clusters and retained
115 distinct closed/merged artifacts for 25 clusters; one had no defensible
match within the search bounds. The [historical index](misfits-survey/historical-enrichment/index.md)
records counts, acquisition bounds, and per-cluster caveats.
([assignment verification](misfits-survey/clustering/coverage-verification.json))

## Repo Framing

TanStack DB presents itself as the reactive client store for APIs: normalized
Collections, incremental live queries and joins, and optimistic writes separate
data loading from component consumption and aim to reduce network waterfalls
and interaction latency. REST fetching, sync adapters, and local stores share
that query surface; eager, on-demand, and progressive loading offer different
acquisition workflows. ([README](../README.md#tanstack-db), [overview](overview.md#how-it-works))

The documented boundaries include handler-defined transaction settlement,
request-scoped `DbClient` instances and SSR snapshots, runtime-specific SQLite
drivers, and a separate durable mutation outbox. Contribution rules require
contract-based oracle evidence for behavior changes and attention to shipped
code weight. This framing is inferred and maintainer-correctable; the
[full framing with source citations](misfits-survey/repo-framing.md) retains the
documented constraints and RC release context.

## Source Coverage

| Source                                                        | Captured coverage                                                                                                                                                                                                                                        |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository documentation                                      | Framing excerpts at revision `82c5f999b32c9db827dd74e3f172604dfda28013`.                                                                                                                                                                                 |
| Open GitHub issues                                            | Latest current census: 123 open. Cumulative: 155 captured; detailed intake and scope are in the November 2 refresh. Prior single-issue supplement snapshot: 126 captured from the original census and supplements #2296, #2310, #2315, #2317, and #2329. |
| Open GitHub PRs                                               | Latest current census: 21 open. Cumulative: 34 captured. The original 13 included one draft and automation.                                                                                                                                              |
| Discussion on those items                                     | 180 conversation comments, 41 reviews, 61 inline review comments; paginated capture.                                                                                                                                                                     |
| Closed/merged historical items                                | Retained 115 distinct artifacts (33 issues, 82 PRs, including 70 merged PRs), 156 cluster relationships, and 71 body quotes; 69 targeted searches. See the [historical index](misfits-survey/historical-enrichment/index.md).                            |
| GitHub Discussions, Discord, social sources, private messages | Outside the requested issue/PR boundary. No approved Discord admin/bot access or export was supplied.                                                                                                                                                    |

**Capture window:** October 29, 2026, 08:34–08:43 MDT (14:34–14:43 UTC).
The full census refresh at 08:42 added only #2294; its supplement ended at
08:43. The other 133 items retain their earlier metadata/discussion capture.
This is not an atomic GitHub snapshot or a claim about later activity.
Both exports have `possiblyCapped: false`. The original 134 items match the enumerated,
assigned, extraction-ledger, and final-assignment counts, with no missing or
duplicate IDs. ([manifest](misfits-survey/github-open-items-manifest.json),
[acquisition](misfits-survey/source-acquisition.json),
[extraction checks](misfits-survey/coverage-verification.json),
[assignment checks](misfits-survey/clustering/coverage-verification.json))

Reactions are item-body totals with +1 counts, not independent report frequency.
Comment counts include automation; review counts are separate. Raw exports stay
in local temporary storage outside Git. Source claims were not reproduced or
diagnosed. [Extraction scope](misfits-survey/source-access-and-extraction.md) and
[grouping method](misfits-survey/clustering/method-and-limits.md) record the limits.

**Single-issue supplement:** #2296 was captured October 29, 2026, 09:41 MDT
(15:41 UTC), with its complete body and all conversation comments (zero).
The original 134 records retain their earlier captures. This addition did not
refresh the global open-item census or any original item's state/discussion;
135 was the retained inventory count at that capture, not a current GitHub open-item total.
See the [supplement record](misfits-survey/supplement-2296.md).

**Second single-issue supplement:** #2310 was captured October 30, 2026,
09:47 MDT (15:47 UTC), including its full body and all conversation comments
(zero). It is standalone under Collection publication / cleanup and restart,
with a cross-link to #2294; no existing cluster assignment changed. The prior
135 captures remain intact. The inventory at that capture was 136, without a new global
census. See the [#2310 supplement](misfits-survey/supplement-2310.md).

**Third single-issue supplement:** #2315 was captured October 30, 2026,
13:23 MDT (19:23 UTC), with its full body and all paginated conversation comments
(zero). It joins Ordered loader / failed requests and recovery, with replay
investigation assigned to P4 and a B15 cross-link in the starting prompts.
Its production/model cause remains unresolved. The inventory at that capture was 137; prior
136 captures and assignments are preserved, without a new census or reproduction.
See the [#2315 supplement](misfits-survey/supplement-2315.md).

**Fourth single-issue supplement:** #2317 was captured October 30, 2026,
15:26 MDT (21:26 UTC), including its full body and all paginated comments (zero).
It joins SQLite persistence / Electric multi-tab coordination as a controlled
source-facing metadata signal. It does not establish durable row loss or real
browser-coordinator behavior. P8 owns the focused investigation; P3/P6 cross-link
it. The inventory is now 138; the prior 137 captures and assignments remain
intact, with no global refresh or reproduction execution.
See the [#2317 supplement](misfits-survey/supplement-2317.md).

Historical enrichment ran October 29, 2026, 09:12–09:18 MDT (15:12–15:18 UTC).
Workers searched explicit links and factual cluster terms among closed issues
and closed/merged PRs, without an age cutoff or a global historical census.
Each cluster allowed at most 10 retained items, three body quotes, four searches
of 15 candidates, 12 explicitly linked IDs, and 30 candidate metadata lookups.
Twenty-five clusters report search or selection caps. The Electric collection
metadata cluster retained no defensible historical match within those bounds.
The 22 standalone signals were outside the cluster-history pass. Historical
comments, reviews, diffs, implementation code, external artifacts, and
reproductions were not collected. All 134 original open items were excluded
from historical tables, regardless of later state changes. The
[historical index](misfits-survey/historical-enrichment/index.md) retains the
per-cluster limits and acquisition records.

## Probable Clusters

The [cluster index](misfits-survey/clustering/coverage-summary.md) lists all labels
and item counts in one table.

Assignments are extraction judgments from the retained Phase 2 snapshot. Reports, measurements, proposed APIs, and claimed fixes remain attributed to their sources; linked artifacts and reproductions were not inspected during the survey. Every open item has one primary assignment.

Grouping attributes below state the factual overlap. Exact selected values are member-evidence unions, rather than claims that every member has every listed value; [member evidence](misfits-survey/clustering/cluster-attribute-basis.json) exposes uneven overlap.

Historical tables below contain closed/merged context only. Shared wording or an explicit link does not establish a common cause, a current defect, or that a reported fix applies to an open item. Counts describe retained relationships; one historical artifact can appear in more than one cluster.

### Optimistic inserts / stable view keys

Grouping attributes: PR #734 explicitly links #19; both name viewKey and describe temporary-to-server ID transitions that affect component identity, focus, or rendering.

#### Current open items

| Item                                               | Type  | Title                                                                 | Status           | Labels | Body reactions |  +1 | Conversation comments | Reviews / inline comments | Updated              |
| -------------------------------------------------- | ----- | --------------------------------------------------------------------- | ---------------- | ------ | -------------: | --: | --------------------: | ------------------------- | -------------------- |
| [#19](https://github.com/TanStack/db/issues/19)    | issue | Support for Stable ViewKeys to Prevent UI Re-renders on ID Mapping    | OPEN             | none   |             27 |  27 |                     4 | —                         | 2025-12-18T14:47:11Z |
| [PR #734](https://github.com/TanStack/db/pull/734) | pr    | Add stable viewKey API to prevent UI re-renders during ID transitions | OPEN / non-draft | none   |              4 |   0 |                     7 | 2 / 6                     | 2026-03-23T06:42:50Z |

#### Representative snippets

- [#19](https://github.com/TanStack/db/issues/19#issuecomment-3582945205): “without this or manual mapping, it makes components with animations that trigger on mount look like a UI bug”
- [PR #734](https://github.com/TanStack/db/pull/734#body): “Previously, developers had to manually maintain an external mapping from IDs to stable keys.”

#### Historical related items

| Item                                                 | Title                                             | State  | Reactions / +1 | Comments | Closed / Merged (UTC)                                      | Why related                                                                                                                                                                                                                                 |
| ---------------------------------------------------- | ------------------------------------------------- | ------ | -------------: | -------: | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#956](https://github.com/TanStack/db/issues/956)    | Unable to insert without ID                       | CLOSED |          0 / 0 |        1 | Closed: 2025-12-03T14:26:59Z; merged: —                    | The issue body describes backend-generated IDs and an onInsert handler that writes the returned server ID, overlapping the ID-transition setup in open #19 and #734. It concerns inserting without an ID rather than a stable view-key API. |
| [PR #1830](https://github.com/TanStack/db/pull/1830) | docs: clarify ordering and transaction settlement | MERGED |          0 / 0 |        4 | Closed: 2026-09-16T19:00:53Z; merged: 2026-09-16T19:00:53Z | The PR body describes authoritative-key sync guidance and explicitly lists automatic temporary-to-authoritative key reconciliation as outside its scope, overlapping the temporary/server-ID transition in open #19 and #734.               |

Retained 2 items. Search or selection capped: yes. [Searches, historical snippets, and caveats](misfits-survey/historical-enrichment/c-stable-view-keys.md).

### Record writes / optimistic status and persistence

Grouping attributes: Both name getOptimisticInfo and record-level write observation: #20 requests optimistic metadata for saving feedback, while #661 requests awaiting active writes by record ID rather than retaining transactions.

#### Current open items

| Item                                              | Type  | Title                                                                   | Status | Labels | Body reactions |  +1 | Conversation comments | Reviews / inline comments | Updated              |
| ------------------------------------------------- | ----- | ----------------------------------------------------------------------- | ------ | ------ | -------------: | --: | --------------------: | ------------------------- | -------------------- |
| [#20](https://github.com/TanStack/db/issues/20)   | issue | Track Optimistic Status Per Record for Local-Only Query Differentiation | OPEN   | none   |              3 |   3 |                     1 | —                         | 2025-10-08T20:49:14Z |
| [#661](https://github.com/TanStack/db/issues/661) | issue | Add awaitPersisted() method to wait for record sync                     | OPEN   | none   |              2 |   2 |                     1 | —                         | 2026-03-03T00:43:22Z |

#### Representative snippets

- [#20](https://github.com/TanStack/db/issues/20#issuecomment-3383192505): “we're implementing **`collection.getOptimisticInfo(id)`** that returns rich metadata:”
- [#661](https://github.com/TanStack/db/issues/661#issue-body): “For fire-and-forget mutations or when multiple components might update the same record, it would be cleaner to await persistence by record ID:”

#### Historical related items

| Item                                                 | Title                                                               | State  | Reactions / +1 | Comments | Closed / Merged (UTC)                                      | Why related                                                                                                                                                                                                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------------- | ------ | -------------: | -------: | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [PR #660](https://github.com/TanStack/db/pull/660)   | Add getOptimisticInfo() method to track optimistic state per record | CLOSED |          0 / 0 |        5 | Closed: 2025-10-09T16:13:42Z; merged: —                    | Open #661 explicitly names #660; the PR body says Closes #20 and proposes collection.getOptimisticInfo(id), active-mutation metadata, saving badges, diff views, and rollback UI. The PR is CLOSED without a merge timestamp.                   |
| [PR #1652](https://github.com/TanStack/db/pull/1652) | Clarify local write status docs and pending sync contract           | MERGED |          0 / 0 |        4 | Closed: 2026-07-09T15:33:34Z; merged: 2026-07-09T15:33:34Z | The PR body explicitly references open #20 and #661 and describes row-level local optimistic write status and the transaction promise, including the distinction from backend confirmation.                                                     |
| [PR #1979](https://github.com/TanStack/db/pull/1979) | feat(db): add explicit local write and transaction settlement APIs  | MERGED |          0 / 0 |        4 | Closed: 2026-10-01T16:12:18Z; merged: 2026-10-01T16:12:18Z | The PR body introduces row.$hasPendingWrites for unsettled optimistic mutations and tx.when('settled') as the same promise as tx.isPersisted.promise, overlapping open #20's per-record status request and #661's write-waiting API discussion. |
| [PR #1830](https://github.com/TanStack/db/pull/1830) | docs: clarify ordering and transaction settlement                   | MERGED |          0 / 0 |        4 | Closed: 2026-09-16T19:00:53Z; merged: 2026-09-16T19:00:53Z | The PR body describes race-safe per-item pending markers, tracking multiple transactions, and isPersisted.promise handler-settlement guidance, overlapping saving feedback in open #20 and concurrent record-write waiting in #661.             |
| [PR #376](https://github.com/TanStack/db/pull/376)   | fix(transactions): always resolve isPersisted.promise               | MERGED |          0 / 0 |        2 | Closed: 2025-08-04T14:43:17Z; merged: 2025-08-04T14:43:17Z | The merged PR title names isPersisted.promise, the exact settlement promise discussed in open #661. Its short captured body only links a separate issue, so no additional behavior is inferred from it.                                         |

Retained 5 items. Search or selection capped: yes. [Searches, historical snippets, and caveats](misfits-survey/historical-enrichment/c-record-write-status.md).

### Transactions / persistence failures and user feedback

Grouping attributes: Both concern transaction persistence failure and continued user feedback or control: correcting validation and retrying in #22, and observing late failure after navigation in #487.

#### Current open items

| Item                                              | Type  | Title                                                         | Status | Labels | Body reactions |  +1 | Conversation comments | Reviews / inline comments | Updated              |
| ------------------------------------------------- | ----- | ------------------------------------------------------------- | ------ | ------ | -------------: | --: | --------------------: | ------------------------- | -------------------- |
| [#22](https://github.com/TanStack/db/issues/22)   | issue | Support Recoverable Validation Flow for Explicit Transactions | OPEN   | none   |              1 |   1 |                     1 | —                         | 2025-04-28T17:13:35Z |
| [#487](https://github.com/TanStack/db/issues/487) | issue | Declaring custom rollback behavior                            | OPEN   | none   |              0 |   0 |                     4 | —                         | 2025-09-03T13:08:41Z |

#### Representative snippets

- [#22](https://github.com/TanStack/db/issues/22#issue-body): “validation failures (e.g., missing fields, business logic rejections) are recoverable and should allow the user or application to correct inputs and retry without discarding the original transaction.”
- [#487](https://github.com/TanStack/db/issues/487#issuecomment-3249117170): “If the optimistic save ultimately fails (which occurs after the redirect), the list page has no access to the `transaction`.”

#### Historical related items

| Item                                                 | Title                                                               | State  | Reactions / +1 | Comments | Closed / Merged (UTC)                                      | Why related                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------- | ------------------------------------------------------------------- | ------ | -------------: | -------: | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [PR #558](https://github.com/TanStack/db/pull/558)   | Fix transaction commit() to throw errors instead of swallowing them | MERGED |          0 / 0 |        8 | Closed: 2025-09-16T20:45:46Z; merged: 2025-09-16T20:45:46Z | The PR body describes mutationFn errors, rollback, and errors observable through await tx.commit() and await tx.isPersisted.promise. These named failure/settlement APIs overlap explicit persistence failures in open #22 and promise-based error handling in #487.                                      |
| [PR #2080](https://github.com/TanStack/db/pull/2080) | fix(db): stop tracking a transaction after it fails or rolls back   | MERGED |          0 / 0 |        6 | Closed: 2026-10-09T17:06:51Z; merged: 2026-10-09T17:06:51Z | The PR body describes removing failed or rolled-back transactions from Collection tracking, settlement of isPersisted after subscriber errors, and failed commit() rejection. These are historical context for the failed-transaction lifetime and late-error observation discussed in open #22 and #487. |

Retained 2 items. Search or selection capped: yes. [Searches, historical snippets, and caveats](misfits-survey/historical-enrichment/c-transaction-failure-feedback.md).

### useLiveQuery / item-level list rendering

Grouping attributes: Both name useLiveQuery and request item-level updates in lists so child components can render independently of the outer list.

#### Current open items

| Item                                              | Type  | Title                                                              | Status | Labels | Body reactions |  +1 | Conversation comments | Reviews / inline comments | Updated              |
| ------------------------------------------------- | ----- | ------------------------------------------------------------------ | ------ | ------ | -------------: | --: | --------------------: | ------------------------- | -------------------- |
| [#50](https://github.com/TanStack/db/issues/50)   | issue | Optional lazy results for the useLiveQuery hook                    | OPEN   | none   |              0 |   0 |                     0 | —                         | 2025-05-06T09:47:28Z |
| [#126](https://github.com/TanStack/db/issues/126) | issue | Add helpers for fine grained reactivity in React from useLiveQuery | OPEN   | none   |              1 |   1 |                     2 | —                         | 2025-07-23T19:07:16Z |

#### Representative snippets

- [#50](https://github.com/TanStack/db/issues/50#issue-body): “only triggers a re-render when the length of the results change, or a key moves/changes.”
- [#126](https://github.com/TanStack/db/issues/126#issue-body): “or in the sub component a custom hook that you use to trigger re-rendering when the sub-item changes”

#### Historical related items

| Item                                                 | Title                                                                               | State  | Reactions / +1 | Comments | Closed / Merged (UTC)                                      | Why related                                                                                                                                                                                                                           |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------- | ------ | -------------: | -------: | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [PR #155](https://github.com/TanStack/db/pull/155)   | refactor collection for fine grained reactivity                                     | MERGED |          1 / 0 |        4 | Closed: 2025-06-12T16:56:02Z; merged: 2025-06-12T16:56:02Z | The body describes subscribing to the whole collection or a single key and framework reactivity, sharing the item-level subscription workflow requested by #50 and #126.                                                              |
| [PR #1515](https://github.com/TanStack/db/pull/1515) | [DB] feat: add keyed collection subscriptions                                       | CLOSED |          0 / 0 |        1 | Closed: 2026-09-22T12:48:48Z; merged: —                    | The closed, unmerged PR body describes pairing collection.get(key) with a keyed subscription for row-level rendering, the same list-item subscription workflow requested by #50 and #126.                                             |
| [PR #1316](https://github.com/TanStack/db/pull/1316) | Fine-grained Solid stores for useLiveQuery                                          | MERGED |          0 / 0 |        4 | Closed: 2026-03-09T12:48:40Z; merged: 2026-03-09T12:48:40Z | The title and body describe fine-grained Solid useLiveQuery stores, a named hook and rendering-granularity overlap with #126; the framework differs from the React request.                                                           |
| [PR #1609](https://github.com/TanStack/db/pull/1609) | Solid renderer rework - huge performance gains                                      | CLOSED |          2 / 1 |        1 | Closed: 2026-08-11T23:36:37Z; merged: —                    | The closed, unmerged Solid PR body discusses an entire-store reset for one field change and updating rows in place when data order is unchanged, matching the item-versus-list update distinction in #50 and #126.                    |
| [PR #1642](https://github.com/TanStack/db/pull/1642) | feat(db): shared live-query observer + migrate all five adapters (RFC #1623 step 3) | MERGED |          0 / 0 |        7 | Closed: 2026-08-11T23:36:32Z; merged: 2026-08-11T23:36:32Z | The body describes shared snapshots and change sets, fine-grained keyed-map updates in Vue/Svelte/Solid, and React snapshot consumption; these are historical rendering-granularity context for #50 and #126.                         |
| [PR #1669](https://github.com/TanStack/db/pull/1669) | feat(db): ordered snapshot / layout-revision contract (RFC #1623 phase 4)           | MERGED |          0 / 0 |        7 | Closed: 2026-08-12T00:19:26Z; merged: 2026-08-12T00:19:26Z | The body describes a layout revision for visible membership and ordering changes, sharing #50’s explicit distinction between list layout changes and projected item-value changes.                                                    |
| [PR #1825](https://github.com/TanStack/db/pull/1825) | fix(solid-db): preserve live result identity during reconciliation                  | MERGED |          0 / 0 |        4 | Closed: 2026-09-16T20:04:27Z; merged: 2026-09-16T20:04:27Z | The body describes one stable Solid row store per live result key and an ordered result array from stable row objects, sharing the item-level update and list-identity workflow of #50 and #126; it concerns Solid rather than React. |

Retained 7 items. Search or selection capped: yes. [Searches, historical snippets, and caveats](misfits-survey/historical-enrichment/c-item-level-rendering.md).

### Electric / collection metadata for generic mutations

Grouping attributes: #103 explicitly names #96; both name ElectricCollection, streamOptions, and mutationFn, and discuss collection metadata used to route generic backend mutations.

#### Current open items

| Item                                              | Type  | Title                                                                                       | Status | Labels | Body reactions |  +1 | Conversation comments | Reviews / inline comments | Updated              |
| ------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------- | ------ | ------ | -------------: | --: | --------------------: | ------------------------- | -------------------- |
| [#96](https://github.com/TanStack/db/issues/96)   | issue | Expose the original streamOptions in getSyncMetadata?                                       | OPEN   | none   |              0 |   0 |                     1 | —                         | 2025-05-21T18:06:17Z |
| [#103](https://github.com/TanStack/db/issues/103) | issue | Identifying the table/schema on the backend when ingesting from a generic mutation handler. | OPEN   | none   |              0 |   0 |                     0 | —                         | 2025-05-21T17:17:26Z |

#### Representative snippets

- [#96](https://github.com/TanStack/db/issues/96#issue-body): “Would there be any downside to extending the exposed sync metadata with the original streamOptions?”
- [#103](https://github.com/TanStack/db/issues/103#issue-body): “This is fragile because it's totally valid not to use the table param when making a request to a proxy.”

#### Historical related items

| Item | Title | State | Reactions / +1 | Comments | Closed / Merged (UTC) | Why related |
| ---- | ----- | ----- | -------------: | -------: | --------------------- | ----------- |

No related historical items were retained within the bounded searches. This does not establish that no related history exists.

Retained 0 items. Search or selection capped: yes. [Searches, historical snippets, and caveats](misfits-survey/historical-enrichment/c-electric-mutation-metadata.md).

### Collection mutations / generated fields and read-write payloads

Grouping attributes: #456 and #465 name insertion handlers and transaction.mutations around generated fields; #465, #878, and #1115 describe differing read and insert/update payloads with Query Collection integration. The bridge is generated or transformed mutation data, not generic collection use.

#### Current open items

| Item                                                | Type  | Title                                                                                                | Status | Labels | Body reactions |  +1 | Conversation comments | Reviews / inline comments | Updated              |
| --------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------- | ------ | ------ | -------------: | --: | --------------------: | ------------------------- | -------------------- |
| [#456](https://github.com/TanStack/db/issues/456)   | issue | Adding server-generated properties to transaction in Collection.onInsert etc.                        | OPEN   | none   |              0 |   0 |                     2 | —                         | 2025-08-28T06:21:12Z |
| [#465](https://github.com/TanStack/db/issues/465)   | issue | Feature Request: Allow default values / computed fields on Persistence Handlers for QueryCollections | OPEN   | none   |              5 |   5 |                     2 | —                         | 2026-01-03T08:33:19Z |
| [#878](https://github.com/TanStack/db/issues/878)   | issue | Supabase x Tanstack DB: How to use it and collection helper explorations                             | OPEN   | none   |              2 |   2 |                     4 | —                         | 2026-08-20T13:24:48Z |
| [#1115](https://github.com/TanStack/db/issues/1115) | issue | [Feature Request] Split schema into selectSchema, insertSchema, updateSchema for granular control    | OPEN   | none   |              2 |   1 |                     8 | —                         | 2026-04-18T12:12:17Z |
| [#2340](https://github.com/TanStack/db/issues/2340) | issue | Revalidate live-query mutation inputs that require virtual read metadata                             | OPEN   | none   |              0 |   0 |                     0 | —                         | 2026-11-02T23:29:41Z |

#### Representative snippets

- [#456](https://github.com/TanStack/db/issues/456#issue-body): “How can I access the `publicId` returned by the server here?”
- [#1115](https://github.com/TanStack/db/issues/1115#issue-body): “transformations are not applied to data coming from sync”

#### Historical related items

| Item                                                 | Title                                                                                                                              | State  | Reactions / +1 | Comments | Closed / Merged (UTC)                                      | Why related                                                                                                                                                                                                                                |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------ | -------------: | -------: | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [#396](https://github.com/TanStack/db/issues/396)    | Types are incorrect for schema, where input & output are different                                                                 | CLOSED |          0 / 0 |       16 | Closed: 2025-09-17T19:34:13Z; merged: —                    | #1115 explicitly links this closed issue, whose body asks about schema input/output differences and parsed return values.                                                                                                                  |
| [PR #209](https://github.com/TanStack/db/pull/209)   | Ensure schemas can apply defaults when inserting                                                                                   | MERGED |          0 / 0 |       24 | Closed: 2025-07-15T13:46:38Z; merged: 2025-07-15T13:46:38Z | The merged PR title names schema defaults on insert, directly overlapping #465’s requested internally supplied default fields and #1115’s differing input/read shapes; its short body delegates details to a comment that was not fetched. |
| [PR #401](https://github.com/TanStack/db/pull/401)   | WIP improve schema support and refactor collection options factory function types                                                  | CLOSED |          0 / 0 |        6 | Closed: 2025-09-27T11:41:09Z; merged: —                    | The closed, unmerged PR body names #396 and says schema transforms must be applied on insert and update, matching the transform and operation-shape terms in #1115.                                                                        |
| [#237](https://github.com/TanStack/db/issues/237)    | Add support for derived fields                                                                                                     | CLOSED |          1 / 1 |        1 | Closed: 2026-09-16T16:15:12Z; merged: —                    | The body requests derived fields that callers cannot set and says insert/update should use the schema input type instead of output, matching #465’s computed-field workflow and #1115’s separate operation payloads.                       |
| [PR #303](https://github.com/TanStack/db/pull/303)   | feat(query-db-collection): add manual write methods for direct state updates                                                       | MERGED |          3 / 1 |        6 | Closed: 2025-07-31T13:02:47Z; merged: 2025-07-31T13:02:47Z | The merged PR body introduces direct writes from mutation responses and describes avoiding automatic refetching, sharing #456’s request to use returned server data without refetching the entire collection.                              |
| [PR #879](https://github.com/TanStack/db/pull/879)   | Fixed query collection bug where optimistic state leaked into syncedData when using writeInsert inside onInsert handlers           | MERGED |          0 / 0 |        4 | Closed: 2025-11-21T14:41:33Z; merged: 2025-11-21T14:41:33Z | The merged PR body explicitly discusses server-generated IDs/timestamps written with writeInsert inside onInsert, overlapping #456’s generated response fields and #1115’s server-generated-field workflow.                                |
| [#956](https://github.com/TanStack/db/issues/956)    | Unable to insert without ID                                                                                                        | CLOSED |          0 / 0 |        1 | Closed: 2025-12-03T14:26:59Z; merged: —                    | The closed issue describes inserting without a backend-generated ID and expects onInsert to synchronize it, directly overlapping #456’s returned generated ID and #465’s request to omit internally supplied ID fields.                    |
| [#1442](https://github.com/TanStack/db/issues/1442)  | Optimistic insert not removed when server returns a different key                                                                  | CLOSED |          2 / 0 |        3 | Closed: 2026-05-24T13:59:13Z; merged: —                    | The closed issue body describes server-returned keys and computed fields after optimistic insertion, sharing #456’s server-response workflow and #465’s generated-field distinction.                                                       |
| [PR #1861](https://github.com/TanStack/db/pull/1861) | fix(query-db-collection): preserve schema output in select                                                                         | MERGED |          0 / 0 |        4 | Closed: 2026-09-21T23:26:20Z; merged: 2026-09-21T23:26:20Z | The merged PR body describes selected Query Collection rows retaining schema output while mutations accept schema input, sharing the read/write type distinction in #465 and #1115; it explicitly excludes split-schema feature work.      |
| [#1871](https://github.com/TanStack/db/issues/1871)  | queryCollectionOptions: `schema` rejects transforming schemas (input ≠ output) — Effect Schema DateFromString collapses to `never` | CLOSED |          0 / 0 |        1 | Closed: 2026-09-21T23:53:50Z; merged: —                    | The closed issue body reports Query Collection rejection of schemas whose input and output types differ and Date decoding, matching #465’s Query Collection input-shape concern and #1115’s transform/read-write schema request.           |

Retained 10 items. Search or selection capped: yes. [Searches, historical snippets, and caveats](misfits-survey/historical-enrichment/c-mutation-payload-shapes.md).

### PowerSync / local persistence and server confirmation

Grouping attributes: #1526 explicitly links #900; both describe PowerSync local SQLite persistence completing before backend confirmation and request observable server-sync status.

#### Current open items

| Item                                                | Type  | Title                                                                             | Status | Labels | Body reactions |  +1 | Conversation comments | Reviews / inline comments | Updated              |
| --------------------------------------------------- | ----- | --------------------------------------------------------------------------------- | ------ | ------ | -------------: | --: | --------------------: | ------------------------- | -------------------- |
| [#900](https://github.com/TanStack/db/issues/900)   | issue | [PowerSync]: Replacing optimistic state after insert                              | OPEN   | none   |              1 |   0 |                     7 | —                         | 2025-11-27T06:16:05Z |
| [#1526](https://github.com/TanStack/db/issues/1526) | issue | [PowerSync]: $synced reflects local SQLite persistence, not backend upload status | OPEN   | none   |              2 |   0 |                     1 | —                         | 2026-06-09T08:28:52Z |

#### Representative snippets

- [#900](https://github.com/TanStack/db/issues/900#issue-body): “There should be a way to await syncing of the confirmed data, and to swap out optimistic data for confirmed.”
- [#1526](https://github.com/TanStack/db/issues/1526#issue-body): “This entire flow is local.”

#### Historical related items

| Item                                                 | Title                                                                                                    | State  | Reactions / +1 | Comments | Closed / Merged (UTC)                                      | Why related                                                                                                                                                                                |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------ | -------------: | -------: | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [#893](https://github.com/TanStack/db/issues/893)    | usePacedMutation: No way to sync/clear mutations store after optimistic insert with server-generated IDs | CLOSED |          0 / 0 |        2 | Closed: 2025-11-24T19:15:19Z; merged: —                    | Open #900 explicitly references this report about temporary and server-generated IDs remaining together after writeInsert; it concerns row replacement rather than backend upload status.  |
| [PR #747](https://github.com/TanStack/db/pull/747)   | Add PowerSync DB Collection                                                                              | MERGED |          2 / 0 |        8 | Closed: 2025-11-03T23:23:17Z; merged: 2025-11-03T23:23:17Z | The adapter introduction describes local SQLite persistence through PowerSyncTransactor followed by a PowerSync backend upload queue, the two stages named by #900 and #1526.              |
| [PR #1831](https://github.com/TanStack/db/pull/1831) | fix(powersync): preserve updates and support PowerSync 2                                                 | MERGED |          0 / 0 |        7 | Closed: 2026-09-17T12:44:07Z; merged: 2026-09-17T12:44:07Z | The body explicitly names #900 and #1526 under non-goals for backend acknowledgement or upload completion semantics, while describing transaction settlement after observed SQLite writes. |
| [PR #999](https://github.com/TanStack/db/pull/999)   | feat: [PowerSync] Support Collection Metadata                                                            | MERGED |          0 / 0 |        4 | Closed: 2026-01-06T16:31:56Z; merged: 2026-01-06T16:31:56Z | The metadata PR describes persistence of PowerSync CRUD metadata and access during uploadData, a named upload workflow in #1526; it does not claim an upload-confirmation property.        |

Retained 4 items. Search or selection capped: yes. [Searches, historical snippets, and caveats](misfits-survey/historical-enrichment/c-powersync-confirmation.md).

### Agent skills / Electric and TanStack Start server examples

Grouping attributes: Both are skill-version 0.5.30 feedback for Electric with TanStack Start; both name meta-framework, collection.preload(), and createServerFn while requesting connected server integration examples.

#### Current open items

| Item                                                | Type  | Title                                                                   | Status | Labels | Body reactions |  +1 | Conversation comments | Reviews / inline comments | Updated              |
| --------------------------------------------------- | ----- | ----------------------------------------------------------------------- | ------ | ------ | -------------: | --: | --------------------: | ------------------------- | -------------------- |
| [#1333](https://github.com/TanStack/db/issues/1333) | issue | Skill Feedback: db-core collection-setup + mutations + react-db (mixed) | OPEN   | none   |              0 |   0 |                     0 | —                         | 2026-03-06T18:03:30Z |
| [#1336](https://github.com/TanStack/db/issues/1336) | issue | Skill Feedback: meta-framework (mixed)                                  | OPEN   | none   |              0 |   0 |                     0 | —                         | 2026-03-06T21:09:33Z |

#### Representative snippets

- [#1333](https://github.com/TanStack/db/issues/1333#issue-body): “You need BOTH for types like timestamptz”
- [#1336](https://github.com/TanStack/db/issues/1336#issue-body): “**Server-side integration is completely absent**”

#### Historical related items

| Item                                                 | Title                                         | State  | Reactions / +1 | Comments | Closed / Merged (UTC)                                      | Why related                                                                                                                                                                                                                                          |
| ---------------------------------------------------- | --------------------------------------------- | ------ | -------------: | -------: | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [PR #1330](https://github.com/TanStack/db/pull/1330) | feat: add Intent agent skills for TanStack DB | MERGED |          0 / 0 |        5 | Closed: 2026-03-06T21:27:32Z; merged: 2026-03-06T21:27:32Z | The skill introduction inventories collection-setup, mutations-optimistic, react-db, and meta-framework and states v0.5.30, matching the named guidance and skill version in #1333 and #1336.                                                        |
| [PR #1696](https://github.com/TanStack/db/pull/1696) | docs: update agent skills for current APIs    | MERGED |          0 / 0 |        4 | Closed: 2026-08-13T17:04:21Z; merged: 2026-08-13T17:04:21Z | The later skill refresh names Electric adapter details, mutation settlement, core setup, and meta-framework loader patterns; these are named guidance areas in #1333 and #1336, without a claim that it resolves their reported server-example gaps. |
| [#366](https://github.com/TanStack/db/issues/366)    | Electric collection desync using txid         | CLOSED |          0 / 0 |        9 | Closed: 2025-08-04T17:21:37Z; merged: —                    | This closed report contains an Electric mutation handler and a createServerFn server write returning a PostgreSQL txid, the connected write workflow requested by #1333 and #1336.                                                                   |
| [#1332](https://github.com/TanStack/db/issues/1332)  | Skill Feedback: meta-framework (good)         | CLOSED |          0 / 0 |        1 | Closed: 2026-09-22T12:48:49Z; merged: —                    | This closed skill-feedback report uses meta-framework v0.5.30 with TanStack Start and collection.preload(), matching the skill, version, and loader workflow in #1333 and #1336; its backend is Durable Streams rather than Electric.                |

Retained 4 items. Search or selection capped: yes. [Searches, historical snippets, and caveats](misfits-survey/historical-enrichment/c-electric-start-skills.md).

### Effects / initial delivery, readiness, and replay

Grouping attributes: #1394 and #2117 name createEffect and skipInitial around initial-row delivery; PR #2277 explicitly links #2117 and names useLiveQueryEffect, Model D, and ordinary Effects over lagging sources.

#### Current open items

| Item                                                | Type  | Title                                                                                                | Status | Labels | Body reactions |  +1 | Conversation comments | Reviews / inline comments | Updated              |
| --------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------- | ------ | ------ | -------------: | --: | --------------------: | ------------------------- | -------------------- |
| [#1394](https://github.com/TanStack/db/issues/1394) | issue | Feature: effect cursor / startAfter for durable replay                                               | OPEN   | none   |              0 |   0 |                     1 | —                         | 2026-03-21T15:32:06Z |
| [#2117](https://github.com/TanStack/db/issues/2117) | issue | Extend the Effect skipInitial oracle lane: ordered windows, includes, failures, and ordinary Effects | OPEN   | none   |              0 |   0 |                     0 | —                         | 2026-10-12T21:10:45Z |

#### Representative snippets

- [#1394](https://github.com/TanStack/db/issues/1394#issue-body): “Effect fires `onEnter` again for the already-completed run → duplicate "child-done" message”
- [PR #2277](https://github.com/TanStack/db/pull/2277#body): “the gate sentence ("Every Effect passes its gate there too, with or without `skipInitial`") could also be read as holding initial rows until readiness.”

#### Historical related items

| Item                                                 | Title                                                                                              | State  | Reactions / +1 | Comments | Closed / Merged (UTC)                                      | Why related                                                                                                                                                                                                                                        |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------ | -------------: | -------: | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [PR #2115](https://github.com/TanStack/db/pull/2115) | fix(db): ready a live query once its on-demand subset settles                                      | MERGED |          0 / 0 |        6 | Closed: 2026-10-13T05:25:13Z; merged: 2026-10-13T05:25:13Z | Open #2117 explicitly names this merged PR as the origin of its Effect skipInitial lane; its body describes initial suppression ending with settled query demand and lists coverage limits.                                                        |
| [#2113](https://github.com/TanStack/db/issues/2113)  | Progressive collection live queries remain suspended after their requested subset finishes loading | CLOSED |          0 / 0 |        1 | Closed: 2026-10-13T05:25:14Z; merged: —                    | Open #2117 explicitly links this closed progressive-source readiness report alongside #2115; the report describes requested subset completion before full-source readiness.                                                                        |
| [PR #1405](https://github.com/TanStack/db/pull/1405) | feat: cursor-aware effect replay with startAfter gating                                            | CLOSED |          0 / 0 |        5 | Closed: 2026-10-05T15:24:26Z; merged: —                    | This closed, unmerged PR proposes startAfter cursor gating for replay while hydrating query state, the named replay-cursor workflow requested by #1394.                                                                                            |
| [PR #1221](https://github.com/TanStack/db/pull/1221) | feat(db): implement createEffect reactive effects API                                              | MERGED |          2 / 0 |        6 | Closed: 2026-03-13T15:22:21Z; merged: 2026-03-13T15:22:21Z | The merged Effect API introduction names createEffect, useLiveQueryEffect, skipInitial, and delta events, the APIs underlying all three open members.                                                                                              |
| [PR #2127](https://github.com/TanStack/db/pull/2127) | fix(electric): a stream error that onError retries does not fail waiting loads                     | MERGED |          0 / 0 |        5 | Closed: 2026-10-13T23:39:53Z; merged: 2026-10-13T23:39:52Z | The merged Electric retry PR describes a skipInitial Effect being disposed by a stream error before the first ready and distinguishes retried loads from final failures, overlapping the failure and readiness histories named in #2117 and #2277. |
| [PR #2129](https://github.com/TanStack/db/pull/2129) | fix(db): recover a live query's demand when its source recovers from error                         | CLOSED |          0 / 0 |        6 | Closed: 2026-10-13T20:09:46Z; merged: —                    | This closed, unmerged PR describes Model D source-error and failure histories and explicitly limits skipInitial Effects to disposal on source error, overlapping the source-failure coverage requested by #2117.                                   |

Retained 6 items. Search or selection capped: no. [Searches, historical snippets, and caveats](misfits-survey/historical-enrichment/c-effect-initial-delivery.md).

### Electric / sync confirmation and optimistic writes

Grouping attributes: All name Electric txid confirmation through awaitTxId and observations while optimistic writes await replicated rows; #2244 explicitly links #2120. #337 concerns multiple collections, #1602 serial offline drain, #2120 progressive background sync, and #2244 scoped move-in snapshots.

#### Current open items

| Item                                                 | Type  | Title                                                                                                                 | Status | Labels                  | Body reactions |  +1 | Conversation comments | Reviews / inline comments | Updated              |
| ---------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------- | -------------: | --: | --------------------: | ------------------------- | -------------------- |
| [#337](https://github.com/TanStack/db/issues/337)    | issue | Awaiting txid across multiple collections.                                                                            | OPEN   | documentation, question |              0 |   0 |                     2 | —                         | 2025-07-30T20:47:56Z |
| [#1602](https://github.com/TanStack/db/issues/1602)  | issue | offline-transactions: confirm writes off the serial drain (hold optimistic state through the post-commit sync window) | OPEN   | none                    |              2 |   2 |                     0 | —                         | 2026-06-19T09:05:40Z |
| [#2120](https://github.com/TanStack/db/issues/2120)  | issue | Electric progressive: apply and confirm changes to visible rows during the background full sync                       | OPEN   | none                    |              0 |   0 |                     0 | —                         | 2026-10-12T22:03:03Z |
| [#2244](https://github.com/TanStack/db/issues/2244)  | issue | Electric: scoped move-in snapshots can prematurely resolve awaitTxId and remove optimistic rows                       | OPEN   | none                    |              0 |   0 |                     0 | —                         | 2026-10-24T10:19:59Z |
| [PR #2304](https://github.com/TanStack/db/pull/2304) | pr    | fix(electric): establish stream positions before optimistic writes                                                    | OPEN   | none                    |              0 |   0 |                     2 | 4 / 3                     | 2026-10-30T17:04:40Z |

#### Representative snippets

- [#337](https://github.com/TanStack/db/issues/337#issue-body): “Specifically, is there a better way we can monitor the txid syncing back when writes are made to multiple collections?”
- [#2244](https://github.com/TanStack/db/issues/2244#issue-body): “an inserted row disappears until its real synced row arrives.”

#### Historical related items

| Item                                                 | Title                                                                                                                 | State  | Reactions / +1 | Comments | Closed / Merged (UTC)                                      | Why related                                                                                                                                                                                                                                       |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------ | -------------: | -------: | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [PR #648](https://github.com/TanStack/db/pull/648)   | electric-db-collection: support for snapshots in awaitTxid                                                            | MERGED |          0 / 0 |        4 | Closed: 2025-10-06T16:40:08Z; merged: 2025-10-06T16:40:08Z | Open #2244 explicitly links this merged PR, whose body describes awaitTxId confirmation using PostgreSQL snapshot metadata from snapshot-end messages.                                                                                            |
| [PR #924](https://github.com/TanStack/db/pull/924)   | fix(electric-db-colleciton): ignore `snapshot-end` before `up-to-date`                                                | MERGED |          0 / 0 |        5 | Closed: 2025-11-27T15:28:04Z; merged: 2025-11-27T15:28:04Z | Open #2244 explicitly links this merged PR, whose body discusses snapshot-end publication before the first up-to-date message in eager Electric sync.                                                                                             |
| [PR #1561](https://github.com/TanStack/db/pull/1561) | test(db): reproduce stale buffered sync when optimistic snapback races a persisting transaction                       | CLOSED |          0 / 0 |        3 | Closed: 2026-05-27T13:05:00Z; merged: —                    | Open #2244 explicitly links this closed, unmerged PR; its body describes awaitTxId snapshot confirmation preceding a row change and optimistic snapback during another persisting transaction.                                                    |
| [#2113](https://github.com/TanStack/db/issues/2113)  | Progressive collection live queries remain suspended after their requested subset finishes loading                    | CLOSED |          0 / 0 |        1 | Closed: 2026-10-13T05:25:14Z; merged: —                    | Open #2120 explicitly links this closed report about progressive Electric subset readiness while full background sync remains unfinished.                                                                                                         |
| [PR #2115](https://github.com/TanStack/db/pull/2115) | fix(db): ready a live query once its on-demand subset settles                                                         | MERGED |          0 / 0 |        6 | Closed: 2026-10-13T05:25:13Z; merged: 2026-10-13T05:25:13Z | Open #2120 explicitly links this merged readiness PR; its body states that readiness does not make progressive snapshot rows fresher while Electric holds stream changes until full sync.                                                         |
| [#2201](https://github.com/TanStack/db/issues/2201)  | SQLite persistence: after two quick writes to one row, the collection briefly shows the state before the second write | CLOSED |          0 / 0 |        3 | Closed: 2026-10-21T17:41:31Z; merged: —                    | Open #2244 explicitly links this closed report of an Electric persisted collection briefly showing pre-update state after awaitTxId confirmation.                                                                                                 |
| [PR #2208](https://github.com/TanStack/db/pull/2208) | fix(db): keep settled optimistic rows while their server row waits behind a persisted write                           | MERGED |          0 / 0 |        6 | Closed: 2026-10-21T17:41:30Z; merged: 2026-10-21T17:41:29Z | Open #2244 explicitly links this merged PR about settled optimistic rows while an acknowledged Electric server row waits behind a persisted write.                                                                                                |
| [PR #1603](https://github.com/TanStack/db/pull/1603) | feat(offline-transactions): confirm writes off the serial drain path (confirmWrite hook)                              | CLOSED |          0 / 0 |        2 | Closed: 2026-09-17T16:43:29Z; merged: —                    | This closed, unmerged PR explicitly says Closes #1602 and proposes the confirmWrite hook, off-drain confirmation, and optimistic holds requested in that open member.                                                                             |
| [PR #1547](https://github.com/TanStack/db/pull/1547) | fix(db): drop stale direct optimistic rows after txid sync                                                            | MERGED |          1 / 1 |        4 | Closed: 2026-05-23T13:30:14Z; merged: 2026-05-23T13:30:13Z | The merged PR body names awaitTxId and describes retaining optimistic rows during persistence and replacing them after txid sync, overlapping #337's cross-collection optimistic handoff question and #2244's optimistic-row confirmation report. |
| [#1060](https://github.com/TanStack/db/issues/1060)  | usePacedMutations value regression while persisting                                                                   | CLOSED |          2 / 2 |        1 | Closed: 2026-09-30T13:52:27Z; merged: —                    | This closed report describes Electric paced mutations regressing to pre-optimistic values while persisting and a UI glitch; #1602 describes optimistic flicker around asynchronous confirmation. Their mutation workflows differ.                 |

Retained 10 items. Search or selection capped: yes. [Searches, historical snippets, and caveats](misfits-survey/historical-enrichment/c-electric-write-confirmation.md).

### Framework adapters / SSR and hydration

Grouping attributes: All three explicitly link #1564 and #1623, name DbClient and dbClient.dehydrate, and request framework-specific server rendering and browser hydration on shared core facilities.

#### Current open items

| Item                                                 | Type  | Title                                                          | Status | Labels | Body reactions |  +1 | Conversation comments | Reviews / inline comments | Updated              |
| ---------------------------------------------------- | ----- | -------------------------------------------------------------- | ------ | ------ | -------------: | --: | --------------------: | ------------------------- | -------------------- |
| [#1963](https://github.com/TanStack/db/issues/1963)  | issue | SSR and hydration support for @tanstack/vue-db                 | OPEN   | none   |              0 |   0 |                     0 | —                         | 2026-09-30T22:00:42Z |
| [#1964](https://github.com/TanStack/db/issues/1964)  | issue | SSR and hydration support for @tanstack/solid-db               | OPEN   | none   |              0 |   0 |                     0 | —                         | 2026-09-30T22:01:18Z |
| [#1965](https://github.com/TanStack/db/issues/1965)  | issue | SSR and hydration support for @tanstack/angular-db             | OPEN   | none   |              0 |   0 |                     0 | —                         | 2026-09-30T22:02:07Z |
| [#2322](https://github.com/TanStack/db/issues/2322)  | issue | Disabled useLiveQuery fails SSR hydration with error 253       | OPEN   | none   |              0 |   0 |                     0 | —                         | 2026-10-31T12:47:14Z |
| [PR #2323](https://github.com/TanStack/db/pull/2323) | pr    | fix(db): hydrate disabled live queries without a stream record | OPEN   | none   |              0 |   0 |                     2 | 0 / 0                     | 2026-10-31T12:55:10Z |

#### Representative snippets

- [#1963](https://github.com/TanStack/db/issues/1963#issue-body): “The current SSR guide explicitly leaves Vue client-provider work for a later change.”
- [#1965](https://github.com/TanStack/db/issues/1965#issue-body): “Angular still needs its own client/SSR integration.”

#### Historical related items

| Item                                                 | Title                                                        | State  | Reactions / +1 | Comments | Closed / Merged (UTC)                                      | Why related                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------- | ------------------------------------------------------------ | ------ | -------------: | -------: | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [PR #1564](https://github.com/TanStack/db/pull/1564) | Add SSR DbClient and live query identity                     | MERGED |         16 / 7 |       11 | Closed: 2026-08-17T23:14:27Z; merged: 2026-08-17T23:14:27Z | All three open members explicitly link this merged SSR foundation PR and request framework-specific integration on its DbClient and hydration facilities.                                                                                                                                  |
| [#1623](https://github.com/TanStack/db/issues/1623)  | RFC: Live Query Framework Bindings Platform                  | CLOSED |          2 / 2 |        3 | Closed: 2026-09-30T22:10:51Z; merged: —                    | All three open members explicitly link this closed framework-bindings RFC, whose implementation checklist leaves SSR/client hydration open and whose text discusses framework-native integration.                                                                                          |
| [#545](https://github.com/TanStack/db/issues/545)    | Add SSR & RSC Support for @tanstack/react-db                 | CLOSED |        66 / 40 |       17 | Closed: 2026-10-07T22:32:57Z; merged: —                    | This closed React SSR proposal discusses server live queries, dehydration/hydration and isolation between requests, matching the shared workflow in all three open requests; it also explicitly calls for coordination with vue-db and angular-db.                                         |
| [PR #2077](https://github.com/TanStack/db/pull/2077) | fix: bind standalone descriptor queries to receiving clients | MERGED |          0 / 0 |       16 | Closed: 2026-10-11T16:34:51Z; merged: 2026-10-11T16:34:51Z | The merged PR describes reusable descriptors across React providers and server preloads, plus hydration source identity. All three open requests name collection descriptors and request-scoped client hydration; its body limits Vue, Solid, and Angular callers to concrete Collections. |

Retained 4 items. Search or selection capped: yes. [Searches, historical snippets, and caveats](misfits-survey/historical-enrichment/c-framework-ssr.md).

### SQLite persistence / Electric multi-tab coordination

Grouping attributes: SQLite persisted peer coordination and its source-facing row/metadata, durable-storage, or Collection-status observations. The original reports describe Electric/browser or multi-tab lifetimes; #2317 adds controlled peer row notices and source-facing metadata reads, without a real-multi-tab claim. #2267 links #2209; #2281/#2283 link #2267; #2317 explicitly separates its controlled path from #2272 real-coordinator coverage. Shared cause is unestablished.

#### Current open items

| Item                                                 | Type  | Title                                                                                                               | Status | Labels | Body reactions |  +1 | Conversation comments | Reviews / inline comments | Updated              |
| ---------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------- | ------ | ------ | -------------: | --: | --------------------: | ------------------------- | -------------------- |
| [#2085](https://github.com/TanStack/db/issues/2085)  | issue | browser-db-sqlite-persistence: closing the leader tab fail-stops follower collections with IndeterminateCommitError | OPEN   | none   |              0 |   0 |                     0 | —                         | 2026-10-08T18:23:32Z |
| [#2139](https://github.com/TanStack/db/issues/2139)  | issue | Persistence: a follower shows its leader's rows after a cache-claim rotation                                        | OPEN   | none   |              1 |   0 |                     3 | —                         | 2026-10-28T03:22:05Z |
| [#2267](https://github.com/TanStack/db/issues/2267)  | issue | Electric resume check puts a lagging tab in error when a peer deleted the row it updates                            | OPEN   | none   |              0 |   0 |                     0 | —                         | 2026-10-27T15:27:35Z |
| [#2272](https://github.com/TanStack/db/issues/2272)  | issue | Oracle: two persisted Collections over one SQLite database with real coordinators                                   | OPEN   | none   |              0 |   0 |                     0 | —                         | 2026-10-27T19:28:03Z |
| [#2281](https://github.com/TanStack/db/issues/2281)  | issue | Multi-tab Electric: a deleted row returns after a peer reset and deploys                                            | OPEN   | none   |              0 |   0 |                     2 | —                         | 2026-10-29T13:59:00Z |
| [#2283](https://github.com/TanStack/db/issues/2283)  | issue | Multi-tab Electric: a committed row disappears after tabs stop                                                      | OPEN   | none   |              0 |   0 |                     0 | —                         | 2026-10-28T17:22:39Z |
| [#2317](https://github.com/TanStack/db/issues/2317)  | issue | SQLite persistence: peer row notice drops metadata for another row                                                  | OPEN   | none   |              0 |   0 |                     0 | —                         | 2026-10-30T21:25:18Z |
| [PR #2303](https://github.com/TanStack/db/pull/2303) | pr    | fix(persistence): preserve metadata on implicit equal re-inserts                                                    | OPEN   | none   |              0 |   0 |                     5 | 0 / 0                     | 2026-10-29T20:53:48Z |
| [#2341](https://github.com/TanStack/db/issues/2341)  | issue | Oracle: observe durable writes during sync-metadata read holds and abandonment                                      | OPEN   | none   |              0 |   0 |                     0 | —                         | 2026-11-02T23:29:43Z |

#### Representative snippets

- [#2085](https://github.com/TanStack/db/issues/2085#issue-body): “A normal leader-tab close should not fail-stop the other tab's collections.”
- [#2283](https://github.com/TanStack/db/issues/2283#issue-body): “A tab stop does not remove committed rows.”
- [#2317](https://github.com/TanStack/db/issues/2317#issue-body): “The root cause has not been diagnosed.” The report limits the observation to source-facing metadata through controlled peer notices.

#### Historical related items

| Item                                                 | Title                                                                                                               | State  | Reactions / +1 | Comments | Closed / Merged (UTC)                                      | Why related                                                                                                                                                                                                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------ | -------------: | -------: | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [PR #1845](https://github.com/TanStack/db/pull/1845) | fix(sqlite): enforce crash-only persistence coordination                                                            | MERGED |          0 / 0 |        8 | Closed: 2026-09-24T10:04:12Z; merged: 2026-09-24T10:04:12Z | Open #2085 explicitly links this merged coordination PR, whose body describes leader-route checks, IndeterminateCommitError and crash-only durability behavior across Browser and Electron persistence.                                         |
| [PR #2128](https://github.com/TanStack/db/pull/2128) | fix(persistence): settle a follower's load after it applies the leader's rows                                       | MERGED |          0 / 0 |        6 | Closed: 2026-10-14T00:22:22Z; merged: 2026-10-14T00:22:22Z | Open #2139 explicitly links this merged follower-settlement PR; the body discusses applied leader rows, expired cache claims, reset demand and follower reload loops.                                                                           |
| [#2226](https://github.com/TanStack/db/issues/2226)  | Persistence: a hydration that starts inside a commit-reserving source transaction rejects that transaction's commit | CLOSED |          0 / 0 |        0 | Closed: 2026-10-28T15:26:39Z; merged: —                    | Open #2139 and #2209 explicitly link this closed report, whose body describes peer reload hydration crossing a reserved Electric transaction during multi-tab must-refetch.                                                                     |
| [PR #2168](https://github.com/TanStack/db/pull/2168) | feat(db): split Collection status from sync errors; add reload() and cleanup admission                              | MERGED |          0 / 0 |        5 | Closed: 2026-10-28T02:19:30Z; merged: 2026-10-28T02:19:30Z | Open #2139 explicitly links this merged Collection status and reload PR, and its extracted evidence records a later follower-rotation retest after that merge.                                                                                  |
| [PR #2208](https://github.com/TanStack/db/pull/2208) | fix(db): keep settled optimistic rows while their server row waits behind a persisted write                         | MERGED |          0 / 0 |        6 | Closed: 2026-10-21T17:41:30Z; merged: 2026-10-21T17:41:29Z | Open #2209 explicitly links this merged persisted-write handoff PR, whose body describes acknowledged Electric rows waiting behind earlier durable writes.                                                                                      |
| [PR #2265](https://github.com/TanStack/db/pull/2265) | fix(sqlite-persistence): make every persisted hydration wait for a reserved commit                                  | MERGED |          0 / 0 |        7 | Closed: 2026-10-28T15:26:38Z; merged: 2026-10-28T15:26:37Z | Open #2267, #2281 and #2283 explicitly link this merged reservation PR; its body discusses peer notices, multi-tab Electric must-refetch and hydration waiting for reserved commits.                                                            |
| [PR #2262](https://github.com/TanStack/db/pull/2262) | fix(db): let a sync source read its own held writes in commit order                                                 | MERGED |          0 / 0 |        5 | Closed: 2026-10-28T16:43:45Z; merged: 2026-10-28T16:43:45Z | Open #2272 and #2281 explicitly link this merged sync-read PR. Its body describes persisted peer notices and the one-tab session drivers that provide context for #2272's real-coordinator request.                                             |
| [PR #2263](https://github.com/TanStack/db/pull/2263) | feat(persistence): settle covered on-demand demands from SQLite under network-first                                 | MERGED |          0 / 0 |        5 | Closed: 2026-10-28T17:16:57Z; merged: 2026-10-28T17:16:57Z | Open #2283 explicitly links this merged network-first persisted-demand PR; its body names Electric progressive sources, SQLite coverage and cache-generation invalidation.                                                                      |
| [#1486](https://github.com/TanStack/db/issues/1486)  | BrowserCollectionCoordinator: secondary tabs fail to acquire leadership in multi-tab sessions                       | CLOSED |          2 / 2 |        2 | Closed: 2026-09-28T22:55:45Z; merged: —                    | This closed report names BrowserCollectionCoordinator, Electric, two same-origin tabs and OPFS leadership/hydration behavior, matching #2085's leader/follower runtime and #2272's coordinator boundary.                                        |
| [#1659](https://github.com/TanStack/db/issues/1659)  | RFC: Hardening the SQLite persistence / Electric sync stack                                                         | CLOSED |          8 / 6 |        5 | Closed: 2026-09-30T21:50:56Z; merged: —                    | This closed stack-hardening RFC inventories Electric/SQLite per-collection coordinator routing, cross-tab ownership, readiness and prior multi-tab reports, matching the named persistence/runtime boundaries of #2085, #2139, #2209 and #2272. |

Retained 10 items. Search or selection capped: yes. [Searches, historical snippets, and caveats](misfits-survey/historical-enrichment/c-sqlite-electric-peers.md).

### SQLite persistence / offline coverage and readiness

Grouping attributes: #2211 and #2284 explicitly link #2102; all concern previously persisted data or demand coverage used during offline startup, with requested decisions about safe reuse, expiry, or completed empty snapshots.

#### Current open items

| Item                                                | Type  | Title                                                                                  | Status | Labels | Body reactions |  +1 | Conversation comments | Reviews / inline comments | Updated              |
| --------------------------------------------------- | ----- | -------------------------------------------------------------------------------------- | ------ | ------ | -------------: | --: | --------------------: | ------------------------- | -------------------- |
| [#2102](https://github.com/TanStack/db/issues/2102) | issue | Design safe offline subset reuse and remaining managed-cache recovery contracts        | OPEN   | none   |              1 |   1 |                     0 | —                         | 2026-10-11T14:46:23Z |
| [#2211](https://github.com/TanStack/db/issues/2211) | issue | Optional expiry for persisted demand coverage                                          | OPEN   | none   |              0 |   0 |                     0 | —                         | 2026-10-21T16:07:19Z |
| [#2284](https://github.com/TanStack/db/issues/2284) | issue | network-first: an eager Collection that last synced to zero rows stays loading offline | OPEN   | none   |              0 |   0 |                     0 | —                         | 2026-10-28T17:22:41Z |

#### Representative snippets

- [#2102](https://github.com/TanStack/db/issues/2102#issue-body): “it does not make a partial Electric cache an authoritative offline snapshot.”
- [#2284](https://github.com/TanStack/db/issues/2284#issue-body): “An offline app therefore cannot show "no rows" for a Collection that is truly empty.”

#### Historical related items

| Item                                                 | Title                                                                                                                        | State  | Reactions / +1 | Comments | Closed / Merged (UTC)                                      | Why related                                                                                                                                           |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------ | -------------: | -------: | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#82](https://github.com/TanStack/db/issues/82)      | Offline-First Support                                                                                                        | CLOSED |       117 / 69 |       24 | Closed: 2026-09-29T17:56:49Z; merged: —                    | The issue requests local persistence for collections and working completely offline, the persisted-data workflow named by #2102, #2211, and #2284.    |
| [PR #1380](https://github.com/TanStack/db/pull/1380) | feat: add persisted sync metadata support                                                                                    | MERGED |          0 / 0 |        3 | Closed: 2026-03-20T14:45:12Z; merged: 2026-03-20T14:45:12Z | #2211 links this PR; its body introduces persisted query ownership/retention and finite or indefinite persistedGcTime for offline-first flows.        |
| [PR #1400](https://github.com/TanStack/db/pull/1400) | fix: align persisted query retention fallback with effective gcTime                                                          | MERGED |          0 / 0 |        3 | Closed: 2026-03-24T18:36:08Z; merged: 2026-03-24T18:36:08Z | #2211 links this PR; its body describes the persisted-retention fallback when persistedGcTime is omitted.                                             |
| [PR #1955](https://github.com/TanStack/db/pull/1955) | feat(db): add network-first initial rendering for persisted collections                                                      | MERGED |          0 / 0 |        4 | Closed: 2026-09-30T16:47:30Z; merged: 2026-09-30T16:47:30Z | #2211 links this PR; its body introduces network-first initial rendering and separate persisted readiness for eager SQLite restores.                  |
| [#2056](https://github.com/TanStack/db/issues/2056)  | electric-db-collection: on-demand + persistence fails after relaunch with "Snapshot requests are not supported in full mode" | CLOSED |          1 / 1 |        1 | Closed: 2026-10-11T15:08:35Z; merged: —                    | #2102 links this report of an on-demand Electric collection failing after restart with persisted resume state.                                        |
| [PR #2069](https://github.com/TanStack/db/pull/2069) | fix(persistence): rotate invalid on-demand caches and reload subsets                                                         | MERGED |          1 / 1 |        6 | Closed: 2026-10-11T15:08:33Z; merged: 2026-10-11T15:08:33Z | #2102 links this PR; its body describes cache rotation, active-subset reacquisition, and limits on partial Electric caches as offline baselines.      |
| [#2202](https://github.com/TanStack/db/issues/2202)  | Support persisted initialRender for Electric progressive collections                                                         | CLOSED |          0 / 0 |        0 | Closed: 2026-10-28T17:16:59Z; merged: —                    | #2284 links this request to render persisted progressive Electric rows after refresh while synchronization continues.                                 |
| [PR #2203](https://github.com/TanStack/db/pull/2203) | feat(sqlite-persistence): render completed progressive snapshots on startup                                                  | CLOSED |          0 / 0 |        2 | Closed: 2026-10-28T17:17:08Z; merged: —                    | #2284 links this closed, unmerged proposal for completed progressive snapshots; its body distinguishes a completed empty snapshot from a cold cache.  |
| [PR #2263](https://github.com/TanStack/db/pull/2263) | feat(persistence): settle covered on-demand demands from SQLite under network-first                                          | MERGED |          0 / 0 |        5 | Closed: 2026-10-28T17:16:57Z; merged: 2026-10-28T17:16:57Z | #2284 links this PR; its body describes exact-demand offline settlement and explicitly leaves legitimately empty eager collections outside its scope. |
| [PR #2288](https://github.com/TanStack/db/pull/2288) | docs(persistence): document networkTimeoutMs: 0 for cache-first rendering                                                    | MERGED |          0 / 0 |        4 | Closed: 2026-10-28T22:19:09Z; merged: 2026-10-28T22:19:09Z | Its SQLite-guide body says that an empty restore still waits for the network, the same empty offline initial-render condition described by #2284.     |

Retained 10 items. Search or selection capped: yes. [Searches, historical snippets, and caveats](misfits-survey/historical-enrichment/c-persisted-offline-coverage.md).

### Ordered windows / relation filters and join acquisition

Grouping attributes: All describe bounded ordered windows on on-demand sources with relation or join filters and root/join acquisition work. #2124 explicitly links #2242; #2241 and #2242 both name LEFT-joined filter windows on @tanstack/db 0.15.2.

#### Current open items

| Item                                                | Type  | Title                                                                                                    | Status | Labels | Body reactions |  +1 | Conversation comments | Reviews / inline comments | Updated              |
| --------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------- | ------ | ------ | -------------: | --: | --------------------: | ------------------------- | -------------------- |
| [#2123](https://github.com/TanStack/db/issues/2123) | issue | Page ordered windows for every filter that only removes root rows                                        | OPEN   | none   |              0 |   0 |                     1 | —                         | 2026-10-13T14:08:45Z |
| [#2124](https://github.com/TanStack/db/issues/2124) | issue | Forward relation filters to loadSubset as an optional relations hint                                     | OPEN   | none   |              0 |   0 |                     1 | —                         | 2026-10-24T23:26:25Z |
| [#2130](https://github.com/TanStack/db/issues/2130) | issue | Page nulls-first full joins by looking up root rows by join key                                          | OPEN   | none   |              0 |   0 |                     0 | —                         | 2026-10-13T14:43:28Z |
| [#2241](https://github.com/TanStack/db/issues/2241) | issue | Joined-filter window hangs in `drainNoInputContinuations` when a boundary-tie load answers synchronously | OPEN   | none   |              0 |   0 |                     0 | —                         | 2026-10-23T23:13:52Z |
| [#2242](https://github.com/TanStack/db/issues/2242) | issue | Ordered window filtered through a LEFT-joined subquery requests its full source                          | OPEN   | none   |              0 |   0 |                     0 | —                         | 2026-10-23T23:13:53Z |

#### Representative snippets

- [#2123](https://github.com/TanStack/db/issues/2123#issue-body): “On an on-demand source, this is one unbounded request to show one page.”
- [#2242](https://github.com/TanStack/db/issues/2242#issue-body): “The same filter through a LEFT join to a subquery that only filters one collection still sets `requiresFullSource`.”

#### Historical related items

| Item                                                 | Title                                                                                                                     | State  | Reactions / +1 | Comments | Closed / Merged (UTC)                                      | Why related                                                                                                                                                                                                                       |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------ | -------------: | -------: | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#1898](https://github.com/TanStack/db/issues/1898)  | Relation filters (semi/anti-joins) force a full-source load on orderBy+limit queries — forward them to loadSubset instead | CLOSED |          0 / 0 |        2 | Closed: 2026-09-28T19:05:38Z; merged: —                    | #2124 links this earlier request to forward relation filters to loadSubset; the captured body describes some/none hints and bounded joined-filter windows.                                                                        |
| [PR #1909](https://github.com/TanStack/db/pull/1909) | fix(db): page ordered direct left-join filters                                                                            | MERGED |          0 / 0 |        4 | Closed: 2026-09-28T19:05:37Z; merged: 2026-09-28T19:05:37Z | #2123, #2124, and #2242 link this PR. Its body describes finite paging for one direct LEFT join and identifies relation hints and other filter plans as separate scope.                                                           |
| [PR #2122](https://github.com/TanStack/db/pull/2122) | fix(db): count only window rows the loaded prefix proves                                                                  | MERGED |          0 / 0 |        6 | Closed: 2026-10-13T14:34:39Z; merged: 2026-10-13T14:34:39Z | #2123 links this PR; its body describes proven-prefix window rows, full-source loading for other join types, and explicitly names #2123 and #2124 follow-ups.                                                                     |
| [PR #2132](https://github.com/TanStack/db/pull/2132) | fix(db): reach on-demand, full-join and multiplicity cases in the ordered-work oracle                                     | MERGED |          0 / 0 |        6 | Closed: 2026-10-14T18:08:44Z; merged: 2026-10-14T18:08:44Z | The PR body explicitly names #2123 for paging after the unindexed full-source fallback and #2130 for full-join paging; these are this cluster’s open members.                                                                     |
| [PR #2194](https://github.com/TanStack/db/pull/2194) | fix(db): keep overlapping ordered requests loading and release what they supersede                                        | MERGED |          0 / 0 |        5 | Closed: 2026-10-22T04:38:27Z; merged: 2026-10-22T04:38:27Z | Its body reports an ordered window held on old rows when an on-demand joined load finishes without a row, overlapping #2241’s ordered-window/joined-demand settlement workflow; the reported traces are not treated as identical. |

Retained 5 items. Search or selection capped: yes. [Searches, historical snippets, and caveats](misfits-survey/historical-enrichment/c-ordered-join-acquisition.md).

### Ordered refetch / provider variants and peer windows

Grouping attributes: All name ordered on-demand window acquisition/refetch concerns and explicitly link #2136 or #2154; the member paths cover Electric unknown rows, peer queries, follower tabs, offset-only providers, page caps, joined refetch, and coverage inventory.

#### Current open items

| Item                                                | Type  | Title                                                                                                    | Status | Labels | Body reactions |  +1 | Conversation comments | Reviews / inline comments | Updated              |
| --------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------- | ------ | ------ | -------------: | --: | --------------------: | ------------------------- | -------------------- |
| [#2138](https://github.com/TanStack/db/issues/2138) | issue | Electric on-demand skips updates to unknown rows that enter a served ordered range                       | OPEN   | none   |              0 |   0 |                     1 | —                         | 2026-10-15T14:01:42Z |
| [#2155](https://github.com/TanStack/db/issues/2155) | issue | A second live query over a refetched on-demand source keeps a short joined window                        | OPEN   | none   |              0 |   0 |                     2 | —                         | 2026-10-15T21:24:33Z |
| [#2174](https://github.com/TanStack/db/issues/2174) | issue | Follower tabs never hear a loaded-subset report, so their ordered windows keep the on-demand refetch gap | OPEN   | none   |              0 |   0 |                     0 | —                         | 2026-10-15T17:28:09Z |
| [#2182](https://github.com/TanStack/db/issues/2182) | issue | Ordered loader: an offset-only provider leaves a joined on-demand window empty at preload                | OPEN   | none   |              0 |   0 |                     0 | —                         | 2026-10-15T21:23:27Z |
| [#2183](https://github.com/TanStack/db/issues/2183) | issue | Ordered loader: a page-capping provider loses a moved row from a joined window after refetch             | OPEN   | none   |              0 |   0 |                     0 | —                         | 2026-10-15T21:23:28Z |
| [#2185](https://github.com/TanStack/db/issues/2185) | issue | query-db: a Query refetch that joins a loader's refetch acquisition does not report shifted pages        | OPEN   | none   |              0 |   0 |                     1 | —                         | 2026-10-15T22:07:06Z |
| [#2186](https://github.com/TanStack/db/issues/2186) | issue | Close the remaining #2136-class gaps in the ordered refetch oracles                                      | OPEN   | none   |              0 |   0 |                     2 | —                         | 2026-10-16T14:30:00Z |

#### Representative snippets

- [#2138](https://github.com/TanStack/db/issues/2138#issue-body): “A row that the Collection did not load can move into a served ordered range, and the Collection never receives it.”
- [#2186](https://github.com/TanStack/db/issues/2186#body): “This issue records the histories, paths and observations that are still outside the oracles, so a later agent can close more of the class.”

#### Historical related items

| Item                                                 | Title                                                                                 | State  | Reactions / +1 | Comments | Closed / Merged (UTC)                                      | Why related                                                                                                                                                                                                                            |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------- | ------ | -------------: | -------: | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [PR #2132](https://github.com/TanStack/db/pull/2132) | fix(db): reach on-demand, full-join and multiplicity cases in the ordered-work oracle | MERGED |          0 / 0 |        6 | Closed: 2026-10-14T18:08:44Z; merged: 2026-10-14T18:08:44Z | #2155 links this PR; its body describes the ordered-work provider histories, explicitly records #2155 peer/refetch limits, and links the #2136 page-gap report.                                                                        |
| [#2136](https://github.com/TanStack/db/issues/2136)  | query-db on-demand refetch leaves a gap between served ordered pages                  | CLOSED |          0 / 0 |        1 | Closed: 2026-10-16T14:29:04Z; merged: —                    | These open members link #2136; its body reports a row moving between independently refetched served pages and an ordered window retaining the old result.                                                                              |
| [PR #2154](https://github.com/TanStack/db/pull/2154) | fix(query-db-collection): keep served ordered prefixes whole on refetch               | MERGED |          0 / 0 |        6 | Closed: 2026-10-16T14:29:02Z; merged: 2026-10-16T14:29:02Z | All seven open members link #2154. Its body describes the loaded-subset signal and repair, and records provider, peer, follower, and acquisition/refetch limits named by these members.                                                |
| [PR #2177](https://github.com/TanStack/db/pull/2177) | fix(db): publish optimistic ordered-window departures immediately                     | MERGED |          0 / 0 |        6 | Closed: 2026-10-16T14:56:13Z; merged: 2026-10-16T14:56:13Z | #2186 links this PR; its body describes optimistic departures and one Query DB shifted-page report while an optimistic update persists.                                                                                                |
| [PR #2194](https://github.com/TanStack/db/pull/2194) | fix(db): keep overlapping ordered requests loading and release what they supersede    | MERGED |          0 / 0 |        5 | Closed: 2026-10-22T04:38:27Z; merged: 2026-10-22T04:38:27Z | Its body describes request overlap with bounded repair, names #2154’s signalling-refetch law, and reports limits for the query-db refetch oracle, the coverage boundary inventoried by #2186.                                          |
| [PR #2128](https://github.com/TanStack/db/pull/2128) | fix(persistence): settle a follower's load after it applies the leader's rows         | MERGED |          0 / 0 |        6 | Closed: 2026-10-14T00:22:22Z; merged: 2026-10-14T00:22:22Z | Its body describes follower load settlement after applying leader rows and BroadcastChannel tx:committed delivery, the same owner/follower persistence boundary named by #2174; it does not claim to relay loaded-subset invalidation. |

Retained 6 items. Search or selection capped: yes. [Searches, historical snippets, and caveats](misfits-survey/historical-enrichment/c-ordered-refetch-variants.md).

### On-demand optimistic mutations / visibility and preload

Grouping attributes: All observe on-demand live queries while optimistic mutation promises remain pending; #2169 explicitly links both #2148 and #2184.

#### Current open items

| Item                                                | Type  | Title                                                                                             | Status | Labels | Body reactions |  +1 | Conversation comments | Reviews / inline comments | Updated              |
| --------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------- | ------ | ------ | -------------: | --: | --------------------: | ------------------------- | -------------------- |
| [#2148](https://github.com/TanStack/db/issues/2148) | issue | On-demand joined window stays short after an optimistic delete of its visible row                 | OPEN   | none   |              0 |   0 |                     1 | —                         | 2026-10-15T21:24:34Z |
| [#2184](https://github.com/TanStack/db/issues/2184) | issue | A live query's preload on an on-demand collection waits for any persisting optimistic transaction | OPEN   | none   |              0 |   0 |                     0 | —                         | 2026-10-15T21:23:30Z |

#### Representative snippets

- [#2148](https://github.com/TanStack/db/issues/2148#issue-body): “It can show a short window after an optimistic delete. The window stays short until the delete persists.”
- [#2184](https://github.com/TanStack/db/issues/2184#body): “This happens even when the transaction touches rows the new query does not read.”

#### Historical related items

| Item                                                 | Title                                                                                                          | State  | Reactions / +1 | Comments | Closed / Merged (UTC)                                      | Why related                                                                                                                                                           |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------ | -------------: | -------: | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [PR #2177](https://github.com/TanStack/db/pull/2177) | fix(db): publish optimistic ordered-window departures immediately                                              | MERGED |          0 / 0 |        6 | Closed: 2026-10-16T14:56:13Z; merged: 2026-10-16T14:56:13Z | The merged PR body explicitly references #2148 and #2169 and describes immediate optimistic departures with a possibly short on-demand window.                        |
| [PR #2154](https://github.com/TanStack/db/pull/2154) | fix(query-db-collection): keep served ordered prefixes whole on refetch                                        | MERGED |          0 / 0 |        6 | Closed: 2026-10-16T14:29:02Z; merged: 2026-10-16T14:29:02Z | All three open members link #2154; its body discusses refetch repair during pending optimistic transactions and names #2169.                                          |
| [PR #2132](https://github.com/TanStack/db/pull/2132) | fix(db): reach on-demand, full-join and multiplicity cases in the ordered-work oracle                          | MERGED |          0 / 0 |        6 | Closed: 2026-10-14T18:08:44Z; merged: 2026-10-14T18:08:44Z | #2148 links this merged ordered-work PR; its body records the held optimistic-delete joined-window case under #2148 as a limit.                                       |
| [#2131](https://github.com/TanStack/db/issues/2131)  | On-demand ordered windows publish an intermediate window during repair or refill                               | CLOSED |          0 / 0 |        2 | Closed: 2026-10-14T18:08:45Z; merged: —                    | #2169 explicitly links this closed report about intermediate ordered-window publication during repair or refill.                                                      |
| [#1017](https://github.com/TanStack/db/issues/1017)  | Synced data does not appear in a derived (live query) collection while there is a pending optimistic mutation. | CLOSED |          1 / 1 |        6 | Closed: 2026-09-11T14:29:20Z; merged: —                    | #2169 explicitly links this earlier closed report about synced rows being invisible in a derived live-query Collection during a pending optimistic mutation.          |
| [#2136](https://github.com/TanStack/db/issues/2136)  | query-db on-demand refetch leaves a gap between served ordered pages                                           | CLOSED |          0 / 0 |        1 | Closed: 2026-10-16T14:29:04Z; merged: —                    | #2169 explicitly links this closed Query DB report about a row missed between served ordered pages after refetch.                                                     |
| [PR #1769](https://github.com/TanStack/db/pull/1769) | fix(db): settle subset loads after publication                                                                 | MERGED |          0 / 0 |        4 | Closed: 2026-08-25T18:08:06Z; merged: 2026-08-25T18:08:06Z | The merged PR describes subset loads waiting for rows and events to publish behind optimistic work, overlapping #2184's preload and whenSyncAccepted readiness terms. |

Retained 7 items. Search or selection capped: yes. [Searches, historical snippets, and caveats](misfits-survey/historical-enrichment/c-optimistic-demand-visibility.md).

### Ordered loader / failed requests and recovery

[Post-census #2315 comment](https://github.com/TanStack/db/issues/2315#issuecomment-6579843541) adds a [rejection-only error-identity witness](misfits-survey/refresh-2026-11-02/updates/issue-2315-comment-6579843541.md) reportedly reproduced on PR #2314 and main, without a synchronous throw; production/model attribution remains unresolved.

Grouping attributes: Ordered-window request failures, their continuing authority, and subsequent recovery. #2165/#2191 name loadMore and #2154; #2315 adds a pending window move whose rejection identity follows failed include replay and a later synchronous include-load throw. Grouping does not establish a common cause.

#### Current open items

| Item                                                 | Type  | Title                                                                                                                                            | Status | Labels | Body reactions |  +1 | Conversation comments | Reviews / inline comments | Updated              |
| ---------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ------ | -------------: | --: | --------------------: | ------------------------- | -------------------- |
| [#2165](https://github.com/TanStack/db/issues/2165)  | issue | Ordered loader: recover failed ordered requests with a bounded repair instead of a full-source read                                              | OPEN   | none   |              0 |   0 |                     0 | —                         | 2026-10-15T14:01:10Z |
| [#2191](https://github.com/TanStack/db/issues/2191)  | issue | Ordered loader: a superseded request's failure can block refills after its repair finishes (model-predicted), and the state refactor it suggests | OPEN   | none   |              0 |   0 |                     0 | —                         | 2026-10-16T14:29:46Z |
| [#2315](https://github.com/TanStack/db/issues/2315)  | issue | Ordered replay oracle: pending window move rejects with later include-load error                                                                 | OPEN   | bug    |              0 |   0 |                     0 | —                         | 2026-10-30T19:21:29Z |
| [PR #2318](https://github.com/TanStack/db/pull/2318) | pr    | fix(db): retain failed demand during loading sibling replay                                                                                      | OPEN   | none   |              0 |   0 |                     5 | 1 / 0                     | 2026-10-30T23:39:56Z |

#### Representative snippets

- [#2165](https://github.com/TanStack/db/issues/2165#issue-body): “Rule (maintainer decision): avoid full-source reads whenever a bounded read is available.”
- [#2191](https://github.com/TanStack/db/issues/2191#body): “**This is a model prediction. No code witness exists yet.**”
- [#2315](https://github.com/TanStack/db/issues/2315#issue-body): “The production/model cause has not been isolated.”

#### Historical related items

| Item                                                 | Title                                                                              | State  | Reactions / +1 | Comments | Closed / Merged (UTC)                                      | Why related                                                                                                                                                                 |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------- | ------ | -------------: | -------: | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [PR #2194](https://github.com/TanStack/db/pull/2194) | fix(db): keep overlapping ordered requests loading and release what they supersede | MERGED |          0 / 0 |        5 | Closed: 2026-10-22T04:38:27Z; merged: 2026-10-22T04:38:27Z | The merged PR body explicitly names #2191 as the model-predicted starting trace and describes overlapping requests, failed settlements, retries, and acquisition release.   |
| [PR #2154](https://github.com/TanStack/db/pull/2154) | fix(query-db-collection): keep served ordered prefixes whole on refetch            | MERGED |          0 / 0 |        6 | Closed: 2026-10-16T14:29:02Z; merged: 2026-10-16T14:29:02Z | Both open members link #2154; its body states that failed or canceled request recovery still reads the full source and names #2165.                                         |
| [#2136](https://github.com/TanStack/db/issues/2136)  | query-db on-demand refetch leaves a gap between served ordered pages               | CLOSED |          0 / 0 |        1 | Closed: 2026-10-16T14:29:04Z; merged: —                    | #2165 explicitly links this closed ordered-page refetch report, which supplies historical context for #2154's served-prefix repair work.                                    |
| [PR #2177](https://github.com/TanStack/db/pull/2177) | fix(db): publish optimistic ordered-window departures immediately                  | MERGED |          0 / 0 |        6 | Closed: 2026-10-16T14:56:13Z; merged: 2026-10-16T14:56:13Z | #2191 explicitly links this merged optimistic-departure PR; its body describes bounded refill and the separate authoritative complete-window repair barrier.                |
| [PR #1797](https://github.com/TanStack/db/pull/1797) | fix: harden subset loading, recovery, and live-query value semantics               | MERGED |          0 / 0 |        8 | Closed: 2026-09-10T18:05:35Z; merged: 2026-09-10T18:05:35Z | This merged consolidation describes failed-load recovery through filtered full-source loading, cancellation, and acquisition release, matching the recovery terms in #2165. |

Retained 5 items. Search or selection capped: yes. [Searches, historical snippets, and caveats](misfits-survey/historical-enrichment/c-ordered-request-recovery.md).

### Query DB / acquisition ownership and cancellation

Grouping attributes: The original #2160/#2162/#2188 members explicitly link #2158 and name Query DB load-subset lifecycle coverage around acquisition ownership, caller cancellation or reentrant replacement. #2352 adds freshness on a second acquisition of a populated identical shared subset; #2353 explicitly links #2160/#2352 and reports row loss when an older ordered fallback acquisition releases the same subset still held by its replacement. These share acquisition/reuse/release boundaries, without an established common cause or shared repair.

#### Current open items

| Item                                                | Type  | Title                                                                                                                            | Status | Labels | Body reactions |  +1 | Conversation comments | Reviews / inline comments | Updated              |
| --------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------- | ------ | ------ | -------------: | --: | --------------------: | ------------------------- | -------------------- |
| [#2160](https://github.com/TanStack/db/issues/2160) | issue | Query DB loses or retains rows across reentrant final-owner cleanup                                                              | OPEN   | none   |              0 |   0 |                     0 | —                         | 2026-10-15T03:39:04Z |
| [#2162](https://github.com/TanStack/db/issues/2162) | issue | query-db: requestSnapshot caller abort leaves sole fetch live and publishes late rows                                            | OPEN   | none   |              0 |   0 |                     0 | —                         | 2026-10-15T05:03:15Z |
| [#2188](https://github.com/TanStack/db/issues/2188) | issue | Restore Query DB receiving histories omitted during PR integration                                                               | OPEN   | none   |              0 |   0 |                     0 | —                         | 2026-10-15T21:31:18Z |
| [#2352](https://github.com/TanStack/db/issues/2352) | issue | query-db-collection (on-demand): a second live query on an identical stale subset reuses the observer and never refetches        | OPEN   | none   |              0 |   0 |                     0 | —                         | 2026-11-04T00:53:14Z |
| [#2353](https://github.com/TanStack/db/issues/2353) | issue | Source collection emptied when an ordered window that fell back to a full-source read is replaced by one reading the same subset | OPEN   | none   |              0 |   0 |                     0 | —                         | 2026-11-04T09:23:27Z |

#### Representative snippets

- [#2352](https://github.com/TanStack/db/issues/2352#issue-body): “With `syncMode: "on-demand"` and `staleTime: 0`, a second live query with the same predicate as an already-loaded subset never refetches.”
- [#2353](https://github.com/TanStack/db/issues/2353#issue-body): “If both windows fell back to a full-source read of the same filter, releasing the old window removes every row from the source collection.”
- [#2160](https://github.com/TanStack/db/issues/2160#issue-body): “A fulfilled subset load must have its applied row visible.”
- [#2188](https://github.com/TanStack/db/issues/2188#body): “Those fixture failures are not evidence of product bugs; the remaining public-law failures have not been classified.”

#### Historical related items

| Item                                                 | Title                                                                 | State  | Reactions / +1 | Comments | Closed / Merged (UTC)                                      | Why related                                                                                                                                                                                                                        |
| ---------------------------------------------------- | --------------------------------------------------------------------- | ------ | -------------: | -------: | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [PR #2158](https://github.com/TanStack/db/pull/2158) | fix(query-db): keep shared Query fetches alive for Collection owners  | CLOSED |          0 / 0 |        6 | Closed: 2026-10-15T22:08:30Z; merged: —                    | All three open members link this closed, unmerged PR. Its body explicitly references #2160, #2162, and #2188 and describes caller cancellation, shared physical fetches, application settlement, and reentrant ownership.          |
| [PR #2134](https://github.com/TanStack/db/pull/2134) | fix(db): dedupe singleton join demand with equality                   | CLOSED |          0 / 0 |        6 | Closed: 2026-10-15T22:17:00Z; merged: —                    | #2188 explicitly links this closed, unmerged PR; its body builds on #2158 and links #2188 as omitted receiving histories.                                                                                                          |
| [PR #1925](https://github.com/TanStack/db/pull/1925) | fix: stop released subscription snapshots                             | MERGED |          0 / 0 |        4 | Closed: 2026-09-29T20:45:49Z; merged: 2026-09-29T20:45:49Z | The merged PR describes direct snapshot requests stopping after release, callback reentry, and abort-listener removal, matching #2160 and #2162's public snapshot/cancellation terms.                                              |
| [PR #1881](https://github.com/TanStack/db/pull/1881) | fix(query-db-collection): settle invalid and deferred refetch results | MERGED |          0 / 0 |        4 | Closed: 2026-09-25T20:55:16Z; merged: 2026-09-25T20:55:16Z | The merged Query DB PR describes caller outcomes and applied rows during invalid, deferred, canceled, and retired result paths; these are the application and lifecycle observations named by #2160 and #2188.                     |
| [PR #1769](https://github.com/TanStack/db/pull/1769) | fix(db): settle subset loads after publication                        | MERGED |          0 / 0 |        4 | Closed: 2026-08-25T18:08:06Z; merged: 2026-08-25T18:08:06Z | The merged PR describes Query DB applied receipts and request-scoped commits that can be abandoned with AbortSignal, overlapping #2160 and #2162's load-result visibility and caller-abort boundary.                               |
| [PR #1797](https://github.com/TanStack/db/pull/1797) | fix: harden subset loading, recovery, and live-query value semantics  | MERGED |          0 / 0 |        8 | Closed: 2026-09-10T18:05:35Z; merged: 2026-09-10T18:05:35Z | The merged consolidation distinguishes logical demand and physical ownership, discusses obsolete callbacks and cancellation, and describes Query DB observer ownership, matching the named lifecycle concerns in the open members. |

Retained 6 items. Search or selection capped: yes. [Searches, historical snippets, and caveats](misfits-survey/historical-enrichment/c-query-acquisition-lifecycle.md).

### Query DB / persisted legacy-owner migration

Grouping attributes: Both name getLegacyOwnerHashes, Query DB persisted storage, and #2134; one concerns function query keys and the other repeated parsing during persisted demand loading.

#### Current open items

| Item                                                | Type  | Title                                                                     | Status | Labels | Body reactions |  +1 | Conversation comments | Reviews / inline comments | Updated              |
| --------------------------------------------------- | ----- | ------------------------------------------------------------------------- | ------ | ------ | -------------: | --: | --------------------: | ------------------------- | -------------------- |
| [#2180](https://github.com/TanStack/db/issues/2180) | issue | Query DB: define legacy singleton-owner migration for function query keys | OPEN   | none   |              0 |   0 |                     0 | —                         | 2026-10-15T21:04:45Z |
| [#2181](https://github.com/TanStack/db/issues/2181) | issue | Query DB: measure repeated legacy-owner key parsing                       | OPEN   | none   |              0 |   0 |                     0 | —                         | 2026-10-15T21:04:54Z |

#### Representative snippets

- [#2180](https://github.com/TanStack/db/issues/2180#body): “There is no executed failing public migration witness yet, and arbitrary key functions may not be reversible.”
- [#2181](https://github.com/TanStack/db/issues/2181#body): “This is a source-level performance concern; no user latency regression has been measured.”

#### Historical related items

| Item                                                 | Title                                               | State  | Reactions / +1 | Comments | Closed / Merged (UTC)                   | Why related                                                                                                                                                                                                               |
| ---------------------------------------------------- | --------------------------------------------------- | ------ | -------------: | -------: | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [PR #2134](https://github.com/TanStack/db/pull/2134) | fix(db): dedupe singleton join demand with equality | CLOSED |          0 / 0 |        6 | Closed: 2026-10-15T22:17:00Z; merged: — | Both open #2180 and #2181 explicitly cite #2134. Its body describes historical singleton-membership owner handling and separately links #2180 for function-based key migration and #2181 for historical-key parsing cost. |

Retained 1 items. Search or selection capped: yes. [Searches, historical snippets, and caveats](misfits-survey/historical-enrichment/c-query-owner-migration.md).

### Ordered loading / refetch, repair, and request lifecycle

Grouping attributes: #2214, #2222, #2223, and #2260 explicitly reference #2194. #2335 shares #2214's Query DB ordered-prefix oracle and missing source-row observation, with a distinct cursor/two-term history; no common cause is established. #2268 overlaps #2260 in ordered-window full-source request work and #2214 in ordered-window refetch; the grouping retains these different member paths. #2296 explicitly links #2223 for request retirement and names the ordered-source-loader-state oracle; its successful-settlement trace remains a distinct report.

#### Current open items

| Item                                                 | Type  | Title                                                                                                                        | Status | Labels | Body reactions |  +1 | Conversation comments | Reviews / inline comments | Updated              |
| ---------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------- | ------ | ------ | -------------: | --: | --------------------: | ------------------------- | -------------------- |
| [#2214](https://github.com/TanStack/db/issues/2214)  | issue | query-db refetch oracle: a window row is missing from the source Collection after a held delete is released                  | OPEN   | none   |              0 |   0 |                     0 | —                         | 2026-10-21T19:19:14Z |
| [#2222](https://github.com/TanStack/db/issues/2222)  | issue | Ordered loader can drop the debt of an invalidation that arrives while a finished repair releases its leases                 | OPEN   | none   |              0 |   0 |                     0 | —                         | 2026-10-22T04:36:56Z |
| [#2223](https://github.com/TanStack/db/issues/2223)  | issue | Ordered loader keeps no handle to release a failed request from before a cursor reset                                        | OPEN   | none   |              0 |   0 |                     0 | —                         | 2026-10-22T04:36:57Z |
| [#2260](https://github.com/TanStack/db/issues/2260)  | issue | Paginated live query fetches entire collection if shared rows unload while the first page is in flight                       | OPEN   | none   |              1 |   1 |                     0 | —                         | 2026-10-26T14:36:36Z |
| [#2268](https://github.com/TanStack/db/issues/2268)  | issue | Ordered window starts two full-source reads after a signalling refetch with no unexpressible page end                        | OPEN   | none   |              0 |   0 |                     1 | —                         | 2026-10-27T17:45:33Z |
| [#2296](https://github.com/TanStack/db/issues/2296)  | issue | Ordered loader retains earlier requests after a newer authoritative read succeeds                                            | OPEN   | none   |              0 |   0 |                     1 | —                         | 2026-11-03T22:31:45Z |
| [PR #2302](https://github.com/TanStack/db/pull/2302) | pr    | fix(db): preserve ordering invalidations during repair retirement                                                            | OPEN   | none   |              0 |   0 |                     5 | 1 / 1                     | 2026-10-29T21:03:45Z |
| [#2335](https://github.com/TanStack/db/issues/2335)  | issue | Query DB refetch oracle: row inside the window is missing from the source Collection after refetch (cursor, two order terms) | OPEN   | none   |              0 |   0 |                     0 | —                         | 2026-11-02T20:59:28Z |

#### Representative snippets

- [#2214](https://github.com/TanStack/db/issues/2214#issue-body): “After it, a row sorts inside the live window, but the source Collection does not have it.”
- [#2268](https://github.com/TanStack/db/issues/2268#issue-body): “After one signalling refetch, a joined ordered window with an unindexed source starts two full-source reads.”

- [#2296 comment 6617143865](https://github.com/TanStack/db/issues/2296#issuecomment-6617143865): “Whether both traces have the same root cause remains unresolved.” The second trace reportedly retains requests [2,3] after request 4 succeeds on both PR and recorded main. This is a baseline oracle comparison failure, with production retirement versus oracle premise/checkpoint unresolved and no measured public resource consequence.
- [#2296](https://github.com/TanStack/db/issues/2296#issue-body): “no leak: requests [3,4] are still held after authoritative request 5 succeeded”
- [#2296](https://github.com/TanStack/db/issues/2296#issue-body): “The oracle uses the real loader with a controlled subscription; this mismatch establishes a failing request-ledger comparison, not incorrect public query rows or a measured production resource leak.”

#### Historical related items

| Item                                                 | Title                                                                                              | State  | Reactions / +1 | Comments | Closed / Merged (UTC)                                      | Why related                                                                                                                                                                                                                                                  |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------ | -------------: | -------: | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [PR #2194](https://github.com/TanStack/db/pull/2194) | fix(db): keep overlapping ordered requests loading and release what they supersede                 | MERGED |          0 / 0 |        5 | Closed: 2026-10-22T04:38:27Z; merged: 2026-10-22T04:38:27Z | Open #2214, #2222, #2223, and #2260 explicitly cite #2194. Its body describes overlapping ordered requests, repair acquisition retirement, request failures, and truncate replay, and names #2214, #2222, and #2223 as separately tracked findings.          |
| [PR #2206](https://github.com/TanStack/db/pull/2206) | fix(query-db): keep a reacquired Query's rows across an older release                              | MERGED |          0 / 0 |        5 | Closed: 2026-10-21T15:59:04Z; merged: 2026-10-21T15:59:04Z | Open #2214 explicitly cites #2206. The PR body describes rows lost when an older Query release publishes after reacquisition, providing historical Query DB row-ownership/release context.                                                                   |
| [#1880](https://github.com/TanStack/db/issues/1880)  | On-demand `orderBy` + `limit`: a sort-key change reloads the entire source and releases the window | CLOSED |          0 / 0 |        0 | Closed: 2026-09-25T13:58:29Z; merged: —                    | Open #2260 explicitly cites #1880. The closed report describes an on-demand ordered window expanding to a full-source request after a visible row changes sort key or is deleted.                                                                            |
| [PR #1886](https://github.com/TanStack/db/pull/1886) | fix(db): repair invalidated ordered queries                                                        | MERGED |          0 / 0 |        4 | Closed: 2026-09-25T13:58:28Z; merged: 2026-09-25T13:58:28Z | Open #2260 explicitly cites #1886. The PR body describes bounded prefix repair, holding the old window during repair, and retirement of superseded finite acquisitions, and explicitly closes #1880.                                                         |
| [#2221](https://github.com/TanStack/db/issues/2221)  | Ordered window starts two full-source reads after a signalling refetch with a NaN boundary         | CLOSED |          0 / 0 |        2 | Closed: 2026-10-28T17:56:13Z; merged: —                    | Open #2268 explicitly cites #2221. The historical report also describes two full-source reads after a signalling refetch, with a NaN boundary; #2268 names a different reported boundary condition.                                                          |
| [PR #2154](https://github.com/TanStack/db/pull/2154) | fix(query-db-collection): keep served ordered prefixes whole on refetch                            | MERGED |          0 / 0 |        6 | Closed: 2026-10-16T14:29:02Z; merged: 2026-10-16T14:29:02Z | Its body names the query-db.refetch-ordered-prefix campaign and held optimistic updates/deletes across refetch, matching #2214. It also introduces the signalling-refetch provider and a bound on full-source requests, matching #2268.                      |
| [#2131](https://github.com/TanStack/db/issues/2131)  | On-demand ordered windows publish an intermediate window during repair or refill                   | CLOSED |          0 / 0 |        2 | Closed: 2026-10-14T18:08:45Z; merged: —                    | Its body names OrderedSourceLoader and on-demand repair/refill while work is in flight, the ordered repair path named in #2222 and the first-page/repair lifetime context of #2260. It concerns intermediate publication, a distinct historical observation. |
| [PR #2177](https://github.com/TanStack/db/pull/2177) | fix(db): publish optimistic ordered-window departures immediately                                  | MERGED |          0 / 0 |        6 | Closed: 2026-10-16T14:56:13Z; merged: 2026-10-16T14:56:13Z | Its body describes held optimistic mutation/refetch histories in a real Query DB oracle and an ordered window held through persistence settlement, matching the held-delete/refetch/release workflow reported by #2214.                                      |

Retained 8 items. Search or selection capped: yes. [Searches, historical snippets, and caveats](misfits-survey/historical-enrichment/c-ordered-loading-lifetimes.md).

The #2296 supplement postdates these historical searches; the retained context was selected for the original five cluster members.

### Oracle ownership / lint and contribution evidence

Grouping attributes: #2264 explicitly references #2234; both concern oracle testing, ESLint enforcement, and contribution coverage or evidence.

#### Current open items

| Item                                                | Type  | Title                                                                             | Status | Labels | Body reactions |  +1 | Conversation comments | Reviews / inline comments | Updated              |
| --------------------------------------------------- | ----- | --------------------------------------------------------------------------------- | ------ | ------ | -------------: | --: | --------------------: | ------------------------- | -------------------- |
| [#2234](https://github.com/TanStack/db/issues/2234) | issue | Enforce oracle-first work: oracle lint rules, CI checks, and agent feedback hooks | OPEN   | none   |              0 |   0 |                     0 | —                         | 2026-10-23T16:06:46Z |
| [#2264](https://github.com/TanStack/db/issues/2264) | issue | Convert the files demoted from oracle owners back into oracles                    | OPEN   | none   |              0 |   0 |                     0 | —                         | 2026-10-27T16:37:16Z |

#### Representative snippets

- [#2264](https://github.com/TanStack/db/issues/2264#issue-body): “Their tests still run unchanged, but the laws they owned now have only focused tests and no oracle coverage.”

#### Historical related items

| Item                                                 | Title                                                                                     | State  | Reactions / +1 | Comments | Closed / Merged (UTC)                                      | Why related                                                                                                                                                                                                                                  |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------ | -------------: | -------: | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [PR #2233](https://github.com/TanStack/db/pull/2233) | docs(oracles): score oracle-first work and add declared reach                             | MERGED |          0 / 0 |        5 | Closed: 2026-10-23T15:15:49Z; merged: 2026-10-23T15:15:49Z | Open #2234 explicitly cites #2233. The PR body adds oracle-first scoring, declared reach, and evidence-block guidance, and names #2234 as the planned lint/CI/hooks follow-up.                                                               |
| [PR #2168](https://github.com/TanStack/db/pull/2168) | feat(db): split Collection status from sync errors; add reload() and cleanup admission    | MERGED |          0 / 0 |        5 | Closed: 2026-10-28T02:19:30Z; merged: 2026-10-28T02:19:30Z | Open #2234 explicitly cites #2168 as contribution-process history. The merged PR body describes source-health oracle histories and hostile-mutant evidence; this row records that cited provenance, not an independent audit of its process. |
| [PR #2237](https://github.com/TanStack/db/pull/2237) | feat(oracles): select every oracle replay through shared helpers                          | MERGED |          0 / 0 |        5 | Closed: 2026-10-27T16:19:33Z; merged: 2026-10-27T16:19:33Z | Open #2264 explicitly cites #2237. Its body records migration to shared replay helpers, extended oracle lint checks, and lowered-run-budget reporting as a step of #2234.                                                                    |
| [PR #2259](https://github.com/TanStack/db/pull/2259) | fix: preserve persisted option contracts                                                  | MERGED |          0 / 0 |        3 | Closed: 2026-10-26T20:51:22Z; merged: 2026-10-26T20:51:22Z | Open #2264 explicitly cites #2259 and identifies its persisted-options type coverage as resolved. The PR body describes replacing fixed type examples with generated inputs and shared core/browser checks.                                  |
| [PR #1519](https://github.com/TanStack/db/pull/1519) | fix(db): support Temporal values in query comparison operators                            | MERGED |          1 / 1 |        3 | Closed: 2026-08-18T20:14:28Z; merged: 2026-08-18T20:14:28Z | Open #2264 explicitly cites #1519 in its tracked historical coverage context. The PR body concerns Temporal comparison operators and tests; this is a provenance link, not evidence about present oracle adequacy.                           |
| [PR #1831](https://github.com/TanStack/db/pull/1831) | fix(powersync): preserve updates and support PowerSync 2                                  | MERGED |          0 / 0 |        7 | Closed: 2026-09-17T12:44:07Z; merged: 2026-09-17T12:44:07Z | Open #2264 explicitly cites #1831. The PR body names a PowerSync correctness oracle and external declaration harness, providing the linked adapter/type-test provenance.                                                                     |
| [PR #2278](https://github.com/TanStack/db/pull/2278) | feat(oracles): require every oracle test to reach a declared part                         | MERGED |          0 / 0 |        5 | Closed: 2026-10-28T14:42:39Z; merged: 2026-10-28T14:42:39Z | Its body explicitly identifies the PR as a next step of #2234, introduces oracle/no-unit-test and declareOracle, and names #2264 as the tracker for laws moved to fixed tests.                                                               |
| [PR #2282](https://github.com/TanStack/db/pull/2282) | fix(scripts): lint the agent's checkout in the oracle lint hooks                          | MERGED |          0 / 0 |        4 | Closed: 2026-10-28T17:23:40Z; merged: 2026-10-28T17:23:40Z | Its body describes checkout selection for the oracle lint hooks and scripts/agent-lint-feedback.mjs named by #2234, and cites the AGENTS.md lint-feedback requirement.                                                                       |
| [#2280](https://github.com/TanStack/db/issues/2280)  | Agent stop hook lints other directories under .worktrees/ instead of the current worktree | CLOSED |          0 / 0 |        0 | Closed: 2026-10-28T17:23:41Z; merged: —                    | Its body reports checkout-scope behavior in the agent stop hook and explicitly says #2234 added the hooks. This supplies historical execution context for #2234's cross-harness feedback work.                                               |

Retained 9 items. Search or selection capped: yes. [Searches, historical snippets, and caveats](misfits-survey/historical-enrichment/c-oracle-contribution-evidence.md).

### Oracle campaigns / declared reach and seed replay

Grouping attributes: #2289 explicitly references #2287, and PR #2290 explicitly references both. All concern required source-health or broader campaign states being missed, including CI reach failures and seed-only replay checks. #2329 adds a Browser SQLite multi-tab campaign reach miss and explicitly links these reports. #2347 reports an Electric SDK snapshot campaign missing a required retry state without a row/health comparison failure; it shares reach sampling and seed-replay attributes, not an established production cause.

#### Current open items

| Item                                                | Type  | Title                                                                        | Status | Labels | Body reactions |  +1 | Conversation comments | Reviews / inline comments | Updated              |
| --------------------------------------------------- | ----- | ---------------------------------------------------------------------------- | ------ | ------ | -------------: | --: | --------------------: | ------------------------- | -------------------- |
| [#2289](https://github.com/TanStack/db/issues/2289) | issue | Measure chance reach misses in oracle properties                             | OPEN   | none   |              0 |   0 |                     0 | —                         | 2026-10-28T18:54:16Z |
| [#2329](https://github.com/TanStack/db/issues/2329) | issue | Browser SQLite multi-tab oracle: random campaign misses reset recovery reach | OPEN   | none   |              0 |   0 |                     0 | —                         | 2026-11-02T14:14:05Z |
| [#2347](https://github.com/TanStack/db/issues/2347) | issue | Make Electric SDK snapshot oracle retry reach deterministic                  | OPEN   | none   |              0 |   0 |                     0 | —                         | 2026-11-03T14:40:16Z |

#### Representative snippets

- [#2347](https://github.com/TanStack/db/issues/2347#issue-body): “The reach guard is correctly rejecting missing coverage; the campaign needs a deterministic witness.” Seed `-387674631` misses `live-outage-crossed-by-throw` after 40 histories; no row/health comparison failed. Seed-only replay is required because path replay skips aggregate reach checks.
- [#2287](https://github.com/TanStack/db/issues/2287#issue-body): “No law fails.”
- [#2329](https://github.com/TanStack/db/issues/2329#issue-body): “This failure does not establish a production row, status, or recovery defect.” The CI campaign reached final-catch-up recovery zero times.
- [PR #2290](https://github.com/TanStack/db/pull/2290#body): “The local runs in the issue passed for a different reason. `createOracleReach` did not check reach when `TANSTACK_DB_ORACLE_SEED` was set without a path.”

#### Historical related items

| Item                                                 | Title                                                                                  | State  | Reactions / +1 | Comments | Closed / Merged (UTC)                                      | Why related                                                                                                                                                     |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------- | ------ | -------------: | -------: | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [PR #2231](https://github.com/TanStack/db/pull/2231) | fix(db): keep a live query running when a lazy demand fails during a truncate replay   | MERGED |          0 / 0 |        5 | Closed: 2026-10-28T17:56:12Z; merged: 2026-10-28T17:56:12Z | #2287 explicitly links this PR; its body reports a random-seed GC-oracle reach miss and declared reach in Query DB campaigns.                                   |
| [PR #2168](https://github.com/TanStack/db/pull/2168) | feat(db): split Collection status from sync errors; add reload() and cleanup admission | MERGED |          0 / 0 |        5 | Closed: 2026-10-28T02:19:30Z; merged: 2026-10-28T02:19:30Z | #2287 explicitly links this PR; its body describes the three source-health generated properties named in that open report.                                      |
| [PR #2278](https://github.com/TanStack/db/pull/2278) | feat(oracles): require every oracle test to reach a declared part                      | MERGED |          0 / 0 |        5 | Closed: 2026-10-28T14:42:39Z; merged: 2026-10-28T14:42:39Z | #2287 explicitly links this oracle-tooling PR; its body records an aggregate-select declared-state miss on an unlucky random seed.                              |
| [PR #2233](https://github.com/TanStack/db/pull/2233) | docs(oracles): score oracle-first work and add declared reach                          | MERGED |          0 / 0 |        5 | Closed: 2026-10-23T15:15:49Z; merged: 2026-10-23T15:15:49Z | This PR introduces createOracleReach and describes skipping reach for a seed or path replay, the named helper and replay behavior discussed by #2289 and #2290. |
| [PR #2237](https://github.com/TanStack/db/pull/2237) | feat(oracles): select every oracle replay through shared helpers                       | MERGED |          0 / 0 |        5 | Closed: 2026-10-27T16:19:33Z; merged: 2026-10-27T16:19:33Z | Its body distinguishes seed-only random campaigns from one-history path replays and describes shared oracle configuration, also named in #2289 and #2290.       |

Retained 5 items. Search or selection capped: yes. [Searches, historical snippets, and caveats](misfits-survey/historical-enrichment/c-oracle-reach-reliability.md).

### DB test runs / CPU time, waits, and timeouts

Grouping attributes: #2274 explicitly links #2238, PR #2275, and PR #2276; PR #2276 links #2238, and PR #2275 links #2274. All describe Vitest DB-suite CPU/time cost, timeout reliability, or waits, with measured or repeated runs.

#### Current open items

| Item                                                 | Type  | Title                                                                                                              | Status           | Labels | Body reactions |  +1 | Conversation comments | Reviews / inline comments | Updated              |
| ---------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------ | ---------------- | ------ | -------------: | --: | --------------------: | ------------------------- | -------------------- |
| [#2238](https://github.com/TanStack/db/issues/2238)  | issue | Two @tanstack/db tests time out under CPU load because a cold module import counts against the 5 s default timeout | OPEN             | none   |              0 |   0 |                     0 | —                         | 2026-10-23T20:19:07Z |
| [#2274](https://github.com/TanStack/db/issues/2274)  | issue | DB tests: Istanbul coverage adds ~50% wall time / ~38% CPU to the packages/db suite                                | OPEN             | none   |              0 |   0 |                     1 | —                         | 2026-10-28T07:56:39Z |
| [PR #2275](https://github.com/TanStack/db/pull/2275) | pr    | test(indexed-db): resume retirement oracle cuts at native events                                                   | OPEN / non-draft | none   |              0 |   0 |                     2 | 1 / 1                     | 2026-10-28T06:43:55Z |
| [PR #2276](https://github.com/TanStack/db/pull/2276) | pr    | test(db): load cold module graphs outside the test timeout                                                         | OPEN / non-draft | none   |              0 |   0 |                     3 | 0 / 0                     | 2026-10-28T07:52:57Z |

#### Representative snippets

- [#2238](https://github.com/TanStack/db/issues/2238#issue-body): “They pass when the suite runs alone.”
- [PR #2276](https://github.com/TanStack/db/pull/2276#body): “Two `@tanstack/db` tests imported the Collection module graph inside the test body, so the cold transform and load counted against the 5 s default timeout.”

#### Historical related items

| Item                                                 | Title                                                                                  | State  | Reactions / +1 | Comments | Closed / Merged (UTC)                                      | Why related                                                                                                                                                                    |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------- | ------ | -------------: | -------: | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [PR #2168](https://github.com/TanStack/db/pull/2168) | feat(db): split Collection status from sync errors; add reload() and cleanup admission | MERGED |          0 / 0 |        5 | Closed: 2026-10-28T02:19:30Z; merged: 2026-10-28T02:19:30Z | The Phase 2 record for #2275 explicitly links this PR; its body reports SQLite CLI tests passing alone and exceeding five seconds under high machine load.                     |
| [PR #2237](https://github.com/TanStack/db/pull/2237) | feat(oracles): select every oracle replay through shared helpers                       | MERGED |          0 / 0 |        5 | Closed: 2026-10-27T16:19:33Z; merged: 2026-10-27T16:19:33Z | Its body describes oracle-replay tooling and busy-machine SQLite CLI test timeouts, matching the replay tooling and load-sensitive timeout terms in #2274 and #2238.           |
| [PR #2150](https://github.com/TanStack/db/pull/2150) | test(query-db): start the old retention scan after readiness on a controlled clock     | MERGED |          0 / 0 |        4 | Closed: 2026-10-14T04:11:06Z; merged: 2026-10-14T04:11:06Z | The body reports a test hanging until Vitest stops it at 5000 ms when startup is slow; #2238 names the same default timeout under CPU load and #2274 names test startup costs. |

Retained 3 items. Search or selection capped: yes. [Searches, historical snippets, and caveats](misfits-survey/historical-enrichment/c-db-test-timing.md).

### Query Collection / subset error visibility and recovery

Grouping attributes: #540 names QueryCollection error/retry/refetch coverage and correct subset targeting; #2270 and #2271 name Query DB on-demand refetch/retry workflows and live-query error observations on the same package versions.

#### Current open items

| Item                                                | Type  | Title                                                                                                       | Status | Labels           | Body reactions |  +1 | Conversation comments | Reviews / inline comments | Updated              |
| --------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------- | ------ | ---------------- | -------------: | --: | --------------------: | ------------------------- | -------------------- |
| [#540](https://github.com/TanStack/db/issues/540)   | issue | Add comprehensive tests for QueryCollection error handling edge cases                                       | OPEN   | query-collection |              0 |   0 |                     1 | —                         | 2026-10-28T03:00:31Z |
| [#2270](https://github.com/TanStack/db/issues/2270) | issue | query-db-collection: a later refetch failure of one on-demand subset never reaches that subset's live query | OPEN   | none             |              0 |   0 |                     0 | —                         | 2026-10-27T18:02:51Z |
| [#2271](https://github.com/TanStack/db/issues/2271) | issue | A live query whose first on-demand subset load failed stays in error after a later load succeeds            | OPEN   | none             |              0 |   0 |                     0 | —                         | 2026-10-27T18:02:52Z |

#### Representative snippets

- [#540](https://github.com/TanStack/db/issues/540#issuecomment-6459480216): “**Section 3** (exact filter targeting of `refetch()`).”
- [#2271](https://github.com/TanStack/db/issues/2271#issue-body): “The only way back is to recreate the live query.”

#### Historical related items

| Item                                                 | Title                                                                                  | State  | Reactions / +1 | Comments | Closed / Merged (UTC)                                      | Why related                                                                                                                                                                          |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------- | ------ | -------------: | -------: | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [PR #441](https://github.com/TanStack/db/pull/441)   | feat: add error tracking and retry methods to query collection utils                   | MERGED |          0 / 0 |        6 | Closed: 2025-09-11T21:20:38Z; merged: 2025-09-11T21:20:38Z | #540 explicitly links this merged error-tracking PR; its body names the Query Collection error and retry utility APIs covered by that open testing follow-up.                        |
| [#537](https://github.com/TanStack/db/issues/537)    | Make QueryCollection refetch() target exact query only                                 | CLOSED |          0 / 0 |        0 | Closed: 2025-10-27T15:30:49Z; merged: —                    | #540 explicitly links this closed issue about exact query targeting and disabled or unobserved queries, also named in #540.                                                          |
| [#539](https://github.com/TanStack/db/issues/539)    | Clarify QueryCollection clearError() timing semantics                                  | CLOSED |          0 / 0 |        1 | Closed: 2026-09-30T13:04:05Z; merged: —                    | #540 explicitly links this closed timing-semantics issue about clearing error state around refetch and recovery attempts.                                                            |
| [PR #2168](https://github.com/TanStack/db/pull/2168) | feat(db): split Collection status from sync errors; add reload() and cleanup admission | MERGED |          0 / 0 |        5 | Closed: 2026-10-28T02:19:30Z; merged: 2026-10-28T02:19:30Z | #540 explicitly links this merged PR; its body names #540 in part and describes health, reload, and request-error reporting after readiness.                                         |
| [#1764](https://github.com/TanStack/db/issues/1764)  | Errors don't propagate to new on-demand live queries after an earlier request succeeds | CLOSED |          0 / 0 |        1 | Closed: 2026-09-29T22:03:45Z; merged: —                    | #2270 explicitly links this closed issue; its body reports later filtered requests failing without the corresponding new live query entering error after an earlier subset succeeds. |
| [PR #1756](https://github.com/TanStack/db/pull/1756) | fix(db): harden incremental subset recovery                                            | MERGED |          0 / 0 |        4 | Closed: 2026-08-24T15:27:41Z; merged: 2026-08-24T15:27:41Z | #2270 explicitly links this merged PR; its body describes subscription-local loadSubset errors, live-query lastSubsetError, and recovery while cached rows remain readable.          |
| [#672](https://github.com/TanStack/db/issues/672)    | Add first-class error tracking to base Collection class                                | CLOSED |          0 / 0 |        2 | Closed: 2026-10-28T02:19:31Z; merged: —                    | Both #2270 and #2271 explicitly link this closed base-Collection error-tracking proposal, which discusses consistent error information and recovery.                                 |
| [PR #671](https://github.com/TanStack/db/pull/671)   | Fix error propagation from sync clients to collections                                 | CLOSED |          0 / 0 |        5 | Closed: 2026-02-23T14:21:31Z; merged: —                    | #2271 explicitly links this closed, unmerged PR; its body describes preload rejection, ready status after failed sync, and error-to-ready recovery.                                  |
| [#1260](https://github.com/TanStack/db/issues/1260)  | Live collection error status not working                                               | CLOSED |          2 / 2 |        1 | Closed: 2026-08-21T16:39:44Z; merged: —                    | #2271 explicitly links this closed issue reporting a throwing queryFn while the live collection displays ready and no error.                                                         |

Retained 9 items. Search or selection capped: yes. [Searches, historical snippets, and caveats](misfits-survey/historical-enrichment/c-query-subset-errors.md).

### Live-query pagination / offset windows and indexing

Grouping attributes: Both describe ordering and paging through useLiveQuery on @tanstack/db 0.15.1 in Bun with 5000 orders and 20000 items, and report page-work measurements or configuration workarounds.

#### Current open items

| Item                                                 | Type  | Title                                                                                                      | Status | Labels | Body reactions |  +1 | Conversation comments | Reviews / inline comments | Updated              |
| ---------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------- | ------ | ------ | -------------: | --: | --------------------: | ------------------------- | -------------------- |
| [#2291](https://github.com/TanStack/db/issues/2291)  | issue | useLiveQuery: move an offset/limit page window without rebuilding the live query                           | OPEN   | none   |              0 |   0 |                     0 | —                         | 2026-10-29T00:28:11Z |
| [#2292](https://github.com/TanStack/db/issues/2292)  | issue | Live query collections can't take autoIndex / defaultIndexType, so an ordered query over one gets no index | OPEN   | none   |              0 |   0 |                     0 | —                         | 2026-10-28T23:39:55Z |
| [PR #2314](https://github.com/TanStack/db/pull/2314) | pr    | fix(db): allow indexing on live-query Collections                                                          | OPEN   | none   |              1 |   0 |                     5 | 1 / 0                     | 2026-11-02T14:06:13Z |
| [PR #2316](https://github.com/TanStack/db/pull/2316) | pr    | fix: retain live query collections across page window changes                                              | OPEN   | none   |              2 |   0 |                     6 | 2 / 4                     | 2026-10-30T22:09:40Z |
| [#2326](https://github.com/TanStack/db/issues/2326)  | issue | setWindow publishes the new page before its include demand settles (on-demand materialize / toArray)       | OPEN   | none   |              0 |   0 |                     0 | —                         | 2026-11-01T16:43:15Z |

#### Representative snippets

- [#2291](https://github.com/TanStack/db/issues/2291#issue-body): “So every page change creates a new live query collection and reruns the whole pipeline.”
- [#2292](https://github.com/TanStack/db/issues/2292#issue-body): “Any sort not foreseen still warns.”

#### Historical related items

| Item                                                 | Title                                                                                              | State  | Reactions / +1 | Comments | Closed / Merged (UTC)                                      | Why related                                                                                                                                                                                                             |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------ | -------------: | -------: | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#1623](https://github.com/TanStack/db/issues/1623)  | RFC: Live Query Framework Bindings Platform                                                        | CLOSED |          2 / 2 |        3 | Closed: 2026-09-30T22:10:51Z; merged: —                    | #2291 explicitly links this RFC; its body covers shared infinite/window control and the relationship between builder limit/offset and later setWindow calls.                                                            |
| [PR #2235](https://github.com/TanStack/db/pull/2235) | feat: add @tanstack/preact-db and share adapter identity and window binding                        | MERGED |          0 / 0 |        6 | Closed: 2026-10-26T14:54:31Z; merged: 2026-10-26T14:54:31Z | #2291 explicitly links this PR; its body describes a shared adapter window binding and controller replacement/reuse for infinite-query hooks.                                                                           |
| [#2137](https://github.com/TanStack/db/issues/2137)  | Paginated live query evaluates materialize includes for rows outside the page                      | CLOSED |          0 / 0 |        1 | Closed: 2026-10-14T20:50:03Z; merged: —                    | #2291 explicitly links this closed report about page changes and materialize includes evaluated outside the requested limit/offset page.                                                                                |
| [#2190](https://github.com/TanStack/db/issues/2190)  | orderBy+limit "requires an index" warning fires when an index exists but its compareOptions differ | CLOSED |          0 / 0 |        1 | Closed: 2026-10-16T20:00:29Z; merged: —                    | #2292 explicitly links this closed report about an ordered limited query warning despite an existing index with different comparison options.                                                                           |
| [PR #2196](https://github.com/TanStack/db/pull/2196) | fix(db): explain orderBy index fallback causes                                                     | MERGED |          0 / 0 |        6 | Closed: 2026-10-16T20:00:28Z; merged: 2026-10-16T20:00:28Z | #2292 explicitly links this merged PR; its body says it explains index fallback causes and closes #2190.                                                                                                                |
| [PR #1675](https://github.com/TanStack/db/pull/1675) | feat(db): shared live-query window controller (RFC #1623 phase 5)                                  | MERGED |          1 / 0 |        7 | Closed: 2026-08-12T19:57:56Z; merged: 2026-08-12T19:57:56Z | #2291 requests moving the page window on an existing live query; this PR describes the shared controller for physical windows and React useLiveInfiniteQuery. The explicitly linked RFC #1623 also names it as phase 5. |
| [PR #2156](https://github.com/TanStack/db/pull/2156) | fix(db): load includes only for the rows a windowed query shows                                    | MERGED |          2 / 0 |        6 | Closed: 2026-10-14T20:50:01Z; merged: 2026-10-14T20:50:01Z | #2291 names the historical includes/page-work report #2137; this PR body explicitly closes #2137 and describes windowed include work and setWindow ownership.                                                           |
| [PR #1353](https://github.com/TanStack/db/pull/1353) | Make indexing opt-in                                                                               | MERGED |          0 / 0 |        6 | Closed: 2026-03-24T15:16:22Z; merged: 2026-03-24T15:16:22Z | #2292 asks to configure automatic indexing on live-query collections; this PR body records the earlier change to opt-in indexing, autoIndex defaults, and defaultIndexType requirements.                                |
| [PR #292](https://github.com/TanStack/db/pull/292)   | automatically create indexes when a collection is queried                                          | MERGED |          0 / 0 |        4 | Closed: 2025-07-21T19:19:55Z; merged: 2025-07-21T19:19:55Z | #2292 names the autoIndex configuration option; this merged PR body describes its introduction on collection options and the original eager default.                                                                    |

Retained 9 items. Search or selection capped: yes. [Searches, historical snippets, and caveats](misfits-survey/historical-enrichment/c-live-query-page-controls.md).

### Framework live-query bindings / conformance

Grouping attributes: Both are framework live-query binding changes exposing useLiveQuery and including shared conformance coverage; both touch code, API, docs, tests, package, and release.

#### Current open items

| Item                                                 | Type | Title                                                       | Status           | Labels | Body reactions |  +1 | Conversation comments | Reviews / inline comments | Updated              |
| ---------------------------------------------------- | ---- | ----------------------------------------------------------- | ---------------- | ------ | -------------: | --: | --------------------: | ------------------------- | -------------------- |
| [PR #1699](https://github.com/TanStack/db/pull/1699) | pr   | Add framework DB adapter package                            | OPEN / non-draft | none   |              0 |   0 |                     8 | 2 / 9                     | 2026-08-05T18:57:02Z |
| [PR #1728](https://github.com/TanStack/db/pull/1728) | pr   | feat(solid-db): Solid v2 RC + wholesale observer refactor   | OPEN / non-draft | none   |              0 |   0 |                    11 | 8 / 13                    | 2026-10-03T15:39:07Z |
| [PR #2327](https://github.com/TanStack/db/pull/2327) | pr   | fix(angular-db): align version support and query reactivity | OPEN             | none   |              0 |   0 |                     3 | 0 / 0                     | 2026-11-02T00:15:36Z |

#### Representative snippets

- [PR #1699](https://github.com/TanStack/db/pull/1699#body): “Port test coverage and shared conformance driver from the React adapter”
- [PR #1728](https://github.com/TanStack/db/pull/1728#issuecomment-5939864583): “Progressive sync and on-demand loading depend on rendering partial data.”

#### Historical related items

| Item                                                 | Title                                                                               | State  | Reactions / +1 | Comments | Closed / Merged (UTC)                                      | Why related                                                                                                                                                                                                                    |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------- | ------ | -------------: | -------: | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [#1623](https://github.com/TanStack/db/issues/1623)  | RFC: Live Query Framework Bindings Platform                                         | CLOSED |          2 / 2 |        3 | Closed: 2026-09-30T22:10:51Z; merged: —                    | The Phase 3 evidence for #1699 and #1728 links this closed framework-binding RFC; its body covers shared observer semantics, framework-native materialization, and cross-adapter conformance.                                  |
| [PR #1675](https://github.com/TanStack/db/pull/1675) | feat(db): shared live-query window controller (RFC #1623 phase 5)                   | MERGED |          1 / 0 |        7 | Closed: 2026-08-12T19:57:56Z; merged: 2026-08-12T19:57:56Z | #1699 discussion explicitly links this refactor and #1728 lists it among related work. The body describes a framework-neutral window controller and the React infinite-query binding.                                          |
| [PR #1642](https://github.com/TanStack/db/pull/1642) | feat(db): shared live-query observer + migrate all five adapters (RFC #1623 step 3) | MERGED |          0 / 0 |        7 | Closed: 2026-08-11T23:36:32Z; merged: 2026-08-11T23:36:32Z | #1728 lists this PR among suggested related work; its body describes migrating five adapters, including Solid, onto a shared observer with snapshot and change-set consumers.                                                  |
| [PR #1669](https://github.com/TanStack/db/pull/1669) | feat(db): ordered snapshot / layout-revision contract (RFC #1623 phase 4)           | MERGED |          0 / 0 |        7 | Closed: 2026-08-12T00:19:26Z; merged: 2026-08-12T00:19:26Z | #1728 lists this PR among suggested related work; its body describes ordered snapshot/layout revision publication and shared conformance across five adapters.                                                                 |
| [PR #1825](https://github.com/TanStack/db/pull/1825) | fix(solid-db): preserve live result identity during reconciliation                  | MERGED |          0 / 0 |        4 | Closed: 2026-09-16T20:04:27Z; merged: 2026-09-16T20:04:27Z | The Phase 3 evidence for #1728 links this Solid reconciliation PR; its body describes stable row identity for custom keys and distinct union results with colliding public $key values, also named in #1728 discussion.        |
| [PR #1955](https://github.com/TanStack/db/pull/1955) | feat(db): add network-first initial rendering for persisted collections             | MERGED |          0 / 0 |        4 | Closed: 2026-09-30T16:47:30Z; merged: 2026-09-30T16:47:30Z | The Phase 3 evidence for #1728 links this PR; its body describes persisted readiness across five framework hooks, including Solid, and opt-in initial Suspense rendering.                                                      |
| [PR #1960](https://github.com/TanStack/db/pull/1960) | fix: render persisted data in Suspense after client stream errors                   | MERGED |          0 / 0 |        4 | Closed: 2026-09-30T21:31:36Z; merged: 2026-09-30T21:31:36Z | The Phase 3 evidence for #1728 links this follow-up to #1955; its body covers persisted initial rendering after client-stream errors and mentions Solid verification. Its principal hook behavior is React-specific.           |
| [PR #2235](https://github.com/TanStack/db/pull/2235) | feat: add @tanstack/preact-db and share adapter identity and window binding         | MERGED |          0 / 0 |        6 | Closed: 2026-10-26T14:54:31Z; merged: 2026-10-26T14:54:31Z | #1699 proposes another framework adapter and #1728 changes a framework binding with shared conformance. This merged PR body adds a Preact adapter and describes shared adapter identity/window binding and conformance suites. |
| [PR #1724](https://github.com/TanStack/db/pull/1724) | feat(vue-db): add infinite query binding                                            | MERGED |          1 / 0 |        4 | Closed: 2026-08-13T16:32:25Z; merged: 2026-08-13T16:32:25Z | #1699 proposes an infinite-query framework binding and ports React conformance coverage; this merged PR body describes a Vue binding over the shared controller and a React/Svelte/Vue infinite-query conformance suite.       |

Retained 9 items. Search or selection capped: yes. [Searches, historical snippets, and caveats](misfits-survey/historical-enrichment/c-framework-bindings.md).

### Aggregates / nullish input semantics

Grouping attributes: PR #2375 explicitly fixes #2365; both concern numeric aggregate results over nullish inputs. Mixed-value correctness, no-value result policy and runtime/type nullability remain distinct judgments; proposed fix and review claims are not closure evidence.

| Item                                                 | Type  | Title                                                    | Status | Labels | Body reactions |  +1 | Conversation comments | Reviews / inline comments | Updated              |
| ---------------------------------------------------- | ----- | -------------------------------------------------------- | ------ | ------ | -------------: | --: | --------------------: | ------------------------- | -------------------- |
| [#2365](https://github.com/TanStack/db/issues/2365)  | issue | `avg`, `min`, `max` and `sum` treat `null` values as `0` | OPEN   | none   |              0 |   0 |                     0 | —                         | 2026-11-07T20:05:48Z |
| [PR #2375](https://github.com/TanStack/db/pull/2375) | pr    | fix(db): leave nullish values out of avg, min and max    | OPEN   | none   |              0 |   0 |                     2 | 8 / 9                     | 2026-11-09T16:32:11Z |

Representative snippets:

- [#2365](https://github.com/TanStack/db/issues/2365): “So `min` can return `0` even though no row has `0`, and `avg` divides by the number of rows instead of the number of values.”
- [#2375](https://github.com/TanStack/db/pull/2375): “A group's `null` or `undefined` value was read as 0, so `avg` divided by the row count and `min` and `max` could report 0.”

No historical enrichment was run for this newly added cluster. [November 9 intake](misfits-survey/intake-2026-11-09.md).

### Includes / per-parent DISTINCT scope

Grouping attributes: PR #2387 explicitly fixes #2385. Both describe DISTINCT in a correlated include child removing equal selected children across different parent relations, including toArray/materialize/include paths. This does not assert that derived-source DISTINCT (#2273) has the same implementation defect.

| Item                                                 | Type  | Title                                                                                   | Status | Labels | Body reactions |  +1 | Conversation comments | Reviews / inline comments | Updated              |
| ---------------------------------------------------- | ----- | --------------------------------------------------------------------------------------- | ------ | ------ | -------------: | --: | --------------------: | ------------------------- | -------------------- |
| [#2385](https://github.com/TanStack/db/issues/2385)  | issue | `distinct()` inside an include dedupes across all parents instead of within each parent | OPEN   | none   |              0 |   0 |                     0 | —                         | 2026-11-09T20:17:24Z |
| [PR #2387](https://github.com/TanStack/db/pull/2387) | pr    | fix(db): apply DISTINCT within each include parent                                      | OPEN   | none   |              0 |   0 |                     2 | 2 / 0                     | 2026-11-09T21:28:26Z |

Representative snippets:

- [#2385](https://github.com/TanStack/db/issues/2385): “When two parents have an identical child row, only one of them keeps it.”
- [#2387](https://github.com/TanStack/db/pull/2387): “`distinct()` in an include child query removed duplicates across all parents instead of within each parent”

No historical enrichment was run for this newly added cluster. [November 10 intake](misfits-survey/intake-2026-11-10.md).

### Includes / filtered joins and keyed lazy demand

Grouping attributes: PR #2388 explicitly fixes #2386. Both describe a source-local where on either side of a join inside an include replacing join-key lazy demand with broader filtered or unrestricted acquisition. Plain joins outside includes are a reported control.

| Item                                                 | Type  | Title                                                                                                            | Status | Labels | Body reactions |  +1 | Conversation comments | Reviews / inline comments | Updated              |
| ---------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------- | ------ | ------ | -------------: | --: | --------------------: | ------------------------- | -------------------- |
| [#2386](https://github.com/TanStack/db/issues/2386)  | issue | Inside an include, a `where` on a join side makes the lazy side load every matching row instead of the join keys | OPEN   | none   |              0 |   0 |                     0 | —                         | 2026-11-09T20:19:19Z |
| [PR #2388](https://github.com/TanStack/db/pull/2388) | pr    | fix(db): keep join-key demand when an include filters a join side                                                | OPEN   | none   |              0 |   0 |                     2 | 2 / 2                     | 2026-11-09T21:58:13Z |

Representative snippets:

- [#2386](https://github.com/TanStack/db/issues/2386): “In a correlated include, adding a `where` to either side of a join turns off keyed lazy loading.”
- [#2388](https://github.com/TanStack/db/pull/2388): “Inside an include, a `where` on either side of a join turned off keyed lazy loading.”

No historical enrichment was run for this newly added cluster. [November 10 intake](misfits-survey/intake-2026-11-10.md).

### React Suspense / initial readiness and failed-resource lifetime

Grouping attributes: Both reports use useLiveSuspenseQuery with DbClient/DbProvider and the same preloaded on-demand-source browser fixture, explicitly connected by #2397. #2396 concerns synchronous success wrongly suspending; #2397 concerns initial rejection repeatedly acquiring instead of reaching ErrorBoundary. The grouping preserves those separate observable promises and candidate causes.

| Item                                                | Type  | Title                                                                                    | Status | Labels | Body reactions |  +1 | Conversation comments | Reviews / inline comments | Updated              |
| --------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------- | ------ | ------ | -------------: | --: | --------------------: | ------------------------- | -------------------- |
| [#2397](https://github.com/TanStack/db/issues/2397) | issue | Initial subset rejection loops in useLiveSuspenseQuery instead of reaching ErrorBoundary | OPEN   | none   |              0 |   0 |                     0 | —                         | 2026-11-10T03:39:06Z |
| [#2396](https://github.com/TanStack/db/issues/2396) | issue | DbClient-backed useLiveSuspenseQuery suspends despite synchronous on-demand results      | OPEN   | none   |              0 |   0 |                     0 | —                         | 2026-11-10T03:38:34Z |

Representative snippets:

- [#2397](https://github.com/TanStack/db/issues/2397): “A rejected initial `loadSubset` under `useLiveSuspenseQuery` + `DbProvider` can repeatedly recreate the query and call the failing loader instead of reaching the surrounding ErrorBoundary.”
- [#2396](https://github.com/TanStack/db/issues/2396): “With a `DbClient`/`DbProvider`, a new `useLiveSuspenseQuery` over an already populated on-demand source suspends even though `loadSubset` answers synchronously with `true`.”

No historical enrichment was run for this newly added cluster. [November 10 intake](misfits-survey/intake-2026-11-10.md).

## Standalone High-Signal Items

These items retain their separate scope. Captured reactions, discussion,
links, or recent detailed reports support keeping them visible; the
[standalone ledger](misfits-survey/clustering/standalone-high-signal-items.md)
records each signal’s indicators and uncertainty.

| Item                                                 | Type  | Title                                                                                                                                 | Status       | Labels | Reactions / +1 | Comments | Reviews / inline | Updated              |
| ---------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------ | -------------: | -------: | ---------------- | -------------------- |
| [#21](https://github.com/TanStack/db/issues/21)      | issue | Support Stable Pagination and Deferred Update Handling for Large Query Results                                                        | OPEN         | none   |        25 / 10 |        1 | —                | 2025-05-22           |
| [#42](https://github.com/TanStack/db/issues/42)      | issue | Devtools                                                                                                                              | OPEN         | none   |         11 / 0 |        0 | —                | 2025-07-16           |
| [#357](https://github.com/TanStack/db/issues/357)    | issue | RFC: Simplified Single-Value State Management API for TanStack DB                                                                     | OPEN         | RFC    |        30 / 29 |        6 | —                | 2025-12-23           |
| [#413](https://github.com/TanStack/db/issues/413)    | issue | Working with discriminated unions inside of collection causes TS troubles                                                             | OPEN         | none   |          0 / 0 |        3 | —                | 2026-09-30           |
| [#506](https://github.com/TanStack/db/issues/506)    | issue | Should AND and OR operators support 0 or more arguments (instead of 2 or more)                                                        | OPEN         | none   |          1 / 1 |        5 | —                | 2025-09-08           |
| [PR #1500](https://github.com/TanStack/db/pull/1500) | pr    | feat(db): expose tracked source record subscriptions                                                                                  | OPEN         | none   |          0 / 0 |        3 | 7 / 11           | 2026-05-06           |
| [PR #1616](https://github.com/TanStack/db/pull/1616) | pr    | feat(PowerSync): add attachments support                                                                                              | OPEN         | none   |          0 / 0 |        9 | 7 / 8            | 2026-09-14           |
| [#1625](https://github.com/TanStack/db/issues/1625)  | issue | RFC: Mutation log reconciliation for optimistic writes                                                                                | OPEN         | none   |          4 / 3 |       10 | —                | 2026-10-01           |
| [PR #1645](https://github.com/TanStack/db/pull/1645) | pr    | perf: systematic live query engine optimizations (31 profile-guided iterations)                                                       | OPEN         | none   |          3 / 1 |        4 | 12 / 12          | 2026-07-05           |
| [#1935](https://github.com/TanStack/db/issues/1935)  | issue | Proposal: a `subscribe` option for query collections                                                                                  | OPEN         | none   |          2 / 2 |        2 | —                | 2026-10-07           |
| [PR #2010](https://github.com/TanStack/db/pull/2010) | pr    | feat(db): publish completed query snapshots                                                                                           | OPEN / draft | none   |          0 / 0 |        3 | 0 / 0            | 2026-10-26           |
| [#2118](https://github.com/TanStack/db/issues/2118)  | issue | Collection conformance oracle suite: shared adapter laws for settlement, cancellation, readiness, reset, and ownership                | OPEN         | none   |          0 / 0 |        1 | —                | 2026-10-28           |
| [#2151](https://github.com/TanStack/db/issues/2151)  | issue | Ordered include windows load children for a parent row the top-K holds only while refilling                                           | OPEN         | none   |          0 / 0 |        0 | —                | 2026-10-14           |
| [#2166](https://github.com/TanStack/db/issues/2166)  | issue | On-demand ordered windows wait on a boundary tie request even when ordering by the collection key                                     | OPEN         | none   |          0 / 0 |        1 | —                | 2026-10-15           |
| [#2176](https://github.com/TanStack/db/issues/2176)  | issue | Query DB treats non-source Query results as fresh source data                                                                         | OPEN         | none   |          0 / 0 |        0 | —                | 2026-10-15           |
| [PR #2179](https://github.com/TanStack/db/pull/2179) | pr    | feat(db): live query without fetching                                                                                                 | OPEN         | none   |          0 / 0 |        6 | 0 / 0            | 2026-10-16           |
| [#2192](https://github.com/TanStack/db/issues/2192)  | issue | structuralIdentity merges distinct RegExp values with reference-valued lastIndex                                                      | OPEN         | none   |          0 / 0 |        0 | —                | 2026-10-16           |
| [#2210](https://github.com/TanStack/db/issues/2210)  | issue | SQLite persistence: a sync transaction whose durable write fails still changes the public Collection                                  | OPEN         | none   |          0 / 0 |        0 | —                | 2026-10-21           |
| [#2254](https://github.com/TanStack/db/issues/2254)  | issue | OfflineExecutor.dispose() never settles pendingTransactionPromises                                                                    | OPEN         | none   |          0 / 0 |        1 | —                | 2026-10-26           |
| [#2294](https://github.com/TanStack/db/issues/2294)  | issue | Ordered live query publishes new rows during a failed marker replay                                                                   | OPEN         | none   |          0 / 0 |        0 | —                | 2026-10-29           |
| [PR #2308](https://github.com/TanStack/db/pull/2308) | pr    | docs: add Neon Realtime collection guide                                                                                              | OPEN         | none   |          0 / 0 |        4 | 4 / 5            | 2026-10-30T18:00:20Z |
| [PR #2312](https://github.com/TanStack/db/pull/2312) | pr    | fix(db): enforce functional callback metadata boundaries                                                                              | OPEN         | none   |          0 / 0 |        5 | 4 / 0            | 2026-11-02T14:17:27Z |
| [#2321](https://github.com/TanStack/db/issues/2321)  | issue | Lazy join demand is recomputed over all demanded keys on every batch (O(N) per batch)                                                 | OPEN         | none   |          0 / 0 |        0 | —                | 2026-10-31T03:26:46Z |
| [PR #2328](https://github.com/TanStack/db/pull/2328) | pr    | perf(db): preserve row references across metadata snapshots                                                                           | OPEN         | none   |          0 / 0 |        3 | 0 / 0            | 2026-11-02T00:13:06Z |
| [#2334](https://github.com/TanStack/db/issues/2334)  | issue | Hydration oracle: observer shows no rows after cleanup, restart, and a new write (granular mode)                                      | OPEN         | none   |          0 / 0 |        0 | —                | 2026-11-02T20:59:26Z |
| [#2337](https://github.com/TanStack/db/issues/2337)  | issue | Revalidate deferred subquery literal semantics: undefined and empty records                                                           | OPEN         | none   |          0 / 0 |        0 | —                | 2026-11-02T23:29:37Z |
| [#2338](https://github.com/TanStack/db/issues/2338)  | issue | Revalidate deferred callback metadata receiving-type failures                                                                         | OPEN         | none   |          0 / 0 |        0 | —                | 2026-11-02T23:29:39Z |
| [#2339](https://github.com/TanStack/db/issues/2339)  | issue | Revalidate declaration emission for exported inferred live-query Collections                                                          | OPEN         | none   |          0 / 0 |        0 | —                | 2026-11-02T23:29:40Z |
| [#2342](https://github.com/TanStack/db/issues/2342)  | issue | Oracle: revalidate retained applied-receipt and lazy child-ready receiving gaps                                                       | OPEN         | none   |          0 / 0 |        0 | —                | 2026-11-02T23:30:08Z |
| [#2344](https://github.com/TanStack/db/issues/2344)  | issue | sqlite-persistence: deleted rows keep their full value in the tombstone table forever (local-only collections)                        | OPEN         | none   |          0 / 0 |        0 | —                | 2026-11-03T11:31:23Z |
| [#2349](https://github.com/TanStack/db/issues/2349)  | issue | Nested optimistic updates strip prototypes from untouched sibling values                                                              | OPEN         | none   |          0 / 0 |        0 | —                | 2026-11-03T18:20:05Z |
| [#2357](https://github.com/TanStack/db/issues/2357)  | issue | browser-db-sqlite-persistence: closing a tab mid-write corrupts the OPFS database for tabs that stay open                             | OPEN         | none   |          0 / 0 |        0 | —                | 2026-11-05T19:38:40Z |
| [#2358](https://github.com/TanStack/db/issues/2358)  | issue | [PowerSync] A synced row that fails deserializationSchema hangs pending writes and silently stops sync for the table                  | OPEN         | none   |          0 / 0 |        0 | —                | 2026-11-05T20:47:29Z |
| [#2363](https://github.com/TanStack/db/issues/2363)  | issue | browser-db-sqlite-persistence: a way to queue app SQL behind the persistence's transactions on a shared database                      | OPEN         | none   |          0 / 0 |        0 | —                | 2026-11-06T21:31:22Z |
| [#2364](https://github.com/TanStack/db/issues/2364)  | issue | Mark the `typescript` peer dependency as optional                                                                                     | OPEN         | none   |          0 / 0 |        0 | —                | 2026-11-07T11:06:20Z |
| [#2367](https://github.com/TanStack/db/issues/2367)  | issue | Persisted query collection: a full read that lands before baseline hydration never drops a persisted row the server no longer returns | OPEN         | none   |          0 / 0 |        0 | —                | 2026-11-08T07:52:29Z |
| [#2381](https://github.com/TanStack/db/issues/2381)  | issue | extractSimpleComparisons returns value: null when the right side of a comparison isn't a literal                                      | OPEN         | none   |          0 / 0 |        0 | —                | 2026-11-09T16:34:34Z |
| [PR #2366](https://github.com/TanStack/db/pull/2366) | pr    | feat(powersync-db-collection): support managed tables (direct: true)                                                                  | OPEN         | none   |          0 / 0 |        9 | 4 / 0            | 2026-11-08T08:46:59Z |
| [PR #2376](https://github.com/TanStack/db/pull/2376) | pr    | feat(supabase-db-collection): add Supabase collection                                                                                 | OPEN         | none   |          0 / 0 |        3 | 1 / 5            | 2026-11-09T12:38:50Z |
| [PR #2377](https://github.com/TanStack/db/pull/2377) | pr    | Add direct PowerSync package (without SQLite)                                                                                         | OPEN         | none   |          0 / 0 |        3 | 1 / 0            | 2026-11-09T11:25:41Z |
| [#2399](https://github.com/TanStack/db/issues/2399)  | issue | `fn.select` result validation walks all nested data in every row, in production                                                       | OPEN         | none   |          0 / 0 |        0 | —                | 2026-11-10T13:38:37Z |
| [#2398](https://github.com/TanStack/db/issues/2398)  | issue | Support bounded ordered acquisition when adapters can satisfy the complete ordering                                                   | OPEN         | none   |          0 / 0 |        0 | —                | 2026-11-10T03:39:37Z |
| [PR #2395](https://github.com/TanStack/db/pull/2395) | pr    | feat(electric): make awaitMatch replay history configurable                                                                           | OPEN         | none   |          0 / 0 |        2 | 0 / 0            | 2026-11-10T03:20:53Z |
| [PR #2392](https://github.com/TanStack/db/pull/2392) | pr    | feat(powersync-db-collection): support numeric collection keys                                                                        | OPEN         | none   |          0 / 0 |        3 | 2 / 1            | 2026-11-10T13:19:26Z |
| [PR #2384](https://github.com/TanStack/db/pull/2384) | pr    | fix(db): report pending joined demand as subset loading                                                                               | OPEN         | none   |          0 / 0 |        2 | 1 / 0            | 2026-11-09T20:11:52Z |

Representative snippets:

- [#21](https://github.com/TanStack/db/issues/21#issue-body): “Sudden reordering of lists during active interaction (e.g., mid-scroll).”
- [#42](https://github.com/TanStack/db/issues/42#issue-body): “click on a collection & browse it's data”
- [#357](https://github.com/TanStack/db/issues/357#issuecomment-3687126471): “This is currently possible by hacking around a `localOnlyCollection` and storing a single row, but it's not ideal”
- [#413](https://github.com/TanStack/db/issues/413#issue-body): “I can't properly query this without typecasting/asserting atm”
- [#506](https://github.com/TanStack/db/issues/506#issuecomment-3265109169): “This issue is proposing a modification of the `and`/`or` functions to support any number of arguments (instead of 2 or more).”
- [PR #1500](https://github.com/TanStack/db/pull/1500#issuecomment-4355113885): “nested live queries expose direct source records for now.”
- [PR #1616](https://github.com/TanStack/db/pull/1616#issuecomment-5629106038): “The upload/delete completion race remains an upstream blocker:”
- [#1625](https://github.com/TanStack/db/issues/1625#issuecomment-4948606647): “Offline create-then-edit is our primary flow”
- [PR #1645](https://github.com/TanStack/db/pull/1645#body): “mutation bursts changed from quadratic to flat”
- [#1935](https://github.com/TanStack/db/issues/1935#issuecomment-6028852201): “Since #1826 each direct write refetches every active scoped query”
- [PR #2010](https://github.com/TanStack/db/pull/2010#issuecomment-5995166657): “Render immediately the partial set and then the UI jumps a bit later when the full set comes in?”
- [#2118](https://github.com/TanStack/db/issues/2118#issue-body): “Nothing shows that each adapter keeps them.”
- [#2151](https://github.com/TanStack/db/issues/2151#issue-body): “The published rows stay correct. The extra work is the children of one parent row for each such checkpoint.”
- [#2166](https://github.com/TanStack/db/issues/2166#issue-body): “Each window step therefore costs two sequential round trips instead of one, and `setWindow()` resolves only after the boundary request returns.”
- [#2176](https://github.com/TanStack/db/issues/2176#issue-body): “Expected: `x` remains `local` and no third row publication occurs.”
- [PR #2179](https://github.com/TanStack/db/pull/2179#issue-body): “Some remote API requests cannot be derived correctly from the query IR.”
- [#2192](https://github.com/TanStack/db/issues/2192#body): “The structural-identity oracle currently generates only numeric `lastIndex` values.”
- [#2210](https://github.com/TanStack/db/issues/2210#body): “After the failure, the public Collection and durable storage disagree.”
- [#2254](https://github.com/TanStack/db/issues/2254#issue-body): “a transaction committed on a disposed executor never leaves `persisting`, and its `isPersisted.promise` never settles.”
- [#2273](https://github.com/TanStack/db/issues/2273#issue-body): “This silently omits children when multiple parents have equal projected child values.”
- [#2293](https://github.com/TanStack/db/issues/2293#issue-body): “A single unchained live query cleans up silently.”
- [#2294](https://github.com/TanStack/db/issues/2294#body): “A later successful random campaign does not close this defect.”
- [#2310](https://github.com/TanStack/db/issues/2310#issue-body): “It is not yet diagnosed as a production defect versus an oracle model, driver, or checkpoint defect.”

## Unclustered / Maintenance / Unclear

These primary buckets preserve every remaining item. Unclustered means no
sufficiently concrete primary multi-item match was assigned; it does not mean
a report lacks detail. Stale-looking hints remain unverified and do not
recommend closure. The [detailed bucket ledger](misfits-survey/clustering/unclustered-maintenance-unclear.md)
retains assignment rationales and uncertainty.

### Unclustered / unclear (22)

| Item                                                | Type  | Title                                                                                                                                     | Status | Labels | Reactions / +1 | Comments | Reviews / inline | Updated    | Signal / assignment context                                                                                                                                        |
| --------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------ | -------------: | -------: | ---------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [#24](https://github.com/TanStack/db/issues/24)     | issue | Implement Throttled Update Notifications for Query Reactivity                                                                             | OPEN   | none   |          1 / 1 |        2 | —                | 2025-04-30 | Proposes throttled query notifications for high-update scenarios.                                                                                                  |
| [#25](https://github.com/TanStack/db/issues/25)     | issue | Handle Shape Evolution Conflicts Across Transactions                                                                                      | OPEN   | none   |          0 / 0 |        0 | —                | 2025-04-28 | Proposes shallow conflict detection and transaction-wide rollback when server shape changes invalidate pending optimistic changes.                                 |
| [#146](https://github.com/TanStack/db/issues/146)   | issue | Support for Nested Transactions                                                                                                           | OPEN   | none   |          0 / 0 |        1 | —                | 2025-06-07 | Requests nested transaction scopes for partial rollback and modular composite operations.                                                                          |
| [#355](https://github.com/TanStack/db/issues/355)   | issue | Add Migration Guide                                                                                                                       | OPEN   | none   |          0 / 0 |        2 | —                | 2025-08-01 | Offers a gist draft for a future migration guide.                                                                                                                  |
| [#422](https://github.com/TanStack/db/issues/422)   | issue | SQL STRING_AGG function in groupBy                                                                                                        | OPEN   | none   |          0 / 0 |        1 | —                | 2025-08-19 | Requests ordered string aggregation of joined brand names grouped by product, with array aggregation as an alternative.                                            |
| [#493](https://github.com/TanStack/db/issues/493)   | issue | Add Playwright tests for react-db useLiveQuery                                                                                            | OPEN   | none   |          1 / 1 |        0 | —                | 2025-09-03 | Requests Playwright coverage for React concurrent browser rendering after an initial-state bug escaped existing tests.                                             |
| [#619](https://github.com/TanStack/db/issues/619)   | issue | Deduplicate queries by `id`                                                                                                               | OPEN   | none   |          0 / 0 |        3 | —                | 2025-10-20 | Requests identifier-based sharing of live queries when replacing reused TanStack Query hooks.                                                                      |
| [#634](https://github.com/TanStack/db/issues/634)   | issue | refactor the reconciliation process to be simpler and more maintainable                                                                   | OPEN   | none   |          0 / 0 |        1 | —                | 2025-10-04 | Proposes a reconciliation refactor with explicit truncate events, one optimistic rebase path, and a shared stream for indexes and live queries.                    |
| [#643](https://github.com/TanStack/db/issues/643)   | issue | Vue implementation                                                                                                                        | OPEN   | none   |          0 / 0 |        1 | —                | 2026-03-12 | Requests that the Vue implementation follow Solid reactivity conventions.                                                                                          |
| [#799](https://github.com/TanStack/db/issues/799)   | issue | Add generic expression helpers to help collection implementors handle ASTs                                                                | OPEN   | none   |          0 / 0 |        0 | —                | 2025-11-11 | Requests generic AST traversal, transformation and collection helpers for predicate pushdown in collection implementations.                                        |
| [#1450](https://github.com/TanStack/db/issues/1450) | issue | Feature: Compile-time field guards for collection CRUD operations                                                                         | OPEN   | none   |          0 / 0 |        0 | —                | 2026-04-03 | Proposes compile-time field restrictions for collection CRUD operations so action-only fields cannot be edited by direct updates.                                  |
| [#1712](https://github.com/TanStack/db/issues/1712) | issue | Single-round-trip remote joins for on-demand collections (let the sync layer fetch related rows)                                          | OPEN   | none   |          0 / 0 |        0 | —                | 2026-08-04 | Proposes a sync-layer relation-loading API to fetch joined rows with the primary subset.                                                                           |
| [#1729](https://github.com/TanStack/db/issues/1729) | issue | Support nullable callbacks in useLiveInfiniteQuery                                                                                        | OPEN   | none   |          0 / 0 |        1 | —                | 2026-08-19 | Requests nullable callback support across first-party infinite-query adapters, with lifecycle and public-type conformance criteria.                                |
| [#1820](https://github.com/TanStack/db/issues/1820) | issue | test: close remaining oracle contract and native execution gaps                                                                           | OPEN   | none   |          0 / 0 |        0 | —                | 2026-09-14 | Tracks remaining contract decisions and execution-evidence gaps after oracle repairs.                                                                              |
| [#1827](https://github.com/TanStack/db/issues/1827) | issue | Public hook or event for live-query graph runs (for performance attribution)                                                              | OPEN   | none   |          0 / 0 |        0 | —                | 2026-09-16 | Requests public graph-run timing instrumentation for per-query performance attribution.                                                                            |
| [#1972](https://github.com/TanStack/db/issues/1972) | issue | Automatic Query Collection refetch still has no observable result-application settlement                                                  | OPEN   | none   |          0 / 0 |        2 | —                | 2026-10-01 | Reports missing public settlement observability for automatic Query Collection results despite an existing explicit-refetch barrier.                               |
| [#2178](https://github.com/TanStack/db/issues/2178) | issue | Move paced mutation hooks to a shared adapter conformance contract                                                                        | OPEN   | none   |          0 / 0 |        0 | —                | 2026-10-15 | The issue proposes a shared paced-mutation hook contract once another framework consumes it.                                                                       |
| [#2187](https://github.com/TanStack/db/issues/2187) | issue | Reject or preserve literal RefProxy semantics in remote subset wire                                                                       | OPEN   | none   |          0 / 0 |        0 | —                | 2026-10-15 | The issue reports literal RefProxy semantics being lost during a managed SQLite receiving attempt.                                                                 |
| [#2240](https://github.com/TanStack/db/issues/2240) | issue | Custom string collation: opt-in to trust the provider's order, so ordered windows page instead of loading the full source                 | OPEN   | none   |          0 / 0 |        0 | —                | 2026-10-23 | Proposes trustProviderOrder for custom collations that match backend ordering, with collated cursor comparisons.                                                   |
| [#2243](https://github.com/TanStack/db/issues/2243) | issue | Deferred live queries: let the sync adapter report an already-held subset (isSubsetLoaded) so a remounted page renders on its first frame | OPEN   | none   |          0 / 0 |        0 | —                | 2026-10-23 | Proposes an optional isSubsetLoaded hook so deferred windows can publish already-held rows before subscribing.                                                     |
| [#2255](https://github.com/TanStack/db/issues/2255) | issue | persistedCollectionOptions without a schema can't be passed to createCollection (follow-up to #1452)                                      | OPEN   | none   |          0 / 0 |        0 | —                | 2026-10-25 | Reports failed schema inference when composing schema-less synced sources with persistedCollectionOptions and createCollection.                                    |
| [#2261](https://github.com/TanStack/db/issues/2261) | issue | `Collection.currentStateAsChanges` JSDoc examples don’t match `CurrentStateAsChangesOptions`                                              | OPEN   | none   |          0 / 0 |        0 | —                | 2026-10-26 | Reports two currentStateAsChanges JSDoc filter examples that do not match the public options type: an unsupported whereExpression field and callback-valued where. |

### Routine maintenance / dependency / release (5)

| Item                                                | Type  | Title                                                               | Status | Labels | Reactions / +1 | Comments | Reviews / inline | Updated    | Signal / assignment context                                                                                                                         |
| --------------------------------------------------- | ----- | ------------------------------------------------------------------- | ------ | ------ | -------------: | -------: | ---------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#43](https://github.com/TanStack/db/issues/43)     | issue | Implement js-framework-benchmark                                    | OPEN   | none   |          0 / 0 |        0 | —                | 2025-05-05 | Requests implementation of js-framework-benchmark to exercise query, transaction, and framework integration performance.                            |
| [#196](https://github.com/TanStack/db/issues/196)   | issue | Things to document                                                  | OPEN   | none   |          0 / 0 |        0 | —                | 2025-07-19 | Tracks documentation topics, with remaining unchecked entries for schema preference and DB usage with query.                                        |
| [#544](https://github.com/TanStack/db/issues/544)   | issue | Dependency Dashboard                                                | OPEN   | none   |          0 / 0 |        0 | —                | 2026-10-25 | Automated Renovate dashboard lists dependency updates, deprecations, security update PRs, and detected dependency versions throughout the monorepo. |
| [#990](https://github.com/TanStack/db/issues/990)   | issue | Please add the project to localfirst landscape                      | OPEN   | none   |          0 / 0 |        1 | —                | 2025-12-09 | Requests adding TanStack DB to the local-first landscape directory.                                                                                 |
| [#2063](https://github.com/TanStack/db/issues/2063) | issue | Optimistic history oracle retains source rows from an aborted batch | OPEN   | none   |          0 / 0 |        0 | —                | 2026-10-06 | Reports an optimistic-history driver ledger mismatch after an aborted source batch.                                                                 |

### Duplicate or stale-looking (3)

| Item                                              | Type  | Title                                                                              | Status | Labels      | Reactions / +1 | Comments | Reviews / inline | Updated    | Signal / assignment context                                                                                             |
| ------------------------------------------------- | ----- | ---------------------------------------------------------------------------------- | ------ | ----------- | -------------: | -------: | ---------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------- |
| [#319](https://github.com/TanStack/db/issues/319) | issue | Order by an optional column                                                        | OPEN   | none        |          0 / 0 |        2 | —                | 2025-07-28 | One comment says it is closing the issue, but supplied metadata reports OPEN and a later comment asks for verification. |
| [#968](https://github.com/TanStack/db/issues/968) | issue | useLiveInfiniteQuery doesn't fetch more data when collection has no more items     | OPEN   | none        |          2 / 2 |        2 | —                | 2026-10-29 | Maintainer reports migration/guidance landed in #1806; an October 29 comment says it can be closed.                     |
| [#996](https://github.com/TanStack/db/issues/996) | issue | Add a way to enforce collection mutations via actions disallowing inline mutations | OPEN   | enhancement |          0 / 0 |        6 | —                | 2026-10-29 | October 29 comment reports #1296 added the optional enforcement example and suggests closure; metadata remains OPEN.    |

## Previously captured items now closed or merged

Status-only checks on November 2. These states do not establish product-law closure.

| Item                                                 | State  | Closed / merged at   | Prior assignment               |
| ---------------------------------------------------- | ------ | -------------------- | ------------------------------ |
| [#2169](https://github.com/TanStack/db/issues/2169)  | CLOSED | 2026-10-30T14:16:26Z | c-optimistic-demand-visibility |
| [#2209](https://github.com/TanStack/db/issues/2209)  | CLOSED | 2026-10-29T20:51:17Z | c-sqlite-electric-peers        |
| [PR #2217](https://github.com/TanStack/db/pull/2217) | MERGED | 2026-10-29T15:28:25Z | routine-maintenance            |
| [#2273](https://github.com/TanStack/db/issues/2273)  | CLOSED | 2026-11-01T16:16:16Z | standalone-high-signal         |
| [PR #2277](https://github.com/TanStack/db/pull/2277) | CLOSED | 2026-10-30T06:17:22Z | c-effect-initial-delivery      |
| [#2287](https://github.com/TanStack/db/issues/2287)  | CLOSED | 2026-10-30T13:39:57Z | c-oracle-reach-reliability     |
| [PR #2290](https://github.com/TanStack/db/pull/2290) | MERGED | 2026-10-30T13:39:56Z | c-oracle-reach-reliability     |
| [#2293](https://github.com/TanStack/db/issues/2293)  | CLOSED | 2026-10-30T16:10:25Z | standalone-high-signal         |
| [#2310](https://github.com/TanStack/db/issues/2310)  | CLOSED | 2026-10-30T21:24:11Z | standalone-high-signal         |

## Ledger Paths

- [Orientation and worktree provenance](misfits-survey/orientation-and-framing.md)
- [Detailed repo framing](misfits-survey/repo-framing.md)
- [Source access and extraction conventions](misfits-survey/source-access-and-extraction.md)
- [Census manifest](misfits-survey/github-open-items-manifest.json) and [acquisition record](misfits-survey/source-acquisition.json)
- [Full extraction ledger](misfits-survey/open-item-coverage-ledger.md) and [attribute JSONL](misfits-survey/open-item-attributes.jsonl)
- [Final assignment table](misfits-survey/clustering/open-item-cluster-assignments.md) and [assignment JSON](misfits-survey/clustering/open-item-cluster-assignments.json)
- [Coverage summary](misfits-survey/clustering/coverage-summary.md) and [assignment verification](misfits-survey/clustering/coverage-verification.json)
- [Cluster attribute and member evidence](misfits-survey/clustering/cluster-attribute-basis.json)
- [Factual cluster keywords](misfits-survey/clustering/cluster-keywords.json) and [standalone keywords](misfits-survey/clustering/standalone-keywords.json) for historical enrichment
- [Supplemental cluster signal indicators and limits](misfits-survey/clustering/probable-cluster-notes.md)
- [Grouping method, worker manifests, and limits](misfits-survey/clustering/method-and-limits.md)
- [Historical context index and bounds](misfits-survey/historical-enrichment/index.md), [verification](misfits-survey/historical-enrichment/verification.json), and [retained relationships](misfits-survey/historical-enrichment/historical-items.jsonl)

- [Complete generated-file index](misfits-survey/artifacts.md), including every batch ledger, evidence file, assignment input, and historical file
- [Original memo bookkeeping checks](misfits-survey/final-verification.json) and [#2310 supplement checks](misfits-survey/supplement-2310-verification.json)

- [Issue #2296 supplement and assignment basis](misfits-survey/supplement-2296.md)
- [Issue #2310 supplement and assignment basis](misfits-survey/supplement-2310.md)
- [Issue #2329 supplement and assignment basis](misfits-survey/supplement-2329.md) — declared reach/replay cluster; SQLite peer coordination is a receiving-path cross-link.

## Later standalone intake

These later local signals are separate from the 139 captured GitHub records and
their assignments. The original census is unchanged; the explicitly recorded GitHub supplements
are counted separately. This local intake does not change those assignments.

- [Observer hydration rows after repeated cleanup and restart](misfits-survey/intake/observer-hydration-cleanup-restart-2026-10-29/signal.md) — incoming PR #2298 CI signal with matching saved PR/main seed and trace; step 7 snapshot rows differ from public Collection entries. Root cause and repair location are unknown. The owner is the plain-Collection observer hydration oracle, and only seed-based replay is documented. Aggregate reach in the same job remains separately tracked under #2289.

- [November 2 categorization refresh](misfits-survey/refresh-2026-11-02/categories.md)
- [November 2 extraction coverage](misfits-survey/refresh-2026-11-02/extraction-verification.json)

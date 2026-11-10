# Targeted intake: #2352 and #2353

Captured November 4, 2026 with full bodies and complete conversation comments (zero each). These are two reported correctness bugs under existing Query DB acquisition lifecycle/B16, with separate freshness and ownership judgments. No new cluster, API decision or common cause is inferred. PR #2354 is handled in another session and excluded.

| Issue | Primary owner | Distinct reported failure | Coordination |
| --- | --- | --- | --- |
| [#2352](https://github.com/TanStack/db/issues/2352) | B16 | Freshness on identical populated-subset reuse | #1935 is broader proposal context |
| [#2353](https://github.com/TanStack/db/issues/2353) | B16 | Rows lost after old overlapping fallback owner releases | B18/P1/P5 on the ordered receiving path |

## #2352

A second consumer reportedly reuses an already populated identical on-demand subset without applying configured stale/refetch-on-mount behavior. Newly added server rows remain absent from both live queries; focus/reconnect still refetch. The issue supplies a Node test and describes React Native/Hermes usage.

The second acquisition of an existing shared Query subset is the same lifecycle boundary owned by B16, with a distinct freshness-policy judgment. Sharing is intended; freshness on reacquisition must be evaluated separately from cancellation, ownership and the broader #1935 subscription proposal.

Reported correctness bug, not a request for a new API. Establish the accepted Query Collection freshness contract for reusing a populated subset; do not assume that logical reacquisition must equal a new QueryObserver mount merely because the reporter proposes it. Preserve intentional exact-request sharing and distinguish stale/fresh, refetchOnMount true/false/always/function, enabled, in-flight deduplication and staleTime null controls. The described local patch is unvalidated testimony.

[Source](https://github.com/TanStack/db/issues/2352): “With `syncMode: "on-demand"` and `staleTime: 0`, a second live query with the same predicate as an already-loaded subset never refetches.”

## #2353

After a replacement ordered window subscribes and both windows acquire the same full-source subset, releasing the old window reportedly empties the source and replacement window permanently. The report exercises NULL page-end and locale-sort fallback triggers, with release-order, different-subset and unordered controls.

The governing observation is retaining rows still held by another acquisition, matching B16 and explicitly related #2160. Ordered fallback is the receiving path, so B18 coordinates it; #2268 work-count concerns and #2352 freshness remain separate judgments.

Reported existing-behavior correctness bug, not a feature request. Judge source and live-window rows across overlapping owners and release, preserving valid full-source fallback for unexpressible page ends or locale order. NULL/locale triggers do not establish a comparison/index defect. Core Node receiving and Vue binding receiving are separate claims; preserve ownership and ordered publication/work laws while locating the defect.

[Source](https://github.com/TanStack/db/issues/2353): “If both windows fell back to a full-source read of the same filter, releasing the old window removes every row from the source collection.”

## Distinguishing evidence and limits

#2352 records DB 1.0.0-rc.1.3, Query DB 1.5.1 and Query Core 5.104.5, plus earlier version pairs. Its supplied Node test reports one fetch and only x1 in both windows after the server gains x2. The desired second-acquisition mount-policy equivalence needs contract authority; the reporter’s local patch is not an approved implementation. Node evidence does not discharge actual React Native receiving.

#2353 records DB 1.0.0-rc.1.3, Query DB 1.5.1 and Query Core 5.105.3 on Node 26.13 / Vitest 4.1.12, first seen with Vue. The reported backend returns 240 full-source rows and each ordered window requests 50; after old-window release, source and new window become empty. NULL page-end and locale-sort triggers, matching-index claims, release-before-acquire, nonidentical-subset and unordered controls distinguish ownership from a generic fallback/index complaint. The external reproduction repository and StackBlitz were not fetched, so their test outcomes and backend semantics remain reporter claims.

The cumulative inventory grows from 164 to 166 captures (142 issues, 24 PRs), across the same 26 clusters. The frozen November 2 census of 144 open items is unchanged. Prior attributes, assignments, investigation results and source updates are preserved. This intake changes no production/tests or GitHub state and runs no reproduction.

[Assignments](supplement-2352-2353/assignments.json) · [Capture receipt](supplement-2352-2353/intake.json) · [Raw capture](supplement-2352-2353/capture.json) · [Extraction ledger](supplement-2352-2353/batch-001-ledger.md) · [Attributes](supplement-2352-2353/batch-001-attributes.jsonl) · [Quotes](supplement-2352-2353/batch-001-snippets.md).

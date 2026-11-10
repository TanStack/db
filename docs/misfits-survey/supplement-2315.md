# Issue #2315 supplement

Captured October 30, 2026, 13:23 MDT (`2026-10-30T19:23:32.958905+00:00`): full issue body, metadata and all paginated conversation comments (zero).

Primary assignment: **Ordered loader / failed requests and recovery** (`c-ordered-request-recovery`). It reports ordered-window failure authority and error identity after rejected replay acquisition and a later synchronous include-load throw. This extends the cluster's failure boundary; it establishes neither a duplicate nor a shared cause with #2165/#2191 or the earlier R03 finding.

Investigation owner: **P4 — live-query replay/preload/includes**, cross-linked from **B15 — failed ordered requests/recovery** in the [starting prompts](/Users/kyle.mathews/.codex/worktrees/collection-publication/tanstack-db/docs/misfits-survey-session-prompts-2026-10-30.md). Share witnesses rather than assigning competing model writers.

The reporter supplies property `replay.ordered-failed-replay`, seed `963116110`, path `318:2:1:6:5:7:6:6:6:6:9` at `a5c4986a14dc6c6a90ed9b194457edefba9a4a48`. After hold → truncateMarkers → window(0,1) → newest rejection → markerThrows → move(4,1), move 1 rejects with `marker load threw` instead of the model's earliest relevant replay failure. The input uses descending order, initial limit 2, includes, on-demand markers, no peer, and `joined:none`. It includes driver setup and final settlement; it is not a standalone public-API reproduction.

**Classification remains unresolved:** this is a reported assertion-level oracle mismatch, not established production RED. The issue asks whether production loses the deciding failure or the oracle misattributes relevance. It cites the architecture's own-replay earliest-deciding-failure rule; a new error-priority feature is not established by this report. Do not replace it with source-global error precedence or assume the earlier R03 repair resolves this trace.

The report reproduces at PR #2309's head and with eleven existing production files selectively restored to merge-base `c351fc04d7f70dc59bf92ecbed310f899b9511cd`. That control is not a separate clean baseline checkout. The added unary helper remained unused. PR #2309's merged commit `0531c50ad419a1b51ad3e27e3632e70be3c6bdb3` and current published packages were not independently replayed in the report. This intake read the issue; it did not execute the replay or inspect CI/source. The latest-version checkbox is unchecked.

Inventory: **137 captured items (124 issues, 13 PRs)**; 26 clusters contain 83 items. Remaining buckets: 23 standalone, 22 unclear, 6 maintenance, 3 duplicate/stale-looking. All prior 136 attribute records and assignments are preserved. The original census and historical searches were not refreshed.

- [Issue](https://github.com/TanStack/db/issues/2315)
- [Capture bookkeeping](supplement-2315.json)
- [Verification](supplement-2315-verification.json)
- [Extraction ledger](analysis/issues/batch-012-ledger.md)
- [Attributes](analysis/issues/batch-012-attributes.jsonl)
- [Exact source quotes](analysis/issues/batch-012-snippets.md)
- [Primary assignments](clustering/open-item-cluster-assignments.json)
- [Survey](../misfits-survey.md)

Raw capture outside Git: `/private/tmp/tanstack-db-open-items-2026-10-30-misfits/supplement-2315/batch-012-2315-2315.json`.

## Post-census #2315 comment update

[Comment 6579843541](https://github.com/TanStack/db/issues/2315#issuecomment-6579843541), posted November 2, 2026, 7:36 MST, is now [captured separately](refresh-2026-11-02/updates/issue-2315-comment-6579843541.md). It adds a rejection-only witness (seed `112008075`, path `431:3:2:3:3:6`) reportedly reproduced on PR #2314 and main, without `markerThrows`. P4 owns it with B15 coordination; production/model attribution and common cause remain unresolved. It does not add an inventory item.

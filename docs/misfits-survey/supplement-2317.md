# Issue #2317 supplement

Captured October 30, 2026, 15:26 MDT (`2026-10-30T21:26:38.117235+00:00`): full body, metadata and all paginated conversation comments (zero).

Primary assignment: **SQLite persistence / Electric multi-tab coordination** (`c-sqlite-electric-peers`). It adds source-facing metadata observations through a controlled peer row notice. It does not establish Electric-specific behavior, durable row loss or a real browser multi-tab reproduction. It explicitly links #2272 as separate real-coordinator receiving coverage.

Investigation owner: **P8 — persisted metadata session reads across peer notices**, cross-linked from follower P3 and metadata PR closeout P6 in the [starting prompts](/Users/kyle.mathews/.codex/worktrees/collection-publication/tanstack-db/docs/misfits-survey-session-prompts-2026-10-30.md). Reuse the existing sync-metadata session model and persisted receiving driver. No shared cause with follower rotation or the withdrawn #2303 diagnosis is established.

The issue reports property `sync-metadata-session.persisted-peers`, seed `346038028`, path `36:2:4:6:10:14:16:14:14:13:13:13`. At zero-based step 11, a peer row notice for key 1 preserves its own expected metadata but row 2's earlier `{s:3}` is absent. The existing model expects source read-your-writes and own reads in serialization order. This is a reported assertion mismatch; root cause remains undiagnosed.

The failing prefix contains seed(2,bare), begin, begin, rowSet(2), commit, upsert(2,metadata:false), commit, commit, truncate, collectionDelete(cursor), release, peer(1,row,keepsValue:true). Failure precedes the reported suffix. Keep the full input as a shared-model replay, rather than assigning it a separate expected answer.

The reporter replayed PR #2314 head `a0d2c4e3780307a770ef7734b64a2d4adf5bd3ce` and unchanged merge-base `bfd1da1a7e752d66fd667adfd3cdf54f60732b22` with identical metadata assertions. The base used a complete `git archive` snapshot, the same installed dependencies and package source aliases; neither production nor oracle changed. Each replay ran one history without shrinking, with 37 other tests passing and one existing expected failure retained. The original random failure followed 37 histories and 11 shrinks. These are reporter executions; this intake did not execute them or inspect linked code/CI.

Boundary: `persistedCollectionOptions` over an in-memory persistence adapter and controlled coordinator peer notice. Source-facing `metadata.row.get` is not durable metadata or row inspection. The #2272 real-coordinator obligation stays separate.

Inventory: **138 captured items (125 issues, 13 PRs)**; 26 clusters contain 84 items. Remaining buckets: 23 standalone, 22 unclear, 6 maintenance, 3 duplicate/stale-looking. Prior 137 attributes and assignments are preserved. No global census or historical search refresh.

- [Issue](https://github.com/TanStack/db/issues/2317)
- [Capture bookkeeping](supplement-2317.json)
- [Verification](supplement-2317-verification.json)
- [Extraction ledger](analysis/issues/batch-013-ledger.md)
- [Attributes](analysis/issues/batch-013-attributes.jsonl)
- [Exact source quotes](analysis/issues/batch-013-snippets.md)
- [Primary assignments](clustering/open-item-cluster-assignments.json)
- [Survey](../misfits-survey.md)

Raw capture outside Git: `/private/tmp/tanstack-db-open-items-2026-10-30-misfits/supplement-2317/batch-013-2317-2317.json`.

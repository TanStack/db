# Issue #2329 supplement

Captured 2026-11-02T14:15:20.633107+00:00: full issue body, metadata and all 0 conversation comments. The maintainer requested issue creation after investigation of [CI run 41453553336/job 125304468568](https://github.com/TanStack/db/actions/runs/41453553336/job/125304468568).

Primary assignment: **Oracle campaigns / declared reach and seed replay** (`c-oracle-reach-reliability`), investigation **B20**. The report explicitly links #2289, #2287 and PR #2290 and adds a concrete chance-dependent campaign reach failure. **P3 / SQLite persistence / Electric multi-tab coordination** is a receiving-path cross-link, not a second primary assignment. This report does not establish a common production cause with that cluster's row, status or follower reports.

At main `85392bd1d349aa3bb77c9c11ffba671f0b2d2a84`, property `browser.multi-tab-reserved-history` reached reset abandonment in 14 histories and reset-induced source failure in 5, but recovery during final catch-up in 0. The reach assertion failed after the property comparisons completed. The fixed-seed campaign and both fixed reset-recovery regressions passed in the same job.

The CI log and exact-revision source were inspected in this session before filing. No failing CI seed/path was recovered. Local replay did not complete; no production regression or repaired GREEN was established. A generated-grammar repair is proposed in the issue, not validated. The controlled Electric stream and Node-hosted Browser coordinator boundary remain explicit; no miss probability or real-browser claim follows.

Inventory: **139 captured items (126 issues, 13 PRs)**; 26 clusters contain 85 items. Remaining buckets: 23 standalone, 22 unclear, 6 maintenance, 3 duplicate/stale-looking. Prior 138 attributes and primary assignments are preserved. No global census or historical enrichment refresh.

- [Issue](https://github.com/TanStack/db/issues/2329)
- [Capture bookkeeping](supplement-2329.json)
- [Verification](supplement-2329-verification.json)
- [Extraction ledger](analysis/issues/batch-014-ledger.md)
- [Attributes](analysis/issues/batch-014-attributes.jsonl)
- [Exact source quotes](analysis/issues/batch-014-snippets.md)
- [Primary assignments](clustering/open-item-cluster-assignments.json)
- [Survey](../misfits-survey.md)
- [Starting prompts](/Users/kyle.mathews/.codex/worktrees/collection-publication/tanstack-db/docs/misfits-survey-session-prompts-2026-10-30.md)

Raw capture outside Git: `/private/tmp/tanstack-db-open-items-2026-11-02-misfits/supplement-2329/batch-014-2329-2329.json`.

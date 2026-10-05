# Accepted source publication after queued hydration

## Reviewed boundary

Issue #2036 reports a source commit accepted before subset hydration starts,
then rejected when publication follows that hydration. PR #2037 limits the
publication-time sequence check to hydration-owned replay. Commit admission
and writes during hydration keep their existing sequence checks.

The independent law is the existing RFC #1659 durability obligation: an
accepted source commit remains an obligation across persistence scheduling.
The covered history has successful hydration, no cancellation, and one sync
run. Observation occurs after all source and subset receipts settle, before
cleanup. This record does not claim every interleaving or live-provider reach.

## Revisions and preservation

- Original main: `e21c280f3c4e56f6c0d05ec0eed87db29c623489`.
- Original PR: `d18a7c72557e8e8067cc494e84c11ad11ab0baca`.
- Integration main: `cfb03f201bb21d82b7f537a9fbe59d3623f395d6`.
- Merge before the oracle extension: `17a56e64bcabc24dd4ec74597530f1adf644fdbf`.
- Reviewed code and oracle head: `c9a2c631c073bae95c08dc306d642a5687c471ad`.
- Tested production blob: `50920367aa97667de71ca319c46e810d35a0d1a6`.
- Tested oracle blob: `4a5665e0955015ed24730f3d98047a41ff6cec07`.

The integration preserves the author's commit and merges current main normally.
It retains main's reversion of the separate immediate-publication cycle repair.
The new immediate cases hold a predecessor at durability, after its publication.
They do not enter that unsupported publication cycle.

## Loss audit of the original two witnesses

The expanded grammar contains both original fixtures at hydration count two,
ordinary admission, and a dependent successor. It crosses insert/update with
one/two/three hydrations, ordinary/immediate admission, and absent/present
successor. These 24 histories are a complete finite enumeration.

| Original observation | Receiving assertion |
| --- | --- |
| Hydration does not start before source commit | Zero adapter subset calls before source begin/commit |
| Hydrated baseline precedes source publication | Public title recorded at every adapter subset call |
| All source and subset receipts fulfill | Exact fulfilled outcomes after `Promise.allSettled` |
| Collection remains ready | Exact Collection status |
| Final source row and unseen baseline field survive | Independent complete-row expectation for public and durable rows |
| Fresh insert resets metadata, update preserves it | Exact row metadata per operation |
| Successor reads pending metadata and wins | Staged cursor read and final durable cursor |
| Source transactions persist in FIFO order | Durable mutation keys plus source-title order |
| Cleanup preserves the primary failure | Existing bounded cleanup helper and gate release |

`foldDurabilityLedger` folds complete source obligations in commit order. It
has no production generation, queue, or classification helper. Expected source
rows include the preceding baseline's untouched detail. The driver sends only
the source title patch, so production must preserve that detail itself.

No existing main assertion or test expectation changes. The extension replaces
the PR's two fixtures with their finite generalization, without a failure gate.

## Evidence

On original main, both unmodified PR fixtures reject with the reported
hydration-cycle error through `applyTransactionToCollection` and
`applyBufferedSyncTransactionUnsafe`. The expanded 24 histories fail at the
receipt/status/public-row/durable-row assertion.

The same 24 histories fail against integration main without the publication
guard. With the guard, all 39 selected new and existing checks pass without
type errors. The following wrong designs fail at their intended assertions:

| Wrong design | Distinguishing witness | Outcome |
| --- | --- | --- |
| Reject any publication after a sequence advance | Every accepted-before-hydration matrix cell | 24 assertion failures |
| Remove commit-time sequence validation | Existing begin-before-hydration, commit-after-hydration history | Missing-throw assertion failure |
| Preserve stale metadata for ordinary inserts | Every insert matrix cell | 12 metadata assertion failures; update cells pass |

These are assertion failures, not setup failures or timeouts. All temporary
production variants were removed. Historical full-suite evidence on original
main plus the guard was 739 passing tests. That count does not certify the
later integration revision.

On the integration revision with the expanded oracle, the full package suite
passed: 23 files, 737 tests, two existing TODOs, and no type errors. Standalone
`tsc --noEmit` passed. ESLint reported zero errors and 22 existing
`require-await` warnings outside the new cases. After the review moved each
subset unload into the existing bounded cleanup helper, the final focused run
again passed all 39 selected checks with no type errors. The added block was formatted, and `git diff --check` passed. The cached
formatter also proposed unrelated changes to existing type unions; those
changes were excluded.

Independent correctness and simplification reviews found no production or
oracle-correctness defect and no worthwhile simplification. Both identified the
same audit mismatch: subset unloads were outside the bounded helper. The final
fixture puts each unload through that helper so one cleanup failure cannot
skip later actions or mask the primary failure. No failing product history was
inferred from this harness correction.

The commands use the checked-in package configuration. A local run uses:

```sh
cd packages/db-sqlite-persistence-core
PATH="$PWD/../../node_modules/.bin:$PATH" ../../node_modules/.bin/vitest run \
  tests/persisted-oracle.test.ts \
  -t 'publishes committed source|rejects a source transaction|preserves.*metadata|rejects a transaction begun before hydration' \
  --coverage.enabled=false --maxWorkers=2 --reporter=dot
```

Node 24.19.0, Vitest 3.2.4 and TypeScript 5.9.3 ran with jsdom. Registry failures
prevented a fresh lockfile install, so the run reused cached third-party tools.
DB and DB-IVM were built from this worktree, and runtime workspace imports
resolve to those builds. No runtime source alias or SQLite-host shim was added.
This is not an exact-lockfile toolchain receipt.

## Oracle-guide audit

| Requirement | Outcome and evidence |
| --- | --- |
| ORC-001 | Pass. Existing durability law, controlled history and observation boundary stated above and in the executable owner. |
| ORC-002 | Pass. Independent ledger and baseline expectations do not import production semantic machinery. |
| ORC-003 | Pass. Opening contract, local model/grammar prose, production driver and settlement comparison remain visible in the oracle file. |
| ORC-004 | Pass. Original cells reconstruct exactly. Each axis contributes metadata behavior, count boundaries, admission mode or successor dependence. Domains are explicit. Open-crossing histories remain rejection controls. |
| ORC-005 | Pass. Zero pre-commit loads and per-hydration titles witness reach. The recorder distinguishes receipt rejection, wrong status, row loss, stale metadata, omission and durable reordering. |
| ORC-006 | Pass. The three wrong designs above reach their intended assertion checkpoints. |
| ORC-007 | Not applicable. This change adds a finite enumeration, not an important randomized property. Existing random campaigns remain unchanged. |
| ORC-008 | Not applicable. The existing reference model gains no state fields or transitions. |
| ORC-009 | Pass. Shared concepts retain glossary terms. The ledger abstracts complete source obligations and does not model hydration state. |
| ORC-010 | Pass. Results are captured before cleanup. The existing helper bounds every cleanup action and preserves primary and secondary diagnostics. |
| ORC-011 | Not triggered. No shared semantic fault needing another formulation was identified. Provider ordering is a separate receiving-witness gap. |
| ORC-012 | Pass for this bounded audit. This versioned record identifies every requirement, exact revisions and tested blobs. No universal bug-class closure is claimed. |
| ORC-013 | Pass for the declared finite domain. Adjacent counts, operation/admission/successor cases and existing open-crossing controls distinguish plausible wrong consequences. |
| ORC-014 | Limited to the controlled receiving boundary. Live Electric/OPFS handoff remains open with a named owner below. |

## Remaining witnesses

The coverage map assigns cancellation, cleanup/restart and hydration-failure
compositions to `packages/db-sqlite-persistence-core/tests/persisted-oracle.test.ts`.
Those paths need this accepted-before-hydration schedule, not merely their
existing separate histories.

The exact real-provider schedule belongs in
`packages/browser-db-sqlite-persistence/e2e/electric-hydration-straddle.opfs.spec.ts`.
Its existing during-hydration history does not establish this handoff. The
controlled fixture does not prove live Electric delivery, browser scheduling,
OPFS behavior, or application-level downstream error propagation.

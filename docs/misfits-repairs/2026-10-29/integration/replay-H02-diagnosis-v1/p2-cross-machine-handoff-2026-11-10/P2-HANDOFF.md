# P2 cross-machine handoff

The branches below preserve existing code and evidence. The source checkouts and remote P2 working branch remain unchanged. This handoff adds no reproduction or repair verdict.

## Fetch the snapshots

```sh
git fetch origin codex/misfits-p2-evidence codex/misfits-h02-progress-wip codex/misfits-h02-candidate-controls-wip codex/misfits-raw-publication-reference
```

| Branch                                     | Snapshot commit                            | Base                                       | Role                                                        |
| ------------------------------------------ | ------------------------------------------ | ------------------------------------------ | ----------------------------------------------------------- |
| `codex/misfits-h02-progress-wip`           | `6320d060d23ab8e1fc85b94e41bec02a0cf068b8` | `9cfa11fc712866f8f276e85762865ebb8bd49cbe` | Current helper witness and instrumentation code             |
| `codex/misfits-h02-candidate-controls-wip` | `37974065d2c410cc5a383ce0074cd047ddfc644c` | `9cfa11fc712866f8f276e85762865ebb8bd49cbe` | Current helper witness and instrumentation code             |
| `codex/misfits-raw-publication-reference`  | `79eec745f54624b461026ee5052d57d6f7bd969d` | `c351fc04d7f70dc59bf92ecbed310f899b9511cd` | Raw-publication code and historical evidence, for reference |
| `codex/misfits-p2-evidence`                | `c1c2befb48f837ee81f990091016f16063e7b393` | `caa936d5af5332a6eca64335d291ba8e42c8cf37` | H02 evidence with declared vendor-source omissions                     |

The evidence branch can contain a later documentation-only commit. The table identifies the immutable archive commit. The handoff gist comment supplies the final branch tip.

## Read P2 evidence

Canonical V7: [docs/misfits-repairs/2026-10-29/integration/replay-H02-diagnosis-v1/canonical-current-main-v7/handoff-v1.md](https://github.com/TanStack/db/blob/c1c2befb48f837ee81f990091016f16063e7b393/docs/misfits-repairs/2026-10-29/integration/replay-H02-diagnosis-v1/canonical-current-main-v7/handoff-v1.md). Read `outcome-v1.json` beside it.

The recorded verdict is one bounded queued-answer progress RED under the accepted watchdog plan. It establishes no generated campaign, neighbor GREEN, final publication, or production repair.

The `docs/misfits-repairs/2026-10-29/integration/replay-H02-diagnosis-v1/` directory is included except 35 identical captured vendor-source files. It contains `neighbor-ownership-current-main-v3/`, `v5-source-diagnosis-and-minimal-repair-v1.md`, canonical V7, and every candidate-control artifact. Source hashes and raw receipts remain unchanged.

The helper branches preserve their current working trees. Later instrumentation can differ from the frozen V7 source. Use the frozen source envelopes when reconstructing a recorded invocation.

## Raw-publication reference

The raw-publication branch includes the code, models, three investigation/decision/repair documents, and all `review-evidence/collection-publication/` files. Its base is `c351fc04d7f70dc59bf92ecbed310f899b9511cd`.

The evidence branch also includes `docs/misfits-repairs/2026-10-29/integration/replay-H02-diagnosis-v1/p2-cross-machine-handoff-2026-11-10/raw-publication-repair.patch`. The patch includes four previously untracked oracle/receiver sources. Use it only as reference. This handoff does not apply it to P2.

## Prompt clarification

[Agent feedback](https://gist.github.com/KyleAMathews/75bbadfbc449d798c9f0b9691a540406#gistcomment-6466940) identifies scope confusion and stale replay coordinates.

P1 primary items are #2214, #2182, and #2183. #2335 is a comparison. Context issues do not replace that task.

Each copied prompt now requires an intake ledger before any reproduction. Each session places its main prompt before historical additions. Saved replay coordinates require a decoded-history check. A passing different history supplies no reproduction evidence.

The prompt document uses paths relative to the repository. The gist copy links available evidence to pinned GitHub snapshots. Missing historical evidence remains unverified. Continue supported current-main investigation without inventing historical results or bypassing receiving-run admission.

## Additional documents

The evidence branch contains the directly cited prompt documents. For four other referenced directories, it includes their top-level Markdown reports only. Those directories are partial documentation selections. The H02 export has the 35 vendor-source omissions described below.

Inspect snapshots with `git show <commit>:<path>`. Use a separate worktree if needed. Port selected witness changes only after checking current contracts. These snapshots are handoffs, not merge or PR-readiness claims.

## Vendor-source omissions

The managed Git hook rejected 35 identical captured copies of Node's bundled Undici source. Its embedded llhttp WebAssembly base64 triggers the AWS-token rule. The source matches the Node 24.19.0 builtin exactly. The hook ran without a bypass.

`EXPORT-OMISSIONS.json` records every omitted path and its original SHA256. All other archived source entries match local bytes. The original local archive remains unchanged. The exported archive is incomplete until these vendor captures are restored.

With Node 24.19.0, run the included script from the receiving repository root:

```sh
node docs/misfits-repairs/2026-10-29/integration/replay-H02-diagnosis-v1/p2-cross-machine-handoff-2026-11-10/restore-vendor-captures.mjs .
```

The script reads the source from the installed Node runtime. It checks the original hash before writing any missing capture. It neither changes recorded hashes nor runs a receiving witness. If the hash differs, keep the evidence missing and use the matching runtime. Do not treat this export as a fully bound source packet before restoration and the normal binding checks.

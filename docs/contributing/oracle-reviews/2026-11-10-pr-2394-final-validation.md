# PR 2394 integrated validation

This record follows merge head
`0e86c1fdae85520aff142f141f71ccf46a8ee8bd`, with target main
`858c8f0bf747e80f07d2fd6b10d8050bd0c84f8b`. Exact repaired source SHA256:

| Source | SHA256 |
| --- | --- |
| Query | `1a794774e60d3c1dbacd515d0350b048557714adf80d6e3b9d42e7250841754b` |
| PowerSync | `c4960f0c00aae28400de1811285458995c5b61591bd7ce42353f99ad6ab47068` |
| RxDB | `c78f7409f9e539a6bf575718f36a91309c191b18638be29a7d87b481914e65f7` |
| TrailBase | `a0608813edaa2bc966ca6fbdbeb747b9fc6fbd8dd08a9c6edabbfe75288d2cd7` |

The [first review](2026-11-10-pr-2394-external-review.md) retains all ten raw
findings: five fixed, two refuted and three accepted under the contract then
in force. The [re-review](2026-11-10-pr-2394-rereview.md) retains all ten raw
findings: six fixed, two refuted and two accepted. Those historical verdicts
and counts remain intact. Maintainer steering subsequently required ordinary
startup commits, superseding the earlier accepted forced-snapshot cost.

The [batching extension](2026-11-10-persisted-startup-batching.md) demonstrates
work-law RED before source edits, then correct rows and bounded commits on
controlled persistence, native SQLite and actual Chromium worker/OPFS. The
[Query extension](2026-11-10-query-startup-receiving-gaps.md) separately exposes
and fixes a same-run direct value missing from the saved baseline. Both fixes
have generated histories, receiving evidence and original-defect controls.
The [hydration lifecycle extension](2026-11-10-persisted-baseline-lifecycle.md)
preserves cleanup, reload, terminal failure and accepted-work obligations across
the new continuation. These are distinct laws and share no production-derived
expected result.

## Final local checks

The full Query package oracle command passes 1,663 tests in 38 files, with
no skips or type errors. The command is:

```sh
pnpm --config.verifyDepsBeforeRun=false --filter @tanstack/query-db-collection test:oracles --maxWorkers=1
```

The final metadata check passes all four selected registry/owner/directory
assertions in `packages/db/tests/oracle-replay.test.ts`. The other 114 tests
are outside this selector; the earlier complete 118-test run remains separate.
Both primary PowerSync/RxDB replay commands execute exactly one requested
property, campaign seed `2118` and path `0`, through `oracle-replay.ts` using Node 24.22.1
and one fork. Both return the matching owner, coordinates and nonzero witness.
These replays do not replace their normal campaigns in the linked records.

Strict TypeScript checks pass for PowerSync, RxDB, adapter conformance and
browser persistence. Core DB also passes with `--rootDir .` from the repository
root: its included Vite config imports a root-level build script. The initial
package-root check reports TS6059 for that config import; no source edit is
needed for the repository-root check. Source ESLint, production builds, `pnpm lint:changed`,
the shrinking legacy-campaign check and `git diff --check` pass. The legacy
check reports no additions. Formatting repairs affect only presentation.
The new browser receivers have a separate E2E matrix group so their runtime
does not consume the existing browser group's timeout.

Production size comparison against main `858c8f0bf` reports core DB zero,
Query +53 gzip bytes, TrailBase +71, RxDB +245 and PowerSync +269. Combined
growth is 638 gzip / 613 brotli bytes. The typical app changes +58 gzip / -40 brotli
bytes. The implementation reuses existing source loops and lifecycle fences;
scope/exhaustion information prevents a wrapper-only omission sweep. The
batching record explains the remaining source-weight cost. Test and document
growth does not ship in these bundles.

The [post-repair benchmark](2026-11-10-persisted-startup-measurements.md#post-repair-experiment)
completes 64 fresh processes, 48 measured and 16 warmup, with no competing team workers.
An independent CSV recomputation confirms all eight cells and their medians,
and zero repaired startup snapshots/truncates. The earlier 112 observations
remain a separate historical experiment. The results retain measured small
overheads and do not establish universal performance preservation.

## Mutation evidence and unresolved decisions

The [conversion audit](2026-11-10-startup-property-gap-retention.md) retains all
55 earlier stable kills. The [primary eager conversion](2026-11-10-eager-source-primary-conversions.md)
retains twelve selected RxDB/PowerSync kills. The Query changed-callback audit
records 24 kills and 11 survivors; separate receiving extensions subsequently reject
the four retired-position mutations and the missing sync-write operation.
That additive evidence does not rewrite the original CLI score.

Six anchored Query survivors remain: M1314, M1327, M1328/M1330/M1332 and M1474,
as described in the [callback inventory](2026-11-10-query-changed-callback-gap-audit.md).
TrailBase M151 remains the post-hydration cancellation guard survivor. The
authored PowerSync/RxDB live-iterator alternatives also survive on all three
hosts; their copying alternative is not proved necessary by these histories.
No maintainer allowance is presumed. A coverage-map entry or an equivalence
argument does not close these gaps under AGENTS.md.

The [final changed-adapter audit](2026-11-10-final-adapter-changed-code-gap-audit.md)
completed 52 of 110 selected automatic operators before discovery stopped:
22 kills, 18 survivors, one crash, ten timeouts and one unreached operator.
The remaining 58 are unrun or interrupted. Eight authored controls are killed;
the two authored live-iterator alternatives remain survivors. These outcomes
are separate from the normal campaigns and prior retained kills. No new
production defect is proved by the supplementary sweep.

Together with the six Query and one TrailBase survivors above, the final audit
leaves 27 anchored survivors requiring a maintainer decision or additional
enforcement evidence. Runtime failures and unexecuted operators are not kills
or allowances. Pushed-head CI and the explicit gap decision remain separate
gates. This record makes no PR-readiness claim while those gates are open.

Local installation recovery remains uncommitted: query-core 5.107.1→5.106.0,
fake-indexeddb 6.2.8→6.2.7 and tailwindcss/postcss 4.3.5→4.3.4. Workspace override
and lockfile hashes remain `ef167cca76c028d75a96818c987373ef213c8fff152ae4ff5aa43da3adea79b5`
and `597c414dc296075582b34c76d10e71caac19d57a33b81a97f74f79ec10b225e1`.


## Integration with the later main migration

Main `50e6015c8b954c872125d410dfaace43d80161db` landed after publication of
`af50717a7` and the whitespace-only autofix `5bb88d40e`. The integration keeps
main's shared eager-source grammar helpers, tagged-value registration and new
framework dependency pin `f4d5a0e`. It retains this branch's PowerSync, RxDB and
TrailBase receiving registrations, constructed histories, comparisons, run
budgets and real-browser paths. Both paths share the same independent model
and original comparison. No adapter production source changes in this merge.

Central metadata preserves both sets of owner additions and legacy removals.
The legacy list is 105 entries. An executed three-way comparison of 898 manifest
entries found no missing or accidental change. The three intentionally retained
branch selectors name PowerSync, RxDB and TrailBase random-seed registrations.
The narrow TrailBase Chromium metadata check authenticates its full existing
property ID, exact owner file and registration call. Four metadata checks and
targeted lint pass with the exact new framework dependency.

The shared conformance TypeScript check and the normal TrailBase eager suite
pass (119 tests). The integrated RxDB eager/startup/lifecycle run passes 281
tests across three files. PowerSync and pushed-head integration checks remain
in progress at this record's checkpoint. Earlier finite coverage and the
explicit mutation-decision limits above remain applicable.

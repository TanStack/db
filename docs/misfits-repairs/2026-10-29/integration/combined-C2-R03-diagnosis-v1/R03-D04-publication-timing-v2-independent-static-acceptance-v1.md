# D04 publication timing v2: independent exact static acceptance

Reviewer: `/root/review_combined_held_cuts`. Author: `/root/evaluate_replay`.

**Accept exactly one `D04-isolated-publication-timing` invocation**, under root's existing conditional authorization, slot3, one worker, 120-second process timeout. After the invocation freeze and STOP regardless of outcome. This exact acceptance and root's instruction together admit that one invocation, without another root roundtrip. No reviewer execution occurred.

## Frozen identities

The exact packet directory is `/Users/kyle.mathews/programs/tanstack-db/.worktrees/codex-misfits-survey-open-items/docs/misfits-repairs/2026-10-29/prep-pr/replay-batch/evaluation/initial-preload-repair-v1/r03-lifecycle-publication-timing-d04-v2`.

| Artifact | SHA-256 |
| --- | --- |
| Packet freeze | `e793994774df68a02ab5d3310bd89227fe3069fb9c735707dbfd9711ca6892d9` |
| Input freeze | `60304f1b4606f7a7699bd8cba82884ca328c5f6b726430eb15db9154903711a9` |
| Applied primary and candidate | `67d8fe387d33322a8bfc51c96dcc789fa7b05793728a70c3156bcea70c0308ee` |
| D03 base | `0618b4aad166dc6c613ed00df526dc9eb34ab3243e2eb2cafee35115bd7267c0` |
| Complete observation-only patch | `7b21020b7de0e3af47605f8c786e57c81abc89866ec28d55f8b3e7b72bedbe36` |
| Runtime recipes | `dc52e1c423e5c973ec706a1f4a99bce9ca29c9f16f999799eb65bfc354055582` |
| Launcher | `9d7aa0fe88c649c3242ad26e928c94fadc4dc60167c734e6b5e228e685cadc16` |
| Archive resolver | `6799d0f221d208bb80d0e5cb6d5c0f2345f4dee82e95d5adec33d57480cef87d` |
| Exact archive map | `5d176b2fb6fa3f17e4f93047750902df1ccae309b23004b6170ddcf8bff4712a` |
| Saved resolver calibration | `4a80925e5a1a18a9a0a5f593708360f11203f9c8faf965e3815fc992ec515c60` |
| Root conditional authorization | `b99c440e23e40cbea1434a82bddba169592b7c1b35cb6f37b07683315d5eb7b0` |
| Static closeout | `fc2bf3797c8393d0ee29cdd4f93928005a6f29dcf47c475f2e137af623ca64cd` |

The author worktree is `/Users/kyle.mathews/programs/tanstack-db/.worktrees/codex-misfits-replay-latest-main-v3`. Current HEAD and the input freeze agree at `9cfa11fc712866f8f276e85762865ebb8bd49cbe`. Production identity remains `60d0fa772d95a340042bf3776c67da573cd407ded732dcb4d7f776f5da339a42`.

## Independent integrity and erasure

All 24 packet members match. All 1,415 current inputs match their new freeze; exactly one differs from D03, `packages/db/tests/query/load-subset-replay-refinement-oracle.test.ts`. The other 1,414 inputs and all 511 production inputs are unchanged. The current primary and candidate snapshot match exactly.

I independently applied all 13 documented exact transformations to the D03 base, then reversed them in reverse order. Both complete-file reconstructions match byte for byte. Each matched source template is unique. Independently generated `difflib` output equals the saved complete patch. The additions therefore erase to the full accepted D03 source, not merely selected blocks. Models, histories, comparisons, expected values, reaches, assertion conditions, budgets, existing source statement order, callback wiring and registration names remain unchanged. In particular the known overstrong rejection snapshot assertion is preserved.

The initial v1 formatting failure is retained. Its saved receipt has exit1 with unchanged before/after maps and empty oracle environment. Comparing v1 and v2 candidate bytes shows only two line wraps inside the new observation expressions. The final v2 checks below supersede that formatting preimage; it is not runtime evidence.

## Observation inertness

The public helper is defined immediately after `const live = query()`. It reads `live.toArray` and selects only scalar `id` and `rank`, plus the public `live.utils.getWindow()`. It does not traverse include arrays, Collection facades, or nested values. In this finite fixture those selected fields are ordinary data properties. The production public read path is `toArray -> values -> getWithVirtualProps`; it reads existing public state and may reuse/fill the ordinary virtual-props cache. It starts no sync, source acquisition, subscription, graph job, or demand. The getter for `getWindow` returns a fresh scalar projection of `settledWindow ?? initialWindow`; it invokes no callback or mutation. The added reads do not turn applied source settlement into graph-completion evidence.

The existing `subscribeChanges` callback gains a guarded diagnostic call. No subscription, listener, owner, adapter, production delegate, status handler or Promise observer is added or replaced. Its existing initial-window recorder follows in the same order. The diagnostic selects public scalar values, which does not acquire an include facade. The callbacks remain synchronous and contain no added await, timer or scheduling call.

The helper's earlier textual references are inside callbacks that execute after its initialization on this history: the ordinary fault resumes after a held await, ordinary applied coverage resumes after the establishing commit await, and the immediate adapter branch runs only for the later authored union request. The public-change subscription is installed after the helper. The own-period recorder also executes after live construction. I found no new temporal-dead-zone or startup source-work path.

The account helper projects only authored barrier source/raise clock and existing pending/failed load identities. It mutates no barrier, obligation, receipt, model rule or comparison. `identityOf` can allocate diagnostic-only IDs in its WeakMap/counter; those numbers are observations, never verdict inputs or expected-value choices. Added observation sequence numbers may likewise change without changing the exercised law. These account facts remain distinct from actual public rows, adapter fault/application notices and native replay settlement.

The new records cover baseline capture, existing ready entry, the pre-union record, existing applied/fault/own-receipt observations, callback return, rejection and the existing public-change callback. There is no new production fail/succeed hook or claim that adapter/model notifications observe native completion. This is an adequate bounded diagnostic for locating a public transition if it occurs; static review guarantees neither its reach nor its outcome.

## Launcher, selector and archives

Replacing only the D03 immutable label with `D04-isolated-publication-timing` reconstructs the entire D04 launcher from accepted D03 launcher `ffe8edcf40b2f7581821493eeb3a2be447c08235920bffa1c3886a547e05894c`. The independently reconstructed label-only patch equals the saved patch. All input/report/admission/packet checks, one-shot reservation, empty-environment requirement, timeout, process-group cleanup and before/after hash checks remain unchanged.

D04 argv is identical to D03 and D02 argv. A reviewer data-only native JavaScript RegExp check against the frozen 90-name dynamic inventory again matches exactly the intended truncated full name and excludes89. It does not execute or list tests. Actual runtime must still establish one selected, 89 skipped, 90 registered and one complete intended payload.

All 37 D03 predecessor bindings are preserved exactly; all 57 D04 direct bindings verify. An independent exact-path reconstruction checks 166 recursive member occurrences, including D03 result members. The resolver, map and saved calibration bytes equal their accepted D03 assets. Unknown missing paths and hash mismatches retain fail-closed behavior; no historical executable `.test.ts` mirror is restored. I parsed launcher/resolver/static-runner syntax without importing or executing them. Their unchanged archive calibration remains saved evidence, not a reviewer rerun.

## Individual saved static receipts

| Check | Receipt SHA-256 | Saved exit | Saved seconds |
| --- | --- | --- | --- |
| Format | `cc3ae2edda58fba8dee49ca12e8c371362e5780d9a2d524c439f485917d9ebc4` | 0 | 0.613 |
| Types | `850e3995d25990cd5a2c7cb4cb71275fae8395f5bd9b452f7099d5d05776e933` | 0 | 14.950 |
| Changed lint | `0d8a7f4983e751024317c57a2fe75628c590e887a20fe1cfa097475ca8222f11` | 0 | 42.099 |

I checked each receipt's exact command, cwd, slot3, input-freeze hash, empty saved oracle environment, and both complete 1,415-entry maps against the freeze. Each log hash and duration agrees with its receipt/closeout. The unchanged static runner records no exception or process-group census fields; no such observation is inferred from their absence. These are author executions, not reviewer reruns.

At the final pre-acceptance verification D04 had no admission file and no runs directory. Reviewer work used read-only hashes/text/JSON, independent patch reconstruction, AST parsing, source reading, current HEAD read, and data-only regex evaluation. No test, listing, compiler, lint, build, generator, mutant, launcher, source import, source edit or Git mutation occurred. This immutable report is the sole write for this D04 review.

## Exact one-run admission and STOP

The author may create admission binding this report and run exactly once:

```text
python3 <D04 packet directory>/run-corrected-isolated-diagnostic.py D04-isolated-publication-timing
```

Underlying cwd is the author worktree's `packages/db`; underlying argv remains:

```text
pnpm exec vitest run tests/query/load-subset-replay-refinement-oracle.test.ts --coverage.enabled=false --maxWorkers=1 --silent=false --reporter=verbose -t "records replay lifecycle cut for .*covering replacement after own freeze"
```

Resources: slot3, worker1, 120 seconds. Preserve the entire raw log, receipt, all payload observations/public callback occurrences, exact chronology, input/environment/group facts and immutable result freeze. Do not select only convenient callbacks or infer native settlement from authored receipts. The existing assertion may fail again; its failure must remain visible. An unexpected exit, selection failure, incomplete payload or missing premise requires classification, not a retry or a production RED claim.

After that one invocation **freeze and STOP regardless of outcome**. No retry, rewiring, source/model/expectation/comparison/history/reach/budget change, campaign, sensitivity run, mutant, production step, commit, push, publication or PR step is admitted. D04 locates the public transition; it does not choose contract authority, repair evaluation or establish native Promise settlement.

The accepted authority reconciliation `c6a3edeb306ee07db78d6edee65728c5c7a6cffe82fb21c5c96ea021caa21ab4` and independent reconciliation `a21411b100886f14859d36f1cffc916be1bc44bb99d7574a538cd386949e80b6` already distinguish a frozen completion Error from the still-open authoritative publication replacement. Original R03, D01, D02 and D03 outcomes remain preserved with their separate addenda. No generated closure, natural-controller selection, distinct-window leakage guarantee, receiving/minified coverage, exact native settlement, broad correctness or PR readiness follows from this acceptance or the prospective finite result.

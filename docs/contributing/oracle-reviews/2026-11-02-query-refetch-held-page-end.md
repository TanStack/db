# Query DB refetch under a held optimistic write

This is an author self-review, not an independent external review. The base is
`30e85464ed2b9b12c5f10981a062427a1fc8daaa`. The source hashes below bind the
review to the executable change in this commit. Later semantic edits need a
new review entry.

This entry records the original 03a7 implementation. The
[nine-item review](2026-11-02-query-refetch-nine-item-review.md) supersedes its
report-reason classifier, constructive grammar, reach claim, and local commands.

## Law and repair boundary

After an autonomous ordered Query refetch or Query invalidation reaches its
fixed point, the public window must equal the backend model's window. Every
backend row through that window's end must exist in the source Collection with
its current values. A short window requires the whole source. When a persisting
optimistic transaction holds accepted sync rows back, that checkpoint moves to
its release.

Authority: `LoadSubsetFn` in `packages/db/src/types.ts`, the ordered requests
and recovery section of `packages/db/src/query/live/ARCHITECTURE.md`, and the
existing Query DB ordered refetch coverage-map owner. The model and public
comparisons in `refetch-ordered-prefix-oracle.test.ts` remain unchanged.

The bounded defect class is a finite cursor page whose keys stay the same but
whose end moves earlier during an optimistic update or delete. Query DB used
to return on equal keys before checking the page end. A held delete can hide
the visible order update that normally starts core repair. Releasing the
transaction can then leave a row between the old and new boundaries unloaded.

The adapter now checks an earlier end independently of key changes. The
separate later-page condition still requires changed keys. Its acquisition
loop guard and one-report-per-burst coalescing remain. The repair adds no
state, retry, or fallback.

## Histories, receiving path, and observations

The original CI history came from workflow 41488658483, collections job
125425547426, at `39a8d2dde37cec3e6d774671e847647011ed6db1`. It failed the
coverage comparison after release step 6 with row `{id:2,rank:2,label:"a2"}`
absent from the source Collection. Its replay inputs are:

```text
property=query-db.refetch-ordered-prefix
seed=1661743421
path=37:0:3:2:4:7:11:10:9:9:5:3:3:5:8:9:0:0:4:4:2:5:3:4:2:6:5:5:5
```

The exact reduced history is retained as input to the shared model, production
driver, and comparison. A new constructive property,
`query-db.refetch-held-page-end`, makes all initial rows unmarked so the
LEFT-joined window reads through the source. It holds row 0, invalidates the
cache, moves row 0 earlier with its key unchanged, inserts a row in the gap,
refetches or invalidates, and releases the hold.

Its grammar varies static/function Query keys, one/two order terms, update/delete
holds, explicit refetch/Query invalidation, and gap ranks 1–3. It uses an uncapped
cursor provider, numeric order, limit 1, and offset 0. The old 80 fixed and 80
random histories, plus the 40 held histories, remain. Each new campaign runs
24 histories, with fixed seed 20261102 or a fresh random seed. Both require
24 histories to reach `earlier end during hold`.

This is the real QueryClient, `queryCollectionOptions`, indexed source
Collection, and LEFT-joined ordered live-query Collection under jsdom. The
controlled provider returns exact request answers. The ordinary public
comparison checks window IDs and source row values at preload, refetch,
invalidation, and release. The recorder now recognizes a changed answer by
full row values, and measures equal keys and an earlier end separately. It
does not compute the expected window from production page metadata.

Grammar controls:

- Reconstruction: the exact CI trace and a shorter generated gap use the same
  commands and comparison. The fixed campaign reconstructs the new premise.
- Ablation: removing the hold permits an ordinary visible order update to
  repair the gap. Removing the same-key relation exercises the older report
  path. Removing the arrival loses the latent omission. Removing the earlier
  end loses the premise. Key forms and refresh forms exercise distinct adapter
  entry conditions. Order arity challenges finite continuation and ties.
- Range: gap ranks 1 and 3 lie strictly between the old and new ends. One-term
  fixture ranks include the ID, while two-term ranks use an ID tie-breaker.
- Exclusion: the constructor admits one hold on a loaded row, followed by its
  release. It does not construct a hold on an absent row, overlapping holds,
  a gap outside the two ends, or a provider that ignores the cursor.

## Executed evidence

Local logs and their SHA256 bindings reside under
`/private/tmp/callback-metadata/ordered-refetch-failure-20261102/`.
`final-binding.json` records the final source and log hashes.

Before the first production edit, `extended-red.log` records three public
coverage assertion failures: the retained CI history and both new campaigns.
`pre-edit-neighbors.log` records 34 passing neighboring tests. The pre-edit
receiving inventory is in `pre-edit-gate.md`.

After main advanced through #2316, the isolated branch integrated main
`30e85464e`. Its query adapter and failing owner were unchanged. Restoring
main's original adapter produced the same three intended coverage failures in
`current-main-red.log`. Neighboring tests again passed in
`current-main-neighbors.log`. This hostile original-defect mutant failed at
the public comparison, not during setup or by timeout. Repaired production
was restored afterward.

The first repaired run passed row comparisons but failed new reach because
the initial grammar also generated locale-string order. That path uses
full-source acquisition and cannot reach the finite-page premise. The new
grammar now constructs numeric order only. The general campaigns retain
locale strings. `first-green.log` records that intermediate reach failure,
and `reach-debug.log` records the diagnosis. Public row comparisons, reach
minima, the existing grammar, and existing run budgets stayed unchanged. The
report-reason classifier did broaden from changed keys to any changed value.
The nine-item review identifies and repairs that separate false-green gap.

Final results on the inline production form:

| Check | Result |
| --- | --- |
| Full owner | 40 passed, including two existing expected-failure limits |
| New fixed/random reach | 24 / 24, minimum 24 in each campaign |
| General fixed reach | continuation 39, hold 54, report over full window 20 |
| General random reach | continuation 39, hold 41, report over full window 14 |
| General reach minimum | 3 for each state in each campaign |
| Focused TypeScript | Pass |
| ESLint | 0 errors, 2 existing `no-shadow` warnings |
| Replay-routing suite | 70 passed |
| Guarded replay of each property | Pass, one selected test and two fast-check runs each |

The guarded new replay uses seed 20261102 and path `0:0:1:1`. Both guarded
replays run directly without the fixed or full random campaigns. Their final
logs are `final-guarded-new-replay.log` and `final-guarded-ci-replay.log`.
Local Vitest is 3.2.4. CI uses 4.1.12. No dependency installation or override
was used. Full local `pnpm test` was not run.

The historical local owner runs use the saved `repair-vitest.config.mjs` in the evidence
directory. It selects the named owner, aliases workspace sources, and uses one
worker. With `E` set to that evidence directory, the GREEN command is:

```sh
pnpm_config_verify_deps_before_run=false node node_modules/vitest/vitest.mjs run --config "$E/repair-vitest.config.mjs"
```

The pre-edit RED command selects the retained history and new campaigns with
the same configuration and unchanged production:

```sh
pnpm_config_verify_deps_before_run=false node node_modules/vitest/vitest.mjs run --config "$E/repair-vitest.config.mjs" -t 'keeps coverage when a held page|generated same-key page shifts'
```

The guarded replay command uses the property, seed, and path above:

```sh
TANSTACK_DB_ORACLE_PROPERTY=query-db.refetch-held-page-end TANSTACK_DB_ORACLE_SEED=20261102 TANSTACK_DB_ORACLE_PATH=0:0:1:1 node --import tsx packages/db/tests/oracle-replay.ts --config "$E/repair-vitest.config.mjs"
```

Focused types use `tsc --project "$E/repair-tsconfig.json"`. Oracle lint uses
`pnpm lint:changed`. These configurations and all bound logs remain in the
evidence directory. The standard package runner in CI supplies its own
workspace resolution and Vitest version. Current reproducible commands use
repository-owned configurations in the nine-item review.

Production size used `pnpm size:compare --base 30e85464e --exact-base
--packages query-db-collection --files` with production gzip-9/Brotli-11.
The first guard-only form grew package gzip by 16 B and typical-app gzip by
10 B. Inlining the single-use later-page helper reduced that to package gzip
+5 B, package Brotli +1 B, typical-app gzip 0 B, and typical-app Brotli −18 B.
Other app scenarios grow by 0–6 B gzip and some grow in Brotli. The remaining
package growth pays for the earlier-end check without the invalid equal-key
gate. Further speculative control-flow changes would broaden this repair.
Test and contract documentation growth is separate from shipped bytes.

## ORC self-review

| Requirement | Outcome |
| --- | --- |
| ORC-001 | Existing LoadSubset and ordered-prefix contract supplies authority. The finite cursor/held-write boundary and limits are explicit. |
| ORC-002 | Pure backend sorting and coverage recomputation remain unchanged and independent of the adapter's page classifier. |
| ORC-003 | The owner retains its contract, model, grammar, driver, and comparison prose. The new grammar explains its finite-page premise beside the code. |
| ORC-004 | Reconstruction, ablation, numeric range, and invalid nearby histories are accounted for above. Sampling does not establish every Cartesian combination. |
| ORC-005 | A real QueryClient and real core receiver reach the public comparison. The missing gap row is deliberately absent from standalone page answers. The invalidation report requests the additional source facts before the release checkpoint settles. |
| ORC-006 | Original adapter restored on current main fails all three intended coverage assertions. Repaired source passes. |
| ORC-007 | New fixed/random campaigns share grammar, driver, comparison, and budget. Both named guarded replays execute directly. |
| ORC-008 | No reference-model state changed. Answer history is recorder state needed to distinguish equal keys from changed values. |
| ORC-009 | Backend rows, source Collection, optimistic transaction, boundary, and release use glossary terms. The model-only marker set represents the local LEFT-join filter. |
| ORC-010 | Shared failure handling retains the primary comparison error and separate cleanup errors. The original reduced trace is retained with its checkpoint. |
| ORC-011 | No new shared semantic fault hypothesis requiring a second formulation was identified. The existing independent top-k and source-prefix judgments remain. |
| ORC-012 | This versioned self-review binds the source, records each requirement, and bounds closure. No independent external review is claimed. |
| ORC-013 | An actual equal-key earlier-end witness rejects the misplaced key-change prerequisite. Existing unchanged-backend and page-loss controls constrain unnecessary reports. |
| ORC-014 | Evidence is limited to the controlled provider with real Query/core execution under jsdom. No external provider or browser-process handoff is claimed. |
| ORC-015 | Both new campaigns reached 24 of 24 required histories. Existing three-state minima and all prior run budgets remain. |
| ORC-016 | The added fixed history has no expected answer of its own. It replays the shared model and comparison, and the grammar is declared. |

## Limits and source binding

The repair closes the demonstrated equal-key gate defect for the exercised
finite cursor histories and release checkpoints. It is not a universal proof.
No new required public receiving path is represented only by a fake core
receiver. External servers, interval/focus/reconnect scheduling, persisted
follower tabs, framework commits, Effects, and arbitrary host scheduling remain
outside this evidence. The coverage-map owner's existing offset-only,
page-capping, in-hold window, and overlapping acquisition limits remain.
No known counterexample remains open inside the declared bounded repair class.

SHA256 source bindings:

```text
query.ts: 1c5eff1f47d474baa132b1f6a7f4cb5127784737d5fa0bab0fe3b95ca8607b1e
refetch-ordered-prefix-oracle.test.ts: 14686819bd621e4769a313f2c1ff16098ded19ecea113be5c6a41b80b7215249
oracle-config.ts: ddf404340ef1669b193fe48599058052283202b819ed9a7c70d655775be4910e
oracle-replay-manifest.ts: 073cad548a84a77318468dc513015894bf15059358699cf4dfc749ef29cc1f19
```

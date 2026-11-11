# Generated construction reach enforcement

This follow-up audits the four converted owners on `9ef5794755deb114fb93c059ed4f082af947a727`. Production and framework pin `e1fb504` remain unchanged.

## Law and missing enforcement

Every constructed history must enter every state named by its builder. The authority is ORC-015 and the `histories.constructed` contract. The pinned framework associates seeded construction results with their builders, but does not associate fresh results from later generated draws. A printed campaign count cannot enforce those later obligations.

TopK's five properties and OP-SQLite's three properties now remember the declared requirements on every builder invocation, including generated and shrunk results. Their models carry these requirements separately from the existing product predictions. Their shared checks first judge the original product observations, then compare the required states with independently recorded actual reach. The original arbitrary languages, seeded examples, fixed regressions, production paths, laws and run budgets remain.

The TopK relation resolver retains its source history only to carry these model obligations into the resolved plan. Its three numeric-history registries each have one builder, so equal numeric keys cannot replace different state requirements. Fresh object and alias-array histories retain separate identities. No requirement is inferred from the observed trace.

Preact's finite bound-options owner already checks every required observation and expected state. Its window-render owner instead accepted an empty trace because its check loop judged only observations present. The repaired shared check requires the ordered initial, committed and aborted cuts, followed by both declared state observations. It judges any recorded row, reference, render-attempt or acquisition mismatch first. Its missing-completion checkpoint is not a recorded product checkpoint, so a later driver exception remains a runtime failure under the framework's failure-fidelity rule.

## RED and calibration

New reach-only corruptions made all five TopK and all three OP-SQLite calibration tests fail against their old comparisons: each comparison accepted the omitted observations. Preact's new empty-trace and reach-only controls separately failed against the old window check. The permanent controls reuse each property's shared comparison.

Two temporary production-driver controls preserved the seeded constructions' reach and suppressed only later reach observations. With the old semantic comparison they passed. With the repaired check they failed by named comparison:

| Property | Seed | Shrunk path | Rejected law and checkpoint |
| --- | ---: | --- | --- |
| `ivm.topk-batch-relations` | 409033 | `2:0:0` | `constructed reach`, `completed` |
| `op-sqlite.write-marker-aliases` | 165903 | `4:0` | `constructed reach`, `query settled` |

The omission controls were removed and the final source restored byte-for-byte before closeout. These are test-mechanics REDs, not production defect or mutation-preservation claims.

## GREEN and scope

From the relevant package directory, with `pnpm_config_verify_deps_before_run=false`:

```sh
../../node_modules/.bin/vitest run --config vite.config.ts tests/operators/topk-batch-contract-oracle.test.ts --maxWorkers=2 --coverage.enabled=false
../../node_modules/.bin/vitest run --config vite.config.ts tests/window-render-oracle.test.tsx tests/bound-options-oracle.test.ts --maxWorkers=2 --coverage.enabled=false
../../node_modules/.bin/vitest run --config vite.config.ts --maxWorkers=2
```

Results: TopK 27 tests, Preact 93 tests, and the full OP-SQLite package 306 tests pass, with no type errors. The RN command retains coverage and typechecking. All original TopK base run budgets remain 25, all RN base budgets remain 50, and all 12 Preact window cells remain six histories per campaign. Each Preact cell reports seven entered histories for each state in both campaigns.

ESLint, Prettier and `git diff --check` pass. `pnpm lint:changed` exits 1 with two branch budget reports: `preact.window-render` removed its old six-run key, and OP-SQLite removed the old 20-run meta calibration at seed 165903. The Preact key is replaced by 12 separately registered cells, each retaining six runs. The RN calibration moved unchanged to an ordinary driver test. These earlier conversion changes are explained in their owner reports; this follow-up lowers no budget.

The finite bound-options check remains unchanged. The new requirements supplement the existing product judgments; they do not change row equality, alias key order, source reference identity or work-count expectations. The final-source comparisons below retain all prior killed stable keys for TopK, Preact and RN. Device/JSI execution, arbitrary framework schedules and changes to the external framework remain outside this bounded repair.

The [companion evidence](2026-11-10-constructed-reach-followup.json) records the exact source hashes and every normal-run state count. The ignored worktree evidence directory additionally retains the commands, raw logs and temporary control sources.

## Native failure-fidelity controls

Review at `d8a04010610db9cd1afbd04e271ae461fe5c3dbd` challenged whether a missing constructed state could hide a later production-driver error. All three owners already use unrecorded completeness checkpoints: TopK `completed`, RN `query settled`, and Preact `render completed`. Their real production drivers never record those checkpoint names. No source repair was needed.

An isolated Vitest control imports all 20 actual owner registrations: five TopK properties, three RN properties, and 12 Preact window cells. It uses each property's arbitrary, first constructed builder, model, production driver and shared check. Seed 51719 supplies one generated input per property. The control changes Vitest registration only, then invokes the native pinned framework's case callback in three modes:

- The actual production driver records every product observation, suppresses reach records, then throws a sentinel error. The native framework rethrows that exact error object.
- The same wrapper also omits the final product observation, then throws. The exact sentinel remains the failure.
- The wrapper corrupts the first recorded product observation, suppresses reach records, then throws. The native framework reports the earlier semantic violation at that recorded checkpoint and retains the exact sentinel as its cause.

All 60 controls pass with the unchanged owner sources. Each clean history also passes its shared comparison. These are failure-fidelity controls over observed traces, not production-mutant kills. The companion evidence records every property, checkpoint and result. Durable control source, configuration and raw output are under `.cache/oracle-conversion-recovery/integrated-reach/fidelity/` in the integration worktree.

## Final-source Preact mutation parity

The cold final-source run at the reviewed head above uses framework `e1fb504`, prefix `TANSTACK_DB_ORACLE`, seed 2291 and one context. It selects every one of the 18 prior killed stable keys from the committed bound-options comparison, plus four earlier same-anchor siblings. The siblings preserve the pinned CLI's stable-key suffix numbering in a filtered run.

All 18 exact prior keys remain killed by product laws: `bound options`, `source update rows`, `ordered window rows` or `outer window retains Collection`. None relies solely on reach, framework checks or an unnamed verdict. The four selected siblings yield two survivors and two runtime crashes. The run has zero nondeterministic tests and no key mismatch. It computes 51 evidence units, reuses none, and cuts or reruns none. This is a prior-kill preservation run over 22 selected mutants from the full 48-mutant source census; it does not reclassify the omitted mutants.

The final report SHA256 is `d5445681c3a609709da922cd367e9d29f0942962c4660c13d3c17adfb730543b`; run identity is `7119561cb3c3`. The companion evidence retains every selected ID/key pair and each prior kill's final laws.

## Final-source RN mutation parity

The cold final-source run at `4eef544dc` uses framework `e1fb504`, prefix `TANSTACK_DB_ORACLE`, seed 165903 and one context. It selects all 29 prior killed stable keys from the committed OP-SQLite comparison. No earlier same-anchor siblings are needed to retain their stable-key numbering.

All 29 exact keys remain killed: 17 by `exact-alias-rows` and 12 by `query-execution`. There are no lost keys, stable-key mismatches, nondeterministic tests or reach/framework-only kills. The run computes 32 evidence units, reuses none, and cuts or reruns none. It checks prior-kill preservation for 29 selected mutants from the full 361-mutant census; it does not reclassify the omitted mutants.

The final report SHA256 is `bf0aeb2271e9d2ded034b1e30484255ab1b3310d3b33f824e3bbb78c86f8a710`; run identity is `842e92957247`. The companion evidence retains every selected ID/key pair and final product law.

## Final-source TopK mutation parity

The earlier TopK report's complete key list was lost with its temporary output. A fresh cold BEFORE run reconstructs it from a full Git archive of `9a5214f2801c2c7918f6fd21ac5add317559322a`. The archived source and historical oracle owners use the same installed `e1fb504` framework and dependencies as the final AFTER run. Both commands specify prefix `TANSTACK_DB_ORACLE`, seed 42, one context and the complete `src/operators/topKState.ts` scope, without a mutant filter.

The recovered BEFORE reproduces the historical counts: 35 killed, 10 runtime crashes and two survivors. Final AFTER at `f1afd2e5ba69137fc7b13306bc2fa9738c43c390` preserves every one of the 47 exact stable keys and every outcome. Each mutant keeps the same package-relative oracle-owner membership. Production under `packages/db-ivm/src/` is unchanged from the baseline revision. All 158 captured final source/dependency hashes remain unchanged across the AFTER run.

Three kills name the converted law `same-key contributions`; the other 32 retain their existing legacy unnamed judgments. All 10 crashes remain crashes, including `M10`; the reach repair turns none into a synthetic law kill. Both runs report zero nondeterministic tests and no cuts or reruns. BEFORE computes 147 evidence units and AFTER computes 146, with no reused units. This establishes preservation over this source census, not closure of its two surviving mutants or ten crashes.

```sh
pnpm_config_verify_deps_before_run=false ./node_modules/.bin/oracle-gaps --package .cache/oracle-conversion-recovery/integrated-reach/topk-before-tree/packages/db-ivm --source src/operators/topKState.ts --env-prefix TANSTACK_DB_ORACLE --seed 42 --contexts 1 --out .cache/oracle-conversion-recovery/integrated-reach/topk-before-recovered
pnpm_config_verify_deps_before_run=false ./node_modules/.bin/oracle-gaps --package packages/db-ivm --source src/operators/topKState.ts --env-prefix TANSTACK_DB_ORACLE --seed 42 --contexts 1 --out .cache/oracle-conversion-recovery/integrated-reach/topk-after-final
```

BEFORE report SHA256 is `882e7a07faaf5260f9bf8388b3cb51da1b79469abf6c05fbf8380b78d4bf27d8`; AFTER is `d815c3b71a4e1201ab084a952f413643415a4d39aa137e46766d176f1c72f834`. Their run identities are `3cc829615ff4` and `6aaaaa85f93e`. The companion evidence preserves the archive hash, exact 47-key comparison and final source hashes.

## Rubric account

| Requirements | Follow-up evidence |
| --- | --- |
| ORC-001–003 | Existing product authorities/models remain; ORC-015 supplies construction obligations. Local prose distinguishes declaration metadata from actual driver observations. |
| ORC-004 | All source arbitraries and construction transformations remain in the original languages. No metadata enters arbitrary history objects. Generated omission REDs shrink within those languages. Existing reconstruction/range/exclusion evidence remains in the conversion records. |
| ORC-005–006 | Actual TopK/graph, OP-SQLite query and Preact rendering paths remain. Missing-state and missing-cut controls reject at the stated checkpoints; earlier semantic controls remain GREEN. |
| ORC-007 | Original fixed seeds and equal-budget random campaigns remain. The temporary omission failures retain their exact shrink coordinates above. |
| ORC-008 | No product state machine changes. New maps contain only constructor declarations and are scoped to the property or fresh history identity. |
| ORC-009 | `requiredStates` and TopK's `sourceHistory` are model-only bookkeeping, not production states. Existing subsystem vocabulary remains. |
| ORC-010 | Semantic checks run before new reach checks. Missing-completion checkpoints are unrecorded, so a driver error cannot be renamed as a missing-state law rejection. Temporary sources restore byte-for-byte; package cleanup tests remain GREEN. |
| ORC-011 | No new shared product-semantic fault or distinct second formulation is asserted. The new omissions specifically calibrate missing observation enforcement. |
| ORC-012 | This versioned report and companion source hashes bound the repaired-source evidence. Final-source comparisons retain every prior kill: TopK 35, Preact 18 and RN 29. The TopK baseline recovery and filtered Preact/RN scopes are explicit above. |
| ORC-013 | Seeded-reach success versus generated-only omission distinguishes the corrected rule from seeded-only checking. |
| ORC-014 | Receiving environments and their limits remain unchanged; RN shim execution is not mobile/device evidence. |
| ORC-015 | Every builder invocation records obligations and the shared check enforces actual entries. Preact window checks both states for every history. All normal-run counts are in the companion evidence. |
| ORC-016 | Added tests corrupt traces for the existing shared comparison; no ordinary examples or separate expected answers were added. |

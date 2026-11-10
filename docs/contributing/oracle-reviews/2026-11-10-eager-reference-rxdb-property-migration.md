# Eager reference and RxDB property migration evidence

Earlier validated source commit: `bb0fb2d8032555f00c2e21f1047778e116571959`. Base: `9a5214f2801c2c7918f6fd21ac5add317559322a`.
The companion [identity-level evidence](2026-11-10-eager-reference-rxdb-property-migration.json)
records all 132 stable mutation keys, immutable source replacements, before/after
outcomes and named verdicts, source hashes, declared-state counts, and log hashes.
This record covers the shared eager-source machinery, reference receiver, and
RxDB receiver. Other receiving adapters retain their legacy campaigns.

The additive calibration-budget repair in the followup source commit is
**pending canonical CI validation**. The earlier package results and complete
mutation pair below apply to their recorded source. They do not establish that
the newly restored 48 searches or final native package checks pass. Static
checks establish the original predicates, budgets and ordered candidates; the
CI handoff records the exact final candidate commit.

## Law, reach, and preservation

The accepted READY, HEALTH, PUB, FID, LIFE, EVID, RETRY, RECON and RENEW laws
remain those beside the independent model in
`packages/db-adapter-conformance/src/eager-live-source-oracle.ts`, based on sync
callback contracts, the glossary, and the dated maintainer decisions there.
The native product model and semantic comparison are preserved. The new property
adapter translates only a genuine `ConformanceViolation` into a named verdict.
An original product mismatch takes priority over constructed-state completeness;
rethrowing the original failure preserves its cause and secondary cleanup errors.

Reference retains 600 generated histories per fixed/fresh campaign; RxDB retains
400. Constructed recipes keep generated rows and suffixes and provide five
constructions per declared state. Literal replays do not supply required reach.
Every builder invocation registers its own fresh history's declared obligations;
only the shared production path records actual entries. Resolution transfers
obligations, never observations. Ablations retain only their positive-control
state obligations.

The final narrowed clean RxDB run recorded these histories per state; every
minimum is five. Full reference and variant counts are in the companion JSON.

| State | Fixed seed 2118 | Fresh seed |
| --- | ---: | ---: |
| `change-batch` | 265 | 257 |
| `change-before-ready` | 249 | 246 |
| `failure-after-ready` | 150 | 143 |
| `failure-before-ready` | 117 | 113 |
| `field-removed` | 39 | 40 |
| `first-ready` | 362 | 362 |
| `multi-change-batch` | 287 | 283 |
| `read-missed-change` | 94 | 79 |
| `restart` | 152 | 154 |
| `restart-after-failure` | 87 | 90 |
| `seen-change-superseded` | 45 | 51 |
| `value:array:change` | 113 | 122 |
| `value:array:load` | 94 | 96 |
| `value:boolean:change` | 137 | 137 |
| `value:boolean:load` | 108 | 98 |
| `value:float:change` | 119 | 120 |
| `value:float:load` | 89 | 86 |
| `value:integer:change` | 150 | 143 |
| `value:integer:load` | 114 | 118 |
| `value:null:change` | 137 | 128 |
| `value:null:load` | 88 | 104 |
| `value:object:change` | 125 | 113 |
| `value:object:load` | 91 | 90 |
| `value:string:change` | 154 | 145 |
| `value:string:load` | 123 | 105 |

## RED, GREEN, mutant, and replay

The pinned e1fb504 framework loses state associations for fresh constructions
made during generated draws. A temporary generated-only mutant returned a valid
`[{kind: "fail"}]` after its first builder invocation. The old helper falsely
passed its full 600-history fixed-seed campaign. The repaired helper rejects
`constructed reach`, missing `restart` and `restart-after-failure`, at seed 2118,
path `100:0:0:0:0`. Direct replay reproduces the same law and missing states.
The temporary native edit was restored byte for byte. A permanent calibration
removes the required production reach observations and uses the same check.

Earlier narrowed validation at `bb0fb2d803` was GREEN:

| Check | Result |
| --- | --- |
| Reference receiver | 116 tests, 495.17 s |
| RxDB runtime and types | 24 tests, no type errors, 34.09 s |
| Shared harness | 2 tests, 1.07 s |
| Guarded replay and manifest | 116 tests, no type errors, 224.91 s |
| Conformance test types | exit 0 |
| ESLint, `pnpm lint:changed`, `git diff --check` | clean |

Both reference and RxDB use their ordinary package Vitest configurations with
`vitest run --maxWorkers=1`. Files selected were respectively
`tests/reference-adapter-oracle.property.test.ts`, the complete RxDB test suite,
`tests/eager-live-source-harness.test.ts`, and DB `tests/oracle-replay.test.ts`.
RxDB local validation added source aliases for the private minimal installation;
the exact alias/type configurations are preserved in JSON and are not committed.
No dependency version was changed for the paired evidence.

The complete RxDB mutation census ran twice with the same installed e1fb504
framework, `--env-prefix TANSTACK_DB_ORACLE --seed 42 --contexts 1`, selecting
`--package packages/rxdb-db-collection --source src/rxdb.ts,src/helper.ts`.
BEFORE took 796.295 s; AFTER took 751.452 s. All 132 stable keys completed on
both sides, with no excluded or nondeterministic tests. All 66 original genuine
named product-law rejections remain named semantic kills. No reach-only verdict
substitutes for one. First genuine product-law verdicts changed for 35 identities
under constructed witnesses and stop-on-first-kill ordering; those changes are
retained individually. Five runtime-only failures remain separate and are not
credited as semantic kills. All other outcome identities are unchanged.

The earlier string-only calibration extraction omitted six RegExp predicates;
its claimed increase from 40 to 46 distinct pairs was an extraction artifact.
The lossless original tables contain 39 main entries (33 strings, six RegExps)
and eight outage entries: 47 appearances, 46 distinct mutant names. The duplicate
`wraps-loading-failure` is required in both driver configurations. The separate
per-change `reverses-batch` control makes 48 generated searches, each with seed
2118 and a ceiling of 600 histories. The fixed prompt-restart control is a 49th
control. The companion JSON now preserves every exact original predicate and
configuration, including whole-law RegExp matching.

The additive ordinary `reference-adapter-calibration.test.ts` restores those 48
original searches through the same native model, driver and comparison. Native
property calibrations remain supplemental. Static AST equality preserves both
original tables. For every candidate in all 600-history streams for default,
per-change and outage configurations, diagnostics show the original native
arbitrary equals the converted native arbitrary and `fc.sample` follows the
same pre-shrink `fc.check` candidate order. The sample loop stops on the first
accepted law and propagates failures outside the exact `ConformanceViolation`
class. It does not shrink and claims no shrunk calibration counterexample;
product campaigns keep their ordinary shrinking and replay. Runtime validation
of the 48 searches is pending in canonical CI. No local heavy run was started.

The original full RxDB pair remains earlier-source evidence. The additive
ordinary file is outside all 168 RxDB closure files, which remain byte-identical
to the narrowed tested slice. Independent package-discovery and runtime audit
is pending; this is not a claim of a full gap pair on the entire final tree.

## Evidence provenance and narrowing

The original full draft touched 21 files. After the full pair, eight unproven
receiver/config edits were restored and only the shared/reference/RxDB slice was
committed. Static import closure has 168 files; 167 are byte-identical between
the frozen paired draft and narrowed source. The only closure difference is
`oracle-config.ts`: three unrelated Electric/Convex property ID literals were
removed. Reference/RxDB IDs, environment prefix, parameter validation and
`configureOracles` behavior are unchanged. The model, native checker, property
helper and both tested receivers are byte-identical to the completed pair.
Fresh narrowed validation above checks the final registration/replay surface.

Post-pair checks verified 59 framework files, 3597 archived tracked files,
4329 exact-version runtime package files, both local alias harnesses, and frozen
source/diff hashes. After source commit, all 13 final source/support hashes still
match validation. The raw reports and logs remain durably in this worktree's
ignored `.oracle-conversion-recovery/` directory. Their hashes and all mutant
records needed to assess preservation are versioned in the companion JSON.
The original full-draft hash is provenance, not the hash of the narrowed commit.

## Applicable rubric obligations

| Requirement | Evidence or applicability |
| --- | --- |
| ORC-001 | Existing law authority and controlled-boundary limits remain beside the shared model; scope stated above. |
| ORC-002 | Product model and native semantic checker preserved; the property adapter records declarations separately from observations. |
| ORC-003 | Shared oracle and companion property helper explain law, legal histories, production driver, checkpoints and translation. |
| ORC-004 | Reference reconstructs retained Neon/TrailBase witnesses, rejects adjacent illegal steps, and runs each step/value/read-point ablation; bounded keys 1..5, three titles, startup 0..3 batches and suffix 0..12 steps are unchanged. |
| ORC-005 | Reference push adapter and real RxDB adapter entry point execute the shared per-delivery, wait, failure, restart and cleanup comparison. No new missing-input hypothesis is claimed. |
| ORC-006 | Generated-only reach control and permanent wrong-observation calibration fail; all 66 RxDB semantic mutants and previous reference calibrations retained. Runtime failures are separate. |
| ORC-007 | Same 600/400 budgets, fixed seed 2118 and fresh campaigns; exact generated-only seed/path failure replayed; guarded replay/manifest 116 GREEN. No `fc.commands` grammar. |
| ORC-008 | No product-model state is introduced, merged or removed. The helper's declaration map is construction metadata, not a product reference state. |
| ORC-009 | Uses existing glossary terms. Required declarations are model input; actual reach is a production observation, as stated beside the helper. |
| ORC-010 | Native comparison and failure capture preserved; named verdict translation rethrows the original error, retaining cause and cleanup diagnostics. Direct replay retains the same reach failure. |
| ORC-011 | No new shared semantic-fault hypothesis calls for an independent second product model; accepted native model is unchanged. |
| ORC-012 | This source-tied record and JSON preserve bounded repair/preservation evidence. No product bug-class closure or comprehensive production audit is claimed. |
| ORC-013 | Existing boundary laws and reference mutants retained; no new product threshold or broader consequence claimed. |
| ORC-014 | Claim is limited to controlled RxCollection scheduling with real RxDB schema/query matcher/comparator. No arbitrary real-storage handoff claim. |
| ORC-015 | Every constructed invocation retains obligations and independently checks actual entries. Normal state counts recorded above and in JSON. |
| ORC-016 | Fixed histories and reconstruction witnesses use the same shared model/driver/comparison; checker calibrations use wrong observations or hostile reference drivers. |

## Limits

This is a test API migration. No RxDB production behavior changes. The RxDB
receiver uses a controlled RxCollection with real schema/query machinery; it does
not establish arbitrary real-storage schedules, on-demand loading, reload,
mutation handlers, every source path, or universal correctness. The unchanged
24 survivors, 8 timeouts, 28 unreached and 1 unowned identity remain open. Five
runtime-only rejections are not semantic kills. No other receiving adapter has
complete retained migration evidence in this slice.

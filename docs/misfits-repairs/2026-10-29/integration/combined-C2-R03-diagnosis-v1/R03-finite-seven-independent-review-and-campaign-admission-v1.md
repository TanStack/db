# R03 finite seven: independent review and original campaign admission

Reviewer: `/root/review_combined_held_cuts`. Scope: the one finite-seven execution, the two original campaign recipes, and their prepared binding runner. No runtime, source edit, compiler, lint, or generated campaign was executed by this reviewer. Python only parsed artifacts and runner syntax, hashed files, and compared bindings.

**Finite-seven verdict: ACCEPTED. Campaign binding verdict: ACCEPTED.** All seven finite histories reached their intended actual window/error and shared-model identity cuts and passed. The prepared campaign runner preserves the two original recipes and satisfies root's conditional binding prerequisite. Root's conditional admission may now proceed: targeted 120-sample fixed/random command once, inspect its complete result, then original 600 fixed/random command once, serially in slot 2, then STOP. Stop at an unexpected failure. No source edit, mutant, publication, or other runtime is admitted by this review.

## Frozen finite result

Base directory, relative to coordinator worktree `/Users/kyle.mathews/programs/tanstack-db/.worktrees/codex-misfits-survey-open-items`:
`docs/misfits-repairs/2026-10-29/prep-pr/replay-batch/evaluation/initial-preload-repair-v1`.

Finite packet: `r03-post-account-semantic-gate-v3`; runtime members are under `runs/`.

| Artifact | SHA-256 |
| --- | --- |
| result freeze | `35df72b481efe5c41f3e2f781b1a6214c629a221ce9a520b5aa03dc242888913` |
| raw log | `04e683fa2f0449ea4de0a2de44e7f49c663e9c4683f31a36fe878828f8ce1632` |
| runtime receipt | `e61be250e767f5d1ddf2c034521b2ae74bc28cc9e762ca6aec1a41e6eab6f878` |
| all-seven raw payloads | `54e1764102ab88615c940c3d3a0e67eaf578187c1bcb952ad33d0c8ea8cfff3d` |
| per-case classification | `83cf4431182fb0d134d9c1b3c527fdd95ac9f4693534921ee3c705539d255198` |
| closeout | `fcb6e1b23cdcdd84ca06623f9012213bb37ccb5e6f94608f5bf74b0329ca84f8` |
| source/command packet freeze | `201936fd2ea67c5e894c09e953a3f18dbdd1bf880a7a947e23fe2eb9f56cc4ef` |

Independently verified all seven result members and all six source/command members. The receipt before and after equal the repaired input freeze `1a825b0699cf597d0540ff4e5b97dce0a871c89102a16a756924b66061450465`; all 1,415 actual author-worktree source bindings still match. The primary remains `260adf375d0119d4cb8ad54e26d3d546981fe2a56b1efa3bbe1d6bb197b337fc`, with 511 production files unchanged. The receipt records 2.616 seconds, exit zero, exception null, empty inherited/effective oracle settings, and no remaining process group.

The executed argv is independently equal to the original v1 finite recipe:

```text
pnpm exec vitest run tests/query/load-subset-replay-refinement-oracle.test.ts --coverage.enabled=false --maxWorkers=1 --silent=false --reporter=verbose -t "records targeted replay boundary for"
```

The raw summary is seven passed, 77 skipped, no type errors. Seven unique full payload names each map to one passing verbose result. This command did not rerun original R03. The prior native guard's actual `numRuns: 4` remains preserved in its original immutable packet and is not rewritten to one.

## Actual cuts, reconstructed independently from the raw payloads

Sequence numbers below are local to each payload. Error and subscription numbers are recorded identities within that history, not cross-history identities. Each payload has consecutive observation sequence numbers and exactly one actual window-rejection callback followed by one shared-model identity-check entry. Every actual Error is in the independently constructed allowed set. The source retains the later `moveErrorViolation` enforcement and final judgment; passing tests therefore do not rely on an entry-only log or a discarded mismatch.

| History | Raw payload / passing reporter lines | Window / identity sequence | Concrete distinguishing observation |
| --- | --- | --- | --- |
| two failures of one own replay | 10 / 21 | 52 / 53 | One subscription fails with Error 40, then 41. The move rejects with 40; the allowed set is `[40]`, even though latest subscription error is 41. |
| earlier failed own work remains pending | 13 / 22 | 30 / 31 | Subscription 6 first fails with 26 and still has live pending load 22 when the move rejects. Completed subscription 9 fails with 27; the move returns 27 and only 27 is eligible. |
| two own replays settle in one batch | 16 / 23 | 32 / 33 | Both subscriptions finish before the callback. Their earliest own Errors are 26 and 27; later Error 28 belongs to the second owner. The move returns 26 from allowed set `[26,27]`. This does not impose a priority between owners. |
| two own replays in one batch share an Error | 19 / 24 | 32 / 33 | Both distinct subscriptions remain present in completed receipts despite all three faults carrying Error 26. The move returns 26; the token does not choose one owner. |
| source deletion reenters from loadSubset:error | 26 / 34 | 40 / 41 | Both adapter faults precede callback entry 31. The callback retires old keys `[1]`, admits same-owner keys `[2]` at sequence 33, and returns at 36 with the old demand aborted. The move retains Error 27. |
| source deletion reenters from status:ready | 29 / 35 | 40 / 41 | The same post-failure retirement/noncovering-demand distinction occurs through the status callback. The move retains Error 27; completed allowed set is `[27,26]`. |
| new demand after local success while a sibling holds | 32 / 36 | 19 / 20 | A locally successful owner's new demand fails with 18; the move returns 18 while the other owner's load 14 is still live pending. That sibling's later Error 19 occurs after the window cut. |

These checks used authored adapter-fault order, actual callback loads, subscription identity, key sets, retirement observations, and the returned Error, rather than taking test names as proof. All tests share `checkOrderedReplay`, its independent obligation account, production path, and comparison; none supplies a separate expected product answer.

The two reentries are **post-verdict retirement with noncovering new demand**. Keys `[2]` do not cover the retired keys `[1]`. The accepted earlier native evidence recorded `replaces=[]`; the current public/adapter traces remain consistent with that bounded classification. This review does not reinterpret them as covering replacement or as setup reentry before adapter return/join. It adds no native Promise-engine settlement claim.

## Original campaign recipes and semantics

Reviewed `r03-post-account-campaigns-v1/future-campaign-recipes.json`, hash `39eecd29252fbe7b35a534c8fc8f1b2abc13689355fd56dee698238f1bf2316c`. Both argv arrays and environments equal the original v1 `laterGate` recipes exactly. The source has not changed since the accepted repair. All original arbitrary mappings, comparison semantics, and budgets remain.

The first command selects `checks independent completed-own verdicts`. It runs the same property, model, driver, and comparison in a fixed-seed and an unseeded campaign, each with 120 samples. Each sample constructs all seven finite families while varying rank spacing 5–25, resolve/reject behavior for aborted marker loads, and zero to two prior completed marker replays. `reach.beginHistory()` runs for each constructed family. Each campaign must measure at least five histories in each of the six declared states: same-own earliest completion, pending-owner ineligibility, distinct/shared batch completions, post-verdict demand lifetime, and local success held by a sibling. The fixed seed stays `20261029`. Existing `fc.check` summaries expose seed, path, actual runs, shrinks, failed state, and reach counts.

The second command selects `keeps the last publication through a failed replay`. It retains the original fixed seed `20261023`, fixed/random 600-run budgets, the existing broad grammar and comparisons, and every existing reach minimum of five. The broad owner's existing exclusions and observation limits are preserved, including peer replay-identity limits; these are not newly widened or retired by the recipe. Successful `fc.assert` output does not expose full RunDetails or the random seed. Root explicitly accepted reporting 600 as the configured budget and retaining that successful-random-seed observation limit. The recipe does not invent an observed count or seed.

## Prepared campaign runner binding

Reviewed unexecuted `r03-post-account-campaigns-v1/run-campaign.py`, hash `cc02231969d1ddbb9c4195aa96a738480dc14bed53d5ddb7d0c9bf79c18eeb63`. It was AST-parsed only; there was no campaign run directory at review time.

The runner binds the exact repaired input freeze and exact recipe hash before selecting one of the two commands. Before either launch it checks finite-seven result freeze `35df72...` and every frozen member, then requires an accepted independent-review binding with this runner, recipe, source, finite-result, and review artifact hashes. It rejects inherited `TANSTACK_DB_ORACLE_*`, requires the exact empty selected environment, checks frozen HEAD and all 1,415 source files, uses the original argv/cwd, captures raw output, records before/after inputs and containment, preserves nonzero exit, and forbids reuse of an immutable run label. Each subprocess has a process group and a 2,400-second outer bound; test budgets and in-test timeouts are unchanged.

The second command additionally requires an accepted complete-first-result inspection bound to the exact targeted log and receipt, with both campaigns passed and every one of the six reaches at least five per campaign. The receipt must have zero exit, no exception, unchanged inputs, and no remaining process group. Author inspection must verify both emitted RunDetails have actual 120 runs, no failed result, and the required per-campaign reaches before writing that inspection. Root assigns slot 2 serially; no second campaign starts before the first finishes and is inspected. A timeout, setup error, incomplete output, missing reach, or residual group is not acceptance and must stop progress.

The review-acceptance binding may now point to this exact artifact and hash. With that binding, root's conditional finite-seven-and-runner prerequisites are satisfied. No original replay rerun or source mutation is needed.

## Preserved open obligations

Pre-verdict retirement, actual covering replacement, and adapter setup reentry before return/join remain named unobserved obligations under the replay-refinement owner. A passing fixed/random run does not by itself close them or establish a universal law. Hostile mutants remain unexecuted and unadmitted. There is no class closure, receiving/minified evidence, production RED, or native settlement proof here. The original R03 remains a model/comparison false product RED whose guarded repaired replay passed.

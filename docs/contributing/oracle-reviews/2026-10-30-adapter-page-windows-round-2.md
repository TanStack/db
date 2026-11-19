# Independent page-window review, round 2

The maintainer requested several fresh subagents to use `oracle-review` on the
oracle changes. Four independent reviewers examined contract/model authority,
shared histories and replay, real framework receiving cuts, and numeric TopK
windows. They initially worked read-only and did not receive a desired verdict.
Each read the skill, rubric, glossary, relevant coverage owners and source
authority. Reviewers who examined live-query behavior also read its architecture.

Base HEAD: `c351fc04d7f70dc59bf92ecbed310f899b9511cd`. The reviewed uncommitted
snapshot is identified by the existing source manifest, whose SHA256 at review
entry was `69f3395bb34456601fbfbfbd5537a9185b6060952f829f6a65c0d60c24f60985`.
All 113 source and evidence hashes matched before review repairs. The prior
record and manifest describe that snapshot; later repairs do not change its
historical results.

## Findings at review entry

| ID | Finding and authority | Smallest distinguishing witness and evidence |
| --- | --- | --- |
| R2-1 | P2, retained upstream subscriptions were under-observed. `contract.ts` promises subscription retention; owner-Collection snapshots check only continuous owner presence. | Offset 0 to 1 at width 1 retains Collection C, but replaces its source subscription by adding before removing. Source subscription count is 1, 2, 1 while deduplicated owners stay `[C]`. Source-inspected enforcement gap, independently found by two reviewers. No production defect claimed. |
| R2-2 | P2, shared shrinking can replace the first violated law/checkpoint (ORC-010). | A disposable checker-calibration driver used the real grammar and `runWindowHistory`. Seed 2291 first failed ordered rows for ranks `[16,0,3,2,8]`; nine shrinks reduced to empty rows and a Collection-retention failure at path `0:0:0:0:0:0:0:0:0:0`. The original row mismatch was absent from the final error. Executed wrong-observation calibration; not a production mutant. |
| R2-3 | P2, speculative resize paths were absent. The commit-isolation law covers limit and offset, but both React and Preact receiving histories kept limit fixed. | Commit offset 0/limit 1, attempt a suspended or aborted offset 0/limit 2 render, then inspect the captured committed Collection. A design that defers offset but changes limit during render can pass the old histories. Source-inspected grammar gap; no production defect claimed. |
| R2-4 | P2, a React action error can erase an earlier captured mismatch (ORC-010). | The cancelled-cut comparison saves wrong rows, then a committed `act` rejects before the final AggregateError is constructed. The later action replaces the saved mismatch. Source-inspected reporting gap. |
| R2-5 | P2, process: initial-loading, Collection-option and Preact aborted-render coverage entered after production changed. | The first preproduction gate names shared and React sources, not the later Preact receiver. The prior evidence record accurately discloses the late coverage. Later GREEN/mutant results do not satisfy the original pre-edit RED gate. This historical ordering cannot be repaired retrospectively. |
| R2-6 | P2, held-window keyed state was not compared. The shared binding contract requires keyed state to follow the same public snapshot as data. | While an acquisition is held, an adapter could expose the requested page in `state` but leave the last settled page in `data`. The old pending comparison read only data and Collection identity, so it could accept this wrong observation. Source-inspected gap found during repair follow-up; no production defect claimed. |

The contract/model reviewer found no authority or independent-model defect
inside the declared scope. The receiving reviewer confirmed that all six shared
drivers call real public hooks/injectors and that React and Preact prove their
speculative/aborted premises. Fresh focused receiving checks passed 8 React and
8 Preact tests before repairs.

The numeric reviewer found no actionable issue. Its fresh focused run passed all
16 numeric operator/profile/campaign cells, each with 100 histories at both
declared states. Current production/oracle hashes matched the numeric evidence
record. Timeout/runtime REDs remain distinct from assertion rejection.

The exact fresh numeric command selected `-t 'Numeric window oracle'` in
`packages/db-ivm/tests/operators/topk-support-window-oracle.test.ts`, with
coverage and typechecking disabled. It passed 16 tests and skipped 6, exit 0;
all 16 operator/profile/campaign cells reached both declared states 100 times.
This was a fresh reviewer execution, not a rerun of the earlier 172-test log.

## Repair follow-up

The oracle-authoring skill governed the follow-up. All eight production sources
match their review-entry hashes. The [final source manifest](2026-10-30-adapter-page-windows-round-2-manifest.json)
identifies 18 package sources and the supporting evidence; the original
manifest remains unchanged.

| Finding | Repair and calibration |
| --- | --- |
| R2-1 | Record each public subscription-count transition as well as continuous owner presence. Positive transitions during a retained page move fail; retired-Collection GC decrements remain legal. The old checker accepted the injected 1→2→1 replacement, causing the calibration to fail with `expected [Function] to throw an error`. The repaired shared checker rejects that replacement and accepts the GC control. |
| R2-2 | Mark each law/checkpoint and keep the first failure, original input trace and secondary diagnostics throughout shrinking. The original calibration changed from ordered rows to retention after nine shrinks. The repaired calibration retains `ordered window rows` at `input 0`, reducing to ranks `[1]` after fourteen shrinks. Non-reproducing candidates are rejected as reductions; they are not passing product evidence. |
| R2-3 | Run separate offset-only, limit-only and combined campaigns through both real receivers, eager/on-demand sources, and derived/explicit keys. Keys contain both bounds. Every category proves its own speculative/aborted and committed cuts. A wrong-observation control through the shared checker rejects premature width changes. |
| R2-4 | Keep later React action/premise failures after captured comparison failures. A temporary wrong cancelled-row observation followed by `late host update fault` remains RED at `ordered window rows / cancelled`, seed 2291, path `0:0:0`, with the host fault separate. Source bytes were restored exactly. |
| R2-5 | Remains a historical process gap. No retrospective result is described as satisfying the original pre-edit gate. |
| R2-6 | Compare pending keyed-map values with the same model rows at every held and settled cut. A shared calibration keeps valid data/Collection identity while supplying an empty map; the map check rejects it and accepts the model-derived map. |

An independent follow-up reviewer also found **R2-7**, a defect in the new
failure-reporting helper during its construction. For the actual helper,
`fc.integer({ min: 0, max: 1 })`, seed 0, one run executed inputs `[1, 0]`.
Input 1 failed the marked row law; input 0 failed setup. Fast-check retained the
earlier matching error, whose diagnostic snapshot omitted the final setup
failure. The helper now retains live secondary evidence and finalizes rendered
diagnostics after shrinking, while preserving fast-check's seed/path report.
The five support tests include this final-candidate case, initial setup failure,
cleanup diagnostics, primary-versus-secondary matching, and rendered evidence.
The follow-up reviewer executed all five and accepted the correction.

## Final validation and independent follow-up

| Focused suite | Passing tests |
| --- | ---: |
| Shared React / Preact / Vue / Solid / Angular / Svelte | 44 / 22 / 10 / 10 / 10 / 10 |
| React / Preact receiving | 24 / 24 |
| Failure-fidelity support | 5 |
| Fresh numeric reviewer run | 16 |
| Total distinct tests in this review | 175 |

Shared runs selected `-t 'window histor'` in each package's real conformance
test, with coverage/typechecking disabled and console interception disabled.
React/Solid use `tests/conformance.test.tsx`; Preact/Vue/Angular use
`tests/conformance.test.ts`; Svelte uses `tests/conformance.svelte.test.ts`.
Receiving runs selected their complete `tests/window-render-oracle.test.tsx`.
Support tests ran in `@tanstack/db` as `tests/failure-fidelity.test.ts`.

The [per-path reach record](2026-10-30-adapter-page-windows-round-2-reach.json)
contains 164 measured records. Ordinary shared states reach 13 histories per
lane/campaign. Pending states reach 7. Publication histories run 9 cases per
campaign and report offset/limit premises separately. Every receiving
category/source/key/campaign reaches each required cut 7 times: six generated
histories plus its shared-model example. No run budget was lowered.

Direct React replay of `framework.window-history`, seed `2121258135`, path `0`,
selection `derived/direct window histories`, passed its two fresh registrations;
fixed/control tests stood aside. The calibration-driver archive and RED/GREEN
logs are hashed in the manifest. No production mutant was needed in this
follow-up: the hostile observations exercise the same model/comparisons.

Core test TypeScript and both receiving-package TypeScript checks passed.
Focused lint and changed-file lint passed. React retains three `require-await`
warnings in its native `act` callbacks; these are not lint errors. Whitespace
validation passed.

The independent follow-up reviewer read the frozen subscription, receiving,
failure-fidelity and pending-map repairs and verified their final hashes. It
reported no remaining finding in that scope. This is an oracle review result,
not a whole-PR readiness verdict. R2-5 remains disclosed.

Limits from the original page-window and numeric records remain in force:
bounded query shapes and host cuts, controlled acquisition settlement, and no
claim about arbitrary provider delivery, all framework schedules or CPU bounds.

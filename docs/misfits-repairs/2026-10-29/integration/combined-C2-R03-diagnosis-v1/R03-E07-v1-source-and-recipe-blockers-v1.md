# R03 E7 v1 independent source and recipe blockers

Disposition: the frozen v1 packet is not accepted. The five findings below are source or data-review findings. No receiving command, test collection, campaign, mutant, compiler, lint or launcher was executed by this reviewer. Author acknowledgments and successor preparation are not evidence that a correction passes.

Reviewed packet: `r03-request-health-provenance-e07-v1/packet-freeze.json`, SHA256 `5856e5652bb486b165d1acdc54266e9cc772f3df865dec8c4f5691aa09d3e40c`; all 47 members independently match. Input freeze SHA256: `c30ed544311246f4af4abfc3899a9a620d90a480f1af5ac989decb3623167ad6`. At the initial review, all 1,415 current inputs matched; only the primary oracle and coverage document differed from E6. All 511 production files, the retained-publication helper, the `covers`, `decidingOwnFailures` and `settleOwnVerdicts` slices, and all 24 original budget invocation lines were unchanged.

The existing format, types and changed-lint receipts report exit0 with empty Oracle environment. Their before/after maps equal the frozen inputs and their log hashes match. These static results do not discharge the findings below or establish runtime reach.

## E7-S01: unsupported restriction of successful key recovery

The frozen primary snapshot's `requestErrorOwed.covered` predicate, lines 1678–1691, newly requires the same subscription, graph-plan provenance and identical plan ID for a later successful load to recover a failure. The accepted plan authorized removing the inference from a direct request's **issue** to a graph-plan health obligation; it expressly did not authorize a general rewrite of existing successful key-coverage rules. Law 16 says a lazy demand's error clears as soon as a later load of its failed key succeeds.

Source counterexample: graph plan P fails keys K; a later same-source load successfully establishes all of K through another plan/subscription or a direct complete load, with no separate replay-recovery record. The original successful-coverage predicate recognizes those loaded keys; v1 excludes them by origin. The accepted plan supplies no authority for that difference. This is a source scope/authority blocker, not a measured production counterexample. Restore the original same-source successful full-key predicate while retaining the supported direct-issue provenance distinction. The author acknowledged this and is preparing a separately frozen successor.

## E7-S02: unordered native relation receives an ordering promise

The new natural query at primary snapshot lines 5364–5372 has no `orderBy`. Recovery at 5535–5541 compares `query.toArray` with `parentKeys` insertion order through `checkReplayPublication`, whose comparison is exact array equality. A complete legal relation ordered `[2,1]` can therefore fail an expected `[1,2]` despite satisfying the intended key-relation law.

Use an explicitly ordered query with reviewed receiving implications, or canonicalize copied complete actual/model relation projections by independent numeric ID. Canonicalization must preserve multiplicity and every compared field. Ordered-window comparisons remain unchanged. This is an unsupported observation-order constraint, not a measured runtime RED. The author acknowledged it and is preparing canonicalization in a successor.

## E7-L03: numeric reporter counts are matched as substrings

`run-admitted-finite.py` checks phrases such as `"1 passed" in text`. For native R02, the contradictory summary `11 passed | 131 skipped (132)` satisfies the current count condition if its reporter-name rows and payload remain otherwise correct. The parser does not compare exact integers or check that status counts sum to the registered total. Likewise `13 passed` is a substring of `113 passed`.

Parse integer/status tokens, reject duplicate or unknown statuses, require the exact expected passed/skipped counts and registered total, and require total consistency. Pure wrong-prefix-count, duplicate-status and inconsistent-total observations should be rejected by the same parser. The predicate pre-existed E7; that does not excuse it in a recipe whose admission requires exact counts. The author acknowledged this source/data counterexample and is preparing a successor.

## E7-L04: payload counts do not bind witness identities

R03 specifies seven lifecycle and eleven publication payloads. The parser validates those kind counts and each payload's self-declared nonempty `required` array, but does not bind the exact history-name/required-state multiset to the recipe. Substitute a duplicate complete payload of the same kind for another history's payload: kind counts, contiguous sequences, completion and self-declared reaches still pass. Exact passing reporter names do not bind those raw traces to their named histories.

Bind each selected witness's kind, history name and exact required-state set/multiset independently in the frozen recipe. Reject duplicate/substituted history payloads and required-state omissions using pure parser controls. This finding concerns the evidence receiver; it establishes no production defect. R01 and native R02 have stronger individual identity/reach checks, which should be retained.

## E7-L05: launcher cannot enforce the stated staged ROOT admission

The recipe says ROOT classifies after each command, and ROOT confirmed it intends to admit R01 first. The frozen launcher requires `admission.commandsAuthorized == orderedLabels`, meaning all four labels. R01-only admission cannot run, and a prior accepted receipt alone is sufficient for the next label once all four are authorized; there is no separate binding of ROOT's intervening classification.

The successor must support exact R01 authority and require a fresh immutable ROOT stage admission/classification for each later label, bound to the same packet/input/review and preceding accepted receipt. Preserve serial order, the fresh maximum four-command ceiling, one-shot reservations, no retry, durable STOP and guard/process cleanup invariants. This is an admission-shape mismatch, not an observed unauthorized invocation. No runtime occurred.

## Scope of continuing review

The proposed provenance separation, independent first-verdict health account, direct subscription error observations and natural-controller late-key lane remain under source review. The old own-receipt chooser and publication expectations are unchanged. Natural controller covering-union choice, intermediate nested coherence and the previously declared limits stay open. A corrected successor needs exact independent source/recipe acceptance before ROOT can admit R01. All earlier E5/E6 classifications, R03-E6-HEALTH01 and v1 artifacts remain preserved.

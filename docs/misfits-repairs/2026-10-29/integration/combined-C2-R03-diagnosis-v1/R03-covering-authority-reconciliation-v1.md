# D03: existing authority for held covering recovery

Independent read-only authority review by `replay_covering_authority`. Reviewed the frozen D03 result `a658e42549c7b0ed7545118c2e9c1859152ddee26cf28bf578368852fa6581a6`, its complete 73-observation payload, current author sources, and the author's causal account. No production, model, checker, history, expectation, budget, or runtime change was made.

## Verdict

**Existing authority resolves this case without a new maintainer law choice.** Union35 can complete the still-open authoritative publication replacement while the earlier waiting call continues to reject with Error34. D03's unconditional `beforeMove` comparison is too strong at that later rejection observer. This is an evaluation/composition defect, not a demonstrated production RED.

The claim is conditional on a current, held, non-aborted acquisition that establishes complete applied coverage of every failed obligation it replaces, with every other publication obligation settled. A successful ordinary write, mere row presence, partial overlap, or a snapshot request with no such coverage does not discharge the hold. D03 does not establish every publication timing detail or whole-class closure.

## Existing authority and its provenance

All source line references below are in `.worktrees/codex-misfits-replay-latest-main-v3`.

1. **Completion and publication have different lifetimes.** `packages/db/src/query/live/ARCHITECTURE.md:142–146` explicitly says `hasPendingTruncateReplacement` withholds publication even after replay failure, whereas `pendingTruncateReplacement` exposes only an unsettled completion Promise. Its handoff table at130–135 separately assigns source-hold release to replay success and says it does not establish success of a previously failed window operation. These clauses predate this repair (`cfb01cee34` and `b528a61053`). A frozen failure receipt is therefore not proof that the publication replacement ended.
2. **Publication authority depends on the remaining demand obligations.** The broad failure-retention paragraph at1506–1514 prohibits ordinary deltas or snapshot requests from certifying completeness and immediately scopes failure to logical demand. The more specific shared-source rule at1531–1542 says the hold ends when its joining demand loads load, when a later replay succeeds, or when its last demand retires. It expressly includes a retry loading the failed demand's rows. This rule is accepted mainline authority from `a07cd73739` (#2231), not a rule invented from row1.
3. **Complete applied replacement coverage decides old obligations.** Source cancellation/applied settlement at949–960 requires a complete current-key union, keeps older coverage until its applied settlement, and excludes failed or obsolete replacements. Laws7 and10 at1836–1864 limit completeness to exact demand and preserve existing coverage on failure. Law16 at1930–1943 says failed keys count only when no later held load loaded them. Law16 alone governs request errors; points1–2 supply the publication authority.
4. **The accepted primary lifecycle abstraction enacts that composition.** `packages/db/tests/collection-subscription-lifecycle-grammar-oracle.ts:331–375` keeps `publicationBarrierOpen` after a failed judgment. `replacementSucceeded` accepts a held owner whose successful, non-aborted replacement covers it; `judgeReplay` then closes the barrier. The grammar permits `request`, `replace`, and settlement after failure. There is no rule making a failed completion an irrevocable publication verdict. This replacement rule is mainline `7d9ed02e08` (#2168), before the D03 diagnostic. The opening mapping at35–54 ties it to laws9/10 and distinguishes attempts from logical owners.

Reading “only a later successful truncate replay” as “only a new truncate event, regardless of a complete held replacement of the same open replay” would remove the specific accepted coverage/hold behavior above. Here the later success belongs to the existing authoritative truncate replacement. It is not independent snapshot data claiming authority over a closed replacement.

## Why union35 belongs to that replacement

The trace records failed A load30/options31 on subscription6, keys{3,4}; successful B32, keys{2,5}; and all remaining authored work draining by50. The independent own receipt freezes at51. Ready reentry52–54 issues union35 on the same subscription. Actual logical-demand edges at56 name both retained A and B. Union35 establishes its complete exact scope{2,3,4,5} at57, with a real applied `commit()` receipt `true`; its successful account settles at58. A and B remain held. There is no intervening retirement, newer truncate, cleanup, or changed sync run.

The source distinguishes those recorded facts from their concrete mechanism:

- `subscription.ts:715–771`: a failed judgment rejects the completion through `abandonTruncateReplay`, but retains `truncateReplayState`, `currentAttempt`, and the publication hold. The `finally` path can emit ready. It does not execute `flushTruncateReplay` or `discardTruncateReplay`.
- `subscription.ts:1176–1200,1253–1270`: the reentrant demand captures that retained replay state/attempt. Immediate success schedules a guarded completion check. It creates no new truncate attempt and does not turn the rejected completion back into a pending one.
- `subscription.ts:1477–1493`: actual `replaceSnapshots` edges relate union35 to those exact logical demands. `checkTruncateReplayComplete` at719–731 can therefore exclude A's covered failure. `flushTruncateReplay` at773–783 releases the publication state; trying to resolve its already rejected Promise cannot rewrite Error34.

Thus union35 **covers**, rather than literally retires, the same failed logical obligation inside the same still-open publication replacement. Its authority is not inferred from the observed row1. Successful key1 loads24/26 separately establish marker1's absence; union35 proves no extent outside its predicate. Together with the other settled loads they establish the coherent replacement.

## Which observation is owed

The settled and requested windows are both offset0/limit1. `collection-config-builder.ts:398–437` waits on source recovery before admitting a window operation; admission starts at446. The failed wait therefore never applies the requested window or opens that operation's publication gate. This is distinct from an admitted window refinement that fails and must retain its preceding snapshot until retry. Public `getWindow()` must remain the old settled window; D03 did not record it directly.

The finite provider model independently gives old publication row2 and complete recovered **old-window** publication row1. At rejection observer62, **row2 or coherent row1 can be permitted**, depending on whether the recovery's scheduled graph publication has run. Source applied settlement is not larger-graph publication (glossary; architecture handoffs). The old waiter's Error34 remains required in either case. No contract makes its rejection callback an atomic checkpoint before every later recovery publication. Neither a partial snapshot nor a different unaccepted window is permitted.

After the authoritative replacement and its scheduled graph work have completed, with no remaining gate, a quiet/convergence comparison must require row1 from the independent query model, including its empty marker include. A mere source `commit() === true`, a ready callback, or the old rejected Promise alone is insufficient to assert that larger-graph completion. D03 stopped before its quiet comparison, so it proves neither that new comparison nor absence of premature publication before57.

## Smallest independent repair and controls

Repair the evaluation's distinction between a call rejected while waiting for source replay and an admitted failed window operation. Preserve immutable own Error receipts. Preserve the shared publication account and derive its release from authored held/current exact coverage plus applied settlement, never production output or replay flags.

At an old rejection observer, require the retained snapshot while the independent publication hold remains. After a separately established successful discharge, permit only a coherent preceding publication or the complete recomputed old-window publication until graph completion is observed. At the quiet graph-completion checkpoint require the latter. Do not merely skip the check when a model map empties. The existing `remainingWorkSucceeded` at3580–3597 also confounds all rejected calls with failed admitted operations and requires literal old failures to retire; those premises must recognize independently proven replacement coverage before the repaired quiet check can cover D03.

Negative controls must reject: publication before establishing application; partial or unrelated coverage; an aborted/retired replacement; a remaining failed sibling obligation; mutation of Error34 by later success; publication of an unaccepted requested window; clearing an admitted failed window operation by unrelated replay success; and a stranded old snapshot after completed authoritative recovery. Varying the requested window would distinguish acceptance leakage that D03's equal windows cannot expose. These are proposed calibration obligations, not executions or authorization for runtime.

The repair-location table (`docs/contributing/instruments/adversarial-review.md:31–38`) places the supported finding in evaluation: the check rejects a contract-permitted observation. A short architecture clarification could make the lifetime/coverage composition easier to find; it need not introduce new semantics. Broader histories, generated reach, hostile controls, native Promise-settlement cuts, exact public publication timing, and PR readiness remain unestablished by this read-only review.

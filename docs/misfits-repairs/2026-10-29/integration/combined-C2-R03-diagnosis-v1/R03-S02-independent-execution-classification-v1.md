# R03 S02: independent execution classification and repair location

The exact R03 counterexample is a false RED in the reference model/comparison's replay error ownership. The observed window returns the completed replay's own Error. The comparison gives an earlier Error from a different, still-pending subscription precedence through one source Barrier. This trace establishes no production defect. The repair location is the reference model and its refinement comparison; moving the checkpoint or changing product error precedence is not justified.

This is a read-only review of root-authorized S02. I executed no runtime, tests, config, generator, compiler, build or lint, and changed no executable source. The underlying overlay's separate static admission review is `R03-frozen-overlay-independent-admission-review-v1.md`, SHA-256 `6156204cf922ed17626cf8f320cbb7dd7ae707780c74617e296eb8b4c72f5d17`.

## Bound evidence

- Registered property: `replay.ordered-failed-replay`; seed `-290401844`; path `208:4:3:3:4:3:3`.
- Receipt: `/Users/kyle.mathews/programs/tanstack-db/.worktrees/codex-misfits-survey-open-items/docs/misfits-repairs/2026-10-29/prep-pr/replay-batch/evaluation/initial-preload-repair-v1/r03-standalone-diagnostic-v1/runs/S02-exact-source-observation-trace-receipt.json`; SHA-256 `47191e6ad62da8d4e03fe0fe0576719b074821c223f065837b8d6b0905155365`.
- Complete raw log: `/Users/kyle.mathews/programs/tanstack-db/.worktrees/codex-misfits-survey-open-items/docs/misfits-repairs/2026-10-29/prep-pr/replay-batch/evaluation/initial-preload-repair-v1/r03-standalone-diagnostic-v1/runs/S02-exact-source-observation-trace.log`; SHA-256 `21cc6621ca48084f6f2d4b674f7334d7289147aa4c846b2132ecc2df5b31520e`.
- Source freeze: `3e1add680ba01e49e251b9f8a5bae8bb272db45a2dc29c8fa8d533b2c529dae8`.
- Overlay freeze: `6023942558758439279bc6d98c9be70430f6b61a0e561e18c227e6709d79d429`.
- Independent extracted evidence: `/Users/kyle.mathews/programs/tanstack-db/.worktrees/codex-misfits-survey-open-items/docs/misfits-repairs/2026-10-29/integration/combined-C2-R03-diagnosis-v1/R03-S02-independent-execution-classification-v1.json`; SHA-256 `188c8d2911c86ef7babbd455ddf167c3de7dfc515c0419c6c1acfb8ff34cf1e2`.

I independently compared the receipt to the frozen exact command/selectors, verified its before/after maps against all 1,414 frozen input hashes and all 13 overlay hashes, and rehashed the current corresponding files. The maps and current files match. All three incoming/outgoing module binding hashes match the admitted manifest. The guarded replay reports one execution and one witness (`numRuns: 1`, failed), exit 1, 2.257 seconds, and the original replay-error-identity failure at the registered coordinate. No additional setup or diagnostic failure is reported. This does not independently measure swallowed cleanup errors.

The raw log contains ten trace emissions and seven `history-enter` events in its final cumulative ledger. All remain raw evidence. This classification uses only the first exact-history ledger: callback sequence 115 on raw line 11 and comparison-entry sequence 116 on line 12. I verified the first 115 events are identical across those emissions. Their actual subscription snapshots, model waited Barrier snapshots and load snapshots are identical. Other history entries do not extend this claim.

## Observed chronology

The exact history is `hold; truncateMarkers; window(0,1); settle(false,newest:true); settle(false,keepHolding:false,newest:false)`. The scenario is ascending, offset 0/limit 1, no ties or peer, on-demand markers, `joined: 'none'` (a left anti-join), `includes: true`, aborted loads resolve, no history during preload. The join and include create separate subscriptions to the marker source.

| Sequence | Observation and identity |
| --- | --- |
| 62–66 | Subscription `o11`, replay `o76`, acquires demand `o13` via acquisition `o94` / options `o95`; driver load `o97` returns Promise `o98` and joins as participant `o99`. This participant remains pending at the rejection checkpoint. |
| 71–75 | The same subscription/replay acquires demand `o49`, acquisition `o100` / options `o101`, load `o103` on keys `[2]`, result `o104`, participant `o105`. |
| 80–88 | Model captures source Barrier `o75`. Actual window captures own completion Promises `o78` (`o11` / replay `o76`) and `o82` (`o22` / replay `o80`); native aggregate `o107`, existing derived recovery `o108`, returned window Promise `o109`, existing test observer Promise `o110` have separate identities. |
| 90–92 | Newest selection chooses `o103`. Model records that failed load at 91 before injection assigns Error `o111`; the adapter throw site at 92 records that Error. This is not an actual replay completion. |
| 93–99 | Subscription `o11` normalizes and records the same `o111`; participant `o105` leaves. Replay `o76` still contains `o99` / demand `o13`, with completion `o78` pending. |
| 101–103 | The next selection chooses `o91`: subscription `o22`, demand `o84`, acquisition `o88`, options `o89`, result `o92`, participant `o93`, keys `[1]`. Model records its failure at 102; the adapter throw site at 103 records distinct Error `o112`. |
| 104–109 | Subscription `o22` records `o112`, its participant leaves, and own replay `o80` has no pending participant. At 109, before the original reject call, `first` is true and ordered active errors are exactly `[o112]`. Completion Promise is `o82`. |
| 110–114 | Its Deferred pending flag is now false. Recovery await rejection observer sees `o112` at 113, then the unchanged async throw site rethrows the same object at 114. |
| 115–116 | Window `o109` rejection callback and original comparison entry both receive `o112`. Replay `o76` still has participant `o99`, Error `o111` and completion `o78` pending. Replay `o80` has only Error `o112` and completion `o82` no longer pending. |

The source model's Barrier `o75` now has failure history `[o103/o111, o91/o112]` and pending load `o97`. Its comparison treats that merged history as one replay and rejects the second Error because `o111` still decides keys `[2]`. The two Errors are equal in message only. The earlier Error's subscription is `o11`; the returned Error's subscription is `o22`. No retirement/replacement or intervening change between callback and comparison explains this mismatch.

## Authority and repair

Frozen architecture SHA-256 `5b5aa10c6672e7e60e38c1d2f5f28fa1f956d60741fb75965808050a256130b1`, lines 1396–1403, promises the waited replay's own earliest failure that still decides it. Lines 1526–1529 preserve that replay's Error identity. Lines 1531–1542 share publication between subscriptions while retaining each subscription's own replay. The historical maintainer decisions recorded in commits `0203c3f68a6bdf6fdfb80b17d4af86a14473a2d8` and merged `a07cd73739c1f135e658f38621de27f336004d11` support own-replay judgment; they provide no source-global earliest-error priority. The repair-location table maps a reference that predicts disallowed behavior to the reference model and a checker that rejects an allowed observation to evaluation/comparison.

Preserve the source publication Barrier for retention. Represent each waited subscription's own replay participants, failure eligibility/order and completed verdict independently for the error check. The smallest sound repair cannot simply filter earlier failure history by the returned Error's subscription: that could accept `o111` even while its replay `o76` still has pending work. Completed own verdict eligibility matters. Coverage/pruning rules used for error judgment must have the same own-replay scope; the publication abstraction must not silently choose error precedence.

The existing broad grammar reaches the distinguishing topology, but the primary error check falsely merges the owners. Add declared, measured reach that guarantees it and keep this trace as shared-model replay input. Generate two subscriptions A/B to one source, with A owning two held participants and B one; start a window waiting on both; fail A1 first while A0 stays held; then fail B0 and observe the window rejection while A0 remains pending. The allowed own completed Error is B's. Mirror subscription roles and settlement order. Add a same-subscription two-failure control with issue order reversed relative to failure order, requiring that own replay's first still-deciding failure. A source-global-earliest mutant must be rejected, and a latest-error mutant must fail the same-subscription control. A filter-only checker must also reject a supplied wrong observation of A's Error while A remains pending.

This observation premise is that A0 actually remains pending at the existing rejection callback. Declare and measure that state; do not invent a scheduler deadline or silently drain A0 before checking. If a generated history does not reach it, it supplies no witness for this discriminator. A repaired comparison needs GREEN and hostile rejection evidence before any closure claim.

## Limits

The trace instruments reject calls, Deferred flags, await/throw sites and observers. Native Promise `o107`'s engine first-settlement write is unobserved; no observer is relabeled as that event. The static Promise.all wiring plus observed Error flow explains the returned identity without establishing a hidden settlement timestamp. Source-wide publication does not imply source-wide error priority. No cross-run IDs, minified path, other adapter/framework, R02 causal attribution, universal scheduling guarantee, model repair implementation, mutant run, bug-class closure or PR readiness follows. Cleanup is an unchanged separate finally segment, without a separate phase-health probe. No further runtime is authorized by this report.

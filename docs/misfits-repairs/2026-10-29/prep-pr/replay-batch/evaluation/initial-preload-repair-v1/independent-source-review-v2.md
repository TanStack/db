# Independent R02 source and receipt review: frozen v2

This is an additive review of the inert `source-epoch-v2` snapshots and U01–U04 raw receipts. No runtime, typecheck, build, lint, executable edit, or production change was performed by this reviewer. V1 remains historical evidence. This report does not authorize production or assert whole-PR readiness.

## Identity and audit boundary

Input freeze SHA256: `f3814b9f4544721f54fe6af9bf31774526a784dec026add55bb97bae7484f346`. Observed-results packet SHA256: `05069b99f0e9bbb5cbafe2f52033a764b4d60f0573c129c4f451d7f664d16a73`. Head: `9cfa11fc712866f8f276e85762865ebb8bd49cbe`. Production aggregate: `d7fa2b44615b883fcc3da8971c45da8848e1a6921e4ff2e7f2c2983eec6f3ae0`.

I verified 541 manifest entries, the 159-entry relative static test/configuration closure, all 36 inert snapshot hashes, and all 511 production hashes unchanged from v1. Each U01–U04 receipt has the exact freeze inventory before and after, identical before/after values, the same production aggregate and head, and an empty oracleEnvironment. Each raw log matches its receipt hash; every receipt has exit1. This binds the captured test/configuration bytes and package/lockfile provenance, not a complete loaded-node_modules census.

Key source identities:

| Source | SHA256 |
| --- | --- |
| Primary replay owner | `8335c9ba839ea2b45ae39440247ccc9363cdf981ef402d0d3560aa0575607402` |
| Initial-window grammar | `5862b126c7105c00ec62562fe148e6e7a12b3f822611cf3e46275007ee9fefc3` |
| Actual Query driver | `8307dd6ab4c180e94fa2bf6bdb81ed291711f89605a511ff1959d1520ba10c8c` |
| Shared finite model/comparison | `37d8b6e6e6243e86ff1cdc85cf4583c37fe91ba3673be7757bfda90d07c7f81c` |
| Established Query window receiver | `610822d28b17f2d13d5bf57a5664dec17f83dc4f08bcd991dc3f8818ab74b203` |

## S1–S4 source assessment

**S1 addressed for the bounded initial profile.** Primary lines2287–2336 and Query582–628 use the same `modelOrderedReplayWindow` and `checkReplayPublication`, including fixed replay and generated inputs. The old primary check remains supplemental. No production classifier computes expected rows.

**S2 joint design repaired and actual reach established, with one source liveness qualification.** Both drivers retain one marker-first keyed acquisition by identity, require a predicate to distinguish it from the unordered full-source retry, and bind the retry start index and exact pending-versus-already-successful keyed timing. They declare `retry-success-with-keyed-root-still-pending`, `retry-success-after-keyed-root-settled`, and `quiet-retired-old-and-successful-survivors-compared` before the final value check can reject. Normal generated reach and shrink attempts are separated. In v2, the keyed-current guard excludes aborted receipts but does not independently exclude receipts in the unloaded set, although root retirement is abort OR unload. The raw cuts actually credited below show root2 neither aborted nor unloaded, so their reach is valid. The author and root were informed; a successor can align the predicate with the stated current premise by excluding unload too. This is an enforcement qualification, not a new coverage-policy law.

**S3 addressed within callback-row scope.** Both paths judge callback-time public snapshots through the shared comparison. For static same-window histories, initial empty output is allowed and each nonempty snapshot must equal the full model. Current-required-failure histories compare with the preceding public snapshot. No callback count, change-message payload fidelity, accumulated event-state coherence, or empty-until-all-transports-settle claim is made. The generated late-sibling failures occur after these callback checks, at the final quiet read.

**S4 addressed within acquisition observation scope.** Query preserves stable acquisition ordinals, independently evaluated request keys/predicate/limit/offset/cursor/order, exact options identity, possible same-scope acquisition candidates, real Query cache keys, and cut-level applied-commit/delivered-write counts. The exactAcquisition -1 for marker metadata remains distinct from ownership and possible scope sharing. Abort-or-unload establishes the claimed logical nonparticipation only; it does not prove balanced physical leases. Relative static helper identities omitted from v1 are now bound.

## Raw execution classifications

| Run | Receipt SHA256 | Raw-log SHA256 | Independent classification |
| --- | --- | --- | --- |
| U01 core exact | `d8724a563f25c23807456ccd34e3e9f8bbabc5aa8f566af0438c58ec8be0a44c` | `c2693719629461e1d7876d084353ac610064a508889de73b1c110eaf27d81423` | Semantic RED at final quiet shared comparison, empty versus root1/rank10 |
| U02 Query exact | `b0c0d9149807f3e9d1dd4c1a3f67eb38246362d1d478d6ef255f6ec91d72fb2f` | `056a83fa14de90a4919dfeea99a7068e5dbdf9575c478e91b635c25fda2062dc` | Same semantic RED through actual Query receiving path |
| U03 core generated | `8ed22a89558da367c6af9516e092aa6e8dac524b32b1d95cead52c63d0427868` | `141f678fcba3e0358f112285cfc62887dacb70e4ff246eccf3790d7268f4036a` | Fixed and random campaigns stop on late-sibling final quiet shared-model RED |
| U04 Query generated | `dda2a2ad3b786020eea4ac24f724b71210f53b8ab224019049977d2beb776c3d` | `0e1b517478e39abdadde9826380fc33dfb42d0774a68817529c40d5ff8521fb2` | Same late-sibling RED with real Query delivery/commit record |

These are assertion failures in `checkReplayPublication` (shared checker line17; primary2333; Query625), not setup errors, pending-work timeouts, or cleanup failures. Runtime logs report no type errors; this does not replace a separately bound full typecheck.

U02's cuts reconstruct the decisive premise: initially root0 and marker1 are pending; marker1 supplies four writes in one applied commit and starts keyed root2 over keys1/3/4/5 while root0/preload remain pending; root0 fails; move2 retires root0 and root3 succeeds over all five roots while root2 remains pending. At that cut there are nine writes/two applied commits and preload is still pending. Finally root2 succeeds, all transports settle, three commits apply, preload settles, Collection status is ready, move2 is ok, move1 preserves its failure, and the public result remains empty. All recorded acquisitions are Promises. No cached-true or custom cache policy is credited.

Independent relational calculation: marked roots1/3/4/5 join; ascending rank10/30/40/50 with offset0/limit1 selects root1/rank10. This is the same accepted final quiet law as the original diagnosis, independent of early move2 receipt timing or whether another request could cover root2.

Generated coordinates and actual counts:

| Driver/campaign | Seed | Path | Generated inputs | Shrinks |
| --- | --- | --- | --- | --- |
| Core fixed | 20261103 | `0:0` | 1 | 1 |
| Core random | 716556988 | `0:0:0` | 1 | 2 |
| Query fixed | 20261103 | `0:0` | 1 | 1 |
| Query random | 1968626713 | `0:0` | 1 | 1 |

Each normal generated input executes five schedules. Per campaign, normal counts are: initial pending5; marker-first growth5; failed-root-with-keyed-pending3; retired-root3; retry-before1; retry-after1; joint-success/keyed-pending1; joint-success/keyed-already-settled1; callback comparisons5; newer success/older rejection2; quiet comparison4; quiet retired/successful survivors2; needed broad-root failure1; obsolete late rejection1; current-failure retention1. Shrinks add separate counts: one five-schedule set for core-fixed and both Query campaigns, two for core-random. They do not raise normal reach. The minimum5 for every declared state is not satisfied, and the campaigns are not GREEN. The other four schedules are accepted in the aggregate RED record; that is not a substitute for separate positive-control execution.

## Remaining gate scope

V2's required-old-failure schedule rejects broad root0 after move2. It does not reject keyed root2 after root0 retirement and successful root3. That is the bounded missing cell for the proposed reset repair. `authority-refinement-v1.md` records why its successor must use a conditional ready/full versus initial-terminal/preceding judgment rather than invent a stronger cross-subscription substitution policy. Root approved test-only successor authoring; v2 itself has not discharged that cell.

Before production authorization, bind and audit the successor's exact core/Query RED, generated reach, that bounded late-keyed-failure neighbor, separate initial-success/early-sibling/required/obsolete controls, shared-checker calibration, established nonempty Query failure/retry receiver, and the materially affected existing replay/fencing controls named in `successor-enforcement-inventory-v2.md`. Existing owners supply those controls; this report does not demand a new broad model. Runtime evidence for those separate controls was not supplied in U01–U04.

No closure is claimed for persistence, other providers/frameworks, Effect callbacks, every custom cache shape, physical lease balance, or arbitrary mutations/reloads/truncates beyond the named owners. The initial setup-before-try and primary cleanup diagnostic limits from v1 remain. The original broad replay property/coordinates and budget remain preserved; no expectation relaxation or production change follows from this review.

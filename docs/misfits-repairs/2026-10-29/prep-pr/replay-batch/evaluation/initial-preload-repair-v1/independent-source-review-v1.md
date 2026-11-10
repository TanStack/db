# Independent source review: initial/preload epoch v1

Reviewer: `/root/review_combined_held_cuts`. This reviews frozen inert source epoch v1 against `independent-plan-review-v1.md` (SHA256 `51f92282bf7919c51bd2888740df29d98212f81278f937b0a17044cfc396fc06`). No changing canonical test source was read. No runtime, build, test, lint, or executable edit was performed. This record is immutable source-review evidence; run receipts remain to be audited separately.

## Identity and decision

`source-epoch-v1/input-freeze-v1.json` SHA256 is `d884c95c0fdd1d7d487c8e0196ed34e5996fedc1b89cd0f2648e153cc0d4c2db`. All 15 inert snapshots under its `sources/` directory match their corresponding manifest entries. The manifest binds head `9cfa11fc712866f8f276e85762865ebb8bd49cbe` and production identity `d7fa2b44615b883fcc3da8971c45da8848e1a6921e4ff2e7f2c2983eec6f3ae0`.

| Reviewed source, with `.source-snapshot.txt` suffix omitted | SHA256 |
| --- | --- |
| `packages/db/tests/query/initial-preload-window-oracle.ts` | `59af747ebf36ff54e9f5f907309761815ac9a7f66964819bbf6246ae170930f8` |
| `packages/db/tests/query/load-subset-replay-refinement-oracle.test.ts` | `022fa8b8b6eb751851461ff4f6234c7badc48498632e1efc553904779162a0d0` |
| `packages/db/tests/query/load-subset-retained-publication-oracle.ts` | `37d8b6e6e6243e86ff1cdc85cf4583c37fe91ba3673be7757bfda90d07c7f81c` |
| `packages/query-db-collection/tests/initial-preload-window-query-oracle.test.ts` | `38a31b4e58a0bd528208f31b869ee51e305ceeed783341e96bbc61379a3df8f7` |
| `packages/query-db-collection/tests/load-subset-window-failure-query-oracle.test.ts` | `610822d28b17f2d13d5bf57a5664dec17f83dc4f08bcd991dc3f8818ab74b203` |
| `packages/db/tests/oracle-config.ts` | `9c25d4cf7602b55522cc8e0fd37647b78b72eb3dd5028276a0c988d5a96a52ac` |
| `packages/db/tests/oracle-replay-manifest.ts` | `d8c74caa2cb1ec33eca395d5923371cf1c92f7ee2680974a1b9dabecdd765f7b` |

Builder remains `08a621237296456aad194a4b5087889016cd78049e570a1af6a21f471b53a8f2`; standalone ordered loader remains `188382f75335916bb37ca53c72b469bc345b588082ca310a8390f4dbdaa2a450`. The architecture snapshot is the previously reviewed C1 authority `5b5aa10c6672e7e60e38c1d2f5f28fa1f956d60741fb75965808050a256130b1`.

The epoch adds relevant histories and preserves the broad preload arbitrary and original replay coordinates. It does not yet discharge R02-P1..P5. Findings S1–S4 below are supported source gaps. They concern test enforcement and receiving evidence, not a need to revise the accepted final quiet law. This is not production authorization.

## What the source establishes

The shared grammar generates direction, positive rank step, offset 0/1 and limit 1/2. Every generated input executes five separate schedules: late sibling, early sibling, initial success, still-required old failure, and root-truncate-retired late failure. The fixed input reproduces the four-action R02 form without a second expected answer. The added history function does not change the old `preloadCase` mapping.

The new Query driver uses a real QueryClient and `queryCollectionOptions`, a static default subset-key cache, and a separately controlled indexed root. It holds actual `queryFn` delivery and separately records adapter acquisition receipts. It observes Query writes and applied commits without replacing their results. The successful final quiet comparison uses provider truth through `modelOrderedReplayWindow`. It does not introduce the discarded literal-true/no-participant inference.

Both focused properties have fixed seed 20261103 and unseeded campaigns using the same 20-input budget. Both new properties are in the replay registry and manifest, and both accept direct seed/path selection. The existing broad preload budget is still 300. The Query driver's cleanup loop preserves the primary failure as an aggregate cause and attempts each cleanup independently.

## S1 — The initial receiving path does not share the primary initial judgment

**Claim challenged:** R02-P3/ORC-014 requires this receiving driver to reuse the primary law, model and comparison.

The primary initial path still judges `expectedRanks` and `checkWindow` defined locally in the large driver (primary lines 490–527), then calls that local comparison at 2202. The new Query path calls the separate generic `modelOrderedReplayWindow` and `checkReplayPublication` (Query lines 472–485). The primary imports and uses the shared anti-join model for a different result-shape family, but does not use the generic model/checker for this initial inner-join profile.

The two finite formulations currently agree on this bounded distinct-rank domain. This is not evidence of a wrong expected answer. It is a shared-judgment handoff gap: the receiving answer can drift independently of the primary initial answer. The generic equality wrapper alone does not make two expectation computations one model.

**Repair:** route the focused primary initial profile through the existing generic finite model and shared comparison as well, while preserving the local check and old grammar for their established coverage. No production semantic helper is needed. A fixed replay and a generated sample must reach that same shared comparison in both drivers. Record the corresponding model/checker identities in the successor epoch.

## S2 — Declared reach does not enforce the joint R02 state or its two receiving schedules

**Claim challenged:** R02-P1/ORC-015 requires measured joint structural reach, per driver, before a final comparison can throw.

The shared `initialWindowStates` list declares independent event names. `createOracleReach` counts each event once per history. Primary lines 3510–3585 and Query lines 580–622 assert separate minima of five; neither asserts a conjunction containing marker-first keyed growth, initial pending preload, exact original failure and retirement, replacement success, and remaining keyed work across the newer operation. The primary stores per-schedule `entered` sets, but never tests their required conjunction. Query stores each driver's set only in raw output. Aggregate event minima can be supplied by different schedules or histories.

The pending-versus-settled classifications also accept any later unordered root request as `keyed` (primary 1790–1796; Query 309–318). This inner-join profile's full-source initial and retry requests are themselves unordered. Thus absent ordering is insufficient evidence of keyed demand. The original X03 diagnosis recorded independently evaluated request keys; this epoch does not make that discrimination in the new reach predicate.

**Repair:** retain acquisition identity and independently evaluated scope keys. Declare a joint overlap state and a joint sibling-before state when their actual event sequence is witnessed. Bind them to the correct schedule/driver and require their minima. The quiet joint state must establish successful surviving replacement work and the applicable retired failure, rather than only counting that a final check was attempted. Keep counts before a mismatch is thrown.

Both new campaign counters also include shrink executions. On RED, they throw before `assertReached`; printed `reach` is not normal generated reach. Raw per-schedule observations can support a later audit, but generated samples and shrinking must be partitioned before reporting reach. This is an evidence classification gap, not a request to make a failing campaign pass its minimum.

## S3 — Initial Query callback snapshots are recorded but never judged

**Claim challenged:** R02-P3/P4 and the plan's read/event receiving inventory include initial publication observations. Architecture Atomic window publication and law 9 govern complete public snapshots.

Query lines 279–282 append callback-time snapshots. The only later use is serialization in `finally`; no comparison reads `publications`. A mutant that emits a partial nonempty callback and later repairs the final read can pass this driver. A failed current operation can likewise expose a transient replacement before returning to the retained final snapshot. Existing actual Query held-window receiver 6108 checks established join/include callback cuts, but does not establish this initial receiving history's callback behavior.

The final quiet R02 read remains meaningful without these callback checks. Do not relabel v1 as initial callback coverage, or weaken the final-read defect because callback coverage is absent.

**Bounded repair and authority:** in these static histories every explicit window is the same tuple, there are no row mutations or optimistic exceptions, and ranks are distinct. Each nonempty callback snapshot can be compared with the shared complete chosen model; initial empty callbacks may be allowed. Under a failed current operation, compare the relevant later snapshots with the preceding settled public snapshot through the existing retention judgment. Do not require empty output until every physical transport settles. A complete chosen result may become available before transport settlement when remaining work no longer gates publication. No stronger early promise is proposed here.

This tests callback-visible row values. The current recorder discards change payloads, so it cannot establish payload correctness or accumulated event-state coherence. Add those observations only if that stronger event claim is made.

## S4 — The new receiving record loses exact scope and temporal premises

**Claim challenged:** R02-P1/P3 requires root2-versus-retry identity, exact retirement, and the receiving handoff's actual applied facts at the claimed cut.

The Query driver retains exact options internally, but its serialized acquisition record emits only owner ordinal, source, kind, outcome, abort/unload booleans and an ordered boolean (Query 510–524). It omits independently evaluated keys/predicate scope, limit, offset and cursor. Its cuts contain rows/outcomes, but no acquisition/commit/delivery state at each cut (398–403). Commits and deliveries are emitted only as final lists. `exactAcquisition` can be -1 when a Query transport's metadata options are not the acquisition options object; no explicit transport-sharing mapping explains that case.

This output can show a final failure and some attempts, but cannot reconstruct the exact R02 keyed participant and applied-delivery ordering merely from “unordered” acquisitions and final totals. The live options may be inspected inside reach predicates, yet those predicates currently omit the needed distinctions (S2). The claim of exact owner retirement uses abort **or** unload (467–469); it does not assert a balanced lease or zero owner count.

**Repair:** serialize stable per-attempt identities and independently evaluated request scope, plus immutable event-order or cut snapshots for acquisition outcomes, applied commits/deliveries, abort and unload. Keep transport and acquisition identities distinct and explicitly describe shared/cache transports instead of forcing reference equality. Measure only result/cache shapes actually observed. If claiming lease balance or exact release, retain counts as well as membership; otherwise scope the observation to logical nonparticipation. This inventory is evidence about production reach, not an alternative source of expected rows.

## Neighbor coverage, setup, and limits

The still-required failure and obsolete late-failure schedules are relevant neighboring attacks. They select the original root through a held-resolver mapping before rejection, not through the error result. Their retention baseline is captured immediately before rejection. These initial profiles start with no settled nonempty snapshot. The existing 6108 receiver supplies useful nonempty established-window failure/retry controls. Those controls must receive their own successful executions and exact source identities; neither an aggregate RED nor v1's initial empty retention establishes them.

The v1 freeze also includes existing replay-failure and cleanup/restart sources. This source review has not assigned them new R02 reach credit or certified their runtime results. Active/failed/superseded/retired replay and sync-run fencing must be bound to concrete witnesses and candidate source effects before the production decision. No new broad suite is demanded where an existing owner supplies the needed observation.

The manifest omits byte hashes/snapshots for some directly imported test helpers, including `reference-expression-oracle.ts`, `utils.ts`, and `oracle-declaration.ts`. Head plus captured clean/dirty status supplies provenance for tracked unchanged files, but these helper bytes are not available in the inert review set. Add the relevant helper identities or expressly bind the clean tracked HEAD versions in the successor dependency record. No full loaded-module census is claimed.

The Query driver creates sources, subscribes, and starts preload before its guarded `try` block. Its finite 30-turn drain is a timing mechanism, not by itself proof of settlement; the subsequent transport/acquisition checks are the premise checks. A receipt must identify the exact final quiet model mismatch to count as semantic RED. Failure during setup, a pending-move/preload timeout, or an earlier outcome/identity assertion must be classified at its actual checkpoint. The author-reported typecheck does not supply runtime sensitivity or reach.

The primary cleanup behavior is inherited: it swallows several cleanup errors through its existing handler and has no new primary/secondary capture record. This review does not claim cleanup fidelity was newly repaired. The new Query driver has stronger explicit cleanup diagnostics. Any successor must preserve the original mismatch and distinguish cleanup failures in its run record.

## Required next evidence

Preserve v1 source and run receipts as historical evidence. Freeze an additive successor that resolves S1–S4, then audit exact primary, actual Query, focused generated, and separate positive-control receipts. The final quiet comparison must still fail unchanged production with the original law. The same frozen model, grammar and public observations must then judge any authorized production candidate. No expectation relaxation, new identical-window timing policy, production edit, or whole-PR readiness follows from this review.

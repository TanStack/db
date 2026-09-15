# Hostile failure assay: reusable programming-evidence base

The frozen prototype admits two ways to retire a counterexample without a replay applicable to the affected use: a resolution remains effective after its evidence becomes stale, and result-delivery order substitutes for replay execution order. These are local lifecycle failures. They do not depend on hostile plugins, unrecorded context changes, production PostgreSQL behavior, or pretending a sampled pass proves a universal law.

The ten frozen tests pass. Three executable witnesses reproduce the two findings against the unchanged snapshot. The witnesses assert the observed bad state and therefore exit successfully when that state is reproduced; they are not regression tests that assert the desired behavior.

## Assay boundary and evidence

This was a fresh candidate-only audit using the full `hostile-assay` instrument card. The auditor read only `base-contract.json`, `manifest.json`, the eight listed snapshot files, and the instrument card. No sibling candidate, source arrangement, prior audit, original grammar, or parent working file was consulted. Source claims below refer to the contract's supplied source-basis labels; their equivalence to the original source was not independently checked. The contract itself calls that preservation provisional.

All eight snapshot hashes matched `manifest.json` before the report was written. No snapshot or production file was changed.

Commands run:

```sh
node --experimental-strip-types --test probes/endpoints/design/evidence-guarantees/base-stress/snapshot/kernel.test.mjs
node --experimental-strip-types probes/endpoints/design/evidence-guarantees/base-stress/hostile-witnesses.mjs
```

Results: 10/10 frozen tests pass; witnesses H1, H2a and H2b each print `status: "supported"` after the challenged claim is cleared by the disputed resolution.

This assay treats registered rules and check implementations as trusted semantic code. The witness admission rule mirrors the frozen test fixture (`kernel.test.mjs:17–27`); it does not modify the base or forge history. Its acceptance standard is deliberately the fixture's declared procedure, not an asserted universal guarantee. The relevant question is whether the base's independently promised contradiction/replay barrier still works under that admitted procedure.

## H1 — A replay becomes stale, but its resolution remains effective

**Broken claim.** Every evidence use must satisfy current applicability/freshness, and a relevant counterexample defeats support until an applicable resolution. The prototype checks replay freshness when `resolve()` is called, then treats the resolution as permanently valid. Later assessments do not check the linked replay's epoch.

**Trace.** Contract P4 / R3 / E4 (source L2/L3 and R22), R5 (L2/R22), and R6 (L4/L5) require per-use applicability, stale-evidence handling and applicable resolutions. The README says one explicit epoch invalidates all observations and describes per-use freshness as a base service. In `kernel.ts:175–179`, freshness and identity are checked once. Line 185 stores only the replay ID. At lines 209–216, any defined resolution removes the challenge from assessment regardless of the replay's present epoch. Direct support observations, in contrast, are checked against the current epoch at lines 240–247.

**Observed witness H1.** In epoch 0, record a failure for case `{input: 1}`, then record an actual same-case pass and explicitly resolve the challenge. Advance context to epoch 1. Record and propose a fresh passing observation for case `{input: 2}` only. Assessment returns `supported`. The history still shows that the resolution observation belongs to epoch 0. The only current passing observation exercises a different case.

The witness also checks the intermediate assessment immediately after the context advance: it returns `unresolved` because no fresh supporting argument exists. This narrows the defect. Ordinary support freshness works; adding a fresh unrelated pass reveals the stale resolution that was never rechecked.

**Admissibility.** The caller performs the required `advanceContext()`. Both claims and case payloads are valid JSON and remain unchanged. The replay was valid when recorded. No rule or checker is replaced and no observation is mutated. This is within the prototype's coarse epoch model, not a request for automatic dependency capture or richer matching.

**Observed versus constructed.** The stale resolution and resulting `supported` assessment are observed. A real repaired defect returning after a later code change is a constructed failure scene below. The witness does not claim such an application regression occurred.

**Repair condition.** Every assessment that relies on a replay resolution must establish that resolution's current applicability, just as it does for positive observation uses. Under the published coarse epoch rule, an expired replay cannot silently discharge the present counterexample. It must remain visible as lacking an applicable resolution until the original failure is replayed in the current context. If a durable repair certificate is intended instead, that is a distinct contract needing an explicit preservation relation and evidence; the existing epoch checks do not establish it. This assay does not select that alternative.

**Missing oracle law.** The lifecycle model resets a scalar `failures` counter to zero after resolution (`kernel.test.mjs:150–156`) and never retains the resolution's epoch or case. A later context change only clears `hasFreshPass` (`144–146`). Thus both model and implementation permanently forget the resolution's applicability. This is a false-green model, not merely an unlucky seed. Covering all adjacent operation pairs cannot fix it. Extend the history model with per-challenge resolution provenance and generate: fail case A → resolve A → context advance → pass case B → assess. Assert that B does not renew A's stale resolution. Retain the full original failure and resolution in history during that check.

**Workflow link.** `maintain-evidence.md:13–16,23–25` requires context advances and fresh evidence, but does not say that freshness also applies to evidence used to retire a challenge. `repair-rule.md:17–20` requires replay and reassessment without testing a later context transition. Add this lifecycle control to check authoring and rule repair; merely adding a warning to the maintenance workflow would leave the API's acceptance gap intact.

**Disposition.** Retained as an observed defect under the stated per-use freshness contract. If resolution is intended to be permanent, the contract and coarse invalidation claim need an explicit change rather than treating this probe as outside scope.

## H2 — Observation order is not replay order

**Broken claim.** Repair resolution must exercise the original failure again and link it to later evidence. The base uses `replay.id > failed.id` as its chronology test. IDs encode batch completion and array position, not the order in which cases were executed or measured.

**Trace.** Contract P5 / E5 / R7 (source L4) requires original-failure identity and later replay evidence; P6 (L6/L7) separates run identity from observations. The runner captures the epoch before awaiting the checker, but allocates the run ID and observation IDs only after it returns (`kernel.ts:131–147`). `resolve()` checks observation ID ordering at line 177 without checking execution order or even requiring another run. Its comment at lines 161–164 promises same-law, same-case replay. The authoring workflow requires rerunning the original failure (`repair-rule.md:17–19`).

**Observed witness H2a: one batch.** A single `run()` returns a failing finding followed by a passing finding with identical claim and case data. Both observations have `run: 1`. The base accepts the pass as resolution because it has the larger observation ID. It then supports the claim. There was no separate replay execution. Reordering the same returned findings would change resolution eligibility, even though array order has not been declared to encode measurement chronology.

A check can legitimately execute a failure and a repair replay inside one run, so same-run membership alone does not prove every such resolution false. The finding is that this interface supplies no evidence to distinguish that history from two unordered observations. H2b supplies the stronger concrete ordering counterexample.

**Observed witness H2b: delayed delivery.** Start a check that has already measured a passing result but has not delivered it. Run a second check and record a failure for the exact same law and case. Deliver the already-measured pass. Because the older execution completes later, the base assigns it a larger run and observation ID. It accepts that observation as the failure's replay and returns `supported`. No case was exercised again after the failure.

**Admissibility.** `run()` is asynchronous and supports overlapping executions without documenting serialization as a caller obligation. The frozen suite already tests a run that spans a context advance (`kernel.test.mjs:205–220`), so delayed delivery is part of the supported local API boundary. A trusted checker can report observations made at different times; the witness does not require it to lie or return fabricated values. The issue is chronology metadata, not checker semantic equivalence or hidden dependencies.

**Observed versus constructed.** Both accepted resolutions are observed. H2b deliberately controls a promise to construct an execution ordering; it proves the API accepts a measurement taken before the reported failure as a later replay. It does not prove any production checker currently has this timing.

**Repair condition.** A resolution must carry enough runner-established causality to show the cited measurement re-exercised the original case after the failure that it resolves. Completion sequence and within-batch position cannot establish that relation. A distinct run ID allocated at start may help distinguish runs but is not, on its own, proof of measurement order. If concurrent/same-run replay is retained, the contract needs an explicit execution/measurement relation; if it is excluded, the runner must enforce the exclusion. The assay does not choose between these designs.

**Missing oracle law.** The lifecycle generator awaits every run before choosing its next operation (`kernel.test.mjs:137–155`). Each generated observation uses the same case and each replay is freshly run in the resolve operation. Its model has no start, measurement, delivery or batch-order events. The separate delayed-run test checks epoch staleness only. Add generated interleavings with separate start/measure/deliver events and multi-observation batches; assert that delivery order or array permutation alone cannot make an earlier pass eligible to resolve a later failure. A fault control should replace causal replay eligibility with observation-ID ordering and require the unchanged oracle to detect it.

**Workflow link.** `design-check.md:35,66–68` asks for histories, replay and preservation of failing inputs, but does not require execution causality in the replay format. `repair-rule.md:17–19` states the right action; the base currently accepts a weaker event. A package author following the prose can still wire `resolve()` to a late result and receive apparent success. Add replay-causality controls to the package's declared replay format and sensitivity tests.

**Disposition.** Retained as an observed replay-admission defect. Same law and same serialized case are necessary but not sufficient to prove that an event is a replay.

## Concrete failure scene

A developer records a helper failure on case A. The repair passes A and closes its challenge. Later, a refactor changes the helper; the developer correctly advances the context. A quick campaign passes case B and the existing registered route accepts that observation. The base reports the helper supported because A's old resolution is still marked closed, even though its observation is stale. A dependent argument can now use the helper premise. The defect on A may have returned, but no current replay has checked it.

Everything in the base-state sequence is executed by H1. The returning helper defect and a consumer acting on the resulting support are the constructed part of the scene. Consumer permission remains separate; this assay does not claim the prototype enables an optimization itself.

A second scene is a slow CI check delivering an earlier pass after a faster job has already reported the same failure. A repair handler selects the numerically newer result and calls `resolve()`. H2b proves the base accepts it despite the lack of post-failure execution.

## Material rejected and bounded attacks

| Attack | Disposition and reason |
| --- | --- |
| One passing conjunct substitutes for a missing premise. | Not reproduced. `children.every()` enforces all declared premises (`kernel.ts:272–273`); the forward-chaining oracle covers generated AND/OR clause sets. This is bounded evidence, not proof for every rule schema. |
| A support cycle certifies itself. | Not reproduced. Ancestor tracking rejects circular routes (`227–229`) while allowing independently grounded alternatives. Frozen oracle passes. |
| An unregistered argument grants support. | Rejected by lookup (`232–236`), covered by the frozen test. Argument proposal alone grants no support. |
| Mutating returned history, observations, or the rule's inspection inputs rewrites stored observations. | Not reproduced. The relevant boundaries clone data (`132`, `158`, `188–192`, `257–261`), and the frozen mutation test passes. Hostile process access remains excluded. |
| A direct returned failure can be dropped by a caller selecting only green findings. | Not reproduced for a valid returned batch. Recording and challenge creation precede return (`149–158`). A checker that never reports its failure is outside the trusted-check boundary. |
| An unrelated pass or wrong case closes an unresolved challenge without `resolve()`. | Not reproduced. The challenge remains open; explicit resolution compares exact claim and full case (`178–179`). H1 is the different transition where a once-valid resolution later loses freshness. |
| A checker can swap its comparator or lie under the same producer name. | Excluded trust-boundary attack. The README explicitly assigns checker/case semantic equivalence to packages. No hostile-host authentication guarantee is claimed. |
| The base proves broad PostgreSQL completeness from compiler fixtures. | Excluded scope expansion. The example and README state fixture-only semantics and no production PostgreSQL integration. The possible-worlds oracle tests the inference given complete bounds, not the compiler's ability to produce them. |
| Returning to old bytes renews a previously stale positive observation. | Not reproduced when the caller advances context as required; direct support checks the epoch. H1 concerns negative-evidence resolution, not this covered positive-evidence path. |
| A grounded independent argument must fail because an unused alternative's premise is contradicted. | Rejected under the candidate's AND/OR semantics. The code explicitly treats a failed premise as defeating its route, not every independent route (`290`). History retains the challenge. |
| Old failures overblock changed versions or narrower scopes. | Declared limit, not a discovered bug. Exact identity and absent cross-version/subsumption mapping are explicit. The repair workflow requires uncertainty to remain visible when versions cannot be matched. |
| No automatic context capture, expiry, durable runner delivery, source-inspection API, or production consumer enforcement exists. | Explicit prototype limits, not findings. This report does not require them to close H1/H2. |
| Sample counts or completion of authoring steps silently become universal proof. | Not found in the workflow text. `workflows/README.md:13–15` rejects that inference; design steps require scope, assumptions, sensitivity controls and retained original requirements. Arbitrarily unsound registered semantics remain a declared trust risk. |
| Operational errors are recorded as correctness failures. | Not reproduced. A throwing check does not reach commit; the frozen operational-error test passes. Mixed malformed batches are not probed as an in-contract correctness failure because the typed interface requires valid findings and validates before commit. |
| Workflow recommends global strictness for all unknown support. | Not found. Permission/severity are deferred. The repair workflow's specific fallback for a relevant contradiction is not a general unknown-evidence policy. |

## Bounded readout and remaining uncertainty

The observed defects sit at the connection between immutable history and current resolution meaning. Keeping a failure record intact is not enough if its closed flag can rely on stale or causally earlier evidence. The authoring procedures contain useful scope and test disciplines, but the frozen controls do not yet test these two transitions.

No broader architecture is ranked or recommended here. No rule soundness, source-preservation equivalence, general semantic matching, or production integration claim is established by this assay. The report ends with two retained findings and explicit dispositions for the other material attacks; no code or policy was changed.

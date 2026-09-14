# Oracle guide: cases, terms and sources

Companion to [Writing reliable oracle tests](oracle-tests.md). These notes keep evidence and deeper reading off the quick-start path. The historical entries describe archived reports and audits, not current failing tests or reruns performed for this guide.

## A short glossary

| Term | Meaning in this guide |
| --- | --- |
| Oracle | The rule or mechanism that judges behavior. |
| Property or law | A claim expected to hold for the declared inputs and histories. |
| Reference model | A simpler computation or state machine used to judge production. |
| History | Starting conditions and a sequence of actions/events; may include their dependencies and timing. |
| Driver | Test code that invokes production and controls relevant external events. |
| Observation / trace | Recorded behavior; a trace preserves a sequence, not just its final state. |
| Checkpoint / observation cut | The specific point at which a promise is checked. |
| Projection / abstraction | Retaining the parts of concrete state relevant to a chosen judgment. |
| Refinement | Implementation-visible behaviors are permitted by the specification; a sampled test is not a proof of this for all behaviors. |
| Metamorphic relation | A justified relation between executions derived by a transformation. |
| Partial oracle | A check of some promises, not the entire correct result. |
| Reach witness | Evidence that the scenario exercised its claimed boundary. |
| Fault control / mutant | A deliberate wrong answer or implementation change used to test sensitivity. |
| Shrinking | Reducing a failing input/history while retaining the relevant failure. |
| Bounded exhaustiveness | Every case within explicitly stated finite bounds, not every possible execution. |
| Held-out challenge | A challenge not used to shape the design being tested. Once used for tuning, keep it but change the claim. |

## Historical cases

These retained case notes come from the September 11–14, 2026 research archive. The Source column preserves archive record titles and line ranges, not links that require a maintainer's local checkout. These are reported historical observations, not independently rerun claims. The public [design-audit account](https://github.com/TanStack/db/issues/1808#issuecomment-5640113102) records the portfolio's method and several of the same scenes. Do not treat that account as independent corroboration.

| Case | Distinction and evidence status | Source |
| --- | --- | --- |
| Same-turn mismatch repaired by a microtask | Reported harness correction: unconditional awaiting changed the observation point. Cleanup suppression preserved the primary error, but did not establish secondary-diagnostic retention. | *August 12 history* (research archive), lines 284–340 |
| Reachable objects versus construction | Reported repair both renamed the metric and checked source delivery before/after traversal. The decision against a test-only allocation seam was local, not a proof that allocations cannot be measured. | *August 15 history* (research archive), lines 32–96 |
| FIFO waiting versus a test's proposed liveness | Direct historical user choice accepted FIFO waiting. The expectation had to respect that choice; the passage does not establish a final execution result. | *August 24 history* (research archive), lines 247–285 |
| Finite scores omit the predicate's tail | A model limited to scores ≤3 made `score > 3` falsely empty. Truly empty IN was a separate question. | *Early loss report* (research archive), lines 135–139 |
| Source-owned ordering | Reported withdrawn accusation: sorting visible optimistic values modeled the wrong state for the promised position. | *Middle loss report* (research archive), lines 176–178 |
| Ownership after rejected Promise | Reported lease obligation remained after Promise rejection; clearing ownership was not a valid repair for that API. A separate identity proposal compared a wrapper rather than the detached snapshot. Neither is a universal adapter rule. | *September 10 history* (research archive), lines 132–158 |
| Four receipt positions, two timing questions | Reported correction retained later pending peers for rejection timing, exact rejection identity and intact partial-prefix rows. The `allSettled` mutant died by timeout; terminal position alone cannot expose waiting for a later peer. | *August 29 history* (research archive), lines 564–611 |
| Helpful repeated-page provider | Reported provider prefilter supplied unrequested progress. This followed a distinct joined-alias underfill finding; they are not one mechanism. | *September 8 history* (research archive), lines 207–225 |
| Old-left/new-right publication | Reported asymmetric update exposed mixed graph state; copying evidence before cleanup preserved the local witness, not a universal deep snapshot. | *September 7 history* (research archive), lines 192–222 |
| Useful sort fixture, permissive assertion | Source audit identified a change to a nonprojected sort field but only an arbitrary-difference assertion. An accepted wrong-output argument, not a fresh mutant run in that audit. | *Framework audit* (research archive), lines 59–72, 82–98 |
| Empty callback loops and lost delta evidence | Source audit identified absent count checks, reset trackers, missing anchors and erased multiplicity. Predicted blind spots were not all executed mutations. | *Adjacent audit* (research archive), lines 56–61, 82–98 |
| Valid input, violation-capable output | Grammar correction separates lawful scenario construction from raw recording and explicit rejection of duplicate completions. The example is analytical. | *Grammar evidence* (research archive), lines 13–25 |
| Count-equal owners distinguished by release | Analytical counterexample motivates sufficient model state under an explicit support contract. Not a report that a provider must evict rows. | *Grammar hostile check* (research archive), lines 77–138 |
| Retry replaced by deletion | Secondary historical report says restoring the retry expectation exposed lost pending delta. Another branch cut retained the first-sort law; deletion itself is not the criterion. | *Middle loss report* (research archive), lines 194–200 |
| Adapter without unload | An invented second-fetch expectation was corrected. Preserve valid laws, not every assertion ever written. | *Early loss report* (research archive), lines 161–165 |
| React tied-rank continuation | Source audit credits exact visible prefixes/exhaustion through a specific integration and finite provider; not page arrays, every framework or generic endpoint behavior. The capped-provider example remains deliberately nonconforming, not an acceptable success contract. | *Framework registrations* (research archive), lines 57–74 |
| Unclaimed startup failure | Analytical audit: a list derived only from ten settled-result suites misses a known startup-rejection promise. | *Grammar hostile check* (research archive), lines 33–74 |
| Two green mocks, untested connection | Conditional component guarantees need a witness for the premise at the real connection. This was a grammar repair, not runtime evidence. | *Grammar evidence* (research archive), lines 6–12 |
| Replay registration versus execution | Source audit distinguished parser membership from dispatch. Some registrations looked stale only because discovery was incomplete; later reported positive controls cannot retroactively prove those old names dead. | *Campaign audit* (research archive), lines 3–21; *completion report* (research archive), lines 39–59 |
| Assertions passed, process failed | The report retained both passing assertions and nonzero exits, with the clean stress gate still blocked. This is a historical status, not the current suite result. | *Completion report* (research archive), lines 30–59 |

Other retained examples include a narrow two-transition grammar finding no new defect, fresh disjoint rows omitting retired-key interactions, and recovery followed by further work with healthy peers. A no-new-bug run is useful negative evidence within its actual grammar, not evidence of completeness. See *early loss report* (research archive), lines 65–77 and 107–111, and *adjacent audit* (research archive), lines 138–140.

Three further assertion contrasts are useful during review: production parity does not establish independent normalization; absence of a throw does not establish the terminal effect; eventual retry counts do not establish exact intervals. These were source-audit observations, not all executed mutants. The projection correction also retained a dependent final-state check as well as contractual virtual fields; preserving fields alone does not preserve that observation. See *adjacent audit* (research archive), lines 100–114, and *middle loss report* (research archive), lines 180–182.

The prior external-review ledger also records three useful distinctions: a leadership flap is not an unchanged report; a storage error belonging to B can expose a different obligation from a mutation error belonging to A; and an observed old-reader/new-record corruption can coexist with an unresolved compatibility policy. Its work-count probe recorded 100 irrelevant payload reads versus zero while leaving the elapsed-time multiplier unverified. These are prior probe records, not benchmarks rerun for this guide. *Ledger* (research archive).

The decisive continuation in the storage case was that rejected A remained queued and later executed. Another crossed input case combined an own `__proto__` data key with a sibling-object edit to expose change extraction; the baseline already mishandled the key, so it was not wholly a newly introduced bug. Both remind us to vary relationships among inputs and later actions, not just input sizes.

## Research and further reading

The source survey was collected on September 11, 2026. It stopped at its twenty-source budget while still finding useful limits. It was not exhaustive; no paper's experiments were rerun. Mutable documentation reflects that retrieval, not a guarantee about this repository's installed versions.

### Models and the limits of agreement

- [fast-check model-based testing](https://fast-check.dev/docs/advanced/model-based-testing/): commands, preconditions and replay; warns against copying the system into the model.
- [The Existence of Refinement Mappings](https://lamport.azurewebsites.net/pubs/abadi-existence.pdf): formal work on relating visible behaviors. Its assumptions do not validate an executable library model automatically.
- [The Oracle Problem in Software Testing](https://discovery.ucl.ac.uk/id/eprint/1471263/1/06963470.pdf): a scholarly survey used for vocabulary and abstraction failures, not independent corroboration of every cited experiment.
- [Reliability of life-critical software](https://shemesh.larc.nasa.gov/paper-nonq/nonq-paper.pdf): distinguishes separately written programs from statistically independent failures. Its ultrareliability argument does not estimate the benefit of this team's reference models.

Keep three ideas separate: a model's structural simplicity, separate construction, and measured overlap of failures. None is a numeric substitute for another.

### Histories, shrinking and bounded exploration

- [QuickCheck](https://www.cs.tufts.edu/~nr/cs257/archive/john-hughes/quick.pdf): property testing with programmer-controlled input distributions and ways to inspect them.
- [Hypothesis stateful testing](https://hypothesis.readthedocs.io/en/latest/stateful.html) and [strategy design](https://github.com/HypothesisWorks/hypothesis/blob/master/guides/strategies-that-shrink.rst): applicable actions, value dependencies and constructive shrinking. Neither promises a globally minimal counterexample.
- [SmallCheck](https://pure.york.ac.uk/portal/en/publications/smallcheck-and-lazy-smallcheck-automatic-exhaustive-testing-for-s-2/): exhaustive exploration within bounded depth. Only the institutional abstract was available to this survey; no comparative performance claim is drawn from it.
- [Alloy's tutorial](https://alloytools.org/tutorials/online/maintext-FS-2.html): examples of small bounds missing a counterexample and overconstraint leaving no admissible model. Exhausting an empty domain is not useful success evidence.

### Scheduling and environment fidelity

- [CHESS](https://www.usenix.org/legacy/event/osdi08/tech/full_papers/musuvathi/musuvathi_html/index.html): bounded systematic scheduling through modeled interfaces; the environment still owns deterministic inputs and reset.
- [fast-check race-condition guide](https://fast-check.dev/docs/advanced/race-conditions/): what scheduled Promise results do and do not control.
- [FoundationDB system paper](https://www.foundationdb.org/files/fdb-paper.pdf): authors report recovery checks, limits of simulation and bugs caused by stronger-than-real operating-system assumptions. They also report tuning fault injection because too many faults can prevent reaching useful states. This is a separate industrial account, not corroboration of our receipt fixture or a universal fault-rate prescription.

Deterministic replay within a harness and fidelity to the real provider are separate claims.

### Relations between executions

- [Metamorphic testing's original report](https://arxiv.org/abs/2002.12543): deriving related tests when individual answers are unavailable. Only the author abstract was usable in the survey; no effectiveness estimate follows.
- [NoREC](https://arxiv.org/pdf/2007.08292) and [SQLancer](https://github.com/sqlancer/sqlancer): query transformations, different oracle strategies, shared-bug limits and semantic exclusions. Input guidance and correctness judgment remain distinct.
- [DBSP](https://www.vldb.org/pvldb/vol16/p1601-budiu.pdf): accumulation/difference laws for incremental computation, not a choice of client publication policy. The surveyed treatment also has explicit convergence limits for unbounded domains; the guide's finite example does not transfer a convergence guarantee to recursive or unbounded work.
- [Materialize's 2024 QA account](https://materialize.com/blog/qa-process-overview/): different checks for different surfaces. Generic SQL fuzzing did not cover every source, sink or materialized-view behavior; alternative answers can both be valid. This is a dated maintainer account, not a current coverage audit.

### Mutation evidence and economics

- [Are Mutants a Valid Substitute for Real Faults?](https://homes.cs.washington.edu/~mernst/pubs/mutation-effectiveness-fse2014.pdf): selected real-fault coupling, with faults outside the studied operators.
- [Are Mutation Scores Correlated with Real Fault Detection?](https://coinse.github.io/publications/pdfs/Papadakis2018hi.pdf): suite size changes how correlations should be read; guidance for improving tests is not a calibrated reliability score.
- [Long Term Effects of Mutation Testing](https://research.google/pubs/long-term-effects-of-mutation-testing/): industrial test-writing effects and fault observations. The survey inspected the institutional abstract, not the full causal study design.

These sources ask different questions and do not justify pooling their percentages. The survey did not establish comparative long-term maintenance costs, a score-to-reliability conversion, optimal fault rates or a benefit estimate for bespoke holdout mutants. Missing evidence in this bounded survey does not mean no such research exists.

## Provenance and publication limits

The guide combines historical reports, source-level audit findings, analytical counterexamples, established methods and clearly labeled illustrations. It does not claim complete coverage of the production state space, prove a minimum oracle architecture or settle new product contracts.

A supplied [testing-design gist](https://gist.github.com/KyleAMathews/72e0cb6f5f6bd36cac1332ea91893b44) influenced the archived grammar. The record initially treated a partial reading as insufficiently consequential, then corrected that judgment after the full text was considered. It added explicit input/recorder and cross-suite-premise obligations. The later record supersedes the earlier “no changes” assessment; source ingestion itself is not runtime validation. Its webhook account and example APIs were not independently executed for this guide. Its advice to broadly disable shrinking was not adopted.

The guide's reference and ordered-comparison helpers are dependency-free JavaScript. The TLP partition rendering is an illustration; the archived SQLancer inventory establishes the strategy's broad query/recomposition relation, not an executed implementation of this example. The production loop is explicitly pseudocode. There is no runnable TanStack/fast-check integration recipe yet, and this guide must not be advertised as supplying one. The guide is accompanied by the repository's [coverage and closeout record](oracle-coverage.md). Historical archive titles above preserve provenance without pretending to be public permalinks. Runnable production examples are linked from that record; the guide's illustrative loop is not an executable integration recipe.




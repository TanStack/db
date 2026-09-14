# Evidence and controls

Second exploratory Design Grammar, analysis version 1. Item IDs refer to [Model](./model.md) and [Process](./process.md). Source file hashes are in [source-freeze.json](./source-freeze.json).

## Evidence register

| ID | Source and coverage | What it establishes / does not establish |
| --- | --- | --- |
| E1 | [Current runtime](../../integrated-todo/src/runtime.ts) | Synchronous Transaction action, query-owned cached instances, captured direct targets, RPC then refetch, narrow scope/order. No automatic cross-collection propagation or general demand registry is inferred. |
| E2 | [Bound compiler](../../integrated-todo/bound-transform.mjs), [extractor](../../track-a-analysis/probe.mjs) | Narrow recognition with `not checked` reasons and explicit assumptions; binder turns failed extraction into an error. General dependency/effect analysis is absent from this path. The separate catalog-backed check is not called by this binder. |
| E3 | [Saved coherence failure](../../integrated-todo/evidence/e2e-current/coherence/replay.json), [prior grammar evidence](../design-evidence.md), [local source notes](../local-source-notes.md) | Two equivalent active results diverge during one optimistic insert. Existing DB composition/snapshot distinctions support conditional variation. No core DB bug or general publication contract is established. |
| E4 | [Multi-table probe](../ground-conditions-multitable.md) | Constructed distinctions between prediction reads, predicted/actual writes, query dependencies and sufficient coverage. Unchanged/unloaded join partners can defeat a complete-changed-row payload. Analytical comparisons, not multi-table endpoint executions. |
| E5 | [Term scan](../terms-correctness-and-support.md), [information trace](../mutation-information-map.md) | Separates tentative/committed/synced/error meanings, analysis from execution validity, and source provenance from database observation revisions. Source continuation is not represented as observed completion of the failed oracle run. |
| E6 | [Sharing script](../result-sharing-probe.mjs), [measurements](../result-sharing-measurements.json), [readout](../ground-conditions-result-sharing.md) | 30 histories and 327 correctness checkpoints; corrupted order/membership detected; conflicting same-key projection refused. Sharing saves about 33% gzip in the largest overlapping case and adds about 33% in the disjoint case. Warm PGlite timings and one candidate only. |
| E7 | [Demand discussion](../design-model.md#activity-and-dependency-selection), [public subscriber API](../../../../packages/db/src/collection/index.ts:425) | Subscriber count/change are concrete inputs. General demand, lifetime, and late-activation policy are not implemented by the endpoint runtime. |
| E8 | Exact user comments in the Field Log, reflected in [preservation](./preservation.md) | Bounded initial support, explicit unanalyzable exits, inline full-result fallback, optional combined results, no implicit queue, ordinary writable API, and independent oracle/performance requirements. Agreement supplies requirements, not empirical validation. |

## Reconstruction results

**RC1 — Current Endpoints arrangement: analytical source reconstruction passes.** The five units and five relations account for separate query-owned results, direct tentative ownership, narrow emitted metadata, the second collection's missed optimistic row, and the code's later RPC/refetch path. R1–R12 are transformation constraints: they do not falsely describe all desired obligations as implemented. The reconstruction specifically retains failed extraction as current compiler rejection and current client refetch as historical behavior. Step-by-step reconstruction is in Process.

**RC2 — Experimental sharing path: bounded reconstruction passes.** One authoritative result construction can independently vary evaluation (three SQL calls versus one shared join statement) and encoding (arrays versus row pool/references). M4/A6/C6/C7 describe those variations without adding a new public source collection or treating the row pool as durable normalized state. E6 supplies actual narrow correctness/cost evidence; reconstruction of that evidence is analytical.

**RC3 — Required fallback arrangement: source-to-target distinction retained.** E8 chooses full evaluation/results in the mutation response. E1 still uses a later client read. R5 is therefore a user-required transformation, not a reported completed implementation. U3/U4 retain the missing server knowledge of active validated instances, and U2 retains usable observations/publication. This is a representable desired form, not a passing implementation test.

## Exclusion controls

- **NC1 — Unsupported analysis means no affected queries:** R1/R3/R4/R6 exclude the inference. This is an analytical negative: no effect requires sufficient evidence, while missing evidence retains candidates. It does not certify that any actual classifier is sound.
- **NC2 — Same ID, different projected values:** E6's guard actually refuses this input. M1/M2/A2/R7 retain that exclusion. The framework form cannot silently merge the rows merely because a pool did so for identical values in the supported fixture.
- **NC3 — Shared encoding always shrinks responses:** The measured disjoint case falsifies the claim. R8/C8 preserve the counterexample; no “always share” form is admitted as cost-preserving.
- **NC4 — Complete mutation images determine every join result:** E4's unchanged customer-label comparison excludes that claim via C3/C4/R6. This is analytical information insufficiency, not a measured endpoint failure.
- **NC5 — A skipped read implies no settlement work:** R2/R4/R9 exclude abandoning a tentative participant merely because the actual server branch did not affect its result. This is a newly explicit inference from E4/E5; its general runtime handling is untested.
- **NC6 — One response certifies atomic publication or a current global snapshot:** R9/U2 exclude this unsupported inference. No timing experiment in E6 tested those properties.

## Range, loss, and destabilized claims

**RG1 — Independent range untested.** No supplied case remains outside extraction context. Prior oracle cases, multi-table examples, and sharing measurements are source/control material, not held-out validation. No fresh agent is used to relabel them as independent. No new external case was searched for.

**DC1 — False universal support is removed.** E2's accepted syntax can still depend on trusted assumptions and does not establish all downstream optimization facts. The grammar retains evidence per decision instead of a universal supported/unsupported flag.

**DC2 — False modularity is removed.** F1/F2 change publication, lifetime and inverse-write dependencies together. They are rule-combination forms. The tested wire reconstruction interface cannot certify the framework storage boundary as modular.

**DC3 — Benefit and safety separate.** E6 establishes that a correct reconstruction can increase bytes and local time. It does not establish a universal cost estimator or a rule that sharing should never be used for low overlap under other conditions.

**DL1 — Material decomposition loss.** Units and evidence annotations make effects, coverage, authority and demand look inspectable in isolation. The actual challenge is obtaining and maintaining those facts through arbitrary handler logic, schema changes, pending mutations, and activation. No facts appear merely because the model has a field for them. Correlated derivation mistakes can survive both a metadata producer and its consumer; independent oracles remain necessary.

**DL2 — Cost-model loss.** Six warm fixture cases omit deployed database/network behavior, actual mutation-response framing, browser DB apply, request descriptors, concurrent load and planner overhead. No architecture ranking, production threshold, or broad performance guarantee follows.

U1–U6 remain unresolved. In particular, the desired full-result fallback does not resolve exact optimism for unsupported cases, and the grammar does not silently weaken the user's coherence aim to call those cases solved.

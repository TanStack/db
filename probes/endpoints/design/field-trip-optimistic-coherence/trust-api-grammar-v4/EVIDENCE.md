# Evidence — TanStack Trust API Design Grammar v4

This layer records why the Model units survived and where the source set does
not support the reading. It does not add design units beyond `MODEL.md`.

## Source basis

| ID | Material | Role in this extraction | Main limit |
|---|---|---|---|
| S01 | TanStack Trust RFC v0.3 | Authority, evidence graph, lifecycle, interfaces, Endpoints incubation, open decisions | Architectural proposal, not an implementation contract |
| S02 | Design Grammar run 57 | Frozen v2 primitives, reconstruction, use cases, ablations, and unresolved conflicts | Same home problem and analyst lineage |
| S03 | Protocols Institute survey | Hardness/softness, enactment, evolution, differentiated trust, observability, stigmergy | Institutionally related, largely conceptual English-language corpus |
| S04 | Blind donor perturbation | Ant traces, US&R markings, B-cell selection, and three nearby negative controls | One model family; transfer remains analogical and unimplemented |
| S05 | TypeSafe System One Models article | Typed probabilistic decisions, fixed output algebra, workflow composition, calibration claim | Vendor launch article; semantic reliability and benchmarks unverified |
| S06 | Kyle's linter requirements | Familiar diagnostics plus package and project-local rule/check extension grammar | User-required target, not independent evidence that the design works |
| S07 | Preservation contract v4 | Exact-equivalence properties and Endpoints-only boundary | Contract constrains the reading; it does not prove the model |
| S08 | Evidence-base prototype | Existing kernel, store, Endpoints check, service, CLI, LSP, MCP, and tests | Bounded prototype; incomplete APIs and single-process persistence |
| S09 | Oracle Guide | Law, reach, observation, replay, failure capture, cleanup, and portfolio credit distinctions | Oracle-specific guide; broader method algebra remains unimplemented |

Exact paths and hashes are in `sources.json`.

## Preservation map

| Contract | Model support | Control |
|---|---|---|
| PC4-01 domain ownership and extensibility | M02–M06, M11, R01–R04, R17, `TrustRule` | UC07; ablate M02/M03/M11 |
| PC4-02 claims precede evidence | M04, M05, M07, R05 | ablate M04 |
| PC4-03 method-specific evidence | M06–M09, R06–R08 | UC08; ablate M06/M07 |
| PC4-04 argument structure | M05, M08, X01, R05/R09 | ablate M05/M08 |
| PC4-05 stigmergic traces are not evidence | X02, X03, O06, R11 | UC01/UC02; N01 exclusion |
| PC4-06 distinct histories and clocks | M01, M03, M07–M12, R03/R10/R13 | UC02/UC05; ablate M01 |
| PC4-07 causal challenge and repair | M09, M10, R10 | UC01; ablate M10 |
| PC4-08 actionable diagnostics | X02, X04, O08, R14 | UC01; ablate X04 |
| PC4-09 proposal is not authority | M02, M06, M11, O01, R02/R17 | UC07; N03 exclusion |
| PC4-10 probability/admission/policy separation | M06–M08, M11/M12, O03/O07, R07/R08 | UC08; N03 exclusion |
| PC4-11 one linter-shaped service and extension model | M02/M03, M09, X02–X06, R12–R17, F01–F03 | UC01–UC08; adapter-model compression |
| PC4-12 bounded completeness | R18, range and negative controls, unresolved register | layer reconstruction |

## Observation and inference ledger

### Source-stated or user-required

- **E-O01:** Domain packages own claim meaning, methods, adequacy,
  applicability, source mapping, and domain language; Trust owns evidence
  mechanics; consumers own action. (S01, S02, S07)
- **E-O02:** Claims, observations, routes, applicability, challenge, admission,
  work, and policy answer different questions. (S01, S02, S09)
- **E-O03:** Work and conditions can coordinate agents asynchronously, but
  popularity and activity cannot become evidentiary strength. (S03, S04)
- **E-O04:** Subject-attached records need exact identity, producer, time,
  method, depth, omissions, and changed-condition reinspection. (S04)
- **E-O05:** Candidate generation, external evaluation, admission, and durable
  retention remain different authority relations. (S04)
- **E-O06:** Typed fixed-algebra model outputs can be composed directly by
  software and accompanied by probabilities. The supplied article does not
  establish that those outputs are semantically correct. (S05)
- **E-O07:** Trust should feel like linting for agents: stable codes, source
  diagnostics, severity/configuration, suppression, fixes, CI output, packaged
  rules, per-project enablement, and easy local rule authoring. (S06)
- **E-O08:** The same lifecycle semantics must project through TypeScript, CLI,
  LSP, MCP, Devtools, and work APIs. (S01, S02, S06, S07)
- **E-O09:** The current prototype already separates three-valued outcome,
  dependency revisions, operation reach, challenges, exact replay, and a shared
  adapter service, but exposes only a narrow operation set. (S08)
- **E-O10:** A rule or check can pass within declared coverage without proving
  analyzer completeness, liveness, or universal correctness. (S01, S08, S09)

### Analyst-inferred and control-dependent

- **E-I01:** `TrustModule` and `ProjectTrustConfig` must be separate primitives
  because installed, enabled, admitted, and action-permitted are independently
  variable states. Supported by UC07 and M02/M03/M11 ablations.
- **E-I02:** A linter-style `TrustRule` should be an authored bundle lowered to
  claim, route, method, and presentation units rather than a stored semantic
  atom. Supported by PC4-04 and R04 reconstruction.
- **E-I03:** `EvidenceMethod` must become first-class rather than remain an
  opaque callback inside a package because probabilistic evaluator identity,
  schema, calibration, coverage, and admission must be independently traced.
  Supported by UC08 and M06 ablation.
- **E-I04:** `TrustCondition` remains the shortest shared normalization for LSP,
  work, CI, policy comparison, and Devtools. Supported by X02 ablation and
  adapter-model compression.
- **E-I05:** A project-wide `off` changes the active configuration, whereas a
  source-local temporary suppression is a scoped policy override. This avoids
  importing conventional linter deletion semantics. The exact syntax remains
  unresolved.
- **E-I06:** A mutating `check` run and a side-effect-free `report` query must be
  distinct even if a linter facade offers both. Supported by M09, R12, and the
  tandem/radio negative controls.
- **E-I07:** Domain adequacy and consumer action may both inspect a probability
  distribution, but neither may replace it with an unscoped Trust confidence
  score. Threshold ownership remains partially unresolved.

## Source claims deliberately not transferred

- “Cannot hallucinate” is retained only as “cannot emit a value outside the
  declared output algebra.” A schema-valid decision can still be wrong,
  miscalibrated, inapplicable, or produced outside its admitted range.
- Jev's speed, cost, Pareto-frontier, and calibration claims do not enter the
  grammar because they were not independently reproduced.
- Linter severity does not become evidence status. `error`, `warn`, and `off`
  remain configuration or policy projections.
- A conventional inline suppression that makes a finding disappear does not
  transfer. Trust retains the condition and records the authority, scope,
  rationale, and expiry of the exception.
- Package installation does not confer admission, and local authorship does not
  confer weaker or stronger truth status.
- Ant pheromone popularity, one global decay constant, a universal rescue-mark
  vocabulary, and a universal immune-review topology do not transfer.

## Control results

| Control | Result | Evidence status |
|---|---|---|
| Source reconstruction | All eight use cases reconstruct from M01–M12 and X01–X06 | Model pass, not executed API test |
| Component ablation | Every retained primitive and active projection breaks a contract property, use case, or negative exclusion when removed | Model pass |
| Compression | Separate adapter status models, generic confidence, policy-bearing evidence, task-as-proof, and monolithic rule storage were rejected | Model pass |
| Negative N01 | Closing work or increasing task popularity cannot support a claim | Excluded by R11 |
| Negative N02 | Suppression cannot erase the condition or produce a clean evidence state | Excluded by R13 |
| Negative N03 | A typed model evaluator cannot admit itself or turn schema validity into semantic support | Excluded by R02/R08 and M11 |
| Donor controls | Tandem running and radio dispatch reject “everything is a trace”; T-independent activation rejects “output proves authority path” | Source-backed transfer boundary |
| Range | No held-out Trust implementation or second domain package exists | Untested beyond Endpoints |

## Range and uncertainty

Endpoints, the RFC use cases, the prototype, and the agent workflows shaped the
extraction; none is independent range evidence. The linter ecosystem is a
user-required interface and extension-model analogy, not a second Trust
implementation. The donor systems test relations and overextension, not API
fitness.

The sources do not settle:

- the exact module manifest or configuration syntax;
- whether project configuration can activate an admitted package definition
  automatically or needs an additional project admission record;
- the semantic-versus-action threshold boundary for probabilistic methods;
- the authority topology for admitting project-local rules;
- the exact suppression syntax and default expiry;
- persistence, sandboxing, signature, multi-writer, or hostile-process design;
- polling versus streaming change delivery; or
- actual agent effectiveness, performance, and usability.

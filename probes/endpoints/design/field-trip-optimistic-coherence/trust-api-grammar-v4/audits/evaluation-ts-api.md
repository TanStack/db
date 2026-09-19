# Evaluation — TypeScript/linter API audit

- Evaluated source: `raw-ts-linter-audit.md`, items T-01 through T-52.
- Checked commit: `4ad19815b44be533ac10f90b62aca4377f5138d2`.
- Checked working tree: the v4 grammar and most prototype adapter work are untracked or modified relative to that commit, as the initial ledger records.
- Evaluation rule: v4 is a proposed design grammar. A missing concrete TypeScript type, transport, or implementation is not by itself a contradiction. It becomes a defect when the frozen grammar makes an incompatible semantic claim, a model-only control is represented as implementation evidence, or the bounded prototype exhibits the claimed behavior.
- Candidate artifacts were not changed. Only this evaluation was added; probes used inline programs and temporary directories.

## Reviewer assessment

The reviewer has strong architectural instincts and unusually broad coverage. The review correctly finds the hardest internal semantic gaps (bootstrap-invalid configuration, condition lifetime, editor overlays, disabled-but-required rules), notices the source-freeze gap, and identifies several reproducible prototype/API defects. It also preserves useful type- and adapter-contract test ideas.

Accuracy is good but calibration is uneven. Many Blocker/Critical/High findings treat deliberately unresolved API-profile choices or absent implementation as contradictions even though `BRIEF.md:56-66`, `PROCESS.md:215-250`, `EVIDENCE.md:115-122`, and `sources.json:72` explicitly bound the artifact to a proposed/model-pass grammar and the prototype to migration evidence. T-06 and T-15 are incorrect as framed; T-37 is directly contradicted by the model-pass label. T-36 and T-41 largely request wording or invariants already present. T-34 and T-35 are useful details of T-18 rather than independent findings.

The signal-to-noise ratio is still high: 45 of 52 items retain durable value, but the original severity distribution would make the review a poor merge gate without reconciliation. Proposed fixes are generally thoughtful and idiomatic, especially discriminated receipts, normalized config, stable references, tri-state applicability, adapter contract fixtures, and transactional staging. Some are prematurely prescriptive: signed manifests/restricted workers, a per-rule visitor contract, and remote-run attestations require threat-model or layering decisions first.

**Hire recommendation: hire, with a calibration caveat.** This is strong senior design-review work: deep, generative, and technically productive. I would not use the raw review as an unsupervised final gate until the reviewer more consistently separates a semantic contradiction, an intentionally open design decision, a future conformance test, and a missing implementation.

## Finding ledger

`Severity` shows the recommended correction. `Fix` judges the proposed repair, not whether it is authorized in this evaluation.

| ID | Technical validity | Exact evidence | Final disposition | Canonical | Severity | Fix | Durable value / destination |
|---|---|---|---|---|---|---|---|
| T-01 | Partly valid: a normative operation algebra is absent, but v4 explicitly refuses to select the F01/F02/F03 layering. | PC4-11 requires one service (`PRESERVATION.md:38-46`); F01–F03 are alternatives/layers and unranked (`MODEL.md:284-328`); C08 records that choice as open (`PROCESS.md:231`). | `design-decision` | — | Blocker only for an API freeze; otherwise Medium | Yes: one semantic algebra with façades is idiomatic; weakening PC4-11 is a product choice. | Normative API-profile decision record for C08/PC4-11. |
| T-02 | Valid risk, not a demonstrated defect: executable hooks and a side-effect-free-query invariant coexist without an enforcement model. | M02 exports executable applicability/locator/message hooks (`MODEL.md:34-41`); R12 requires side-effect-free queries (`MODEL.md:227`); hostile-process/sandboxing is explicitly unsettled (`PROCESS.md:234-236`). | `design-decision` | — | High → Medium | Partial: persisted pure DTO projections are idiomatic; a restricted runtime is a security profile, not the only solution. | Extension-execution/purity contract and deterministic-hook conformance tests. |
| T-03 | Valid future API gap, not a contradiction in a semantic primitive. | M01 specifies package/kind/version identity and envelope fields but no concrete encoding (`MODEL.md:24-32`); the bounded prototype instead uses string claims and numeric observation/run IDs (`kernel.ts:17-43`). | `deferred` | — | High → Low | Yes. Branded wire-safe refs plus codecs/equality are idiomatic. | Normative wire-reference schema and TypeScript codec fixture. |
| T-04 | Valid unresolved API/profile question. | M02 separates discovery from enable/admission (`MODEL.md:34-41`); representative config imports module values (`MODEL.md:256-265`); loader/config syntax is an admitted loss (`PROCESS.md:247-250`). | `design-decision` | — | High → Medium | Yes, although package discovery may be host-specific. | Module manifest/namespace/version-resolution profile. |
| T-05 | Valid schema-boundary question; no implemented API is claimed. | M02 and M06 say only “schemas” and input/output schemas (`MODEL.md:36-38,66-76`); F03 promises generated clients/tool schemas (`MODEL.md:313-325`) without selecting a schema protocol. | `design-decision` | — | High → Medium | Yes. Separating local inference from portable wire validation is idiomatic. | Runtime-schema and JSON-Schema equivalence contract. |
| T-06 | Incorrect as framed: semantic admission is not claimed to prevent package top-level execution, and hostile-process containment is expressly outside the grammar. | M02 says install/discovery does not admit semantic roots (`MODEL.md:36-41`); C10 places loader/sandboxing outside scope (`PROCESS.md:234-236`); prototype labels itself trusted-process and README excludes hostile isolation (`kernel.ts:187-190`; `README.md:146-154`). | `refuted` | — | Critical → Medium only for a hostile-extension deployment | Partial: inert manifests/workers/signatures can be appropriate, but are neither required by PC4-09 nor universally idiomatic for local TS config. | Separate loader threat-model/security profile; do not conflate code execution with semantic admission. |
| T-07 | Valid, explicitly open configuration semantics. | M03 promises a resolved immutable config (`MODEL.md:43-52`), while the representative tuple is illustrative (`MODEL.md:256-265`) and exact syntax is listed as unsettled (`EVIDENCE.md:132-140`). | `design-decision` | — | Medium → Low | Yes. Normalization with provenance and deterministic merge rules is idiomatic. | Resolved-config specification and table-driven merge tests. |
| T-08 | Valid ambiguity: M03 names method enablement, while the example config shows only rules/profiles. | `MODEL.md:45-48` versus `MODEL.md:256-265`. | `design-decision` | — | High → Medium | Yes. Either an explicit method section or a documented rule-owned activation law is coherent. | C02/config profile: method activation state table. |
| T-09 | Valid and already identified as unresolved rather than concealed. | M03 cannot make unadmitted definitions authoritative (`MODEL.md:50-52`); C02 explicitly leaves direct versus project-scoped activation open (`PROCESS.md:219-220`). | `design-decision` | — | High → Medium | Yes. A discovered/configured/admitted state table is the right artifact. | C02 authority/config state table and adapter expectations. |
| T-10 | Valid internal reconstruction gap: an invalid config is an X02 condition, but no pre-config read boundary exists to carry it. | X02 includes `invalid configuration` (`MODEL.md:160-166`); X06 assumes configuration in an already coherent snapshot (`MODEL.md:188-192`); config import/bootstrap is not specified. | `confirmed-open` | — | High → Medium | Yes. A bootstrap/config-resolution receipt with source spans and fail-open/closed policy is idiomatic. | v4 erratum plus bootstrap snapshot/config-resolution contract. |
| T-11 | Partly valid: resolution/pinning semantics are absent, but numeric version plus stable code is not inherently inconsistent and prototype redundancy is not the v4 API. | Claim definition has stable code/version (`MODEL.md:54-58`); examples use unversioned codes (`MODEL.md:128-130,259-263`); prototype explicitly embeds version in IDs (`endpoints-real.mjs:5-12`). | `design-decision` | — | High → Medium | Yes. Stable code plus exact resolved ref/version/hash is idiomatic. | Version selection, compatibility, and admission-reuse profile. |
| T-12 | Valid terminology/maintainability defect. | M04 calls proposition predicates `conditions` (`MODEL.md:54-58`), while X02 uses `TrustCondition` for attention state (`MODEL.md:160-166`). | `confirmed-open` | — | Low (unchanged) | Yes. `preconditions` or `validWhen` is clearer. | Model terminology erratum. |
| T-13 | Valid semantic underspecification: R04 requires addressable route versions but the authored example supplies unregistered strings. | Route identity promise (`MODEL.md:60-64,219`) versus bare support tokens (`MODEL.md:135-138`). | `confirmed-open` | — | High → Medium | Yes. Typed premise/route registries and preserved refs are idiomatic. | M05/R04 erratum and invalid-link compile fixture. |
| T-14 | Valid semantic identity gap, though “not representable” overstates what a grammar must contain. | M05 promises the exact consumer, subject, context, and obligation but gives no equality/lifetime law (`MODEL.md:60-64`); M10 and diagnostics later depend on affected-use identity (`MODEL.md:99-104,175-180`). | `confirmed-open` | — | High → Medium | Yes. Serializable use refs with lineage/supersession fit the model. | M05 identity law and wire-schema fixture. |
| T-15 | Incorrect type-soundness claim: `TDecision` can denote the decision-key algebra while the output schema denotes a distribution; erasure alone does not make a generic unsound. The actual codec is merely unspecified. | M06 explicitly distinguishes declared decisions from the returned typed distribution (`MODEL.md:66-76`) and R07 requires retention of the algebra/distribution (`MODEL.md:222`). | `refuted` | — | High → Low | Partial: runtime distribution validation is good; calibration “agreement” is semantic evidence, not a type invariant. | Probabilistic-output codec/conformance test, without calling the generic inherently unsound. |
| T-16 | Valid in both grammar and prototype boundaries: declaration is not connected to capture completeness. | M06 lists dependencies/coverage/reach (`MODEL.md:68-72`); prototype updates only caller-supplied dependencies before execution (`kernel.ts:438-465`) and documents caller responsibility (`DESIGN.md:34-36`; `kernel.ts:393-395`). | `confirmed-open` | — | High → Medium | Partial: required selectors/manifests are idiomatic, but cannot prove undeclared relevance without a domain contract. | M06 run-manifest law plus adversarial omitted-dependency test. |
| T-17 | Valid semantic ambiguity. | M07 says observations come from an admitted method (`MODEL.md:78-83`); M11 supports later revoke/supersede (`MODEL.md:106-112`); no assessment rule chooses production-time versus current-use admission. | `confirmed-open` | — | High → Medium | Yes. Capture production admission and separately evaluate current admissibility. | Admission-lifecycle assessment matrix. |
| T-18 | Valid normative-API gap, but M09 is intentionally a semantic record rather than a completed command union. | M09 lists phases only (`MODEL.md:92-97`); R12 promises transactional versioned commands and discriminated receipts (`MODEL.md:227`); PROCESS records operation details among decomposed losses (`PROCESS.md:247-250`). | `deferred` | — | High → Medium | Yes. Discriminated state/receipt/error unions are idiomatic. | Normative operation algebra and retry/idempotency contract. |
| T-19 | Valid: v4 names affected uses but never defines whether defeat precedes alternate-route evaluation. The prototype has one global behavior, not evidence for v4. | M10/R10 name affected uses (`MODEL.md:99-104,225`); X01 preserves alternate routes (`MODEL.md:153-158`); prototype returns `contradicted` before examining routes (`kernel.ts:582-607`). | `confirmed-open` | — | High → Medium | Yes. Explicit target/scope/precedence and alternate-route counterexamples are idiomatic. | Challenge defeat algebra and route-specific tests. |
| T-20 | Valid unresolved identity design choice rather than a proved defect. | M10 requires same law/case (`MODEL.md:99-104`); X02 anticipates unresolved identity relations (`MODEL.md:160-166`), but no admitted matcher is assigned. | `design-decision` | — | High → Medium | Yes, provided matcher decisions are versioned evidence/admission inputs rather than opaque equality. | Identity-relation/repair-matcher design record. |
| T-21 | Valid implementation prerequisite, explicitly left open by the artifact. | M11 states authority semantics (`MODEL.md:106-112`); C05 leaves code review/signatures/local authority alternatives unresolved (`PROCESS.md:225-226`); BRIEF repeats the boundary (`BRIEF.md:62-64`). | `design-decision` | — | Blocker only for admission-command freeze; otherwise Medium | Partial: principals/capabilities are needed, but signatures/delegation topology depends on deployment. | C05 authority topology and capability-verification profile. |
| T-22 | Valid lowering ambiguity, not necessarily a semantic contradiction: ergonomic syntax may normalize into M03 and M12. | M12 owns severity/action (`MODEL.md:114-119`); tuple combines `error`/`warn`/`off` (`MODEL.md:256-265`); EVIDENCE calls these config or policy projections (`EVIDENCE.md:101-102`). | `design-decision` | — | High → Medium | Yes. Normalize activation/options separately from profile action. | Config-lowering specification with provenance fixtures. |
| T-23 | Valid future authoring-API gap, not a Blocker defect in this proposed semantic grammar. | `TrustRule` shows claim/support/method/applicability/messages but no discovery operation (`MODEL.md:121-149`); UC07 reconstructs extension only at model level (`PROCESS.md:100-109`). | `deferred` | — | Blocker → Medium | Partial: stable subject/use discovery is required, but it may live in module/source providers rather than every rule visitor. | F01 authoring profile and source-discovery compile/runtime fixture. |
| T-24 | Valid test idea; speculative as a claim about compilation because the example is pseudocode and no façade type exists. | Tokens/method/applicability/message parameters are not type-connected in the illustrative object (`MODEL.md:127-144`); registration lowering is prose (`MODEL.md:147-149`). | `deferred` | — | High → Low | Partial: shared-schema inference is idiomatic, but a large `RuleDefinition` generic can harm inference/error quality. | F01 compile-only positive/negative consumer fixtures. |
| T-25 | Valid future contract detail, not an implemented defect. | Support tokens and the sole `oracle` method have no explicit edge (`MODEL.md:135-143`); M06/M07 mention coverage/full batch but no per-rule cardinality (`MODEL.md:66-83`). | `deferred` | — | Medium → Low | Yes. Typed `supports`/`produces` edges and batch bounds are idiomatic. | Method-to-premise lowering/schema tests. |
| T-26 | Valid internal inconsistency. | M08 requires tri-state applicability with reason (`MODEL.md:85-90`); representative local rule returns boolean (`MODEL.md:267-276`); X04 promises structured diagnostics/actions (`MODEL.md:175-180`) while `messages` is untyped pseudocode (`MODEL.md:142-143`). | `confirmed-open` | — | High → Medium | Yes. A discriminated applicability result and serializable diagnostic descriptor are idiomatic. | Representative-example erratum and compile fixture rejecting lossy boolean `false`. |
| T-27 | Valid core semantic gap: “stable” conditions and a distinct lifetime are promised without identity/transitions. | X02 calls conditions stable (`MODEL.md:160-166`); X03 attaches work and guarded closure (`MODEL.md:168-173`); PC4-06 requires condition lifetime distinct from other clocks (`PRESERVATION.md:18-21`). | `confirmed-open` | — | High (unchanged) | Yes. Stable refs plus occurrence/lifecycle events are idiomatic and necessary. | X02 lifecycle law and recurrence/supersession tests. |
| T-28 | Valid normative work-API gap, but absence of implementation is expressly within proposed-only scope. | X03 lists features without states/preconditions (`MODEL.md:168-173`); UC02 assumes versioned lease/note operations (`PROCESS.md:55-64`); no work implementation is claimed in prototype package map (`README.md:132-154`). | `deferred` | — | High → Medium | Yes. Event/state unions and optimistic concurrency receipts are idiomatic. | Work API profile and lease-race contract suite. |
| T-29 | Valid future DTO gap; X04 already freezes the semantic fields, so “cannot project” is too absolute. | X04 lists a combined rule/condition code, locations, causes, affected uses, limits, authority, actions (`MODEL.md:175-180`) but not concrete URI/version/action schemas. | `deferred` | — | High → Medium | Yes. Separate identities, versioned spans, and typed actions are idiomatic. | Canonical diagnostic/action wire schema and adapter exhaustiveness tests. |
| T-30 | Partly valid: aggregation precedence is absent; the claim that X05 creates semantic obligations is not established because UC06 compares proposed M03 and M12 inputs together. | X05 returns actions and “newly required obligations” (`MODEL.md:182-186`); M03 owns active obligations (`MODEL.md:50`); UC06 evaluates current/proposed M03/M12 together (`PROCESS.md:92-98`). | `design-decision` | — | High → Medium | Yes. Define policy aggregation and keep active-claim creation attributable to M03. | Policy lattice/precedence decision with multi-condition examples. |
| T-31 | Valid reconstruction gap: the editor loop assumes edited source, but X06 only describes durable multi-object state and the prototype never incorporates document text. | UC01 begins with edited source and recomputes X06 (`PROCESS.md:43-53`); X06 has no overlay (`MODEL.md:188-192`); LSP only parses a synthetic claim and calls `assess` (`lsp-server.mjs:5-27,75-87`). | `confirmed-open` | — | High (unchanged) | Yes. Versioned ephemeral overlays or pure document-analysis contexts are idiomatic. | Editor-context contract and stale-overlay/invalidation tests. |
| T-32 | Valid scaling/transport requirement, not needed to establish the semantic snapshot invariant. | X06 defines coherent snapshot/cursor only (`MODEL.md:188-192`); C07 leaves polling/subscription/streaming open (`PROCESS.md:229-230`). | `deferred` | — | Medium → Low | Yes when long-lived/large-store requirements are selected. | Transport/scalability profile: paging, retention, expiry, resync. |
| T-33 | Valid internal contradiction unless another mandate source is introduced. | X02 includes `disabled required rule` (`MODEL.md:160-166`); M03 says project config determines active obligations (`MODEL.md:50`); R13 says disabling changes the active obligation set (`MODEL.md:228`). | `confirmed-open` | — | High (unchanged) | Yes. Name a baseline mandate or remove/reclassify the current condition, while preserving historical state. | X02/M03 erratum and disablement-history state table. |
| T-34 | Useful complete-batch instance of the missing operation algebra, but not independent of T-18 and not a demonstrated Critical flaw: F02 is an illustrative façade and remote execution is outside scope. | F02 sketches separate run/submit calls (`MODEL.md:298-305`); R06 supplies the controlling complete-batch invariant (`MODEL.md:221`); remote execution is outside the boundary (`PROCESS.md:174-183`). | `duplicate` | T-18 | Critical → Medium | Partial: internal commit for local runs is idiomatic; signed remote manifests require a later threat/transport profile. | Preserve as the complete-batch/remote-submission acceptance test under T-18. |
| T-35 | Useful concurrency detail of T-18 rather than a separate defect. | F02 uses `snapshot`, `expectedConfig`, and `expectedVersion` without types (`MODEL.md:300-305`); R12/R16 require versioned commands/coherent reads (`MODEL.md:227,231`). | `duplicate` | T-18 | Medium → Low | Yes. `atSnapshot`/`ifMatch` and a typed conflict result are idiomatic. | Preserve as the optimistic-concurrency portion of the T-18 operation algebra. |
| T-36 | The hypothetical risk is real, but the proposed grammar already forbids activation by an editable comment alone. Exact syntax remains open. | M12 requires overrides to be authorized/explained/versioned/expiring (`MODEL.md:114-119`); R12 requires capability-checked commands (`MODEL.md:227`); source syntax is only a rendering (`MODEL.md:279-282`); C03 leaves classification open (`PROCESS.md:221-222`). | `already-fixed` | — | High → Low | Yes, and the proposal-only/activation-command distinction is already the model's substance. | Suppression conformance test proving source edits cannot activate an override. |
| T-37 | Incorrect: the artifact expressly labels reconstruction as model-only, not API validation. The compile/adapter tests remain valuable future work. | Control table says “Model pass, not executed API test” (`EVIDENCE.md:111-122`); frozen JSON also says `model-pass`; S08 says prototype is not the frozen public API (`sources.json:72`). | `refuted` | — | High → Low | Partial: adding conformance tests is idiomatic; relabeling is unnecessary because the label is already explicit. | Normative API conformance suite once F01–F03 layering is selected. |
| T-38 | Partly valid design question, not a failed UC03: the use case intentionally defines CI as a pure gate over a supplied snapshot. The prototype CLI is not X05. | UC03 explicitly requests X06 “without running hidden checks” and promises deterministic action (`PROCESS.md:66-73`); current CLI has only evidence operations (`cli.mjs:5-15`) and a successful contradicted assessment exits 0 in the RED probe. | `design-decision` | — | High → Medium | Yes as an optional composite `trust ci`; it must remain explicit rather than redefining the pure gate. | CI workflow/exit-code profile and clean-checkout acceptance test. |
| T-39 | Valid unresolved design question, transparently identified by v4. | UC08 maps low confidence/out-of-range to a condition (`PROCESS.md:111-121`); C04 says adequacy/action threshold boundary still needs examples (`PROCESS.md:223-224`); EVIDENCE repeats the uncertainty (`EVIDENCE.md:132-138`). | `design-decision` | — | High → Medium | Yes. Worked distributions separating adequacy, applicability, and action are the right next artifact. | C04 probability-boundary decision and table-driven examples. |
| T-40 | Valid priority assessment: these choices are normative for a concrete public API. It is not evidence that the proposed grammar contradicts itself, because it freezes the conflicts intentionally. | C01–C06/C08 are explicitly unresolved (`PROCESS.md:215-238`); injected units remain proposed (`PROCESS.md:240-245`). | `design-decision` | — | High → Medium; Blocker only for public API freeze | Yes as prioritization, not as a code fix. | API-freeze checklist linking each conflict to its owner/decision deadline. |
| T-41 | The proposed recast is already present. The title and scope call this a design grammar, and the brief clearly enumerates what it does not decide. | `BRIEF.md:56-66` lists exact config, loader/sandbox, authority, thresholds, suppression, persistence, transport, and Endpoints-only range; PROCESS says injected structure remains proposed (`PROCESS.md:240-245`). | `already-fixed` | — | High → Low | Partial: a later normative API profile is useful; “recast” is redundant. | Normative API-profile follow-up, without changing the current artifact's status. |
| T-42 | Factually true that the JSON is not a machine contract, but it is named an analysis manifest and does not claim to be one. Missing document hashes are a reproducibility improvement. | `frozen-analysis.json:1-40` lists analysis IDs/units/files only; PROCESS defines the frozen analysis as model/evidence/process identifiers (`PROCESS.md:254-260`). | `deferred` | — | Medium → Low | Partial: hash the frozen documents now; publish JSON Schemas only with the normative API artifact. | Reproducible frozen-source manifest; later API schema registry. |
| T-43 | Valid reproducibility gap. The seven listed hashes match current bytes, but the transitive runtime/test/toolchain files are not listed. | S08 contains only protocol/kernel/service/CLI/LSP/MCP/README (`sources.json:52-72`); service imports `endpoints-real.mjs` and `storage.mjs` (`service.mjs:5-10`), and the Endpoints check imports `effect-verdict.mjs`; independent `shasum` matched all seven listed hashes. | `confirmed-open` | — | Medium → Low | Yes. A transitive manifest or commit+dirty-patch inventory is idiomatic. | S08 reproducibility manifest including runtime, tests, package/toolchain files. |
| T-44 | Valid coverage gap, explicitly bounded rather than contradictory. | Typechecked public contracts end at `CheckExecution` with `diagnostics?: unknown` (`protocol.ts:47-51`) and string/prose `Rule` (`kernel.ts:45-53`); `tsconfig.json:12` includes only kernel/protocol/endpoints. | `deferred` | — | High → Low | Yes. Compile-only consumer and exhaustiveness fixtures are idiomatic. | F01/F02/F03 TypeScript conformance fixture suite. |
| T-45 | Confirmed behavioral defect. A failed/unreached run mutates dependency revisions and consumes a run ID even though it commits no observation, violating transactional command semantics and potentially staling prior evidence. | `runCheck` calls `updateDependencies` and increments `#nextRun` before awaiting/validating execution (`kernel.ts:438-465`). Focused RED probe: throw and `reached:false` both changed `nextRun:1→2`, added dependency revision 1, observations stayed 0. | `confirmed-open` | — | High (unchanged) | Yes. Stage dependency/counter changes and commit them atomically after validation; failed operation records must be separate. | Prototype backlog plus regression test asserting full exported-state equality on operational failure. |
| T-46 | Confirmed source-level agent-contract defect. | Rule exceptions discard the cause (`kernel.ts:675-692`); service validators and unknown operations throw unstructured `Error` strings (`service.mjs:39-42,110-121`); LSP/MCP wrappers map failures to generic internal errors (`lsp-server.mjs:159-166`; `mcp-server.mjs:148-157`). | `confirmed-open` | — | High → Medium | Yes, with sanitized cause chains and stable discriminants rather than raw exception leakage. | Shared `OperationError`/receipt schema and cross-adapter error conformance tests. |
| T-47 | Mixed: the observed CLI limitations are real, but this bounded CLI claims only evidence-service commands, not the proposed Trust policy/CI projection. | CLI prints service JSON and sets nonzero only for thrown errors (`cli.mjs:42-70`); README describes only parse/file/validation/service errors as nonzero (`README.md:60-71`); RED probe showed unresolved and contradicted assessments exit 0. | `deferred` | — | High → Medium | Yes once X05/CI semantics are selected. Stable usage/config/operation/finding exits and versioned reporters are idiomatic. | Trust CLI profile and exit-code acceptance matrix; keep evidence CLI semantics separately documented. |
| T-48 | Factually true implementation gap, explicitly outside the prototype's claim. | LSP accepts `{claim}` JSON and emits line-0 status-coded diagnostics with raw assessment data (`lsp-server.mjs:5-27`); README documents exactly that narrow protocol (`README.md:73-83`). RED probe reproduced range line 0, code `unresolved`, and raw `data`. | `deferred` | — | High → Low | Yes. A canonical Diagnostic→LSP adapter and real source fixtures are idiomatic after X04 DTO freeze. | LSP conformance suite against canonical X04 diagnostics. |
| T-49 | Confirmed adapter-quality defect: a side-effect-free reassessment is advertised as a quick fix for every parseable document, even when diagnostics are empty; malformed documents throw from codeAction. | `lsp-server.mjs:95-113` ignores diagnostic context and always returns `kind:'quickfix'`; outer wrapper turns thrown parse errors into `-32603` (`lsp-server.mjs:152-166`). RED probe produced the action after a supported/empty-diagnostic publish and a `SyntaxError` for malformed text. | `confirmed-open` | — | Medium (unchanged) | Yes. Derive actions from current descriptors/diagnostics and return structured disabled/error results. | Prototype LSP backlog and code-action relevance/error tests. |
| T-50 | Confirmed discoverability/error-contract defect for the stated agent-facing MCP adapter. | Nested claim/input/dependency items are only `{type:'object'}` and tools have no output schemas (`mcp-server.mjs:5-63`); handler propagates tool errors (`mcp-server.mjs:97-107`) and process wrapper emits generic `-32603` (`mcp-server.mjs:148-157`). Probes reproduced both empty nested schemas/no output schema and `-32603 claim must be an object`. | `confirmed-open` | — | High → Medium | Yes. Fully specified versioned schemas and MCP `isError` structured content are idiomatic; dynamic generation needs collision/version policy. | Prototype MCP schema/error conformance suite and capability resource. |
| T-51 | Factually true future coverage gap, but v4 and README explicitly say Endpoints is the only implementation and list no Devtools/work implementation. | `README.md:132-154` package map has CLI/LSP/MCP only and calls general policy/etc. open; `BRIEF.md:65-66` says Endpoints is the only implementation; controls are model-pass only (`EVIDENCE.md:115-122`). | `deferred` | — | Medium → Low | Yes once those projections are implementation scope. | Headless Devtools snapshot/cursor and Work API contract suites. |
| T-52 | Confirmed behavioral/documentation defect. | Every dispatch uses `loadStore(...create:true)` (`service.mjs:49-56`); `init` always returns `created:true` (`service.mjs:58-64`); README defines init as “create” (`README.md:47-55`). RED probe showed missing `status` returns zero observations without creating a file, and both first and second `init` return true. | `confirmed-open` | — | Low (unchanged) | Yes. Distinguishing created/opened/missing and per-operation missing policy is idiomatic. | Prototype service initialization-state test and stable missing-store error/action contract. |

## Focused RED probes

All commands below ran from `/Users/kyle.mathews/programs/tanstack-db/.worktrees/codex-component-endpoints-prototype`. They used only inline code and temporary directories under the operating-system temporary directory.

### T-45 — failed checks mutate state

Exact command:

```sh
node --experimental-strip-types --input-type=module -e 'import { EvidenceBase } from "./probes/evidence-base/kernel.ts"; const contract={id:"probe/check@1",version:1,law:"probe/law@1",source:"probe",domain:"probe",reference:{kind:"invariant",description:"probe",trusted:[]},productionPath:"probe",checkpoint:"probe",observes:[],omissions:[],reachWitness:"probe",faultControls:[],replay:"probe"}; for (const mode of ["throw","unreached"]) { const base=new EvidenceBase([]); const before=base.exportState(); try { await base.runCheck(contract,"probe/producer",[{kind:"code",name:"probe/dependency",fingerprint:"v1"}],async()=>{if(mode==="throw") throw new Error("boom"); return {reached:false,findings:[]}}) } catch(error) { const after=base.exportState(); console.log(JSON.stringify({mode,error:error.name+": "+error.message,before:{nextRun:before.nextRun,dependencies:before.dependencies},after:{nextRun:after.nextRun,dependencies:after.dependencies},observations:after.observations.length})) } }'
```

Exact result:

```text
{"mode":"throw","error":"Error: boom","before":{"nextRun":1,"dependencies":[]},"after":{"nextRun":2,"dependencies":[{"kind":"code","name":"probe/dependency","fingerprint":"v1","revision":1}]},"observations":0}
{"mode":"unreached","error":"CheckDidNotReachProductionPathError: Check did not reach production path: probe","before":{"nextRun":1,"dependencies":[]},"after":{"nextRun":2,"dependencies":[{"kind":"code","name":"probe/dependency","fingerprint":"v1","revision":1}]},"observations":0}
```

This is RED for command transactionality, even though the narrower existing test “operational errors add no evidence” remains green.

### T-52 — ambiguous missing/init state

Exact command:

```sh
node --experimental-strip-types --input-type=module -e 'import { mkdtemp, access } from "node:fs/promises"; import { tmpdir } from "node:os"; import { join } from "node:path"; import { createEvidenceService } from "./probes/evidence-base/service.mjs"; const dir=await mkdtemp(join(tmpdir(),"trust-t52-")); const missing=join(dir,"missing.json"); const status=await createEvidenceService({storePath:missing}).request({operation:"status"}); let exists=true; try { await access(missing) } catch { exists=false }; const store=join(dir,"store.json"); const service=createEvidenceService({storePath:store}); const first=await service.request({operation:"init"}); const second=await service.request({operation:"init"}); console.log(JSON.stringify({missingStatus:{observations:status.observations,fileCreated:exists},firstInit:first.created,secondInit:second.created}))'
```

Exact result:

```text
{"missingStatus":{"observations":0,"fileCreated":false},"firstInit":true,"secondInit":true}
```

### T-38/T-47 — CLI finding exits

Exact command:

```sh
node --input-type=module -e 'import { mkdtemp } from "node:fs/promises"; import { tmpdir } from "node:os"; import { join,resolve } from "node:path"; import { spawnSync } from "node:child_process"; const dir=await mkdtemp(join(tmpdir(),"trust-cli-fail-")); const store=join(dir,"store.json"),cli=resolve("probes/evidence-base/cli.mjs"); const summary=(reads,writes,statement)=>({reads,writes,unknown:[],derivation:[],artifact:"schema-a",statement}); const input={queryId:"list",mutationId:"update",query:summary(["recipes"],[],"query"),mutation:summary([],["recipes"],"mutation"),authority:{hasBaseline:true,optimistic:false,needsRepair:false}}; const run=(command,arg)=>spawnSync(process.execPath,["--experimental-strip-types",cli,"--store",store,command,JSON.stringify(arg)],{encoding:"utf8"}); const produced=run("run-endpoints",input), result=JSON.parse(produced.stdout), assessed=run("assess",result.claim); console.log(JSON.stringify({runExit:produced.status,runAssessment:result.assessment.status,assessExit:assessed.status,assessStatus:JSON.parse(assessed.stdout).status,stderr:assessed.stderr.trim()}))'
```

Exact result:

```text
{"runExit":0,"runAssessment":"contradicted","assessExit":0,"assessStatus":"contradicted","stderr":""}
```

This confirms the current evidence CLI does not implement finding exit codes. It does not prove UC03 wrong, because the CLI has no X05/policy command and README does not claim one.

### T-48/T-49 — LSP diagnostic/action behavior

Exact command:

```sh
node --experimental-strip-types --input-type=module -e 'import { diagnosticsFor, createLspHandler } from "./probes/evidence-base/lsp-server.mjs"; const supported={request:async()=>({status:"supported",reasons:[]})}; const unresolved={request:async()=>({status:"unresolved",reasons:["No proposed argument"],opaque:"raw-assessment"})}; const text=JSON.stringify({claim:{law:"probe/law@1",subject:"x",scope:{}}}); const diagnostic=(await diagnosticsFor(text,unresolved))[0]; const notifications=[]; const handler=createLspHandler(supported,(method,params)=>notifications.push({method,params})); await handler({method:"textDocument/didOpen",params:{textDocument:{uri:"file:///probe.json",text}}}); const action=await handler({id:1,method:"textDocument/codeAction",params:{textDocument:{uri:"file:///probe.json"},context:{diagnostics:[]}}}); let malformed; await handler({method:"textDocument/didChange",params:{textDocument:{uri:"file:///probe.json"},contentChanges:[{text:"{"}]}}); try { await handler({id:2,method:"textDocument/codeAction",params:{textDocument:{uri:"file:///probe.json"},context:{diagnostics:[]}}}) } catch(error) { malformed=error.name+": "+error.message }; console.log(JSON.stringify({diagnostic:{range:diagnostic.range,code:diagnostic.code,data:diagnostic.data},supportedPublished:notifications[0].params.diagnostics,action:action.result,malformed}))'
```

Exact result:

```text
{"diagnostic":{"range":{"start":{"line":0,"character":0},"end":{"line":0,"character":56}},"code":"unresolved","data":{"status":"unresolved","reasons":["No proposed argument"],"opaque":"raw-assessment"}},"supportedPublished":[],"action":[{"title":"Reassess evidence claim","kind":"quickfix","command":{"title":"Reassess evidence claim","command":"evidence.request","arguments":[{"operation":"assess","claim":{"law":"probe/law@1","subject":"x","scope":{}}}]}}],"malformed":"SyntaxError: Expected property name or '}' in JSON at position 1 (line 1 column 2)"}
```

The diagnostic shape confirms T-48's implementation gap. Returning a quick fix after the supported document produced no diagnostics, and throwing on malformed codeAction input, are RED for T-49.

### T-50 — MCP schemas and errors

Exact schema/handler command:

```sh
node --experimental-strip-types --input-type=module -e 'import { evidenceTools, createMcpHandler } from "./probes/evidence-base/mcp-server.mjs"; const assess=evidenceTools.find(x=>x.name==="evidence_assess"), run=evidenceTools.find(x=>x.name==="evidence_run_endpoints"); const handler=createMcpHandler({request:async()=>{throw new Error("claim must be an object")}}); let propagated; try { await handler({id:7,method:"tools/call",params:{name:"evidence_assess",arguments:{}}}) } catch(error) { propagated=error.name+": "+error.message }; console.log(JSON.stringify({assessClaimSchema:assess.inputSchema.properties.claim,runInputSchema:run.inputSchema.properties.input,hasOutputSchema:"outputSchema" in assess,propagated}))'
```

Exact result:

```text
{"assessClaimSchema":{"type":"object"},"runInputSchema":{"type":"object"},"hasOutputSchema":false,"propagated":"Error: claim must be an object"}
```

Exact process-boundary command:

```sh
node --input-type=module -e 'import { mkdtemp } from "node:fs/promises"; import { tmpdir } from "node:os"; import { join,resolve } from "node:path"; import { spawnSync } from "node:child_process"; const dir=await mkdtemp(join(tmpdir(),"trust-mcp-")); const request={jsonrpc:"2.0",id:7,method:"tools/call",params:{name:"evidence_assess",arguments:{}}}; const p=spawnSync(process.execPath,["--experimental-strip-types",resolve("probes/evidence-base/mcp-server.mjs"),"--store",join(dir,"store.json")],{input:JSON.stringify(request)+"\n",encoding:"utf8"}); console.log(JSON.stringify({processExit:p.status,response:JSON.parse(p.stdout),stderr:p.stderr.trim()}))'
```

Exact result:

```text
{"processExit":0,"response":{"jsonrpc":"2.0","id":7,"error":{"code":-32603,"message":"claim must be an object"}},"stderr":""}
```

## Changes and GREEN results

No candidate fix was authorized or applied, so there is no post-fix GREEN claim. The unchanged prototype baseline is green:

```sh
# working directory: probes/evidence-base
npm test && npm run typecheck
```

Result: all 21 tests passed and TypeScript completed with exit 0. This establishes that T-45, T-49, T-50, and T-52 are outside the current assertions; it does not refute their same-path RED probes.

The seven S08 hashes listed in `sources.json` were independently recomputed with:

```sh
shasum -a 256 probes/evidence-base/protocol.ts probes/evidence-base/kernel.ts probes/evidence-base/service.mjs probes/evidence-base/cli.mjs probes/evidence-base/lsp-server.mjs probes/evidence-base/mcp-server.mjs probes/evidence-base/README.md
```

All seven matched. The command also does not cure T-43 because transitive implementation, storage, test, package, and toolchain inputs remain outside S08.

## Refutations, already-present protections, and duplicates

- T-06 conflates semantic admission with hostile-code execution containment. v4 explicitly excludes loader/sandbox design; preserve the threat-model question separately.
- T-15 calls a generic inherently unsound without an actual type definition. Runtime codec validation is useful, but the generic can soundly use decision keys and a separate output schema.
- T-37 says model passes are presented as API validation, while the artifact says “Model pass, not executed API test.”
- T-36's required authorization/capability invariant is already in M12/R12/R13; only adapter syntax and a negative conformance test remain.
- T-41's requested semantic-grammar framing already exists in the artifact title and explicit scope boundary.
- T-34 and T-35 are preserved as complete-batch and optimistic-concurrency subrequirements of canonical T-18; no unique detail was dropped.
- No item is stale: HEAD did not move during evaluation.

## Deferred work and design decisions

- Normative API/authoring profile: T-01, T-03–T-05, T-07–T-09, T-11, T-18, T-20–T-25, T-28–T-30, T-32, T-34–T-35, T-38–T-40, T-42, T-44, T-47–T-48, T-51.
- Frozen-grammar errata: T-10, T-12–T-14, T-16–T-17, T-19, T-26–T-27, T-31, T-33.
- Prototype corrections: T-43, T-45–T-46, T-49–T-50, T-52.

## Evidence gaps

- There is no concrete F01/F02/F03 TypeScript façade, module loader, project config resolver, admission authority, policy evaluator, Work API, or Devtools consumer. Therefore T-01–T-44 are primarily source/model judgments; no behavioral RED is possible for absent components.
- T-02 requires a chosen hook execution model and an adversarial hook fixture before enforceability can be measured.
- T-06 requires a threat model that says whether untrusted package code is in scope; current sources explicitly exclude it.
- T-19 needs a normative affected-use/route semantics before the prototype's global challenge behavior can be called conforming or nonconforming.
- T-39 needs concrete decision distributions and separately admitted adequacy/policy functions.
- T-47/T-48/T-51 need an implementation claim before absence becomes a product defect. Their test plans remain durable.
- T-46 was established from the exact catch/transport paths and T-50's process probe; a full cross-adapter mutation suite remains unwritten.

## Loss audit

| Disposition | Count |
|---|---:|
| `fixed-now` | 0 |
| `confirmed-open` | 17 |
| `already-fixed` | 2 |
| `stale` | 0 |
| `refuted` | 3 |
| `deferred` | 13 |
| `design-decision` | 15 |
| `duplicate` | 2 |
| **Total** | **52** |

Reconciliation: `52 raw items = 0 fixed-now + 17 confirmed-open + 2 already-fixed + 0 stale + 3 refuted + 13 deferred + 15 design-decision + 2 duplicates`.

Every T ID appears exactly once. Every duplicate names canonical T-18 and preserves its unique acceptance-test detail. Every deferred/refuted/already-present item has a named durable destination. Current HEAD remains `4ad19815b44be533ac10f90b62aca4377f5138d2`.

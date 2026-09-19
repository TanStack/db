# Evidence — TanStack Trust: In Search of Hardness

## Evidence classes

This extraction keeps five kinds of support separate:

1. **User-owned product direction:** lifecycle-wide scope, the forms of hardness,
   package composition and agent workflows.
2. **Executable evidence:** the local Endpoints compiler, decision path,
   fast-check oracle, Trust kernel and interface tests.
3. **Prior architecture:** the Trust RFC and frozen protocol-centered model.
4. **Fresh-agent observations:** six v5 workflow simulations and their invention
   ledger.
5. **Donor transfer:** Protocols Institute hardness/stigmergy research, the
   user-supplied Stark/Rao definition of hardness, formal systems, typed model
   results and linter ecosystem mechanisms.

Agreement with the preservation preview fixes the intended system. It does not
validate the proposed API, the truth of a grounding source, or whether a
particular placement supplies sufficient hardness for its purpose.

## Frozen source map

| ID | Source | Role | Main limit |
|---|---|---|---|
| HG-E01 | [`../field_log.jsonl`](../field_log.jsonl), through event 1110 | lifecycle-wide aim; user distinctions among native, derived, oracle and required hardness; product-through-production scope; supplied hardness reminder and source examination | product intent and interpretation, not independent validation |
| HG-E02 | [`../protocols-institute-hardness-survey.md`](../protocols-institute-hardness-survey.md) and [`../protocol-donor-perturbation.md`](../protocol-donor-perturbation.md) | selective hardness, pseudo-hardness, protocol leakiness, stigmergic traces, admission and negative-transfer limits | conceptual and analogical; no Trust implementation |
| HG-E03 | [`../trust-api-grammar-v6/MODEL.md`](../trust-api-grammar-v6/MODEL.md), [`EVIDENCE.md`](../trust-api-grammar-v6/EVIDENCE.md), [`PROCESS.md`](../trust-api-grammar-v6/PROCESS.md) | protocol/subject/fact/requirement/evidence/qualification architecture | same analyst lineage; narrower extraction target |
| HG-E04 | [`../../field-trip-evidence-base-rfc-essay/field_log.jsonl`](../../field-trip-evidence-base-rfc-essay/field_log.jsonl), especially event 235, and [`tanstack-trust-rfc-v0.3.md`](../../field-trip-evidence-base-rfc-essay/drafts/tanstack-trust-rfc-v0.3.md) | user requirement to safely automate today's human guarantee work; domain/Trust/policy authority split; evidence graph; lifecycle, repair and bounded completeness | product direction and proposed architecture |
| HG-E05 | [`../trust-api-grammar-v5/agent-usability/SYNTHESIS.md`](../trust-api-grammar-v5/agent-usability/SYNTHESIS.md) and raw workflow results | agents recovered the semantic model but invented executable schemas, joins and action routing | one model per workflow; shared packet and evaluator lineage |
| HG-E06 | [`../../../integrated-todo/compile-schema.mjs`](../../../integrated-todo/compile-schema.mjs), [`sql-effects.mjs`](../../../integrated-todo/sql-effects.mjs), [`compiled-dependencies.mjs`](../../../integrated-todo/compiled-dependencies.mjs), [`effect-verdict.mjs`](../../../integrated-todo/effect-verdict.mjs) | PostgreSQL catalog inspection, SQL effects, source dependencies and the real derived Endpoints decision | prototype-specific and incomplete analysis |
| HG-E07 | [`../../../../evidence-base/DESIGN.md`](../../../../evidence-base/DESIGN.md), [`kernel.ts`](../../../../evidence-base/kernel.ts), [`protocol.ts`](../../../../evidence-base/protocol.ts), [`endpoints-real.mjs`](../../../../evidence-base/endpoints-real.mjs), [`service.mjs`](../../../../evidence-base/service.mjs) | finite evidence algebra, dependencies, challenge/repair history and shared service | local trusted process, file store, one guarantee |
| HG-E08 | [`../../../integrated-todo/tests/oracles/sql-effect-rules.mjs`](../../../integrated-todo/tests/oracles/sql-effect-rules.mjs), [`../../../../evidence-base/rebuild.test.mjs`](../../../../evidence-base/rebuild.test.mjs), [`fault-controls.mjs`](../../../../evidence-base/fault-controls.mjs) | model/generated-history oracle, independent set comparison, reach and hostile fault detection | bounded campaigns do not prove analyzer or PostgreSQL completeness |
| HG-E09 | [`../oracle-guidance-reaudit/GUIDE.md`](../oracle-guidance-reaudit/GUIDE.md) | law, domain, reference, production reach, checkpoint, observations, omissions, faults and replay contract | oracle-specific guidance, not the entire Trust model |
| HG-E10 | [`../trust-api-grammar-v5/TRANSFER-LEDGER.md`](../trust-api-grammar-v5/TRANSFER-LEDGER.md) | package/config/message/test/compatibility conventions transferred from ESLint | source-code/linter scope is too narrow for the target |
| HG-E11 | [`pasted-text.txt`](/Users/kyle.mathews/.codex/attachments/946c901f-aad7-45c4-8c21-148eff60e837/pasted-text.txt), examined in full at Field Log events 1109–1110 | hardness as stable coordination points across time; protocols as engineered, programmable, dynamic, evolvable and ossifiable hardness; complementary softness; sufficiency/excess; pseudo-hardness; timing and sequence | conceptual framing quoting Josh Stark and extended by Venkatesh Rao; it does not specify Trust's architecture or validate an implementation |

## Directly observed grounding and evidence paths

### Derived Endpoints guarantee

`effect-verdict.mjs` consumes compiled query/mutation summaries and collection
authority. `endpoints-real.mjs` records its result as bounded evidence.

| Captured case | Decision | Evidence outcome | Assessment |
|---|---|---|---|
| same artifact, confirmed authority, complete disjoint effects | `skip` | pass | supported |
| overlapping query reads and mutation writes | `refresh` | fail | contradicted |
| unknown mutation writes | `unknown` | unresolved | unresolved |
| different build artifacts | `unknown` | unresolved | unresolved |
| missing baseline, pending optimism or outstanding repair | `refresh` | fail | contradicted |

This supports HG-FM02 in one finite domain. It does not prove the SQL analyzer or
the selective-refresh design generally sound. The derivation is evidence from
which a hard point could be built. `endpointsSkipContract.omissions` explicitly
states that the certificate does not enact refresh policy, so the current
prototype does not contain that coordination boundary.

### Oracle campaign

`sql-effect-rules.mjs` supplies generated PostgreSQL programs and histories,
executes the production-shaped path, compares observable results against an
independent database/reference description, records checkpoints and supports
shrinking. The evidence-base tests separately enumerate small read/write sets
without calling the production intersection helper.

This directly supports the structure of HG-FM03. It supports bounded
falsification and counterexamples, not a calibrated probability that unseen
programs are correct or a hard point unless a current result is consumed by an
enacted boundary.

### Shared interface behavior

The current CLI, LSP and MCP adapters dispatch through one local service and
agree on assessment semantics in the integration test. This supports one
operation layer in a narrow implementation. It does not provide the full
lifecycle graph, complete public schemas proposed by HG-P11, or a downstream
deployment boundary that enacts a Trust decision.

## Controls rerun

On 2026-09-18 at repository commit
`4ad19815b44be533ac10f90b62aca4377f5138d2`:

- `npm test` passed all 21 evidence-base tests.
- `npm run test:faults` detected all eight intended mutants: conjunct loss,
  circular support, old-context reuse, failure loss, route erasure,
  expired-repair reuse, delivery-order repair and dependency-byte reuse.
- `npm run typecheck` passed.

These controls show that the current bounded implementation still exhibits its
declared behavior. They do not execute the representative lifecycle-wide API.

## Support for the candidate primitives

| Primitive | Support | Status |
|---|---|---|
| HG-P01 grounding source | user framing plus native PostgreSQL, oracle and authority examples in HG-E01/HG-E06/HG-E08/HG-E11 | extracted category; not a runtime object today |
| HG-P02 protocol | HG-E02, HG-E03 and cross-owner user requirements | design candidate |
| HG-P03 lifecycle subject graph | v6 subject/relation model and product-through-production requirement | PostgreSQL/Endpoints subset proposed; full lifecycle absent |
| HG-P04 typed statement | RFC distinctions plus facts, derived outcome and requirements | fact/observation subset implemented |
| HG-P05 establishment route | argument routes in kernel/RFC, provider and oracle proposals | finite rule routes implemented |
| HG-P06 evidence record | observations, check contracts and runs in HG-E07 | implemented finite form |
| HG-P07 qualification | assessment/applicability in HG-E07 and prior architecture | partially implemented |
| HG-P08 condition/work trace | challenge history, v5 workflows and stigmergy donor | challenge subset implemented; todos proposed |
| HG-P09 enforcement decision | user CI/exception use cases and RFC policy boundary | proposed outside kernel |
| HG-P10 hard point | coordination definition and temporal/softness tests in HG-E11 plus proposed Endpoints refusal boundary | extracted active overlap; current certificate explicitly does not enact refresh policy |
| HG-P11 operation descriptor | shared service plus v5 interface invention failures | narrow shared service implemented; registry proposed |

## Preservation coverage

| Property | Model support | Evidence status |
|---|---|---|
| H1 lifecycle-wide search | central reading, grounding-source and hard-point tests | user-required; definition refined by HG-E11 |
| H2 product-through-production graph | HG-P03 and lifecycle example | user-required; unimplemented |
| H3 native hardness | HG-FM01, HG-P01/HG-P02/HG-P10 | user interpretation grounded by PostgreSQL specimen and HG-E11 source/protocol distinction |
| H4 derived hardness | HG-FM02 | directly reconstructed from Endpoints |
| H5 oracle hardness | HG-FM03 | directly grounded in oracle code and guide |
| H6 statistical honesty | HG-FM03/HG-FM04, HG-C07 | analyst inference; no calibrated campaign supplied |
| H7 required hardness | HG-FM05, HG-P09/HG-P10 | user-required; reliable downstream enforcement remains proposed |
| H8 authority separation | HG-P04–HG-P09, constraints | RFC/kernel support plus design requirement |
| H9 cross-owner composition | subject relations and observed provider form | user-required; Neon absent |
| H10 agent legibility/proposal | conditions/todos/proposals and HG-P11 | v5 usability evidence; proposed surface |
| H11 one operation model | config/operations sections, HG-C11–HG-C13 | shared prototype subset |
| H12 honest range | boundary conditions and limits below | directly preserved |

## Range and exclusion

Range is **untested**. PostgreSQL, Endpoints, Neon, product requirements,
oracles and production observations all informed extraction, so none is a valid
held-out case. No independent second domain was supplied.

The closest sourced negative is an ordinary linter. It can package source
callbacks, resolve config and emit diagnostics without modeling a lifecycle
subject graph, independent evidence, applicability, retained challenge history
or deployment policy. The grammar excludes this form. It also excludes an
observability dashboard whose metrics automatically satisfy an unstated
requirement and a product checklist whose completion is treated as runtime
evidence; these are conceptual negative cases, not empirical range tests.

## Claims deliberately not made

- “Hardness” is not a measurable universal scalar or total ordering.
- A constraint, fact, evidence record, requirement or configured severity is not
  automatically a hard point.
- More refusal, durability or ossification is not automatically better; fit is
  relative to a purpose and complementary softness.
- PostgreSQL automatically supplies a complete protocol merely because it has
  strong runtime semantics.
- A product requirement is objectively true or empirically satisfied because
  an authorized owner recorded it.
- A fast-check campaign yields statistical confidence without a sampling and
  inference contract.
- A model is independent, complete or relevant because a package labels it an
  oracle.
- Telemetry is representative, calibrated or adequate merely because it comes
  from production.
- The example TypeScript compiles or names the final API.
- Neon or any product-system integration has been implemented or agreed to.
- Passing prototype controls validates security, governance, agent usability,
  lifecycle range or production deployment.
- The current prototype enforces an unbypassable deployment gate or detects all
  reality-distorting pseudo-hardness.

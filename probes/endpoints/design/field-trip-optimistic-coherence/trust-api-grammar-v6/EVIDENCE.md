# Evidence — TanStack Trust API Design Grammar v6

## Evidence classes

This run keeps four kinds of support separate:

1. **User-required design:** the layered PostgreSQL/Endpoints/provider shape,
   easy TypeScript extension, agent workflows and explicit limits on authority.
2. **Executable home evidence:** the current Endpoints SQL-effect compiler,
   `canSkipRefetch` decision, evidence kernel, shared service and independent
   controls.
3. **Prior design evidence:** the RFC, v5 model, audits and six fresh-agent
   usability simulations.
4. **Donor transfer:** linter ecosystems, Protocols Institute work, stigmergy,
   formal systems and typed model results. Donors suggest mechanisms; they do
   not validate this architecture.

User confirmation freezes the preservation contract. It is product-direction
evidence, not evidence that the proposed API is correct or usable.

## Frozen source map

| ID | Source | What it supports | Main limit |
|---|---|---|---|
| G-E01 | [`../field_log.jsonl`](../field_log.jsonl), through event 1088; confirmation at 1089 | current aim, use cases and user-owned architecture constraints | append-only conversation record, not implementation evidence |
| G-E02 | [`../trust-api-grammar-v5/MODEL.md`](../trust-api-grammar-v5/MODEL.md), [`PROCESS.md`](../trust-api-grammar-v5/PROCESS.md), [`EVIDENCE.md`](../trust-api-grammar-v5/EVIDENCE.md) | stable identity, histories, authority, work, policy, snapshots and interface invariants | linter-centered prior design, not implemented |
| G-E03 | [`../trust-api-grammar-v5/agent-usability/SYNTHESIS.md`](../trust-api-grammar-v5/agent-usability/SYNTHESIS.md) and six raw results | agents preserved the ontology but invented schemas, action bindings and workflow joins | one agent per workflow; shared author/evaluator lineage |
| G-E04 | [`../../field-trip-evidence-base-rfc-essay/drafts/tanstack-trust-rfc-v0.3.md`](../../field-trip-evidence-base-rfc-essay/drafts/tanstack-trust-rfc-v0.3.md) | domain/Trust/policy authority split; evidence, lifecycle and bounded completeness | architecture RFC, not public API or proof |
| G-E05 | [`../protocols-institute-hardness-survey.md`](../protocols-institute-hardness-survey.md) and [`../protocol-donor-perturbation.md`](../protocol-donor-perturbation.md) | selective hardness, leakiness, stigmergic traces, proposal/admission tension and negative transfers | conceptual and analogical transfer |
| G-E06 | [`../../../../evidence-base/DESIGN.md`](../../../../evidence-base/DESIGN.md), [`kernel.ts`](../../../../evidence-base/kernel.ts), [`protocol.ts`](../../../../evidence-base/protocol.ts), [`service.mjs`](../../../../evidence-base/service.mjs) | finite evidence algebra, causal repair, dependency invalidation and shared operations | trusted local process, file store, one domain |
| G-E07 | [`../../../integrated-todo/compile-schema.mjs`](../../../integrated-todo/compile-schema.mjs), [`sql-effects.mjs`](../../../integrated-todo/sql-effects.mjs), [`compiled-dependencies.mjs`](../../../integrated-todo/compiled-dependencies.mjs) | catalog inspection, SQL effects, TypeScript/Drizzle extraction and explicit unknown analysis | prototype-specific and incomplete SQL/library coverage |
| G-E08 | [`../../../integrated-todo/effect-verdict.mjs`](../../../integrated-todo/effect-verdict.mjs) and [`../../../../evidence-base/endpoints-real.mjs`](../../../../evidence-base/endpoints-real.mjs) | real Endpoints decision path and its evidence wrapper | only one bounded check |
| G-E09 | [`../../../integrated-todo/tests/oracles/sql-effect-rules.mjs`](../../../integrated-todo/tests/oracles/sql-effect-rules.mjs), [`../../../../evidence-base/rebuild.test.mjs`](../../../../evidence-base/rebuild.test.mjs), [`fault-controls.mjs`](../../../../evidence-base/fault-controls.mjs) | independent set oracle, lifecycle tests and hostile mutations | verdict kernel coverage does not prove analyzer completeness |
| G-E10 | [`../trust-api-grammar-v5/TRANSFER-LEDGER.md`](../trust-api-grammar-v5/TRANSFER-LEDGER.md) | bounded ESLint transfers for packages, config, messages, testing and compatibility | file/AST/linter assumptions do not define Trust semantics |

## Observed prototype behavior

`effect-verdict.mjs` consumes compiled query/mutation summaries and collection
authority. `endpoints-real.mjs` turns its three decision outcomes into the
prototype evidence outcomes below.

| Case | Production decision | Check result | Current assessment |
|---|---|---|---|
| complete disjoint reads/writes, same artifact, confirmed authority | `skip` | `pass` | supported |
| overlapping query reads and mutation writes | `refresh` | `fail` | contradicted |
| unknown mutation writes | `unknown` | `unresolved` | unresolved |
| different build artifacts | `unknown` | `unresolved` | unresolved |
| missing confirmed baseline | `refresh` | `fail` | contradicted |
| pending optimism | `refresh` | `fail` | contradicted |
| outstanding repair obligation | `refresh` | `fail` | contradicted |

The observed code supports the grammar's compiler-fact/static-evidence path. It
does not implement the proposed standalone PostgreSQL protocol or Neon runtime
provider.

## Controls rerun for v6

On 2026-09-17 at repository commit
`4ad19815b44be533ac10f90b62aca4377f5138d2`:

- `npm test` in `probes/evidence-base` passed all 21 tests.
- `npm run test:faults` detected all eight intended hostile mutations:
  conjunct loss, circular support, old-context reuse, failure loss, route
  erasure, expired-repair reuse, delivery-order repair and old-dependency reuse.
- `npm run typecheck` passed.

These runs establish that the current finite implementation still exhibits its
declared behavior. They do not execute the v6 API design.

## Support for surviving primitives

| Primitive | Direct support | Status |
|---|---|---|
| G-P01 protocol | user comments 323–325, G-E05, G-E10 | design requirement with donor support |
| G-P02 subject | exact claims/cases in G-E06 and query/mutation identities in G-E07 | implemented in narrower form |
| G-P03 relation | requested Endpoints→PostgreSQL layering; compiled dependencies in G-E07 | proposed cross-protocol form |
| G-P04 fact | schema/effect/compiler outputs in G-E07 | implemented prototype behavior, proposed contract |
| G-P05 requirement | RFC obligation split, v5 config and six workflows | designed; not public implementation |
| G-P06 evidence chain | check contracts, observations and runs in G-E06/G-E08 | implemented finite form; provider form proposed |
| G-P07 qualification | applicability and rule assessment in G-E06; RFC/v5 adequacy split | partly implemented, broadened design |
| G-P08 condition/work trace | challenge history in G-E06; user daily-agent use case; stigmergy donor | condition subset implemented, work proposed |
| G-P09 policy decision | RFC and v5; CI/override/preview user use cases | proposed outside current kernel |
| G-P10 operation descriptor | shared prototype service and v5 agent schema failures | shared service implemented, closed schemas proposed |

## Preservation coverage

| Property | Model support | Evidence status |
|---|---|---|
| P1 domain-owned hardness | G-P01, G-C01, exclusions | user-required and donor-informed |
| P2 PostgreSQL beneath Endpoints | protocol/adapter/Endpoints sections, G-P03 | user-required; partial prototype material |
| P3 explicit unknowns | G-P04, G-C02 | directly observed in analyzer/verdict/tests |
| P4 relationships without copying | G-P03, G-C05, overlap 1 | analyst inference required by composition |
| P5 separate semantic stages | G-P04–G-P09 | partly implemented; full split proposed |
| P6 independent providers | provider section, G-F02 | user-required; Neon implementation absent |
| P7 inspectable requirement model | config/annotation section, G-C06 | prior design plus user requirement |
| P8 governed production evidence | evidence-run dynamics, G-C07/G-C09 | prior design; production execution absent |
| P9 simple authoring/explicit lowering | `defineCheck`, advanced lowering | design response to v5 usability evidence |
| P10 agent proposal boundary | proposal section, G-D07/G-C10 | prior authority design plus user requirement |
| P11 one meaning across interfaces | G-P10 and projection section | shared prototype semantics; full schemas absent |
| P12 honest range | boundary conditions and claims below | source-stated limitation |

## Range and exclusion

Range is **untested**. Neon and standalone PostgreSQL adapters informed the
extraction and therefore cannot serve as held-out cases. Endpoints remains the
only executable domain.

The closest sourced negative is an ordinary linter: it can package callbacks,
resolve config and report diagnostics without retaining evidence methods,
captured applicability, causal repair or policy-free conditions. The v6 grammar
correctly excludes that form. A universal agent score and a self-authorizing
agent loop are also excluded by G-C01, G-C03 and G-C10.

## Claims deliberately not made

- The representative TypeScript compiles or names the final public API.
- The proposed PostgreSQL protocol covers PostgreSQL, Drizzle, Kysely or raw
  SQL completely.
- Neon has agreed to, implemented or secured the sketched provider.
- Thirty samples establish a generally valid latency claim; the number is the
  user's motivating example and remains project/domain policy.
- Exact dependency equality is always the right applicability relation.
- A typed provider is trustworthy, calibrated or isolated merely because it
  satisfies a schema.
- The primitive set is ontologically fundamental; ablation only shows that each
  part is required by this frozen target and preservation contract.
- Passing prototype tests validates the v6 architecture, agent usability,
  security, policy or cross-domain range.


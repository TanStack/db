# Stage 3 revision: three distinct RFC directions

## Status

Kyle asked to replace the thirteen heavily overlapping candidate cards with three candidates. This is a user-authorized editorial consolidation of the frozen Stage 3 map, not a Candidate Collision Test: that instrument requires candidates that have already passed Stage 4 validation. The original 13-card map remains frozen provenance. The three directions below remain unranked and unvalidated.

The consolidation uses three different organizing spines:

1. **What the system is and where authority lives**
2. **How people and agents build and operate it**
3. **Why its current rules exist, shown through failures and a bounded example**

## `RFC-A` — The architecture of evidence authority

### Public question

What is the reusable evidence base, how does evidence become current support, and which authority belongs to the base, claim packages, authoring workflows, consumer policy, and interfaces?

### Organizing spine

Follow one claim through the complete conceptual system:

`claim → argument routes → observations → applicability → support/challenge history → current authority → consumer-policy boundary`

At every transition, identify the owning layer and what it is permitted to conclude. Applicability remains an explicit two-axis design question—ownership and result cardinality—rather than a chosen answer.

### Source anchors

- Architecture and primitives: `ESS-S01/S02/S03`.
- Challenge, replay, and current-versus-historical authority: `ESS-S04/S05`, `ESS-P01–P03`.
- Check and runner authority: `ESS-S06/S11`, `ESS-P08`, `LFG-H10/H11/H12/H14`.
- Protected applicability question: `BR-06`, `ESS-T01`, `LFG-H04`, `LGI-V1-05`, `LGI-V2-07`.
- Support/severity/permission separation: `ESS-H06`, `ESS-T04/T09`, `LFG-H08`, `LGI-V1-09`.
- Conservative and negative boundaries: `ESS-H07`, `ESS-X01–X10`, `LGI-V2-X01/X03/X04` with their original statuses.

### Reader-promise hypothesis

Kyle leaves with one coherent mental model of the system: its objects, state transitions, ownership boundaries, trust roots, and unresolved semantic choices. He can evaluate a proposed feature by asking which layer owns it and what evidence or authority it would need.

### Form and scale

Full architecture RFC. Primary forms: system diagram, claim-lifecycle walkthrough, layer/authority table, and explicit unresolved-decision register.

### Prior cards absorbed

`RFC-C01`, `C02`, `C03`, `C05`, `C08`, and `C12` become sections or cross-cutting constraints rather than separate essays.

### Chief gaps

Rule soundness, semantic equivalence, complete context capture, applicability, consumer policy, selective repair, hostile-process security, distributed durability, and independent range remain unresolved or unmeasured.

### Loss created by this frame

Authoring work and interface ergonomics become secondary, and the historical repair witnesses lose some causal force. A clean architecture account can also make provisional or unfinished boundaries appear more settled than they are.

### Distinctness from the other two

This candidate is organized by **semantic and authority structure**. Replacing its form with workflow journeys would turn the architecture into an operations manual; replacing it with repair chronology would make systematic coverage depend on which failures happened to be vivid.

## `RFC-B` — Building and operating the evidence base with agents

### Public question

How should humans and agents design claims, establish and maintain evidence, inspect gaps and contradictions, repair checks, and use the same semantics through CLI, LSP, and MCP?

### Organizing spine

Follow the work rather than the ontology:

`design claim/check → establish evidence → assess and inspect → monitor freshness → encounter contradiction → repair and replay → expose through agent interfaces`

For each step, separate what exists in the current prototype, what appears only in workflow prose, what the public contract makes operable, and what remains an unmeasured or missing capability.

### Source anchors

- Oracle portfolio and check contract: `ESS-S06`, `ESS-H04`.
- Three authoring/maintenance workflows: `ESS-S08`, `ESS-H05`.
- Shared CLI/LSP/MCP implementation: `ESS-S09`, `ESS-P06/P07`.
- Agent-operability losses: `LGI-V1-03/V1-08/V1-14/V1-29`; `LGI-V2-02/V2-05–V2-08/V2-11/V2-14/V2-15`.
- Receipt, control, repair, and expiry losses: `LFG-H05/H07/H10/H13/H18/H19`.
- Status-preserving reduction audit: `RFC-C06`, grounded in `LFG-H17–H19` and `LGI-V1-27–V1-30`, `LGI-V2-18/V2-19`.
- Implementation and evaluation gaps: `ESS-E03–E10/E13`, `LGI-U01`.

### Reader-promise hypothesis

Kyle leaves able to turn the design into an agent-usable product plan without confusing transport availability with semantic operability or detailed workflow prose with demonstrated workflow effectiveness.

### Form and scale

Full operational RFC. Primary forms: workflow sequences, an operation × semantic-object matrix, current/proposed/deferred capability table, and explicit evaluation checkpoints.

### Prior cards absorbed

`RFC-C04`, `C06`, and `C07`. The policy split from `C08` remains an external constraint owned by `RFC-A`, not another workflow section that chooses policy.

### Chief gaps

Generic rule and argument authoring, tri-state applicability exposure, conjectural challenge submission, rubric admission, gap/work projections, provenance-rich receipts, durable reporting, real client installation, and measured agent effectiveness.

### Loss created by this frame

The logical model can become a capability checklist, and the reason behind conservative replay/freshness rules can disappear. Because the interface audit is contract-bounded, the RFC must keep “not publicly declared” separate from “not present at runtime.”

### Distinctness from the other two

This candidate is organized by **work and operability**. Its key result is not a system ontology or a historical explanation; it is the sequence and contract by which a person or agent can create, inspect, maintain, challenge, and use evidence.

## `RFC-C` — The base system explained through failure and repair

### Public question

Why do the evidence base's current semantics exist, and what do the failed models, repair controls, and bounded Endpoints consumer actually establish?

### Organizing spine

Use a repeated causal form:

`naive rule → concrete witness → repair constraint → implemented mechanism → control → remaining limit`

The main episodes are AND/OR route flattening, fingerprint reversion, stale or same-batch replay, expired resolution authority, and checker reach failure. Endpoints then provides one pass/fail/unresolved consumer scene with an adjacent ledger of what the fixture supplied, what the base computed, and what remains outside the claim.

### Source anchors

- Evolution and repair record: `ESS-S12`, `ESS-H03`, `LGI-V2-18/V2-19`.
- Repaired route and lifecycle semantics: `ESS-S03/S04`.
- Concrete witnesses: `ESS-P01/P02/P03/P05`; v2 README and evidence; kernel tests 388–558.
- Endpoints worked consumer: `ESS-S10`, `ESS-P04`, `ESS-E01/E02/E07`, `ESS-T09`.
- Negative controls: `ESS-X02/X03/X06/X08/X10`.
- Historical/provisional status controls: `LFG-U01`, `LGI-C01`, `LGI-U01`.

### Reader-promise hypothesis

Kyle sees which rules were earned by a witnessed failure, which remain conservative prototype decisions, and exactly how far the current example and tests justify confidence.

### Form and scale

Full historical/empirical RFC. Primary forms: five repair episodes, compact counterexample traces, red/green control table, and one bounded Endpoints walkthrough.

### Prior cards absorbed

`RFC-C09`, `C10`, `C11`, and `C13`.

### Chief gaps

The witnesses are constructed local cases with shared analyst context. Independent range, production behavior, broader SQL analysis, distributed execution, large-graph behavior, real interface clients, and workflow effectiveness remain untested.

### Loss created by this frame

Vivid failures and Endpoints can over-anchor the general architecture. Stable concepts without dramatic repair scenes receive less space, and readers may mistake generated regression tests for production incidents or independent validation.

### Distinctness from the other two

This candidate is organized by **causal design history and evidence for rules**. It can borrow the vocabulary of `RFC-A` and mention the interfaces from `RFC-B`, but neither a static architecture map nor an operational workflow can replace its witness-driven narrative without losing the reason the constraints exist.

## Separation check

| Candidate | Primary question | Load-bearing spine | Result for Kyle | What cannot be exchanged without collapse |
|---|---|---|---|---|
| `RFC-A` | What is the system, and who owns each decision? | Semantic model plus authority/lifecycle structure | Architectural orientation | Replace structure with chronology and the RFC becomes selective; replace it with workflows and the ontology becomes secondary |
| `RFC-B` | How do humans and agents build, inspect, maintain, and use it? | Workflows plus public operability | Operational design surface | Replace work with ontology and capability gaps become footnotes; replace it with failure history and routine practice disappears |
| `RFC-C` | Why do these rules exist, and what evidence supports them? | Witnessed failure and repair sequence | Causal justification and calibrated confidence | Replace witnesses with diagrams or capability tables and the repair rationale disappears |

The three candidates share the same system and some source material, but they do not share the same reader intervention, narrative spine, or dominant form. This is a provisional separation check, not the canonical post-validation Candidate Collision Test.

## Map relationship

The original `RFC-C01`–`RFC-C13` cards remain frozen in [`stage-3-candidate-map.md`](stage-3-candidate-map.md) as source and generation provenance. Stage 4 should validate `RFC-A`, `RFC-B`, and/or `RFC-C` as the user-selected candidates. It should not spend separate validation passes on the absorbed cards unless Kyle reopens one.

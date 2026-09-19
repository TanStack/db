# Stage 6 Loss Audit — TanStack Trust RFC v0.2 → v0.3

## Frozen comparison and control

- Source: `drafts/tanstack-trust-rfc-v0.2.md`
- Source SHA-256: `61fd916f61b53e8440de673a39fbbce4b745c7d5215e330ace2bc01ff22efb60`
- Proposed reduction: `drafts/tanstack-trust-rfc-v0.3.md`
- Reduction SHA-256: `f3c246b7393beb8767931aa8465aecd49beb8d972cdfd82aefadef289f891904`
- Execution: three fresh sibling-hidden scanners, each assigned a disjoint
  source segment and the full frozen reduction

Each scanner listed supported consequential source material that was absent or
materially weakened in the reduction, located its vanishing point, and named
the drop rule. The scanners did not judge usefulness or recommend repair.

## Recovered-signal ledger

| ID | Recovered source item | Source | Vanishing point in v0.3 | Drop rule |
| --- | --- | --- | --- | --- |
| L01 | Cheaper generation increases the volume and durability burden of guarantee work: more candidate implementations create more claims, checks, exceptions, and repairs that must survive their originating session. | v0.2 lines 64–68 | §1 retains the human judgments and unmeasured outcomes but drops the causal scaling argument. | Compression |
| L02 | Check design packages trust assumptions and open decisions alongside rule versions and omissions. | v0.2 lines 381–382 | §7 retains fault controls, routes, dependencies, unsupported constructs, and omissions but not those two package outputs. | Compression |
| L03 | The check-design workflow assigns fixture responsibility. | v0.2 lines 384–388 | §7 specifies cases and later says what the Endpoints fixture supplies, but no longer assigns ownership as a design obligation. | Category mismatch |
| L04 | Contextual diagnostic rendering is explicitly absent, while diagnostic-correction evaluation is unmeasured. | v0.2 lines 424–426 | §7 retains documentation-only workflows and unmeasured outcomes; §8 retains current diagnostics and missing packaging, but no explicit contextual-rendering status. | Category mismatch |
| L05 | The current shared LSP operation is named `evidence.request`. | v0.2 lines 439 and 454–460 | §8 replaces the concrete name with “Generic evidence request.” | Compression |
| L06 | Each adapter's partial explanation shape is identified: opaque CLI assessment, LSP diagnostic data, and MCP structured result. | v0.2 line 451 | §8 reduces all three cells to undifferentiated “Partial.” | Compression |
| L07 | The donor ledger distinguishes conceptual analogy, source-guided design donors, direct workflow lineage, unevaluated design transfer, supplied-source transfer, and bounded implementation evidence; it also names Carneades, Soufflé, Z3, Field Lab, shadcn, and Beads. | v0.2 lines 583–595 | §11 retains mechanisms and breakpoints as bullets but drops the per-item evidence-status column and several specific donor names. | Category mismatch |
| L08 | Positive Datalog derivation does not itself model applicability or defeat, in addition to expiry and repair. | v0.2 line 587 | §11 retains relative entailment and the expiry/repair limit, but drops applicability and defeat from this donor-specific boundary. | Compression |
| L09 | A future decision to extract Trust could create the reason and timing for a second-domain range test. | v0.2 lines 652–655 | §11 retains no current second implementation and later extraction, but not their conditional connection. | Compression |
| L10 | Dependency expansion should be scoped by endpoint or artifact. | v0.2 lines 678–681 | The build order keeps generic analyzer and dependency-evidence expansion but loses the concrete scoping unit. | Low salience |
| L11 | Deployment hardening needs hostile-process isolation, not only plugin isolation. | v0.2 lines 685–687 | §11 narrows the open decision to hostile-plugin isolation, and the hardening step omits the broader hostile-process boundary. | Category mismatch |
| L12 | The product thesis locates durable developer-tool value in reliable, efficient, maintainable application behavior created by shared implementations and in responsibility removed without hiding remaining obligations. | v0.2 lines 699–703 | The abstract and §1 retain cheap code and guarantee work; the conclusion retains evidence architecture, but the shared-implementation and responsibility-removal formulation is gone. | Compression |

## Source-pass coverage

- **Source 01, lines 1–256:** abstract, status, product argument, authority,
  primitives, state axes, domain ownership, routes, applicability, soundness.
  One loss recovered.
- **Source 02, lines 257–513:** evidence mechanics, workflows, interfaces, and
  consumer policy. Five losses recovered.
- **Source 03, lines 514–727:** Endpoints incubation, donor ledger, decision
  register, build order, and conclusion. Six losses recovered.

The scanners reported that all other consequential ideas in their assigned
segments remained explicitly recoverable, sometimes relocated or expanded.

## Limits

This is a representational-loss reading, not a verdict that all twelve items
belong in the revised RFC. The isolation protects one-off material from
consensus compression, but each scanner is a correlated model reader and each
line partition can split context. The exact source passes remain in:

- `probes/stage-6-loss-audit-v0.2-to-v0.3-source-01.md`
- `probes/stage-6-loss-audit-v0.2-to-v0.3-source-02.md`
- `probes/stage-6-loss-audit-v0.2-to-v0.3-source-03.md`

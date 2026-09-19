# Stage 6 loss audit: v0.2 source segment 02 to v0.3

## Assay boundary

- **Assigned source coverage:** `tanstack-trust-rfc-v0.2.md`, lines 257–513 inclusive.
- **Covered source sections:** all of §4 (`The base owns evidence mechanics, not domain truth`), §5 (`Workflows carry maintenance obligations`), §6 (`Interfaces expose one service unevenly`), and §7 (`Consumer policy owns permission and fallback`).
- **Frozen reduction:** full `tanstack-trust-rfc-v0.3.md` with SHA-256 `f3c246b7393beb8767931aa8465aecd49beb8d972cdfd82aefadef289f891904`; the observed file hash matched.
- **Assay rule:** report supported consequential ideas from the assigned source segment that are absent or materially weakened in the frozen reduction. No usefulness judgment, prioritization, or restoration recommendation is included.

## Loss findings

### 1. Check-design packaging no longer explicitly includes trust assumptions and open decisions

- **Exact source passage:** v0.2 lines 381–382: “run fault controls against the implementation under test; and / package the rule versions, trust assumptions, omissions, and open decisions.”
- **Exact v0.3 vanishing point or absence:** The corresponding check-design inventory at v0.3 lines 467–478 and controls at lines 480–486 retain fault controls, the evidence route, dependencies, unsupported constructs, known omissions, and replay obligations, but do not require packaging trust assumptions or open decisions. The domain-package inventory at lines 632–643 restores rule/checker versions and known omissions, but still does not state that trust assumptions and open decisions must be packaged as outputs of check design.
- **Drop mechanism:** compression.

### 2. The design workflow no longer assigns fixture responsibility

- **Exact source passage:** v0.2 lines 384–388: “This follows the Oracle Guide's larger discipline: choose a law, generate or / select histories that can reach it, assign fixture responsibility, and observe / the production checkpoint. It also requires authors to distinguish harness / failure from application findings, preserve the original violation while / reducing a trace, and retain promises the bounded check did not establish.”
- **Exact v0.3 vanishing point or absence:** The corresponding material at v0.3 lines 467–493 retains the law, cases, independent oracle/reference, production checkpoint, reach and fault controls, and bounded-campaign limit, while repair at lines 520–537 retains failure classification and violation-preserving reduction. It never states the obligation to assign fixture responsibility. The later Endpoints description at lines 728–731 says what the fixture supplies, but does not restore responsibility assignment as a check-design obligation.
- **Drop mechanism:** category mismatch.

### 3. The explicit implementation-status gap for contextual diagnostic rendering disappears

- **Exact source passage:** v0.2 lines 424–426: “**Status:** Workflow cards are **implemented as documentation**. Their agent / ergonomics and effectiveness are **unmeasured**; contextual diagnostic rendering / and correction evaluation are **absent**.”
- **Exact v0.3 vanishing point or absence:** The corresponding v0.3 workflow status at lines 550–553 retains documentation-only implementation and unmeasured workflow outcomes, but replaces the explicit absences with generic agent operations and admission governance. The interface section at lines 598–608 describes current LSP diagnostic behavior and missing packaging/schema/agent use, and lines 786–789 discuss contextual lint-style findings as a donor concept, but nowhere marks contextual diagnostic rendering itself as absent. Correction evaluation remains recoverable at lines 857–861; the contextual-rendering status does not.
- **Drop mechanism:** category mismatch.

### 4. The LSP shared-service operation name is replaced by a generic label

- **Exact source passage:** v0.2 lines 454–460: “The LSP reads JSON documents containing a claim, publishes / no diagnostic for support, an error for contradiction, and a warning for / unresolved evidence. That severity mapping is current adapter behavior, not a / universal policy. It also exposes the shared service through / `evidence.request`. The MCP server advertises six tools and returns both text / and structured results.” The capability matrix also names “Via generic `evidence.request`” at line 439.
- **Exact v0.3 vanishing point or absence:** v0.3 lines 598–603 preserve the document shape, diagnostic mapping, policy caveat, MCP tool count, and result forms, but omit the concrete LSP operation name `evidence.request`. The matrix at line 583 weakens it to “Generic evidence request,” and lines 559–577 discuss a shared service only at the architectural level.
- **Drop mechanism:** compression.

### 5. Adapter-specific explanation limitations collapse into undifferentiated “Partial” entries

- **Exact source passage:** v0.2 line 451: “| Request a stable, fully typed route explanation | Partial opaque assessment | Partial diagnostic data | Partial structured result | **Proposed contract** |”.
- **Exact v0.3 vanishing point or absence:** The corresponding v0.3 capability row at line 595 reads “| Request a stable, fully typed route explanation | Partial | Partial | Partial | **Proposed contract** |”. Sections 6 and 8 explain the desired complete operation and say current adapters expose only parts of it (lines 414–451 and 563–596), but do not recover which kind of partial surface each adapter currently provides: opaque assessment for CLI, diagnostic data for LSP, and structured result for MCP.
- **Drop mechanism:** compression.

## Coverage result

Five supported consequential ideas in the assigned segment are absent or materially weakened in v0.3. All other consequential ideas observed in lines 257–513—including conjunctive/disjunctive route structure, finite grounding, observation separation, unresolved-versus-operational-failure boundaries, monotonic dependency revisions, selective invalidation, causal replay, append-only repair history, persistence limits, explanation contents, maintenance and repair obligations, single-service semantics, agent lifecycle operations, and consumer-policy separation—remain explicitly recoverable in the frozen reduction.

## Limitations

- This was an isolated textual recovery assay, not a factual validation of either draft.
- No v0.2 content outside lines 257–513 was inspected.
- No source traces, concept grammars, field log, sibling probe outputs, or validation artifacts were inspected.
- Drop mechanisms describe how the signal disappears in the reduction; they do not assert author intent.

# RFC Reconstruction Trace: Explanatory-Form Stratum

## BC-03-A

- **Public question or claim:** What interface-neutral contract lets the same evidence base serve command-line, editor, and tool-protocol clients without forcing identical interaction models?
- **Central reader intervention:** Define a stable core contract, then decide which discovery, query, citation, and mutation behaviors belong in interface-specific adapters.
- **Organizing form and likely scale:** Medium-length interface-first RFC: shared contract, three interface walkthroughs, compatibility tradeoffs, current/proposed/deferred implementation table, and open decisions. One domain package supplies the worked requests and responses.
- **Assumptions normally made without sources:** Agents need machine-readable results; interfaces differ in latency and interaction style; a common contract can exist beneath them; the worked example is illustrative rather than evidence of generality.
- **Largest likely gap or failure mode:** A lowest-common-denominator contract may conceal capabilities essential to one interface or leave error, streaming, and mutation semantics unresolved.
- **Semantic tags:** `architecture`, `interfaces`, `semantics`, `worked-example`, `tradeoffs`, `implementation-state`, `unresolved-decisions`

## BC-03-B

- **Public question or claim:** How does evidence move from acquisition through validation, publication, revision, deprecation, and removal?
- **Central reader intervention:** Make lifecycle states and transitions explicit, including who or what may trigger them and how agents encounter stale or superseded material.
- **Organizing form and likely scale:** Medium-to-long lifecycle narrative: state model, transition examples, interface consequences, operational tradeoffs, implementation-state matrix, and unresolved retention policies. A single domain package illustrates one complete evidence journey.
- **Assumptions normally made without sources:** Evidence changes over time; consumers require freshness signals; historical material sometimes remains useful; lifecycle metadata can be exposed consistently across interfaces.
- **Largest likely gap or failure mode:** The RFC may define clean states while omitting practical refresh triggers, migration behavior, failure recovery, or ownership of maintenance.
- **Semantic tags:** `lifecycle`, `workflow`, `authority`, `interfaces`, `worked-example`, `tradeoffs`, `implementation-state`, `unresolved-decisions`

## BC-03-C

- **Public question or claim:** What semantic model makes evidence discoverable, composable, and citable without confusing source material, extracted facts, interpretations, and agent-produced conclusions?
- **Central reader intervention:** Choose the evidence unit, identity rules, relationship types, and citation boundaries, then test them through worked agent queries.
- **Organizing form and likely scale:** Long concept-led RFC: terminology, data model, query examples, competing modeling choices, partial implementation mapping, and unresolved semantic edges. One domain package provides all concrete examples.
- **Assumptions normally made without sources:** Evidence can be represented as identifiable units; relationships add retrieval value; citations should preserve a path to underlying material; different interfaces can render the same semantics differently.
- **Largest likely gap or failure mode:** The model may become either too coarse for trustworthy citation or too elaborate for maintainers and tools to populate consistently.
- **Semantic tags:** `semantics`, `architecture`, `interfaces`, `worked-example`, `tradeoffs`, `implementation-state`, `unresolved-decisions`

## BC-03-D

- **Public question or claim:** How should the evidence base represent authority, provenance, confidence, and conflict so agents can distinguish retrieval from endorsement?
- **Central reader intervention:** Establish explicit authority boundaries and conflict-handling rules, including which decisions remain with the consuming agent or human.
- **Organizing form and likely scale:** Medium explanatory RFC organized around conflicting-evidence scenarios, authority layers, provenance propagation, interface presentation, implementation gaps, and unresolved policy choices. A single domain package supplies the scenarios.
- **Assumptions normally made without sources:** Sources can disagree; provenance affects interpretation; confidence and authority are distinct; interface presentation can influence agent behavior.
- **Largest likely gap or failure mode:** Labels may imply certainty they cannot justify, while aggregation rules may silently erase disagreement or transfer authority to the evidence base.
- **Semantic tags:** `authority`, `semantics`, `workflow`, `interfaces`, `worked-example`, `tradeoffs`, `implementation-state`, `unresolved-decisions`

## BC-03-E

- **Public question or claim:** Which agent workflows must the reusable evidence base support end to end, and where should interface behavior intentionally diverge?
- **Central reader intervention:** Evaluate architecture through representative tasks—discovery, inspection, citation, update, and failure recovery—rather than through components alone.
- **Organizing form and likely scale:** Medium workflow-centered RFC with parallel command-line, editor, and tool-protocol walkthroughs; cross-cutting tradeoff notes; current/proposed behavior tables; and unresolved interaction choices. One domain package is the sole worked example.
- **Assumptions normally made without sources:** Agents use evidence iteratively; human visibility matters more in some interfaces than others; equivalent outcomes need not require equivalent interaction sequences.
- **Largest likely gap or failure mode:** Happy-path walkthroughs may obscure concurrency, partial results, permissions, noninteractive use, and recovery after interrupted operations.
- **Semantic tags:** `workflow`, `interfaces`, `architecture`, `worked-example`, `tradeoffs`, `implementation-state`, `unresolved-decisions`

## BC-03-F

- **Public question or claim:** What incremental implementation path can establish a usable evidence base while preserving decisions that remain genuinely open?
- **Central reader intervention:** Separate implemented constraints from proposed design and deferred choices, then define checkpoints at which unresolved decisions must be revisited.
- **Organizing form and likely scale:** Medium staged RFC: present-state inventory template, target capabilities, phased slices, worked vertical implementation, tradeoff ledger, and decision register. The vertical slice uses one domain package only.
- **Assumptions normally made without sources:** Some implementation may predate the RFC; interface delivery can be phased; early schema and identity choices constrain later evolution; deferred decisions require explicit reopening conditions.
- **Largest likely gap or failure mode:** A phased plan may accidentally canonize temporary structures, leave compatibility obligations unspecified, or report implementation state without verifiable acceptance criteria.
- **Semantic tags:** `implementation-state`, `unresolved-decisions`, `architecture`, `lifecycle`, `interfaces`, `worked-example`, `tradeoffs`

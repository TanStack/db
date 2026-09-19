# BC-01 Blind Expectation Trace

## Fixed frame

- **Subject:** A reusable software evidence base exposed through command-line, editor, and tool-protocol interfaces.
- **Reader:** Its designer.
- **Evidence standard:** Every approach below is only a framing hypothesis. Factual claims would require traceable source evidence; design choices would require explicit decision records.
- **Output contract:** A designer-facing RFC. One domain package may illustrate the system but may not define its general architecture or semantics.
- **Ordering:** The approaches are distinct and unranked.

## BC-01-A — System of contracts

- **Public question or claim:** What stable contracts separate evidence storage, interpretation, querying, and interface presentation?
- **Central reader intervention:** Replace a feature-oriented view with explicit subsystem boundaries, responsibilities, invariants, and dependency directions.
- **Organizing form and likely scale:** Architectural decomposition followed by component contracts and boundary diagrams; medium-to-large RFC.
- **Assumptions normally made without sources:** Evidence can be separated from its consumers; subsystem ownership is assignable; common contracts can serve all interfaces; the worked example does not require privileged behavior.
- **Largest likely gap or failure mode:** Clean component boundaries may conceal semantic coupling, especially when an interface needs domain-specific interpretation or partial evidence.
- **Semantic tags:** `architecture`, `authority`, `interfaces`, `implementation-state`, `tradeoffs`, `unresolved-decisions`

## BC-01-B — Semantic evidence model

- **Public question or claim:** What does an evidence item mean, and which relationships make collections of evidence interpretable by agents?
- **Central reader intervention:** Define canonical entities, identities, assertions, provenance links, scopes, and rules for ambiguity or contradiction before discussing interface behavior.
- **Organizing form and likely scale:** Conceptual schema, relation inventory, invariants, and worked semantic examples; medium RFC with dense definitions.
- **Assumptions normally made without sources:** A sufficiently general vocabulary exists; evidence can be represented without erasing important context; identity and equivalence rules can be made deterministic; agents share enough interpretation to use the model consistently.
- **Largest likely gap or failure mode:** The abstraction may either become too weak for real domains or encode the worked example’s ontology as if it were universal.
- **Semantic tags:** `semantics`, `architecture`, `worked-example`, `tradeoffs`, `unresolved-decisions`

## BC-01-C — Authority and provenance regime

- **Public question or claim:** Under what authority may an agent trust, reject, supersede, or qualify a piece of evidence?
- **Central reader intervention:** Treat provenance, authorship, derivation, confidence, policy, and conflict resolution as primary system semantics rather than optional metadata.
- **Organizing form and likely scale:** Trust model, authority lattice or precedence rules, conflict cases, and audit scenarios; medium RFC.
- **Assumptions normally made without sources:** Sources and derivations are identifiable; authority can be represented explicitly; precedence policies are stable enough to encode; consumers can distinguish recorded fact from inference and decision.
- **Largest likely gap or failure mode:** A formal authority model may imply certainty or institutional agreement that does not exist, while unresolved conflicts remain operationally ambiguous.
- **Semantic tags:** `authority`, `semantics`, `lifecycle`, `workflow`, `tradeoffs`, `unresolved-decisions`

## BC-01-D — Evidence lifecycle and state transitions

- **Public question or claim:** How does evidence enter, change, become stale, get superseded, and remain auditable over time?
- **Central reader intervention:** Design around state transitions and preservation guarantees instead of treating the evidence base as a static repository.
- **Organizing form and likely scale:** Lifecycle state machine, transition table, retention rules, and failure/recovery scenarios; medium RFC.
- **Assumptions normally made without sources:** Evidence has detectable lifecycle events; staleness and supersession are expressible; histories can be retained affordably; concurrent updates can be reconciled.
- **Largest likely gap or failure mode:** The model may specify transitions without establishing who is authorized to trigger them or what semantic consequences each state has for agents.
- **Semantic tags:** `lifecycle`, `authority`, `workflow`, `semantics`, `implementation-state`, `unresolved-decisions`

## BC-01-E — One system, multiple interface projections

- **Public question or claim:** Which semantics must remain invariant across command-line, editor, and tool-protocol interfaces, and which behaviors are legitimate projections?
- **Central reader intervention:** Separate canonical system operations from interface-specific interaction patterns, serialization, affordances, and error presentation.
- **Organizing form and likely scale:** Capability matrix, canonical operation definitions, interface mappings, and parity exceptions; medium-to-large RFC.
- **Assumptions normally made without sources:** The interfaces can share a common capability core; interface-specific constraints are known; equivalent operations can preserve meaning across synchronous, interactive, and protocol-mediated use.
- **Largest likely gap or failure mode:** Superficial parity may mask different authority, context, atomicity, or error semantics across interfaces.
- **Semantic tags:** `interfaces`, `semantics`, `architecture`, `workflow`, `tradeoffs`, `implementation-state`

## BC-01-F — Decision surface with a bounded worked example

- **Public question or claim:** Which architectural and semantic decisions define the reusable core, and what does a single domain package reveal without becoming normative?
- **Central reader intervention:** Make unresolved choices and their consequences visible, then use the domain package strictly to exercise those choices against concrete cases.
- **Organizing form and likely scale:** Decision inventory, alternatives and consequences, followed by a compact end-to-end worked example; medium RFC.
- **Assumptions normally made without sources:** The example is representative enough to expose design pressure; readers can distinguish illustrative conventions from core requirements; key decisions can be isolated before implementation.
- **Largest likely gap or failure mode:** The example may silently determine the general model, or the decision inventory may remain too abstract to validate implementability.
- **Semantic tags:** `unresolved-decisions`, `tradeoffs`, `worked-example`, `architecture`, `semantics`, `implementation-state`

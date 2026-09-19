# Blind expectation trace BC-02

All approaches are unranked, source-free hypotheses. They preserve the subject: an RFC for the designer of a reusable software evidence base usable through command-line, editor, and tool-protocol interfaces, with at most one domain package as a worked example.

## BC-02-A — Evidence lifecycle contract

- **Public question or claim:** What lifecycle must evidence follow from intake through validation, publication, revision, deprecation, and removal?
- **Central intervention for the reader:** Define explicit states, transitions, ownership, and interface behavior for evidence throughout its usable life.
- **Organizing form and likely scale:** State-machine RFC with transition tables, invariants, failure handling, and interface-specific examples; medium scale.
- **Assumptions normally made without sources:** Evidence changes over time; agents need freshness and status signals; lifecycle transitions can be represented consistently across interfaces.
- **Largest likely gap or failure mode:** A tidy lifecycle model may conceal ambiguous real-world transitions, disputed ownership, or evidence that fits multiple states.
- **Tags:** `lifecycle`, `workflow`, `interfaces`, `authority`

## BC-02-B — Cross-interface capability model

- **Public question or claim:** How can command-line, editor, and tool-protocol clients expose the same evidence-base capabilities without requiring identical interaction patterns?
- **Central intervention for the reader:** Specify a shared capability contract, then map each capability into interface-appropriate commands, actions, and protocol methods.
- **Organizing form and likely scale:** Capability matrix followed by interface mappings, compatibility rules, and error semantics; medium scale.
- **Assumptions normally made without sources:** The interfaces share a common conceptual core; clients can tolerate differing presentation layers; parity can be tested at the capability level.
- **Largest likely gap or failure mode:** Apparent parity may break when an interface cannot support necessary context, streaming, confirmation, or stateful interaction.
- **Tags:** `interfaces`, `architecture`, `semantics`, `implementation-state`

## BC-02-C — Agent workflow journeys

- **Public question or claim:** Which end-to-end workflows must the evidence base support for agents discovering, evaluating, citing, updating, and reconciling evidence?
- **Central intervention for the reader:** Design the RFC around representative agent journeys and derive storage, lifecycle, and interface requirements from their steps.
- **Organizing form and likely scale:** Workflow narratives with sequence diagrams, preconditions, outputs, recovery paths, and cross-interface variants; medium to large scale.
- **Assumptions normally made without sources:** Recurring workflows can be identified; journeys reveal requirements better than isolated operations; agent behavior can be described independently of a particular implementation.
- **Largest likely gap or failure mode:** Selected journeys may overfit anticipated usage and omit unusual but consequential workflows.
- **Tags:** `workflow`, `interfaces`, `lifecycle`, `tradeoffs`

## BC-02-D — Provenance and authority operations

- **Public question or claim:** How should agents determine who asserted evidence, what supports it, whether it remains authoritative, and how conflicts are handled?
- **Central intervention for the reader:** Make provenance, authority, confidence, supersession, and conflict resolution operational parts of every read and write path.
- **Organizing form and likely scale:** Semantic model plus governance rules, conflict cases, audit events, and interface response shapes; large scale.
- **Assumptions normally made without sources:** Authority can be represented explicitly; provenance is available or collectible; consumers can interpret qualified evidence.
- **Largest likely gap or failure mode:** Formal authority metadata may imply certainty that the underlying organizational or technical process cannot sustain.
- **Tags:** `authority`, `semantics`, `lifecycle`, `interfaces`

## BC-02-E — Extensible core with one worked package

- **Public question or claim:** What belongs in the reusable evidence-base core, and what belongs in a domain package layered on top?
- **Central intervention for the reader:** Define the extension boundary through a neutral core contract and use one domain package solely to exercise that contract end to end.
- **Organizing form and likely scale:** Core/package architecture, extension points, packaging lifecycle, interface registration, and one bounded worked example; medium to large scale.
- **Assumptions normally made without sources:** Domains share enough structure for a reusable core; package-specific semantics can be isolated; one example can expose meaningful extension pressure.
- **Largest likely gap or failure mode:** The worked package may silently shape the supposedly neutral core around one domain’s needs.
- **Tags:** `architecture`, `worked-example`, `interfaces`, `lifecycle`, `implementation-state`

## BC-02-F — Decision-oriented operational RFC

- **Public question or claim:** Which operational decisions must be settled before the evidence base can support dependable multi-interface use?
- **Central intervention for the reader:** Surface unresolved choices—such as synchronization, caching, mutation rights, offline behavior, conflict policy, and compatibility—as explicit decision records.
- **Organizing form and likely scale:** Decision inventory with alternatives, assumptions, consequences, dependencies, and implementation checkpoints; medium scale.
- **Assumptions normally made without sources:** The main uncertainties can be enumerated; decisions have separable consequences; implementation can proceed through staged commitments.
- **Largest likely gap or failure mode:** Decomposing the design into decisions may obscure system-level interactions or leave the RFC as a catalog without a coherent operating model.
- **Tags:** `unresolved-decisions`, `tradeoffs`, `workflow`, `interfaces`, `implementation-state`

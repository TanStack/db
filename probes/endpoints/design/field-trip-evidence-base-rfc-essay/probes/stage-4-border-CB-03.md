# Expectedness trace: repair-rationale integration

## Reconstructed argument

TanStack Trust addresses a familiar gap: software guarantees are often asserted without a durable, inspectable account of whether current evidence supports them.

The likely RFC route is:

1. Define claims and the checks capable of producing relevant evidence.
2. Record evidence without equating a successful check with permanent truth.
3. Derive each claim’s current support state.
4. Track freshness as evidence ages or dependencies change.
5. Preserve contradictions instead of silently overwriting inconvenient results.
6. Repair broken or ambiguous evidence chains while retaining their history.
7. Expose the same trust state through CLI, LSP, and MCP surfaces.
8. Introduce architecture and authority boundaries where the workflow raises questions of ownership or interpretation.
9. Stop before consumer-specific severity policy and permission enforcement.
10. Demonstrate the model through a bounded prototype and one worked consumer.

## Familiar RFC assumptions and moves

The candidate relies on recognizable assurance-system premises:

- Evidence is time-sensitive and can become stale.
- Checks produce observations; they do not possess unlimited authority to declare guarantees.
- Conflicting observations are meaningful state, not merely cleanup noise.
- Repair must restore coherence without erasing how incoherence arose.
- Multiple interfaces should project one underlying trust model.
- Core machinery should remain separate from consumer-specific policy.
- A worked domain package illustrates consumption rather than defining the reusable layer.

Architecture therefore appears as an answer to workflow questions—who may assert, interpret, invalidate, or repair evidence—rather than as the opening subject.

## Narrative balance

The use-case lifecycle is foregrounded. Architecture and authority remain supporting explanations attached to particular activities. Failure-and-repair material is expected to function as connective rationale:

> failure witness → missing invariant → governing rule → repair behavior

The main integration risk is that the witness survives only as historical color. If the RFC first states a complete rule system and later presents failures as case studies, readers can understand the mechanics while losing why contradiction preservation, freshness, or constrained repair are necessary.

## Nearest generic collapse account

The nearest collapse is a metadata-registry RFC: schemas, lifecycle states, adapters, and interfaces become the substantive document, while motivating incidents collect in an appendix. “Repair” then reads as record maintenance, and the failures no longer explain the authority limits encoded by the system.

## Distinctions requiring source evidence

The frozen candidate cannot establish:

- whether witnesses are observed prototype failures, constructed examples, or anticipated scenarios;
- whether a witness historically produced a rule or was attached afterward;
- whether contradictions are retained as first-class evidence or only logged diagnostically;
- whether repair changes evidence, derived support, provenance links, or merely presentation;
- whether CLI, LSP, and MCP share identical authority or only common data;
- whether the worked consumer exercises the hard repair cases or only the happy path.

## Concrete collapse-risk scene

A newer successful check conflicts with an older failure. The implementation replaces the failure and marks the claim supported. Later, the RFC presents this as an isolated prototype anecdote, while an earlier architecture section independently states that contradictions must be preserved.

The rule and witness are both present, but their causal connection is missing. Contradiction preservation then looks like an abstract storage preference, and the repair episode looks like detached project history rather than the reason the rule exists.

# Candidate-border trace CB-02

## Reconstructed argument

TanStack Trust proposes a reusable, policy-neutral evidence layer. Claims and checks produce evidence that humans and agents can inspect, refresh, contradict, and repair. CLI, LSP, and MCP expose one operation model. Consumers retain authority over severity and permission. Architecture becomes relevant where these activities cross ownership, process, or interface boundaries. Failure and repair witnesses motivate the important constraints. The prototype and example domain demonstrate the model without defining its eventual scope.

## RFC moves and assumptions invited

The wording readily invites:

- Problem statement, goals, non-goals, and terminology.
- Actor and lifecycle use cases.
- Claim, check, evidence, contradiction, freshness, and repair data models.
- A shared operation layer with CLI/LSP/MCP adapters.
- Storage, identity, provenance, synchronization, and invalidation architecture.
- Authority matrices for producing, accepting, contradicting, repairing, and deleting evidence.
- Consumer policy hooks for severity and permission.
- Failure modes, security boundaries, compatibility, and prototype limits.

It also invites assumptions that evidence has stable identity and provenance; operations behave consistently across interfaces; freshness is computable; contradictions are representable; repairs retain history; and consumer policy can remain separate from evidence semantics.

## Balance among the three strands

Operational use cases dominate the explicit structure: the RFC follows work from claim design through repair.

Architecture and authority do not vanish, but appear conditionally, only when workflows cross boundaries. The wording does not yet preserve whether those boundaries are organizational, process-local, storage-related, protocol-related, or security-related.

Repair rationale remains present as a stated origin for rules, while most of its causal detail vanishes. “Failure and repair witnesses” names the justification mechanism without reconstructing the incidents, observations, or rule derivations.

## Nearest generic collapse

The account could collapse into a conventional evidence/provenance service RFC: a central model, lifecycle API, persistence layer, authorization boundary, and CLI/LSP/MCP adapters. It could also read as a policy-neutral verification control plane whose domain package is merely an example client.

## Distinctions the wording cannot preserve alone

The frozen wording cannot distinguish:

- Evidence from test results, attestations, provenance records, or cached verification output.
- A check from a validator, policy rule, executable assertion, or observation.
- Contradiction from failure, staleness, supersession, or competing testimony.
- Repairing evidence from rerunning a check, editing metadata, replacing a claim, or resolving the underlying software defect.
- Consumer-owned permission from producer authority over evidence mutation.
- One operation layer from merely similar commands exposed through three adapters.
- Workflow-derived architectural boundaries from architecture imposed in advance.
- Illustrative domain semantics from semantics required by the reusable core.

## Concrete collapse-risk scene

An agent using MCP discovers that evidence supporting a claim is stale and contradicted. It initiates repair; an editor displays the new status through LSP, while a release CLI applies its own severity policy.

The wording does not determine who may authorize the repair, whether the agent may replace evidence, which store arbitrates competing updates, or whether the release consumer can reject an otherwise valid repair. Once those questions are answered through service ownership, mutation APIs, authorization roles, and consistency rules, the workflow account can be absorbed by a conventional architecture RFC; the failure witness that originally explained the repair rule may remain only as background motivation.

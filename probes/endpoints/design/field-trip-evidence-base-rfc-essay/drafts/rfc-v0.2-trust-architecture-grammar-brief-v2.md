# TanStack Trust RFC — architecture-led reading

## What this tells us

TanStack Trust is the architecture for safely automating work that people
mostly perform by hand today: defining software guarantees, choosing evidence,
checking that a test reached the behavior it claims to observe, preserving
failures, deciding whether old evidence still applies, and repairing what a
counterexample defeated. Cheaper code generation increases the volume of this
work. Capability alone does not make generated software deployable; useful
guarantees must be bounded, their controls tested, and their evidence kept
current.

The architecture has four progressively deeper parts.

First is **authority**. A domain package defines what a bounded guarantee means,
which checks and rules may support it, where evidence applies, and what those
checks omit. Trust maintains evidence without judging the domain law itself.
Consumer policy decides permission, severity, and fallback. Workflows and
interfaces carry this work but cannot authorize it.

Second is the **evidence graph**. Claims name propositions. Immutable
observations report reached executions under captured conditions. Registered
rules declare accepted premises. Arguments preserve AND within one support
route and OR across alternatives; cycles do not ground themselves.
Applicability relates evidence context to a requested use. Challenges retain
objections and observed failures. Runs group provenance, while tasks project
unresolved gaps rather than creating support.

Third is **current authority through time**. Evidence state, execution reach,
operational failure, and consumer policy remain separate. Named code, data,
configuration, environment, method, and external dependencies receive monotonic
revisions, so an a-to-b-to-a change does not revive old evidence. A failing
observation opens a challenge. Only a fresh, applicable replay of the same law
and case that starts after the failure can repair it. If the replay’s
dependencies later change, its current authority expires while the historical
repair remains.

Fourth is **operation**. Complete explanations expose routes, gaps,
observations, dependencies, challenges, applicability, bounds, and witnesses.
Check-design, evidence-maintenance, and repair workflows tell agents what work
to perform. One service presents the same semantics through CLI, LSP, and MCP.
Consumer policy then acts on the result without rewriting evidence state.

## What it changes

The RFC should use those architectural layers as its spine. Within each layer,
it should answer a practical question, show one minimal example, state the
precise rule, and end with implementation status and limits. Endpoints should
appear in short, recurring illustrations: safe-skip as a bounded claim, a
missed production checkpoint as no observation, an analyzer revision making
evidence stale, an exact replay repairing a failure, and the current adapters
exposing one service.

The current Endpoints trust loop is the target vertical, not the subject of the
RFC or the first executable task. Typed contracts, applicability, explanation,
authorized rule admission, generic agent operations, and explicit consumer
policy are dependencies needed to complete it.

## What it does not tell us

The Endpoints-hosted prototype does not establish checker soundness,
portability, agent effectiveness, reduced human work, or safer software.
Endpoints helped form the architecture and therefore is not independent range
evidence. Other TanStack examples remain illustrations until checked.

Applicability ownership, three-valued semantics, durable operational-failure
history, richer repair, admission governance, deployment security, and scale
remain unresolved or absent. No universal score, ranking, permission, or
fallback is selected. Trust remains an internal Endpoints layer for the
foreseeable future; extraction is optional and deferred.

# TanStack Trust RFC — dependency-led reading

## What this tells us

Code generation is becoming cheap; guarantee work is not. People still define
what software should guarantee, choose authoritative checks, confirm that a
check reached the behavior it claims to test, preserve failures, and decide
what the evidence permits. Agents can help automate this work only if they
cannot create authority by producing a plausible pass result.

Start with one Endpoints decision. After a mutation, may a retained query safely
skip its refetch? The bounded answer depends on five premises: the query and
mutation share an artifact, the collection has an authority baseline, no
optimistic or repair obligation is pending, both effect bounds are complete,
and the query’s reads do not intersect the mutation’s writes. External writes
remain outside the law. Even when the check returns pass, product policy still
decides whether to enable the optimization.

That example creates the need for three responsibilities. Endpoints domain code
defines the claim, the check, its applicability, and what evidence is adequate.
The internal Trust layer records observations, preserves support routes and
contradictions, tracks dependency freshness, and links repairs to the failures
they actually replay. Consumer policy decides permission, severity, and
fallback. Workflows and CLI/LSP/MCP interfaces help humans and agents perform
and inspect the work; they do not become another source of truth.

The evidence model then follows naturally. Claims can exist before evidence.
Observations report one reached execution under captured conditions. Evidence,
execution reach, operational failure, and policy remain separate. Rules say
which premises they admit. Arguments keep jointly required premises together
and alternate routes separate; cycles do not ground themselves. Applicability
relates old evidence to the requested use. Challenges retain objections and
observed failures. A context change advances history even if bytes later return
to an earlier value. A repair counts only when a fresh, applicable replay of
the same law and case begins after the failure; its authority can later expire
without deleting the repair record.

## What it changes

The RFC should introduce ideas in that order: human burden, concrete decision,
bounded guarantee, ownership, evidence vocabulary, evidence lifecycle, agent
workflows and interfaces, current implementation, then unresolved decisions and
build work.

The Endpoints trust loop should be presented as the target vertical, not the
first independent engineering task. Completing it depends on typed internal
contracts, an applicability decision, complete explanations, authorized rule
admission, generic agent operations, and explicit consumer policy.

The same operation service should drive CLI, editor, and agent surfaces.
Consistency across adapters prevents semantic drift; it is not independent
corroboration. Explanations are part of the product because agents need routes,
gaps, dependencies, challenges, bounds, and witnesses to choose valid next
work.

## What it does not tell us

The current working-tree prototype implements a finite kernel, local verified
storage, one Endpoints check, and three adapters, with bounded evidence from 21
tests and eight mutation controls. It does not establish checker soundness,
analyzer completeness, security against hostile actors, multi-process safety,
agent effectiveness, reduced human labor, safer software, or portability.
Endpoints helped form the architecture, so it is not an independent range test.

Applicability ownership and boolean versus three-valued results remain open.
Operational failures correctly create no correctness observation, but their
durable agent-facing history has no specified home. No universal confidence
score, evidence ranking, priority order, permission rule, or fallback is
selected. Extraction into a separate product remains optional and deferred.
Formal and other donor systems contribute bounded evidence or explanation
mechanisms; their encodings remain domain-owned, and none validates Trust.

## Concrete cases

- **Endpoints, implemented narrowly:** retain the safe-skip law, observations,
  dependency revisions, challenges, exact replay, and policy boundary.
- **TanStack Query, illustrative:** a future domain package might define what a
  cache-persistence or hydration guarantee means, which versions and options
  affect it, and what replay repairs a known failure.
- **TanStack Router, illustrative:** a future package might define a bounded
  correspondence between generated route metadata and runtime matching, while
  retaining unsupported route forms and model-to-runtime limits.

The latter two clarify the architecture only. They must be checked against the
real libraries after drafting and do not count as implemented support or range
evidence.

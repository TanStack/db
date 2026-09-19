# BC-03 — neutral substantive-RFC prompt

## Likely thesis

Software is easy to produce, but dependable use requires explicit evidence and
authority: “Coding is cheap; justified reliance is not.” The RFC likely argues
for “Separating domain meaning, reusable evidence mechanics, and consumer
policy.”

## Product shape

A proposed shared infrastructure layer—“a proposed base layer for building
evidence systems inside specific software domains”—combined with domain
packages, workflows, interfaces, and consumer policies. “Endpoints: one bounded
reconstruction of the handoffs” likely serves as the concrete vertical example
rather than a universal product.

## Authority boundaries

Domain packages define guarantees and authoritative checks: “The domain package
owns the promise.” The base manages records but does not determine correctness:
“The base owns evidence mechanics, not domain truth.” Workflows maintain
evidence, interfaces expose it, and “Consumer policy owns permission and
fallback.”

## Evidence lifecycle

The core mechanics likely record positive support, conflicts, aging, and
corrective work because “the base maintains inspectable support, contradiction,
freshness, and repair records.” Maintenance crosses layers through “Workflows
carry maintenance obligations across the handoff,” while consumers translate
current evidence into permission or fallback.

## Implementation status

This is explicitly “a proposed base layer,” not a completed system. The RFC
“identifies what remains unimplemented or undecided,” and the Endpoints material
is described as “one bounded reconstruction,” suggesting a partial
demonstration or design reconstruction.

## Expected donor ideas

The RFC likely draws reusable techniques from existing evidence, verification,
provenance, and maintenance systems, then identifies where analogy fails. The
only definite public characterization is “Borrowed mechanisms, breakpoints, and
the decision register”; the donors themselves are omitted.

## Unresolved questions

Expected open issues include which mechanics are truly reusable, where domain
authority begins, how uneven interfaces preserve one service, and which
decisions remain open. These follow from “Interfaces expose one service
unevenly,” “breakpoints,” “the decision register,” and “what remains
unimplemented or undecided.”

## Expected ending

The RFC likely closes with a bounded conclusion: Endpoints demonstrates the
handoffs, but broader adoption awaits explicit decisions and implementation.
That follows from “one bounded reconstruction of the handoffs” and “the decision
register,” while reiterating that “Domain packages own what their guarantees
mean,” “the base maintains inspectable” records, and “consumers decide what that
state permits.”

## Largest likely overclaim or collapse risk

The claimed separation between “evidence mechanics” and “domain truth” may
collapse if deciding what counts as “support, contradiction, freshness, and
repair” itself requires domain-specific meaning and authority.


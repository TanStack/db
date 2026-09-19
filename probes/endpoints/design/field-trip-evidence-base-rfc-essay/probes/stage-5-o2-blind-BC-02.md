# BC-02 — owner-first prompt

## Owner map

Domain packages define guarantee semantics and authoritative checks (“Domain
packages own what their guarantees mean and which checks have authority”). The
base stores reusable evidence state (“the base maintains inspectable support,
contradiction, freshness, and repair records”) without deciding truth (“The
base owns evidence mechanics, not domain truth”). Workflows preserve evidence
over time (“Workflows carry maintenance obligations across the handoff”).
Interfaces present the same service with differing capability (“Interfaces
expose one service unevenly”). Consumers determine allowed actions and recovery
behavior (“Consumer policy owns permission and fallback”).

## Section/argument progression

The RFC likely moves from the economic problem (“Coding is cheap; justified
reliance is not”), to explicit responsibility boundaries (“The authority map:
domain, base, workflow, interface, consumer”), through each owner's contract in
sections 3–7, then tests those handoffs with a narrow example (“Endpoints: one
bounded reconstruction of the handoffs”), and closes by identifying precedents,
failure boundaries, and unresolved choices (“Borrowed mechanisms, breakpoints,
and the decision register”).

## Central evidence mechanism

The core mechanism is an inspectable record that distinguishes positive
support, conflicting evidence, aging evidence, and remediation history
(“inspectable support, contradiction, freshness, and repair records”). Its role
is bookkeeping and maintenance across ownership boundaries, not adjudicating
domain meaning (“Separating domain meaning, reusable evidence mechanics, and
consumer policy”).

## Product shape

The product is likely a shared foundational service or package embedded beneath
domain-specific guarantee systems (“a proposed base layer for building evidence
systems inside specific software domains”). Its architecture comprises domain
packages, reusable evidence mechanics, workflows, interfaces, and consumer
policy (“the authority map: domain, base, workflow, interface, consumer”),
demonstrated through an Endpoints-specific vertical (“shows the bounded
Endpoints vertical”).

## Implementation status

This is a design proposal rather than a completed system (“TanStack Trust is a
proposed base layer”). The RFC is expected to distinguish designed handoffs from
unfinished work because it explicitly “identifies what remains unimplemented or
undecided.”

## Expected borrowed mechanisms

The RFC likely maps existing patterns onto evidence recording, staleness,
contradiction handling, repair tracking, and unresolved-decision tracking,
supported by “inspectable support, contradiction, freshness, and repair
records” and “Borrowed mechanisms, breakpoints, and the decision register.” No
named source mechanism can be reconstructed from the public elements.

## Likely omissions/open decisions

Expected open areas include precise breakpoint behavior and unresolved
architectural choices (“breakpoints, and the decision register”), incomplete
implementation details (“what remains unimplemented”), interface capability
differences (“Interfaces expose one service unevenly”), and the exact
permission/fallback policies consumers will adopt (“Consumer policy owns
permission and fallback”). Generalization beyond Endpoints also remains
unestablished because the only stated vertical is “one bounded reconstruction
of the handoffs.”

## Likely conclusion

The RFC likely concludes that trustworthy software guarantees require an
explicit separation: domains define promises, the base records evidence state,
workflows maintain it, interfaces expose it, and consumers decide whether
reliance is permitted. That follows directly from “Domain packages own what
their guarantees mean,” “the base maintains inspectable support,” “Workflows
carry maintenance obligations,” “Interfaces expose one service unevenly,” and
“consumers decide what that state permits.”

## Largest likely overclaim or collapse risk

Treating “one bounded reconstruction” in Endpoints as sufficient support for “a
base for domain-owned software guarantees,” especially while the system remains
“proposed” and contains work that is “unimplemented or undecided.”


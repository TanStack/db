# BC-01 — canonical prompt

## Product shape

A proposed reusable base layer for domain-specific guarantee/evidence systems,
demonstrated through an Endpoints vertical and accompanied by a decision
register.

Support: “a proposed base layer for building evidence systems inside specific
software domains”; “shows the bounded Endpoints vertical”; “Borrowed mechanisms,
breakpoints, and the decision register.”

## Owner map

Five ownership zones: domain packages define guarantees and authoritative
checks; the base manages evidence state; workflows maintain it; interfaces
expose it; consumers decide permission and fallback.

Support: “The authority map: domain, base, workflow, interface, consumer”;
“Domain packages own what their guarantees mean and which checks have
authority”; “consumers decide what that state permits.”

## Mechanism sequence

Domain defines a promise and its authoritative checks → checks produce evidence
→ base records support, contradiction, freshness, and repair → workflows carry
maintenance duties → interfaces expose the service → consumer policy chooses
permission or fallback.

Support: “The domain package owns the promise”; “the base maintains inspectable
support, contradiction, freshness, and repair records”; “Workflows carry
maintenance obligations across the handoff”; “Interfaces expose one service
unevenly”; “Consumer policy owns permission and fallback.”

## Implementation status

Primarily a proposal/specification, with Endpoints serving as a bounded
reconstruction or vertical rather than evidence that the full system exists.
Some elements are explicitly unimplemented or undecided.

Support: “is a proposed base layer”; “This RFC defines those handoffs”;
“Endpoints: one bounded reconstruction of the handoffs”; “identifies what
remains unimplemented or undecided.”

## Expected borrowed mechanisms

Likely borrowed mechanics include provenance-style support records,
contradiction tracking, freshness/expiry handling, repair or remediation
records, workflow-carried maintenance, and policy-based permission/fallback. No
particular source systems are publicly identified.

Support: “reusable evidence mechanics”; “inspectable support, contradiction,
freshness, and repair records”; “Workflows carry maintenance obligations”;
“Consumer policy owns permission and fallback”; “Borrowed mechanisms.”

## Likely omissions/open decisions

Likely unresolved details include evidence schemas, freshness rules,
contradiction resolution, repair lifecycle, workflow obligations, interface
parity, consumer defaults/fallbacks, and whether Endpoints generalizes beyond
its bounded case.

Support: “what remains unimplemented or undecided”; “Interfaces expose one
service unevenly”; “breakpoints, and the decision register”; “one bounded
reconstruction.”

## Likely conclusion

The RFC will likely conclude that reusable evidence infrastructure is feasible
only when authority remains explicitly divided: domain packages own meaning,
the base owns mechanics, workflows maintain state, interfaces expose it, and
consumers retain the final policy decision. Endpoints will illustrate this
division without closing every implementation question.

Support: “Separating domain meaning, reusable evidence mechanics, and consumer
policy”; “defines those handoffs”; “The base owns evidence mechanics, not domain
truth”; “Consumer policy owns permission and fallback.”

## Largest likely overclaim or collapse risk

The broadest likely overclaim is extrapolating a domain-neutral “base” from “one
bounded” Endpoints reconstruction. The separation could collapse if generic
support, contradiction, freshness, or repair semantics quietly determine
domain truth—or if exposed evidence state effectively dictates consumer
permission despite the stated ownership boundaries.


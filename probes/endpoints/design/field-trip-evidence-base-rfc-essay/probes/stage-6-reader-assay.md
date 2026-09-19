# Stage 6 Reader Assay

## Frozen specimen and reader setting

- Draft: `drafts/tanstack-trust-rfc-v0.1.md`
- SHA-256: `95e0fce47cf051928f0b59eb3b072aedbf1737533cdbfcd8c38f6acd63f7d742`
- Reader setting: a TanStack maintainer or senior contributor with strong
  TypeScript and framework experience but no prior access to the evidence-base
  Field Log, design grammar, validation history, or intended reader-promise
  result
- Three fresh sibling-hidden contexts saw only the RFC, the reader setting, and
  the same neutral questions

## Exact questions

1. What does the RFC claim and propose?
2. Where does it confuse you or fail to convince you?
3. What detail or distinction remains most memorable?
4. What can you now notice, explain, decide, or attempt that was not available
   before reading?
5. What feels generic, predictable, or insufficiently specific?

## Reader 1 — exact response

### 1. What it claims and proposes

The RFC claims that the agent-era bottleneck is “justified reliance,” not code
production. It proposes TanStack Trust as a reusable evidence-lifecycle base
with a strict authority split:

- Domain packages own claim meaning, check/rule authority, applicability,
  omissions, and evidence adequacy.
- TanStack Trust owns observations, structured support routes, provenance,
  freshness, contradictions, repair history, and shared operations.
- Consumer policy owns permission, severity, fallback, and deployment action.
- Workflows and interfaces carry these responsibilities without becoming
  sources of truth.

Its central data model is six primitives: Claim, Observation, Rule, Argument,
Applicability condition, and Challenge. It proposes preserving conjunctive
premises and disjunctive evidence routes, reporting evidence/execution/policy as
three independent axes, expiring evidence when relevant dependencies change,
and resolving contradictions only through a later applicable replay of the same
law and case.

It also reports a bounded prototype: a finite local kernel, checked file
storage, one Endpoints `safe-skip-refetch` package, and CLI/LSP/MCP adapters over
one service. The “Proposed build sequence” prioritizes freezing the
domain-package contract, completing explanations, adding generic operations,
then testing distribution and a genuinely independent second domain.

### 2. Where it confuses me or fails to convince me

The authority map is conceptually clear but not yet operationally clear.
“Registered rule code is a trust root,” while rule admission, inspection,
registration, and agent-safe governance are absent. Consequently, I understand
who should own authority, but not how a real project establishes or maintains
that authority.

The proposed base still feels unstable because key boundary semantics remain
unresolved: applicability ownership and boolean versus three-valued results;
semantic identity and scope subsumption; speculative versus observed challenges;
alternate repairs; and distributed causality. These seem central to the
abstraction rather than peripheral extensions.

I am not yet convinced that the mechanics generalize cleanly. The RFC explicitly
says, “Endpoints is not range evidence for TanStack Trust,” and no second
independent domain has tested the boundary. Most implementation evidence
therefore supports the coherence of one vertical slice, not the reusable package
shape.

The concrete public programming model remains hard to picture. The RFC discusses
typed claims, arguments, routes, citations, and explanations, but says the
generic extension protocol and most authoring operations are absent. I can infer
the concepts but not what integrating a package would actually feel like in
TypeScript.

“Small reusable base” is also somewhat in tension with the breadth of
responsibilities: graph grounding, provenance, dependency revisioning, challenge
causality, replay, storage integrity, explanation, and several adapters. The
document is candid about this scope, but does not establish that the resulting
base is small in implementation or maintenance terms.

### 3. Most memorable detail

The most memorable rule is: if a dependency changes from `a` to `b` and back to
`a`, old evidence does not revive—“The bytes may match; the old execution has
not happened again in the current history.”

Closely related, repair timing is causal: a passing check that began before a
failure was recorded cannot resolve that failure merely because it completed
later. Together these details make evidence history feel materially different
from ordinary cached test results.

### 4. What is newly available after reading

I can now separate three facts that developer tooling often collapses: what
evidence establishes, whether a check actually reached the declared production
checkpoint, and what policy permits. In particular, `unknown`, failure to
execute the production path, an applicable counterexample, and policy denial
are not different degrees of the same verdict.

I can also describe support as routes rather than a checklist: premises within
one route are jointly required, while separate routes are alternatives. This
makes it possible to explain why one strong observation cannot substitute for a
missing premise and why cycles do not ground claims.

I could attempt to sketch a domain package by stating a bounded law,
satisfying/violating/unresolved cases, authorized rules, production checkpoint,
dependencies, omissions, reach and fault controls, and same-case replay
obligation. I could also decide consumer behavior separately without treating
evidence state as permission.

### 5. What feels generic, predictable, or insufficiently specific

The opening “coding is cheap; justified reliance is not” thesis is familiar
agent-era framing. The conclusion's promise of reliable, efficient,
maintainable software is similarly broad.

The three workflow sections—design, maintain, repair—mostly describe sound
engineering discipline that would apply to many test or verification systems.
Their distinctive value is not yet demonstrated because agent ergonomics and
correction outcomes are explicitly unmeasured.

The borrowed-mechanism ledger is careful, but much of it confirms predictable
limitations: models may not correspond to implementations, solvers depend on
encodings, bounded checks are not unbounded guarantees, and workflows do not
create authority.

The build sequence is sensible but still high-level. Details remain thin around
package manifests, rule review boundaries, typed explanation schemas,
dependency discovery, scale expectations, and the developer experience of
integrating a non-Endpoints TypeScript domain.

## Reader 2 — exact response

### 1. What it claims and proposes

The RFC claims that agentic coding shifts the constraint from producing code to
establishing “justified reliance.” It proposes TanStack Trust as a reusable
evidence-lifecycle base with strict ownership boundaries:

- Domain packages define claims, rules, evidence adequacy, applicability, and
  omissions.
- TanStack Trust records observations, traverses structured support routes,
  tracks provenance/freshness/challenges, and preserves repair history.
- Consumers decide permission, severity, rollout, and fallback.
- Workflows and CLI/LSP/MCP interfaces carry these semantics without becoming
  authorities.

Its model preserves conjunction within evidence routes and alternatives between
routes, separates evidence/execution/policy axes, and requires fresh applicable
replay to resolve contradictions. The present implementation is explicitly only
a local vertical slice: a kernel, checksummed file store, Endpoints
`safe-skip-refetch` package, and three adapters. The proposed sequence is to
stabilize the package contract, complete explanations and generic operations,
repackage Endpoints, ship integrations, test a second domain, then harden
operations.

### 2. Several points remain unclear or unconvincing

- The product identity is diffuse. “Small reusable base” could mean a TypeScript
  library, protocol, local service, evidence database, package-authoring
  framework, or developer workflow; the RFC eventually encompasses all of
  these.
- The central applicability semantics are unresolved: ownership of matching and
  boolean versus three-valued results. Because freshness and contradiction
  resolution depend on applicability, this leaves a foundational behavior
  unsettled.
- Checker admission is also unresolved. The domain owns rule authority, while
  the base explicitly cannot establish checker soundness. Until the “authorized
  review boundary” exists, the distinction between a disciplined evidence
  ledger and meaningful trust infrastructure is hard to assess.
- The domain-package obligation is substantial—laws, three outcome cases,
  oracle, production checkpoint, dependency capture, omissions, reach controls,
  fault controls, and replay—but only the grammar-forming Endpoints example
  exists. The RFC is candid that workflow effectiveness and cross-domain range
  are unmeasured, so it does not yet convince me that teams will consistently
  recover enough value to bear that cost.
- “Pass” is overloaded. Section 3 says “A check may pass because it correctly
  observed an application violation,” while later an application violation
  produces a `fail` observation and a thrown/unreached check produces no
  observation. The intended separation is understandable, but the vocabulary
  makes execution success and evidence outcome easy to conflate.
- The exact scope by which a challenge defeats evidence, one route, or an entire
  claim is not fully concrete. Likewise, the LSP's error/warning mapping feels
  policy-like despite the insistence that consumer policy owns severity.
- There are no representative public types, stored records, or complete
  explanation payloads, so the maintainer-facing integration experience remains
  abstract.

### 3. The most memorable distinction

“Timing is causal, not cosmetic.” A repair must execute after the failure is
recorded; an earlier pass that returns later, or a pass bundled with the failing
batch, cannot resolve the challenge. Combined with append-only resolution
history and later expiry, this gives “repair evidence” unusually precise meaning.

### 4. After reading, I can

- Notice when a tool collapses evidence, execution reach, and policy into one
  green/red verdict.
- Explain why missing evidence, an inconclusive observation, a counterexample,
  an unreached checkpoint, and a policy denial are different states.
- Recognize that `P1 AND P2` versus alternative route `P3` cannot safely become
  a flat task checklist.
- Identify agent self-authorization when a generated “pass-shaped payload”
  supplies its own authority.
- Attempt to frame a new domain package around a bounded law,
  satisfying/violating/unresolved cases, explicit production checkpoint,
  captured dependencies, omissions, fault controls, and exact replay
  obligations.
- Explain why evidence does not revive merely because a dependency changes
  `a → b → a`.

### 5. What feels generic, predictable, or insufficiently specific

The opening “coding is cheap; justified reliance is not” thesis is familiar.
Much of the donor ledger restates standard cautions: bounded model checking is
bounded, encodings are trust roots, tests do not establish unobserved behavior,
and provenance counts are not confidence. The workflows largely resemble
disciplined test design and incident repair—define the law, exercise negative
controls, reproduce, reduce, fix the correct layer, replay—without yet
demonstrating a specifically TanStack-shaped operational experience. The
proposed build sequence is also predictable: contract, explanation, generic
operations, integrations, second-domain validation, then hardening.

## Reader 3 — exact response

### 1. What it claims and proposes

The RFC argues that agentic coding shifts the bottleneck from producing code to
establishing “justified reliance.” It proposes a layered architecture:

- Domain packages define bounded guarantees, authoritative checks,
  applicability, and omissions.
- TanStack Trust records and evaluates evidence, provenance, freshness,
  contradictions, and repair history.
- Consumer policy decides permission, severity, fallback, and deployment action.
- Workflows and CLI/LSP/MCP interfaces carry these semantics without becoming
  new authorities.

Its core model uses six primitives—Claim, Observation, Rule, Argument,
Applicability condition, and Challenge—and separates evidence, execution/reach,
and policy into independent axes.

The implementation is explicitly narrower: a finite local kernel, verified
local storage, one Endpoints safe-skip check, and three adapters. Most generic
package-authoring, explanation, security, deployment, and agent-workflow
capabilities remain proposed, absent, or unmeasured.

### 2. Where it confuses or fails to convince

The most consequential abstraction remains unresolved. Under “Applicability is
part of meaning,” the RFC has not decided who owns matching or whether
applicability is boolean or three-valued. Semantic identity, scope subsumption,
and cross-version mapping are also unresolved. Those concepts determine whether
evidence is current and relevant, so the proposed reusable boundary still feels
provisional.

Generality is not yet convincing. Endpoints both helped form the grammar and is
its only domain instantiation; the RFC correctly says, “Endpoints is not range
evidence for TanStack Trust.” Without an independently developed second domain
or a stable extension API, I cannot yet tell whether this is a reusable TanStack
base or an abstraction extracted around one carefully bounded example.

The authority story is conceptually clear but operationally incomplete.
“Registered rule code is a trust root,” while checker admission, review,
registration, and governance are absent. Consequently, the current system can
preserve the provenance of authority without establishing how that authority is
legitimately granted.

There is also a tension around execution failures. Reach is presented as an
independent reporting axis, but “If a check throws or fails to reach its declared
checkpoint, the operation fails outside evidence history.” It is unclear how a
later agent reconstructs repeated harness failures or missing reach if those
events are not retained alongside evidence history.

Finally, the LSP maps contradiction to error and unresolved to warning while
interfaces are said not to own severity. The RFC labels this adapter behavior
rather than universal policy, but the practical boundary between presentation
defaults and consumer policy remains blurry.

### 3. Most memorable detail

The dependency revision rule is the strongest detail:

> “If a dependency changes from `a` to `b` and later back to `a`, the old
> evidence does not revive. The bytes may match; the old execution has not
> happened again in the current history.”

That makes freshness temporal and causal rather than merely content-addressed.
The related rule that an earlier-started pass cannot repair a later-recorded
failure is similarly precise.

### 4. What is newly available after reading

I can now distinguish several things that are commonly collapsed into one
green/red result:

- whether a claim has a valid evidence route;
- whether the intended production checkpoint was reached;
- whether current context makes the observation applicable;
- whether an open challenge defeats the support; and
- whether consumer policy permits action.

I could also attempt to specify a domain package by stating its law,
satisfying/violating/unresolved cases, conjunctive and alternative evidence
routes, dependencies, reach controls, fault controls, omissions, and exact
replay obligation. The RFC provides a useful vocabulary for explaining why a
pass-shaped result or a closed-world solver proof does not automatically justify
an open-world production decision.

### 5. What feels generic or insufficiently specific

“Coding is becoming cheap” and the broader agent-era verification framing are
familiar. The Lean, Datalog, Z3, TLA+/Alloy, provenance, and lint-tool analogies
are sensible but largely predictable at their stated level.

The design and repair workflows mostly restate strong testing discipline:
define the law first, include positive/negative/unknown cases, use an independent
oracle, verify reach, inject faults, preserve failures, and replay them.

The RFC is least specific where the eventual product boundary matters most:
public schemas, the domain-package manifest, authorized registration, a complete
explanation result, applicability semantics, capability negotiation, and an
end-to-end example of an agent consuming a diagnostic and successfully repairing
a claim. The Endpoints example is concrete, but its independent oracle exercises
a small set-intersection kernel over pre-analyzed inputs, leaving the difficult
analyzer and production-policy questions outside the demonstrated result.

## Collated reading

### Stable recoveries

All three generated readers recovered:

- the cheap-code versus justified-reliance thesis;
- the domain/base/consumer authority split and carrier role of workflows and
  interfaces;
- separate evidence, execution/reach, and policy axes;
- structured support, freshness, challenge, and replay mechanics;
- the local Endpoints/CLI/LSP/MCP prototype as a bounded slice rather than the
  complete product; and
- the proposed ordering from package contract and explanation through generic
  operations, installation, second-domain range, and operational hardening.

### Stable confusions and non-convictions

All three identified applicability and semantic identity as foundational and
unresolved, rule/check admission and governance as operationally absent, the
single Endpoints vertical as inadequate generality evidence, and the public
package/integration experience as too abstract to evaluate fully.

Two readers questioned the LSP error/warning mapping as policy-like. Two
questioned whether the domain-authoring burden will justify its cost. One
questioned whether the responsibility set still deserves “small base,” one
identified `pass` as overloaded between successful execution and evidence
outcome, and one asked where repeated operational reach failures remain visible
if they stay outside evidence history.

### Memorable particulars

All three retained the coupled freshness/replay pair. Two foregrounded
`a → b → a`; one foregrounded “Timing is causal, not cosmetic.” These are
text-specific particulars, not generic trust language.

### Usable changes

All three said they could now distinguish evidence, execution/reach,
applicability/challenge state, and consumer permission rather than reading them
as one verdict. All three could sketch a domain package with a bounded law,
three outcome cases, routes, dependencies, omissions, reach/fault controls, and
replay obligation. The earlier reader promise—an authority model, traceable
evidence lifecycle, and status-honest evaluation surface beyond a component
inventory—appeared in each response.

### Genericity signals

All three described the cheap-code opening as familiar, the workflow discipline
as recognizable testing/repair practice, and several donor breakpoints as
predictable cautions. The distinct material was not the novelty of those parts;
it was their integration with exact freshness, reach, route, replay, and
authority boundaries. Every reader wanted more concrete public types,
registration governance, package integration, and non-Endpoints use evidence.

## Trace and limits

Every stable recovery and confusion above maps to a stated RFC passage. No
reader invented certification, a universal solver, production readiness, or an
implemented generic package API. The isolated `pass` ambiguity is text-supported:
section 3 uses “check may pass” for successful observation while section 4 names
`pass`, `fail`, and `unresolved` evidence outcomes. The operational-failure
history question is also supported by the explicit rule that non-reach remains
outside evidence history; the RFC does not specify a separate operational log.

The responses are three correlated model samples, not audience consensus.
Their shared reader description may suppress role-specific reactions, and the
long prompt may increase analytic rather than natural reading. They do not
establish adoption, credibility, preferred wording, or real maintainer behavior.


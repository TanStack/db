# TanStack Trust RFC v0.2 — Reader Assay

## Frozen input and control

- Draft: `drafts/tanstack-trust-rfc-v0.2.md`
- SHA-256: `c4abd5aba9496538ba7feab2b7fff1f17b87fe9cb8134ffb4fefc1300d880d28`
- Reader setting: a TanStack maintainer or senior contributor with strong
  TypeScript and framework experience but no prior access to the TanStack Trust
  Field Log, Design Grammar, Oracle Guide, validation history, intended reader
  promise, or sibling responses.
- Readers: three parallel, sibling-hidden fresh model contexts.
- Boundary: each reader saw only the frozen RFC, the same reader setting, and
  the same neutral questions. They did not see the source trace, author thesis,
  earlier v0.1 responses, Meso-Level Density result, intended answer, or sibling
  output.
- Correlation limit: all three readers used the same model family. Recurrence is
  a pattern among generated samples, not audience consensus.

## Exact shared prompt

> You are a fresh reader in a Reader Assay. Reader setting: a TanStack
> maintainer or senior contributor with strong TypeScript and framework
> experience but no prior access to the TanStack Trust Field Log, Design
> Grammar, Oracle Guide, validation history, intended reader-promise result, or
> sibling responses. Read only this frozen RFC. Do not inspect any other files
> or conversation context. Answer these neutral questions independently, citing
> RFC sections or phrases where useful: 1. What does the RFC claim and propose?
> 2. Where does it confuse you or fail to convince you? 3. What detail or
> distinction remains most memorable? 4. What can you now notice, explain,
> decide, or attempt that was not available before reading? 5. What feels
> generic, predictable, or insufficiently specific? Mark any inference that is
> not clearly supported by the text. Do not recommend edits or score the RFC.

## Reader A — exact response

Verified SHA-256: `c4abd5aba9496538ba7feab2b7fff1f17b87fe9cb8134ffb4fefc1300d880d28`.

### 1. What does the RFC claim and propose?

The RFC’s central claim is that agentic coding makes implementation cheaper
without making reliance cheaper: someone must still define the relevant law,
establish that a check exercised what it claims, preserve contradictory
evidence, and decide whether current evidence permits action (§1, “Coding is
cheap; justified reliance is not”).

It proposes TanStack Trust as an internal architectural layer within TanStack
DB Endpoints, not a standalone product. The responsibility split is:

- A domain package owns claim meaning, laws, check authority, evidence adequacy,
  applicability, and omissions.
- Trust owns reusable evidence mechanics: observations, support-route traversal,
  provenance, freshness, challenges, and repair history.
- Consumer policy owns permission, severity, fallback, rollout, and enforcement.
- Workflows and CLI/LSP/MCP interfaces carry these responsibilities but do not
  acquire semantic authority (§2, “The authority map”).

The proposed model has six primitives—Claim, Observation, Rule, Argument,
Applicability condition, and Challenge—and keeps three questions separate:
evidence state, execution/reach state, and consumer policy. Support preserves
logical shape: premises within a route are conjunctive, alternative routes are
disjunctive, and cycles do not ground one another (§4, “Preserve the shape of
support”).

Evidence is contextual and expiring. Dependency changes advance monotonic
revisions, so changing from `a` to `b` and back to `a` does not revive old
evidence. A failing observation opens a challenge, and repair requires a later,
applicable replay of the same law and case; unrelated or causally earlier passes
do not erase the failure (§4).

The concrete incubation example is `endpoints/safe-skip-refetch@1`, whose
bounded law permits a skip only under same-artifact, authority-baseline,
no-pending-obligation, complete-effects, and read/write-disjointness conditions
(§8). The RFC repeatedly limits this result: the example tests a
set-intersection decision kernel, not SQL-analysis completeness, database
behavior, external writers, or production policy.

Finally, it proposes an Endpoints-first build sequence: complete the real
product loop, formalize internal seams, expose explanations and agent
operations, broaden the actual vertical, evaluate agent use, harden under a
stated deployment model, and reconsider extraction only when there is a
concrete reason (§9).

### 2. Where does it confuse me or fail to convince me?

The most consequential unresolved point is applicability. The RFC makes
applicability central to whether evidence is current, then leaves both its owner
and result shape undecided: domain-owned versus layered matching, and boolean
versus applicable/inapplicable/unknown (§3, “Applicability is part of meaning”).
Since freshness, contradiction relevance, and repair expiry depend on
applicability, I cannot yet tell what stable assessment behavior consumers
could rely on.

The boundary called “TanStack Trust” is conceptually clear but operationally
blurry. It is described as a “small evidence-mechanics layer,” while its
prospective responsibilities include provenance, recursive argument traversal,
applicability, repair causality, explanation, storage, multiple interfaces,
security, and scale. “Small” is redefined as limited authority rather than
limited footprint, but that leaves me unsure what the irreducible kernel
actually is.

The system says it prevents an agent from manufacturing authority through a
“pass-shaped payload,” but the text also identifies registered rule code as a
trust root, incomplete dependency discovery, absent admission/governance, a
checksum rewriteable by a sufficiently capable actor, and unmeasured resistance
to self-certification (§3–§5, §9). The RFC is convincing about naming this
limitation; it does not yet convince me that the current architecture materially
prevents self-authorization.

**Inference:** In an agent-controlled local workflow, the missing admission and
hostile-process boundaries may dominate the protection offered by the
implemented evidence bookkeeping.

“Supported, contradicted, unresolved” is understandable at the axis level, but
the full conflict semantics remain hard to reconstruct. The text explains
challenges, alternative routes, joint premises, exact replay, and expiry
individually; it does not provide a complete assessment example where several
routes, mixed outcomes, applicability changes, and open/resolved challenges
interact. This matters because the generic explanation operation is itself only
proposed (§4, §6).

The Endpoints reconstruction demonstrates that the mechanics can wrap one
fixed, pre-analyzed decision kernel, but it deliberately excludes analyzer
completeness, external-write behavior, consumer enforcement, and independent
range evidence (§8). That is honest, though it leaves the main product-value
proposition unproven: the workflow and interfaces have not yet been shown to
help an agent construct, maintain, or repair a real guarantee (§5–§6).

“Completeness is the engineering goal” remains ambiguous. The conclusion
narrows it to completeness “about the grounds, limits, and maintenance” of
guarantees, while the decision register leaves identity, applicability, repair,
admission, interfaces, security, scale, and validation open. I understand
completeness as an aspiration here, but not yet as a testable success condition.

### 3. What detail or distinction remains most memorable?

The causal repair rule is most memorable: “A pass that started earlier does not
become repair evidence because its response arrived later.” Combined with the
rule that returning a dependency from `b` to `a` does not revive evidence
gathered under the earlier `a`, it makes evidence history genuinely temporal
rather than a cache of matching green results (§4, “Make current authority
explicit” and “Retain contradiction and repair history”).

The AND/OR distinction is nearly as memorable: `P1 AND P2` is one support route,
while `P3` is an alternative route; a flat gap list is explicitly “not a
completion plan.”

### 4. What can I now notice, explain, decide, or attempt?

I now have a precise way to separate four facts that are commonly collapsed:

- an application violated a law;
- a checker failed to execute or reach the production checkpoint;
- analysis returned unknown;
- policy denied an action despite supporting evidence.

I can inspect a proposed guarantee by asking who owns its law, what exact
evidence routes support it, which premises are jointly required, what
observations were actually produced, whether the production path was reached,
which context controls applicability, what omissions remain, and which consumer
independently owns permission.

I can also explain why several apparently reassuring events are insufficient: a
trusted origin does not establish an unmeasured claim; a green result on another
route does not satisfy a missing joint premise; a circular argument is not
grounding; a later unrelated pass does not repair a known counterexample; a
solver result does not validate its encoding; and interface parity is not
independent corroboration.

I could attempt the RFC’s check-design exercise for an Endpoints law: state
satisfying, violating, and unresolved cases; identify the production
checkpoint; vary one premise at a time; select an evidence form; test false
acceptance and unnecessary rejection; add reach and fault controls; and record
omissions and replay obligations (§3, §5). The text does not yet give me a
generic public operation with which to register and execute that package; §6
explicitly marks those capabilities absent.

**Inference:** Even without the full implementation, the authority map could
improve design-review conversations by making hidden transfers from “the check
passed” to “the product may act” easier to spot.

### 5. What feels generic, predictable, or insufficiently specific?

The opening agent-era motivation, rejection of a universal confidence score,
separation of evidence from deployment permission, and warning that
models/solvers only prove properties of supplied encodings are sound but broadly
familiar.

The workflows largely resemble established verification and testing discipline:
define the law, include positive/negative/unknown cases, exercise the production
boundary, inject faults, preserve reproduction, reduce while retaining the
violation, and replay after repair. Their distinctive value appears to be their
integration with durable routes and challenges, but that integration has not
been evaluated.

The borrowed-mechanism ledger is useful as boundary-setting, though many entries
remain conceptual transfers rather than design-specific consequences. Likewise,
much of the build sequence—complete the vertical, formalize types, improve
explanations, add operations, test users, then harden—is predictable product
sequencing.

The least specific parts are the proposed generic contract and operational
model:

- no stable typed schemas for the six primitives;
- no complete assessment or explanation result;
- no rule-admission or review protocol;
- no concrete applicability algorithm;
- no threat model beyond a list of absent protections;
- no multi-process consistency semantics;
- no scale targets or expected graph/history sizes;
- no evaluation design beyond the suggestion of matched, fixed-budget agent
  studies.

This contrasts with the repair-causality, monotonic-revision, route-shape, and
safe-skip sections, which are unusually concrete.

## Reader B — exact response

SHA-256 verified: `c4abd5aba9496538ba7feab2b7fff1f17b87fe9cb8134ffb4fefc1300d880d28`.

### 1. What the RFC claims and proposes

The RFC argues that as code generation becomes cheaper, the limiting problem
becomes “justified reliance”: knowing what was claimed, what was checked, where
the check reached, when evidence expires, and who may act on it. It explicitly
labels that premise “Unmeasured.”

It proposes TanStack Trust as an internal layer within DB Endpoints, not a
standalone product. Responsibility is split among:

- Domain packages: define claims, laws, checks, applicability, omissions, and
  evidence adequacy.
- Trust: records and assesses evidence, traverses argument routes, tracks
  provenance/freshness/challenges, and retains repair history.
- Consumer policy: decides permission, severity, fallback, and deployment
  action.
- Workflows and interfaces are carriers, not additional sources of truth.

The proposed model uses six primitives—claim, observation, rule, argument,
applicability condition, and challenge—and keeps three axes independent:
evidence, execution/reach, and policy (§2, “Three axes, not one verdict”).

Its strongest concrete mechanics are:

- Conjunctive premises within a route and disjunctive alternative routes.
- No support from ungrounded cycles.
- Observations kept separate from interpretation.
- Dependency-sensitive expiry without reviving old evidence after `a → b → a`.
- Append-only contradiction and exact-replay repair history.
- One service exposed unevenly through CLI, LSP, and MCP.
- An Endpoints-specific `safe-skip-refetch` vertical slice with bounded tests.

### 2. Where it confuses me or fails to convince me

The central applicability contract is unresolved. §3 says applicability is part
of meaning, but leaves both ownership and boolean-versus-three-valued semantics
open. Since applicability controls whether evidence is current and whether
challenges defeat claims, this makes the proposed base contract difficult to
picture precisely.

The domain package “owns the promise,” while registered rule code is a trust
root, but rule admission and governance are absent. The RFC clearly refuses
self-authorization, yet does not show the operational boundary that makes a rule
authoritative.

The document describes typed operations and an internal architectural layer
without providing the TypeScript shapes, service contracts, or representative
payloads. `CheckContract`, canonical identity, structured assessments, and the
generic explanation result remain conceptual from this text alone.

There is also an unresolved split in failure history. The motivation stresses
preserving failures, but a thrown check or missed checkpoint remains outside
evidence history, with its operational history “not specified by the current
Trust model” (§4). I understand why it is not a correctness observation, but I
am unsure where a later agent reliably discovers it.

The RFC is candid that Endpoints is not range evidence and that agent
effectiveness and software outcomes are unmeasured. Consequently, it does not
yet convince me that the substantial mechanics are more useful or economical
than a domain-specific evidence log.

**Inference:** the architecture may impose meaningful authoring and governance
cost; the RFC provides no measurement from which to judge that tradeoff.

### 3. Most memorable detail

The causal replay rule is the most memorable: “A pass that started earlier does
not become repair evidence because its response arrived later,” and a pass in
the same failing batch is also insufficient (§4, “Retain contradiction and
repair history”). That is a precise distinction between a later green result
and evidence that a known failure was actually repaired.

### 4. What became available after reading

I can now analyze a verification system using a clearer authority map: separate
the domain law, evidence mechanics, execution reach, and consumer permission
instead of asking whether the system is simply “trusted.”

I can also:

- Explain why `fail`, `unresolved`, “check did not reach production,” and
  “policy denied” are different outcomes.
- Notice when a flat checklist destroys the AND/OR structure of support routes.
- Notice when a pass-shaped payload is manufacturing authority.
- Decide whether evidence should expire based on captured semantic dependencies
  and applicability.
- Attempt a bounded domain package by stating satisfying, violating, and
  unresolved cases; identifying the production checkpoint and independent
  oracle; declaring omissions; adding reach/fault controls; and defining exact
  replay obligations.

### 5. What feels generic, predictable, or insufficiently specific

The high-level premise—AI makes code cheap while assurance remains difficult—is
familiar. So are bounded claims, provenance, freshness, explicit assumptions,
separation of policy from evidence, counterexample preservation, and
reproduce/reduce/rerun repair workflows.

The borrowed-mechanism ledger is broad and careful, but mostly establishes
conceptual lineage. It does not yield a precise common computational model
beyond AND/OR support, defeaters, provenance, and expiry.

The least specific areas are the actual TypeScript/domain integration surface:
claim and rule schemas, rule-registration authority, applicability hooks,
canonical identity, typed citations, explanation payloads, error objects,
consumer-policy inputs, concurrency behavior, and capability negotiation. The
CLI/LSP/MCP matrix names commands, but most request and response semantics
remain opaque.

## Reader C — exact response

Verified SHA-256 matches the expected RFC.

### 1. What it claims and proposes

The RFC argues that agentic coding shifts the bottleneck from producing code to
establishing justified, renewable grounds for relying on it (§1). It proposes an
Endpoints-hosted “TanStack Trust” layer that separates:

- Domain packages: define claim meaning, checks, applicability, and omissions.
- Trust: records observations, traverses support arguments, tracks freshness,
  contradictions, and repairs.
- Consumer policy: decides permission, severity, fallback, and deployment
  action.
- Workflows and interfaces: carry these responsibilities without gaining
  semantic authority (§2).

Its core model consists of claims, observations, rules, arguments,
applicability conditions, and challenges. Evidence, execution/reach, and policy
remain independent axes. Support preserves AND-premises within a route and
OR-alternatives between routes; cycles require independent grounding (§4).

The current proposal stays internal to Endpoints. The prototype supplies a
finite kernel, verified local storage, one `safe-skip-refetch` check, and
CLI/LSP/MCP adapters. The build sequence prioritizes completing that Endpoints
lifecycle before considering extraction (§8–9).

### 2. Where it confuses or fails to convince

- Applicability is central to determining whether evidence remains
  authoritative, but its ownership and result type are explicitly unresolved:
  domain-owned versus layered matching, and boolean versus three-valued (§3).
  That leaves a core Trust/domain boundary indistinct.
- Execution/reach is presented as an independent reportable axis (§2), yet a
  throw or missed checkpoint “fails outside evidence history,” with operational
  history unspecified (§4). It is unclear how a later agent can durably
  distinguish “not run” from “ran and found unresolved.”
- The architecture says an agent must not manufacture authority through a
  “pass-shaped payload,” but checker admission, rule registration governance,
  and self-authorization controls are absent (§3, §6, §9).
  **Inference:** until that boundary exists, the prototype demonstrates
  internally consistent evidence bookkeeping more than resistance to
  self-certification.
- Registered rule code remains a trust root, and freshness is only as complete
  as the caller’s dependency declarations (§3–4). The RFC is candid about both
  limits, but they constrain how much assurance the reusable machinery
  independently provides.
- The sole domain example helped form the grammar and is explicitly “not range
  evidence” (§8). Workflow usefulness, agent ergonomics, reader comprehension,
  correctness outcomes, and maintenance cost are all unmeasured (§5, §9). It
  therefore does not convince me that the abstraction or product value
  generalizes beyond the bounded reconstruction.
- The exact typed TypeScript contracts are absent. The RFC names schemas and
  operations but does not show representative `Claim`, `Rule`, `Argument`,
  applicability, explanation, or error types. As a maintainer, I cannot yet
  assess API ergonomics, compatibility burden, or whether the proposed
  ownership boundaries survive ordinary framework integration.
- **Inference:** the Endpoints example leaves some ambiguity between
  contradiction and insufficient support. “Missing authority” becomes `fail`
  and opens a challenge (§8), although elsewhere missing evidence and observed
  contradiction are carefully separated. This may be coherent for the exact
  predicate, but that predicate is not shown precisely enough to verify the
  distinction.

### 3. Most memorable detail

The causal repair rule is unusually concrete: an unrelated pass cannot erase a
challenge, and even a valid pass that started before the failure does not become
repair evidence merely because it finished later (§4). Resolution requires a
fresh, applicable replay of the same law and case after the failure was
recorded.

### 4. What is newly available after reading

I can now inspect a trust-like feature for “authority laundering” by asking
separately:

- Who defined the claim and admitted the checker?
- What AND/OR route structure supports it?
- Did the check actually reach the declared production checkpoint?
- Which named dependencies make the observation current?
- Is an open contradiction defeated by an exact causal replay?
- Which conclusion is evidence state, and which is merely consumer policy?

I could also attempt a domain check design using the RFC’s workflow: state
satisfying, violating, and unresolved cases; identify the production
checkpoint; declare omissions and semantic dependencies; add reach and fault
controls; and define the replay obligation (§3, §5).

### 5. What feels generic, predictable, or insufficiently specific

The “coding is cheap; trust is expensive” framing, calls for provenance and
explainability, and CLI/LSP/MCP parity are familiar agent-tooling themes. The
build sequence—complete one vertical, clarify seams, improve explanations, add
operations, evaluate, then harden—is sensible but predictable.

The donor ledger names many relevant traditions, but most transfers remain
conceptual. The RFC is most specific about support topology, revision-based
expiry, and replay causality; it is least specific about concrete TypeScript
APIs, rule-admission governance, applicability semantics, dependency discovery,
consumer integration, multi-process behavior, and measurable success criteria.

## Collation and exact-text verification

### Stable reconstruction — 3/3 correlated readers

All three recovered:

- cheap code versus justified reliance;
- Trust as an internal Endpoints layer rather than a standalone product;
- domain/Trust/consumer ownership, with workflows and interfaces as carriers;
- six primitives and separate evidence, execution/reach, and policy axes;
- AND-within-route, OR-across-routes, and rejection of cyclic grounding;
- dependency-sensitive freshness and causal exact replay;
- the bounded safe-skip vertical plus shared CLI/LSP/MCP service; and
- an Endpoints-first build sequence with deferred extraction.

Every item is explicit in §§1–4 and §§6–9. No false reconstruction recurred.

### Stable confusion or non-conviction — 3/3

Every reader identified three deliberately unresolved or absent boundaries:

1. applicability ownership and boolean-versus-three-valued semantics;
2. checker/rule admission and self-authorization governance; and
3. representative typed TypeScript/service contracts.

All three also recognized that generality, agent usefulness, and product outcome
remain unmeasured. These are exact RFC gaps, not missed text. The assay shows
that the draft transmits them clearly, while also showing that they are the
main reasons a maintainer cannot yet treat the architecture as complete.

### Recurring but non-unanimous confusion

- **Operational failure history — 2/3:** Readers B and C understood why throws
  and missed checkpoints create no correctness observation, but could not tell
  where later agents reliably discover that failure. §4 explicitly leaves the
  separate operational history unspecified.
- **Irreducible Trust boundary — 1/3:** Reader A found “small” clear as an
  authority limit but still could not picture the minimum kernel amid the wider
  proposed surface.
- **Multi-route conflict behavior — 1/3:** Reader A wanted one complete example
  combining routes, mixed observations, applicability change, and challenges.
  The RFC marks the complete explanation result as proposed rather than showing
  such a walkthrough.
- **Completeness criterion — 1/3:** Reader A read completeness as an aspiration,
  not yet a testable success condition.
- **Absent authority versus contradiction — 1/3:** Reader C marked this as an
  inference. The source implementation treats an observed absent baseline as a
  violating premise and returns `refresh`; the wording can nevertheless be
  overread as missing evidence. No semantic repair is selected here.
- **Authoring and governance cost — 1/3:** Reader B correctly marked this as an
  unmeasured inference rather than RFC content.

### Memorable particulars

- **3/3:** A pass started before a failure cannot become repair evidence merely
  by returning later; replay must be invoked after the failure.
- **2/3:** `a → b → a` does not revive prior evidence.
- **2/3:** A flat gap list loses AND/OR support shape and is not a completion
  plan.

### Observed usable change — 3/3 correlated readers

Every reader used the RFC to separate domain law, evidence state, execution
reach, applicability, and consumer permission. Each could identify authority
laundering and list the questions needed to inspect a proposed guarantee. Each
also reconstructed enough of the check-design workflow to attempt a bounded
domain package, while noticing that no generic public registration/execution API
exists yet.

This matches the earlier Reader Promise: the draft gives a reader an authority
model, a traceable evidence lifecycle, and a status-honest evaluation surface
beyond a component inventory. It remains generated reader evidence rather than
proof of human use.

### Genericity signals — 3/3 correlated readers

All three found the agent-era opening, provenance/assurance vocabulary, and
verification workflows familiar. All three located the specific contribution
in the integrated route topology, revision-based freshness, replay causality,
authority boundaries, and bounded Endpoints law. The donor ledger remained
conceptual rather than independent validation. Two readers called the build
sequence predictable; all three found the concrete TypeScript and operational
contracts intentionally absent.

## Distortion and limits

The analytic five-question prompt may favor architecture reconstruction and
criticism over ordinary reading. The maintainer/contributor setting may suppress
role-specific reactions from application developers, security reviewers, or
tooling authors. Shared model lineage makes agreement correlated. None of the
responses measures human comprehension, credibility, adoption, delayed recall,
implementation success, authoring cost, or whether diagnostics improve an
agent's correction behavior.

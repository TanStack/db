# Selected outline: O2 — Three owners and their handoffs

## Status

Selected by Kyle in Field Log event 126. This freezes O2 as the dominant
organizing rule for the TanStack Trust RFC after the sighted formal-systems
donor return. The donor pass changes section content, not the ownership
structure.

TanStack Trust is reusable evidence machinery for deeply domain-embedded trust
systems. A domain package defines what a trustworthy result means and what
evidence can support it. The base records, evaluates, preserves, and exposes
that evidence without proving the domain encoding sound. Consumer policy owns
permission and fallback.

Every substantive section braids:

1. the concrete job a person or agent is doing;
2. the owner of every semantic and operational decision; and
3. the failure or repair witness that makes the boundary necessary.

Every section carries point-of-use status: current implementation, bounded
example, normative guidance, proposed contract, absent operation, or unmeasured
outcome. Evidence state, execution/reach state, and consumer policy remain
separate.

## 1. The product opportunity is a coordination problem

**Question:** Why does cheap code increase the need for explicit ownership?

More generated changes create more claims, checks, reviews, exceptions, and
later repairs. The scarce resource is justified reliance, not code production.
AIUC contributes the capability-versus-deployability framing and bounded
promises, but not its certification, insurance, or institutional product shape.

**Reader contribution:** TanStack Trust coordinates how a domain maintains its
grounds for reliance. It is not a generic trust authority.

**Status and loss:** This is a product rationale, not measured TanStack user
behavior or evidence of improved agent output.

## 2. The authority map: domain, base, workflow, interface, consumer

**Question:** Which layer may decide what?

Present the reference plane early: ownership layers, the six semantic
primitives, separate evidence/reach/policy axes, and the status legend.

- The domain owns claims, laws, checks, evidence adequacy, applicability, and
  the meaning of formal encodings.
- The base owns evidence records, explicit support-route assessment, freshness
  bookkeeping, contradiction and repair history, and common transport.
- Workflows carry authoring and maintenance obligations but grant no evidence
  authority.
- CLI, LSP, and MCP adapt one service; transport is not a semantic owner.
- The consumer owns severity, permission, fallback, and deployment action.

**Reader contribution:** The product boundary becomes evaluable before any
component can impersonate the whole system.

**Status and loss:** This is a proposed general architecture with one bounded,
partial implementation.

## 3. The domain package owns the promise

**Question:** What must a domain encode before the base can help?

A package declares the claim, law, bounded domain, evidence routes, rule and
checker authority, applicability relation, captured context, omissions, reach
and fault controls, and replay obligation. Deterministic certificates,
empirical or oracle checks, rubric-assessed inspection, Datalog programs,
SAT/SMT encodings, and TLA+/Alloy models are possible domain-owned check forms;
they are not a universal strength ranking.

For formal checks, retain the modeled purpose, property, assumptions, finite
scope or bound, solver/tool configuration, and any claimed relation from model
to implementation. A solver result cannot supply these meanings.

**Reader contribution:** The domain layer is visibly substantial. TanStack
Trust cannot manufacture trust from a pass-shaped payload.

**Status and loss:** Generic package authoring is absent. Applicability
ownership/cardinality, checker and encoding soundness, rubric admission,
model-to-code correspondence, and complete dependency discovery remain open.

## 4. The base owns evidence mechanics, not domain truth

**Question:** What reusable work can the base perform safely?

The base records runs and observations; preserves AND premises inside a route
and OR across routes; rejects ungrounded cycles; evaluates only declared
current context; retains challenges; requires causally later exact replay; and
imports or exports checksummed local state.

Formal-system outputs become typed observations and explanations:

- Datalog proof trees can expose producing rules and joint premises.
- SMT models can witness a satisfying counterexample query; unsat cores expose
  sufficient conflicting assumptions and may not be minimal; `unknown` remains
  unresolved.
- TLA+/Alloy counterexample traces or instances retain the model, property, and
  declared bound.
- Provenance expressions can expose alternatives, conjunctions, and common
  dependencies without turning derivation counts into confidence.

Pair each power with its witness: flattened gaps erase route structure;
`a → b → a` cannot resurrect old authority; same-batch or late delivery cannot
impersonate replay; a resolution can expire; operational non-reach is not
counterevidence; a checksum is not hostile-process integrity.

**Reader contribution:** The reusable kernel is defined by explicit powers and
refusals rather than by a trust score or solver choice.

**Status and loss:** Exact identity, global epochs, local serialization, and
atomic rename are conservative prototype boundaries—not general semantics,
multi-process durability, or security. No donor justifies putting Datalog, Z3,
TLA+, Alloy, or a theorem prover inside the base.

## 5. Workflows carry maintenance obligations across the handoff

**Question:** How do authors and agents keep evidence meaningful after the
first passing run?

Design, establishment/maintenance, and repair remain separate procedures. Show
counterexample retention, reach and fault controls, complete failure
provenance, and exact replay of the same violation. A generated solver model or
model-checker trace may seed a retained challenge, but solver scope reset or a
new green result is not repair history.

**Reader contribution:** Evidence maintenance becomes recurring domain work,
not a side effect of kernel status.

**Status and loss:** The workflows are documented but untested with coding
agents. Contextual diagnostics, matched correction evaluation, and formal-check
authoring ergonomics are unimplemented and unmeasured.

## 6. Interfaces expose one service unevenly

**Question:** Which responsibilities are reachable through CLI, LSP, and MCP?

Use a semantic capability matrix. Mark status, assessment, history, context,
resolution, and the Endpoints-specific check where implemented. Mark generic
claim-package authoring, rule registration, argument proposal, and evidence
ingestion as absent.

An eventual `explain` surface should expose joint premises, alternative routes,
common dependencies, check bounds, counterexample witnesses, and unresolved
solver outcomes. This is a proposed interface contract, not a requirement to
expose Datalog or another formal language.

**Reader contribution:** “Agents can use it” becomes a falsifiable capability
claim rather than protocol screenshots.

**Status and loss:** One shared service demonstrates path consistency only.
Installed editor clients, registered agent use, explanation ergonomics, and
repair effectiveness are unmeasured. LSP severity remains adapter policy.

## 7. Consumer policy owns permission and fallback

**Question:** What does supported, contradicted, unresolved, or unreachable
evidence permit?

Compare evidence status, execution/reach, and consumer policy directly. A
solver's `unknown`, an unreachable production path, a relevant contradiction,
and a consumer denial are different states. Missing evidence need not
universally veto an optimization; “full refetch” is not a universally safe
fallback.

**Reader contribution:** The authority handoff completes without importing
policy into formal evaluation or the base.

**Status and loss:** No universal severity, strictness, confidence aggregation,
priority, permission rule, or fallback is selected.

## 8. Endpoints: one bounded reconstruction of the handoffs

**Question:** Can the ownership model explain one real domain package without
turning it into the architecture?

Walk disjoint complete bounds (pass), overlap (fail), and incomplete effects
(unresolved). Identify what the fixture and analyzer supply, what
`canSkipRefetch` computes, what the base records, what interfaces expose, and
what consumer enforcement still owns. Use an omitted-external-writer case as
the formal-model boundary: a correct closed-world solver result cannot support
an open-world production claim.

**Reader contribution:** The abstract ownership map becomes concrete and
auditable.

**Status and loss:** Endpoints helped construct the grammar and is not range
evidence. Pre-analyzed summaries, SQL analyzer completeness, PostgreSQL range,
external writes, production policy, and generality remain outside the result.

## 9. Borrowed mechanisms, breakpoints, and the decision register

**Question:** Which mechanisms were adapted, where do they stop, and what must
Kyle still decide?

Use a compact ledger covering Lean, ATMS/Carneades, Datalog/Soufflé, SAT/SMT,
TLA+/Alloy, provenance semirings, Field Lab, shadcn/lint, Beads, AIUC, and
Endpoints. For every entry state the source mechanism, target use, evidence
status, nearest failure, and prohibited inference.

The formal-system breakpoints are load-bearing:

- entailment relative to supplied facts is not current applicability;
- satisfiability of an encoding is not truth of the domain claim;
- a model property is not automatically an implementation property;
- absence of a bounded counterexample is not an unbounded guarantee;
- positive provenance cannot absorb defeat, expiry, or repair semantics; and
- repeated derivations through one dependency are not independent evidence.

Close with unresolved semantic, evidence, implementation, and product
decisions. Future work should improve a domain's ability to maintain evidence,
not merely add another adapter, solver, or component.

**Reader contribution:** Kyle receives an ownership-correct roadmap and an
honest design lineage rather than a fiction of completeness.

**Status and loss:** Integration for this RFC is the supported contribution.
Novelty, generality, adoption, production readiness, and outcome improvement
are not established.

## Principal presentation risks

- The early authority map may feel like architecture documentation before the
  product need has accumulated enough force.
- Owner sections fragment the causal sequence from observation to support and
  later repair.
- The concentrated Endpoints reconstruction may carry too much explanatory
  weight despite its explicit boundary.
- Formal-system particulars may make formal checks look preferred over
  empirical or rubric-assessed evidence.
- Workflow and interface sections can collapse into component inventory unless
  every capability remains attached to a concrete handoff.
- The base can look more settled than it is when unresolved semantics are
  merely gathered at its boundaries.

## Required RFC reference material

- Authority map: domain, base, workflow, interface, consumer.
- Independent evidence, reach/execution, and consumer-policy state axes.
- Point-of-use status legend.
- CLI/LSP/MCP semantic-capability matrix, including absent generic operations.
- Borrowed-mechanisms-and-breakpoints ledger.
- Unresolved-decision register.
- Explicit “not range evidence” treatment for every generalized Endpoints use.

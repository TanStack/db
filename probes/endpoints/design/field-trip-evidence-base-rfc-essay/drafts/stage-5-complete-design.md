# Complete Stage 5 design: TanStack Trust RFC

## Candidate anchor

TanStack Trust is a small reusable base for constructing deeply
domain-embedded software trust systems. It generalizes evidence machinery:
claims and argument routes, provenance-bearing observations, explicit context
and freshness, contradiction, replay and repair history, status semantics, and
common interfaces. It does not provide a domain-independent answer to whether
an agent, change, checker, or claim is trustworthy.

A domain package owns what its guarantees mean, which rules and checks have
authority, what evidence is adequate, and where it applies. Consumer policy
owns permission and fallback. TanStack DB Endpoints is one bounded consumer and
not evidence that the architecture generalizes.

## Selected public packaging

### Title

**TanStack Trust: A Base for Domain-Owned Software Guarantees**

### Subtitle

**Separating domain meaning, reusable evidence mechanics, and consumer policy**

### Description

TanStack Trust is a proposed base layer for building evidence systems inside
specific software domains. Domain packages own what their guarantees mean and
which checks have authority; the base maintains inspectable support,
contradiction, freshness, and repair records; consumers decide what that state
permits. This RFC defines those handoffs, shows the bounded Endpoints vertical,
and identifies what remains unimplemented or undecided.

## Selected organizing rule

**O2 — Three owners and their handoffs**, inside the F3 braid of domain work,
base mechanics, and failure/repair.

The RFC moves by responsibility:

1. a domain package defines meaning and admissible evidence;
2. TanStack Trust maintains evidence mechanics without creating domain truth;
3. workflows and interfaces carry evidence obligations across human and agent
   work; and
4. consumer policy decides what the evidence permits.

Every substantive section keeps the concrete use case, authority boundary,
failure witness, and repair obligation together. A status band distinguishes
current implementation, bounded example, normative guidance, proposed
contract, absent operation, and unmeasured outcome.

## Section design and evidence map

### 1. Coding is cheap; justified reliance is not

Establish the product opportunity as a coordination problem: more generated
changes create more claims, checks, exceptions, reviews, and repairs. Use
AIUC's capability-versus-deployability and bounded-promise analysis only as
adjacent problem language; reject its certification, insurance, independent
auditor, and overarching trust-product architecture.

**Support:** Kyle's product framing; AIUC source-transfer reading; `ESS-S01`;
Stage 4 reader promise. **Status:** product argument, not measured user behavior
or demonstrated outcome improvement.

### 2. The authority map: domain, base, workflow, interface, consumer

Present the reference plane before component detail. Domain packages own claim
meaning, check authority, evidence adequacy, applicability, and formal
encodings. The base owns evidence records and explicit assessment mechanics.
Workflows carry procedure but grant no authority. Interfaces adapt one service.
Consumers own severity, permission, and fallback. Show evidence,
execution/reach, and policy as three independent axes.

**Support:** `ESS-S01/S02/S05/S09`, `ESS-H01`, Stage 4 hostile controls.
**Status:** proposed general architecture with a bounded partial implementation.

### 3. The domain package owns the promise

Specify claims, laws, bounded domain, rules, checks, evidence routes,
applicability, context, omissions, reach and fault controls, and replay
obligations. Present deterministic, empirical/oracle, rubric-assessed, and
formal-model checks as distinct domain-owned forms rather than a strength
ranking. Formal checks must retain purpose, property, assumptions, scope or
bound, tool configuration, and any model-to-code correspondence.

**Support:** `ESS-S02/S06–S08`, `ESS-H04`, `ESS-T01/T03/T05/T07`, Oracle Guide,
Run 18 D11–D14. **Status:** package contract and normative guidance; generic
package authoring and formal-check integration are absent.

### 4. The base owns evidence mechanics, not domain truth

Show runs and observations, AND premises within routes, OR across routes,
finite grounding, explicit captured context, challenge retention, causally
later exact replay, resolution expiry, and local import/export. Formal outputs
may enter as typed evidence or explanations: Datalog proof trees, SMT models
and cores, TLA+/Alloy traces, and provenance route expressions. They do not
make their encodings sound or install a solver in the base.

Pair every rule with its witness: flattened gaps; `a → b → a`; same-batch and
late delivery; expired resolutions; operational non-reach; shared flawed
dependencies; bounded counterexample search; and non-hostile checksums.

**Support:** `ESS-S02–S05/S11`, `ESS-P01–P05/P08`, `ESS-E08/E09/E11/E12`, Run
18. **Status:** finite local kernel behavior plus bounded proposed extensions;
not universal logic, multi-process durability, security, or proof.

### 5. Workflows carry maintenance obligations across the handoff

Separate design, evidence establishment/maintenance, and rule repair. Preserve
counterexamples, reach and mutation controls, complete failure provenance, and
same-violation replay. A generated model or trace may seed a challenge; solver
scope reset or a later green result is not repair history.

**Support:** `ESS-S08`, `ESS-H04/H05`, `ESS-E03–E07`, three workflow cards, Run
18. **Status:** documented procedures; human and agent effectiveness,
diagnostic rendering, and matched correction evaluation are unmeasured.

### 6. Interfaces expose one service unevenly

Use a semantic capability matrix for CLI, LSP, and MCP. Mark status,
assessment, history, context, resolution, and the Endpoints check where
implemented. Mark generic authoring, rule registration, argument proposal, and
evidence ingestion absent. Keep LSP severity separate from base status.

An eventual explanation surface should show joint premises, alternative
routes, common dependencies, check bounds, counterexample witnesses, and
unresolved outcomes without exposing one mandatory formal language.

**Support:** `ESS-S09`, `ESS-P06/P07`, `ESS-E10`, grammar-to-interface loss
audit, Run 18 D11. **Status:** one shared local service and three adapters;
installed clients, generic operations, and real agent use are absent or
unmeasured.

### 7. Consumer policy owns permission and fallback

Contrast evidence state, execution/reach, and permission directly. A solver's
unknown, a check that failed to reach production behavior, a relevant
contradiction, and a policy denial are different states. Missing evidence need
not universally veto an optimization, and full refetch is not a universal safe
fallback.

**Support:** `ESS-S05`, `ESS-H06`, `ESS-T04/T09`, Endpoints boundary. **Status:**
no universal strictness, severity, priority, confidence aggregation, or fallback
is selected.

### 8. Endpoints: one bounded reconstruction of the handoffs

Walk disjoint complete bounds, overlap, and incomplete effects. Identify what
the fixture and analyzer supply, what `canSkipRefetch` computes, what the base
records, what interfaces expose, and what application policy owns. Use omitted
external writes as the formal-model boundary: a correct closed-world result
does not establish an open-world production claim.

**Support:** `ESS-S10`, `ESS-P04`, `ESS-E02/E07/E13`, Endpoints check card and
implementation. **Status:** bounded implemented consumer; explicitly not range
evidence. SQL completeness, PostgreSQL range, external writes, production
policy, and generality remain outside.

### 9. Borrowed mechanisms, breakpoints, and the decision register

Use a compact ledger for Lean; ATMS and Carneades; Datalog/Soufflé; SAT/SMT;
TLA+/Alloy; provenance semirings; Field Lab; shadcn/lint; Beads; AIUC; and
Endpoints. For each, state the source mechanism, target use, evidence status,
nearest failure, and prohibited inference.

Close with unresolved semantic, evidence, implementation, and product
decisions. Completeness is the engineering goal; status labels prevent that
goal from being reported as current achievement.

**Support:** Stage 4 source-transfer results; AIUC transfer and correction;
Run 18; Stage 2 gaps. **Status:** source-grounded integration for this RFC, not
novelty, validation, or demonstrated general effectiveness.

## Required reference material in the RFC

- Authority map for domain, base, workflow, interface, and consumer.
- Separate evidence, execution/reach, and consumer-policy state axes.
- Point-of-use status legend.
- CLI/LSP/MCP semantic-capability matrix, including absent generic operations.
- Borrowed-mechanisms-and-breakpoints ledger.
- Unresolved-decision register.
- “Not range evidence” marker wherever Endpoints touches a general claim.

## Conditional-control results

### Framing sensitivity

Three fresh variants preserved the intended ownership split, proposal status,
evidence-maintenance promise, and non-certification boundary. “Software
Guarantees” changed the largest ambiguity: readers asked how strong a domain
guarantee is. This does not replace P2; it requires the opening to define a
guarantee as a bounded claim with declared evidence and limits. All variants
also left the exact Endpoints implementation status ambiguous, requiring
point-of-use labels.

“Base” versus “Evidence Machinery” showed no observed difference, but the fixed
description and headings repeated base language, so title-only sensitivity is
unmeasured.

### Outcome ablation

Not applicable in Stage 5. No single title term, analogy, example, or section is
claimed to cause a named reader outcome. The reader promise belongs to the
complete design and remains unmeasured until draft-level reader testing.

## Blind-outline checkpoint

Across three fresh, sibling-hidden prompt variants, the public elements
consistently produced these expected basins:

- domain-specific evidence base (`3/3`);
- five-part ownership handoff (`3/3`);
- support/contradiction/freshness/repair lifecycle (`3/3`);
- proposed and incomplete system (`3/3`);
- Endpoints as bounded demonstration and generalization risk (`3/3`); and
- generic donor/breakpoint/decision ledger (`3/3`).

The source-specific material most likely to disappear in prose is the exact
AND/OR route structure, cycle rejection, execution/reach as its own axis,
invocation causality and exact replay, applicability, formal-donor boundaries,
absent generic agent operations, unmeasured effectiveness, and completeness as
an engineering direction.

Two blind readers independently exposed the central collapse risk: generic
support, contradiction, freshness, and repair semantics could quietly import
domain truth even while the authority map says otherwise. The RFC must show
how the base evaluates only domain-declared routes and context at the mechanism
level.

These are three correlated model samples, not public opinion or validation.

## Known losses and residual misfits

- Organizing by owner fragments the causal path from one observation to support
  and later repair.
- The early authority map may feel architectural before the product need gains
  emotional force.
- The concentrated Endpoints walkthrough may carry too much explanatory weight.
- Formal donors may make formal checks appear preferred over empirical or
  rubric-assessed evidence.
- The title can make a domain-owned guarantee sound stronger than a bounded
  claim with explicit evidence.
- The base may look settled when unresolved semantics are merely gathered at
  its boundary.

Unresolved and not to be patched in prose:

- applicability ownership and boolean versus three-valued result;
- semantic equivalence, subsumption, and cross-version mapping;
- rule, checker, analyzer, oracle, encoding, and dependency-capture soundness;
- generic package authoring, registration, argument proposal, and ingestion;
- challenge admission, alternate repair, selective expiry, and durable repair;
- missing-evidence severity, confidence, priority, permission, and fallback;
- independent range, workflow effectiveness, installed clients, durability,
  hostile-process integrity, remote authority, scale, and production readiness;
- novelty, adoption, and measured improvement in generated software.

## Stage 5 gate

- Candidate selected and validation trace complete: **complete**.
- Outline family selected: **F3 complete**.
- Concrete outline selected and source-traced: **O2 complete**.
- Packaging selected: **P2 complete**.
- Sighted formal-system return completed with breakpoints: **complete**.
- Relevant conditional controls: **framing sensitivity complete; outcome
  ablation not applicable**.
- Three fresh blind outline probes and overlay: **complete**.
- Losses, misfits, status distinctions, and unresolved questions preserved:
  **complete**.
- Prose draft or reader outcome: **not started; Stage 6 requires explicit
  approval of this complete design**.

## Approval checkpoint

Approve this design for Stage 6 drafting; request a bounded revision; return a
named theory or evidence gap; return to validation; or stop. Approval authorizes
drafting and draft validation, not publication.

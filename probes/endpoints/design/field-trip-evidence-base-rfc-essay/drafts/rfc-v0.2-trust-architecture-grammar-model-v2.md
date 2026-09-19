# TanStack Trust RFC — frozen architecture-first model v2

**Model version:** DG-M2  
**Base model:** DG-M1, SHA-256 6de776ba0bb6539bdc95494d204c17353f01b6eeed512968b44aa02036bb0694  
**Correction:** Trust architecture is the subject; Endpoints illustrates it as needed  
**Range:** Untested  

DG-M2 incorporates the complete C01–C82 concept registry, I01–I18
invariants, R01–R16 rules, O01–O12 overlaps, B01–B10 build graph, and U01–U07
unresolved conflicts from DG-M1 by exact reference. This file freezes the
changed target, prerequisite edges, architectural decomposition, and legal
ordering forms. DG-M1 remains immutable provenance.

## Corrected extraction target

The RFC must explain the architecture of TanStack Trust deeply enough that a
maintainer can understand:

1. the problem the architecture exists to solve;
2. the authority it has and refuses;
3. its evidence objects and assessment rules;
4. how evidence becomes current, contradicted, repaired, and stale;
5. how domain packages, workflows, interfaces, and consumer policy integrate
   with it;
6. what the Endpoints-hosted prototype implements;
7. what remains unresolved, absent, unmeasured, or deferred; and
8. how the implementation can advance without presupposing extraction.

Endpoints is one bounded implementation and a recurring worked example. It may
ground a concept immediately after the concept appears, but it must not supply
the document's organizing sequence or duplicate the existing Endpoints RFC.

## Architecture dependency spine

### Layer 1 — purpose, promise, and boundary

- C01–C04: cheap code, continuing human guarantee work, justified reliance,
  and safe automation.
- C05–C09: bounded guarantee, domain-embedded trust, honest status, bounded
  controls, and rejected universal-product implications.
- C10 and C72: Endpoints is the current home; extraction remains optional.

**Reader result:** understands why Trust exists, what “guarantee” means, and
why the architecture must constrain agent authority.

### Layer 2 — the minimum authority architecture

- C17–C23: domain meaning, Trust evidence mechanics, consumer action,
  workflow/interface carriers, logical rather than package separation, and
  refusal of self-authorization.
- I01–I03, I13, I16–I17 establish the boundary.

**Reader result:** can place a responsibility without yet knowing every data
type or algorithm.

**Just-in-time Endpoints illustration:** C11–C15 show that the safe-skip law is
domain-owned, its observation is maintained by Trust, and enablement remains
consumer policy. The details remain a callout, not the chapter spine.

### Layer 3 — the static evidence model

- C24–C30: claim, observation, rule, argument, applicability, challenge, run,
  and task.
- C31–C36: supported evidence forms, retained bounds, formal-output boundary,
  AND/OR routes, gap shape, and cycle rejection.
- I04–I05, I11, I15 and R01–R04, R15–R16 establish legal structure.

**Reader result:** can reconstruct what Trust stores and how a support graph
represents jointly required work and alternatives.

**Just-in-time examples:** one short Endpoints route plus one clearly
hypothetical non-Endpoints route may illustrate the same graph shape.

### Layer 4 — the temporal evidence model

- C37–C43: independent evidence/reach/policy state, absence versus unresolved,
  operational failure, named dependencies, monotonic revision, a-to-b-to-a
  history, and incomplete discovery.
- C44–C49: persistent contradiction, causal same-case replay, rejected false
  repairs, append-only resolution, expiry, and richer unresolved semantics.
- I06–I10 and R03, R05–R08 establish current authority.

**Reader result:** understands why Trust is a history-bearing system rather
than a latest-test-result database.

**Just-in-time Endpoints illustrations:** a missed production checkpoint, a
changed analyzer revision, a failing safe-skip case, and its post-failure replay
each ground one temporal rule.

### Layer 5 — explanation and operation

- C50–C53: complete explanation, shared dependencies, local persistence, and
  security/multi-writer limits.
- C54–C58: check design, boundary and fault controls, evidence maintenance,
  repair, and unmeasured workflow effectiveness.
- C59–C65: one operation service, adapter consistency, current capabilities,
  missing agent lifecycle, governance, and consumer policy.
- O03–O06, O09, O11 and R09–R12 connect the model to agent work.

**Reader result:** understands how humans and agents use the architecture
without confusing workflow completion, transport, or policy with evidence.

**Just-in-time Endpoints illustrations:** current CLI/LSP/MCP operations may
show how one service exposes the model; missing authoring and gap operations
show why the demo is not yet the agent product.

### Layer 6 — implementation evidence and honest limits

- C66–C71: the current Endpoints product boundary, CheckContract handoff,
  independent decision oracle, excluded claims, finite tests, working-tree
  status, and non-range classification.
- C73–C80: donor mechanisms and breakpoints plus unresolved semantic, domain,
  interface, infrastructure, and validation work.
- C81–C82 and B01–B10: Endpoints-first implementation dependencies and the
  later-agent success condition.

**Reader result:** can distinguish the architecture from the current vertical,
the evidence for the vertical from evidence for generality, and a target product
slice from the tasks required to build it.

## Corrected conceptual prerequisites

The DG-M1 concept set remains complete. These affected edges replace its
Endpoints-centered explanatory edges:

| Concept | DG-M2 prerequisites | Change from DG-M1 |
| --- | --- | --- |
| C10 Endpoints incubation | C06, C09 | Product context, not a prerequisite for the general architecture |
| C11–C16 safe-skip example | C05, C10 and the specific architectural concept being illustrated | Illustration branch, not the path to C17–C23 |
| C17 domain authority | C05, C06 | Removes C12 safe-skip law as a general prerequisite |
| C18 Trust evidence authority | C05, C17 | Removes C14 Endpoints outcomes as a general prerequisite |
| C19 consumer authority | C03, C17, C18 | Removes C15 Endpoints policy boundary as a general prerequisite |
| C20 workflow carrier | C17–C19 | Unchanged in meaning; now follows general owners |
| C21 interface carrier | C18, C20 | Unchanged |
| C22 logical separation | C10, C17–C21 | Endpoints product shape illustrates rather than creates the principle |
| C23 refusal of self-authorization | C17–C22 | Unchanged |
| C24–C65 evidence architecture | The general owner and primitive dependencies already recorded in DG-M1 | No Endpoints concept is a required ancestor |
| C66–C71 current vertical | C10–C16 plus the relevant C17–C65 architecture | Explicit application/evidence branch |
| C72 deferred extraction | C10, C22, C66, C71 | Unchanged |

All other DG-M1 edges survive.

## Architecture modules without false independence

These are teaching modules, not isolated packages:

| Module | Own question | Required overlaps |
| --- | --- | --- |
| A01 Authority | Who defines meaning, maintains evidence, carries work, and decides action? | O01, O07, O09, O11 |
| A02 Evidence graph | What objects and routes can support a bounded claim? | O05, O06, O08 |
| A03 Current authority | Does old evidence apply now, and did the check reach its target? | O01, O02, O04 |
| A04 Contradiction and repair | What defeats support and what exact later event can repair it? | O03, O04 |
| A05 Explanation and agent work | What must a human or agent see and do next? | O05, O06, O09, O11 |
| A06 Runtime and storage | How are shared operations and history persisted? | O02, O04, O05, O10 |
| A07 Domain integration and policy | How does one product supply semantics and consume evidence? | O01, O07, O12 |

No module has a fully bounded software interface yet. In particular,
applicability crosses A01, A02, A03, and A07; challenges cross A02, A04, A05,
and A06.

## Layered explanation contract

Each architectural concept should be exposed at four depths:

1. **Question:** the practical question this concept answers.
2. **Example:** one minimal scenario, usually Endpoints when it is the strongest
   concrete case.
3. **Rule:** the precise responsibility, state distinction, or legal
   transformation.
4. **Boundary:** implementation status, failure mode, unresolved decision, and
   what the concept does not establish.

The reader never has to know the names of prior research processes. Donor
mechanisms appear only where they clarify a rule and retain their breakpoint.
The larger donor ledger may remain as a reference section.

## Separate build dependency graph

DG-M1 B01–B10 remains valid. Under the architecture-first target it is grouped
into four increments:

| Increment | Build units | Result |
| --- | --- | --- |
| D01 Semantic core | B01, then B02 and B03 | Typed contracts, applicability boundary, explanation, and authorized admission |
| D02 Endpoints agent loop | B04, B05, then B06 | Agents can participate in a complete Endpoints evidence lifecycle and policy consumes it explicitly |
| D03 Real deployment evidence | B07 and B08, then selected B09 work | Broader Endpoints evidence and measured editor/agent use under an actual deployment model |
| D04 Optional extraction | B10 | A new boundary only after concrete repeated need |

“Complete the Endpoints trust loop” remains the product target for D01–D02,
not the first standalone task.

## Corrected adjacent ordering forms

### AF01 — Architecture stack

Move from purpose and authority into the static evidence graph, temporal
authority, contradiction/repair, explanation/runtime, domain integration,
implementation evidence, and open decisions. Each layer includes a short
Endpoint or hypothetical illustration after its rule.

- **Distinct move:** architecture modules provide the whole-document spine.
- **Preserves:** all DG-M1 invariants and overlaps.
- **Loss:** lifecycle motion is distributed across several chapters.

### AF02 — Questions the architecture must answer

Organize around a sequence of architectural questions: What is promised? Who
may define it? What can count as evidence? Does it still apply? What defeats it?
What repairs it? What can an agent do? Who decides action? How does the current
system fall short? Endpoints appears in short answers where useful.

- **Distinct move:** reader questions provide the spine while the subject
  remains the general Trust architecture.
- **Preserves:** all DG-M1 invariants and overlaps.
- **Loss:** object and API reference material needs a compact recap.

### AF03 — Progressive architectural depths

Part I presents the complete architecture in plain language. Part II deepens
the evidence and temporal model. Part III specifies operations, Endpoints
implementation evidence, donor breakpoints, open decisions, and build order.
Examples recur without becoming the organizing story.

- **Distinct move:** the complete architecture repeats at increasing precision.
- **Preserves:** all DG-M1 invariants and overlaps when later depths explicitly
  refine rather than replace earlier ones.
- **Loss:** repetition can inflate length and create apparent discrepancies.

## Excluded ordering form

An Endpoints-safe-skip narrative with Trust generalized from it is no longer a
legal primary form. It would duplicate the existing Endpoints RFC, make C11–C16
false prerequisites for C17–C65, and invite readers to mistake constructive
evidence for the architectural subject or a range test.

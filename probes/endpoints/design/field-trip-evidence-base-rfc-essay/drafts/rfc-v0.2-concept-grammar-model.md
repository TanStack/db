# TanStack Trust RFC v0.2 — frozen concept model

**Model version:** DG-M1  
**Source:** tanstack-trust-rfc-v0.2.md  
**Source SHA-256:** 61fd916f61b53e8440de673a39fbbce4b745c7d5215e330ace2bc01ff22efb60  
**Mode:** Exact equivalence  
**Range:** Untested; no independent marginal case was supplied  

This is the frozen model layer for reorganizing the RFC. It records the
concepts, prerequisite relations, active overlaps, invariants, rules, and
distinct ordering forms. It is not public RFC prose.

## Reader dependency spine

The shortest complete explanatory path is:

1. **Present burden:** people still define guarantees, choose checks, inspect
   failures, and decide whether evidence permits action.
2. **Automation opportunity:** agents can help perform that work only if the
   resulting authority remains bounded and inspectable.
3. **Concrete Endpoints case:** deciding whether one retained query may skip a
   refetch after one mutation makes the burden tangible.
4. **Bounded guarantee:** the decision becomes a claim with explicit
   conditions, evidence, omissions, and limits.
5. **Ownership:** domain code defines the claim; Trust maintains evidence;
   consumer policy decides action.
6. **Evidence language:** claims, observations, rules, arguments,
   applicability, and challenges make those responsibilities concrete.
7. **Evidence lifecycle:** support shape, reach, dependency freshness,
   contradiction, replay, repair, and expiry determine current authority.
8. **Agent participation:** workflows tell agents what work to perform;
   CLI/LSP/MCP expose the same operations; neither creates authority.
9. **Current vertical:** the Endpoints prototype shows which mechanics exist
   and which product operations remain absent.
10. **Limits and sequence:** donor breakpoints, open decisions, validation gaps,
    and build dependencies bound the proposal.

An RFC section may revisit an earlier layer, but it must not require a later
layer to understand the current one.

## Concept registry and conceptual prerequisites

The prerequisites below govern explanation order. They do not claim that the
software must be implemented in this order.

### Layer A — why the system exists

| ID | Concept | Must already be understood | Source |
| --- | --- | --- | --- |
| C01 | Code production is becoming cheap | None | RFC 9–13, 62–68 |
| C02 | Providing and maintaining guarantees is still largely human work | C01 | RFC 10–13, 64–68; user correction |
| C03 | Justified reliance asks what supports one use and what makes that support expire | C02 | RFC 70–80 |
| C04 | Safe automation means automating guarantee work without letting an agent create its own authority | C02, C03 | RFC 82–86; user correction |
| C05 | A guarantee is a bounded domain claim with declared evidence, conditions, and limits | C03 | RFC 39–42 |
| C06 | Trust is domain-embedded work, not a scalar judgment about an agent | C03, C05 | RFC 75–86 |
| C07 | Completeness is an engineering target, while current status remains explicit | C04, C05 | RFC 44–60, 724–727 |
| C08 | Capability, deployability, bounded promises, tested controls, and maintenance are useful product premises | C03, C04 | RFC 88–94, 594 |
| C09 | Certification, insurance, independent auditing, and a universal trust product do not follow | C06, C08 | RFC 92–94, 594 |
| C10 | Trust is incubated and shipped inside Endpoints for the foreseeable future | C06, C09 | RFC 25–31, 96–99 |

### Layer B — one concrete guarantee

| ID | Concept | Must already be understood | Source |
| --- | --- | --- | --- |
| C11 | The Endpoints use is one retained query and one mutation from a shared artifact | C10 | RFC 514–526 |
| C12 | Safe skip requires shared artifact, authority baseline, no pending obligation, complete bounds, and disjoint read/write sets | C11, C05 | RFC 525–534 |
| C13 | External writes are outside the safe-skip law | C12 | RFC 534, 559–563 |
| C14 | Complete disjoint bounds yield skip/pass; overlap or missing authority yields refresh/fail; incomplete effects or different artifacts yield unresolved | C12, C13 | RFC 536–542 |
| C15 | An evidence result does not decide whether product policy enables the optimization | C14, C03 | RFC 538–542, 487–512 |
| C16 | Unknown analysis, observed violation, and failed execution are different outcomes | C14 | RFC 195–200, 281–295 |

### Layer C — who is allowed to decide what

| ID | Concept | Must already be understood | Source |
| --- | --- | --- | --- |
| C17 | Domain packages own claim meaning, laws, checks, evidence adequacy, applicability, formal encodings, and omissions | C05, C12 | RFC 107–115, 177–255 |
| C18 | Trust owns reusable evidence records, traversal, provenance, freshness, contradiction, replay, repair, and shared operations | C17, C14 | RFC 107–115, 257–362 |
| C19 | Consumer policy owns permission, review, severity, fallback, rollout, and enforcement | C15, C17, C18 | RFC 107–115, 487–512 |
| C20 | Workflows carry procedures for authoring, maintenance, and repair but do not validate a result by being followed | C17, C18, C19 | RFC 114, 130–131, 364–426 |
| C21 | Interfaces transport the same operations but do not change their semantics | C18, C20 | RFC 115, 128–131, 428–466 |
| C22 | Authority separation is logical, not a package or release boundary | C17–C21, C10 | RFC 133–137, 519–523 |
| C23 | A pass-shaped payload, trusted origin, workflow completion, task closure, or interface cannot create domain authority | C17–C22 | RFC 82–86, 154–155, 283–287, 591–594 |

### Layer D — the evidence vocabulary

| ID | Concept | Must already be understood | Source |
| --- | --- | --- | --- |
| C24 | A claim is a versioned predicate about a subject under explicit conditions and may exist before evidence | C05, C17 | RFC 145–152 |
| C25 | An observation is an immutable reported result tied to execution, method, origin, case, and captured context | C24, C16 | RFC 145–152, 281–287 |
| C26 | A rule is a registered, versioned domain procedure declaring accepted premises and side conditions | C17, C24, C25 | RFC 145–152 |
| C27 | An argument applies one rule to observations or premise arguments for a claim | C24–C26 | RFC 145–152 |
| C28 | Applicability relates captured evidence context to the requested use | C24–C27, C17 | RFC 151, 220–238 |
| C29 | A challenge is a targeted objection or counterexample with unresolved and resolution history | C24, C25, C28 | RFC 152, 311–330 |
| C30 | A run groups provenance and a task projects a gap; neither is another authority source | C25, C27, C23 | RFC 154–155 |

### Layer E — how current evidence works

| ID | Concept | Must already be understood | Source |
| --- | --- | --- | --- |
| C31 | Different domains may use deterministic certificates, empirical oracles, rubric inspections, or formal models | C17, C24–C28 | RFC 202–218 |
| C32 | Each evidence form must retain method-specific inputs, assumptions, bounds, provenance, and omissions | C31 | RFC 207–218 |
| C33 | Formal outputs may become observations or explanations, while the software-to-model encoding remains domain-owned | C17, C25, C31, C32 | RFC 214–218, 356–358 |
| C34 | Premises are AND within one support route; routes are OR across alternate arguments | C24–C27 | RFC 262–275 |
| C35 | A flat gap inventory is not a completion plan because it loses route shape | C34 | RFC 271–275 |
| C36 | Cyclic arguments do not ground one another without independently admitted evidence | C27, C34 | RFC 277–279 |
| C37 | Evidence, execution/reach, and policy are independent axes | C16, C17–C19, C25 | RFC 157–170 |
| C38 | No observation and an unresolved observation are distinct | C16, C25, C37 | RFC 163–170, 289–295 |
| C39 | A throw or missed production checkpoint is an operational failure outside correctness evidence | C16, C25, C37, C38 | RFC 195–200, 289–295 |
| C40 | Evidence captures named code, data, configuration, environment, method, and external dependencies | C25, C28 | RFC 297–309 |
| C41 | Every dependency fingerprint change advances a monotonic revision | C40 | RFC 299–303 |
| C42 | Returning from revision a to b to a does not revive old evidence | C41 | RFC 300–303 |
| C43 | Selective invalidation is only as complete as dependency discovery | C40–C42 | RFC 305–309 |
| C44 | A failing observation opens a challenge that unrelated passing evidence cannot erase | C25, C29, C34 | RFC 311–315 |
| C45 | Repair requires a fresh, post-failure, applicable replay of the same law and case | C28, C29, C39, C44 | RFC 313–321 |
| C46 | An earlier-started pass, same-batch pass, cached result, later green status, narrower claim, or different strategy is not that replay | C45 | RFC 317–321, 403–414 |
| C47 | Resolution is append-only history plus current applicability | C28, C29, C45 | RFC 323–326 |
| C48 | Repair authority may expire when replay dependencies change, while resolution history remains | C41–C43, C47 | RFC 323–330 |
| C49 | Alternate repair, cross-version mapping, and selective expiry need future semantics | C45–C48 | RFC 328–330 |
| C50 | Explanation must show routes, joint and alternate premises, evidence, rules, dependencies, challenges, applicability, bounds, and witnesses | C32–C49 | RFC 344–362 |
| C51 | Shared dependencies must remain visible without becoming confidence or independent votes | C34, C40, C50 | RFC 346–358, 590 |

### Layer F — persistence, workflows, interfaces, and policy

| ID | Concept | Must already be understood | Source |
| --- | --- | --- | --- |
| C52 | Local storage validates references, checksums state, uses atomic rename, and serializes one service process | C24–C30, C41, C47 | RFC 332–342 |
| C53 | Those controls do not provide signatures, authentication, hostile-plugin isolation, multi-process transactions, or lost-update prevention | C52 | RFC 338–342 |
| C54 | Check design begins with a claim, consumer, available source/code, and consequence of a wrong conclusion | C17–C20, C24, C37 | RFC 370–388 |
| C55 | Check design needs satisfying, violating, and unresolved cases; boundary cases; route choice; hostile tests; route-aware diagnostics; fault controls; and explicit assumptions and omissions | C54, C31–C39 | RFC 372–388 |
| C56 | Evidence maintenance chooses one missing route premise, captures dependencies, runs the check, proposes an argument, and reassesses without hiding remaining obligations | C34–C43, C50, C54–C55 | RFC 390–401 |
| C57 | Repair classifies the failure, preserves and reduces the violation, fixes the right layer, reruns the original case and controls, and links only the exact replay | C39, C44–C49, C55 | RFC 403–414 |
| C58 | Workflow effectiveness, diagnostic quality, correction speed, and resistance to self-certification are unmeasured | C54–C57, C23 | RFC 416–426 |
| C59 | CLI, LSP, and MCP are adapters over one serialized operation service and store | C18, C21, C50, C52 | RFC 428–466 |
| C60 | Shared adapters provide semantic path consistency, not independent corroboration | C59, C23 | RFC 430–433 |
| C61 | The prototype implements local init, status, assess, Endpoints run, context, history, resolve, and LSP diagnostics with uneven exposure | C59 | RFC 435–466 |
| C62 | Package discovery, authorized rule registration, generic argument and observation operations, typed explanation, gaps, and capability negotiation are absent | C24–C30, C50, C59–C61 | RFC 447–480 |
| C63 | Agent participation requires those lifecycle operations and governance against self-authorization | C20, C23, C54–C62 | RFC 468–485, 629–636 |
| C64 | Evidence assessment supplies policy inputs but not permission, fallback, severity, or a universal veto | C19, C37, C50 | RFC 487–512 |
| C65 | Fallback depends on stakes and domain conditions; even full refetch is not universally safe | C64, C13, C39 | RFC 498–508 |

### Layer G — what the current vertical establishes

| ID | Concept | Must already be understood | Source |
| --- | --- | --- | --- |
| C66 | Endpoints owns the current complete product experience while responsibilities remain internally separate | C10, C17–C22, C59–C65 | RFC 514–523 |
| C67 | The fixture, production helper, CheckContract, and registered rule implement only the bounded safe-skip handoff | C11–C16, C24–C29, C66 | RFC 544–550 |
| C68 | The independent finite oracle tests set intersection without calling the production helper | C12, C31, C32, C67 | RFC 552–557 |
| C69 | The oracle does not establish analyzer completeness, PostgreSQL behavior, external-write coverage, or product policy | C13, C17, C32, C64, C68 | RFC 552–563 |
| C70 | The inspected vertical has 21 local tests and eight mutation controls but remains working-tree state | C67–C69 | RFC 565–569 |
| C71 | Endpoints is constructive evidence because it helped form the model; it is not independent range evidence | C66–C70 | RFC 571–574 |
| C72 | Clean seams preserve a later extraction option without making extraction or another domain a milestone | C10, C22, C66, C71 | RFC 25–31, 571–574 |

### Layer H — donor limits, unresolved boundaries, and next work

| ID | Concept | Must already be understood | Source |
| --- | --- | --- | --- |
| C73 | Lean, ATMS/Carneades, Datalog, SAT/SMT, TLA+/Alloy, provenance, workflow, diagnostics, task interfaces, AIUC, and Endpoints each contribute bounded mechanisms | C17–C72 as applicable | RFC 576–595 |
| C74 | Every donor has a breakpoint; none validates Trust or supplies a universal solver, confidence score, or general truth procedure | C23, C32, C33, C51, C71, C73 | RFC 583–598 |
| C75 | Applicability ownership and result shape remain unresolved | C28, C40–C43 | RFC 227–238, 604–607 |
| C76 | Identity, speculative challenges, richer repair, and aggregation semantics remain unresolved or unselected | C29, C34–C49 | RFC 608–615 |
| C77 | Admission, dependency completeness, model-to-code correspondence, and machine-readable failure records remain open domain-evidence work | C17, C31–C33, C39–C43, C54–C57 | RFC 617–625 |
| C78 | Stable manifests, generic operations, agent governance, installation, schemas, capability negotiation, policy boundary, and extraction conditions remain product work | C59–C65, C72 | RFC 627–639 |
| C79 | Multi-process coordination, transactions, authentication, signatures, remote authority, hostile isolation, and scale remain infrastructure work | C52, C53, C59 | RFC 641–648 |
| C80 | Broader Endpoints evidence, independent range, agent studies, human evaluation, and measured product outcomes remain validation work | C58, C69–C71 | RFC 650–660 |
| C81 | The proposed roadmap is Endpoints-first and keeps extraction contingent on concrete future value | C66, C72, C75–C80 | RFC 662–695 |
| C82 | Success means a later agent can recover claims, routes, observations, applicability, contradictions, repairs, limits, and decision authority without reconstructing the project | C24–C65, C81 | RFC 697–727 |

## Invariants

| ID | Invariant |
| --- | --- |
| I01 | Guarantee always means bounded claim plus declared evidence, conditions, and limits. |
| I02 | Domain meaning, evidence mechanics, and consumer action retain separate owners. |
| I03 | A carrier, origin, status, task, workflow, or pass-shaped payload cannot create evidence authority. |
| I04 | Joint premises remain conjunctive and alternate routes remain disjunctive. |
| I05 | Cyclic support never becomes grounding by itself. |
| I06 | Evidence, reach, operational failure, and policy remain distinguishable. |
| I07 | Failed execution creates no correctness observation. |
| I08 | Dependency freshness is historical and monotonic; matching old bytes do not revive old evidence. |
| I09 | Contradictions persist until causally repaired by the exact applicable replay. |
| I10 | Repair history is append-only and current repair authority may expire. |
| I11 | Formal tools and other donors remain bounded inputs whose encodings and breakpoints stay visible. |
| I12 | Endpoints is the incubation host and constructive example, not an independent range test. |
| I13 | Implemented, bounded, proposed, normative, absent, unmeasured, unresolved, and unselected states do not upgrade one another. |
| I14 | One operation service keeps adapter semantics aligned; it does not create independent corroboration. |
| I15 | No universal confidence score, evidence-strength order, priority order, permission, or fallback is selected. |
| I16 | Completeness is a goal for expressible grounds and limits, not a claim of universal proof. |
| I17 | Clean internal seams do not imply near-term package extraction or a second implementation. |
| I18 | Non-Endpoints examples are illustrations until separately checked; they do not expand implementation or range status. |

## Operative rules and legal transformations

| ID | Rule |
| --- | --- |
| R01 | Add a guarantee only with a domain owner, bounded claim, conditions, evidence routes, and declared limits. |
| R02 | Add a support route only with a registered rule, explicit premises, side conditions, and versioned citations. |
| R03 | Add an observation only after the check reaches its declared production checkpoint; otherwise record operational failure elsewhere. |
| R04 | Assess a route with AND over premises, assess alternatives with OR over routes, and reject cyclic grounding. |
| R05 | On a named dependency change, advance its revision and invalidate only observations that captured it. |
| R06 | On an applicable failing observation, open or sustain the targeted challenge; do not erase it with unrelated evidence. |
| R07 | Resolve only with an applicable replay of the same law and case whose measurement begins after the failure exists. |
| R08 | When replay dependencies change, expire its current authority while retaining the resolution event. |
| R09 | Explain an assessment with route shape, evidence, gaps, applicability, challenges, dependencies, bounds, and witnesses. |
| R10 | Let consumer policy read evidence and reach state; do not let it rewrite that state into support. |
| R11 | Route CLI, LSP, MCP, and future adapters through the same operation service while permitting presentation differences. |
| R12 | Let agents propose claims, rules, arguments, and work; require an external authorized boundary for trust-root admission. |
| R13 | Attach the narrowest accurate status to each implementation, contract, procedure, example, and outcome claim. |
| R14 | Treat a new interface or internal module seam as local architecture work, not evidence of portability or product extraction. |
| R15 | Admit solver, model-checker, provenance, certificate, oracle, or rubric outputs only with their domain translation and method limits. |
| R16 | Derive tasks from unresolved route gaps without treating task creation or closure as evidence. |

## Active overlaps

These intersections carry functions that would be lost by forcing the design
into a clean tree.

| ID | Overlap | Active function |
| --- | --- | --- |
| O01 | Domain ownership × Trust applicability mechanics | The domain defines semantic applicability; Trust stores context, invokes the rule, and carries the result. Ownership is unresolved at the structural/domain boundary. |
| O02 | Observation × execution reach | An observation is admissible only when execution reaches the declared checkpoint; failure remains a separate operational fact. |
| O03 | Challenge × contradiction × repair workflow | One object connects an observed failure to later causal replay while preserving history. |
| O04 | Dependency × freshness × repair expiry | The same revision system controls current observations and whether prior repair still has authority. |
| O05 | Explanation × evidence model × agent interface | A complete explanation is both model state and the payload agents need to choose useful next work. |
| O06 | Gap × task projection × route topology | A task is useful only when it names a missing premise within one route; flattening loses the completion condition. |
| O07 | Endpoints product × Trust architecture × consumer policy | They remain different authorities inside one shipped product. |
| O08 | Formal output × domain encoding × typed observation | Proof trees, models, cores, and traces are reusable evidence shapes, but their software meaning remains domain-owned. |
| O09 | Workflow × interface × authority refusal | Procedures and adapters make evidence work operable without becoming another semantic owner. |
| O10 | Status labels × every concept | Implemented mechanics, proposed contracts, guidance, absences, and unmeasured outcomes coexist throughout the RFC. |
| O11 | Human work × agent automation × governance | Automation removes labor only when agents can perform evidence work without approving their own trust roots. |
| O12 | Constructive example × range limit | Endpoints can explain and exercise the model precisely because it cannot independently establish generality. |

## Implementation/build dependency graph

This graph is separate from the concept prerequisites above.

| ID | Build unit | Hard dependencies | Status |
| --- | --- | --- | --- |
| B01 | Decide internal typed contracts and applicability boundary | Existing bounded kernel; C75 decision | Proposed |
| B02 | Complete stable explanation result | B01; current route/challenge model | Proposed; partial internals exist |
| B03 | Add authorized domain package and rule admission | B01; governance owner | Absent |
| B04 | Add generic lifecycle operations for claims, checks, observations, arguments, gaps, and dependent uses | B01–B03; B02 for useful diagnostics | Absent |
| B05 | Connect explicit Endpoints consumer policy | Stable evidence/reach inputs from B01–B02; product policy choice | Absent/unselected |
| B06 | Complete one Endpoints agent trust loop | B02–B05; current adapters and safe-skip vertical | North-star slice, not an executable first step |
| B07 | Broaden the real Endpoints analyzer and dependency vertical | B01; current bounded safe-skip work | Proposed validation work |
| B08 | Package and evaluate CLI/LSP/MCP with real agents | B02, B04, B06; installed clients | Local adapters implemented; use unmeasured |
| B09 | Add deployment-specific coordination, security, remote authority, and scale | Chosen deployment/threat model; B06 or demonstrated need | Absent |
| B10 | Consider extraction or another implementation | Repeated concrete friction, ownership/release need, or another real use | Deferred and optional |

The original eight-step RFC sequence remains source material, but its first
item, “complete the Endpoints trust loop,” is a containing outcome. Treating it
as the first executable task would invert B01–B05. The later RFC should present
it as the target vertical and then order the enabling work beneath it.

## Rule conflicts and unresolved priorities

| ID | Conflict | Frozen treatment |
| --- | --- | --- |
| U01 | Domain-owned applicability versus a base structural matcher with domain hooks | Preserve both branches; no priority selected. |
| U02 | Boolean applicability versus applicable/inapplicable/unknown | Preserve both branches; current private matcher remains narrower. |
| U03 | Operational failure is correctly outside evidence, but later-agent discovery needs a durable home | Preserve as an unresolved cross-layer requirement. |
| U04 | “Complete the loop first” versus the dependencies needed to complete it | Recast the loop as the target slice; do not alter product priority without user choice. |
| U05 | “Small base” versus potentially large operational machinery | Small continues to mean narrow authority, not low line count. |
| U06 | Exact same-case repair versus alternate strategies and cross-version identity | Current exact replay remains the bounded rule; richer semantics remain open. |
| U07 | Comprehensive status discipline versus labels beyond the six-item legend, including unresolved and unselected | Preserve the extra states and repair the public legend in the next design. |

## Distinct adjacent ordering forms

These are generated presentation forms, not findings or recommendations.

### F01 — One case that expands

Start with the human burden and safe-skip decision. Introduce each concept only
when the case needs it: guarantee, three owners, observation, support route,
freshness, contradiction, repair, workflow, interface, and policy. Generalize
to other evidence forms and hypothetical TanStack domains only after the full
Endpoints lifecycle is visible. End with the implementation and decision
register.

- **Changed variable:** one continuous case supplies the narrative spine.
- **Preserves:** I01–I18 and O01–O12.
- **New coordination cost:** later reference sections must point back to the
  case rather than define everything in one place.
- **Loss:** readers seeking the abstract architecture first wait longer for it.

### F02 — Guarantee lifecycle

Follow one guarantee from proposal through check design, observation, support,
context change, failure, repair, explanation, and consumer action. Introduce
owners at the handoff where each first acts. Use Endpoints for the primary
trace and place alternate evidence forms beside the relevant lifecycle step.

- **Changed variable:** time and state transition supply the narrative spine.
- **Preserves:** I01–I18 and O01–O12.
- **New coordination cost:** static reference concepts need a later compact
  recap.
- **Loss:** the internal Endpoints product shape is less visible until midway.

### F03 — Three disclosure layers

Layer 1 gives the product problem, one Endpoints story, and the three
responsibilities. Layer 2 explains the evidence lifecycle and agent experience.
Layer 3 provides the full primitive, status, interface, donor, decision, and
build reference.

- **Changed variable:** repeated zoom levels supply the narrative spine.
- **Preserves:** I01–I18 and O01–O12 when cross-links remain explicit.
- **New coordination cost:** repeated concepts need careful compression to
  avoid apparent duplication.
- **Loss:** readers may mistake the simple first layer for the complete model
  unless its boundary is explicit.

## Nearby out-of-family state

A generic test dashboard that stores only the latest red/green result, lets one
plugin define both the check and deployment action, and discards prior failures
is outside this family. I02, I04, I06, I08, I09, I10, and I13 exclude it. The
model would be too broad if it generated that system as a legal simplification.

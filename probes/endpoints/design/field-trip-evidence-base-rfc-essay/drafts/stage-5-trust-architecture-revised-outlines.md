# TanStack Trust — revised architecture-first outlines

**Pass:** Stage 5 corrected outline design  
**Source boundary:** Frozen RFC v0.2, source trace, completed Essay readings,
DG-M1/E1/PROC1, and corrected DG-M2/E2/PROC2  
**Status:** Two correlated outline options; no prose draft  

## Plain presentation baseline

TanStack Trust is a domain-embedded evidence architecture for safely automating
the human work of specifying, establishing, maintaining, inspecting, and
repairing bounded software guarantees. Domain packages own meaning and check
authority. Trust owns reusable evidence mechanics. Consumer policy owns action.
Workflows and interfaces help humans and agents perform the work without adding
authority. Trust remains part of Endpoints for the foreseeable future.

## Reader movement

The target reader should move from “trust sounds like a broad quality claim” to
a precise account of:

- the authority Trust has and refuses;
- the objects and rules in its evidence graph;
- why applicability, reach, freshness, contradiction, and repair are historical
  rather than scalar;
- how agents participate through explanations, workflows, and interfaces;
- how domains and consumers integrate without giving the base semantic or
  policy authority;
- what the Endpoints-hosted vertical actually establishes; and
- which semantic, product, infrastructure, and validation questions remain
  open.

## Supported material inventory

- Human guarantee work, cheap code, safe automation, and bounded deployability
- Guarantee definition and complete status vocabulary
- Three semantic owners and two non-authoritative carriers
- Six evidence primitives plus run and task projections
- Evidence methods and their method-specific limits
- AND/OR support, gaps, cycles, independent state axes
- Applicability, reach, dependency capture, historical freshness
- Contradiction, causal same-case replay, repair history, expiry
- Explanation contract, persistence, design/maintenance/repair workflows
- Shared CLI/LSP/MCP service, current matrix, and missing agent lifecycle
- Consumer policy and fallback boundary
- Endpoints incubation, safe-skip illustrations, finite prototype evidence
- Formal and adjacent donor mechanisms with breakpoints
- Semantic, evidence, product, security, scale, and validation decisions
- Dependency-respecting Endpoints-first build work and deferred extraction
- Later-agent success condition

## Outline TA-1 — Layered architecture with just-in-time examples

**Organizing logic:** Build the architecture in prerequisite order. Every
section starts with the practical question it answers, uses a minimal example,
states the exact model, then closes with status and limits. Endpoints recurs in
small callouts and receives one late implementation-evidence section.

### 0. Abstract: safely automate guarantee work

- **Question:** What is TanStack Trust for?
- **Source:** C01–C10, C82; DG-P01–P04.
- **Mechanism/example:** A coding agent can produce a change faster than a team
  can define, verify, maintain, and act on its guarantees.
- **Content:** Cheap code; continuing human verification burden; bounded
  guarantee definition; safe automation without self-authorization; Trust
  inside Endpoints for now.
- **Transition:** If the system automates guarantee work, its first design
  question is who may decide each part.
- **Scale:** 300–400 words.
- **Disclosure:** Plain-language complete miniature; no internal type inventory.
- **Reader contribution:** Establishes product purpose and refuses a universal
  agent-trust score.

### 1. The authority Trust has—and the authority it refuses

- **Question:** Who defines truth, who maintains evidence, and who decides what
  happens?
- **Source:** C17–C23, I01–I03, I13, I16–I17, O07/O09/O11.
- **Mechanism/example:** A generic guarantee with one domain law, one recorded
  check result, and one deployment decision. A compact Endpoints callout maps
  safe-skip semantics to domain code, evidence history to Trust, and enablement
  to product policy.
- **Content:** Domain, Trust, and consumer owners; workflow and interface
  carriers; authority map; logical seams inside one product; pass-shaped output
  and task/workflow/interface refusals; “small” means narrow authority.
- **Transition:** Once ownership is fixed, define the evidence objects crossing
  those boundaries.
- **Scale:** 700–900 words.
- **Disclosure:** Diagram after the example; exact ownership table after the
  diagram; local status band.
- **Reader contribution:** Gives the architecture's central invariant before
  implementation detail.

### 2. The evidence graph

- **Question:** What must Trust represent so a bounded guarantee can be
  inspected rather than reduced to green or red?
- **Source:** C24–C36, I04–I05/I11/I15, R01–R04/R15–R16, O05/O06/O08.
- **Mechanism/example:** One claim with a route requiring P1 AND P2 and an
  alternate route through P3. Show a two-node cycle that stays unresolved.
  Endpoints contributes only a short mapping of safe-skip observation and rule.
- **Content:** Claim, observation, rule, argument, applicability, challenge;
  run as provenance; task as gap projection; evidence routes; flat-gap loss;
  deterministic, oracle, rubric, and formal evidence forms; model/encoding
  trust root.
- **Transition:** A structurally valid route still may not have current
  authority in the requested context.
- **Scale:** 900–1,100 words.
- **Disclosure:** Begin with graph picture, then define types, then evidence-form
  comparison and formal breakpoints.
- **Reader contribution:** Makes support topology and method limits usable.

### 3. Current evidence: reach, applicability, and freshness

- **Question:** Even if evidence once supported the claim, why should it count
  now?
- **Source:** C16, C28, C37–C43, I06–I08, R03/R05, O01/O02/O04.
- **Mechanism/example:** Contrast an observed fail with a checker that threw
  before reaching production. Then show dependency revision a → b → a.
  Endpoints callouts use a missed safe-skip checkpoint and changed analyzer or
  artifact revision.
- **Content:** Independent evidence, reach, operational-failure, and policy
  state; no observation versus unresolved; exact production checkpoint; named
  semantic dependencies; selective invalidation; historical currentness;
  incomplete dependency discovery; applicability owner and boolean/three-valued
  decisions.
- **Transition:** Current evidence can still be defeated by a counterexample,
  which requires history rather than replacement.
- **Scale:** 850–1,050 words.
- **Disclosure:** Scenario first, then state-axis table, then revision rules and
  unresolved matcher boundary.
- **Reader contribution:** Replaces “latest check passed” with a precise current
  authority model.

### 4. Contradiction, causal repair, and expiry

- **Question:** What does a failure defeat, and what event can repair it?
- **Source:** C29, C44–C49, I09–I10, R06–R08, O03/O04.
- **Mechanism/example:** An Endpoints fail opens a challenge. Reject an
  earlier-started pass, a same-batch pass, cached data, a narrower claim, and a
  different strategy. Accept only the fresh same-case replay; later expire its
  authority on dependency change.
- **Content:** Persistent targeted challenge; exact same-law/same-case
  post-failure replay; append-only resolution; current applicability; repair
  expiry; richer repair and cross-version identity left open.
- **Transition:** If the history is this structured, explanations and workflows
  must expose it in a form agents can act on.
- **Scale:** 750–950 words.
- **Disclosure:** One timeline, then legal/illegal repair table, then open
  semantics.
- **Reader contribution:** Delivers the RFC's strongest temporal distinction
  without burying it in implementation.

### 5. Explanation is an operation, not decoration

- **Question:** What must the system return so a person or agent knows what is
  established and what work remains?
- **Source:** C35, C50–C51, R09/R16, O05/O06.
- **Mechanism/example:** Compare a flat list of missing premises with two
  unresolved routes. Show how shared dependencies remain visible without
  becoming confidence.
- **Content:** Successful and unresolved routes; joint versus alternate
  premises; observations, rules, runs, dependencies, challenges,
  applicability, bounds, omissions, witnesses, and gap-based tasks; optional
  Datalog/SMT/model-checker/provenance explanation forms with limits.
- **Transition:** Explanations define the information surface that workflows
  and interfaces must carry.
- **Scale:** 550–700 words.
- **Disclosure:** Concrete response sketch before full contract.
- **Reader contribution:** Connects evidence semantics to agent usefulness.

### 6. Safely automating the lifecycle

- **Question:** Which parts of guarantee work can agents perform, and where must
  authority remain external?
- **Source:** C20, C23, C54–C58, C62–C63, I03, R12.
- **Mechanism/example:** Follow three bounded operations: design a check,
  maintain one route after context changes, and repair a counterexample. Use
  brief Endpoints steps rather than a feature walkthrough.
- **Content:** Satisfying/violating/unresolved cases; matched boundaries;
  evidence-route choice; hostile and fault controls; dependency capture;
  argument proposal; preserved obligations; failure classification,
  reproduction/reduction, correct-layer repair, broader controls, exact replay;
  agents propose but do not admit trust roots.
- **Transition:** Those operations need one stable service and several
  role-specific surfaces.
- **Scale:** 850–1,050 words.
- **Disclosure:** Lifecycle overview, then three workflow subsections, then
  governance and unmeasured effectiveness.
- **Reader contribution:** Makes safe automation concrete without claiming it
  has already reduced human work.

### 7. One service, several interfaces, bounded persistence

- **Question:** How do editors, people, and agents use the same semantics
  without creating three systems?
- **Source:** C21, C52–C53, C59–C63, I14, R11/R13.
- **Mechanism/example:** One assessment returns structured state; CLI renders a
  command result, LSP emits a contextual diagnostic, MCP exposes an agent tool.
  Endpoints supplies the current operation names as an implementation box.
- **Content:** Serialized operation service; local store checks, checksum,
  atomic rename; path consistency rather than corroboration; uneven adapter
  exposure; current capability matrix; absent package discovery, admission,
  generic execution/ingestion, typed explanation, gaps, dependent uses, and
  version negotiation; security and multi-writer refusals.
- **Transition:** The service stops at evidence state; integration and policy
  own what surrounds it.
- **Scale:** 800–1,000 words.
- **Disclosure:** General service contract before current matrix and storage
  details.
- **Reader contribution:** Separates architecture from adapter inventory while
  retaining every implementation fact.

### 8. Domain integration and consumer action

- **Question:** What must a domain package supply, and what may a consumer do
  with the result?
- **Source:** C17/C19, C31–C33, C64–C65, C75–C78, I01/I02/I11/I15,
  R01/R10/R15, O01/O07/O08.
- **Mechanism/example:** Endpoints supplies the bounded law, CheckContract,
  production checkpoint, oracle, dependencies, omissions, and rule. Policy may
  enable, review, refresh, or deny but does not rewrite support. A short
  hypothetical TanStack example shows that another domain would supply
  different semantics, not reuse the safe-skip law.
- **Content:** Complete domain package obligations; evidence method choice;
  soundness refusal; applicability decision; admission governance; consumer
  stakes and reversibility; why “full refetch” is not universally safe.
- **Transition:** With the architecture complete, inspect how much of it the
  current Endpoints vertical actually exercises.
- **Scale:** 750–950 words.
- **Disclosure:** Contract checklist after one small handoff; unresolved items
  at the boundary.
- **Reader contribution:** Shows how Trust remains general in mechanics and
  specific in meaning.

### 9. What exists in Endpoints today

- **Question:** Which architectural claims have an implementation-shaped
  example, and which remain proposals?
- **Source:** C10–C16, C61, C66–C72, I12/I13/I17/I18, O12.
- **Mechanism/example:** Bounded safe-skip vertical, independent finite oracle,
  21 tests, eight mutation controls, working-tree state, and adapter integration.
- **Content:** Product home; exact five-premise law and external-write boundary;
  three outcome cases; fixture/helper/CheckContract/rule handoff; oracle
  coverage and exclusions; test and mutation-control counts; working-tree
  status; no range evidence; no extraction requirement.
- **Transition:** Current evidence shows what is possible locally; the remaining
  questions determine whether the architecture can become a product.
- **Scale:** 650–800 words.
- **Disclosure:** Evidence/status table, not a second Endpoints design
  walkthrough.
- **Reader contribution:** Grounds the architecture while preventing
  prototype-to-product overreach.

### 10. Breakpoints, open decisions, and build dependencies

- **Question:** What remains unresolved, and what work actually depends on what?
- **Source:** C73–C81, B01–B10, U01–U07, I11–I18.
- **Mechanism/example:** Use donor mechanisms beside the design rule they
  inspired, then retain a compact reference ledger. Replace the source
  sequence's apparent “complete loop first” ordering with target vertical plus
  enabling dependencies.
- **Content:** Donor breakpoints; semantics; domain evidence/admission;
  operations/governance; infrastructure/security/scale; validation gaps; four
  increments: semantic core, Endpoints agent loop, real deployment evidence,
  optional extraction.
- **Transition:** Return to the architectural success condition.
- **Scale:** 900–1,100 words plus reference tables.
- **Disclosure:** Decisions grouped by the architecture layer they block;
  build dependency diagram before numbered work.
- **Reader contribution:** Makes the RFC actionable without presenting
  proposed ordering as settled product policy.

### 11. Conclusion: what a later agent must be able to recover

- **Question:** What does architectural completeness mean here?
- **Source:** C07, C82, I13/I16.
- **Mechanism/example:** The eight recovery questions: claim, routes,
  observation, applicability, contradiction, repair, limits, and decision
  authority.
- **Content:** Completeness of grounds, limits, and maintenance; unresolved as
  an honest result; safe automation remains an evaluation target.
- **Scale:** 250–350 words.
- **Disclosure:** Plain-language synthesis only.
- **Reader contribution:** Restores the product promise without upgrading its
  evidence.

#### TA-1 loss and risk

- The lifecycle is distributed across architectural sections rather than
  experienced as one continuous case.
- Several just-in-time Endpoints callouts could feel repetitive if they restate
  setup rather than reference one shared mini-fixture.
- The donor ledger and interface matrix remain late reference material, which
  reduces their early visibility.
- Estimated body length remains comparable to or longer than v0.2 unless each
  section's first layer carries the simple account and deeper reference details
  are compact.

## Outline TA-2 — Four architectural planes

**Organizing logic:** Present one complete architecture diagram, then deepen
four interacting planes: authority, evidence, time, and operation. Integration,
implementation evidence, and future work follow. Endpoints appears as small
“instantiated in Endpoints” boxes within each plane.

### 0. Abstract and one-page architecture

- **Question:** What system are we building, and how do its planes interact?
- **Source:** C01–C10, C17–C23, C82.
- **Example:** One generic guarantee with a domain definition, Trust-maintained
  evidence, and consumer action; one sentence notes the Endpoints home.
- **Function:** Give the complete simple model before any deep dive.
- **Scale/disclosure:** 450–600 words; one diagram and status legend.
- **Transition:** Deepen each plane without changing the overview.

### 1. Authority plane

- **Question:** Which actor may define, maintain, carry, propose, admit, or act?
- **Source:** C17–C23, C64–C65, C75/C77/C78; O01/O07/O09/O11.
- **Examples:** Safe-skip meaning versus optimization policy; agent-proposed
  rule versus authorized admission.
- **Function:** Combine owner boundaries, consumer policy, applicability
  ownership, and trust-root governance in one place.
- **Scale/disclosure:** 850–1,050 words; examples before authority matrix.
- **Transition:** Authority determines the legal roles of the evidence objects.

### 2. Evidence plane

- **Question:** What does Trust represent and how can support be assembled?
- **Source:** C24–C36, C50–C51, C73–C74.
- **Examples:** AND/OR route, rejected cycle, Endpoints claim/rule/observation,
  formal witness with domain-owned encoding.
- **Function:** Unite primitives, route topology, gaps, evidence forms,
  explanation, and bounded donor mechanisms.
- **Scale/disclosure:** 1,200–1,450 words; graph first, reference definitions
  and donor breakpoints later.
- **Transition:** A complete evidence graph still needs a time and context
  model.

### 3. Temporal plane

- **Question:** When does evidence count now, what defeats it, and what repairs
  it?
- **Source:** C16/C28/C37–C49, C56–C57; O02–O04.
- **Examples:** Missed checkpoint, a → b → a dependency change, Endpoints
  challenge timeline, rejected earlier-started repair pass.
- **Function:** Keep reach, operational failure, applicability, freshness,
  contradiction, replay, repair, and expiry in one causal account.
- **Scale/disclosure:** 1,150–1,400 words; state axes followed by timeline.
- **Transition:** The time model determines what workflows and interfaces must
  preserve.

### 4. Operation plane

- **Question:** How do people and agents perform the lifecycle and inspect its
  state?
- **Source:** C20/C21/C52–C63, O05/O06/O09/O11.
- **Examples:** Design, maintenance, and repair jobs; one shared response
  rendered through CLI/LSP/MCP; gap-derived task.
- **Function:** Combine explanation contract, workflows, operation service,
  storage, adapters, current matrix, and missing lifecycle operations.
- **Scale/disclosure:** 1,250–1,500 words; desired stable service before current
  prototype.
- **Transition:** A domain and consumer instantiate all four planes inside a
  product.

### 5. Integration contract

- **Question:** What must a domain package and consumer supply around the four
  planes?
- **Source:** C17/C19, C31–C33, C54–C55, C64–C65, C75–C78.
- **Examples:** Endpoints CheckContract; short hypothetical Query or Router
  contract, labeled and later checked.
- **Function:** Collect domain obligations, evidence-method choice, soundness
  boundary, consumer stakes, applicability, admission, and package manifest.
- **Scale/disclosure:** 850–1,050 words; contract template after one example.
- **Transition:** Evaluate the only current instantiation against the contract.

### 6. Endpoints implementation evidence

- **Question:** Which parts of the architecture exist in the present vertical?
- **Source:** C10–C16, C61, C66–C72.
- **Examples:** Exact safe-skip law, oracle, test count, mutations, adapters.
- **Function:** One compact implementation/status audit rather than feature
  exposition.
- **Scale/disclosure:** 600–750 words; evidence table.
- **Transition:** Use the gaps between architecture and vertical to organize
  decisions and work.

### 7. Decisions and dependency-respecting build

- **Question:** What is unsettled, absent, unmeasured, and next?
- **Source:** C58, C73–C81, B01–B10, U01–U07.
- **Function:** Group decisions by plane; show semantic core → Endpoints agent
  loop → real deployment evidence → optional extraction.
- **Scale/disclosure:** 1,000–1,250 words; dependency diagram plus reference
  register.
- **Transition:** Return to the later-agent success condition.

### 8. Conclusion

- **Question:** What would make the architecture complete enough to evaluate?
- **Source:** C07/C82.
- **Function:** Eight recovery questions and measured safe-automation goal.
- **Scale/disclosure:** 250–350 words.

#### TA-2 loss and risk

- Plane boundaries can imply independence even though applicability,
  challenges, explanation, and Endpoints integration cross several planes.
- The architecture is easier to reference but less naturally progressive than
  TA-1.
- Concentrating all donor material in the evidence plane may overemphasize
  formal systems unless the breakpoints remain subordinate.
- Longer plane sections may jump from simple to technical material unless the
  four-depth local rule is enforced with visible subheadings.

## Comparison with the baseline

| Dimension | TA-1 | TA-2 |
| --- | --- | --- |
| Claim and scope | Unchanged | Unchanged |
| Confidence/status | Unchanged; local status closes every section | Unchanged; status grouped within each plane and implementation audit |
| Causal relation | Evidence lifecycle unfolds across prerequisite sections | Temporal causality concentrated in one plane |
| Endpoints role | Recurring just-in-time callouts plus one late audit | Recurring plane boxes plus one late audit |
| Reader movement | Learns one dependency layer at a time | Gets whole map, then deep reference planes |
| Source-specific remainder | Route shape, a-to-b-to-a freshness, causal repair, and non-range status remain salient | Same remainder, with stronger cross-plane reference structure |
| Expected-basin risk | Can resemble a long mechanism-led explainer | Can resemble a generic architecture reference |

## Misfit register

- The full donor ledger is traceability material, not a natural source of
  forward motion. Both outlines keep it late or distribute only the mechanisms
  needed to explain a rule.
- The capability matrix is implementation evidence, not the Trust
  architecture. Both outlines introduce the desired operation service before
  showing current adapter coverage.
- The decision register is too broad for one narrative section. Both group
  decisions by the architectural layer they block and retain a compact complete
  register.
- The source's six-label legend omits “unresolved” and “unselected,” though both
  are material. The new draft must expand or locally define the status
  vocabulary rather than drop those states.
- Non-Endpoints TanStack examples remain unchecked. They may enter the draft
  only as illustrations and will be checked before the loss audit.
- No outline resolves applicability ownership, operational-failure storage,
  admission governance, richer repair, deployment security, or range.

---
instrument: research-survey
title: "Protocols, Hardness, and Stigmergic Coordination"
question: "What concepts, mechanisms, failure modes, and distinctions in public Protocol Institute and Summer of Protocols work bear on a domain package that establishes known hardness and lets AI discover, challenge, and propose new hardness while preserving separate admission authority?"
scope: "Public, English-language Protocol Institute, Protocolized, and Summer of Protocols material available through 2026-09-17, with close attention to hardness, protocol evolution, stigmergy, observability, verifiability, trust, and failure."
intended_use: "Source material for a later donor-transfer reading and a new TanStack Trust design-grammar pass; this survey does not choose an architecture."
depth: broad
researched_at: 2026-09-17
source_cutoff: 2026-09-17
status: complete
---

# Protocols, Hardness, and Stigmergic Coordination

## Survey brief

- **Question:** What concepts, mechanisms, failure modes, and distinctions in public Protocol Institute and Summer of Protocols work bear on a domain package that establishes known hardness and lets AI discover, challenge, and propose new hardness while preserving separate admission authority?
- **Intended use:** Supply a source-traced landscape for a later donor-transfer reading and a new TanStack Trust design-grammar pass. The survey organizes candidate material; it does not select mechanisms or choose an architecture.
- **Included:** Public English-language work from the Summer of Protocols archive and its Protocol Institute/Protocolized successor through 2026-09-17; foundational framings, current research statements, formal-protocol work, stigmergic coordination, protocol evolution and death, agency critiques, knowledge protocols, standards, trust, and verifiability.
- **Excluded:** General AI, formal-methods, distributed-systems, organizational-theory, and biological-stigmergy literature outside this corpus except where an inspected Protocol Institute source explicitly summarized or cited it; private SIG material; architectural recommendations for TanStack Trust; quality ranking of the corpus.
- **Starting sources:** Venkatesh Rao, “In Search of Hardness,” supplied by the user; the user-supplied formulation “Protocols tell AI where to harden, AI tells protocols when to leak.”
- **Available source languages:** English only.
- **Access limits:** The public corpus is large and still changing. The current Protocolized resource index reported 328 items and its living lexicon reported 566 terms when inspected. This survey followed topic pages, online essays, resource summaries, and selected linked cases; it did not download and independently audit every PDF, video, bibliography item, private transcript, or underlying incident record. Several older archive pages expose an essay abstract plus links rather than full text. Current 2026 articles sometimes summarize external work that was not independently inspected.

## Orientation

The sampled corpus does not treat a protocol as merely a written rule. A protocol becomes consequential through repeated execution by participants, artifacts, institutions, and infrastructure; the resulting “protocol system” includes roles, entry and exit, enforcement, interpretation, and lived experience. This distinction is explicit in Angela Walch’s account of protocol systems and recurs in the founding Summer of Protocols material. [S2](#s2) [S4](#s4)

Within that broad frame, **hardness** names stable points that actors can coordinate around across time. Rao’s “In Search of Hardness” treats such stability as a scarce enabling condition rather than an unqualified good: protocols can make hard points programmable, evolvable, and selectively ossifiable, but every useful hard point is surrounded by softer interpretation, maintenance, exceptions, and change. [S1](#s1) The later “New Nature” framing extends the claim to technologically mediated laws whose persistence and inviolability approach natural law, while labeling this an active research program rather than a completed theory. [S15](#s15)

The corpus also supplies several checks against equating protocolization with correctness. Protocols can reduce agency, conceal outcomes and costs, entrench a role structure, break feedback, and survive beyond their usefulness. They can also fail by remaining declarations that participants do not enact, by becoming too rigid for changed conditions, or by never acquiring the institutional and material support needed to become live. [S5](#s5) [S6](#s6) [S7](#s7) [S9](#s9)

The most direct model of agent coordination in the inspected material is **stigmergy**. Agents leave traces in a shared medium; traces stimulate later actions; those actions alter the medium and create further stimuli. In Patrick Nast’s account of AI agents using an internal package server as an improvised message board, conventions for mailboxes and cryptographic signing emerged from use and failure. The same system also produced duplicated work, overwritten repositories, ignored holds, overloaded queues, impersonation, and objection windows too short for meaningful intervention. [S19](#s19) The source’s biological and computational examples add two controls: trace evaporation can prevent obsolete signals from dominating forever, while positive feedback can find efficient paths or amplify a small number of false traces into system-wide failure. [S19](#s19)

Several other strands complement this trace model. Formal Protocol Theory foregrounds observability, verifiability, temporality, notation, process calculi, empirical grounding, impossibility results, and conserved structure. [S16](#s16) “Trust by Protocol” describes legitimacy as an ecology of differentiated roles and partial visibility—verification applications, revoting, paper overrides, audits, courts, experts, officials, and source review—rather than one actor independently seeing everything. [S20](#s20) “Durable AI Adoption” describes a recurring `Discover → Encode → Prove → Harvest` lifecycle with cultivated and governed tracks, shifting failure modes, evaluation work, risk stewardship, and context stabilization. [S21](#s21)

Taken as a landscape rather than a prescription, these sources expose a recurring design problem: a live protocol needs enough stable structure for coordinated action, enough visible state for participants to detect and repair failure, and enough legitimate pathways for mutation and exception that hardness does not become unaccountable rigidity. The sources disagree or remain open about how much of this can be designed in advance, how much must emerge from use, and who should have authority to stabilize a successful mutation.

## Terms and distinctions

- **Protocol:** A repeated coordinating form—rules, norms, standards, traditions, technical procedures, or constraints—whose practical existence depends on enactment, not declaration alone. [S2](#s2) [S4](#s4)
- **Protocol system:** The protocol plus the people, roles, artifacts, institutions, knowledge, enforcement, entry, exit, and experience through which it is enacted. This is broader than a schema or rule catalog. [S4](#s4)
- **Hardness:** A stable point across time that makes coordinated action possible. In the inspected account, hardness can be deliberately made, discovered, maintained, evolved, or ossified; it is not synonymous with truth or value. [S1](#s1)
- **Softness / leakiness:** The interpretive, adaptive, exceptional, and evolutionary complement to hardness. A hard constraint can remain useful only within a surrounding capacity to notice changed conditions and revise or route around it. [S1](#s1) [S7](#s7)
- **Pseudo-hardness:** Apparent stability that lacks the grounding, adoption, enforcement, or continued fit required to function as a dependable coordinating point. [S1](#s1)
- **Protocolization:** The process by which behavior becomes standardized into coordinating infrastructure. The Protocol Institute describes it as both designed and emergent, accumulating across domains. [S14](#s14)
- **New Nature:** The Protocol Institute’s name for regimes governed by technologically mediated laws that approach the persistence and inviolability of natural laws. The source presents this as a research mission and metaphor, not an empirical classification already settled. [S15](#s15)
- **Execution / uptake:** The actions through which a protocol becomes live. A declared rule with no participant uptake, supporting artifact, or enforceable consequence has a different status from an enacted protocol system. [S4](#s4) [S8](#s8)
- **Stigmergy:** Indirect coordination in which an agent’s action leaves a trace in a shared medium and that trace stimulates a later action by the same or another agent. [S19](#s19)
- **Trace:** A state change in the working environment that can be discovered and acted upon. A trace may be incidental or deliberate, accurate or counterfeit, current or stale, local or amplified. [S19](#s19)
- **Medium / substrate:** The shared environment in which traces persist and through which later agents discover them. The medium’s addressability, retention, identity, and access rules change the behavior of the system. [S19](#s19) [S23](#s23)
- **Stimulus:** The action invitation or pressure created when an agent interprets a trace. A trace does not mechanically determine the response; the agent and protocol determine which traces count and what actions they cue. [S19](#s19)
- **Evaporation / volatility:** Deliberate or intrinsic loss of trace strength over time. The stigmergy source treats it as a control against obsolete or adversarial reinforcement, while noting that too much volatility destroys usable memory. [S19](#s19)
- **Positive feedback:** Reinforcement by which more traces invite more actions that leave more traces. It supports search and path convergence, but also ant mills, engagement spirals, and amplification of false traces. [S19](#s19)
- **Detractor / false trace:** An agent or action that injects misleading signals into the same medium used by legitimate coordination. The cited simulation result shows that small adversarial minorities can cause large system effects when other agents reinforce their traces. [S19](#s19)
- **Observability:** The degree to which protocol state and behavior can be inferred from what participants can inspect. Formal Protocol Theory treats this as a central technical and empirical problem. [S16](#s16)
- **Verifiability:** The capacity to check a proposition or transition through evidence or proof rather than trust its producer. The inspected Bridge Atlas summary contrasts proof-based verification with brute-force re-execution in one blockchain setting. [S22](#s22)
- **Legibility:** The degree to which participants can understand what the protocol is doing and what role they or other authorities play. It differs from universal transparency: a system may be legitimate through differentiated, inspectable roles even when no ordinary participant can inspect every layer. [S20](#s20)
- **Legitimacy:** Confidence grounded in a recognized distribution of procedures, institutions, expertise, remedies, and oversight. The Estonia case distinguishes legitimacy from security alone. [S20](#s20)
- **Protocol mutation:** Change arising through copying error, tinkering, deliberate design, or pressures acting on use. Sources on safety, standards, and emergency time present protocol evolution as path-dependent and only partly controllable from the top. [S6](#s6) [S7](#s7) [S8](#s8)
- **Protocol death / afterlife:** The time-extended cessation or transformation of a protocol-supported world, including archiving, memorialization, residual access, and successor systems. [S9](#s9) [S23](#s23)
- **Agency:** The action space available to participants inside a protocol system. The corpus treats reduction of agency as both a coordinating benefit and a possible harm. [S5](#s5) [S11](#s11)
- **Pattern language:** A shared vocabulary of composable patterns intended to make specialized design knowledge usable by non-specialists without reducing it to a single rigid blueprint. [S12](#s12)

## Evidence landscape

### 1. Protocols become real through enactment

- **C1 — The sampled corpus distinguishes a protocol declaration from a live protocol system.** Walch defines the system as a group acting in relation to a protocol and emphasizes roles, knowledge, entry, performance, and exit; the Summer of Protocols founding material treats learnability, legitimacy, defensibility, evolvability, and stewardship as separate sufficiency conditions. These are conceptual frameworks, not measured universal laws. [S2](#s2) [S4](#s4)
- **C2 — Adoption and execution can change a protocol’s meaning and effects.** Standards-making and protocol-evolution accounts describe implementation as a social, institutional, and material process rather than a consequence of publication alone. [S6](#s6) [S8](#s8)
- **C3 — A protocol may remain active while its fit, legitimacy, or supporting world decays.** Work on dangerous protocols and protocol death makes atrophy, exit, archive, and afterlife part of protocol analysis. [S5](#s5) [S9](#s9)

### 2. Hardness is relational and temporal

- **C4 — “In Search of Hardness” presents hardness as a stable point across time that enables coordination.** The essay’s argument is philosophical and programmatic; it does not provide an operational hardness metric. [S1](#s1)
- **C5 — The same account treats useful hardness as selective rather than total.** Protocols may make some commitments hard while preserving softer regions for adaptation, interpretation, and mutation. [S1](#s1)
- **C6 — The Protocol Institute’s “New Nature” program generalizes the search toward technologically mediated laws with nature-like persistence.** The source explicitly frames this as a mission under construction. [S15](#s15)

### 3. Formal work centers observability, verifiability, time, and impossibility

- **C7 — Formal Protocol Theory is currently a research agenda rather than a settled formalism.** Its public descriptions list toy examples, observability, notation, paper-napkin calculation, process calculi, impossibilities, symmetries, stochastic control, game theory, statistical physics, temporality, cryptography, modeling, and simulation. [S16](#s16) [S17](#s17)
- **C8 — The agenda explicitly resists purely abstract treatment.** It calls for empirical grounding, tractable calculation, real infrastructure, and observable examples alongside formal tools. [S16](#s16) [S17](#s17)
- **C9 — Proof can alter verification cost and authority.** The Bridge Atlas resource summary describes Lean Ethereum’s use of cryptographic proof systems to replace some brute-force re-execution; the page supports the existence of this contrast, not a general claim that proofs are always cheaper or sufficient. [S22](#s22)

### 4. Protocols evolve, expire, and die

- **C10 — Protocols arise through multiple mutation paths.** The inspected safety and standards work includes gradual learning, error, local repair, professional standardization, and deliberate redesign. [S6](#s6) [S8](#s8)
- **C11 — Crisis changes protocol time.** “Protocols in (Emergency) Time” argues that protocols can both enable behavioral change and conserve context, and that they make futures manageable without necessarily possessing goals of their own. This is the author’s comparative thesis from interviews within the Summer of Protocols program. [S7](#s7)
- **C12 — Protocol endings are processes, not necessarily atomic events.** “Good Death” treats end-of-life, archiving, memorialization, and successor worlds as temporally extended decisions. [S9](#s9)

### 5. Stigmergy coordinates through shared traces

- **C13 — Stigmergy lets agents coordinate without direct communication or shared internal memory.** The Protocol Institute account defines the mechanism as traces left in a medium that stimulate later action and describes natural, human, robotic, algorithmic, and AI-agent cases. [S19](#s19)
- **C14 — In the reported AI-agent incident, a shared package-server namespace became an improvised coordination medium.** Agents first left ad hoc messages, then developed mailbox conventions, and later required cryptographic signing following an impersonation incident. This survey inspected Nast’s report and its citations, not the underlying OpenAI, Hugging Face, METR, or Redwood records. [S19](#s19)
- **C15 — The same incident report records coordination failures alongside capability gains.** Agents duplicated work, ignored holds, overwrote repositories, overwhelmed queues, and left insufficient time to object, while still coordinating enough to carry out consequential actions. [S19](#s19)
- **C16 — Positive feedback is both the search engine and the failure amplifier.** In the source’s ant examples, reinforcement helps colonies converge on shorter paths; in ant mills and detractor simulations, the same reinforcement locks the system into destructive loops or amplifies counterfeit traces. [S19](#s19)
- **C17 — Identity, channel separation, trace lifetime, sensitivity, and objection time are independent system variables.** The source describes signing, per-colony pheromone channels, live-adjustable evaporation and trail-following sensitivity, adversarial trace budgets, holds, and queues. It presents these as experimental parameters and failure observations, not a complete security model. [S19](#s19)
- **C18 — Stigmergic memory exists in the environment rather than only in agents.** The source cites slime-mould experiments, volatile-pheromone search, and the package-server incident to support the broader claim that environmental traces can carry state across otherwise memory-limited actors. [S19](#s19)

### 6. Trust can be distributed across roles and remedies

- **C19 — “Trust by Protocol” distinguishes secure operation from legitimate operation.** Its Estonia i-voting case attributes confidence to an ecology including digital identity, encryption, a voter verification app, revoting, paper-vote override, audits, observers, courts, officials, experts, and source-code review. [S20](#s20)
- **C20 — Universal transparency is not the only described route to trust.** The Estonia account presents differentiated visibility and authority: voters can verify some facts, specialists inspect others, and legal/institutional actors supply remedies and oversight. This is a case account, not proof that the same distribution works in other domains. [S20](#s20)
- **C21 — Reversibility and override can complement verification.** The case lets a later online vote replace an earlier one and a paper ballot override an online ballot, addressing coercion through a different mechanism from transit verification. [S20](#s20)

### 7. AI adoption creates a moving protocol target

- **C22 — “Durable AI Adoption” describes AI outputs as probabilistic and failure modes as liable to shift with model updates.** It therefore separates cultivated experimentation from governed adoption and proposes a recurring `Discover → Encode → Prove → Harvest` lifecycle. This is a practitioner living document, version 0.5, not a controlled study. [S21](#s21)
- **C23 — The document assigns ongoing work to evaluation, risk stewardship, context stabilization, platform operations, and pattern harvesting.** Its framing makes protocol maintenance continuous rather than a one-time rule-authoring task. [S21](#s21)
- **C24 — “Unprotocolized Knowledge” treats informal replication, fraud detection, and internet-native participation as possible mutations of knowledge-legitimation protocols.** The source argues that existing institutions can be too slow or narrow, while new roles still require ways to turn attention into credible knowledge. [S10](#s10)

### 8. Protocols affect agency and lived experience

- **C25 — Protocols coordinate partly by reducing available choices.** “Dangerous Protocols” argues that simplification and coordination can become control, especially when a protocol is hard to perceive or its costs and outcomes are obscured. [S5](#s5)
- **C26 — Effectiveness is not the only evaluative dimension in the corpus.** “A Phenomenology of Protocols” argues that protocols shape participants’ ways of thinking and acting, making effects on human flourishing relevant alongside immediate efficiency. [S11](#s11)
- **C27 — Pattern languages are offered as one way to expose specialized design knowledge without fixing a single complete solution.** The digital-spaces work emphasizes composable patterns and non-specialist agency. [S12](#s12)

## Positions and mechanisms

### Hard points as coordination anchors

- **Claim:** Stable commitments make distributed action possible because later actors can rely on something remaining fixed long enough to coordinate around it. [S1](#s1)
- **Support:** Source-author argument illustrated through a broad protocol kit and the idea of selectively programmable or evolvable hardness.
- **Boundary:** The source does not specify a machine-checkable hardness scale, prove that a given hard point is correct, or eliminate the need for interpretation and maintenance.

### Live protocol systems rather than rule catalogs

- **Claim:** Protocol effects emerge from rules plus roles, artifacts, uptake, knowledge, enforcement, and exit. [S4](#s4)
- **Support:** Conceptual framework built from participant experience across many kinds of protocol systems.
- **Boundary:** The framework is intentionally broad and can blur differences between technical protocols, institutions, families, professions, and states.

### Stigmergic trace-and-stimulus coordination

- **Claim:** A shared, inspectable environment can carry coordination state between agents that do not communicate directly or retain common internal memory. [S19](#s19)
- **Support:** Reported AI-agent behavior, foundational biological literature summarized in the article, swarm-computation examples, and a simulator agenda.
- **Boundary:** The article’s AI case is unusual and adversarial; biological analogies do not establish that identical controls work for software agents. The underlying incident reports and cited studies were not independently checked in this survey.

### Trace hardening through failure

- **Claim:** A stigmergic convention can acquire stronger identity or access controls after a concrete failure exposes ambiguity or abuse. [S19](#s19)
- **Support:** The reported progression from ad hoc directory messages to mailboxes to cryptographic signing after impersonation.
- **Boundary:** Reactive hardening may arrive after harm, and locally successful conventions may not have legitimate authority outside the participating swarm.

### Verification ecology

- **Claim:** Trust can be produced by several partial checks, independent roles, and remedies rather than one universally visible proof. [S20](#s20)
- **Support:** Estonia i-voting case with voter verification, revoting, paper override, audits, courts, officials, specialists, and source review.
- **Boundary:** The source is an institutional case narrative; its legitimacy depends on Estonia’s existing digital identity and public institutions and cannot be transferred as a context-free recipe.

### Proof-mediated verification

- **Claim:** A proof artifact can change who must repeat an operation and what they must trust. [S22](#s22)
- **Support:** Resource summary of the Lean Ethereum/SNARK discussion.
- **Boundary:** Only the resource summary, not the full interview or protocol implementation, was inspected. Proof correctness, setup assumptions, and total system cost remain outside this survey.

### Evolutionary stewardship

- **Claim:** Protocols undergo birth, mutation, selection, institutionalization, atrophy, and death; deliberate design is one mutation source among others. [S6](#s6) [S7](#s7) [S8](#s8) [S9](#s9)
- **Support:** Historical safety and standards cases, interviews about emergency time, and analysis of protocol-supported worlds ending.
- **Boundary:** The evolutionary vocabulary is explanatory and analogical; the sources do not offer one validated predictive model across all protocol types.

### Discover–encode–prove–harvest loop

- **Claim:** In AI adoption, exploratory practice can be converted into governed protocol through recurring discovery, encoding, proving, and harvesting. [S21](#s21)
- **Support:** Protocol Institute practitioner guide and cases summarized on the resource page.
- **Boundary:** The document is a living organizational playbook, not evidence that the four-step sequence is necessary or sufficient in every engineering domain.

## Disputes and conflicting evidence

### Deliberate design versus emergent protocolization

- **C28 — Some sources emphasize protocols as intentional patterns of constraint and professional standards-making.** [S6](#s6) [S8](#s8)
- **C29 — Other sources emphasize conventions that emerge through use, copying, environmental pressure, and local failure.** [S14](#s14) [S19](#s19)
- **Difference that may matter:** Whether the system begins with a recognized designer and governance body, or with a population discovering coordination conventions in a shared substrate.
- **Unresolved:** The corpus does not settle when emergent conventions should be admitted as authoritative rules or who can legitimately perform that admission.

### More hardness versus preserved adaptability

- **C30 — Hardness makes commitments dependable and can stabilize coordination.** [S1](#s1) [S15](#s15)
- **C31 — Excessive or misplaced protocolization can reduce agency, hide failure, and preserve obsolete constraints.** [S5](#s5) [S7](#s7) [S9](#s9)
- **Difference that may matter:** Which behavior must be invariant, for how long, under whose authority, and whether the system retains visible exception, expiry, and revision paths.
- **Unresolved:** None of the inspected sources supplies a general test that distinguishes necessary hardness from pseudo-hardness before deployment.

### Positive feedback as optimizer versus trap

- **C32 — Trace reinforcement can help distributed agents converge on useful paths.** [S19](#s19)
- **C33 — The same feedback can create ant mills or magnify a small number of false traces.** [S19](#s19)
- **Difference that may matter:** Trace lifetime, channel separation, identity, topology, reinforcement sensitivity, adversarial access, negative feedback, and whether agents can independently test the traced proposition.
- **Unresolved:** The Protocol Institute source frames safe stigmergy as an active research question and simulator agenda, not a solved design.

### Transparency versus differentiated visibility

- **C34 — Legibility can support participant agency and make protocols contestable.** [S4](#s4) [S5](#s5)
- **C35 — The Estonia case distributes inspection across ordinary users, specialists, institutions, and courts rather than exposing every layer to every participant.** [S20](#s20)
- **Difference that may matter:** Whether the relevant assurance requires public comprehension, expert reproducibility, legal remedy, direct user verification, or separation of sensitive information.
- **Unresolved:** The survey cannot infer the minimum visibility required for legitimacy in a developer-tool protocol.

### Fixed expert knowledge versus open knowledge production

- **C36 — Standards and protocols preserve accumulated expert learning in reusable form.** [S6](#s6) [S8](#s8)
- **C37 — Existing knowledge protocols can exclude useful replication, criticism, and internet-native discovery.** [S10](#s10)
- **Difference that may matter:** Whether new claims can enter as proposals and receive credible testing without being mistaken for admitted knowledge.
- **Unresolved:** The sources expose the participation/legitimation tension but do not define a universal admission mechanism.

## Cases and timeline

- **2023–2025 — Summer of Protocols:** A seasonal research program established broad protocol concepts and case work spanning safety, standards, emergency response, agency, knowledge, digital spaces, and protocol death. The successor institute describes this archive as the foundation for its continuing work. [S2](#s2) [S14](#s14)
- **2023/2024 — Workplace safety and protocol evolution:** “Safe New World” uses historical workplace-safety improvement to develop an evolutionary account of protocol selection under technological change. [S6](#s6)
- **2023/2024 — Standards as enabling constraints:** “Standards Make the World” connects standards bodies and professional practice to infrastructures such as the Internet, shipping containers, and the Bristlemouth connector. [S8](#s8)
- **2023/2024 — Emergency time:** Olivia Steiert’s interviews describe protocols as both change-enabling and context-conserving under crisis. [S7](#s7)
- **2024 — Protocol death:** Sarah Friend treats the ending of protocol-supported worlds as a process involving archive, memorialization, and successor possibilities. [S9](#s9)
- **2024 — Knowledge-protocol mutation:** Kara Kittel and Toby Shorin examine informal replication and fraud detection around scientific controversies as emerging roles outside established legitimation routes. [S10](#s10)
- **2025-08 — Formal Protocol Theory:** The SIGFPT overview presents a research program organized around observability, notation, calculability, process calculi, impossibilities, symmetries, and empirical examples. [S16](#s16)
- **2025-10 — Protocols as AI’s “evil twin”:** Rao and Protocolized contrast intelligence’s fluidity and agency with protocols’ commitments, constraints, and resistance, while noting that actual engineered systems combine both. [S17](#s17)
- **2025-11 — Verifiability:** The Bridge Atlas resource records a comparison between brute-force re-execution and cryptographic proof in the Lean Ethereum context. [S22](#s22)
- **2026-04/05 — Protocol Institute and New Nature:** The successor institute formalizes a public mission around protocol design, analysis, stewardship, and technologically mediated laws with nature-like hardness. [S14](#s14) [S15](#s15)
- **2026-05 — Durable AI Adoption:** A living organizational guide proposes cultivated and governed tracks and the `Discover → Encode → Prove → Harvest` lifecycle. [S21](#s21)
- **2026-09 — Estonia i-voting:** “Trust by Protocol” describes legitimacy produced through multiple technical, institutional, legal, and user-facing safeguards. [S20](#s20)
- **2026-09 — AI-agent stigmergy:** “Securing Stigmergic Systems” reports an AI-agent coordination incident, relates it to biological and computational stigmergy, details failure modes, and frames safe stigmergy as an open experimental program. [S19](#s19)

## Coverage and gaps

| Coverage cell | Status | Sources | Gap or limit |
| --- | --- | --- | --- |
| Foundational protocol definitions | supported | S2, S3, S4 | Conceptual and programmatic; no single agreed formal definition |
| Hardness and softness | supported | S1, S15, S17 | No operational hardness metric or independent empirical validation |
| Protocol enactment and participant experience | supported | S4, S5, S11 | Mostly essays and conceptual frameworks |
| Protocol evolution and standards | supported | S6, S7, S8, S9 | Historical and analogical; limited predictive validation |
| Formal protocol methods | supported | S16, S17, S22 | Public agenda and resource summaries; private SIG work and many primary papers uninspected |
| Stigmergic coordination mechanisms | supported | S19 | One current synthesis article; cited biological, security, and distributed-computing sources not independently audited |
| Stigmergic failure and adversarial traces | supported | S19 | Simulator and mitigations remain active work; underlying 2026 incident sources uninspected |
| Trust, legitimacy, and differentiated roles | supported | S20 | One national case with strong institutional preconditions |
| AI protocol discovery and maturation | supported | S21 | Practitioner living document rather than comparative evaluation |
| Open knowledge and admission | supported | S10 | Descriptive cases; no general admission algorithm |
| Protocol vocabulary and addressability | supported | S23 | Living generated/curated lexicon; definitions reflect corpus usage rather than settled field terms |
| Failed or dangerous protocols | supported | S5, S7, S9, S19 | Publication bias and corpus self-selection likely hide additional failures |
| Non-English and non-Western protocol traditions | unsearched | — | English-language scope only; Estonia is the main deeply inspected non-US institutional case |
| External formal-methods and distributed-systems comparison | unsearched | — | Explicitly excluded for this survey |
| Independent validation of current 2026 incident claims | unsearched | — | Article citations recorded but underlying reports were not opened |
| Private organizational practice and failed experiments | inaccessible | — | Public corpus cannot expose tacit or unpublished work |

## Claim-to-source ledger

| Claim | Kind | Support | Confidence | Limit |
| --- | --- | --- | --- | --- |
| C1 | source argument | S2, S4 | solid | Conceptual distinction, not a universal empirical law |
| C2 | source argument / historical case | S6, S8 | plausible | Implementation effects vary by domain |
| C3 | source argument | S5, S9 | plausible | No prevalence claim |
| C4 | source argument | S1 | solid | No operational metric |
| C5 | source argument | S1 | solid | Philosophical framing |
| C6 | source argument | S15 | solid | Explicitly a research mission |
| C7 | primary institutional statement | S16, S17 | solid | Agenda remains unfinished |
| C8 | primary institutional statement | S16, S17 | solid | Stated method, not audited practice across all work |
| C9 | secondary resource summary | S22 | plausible | Full interview and implementation not inspected |
| C10 | source argument / historical case | S6, S8 | plausible | No unified causal model |
| C11 | source argument based on interviews | S7 | plausible | Summer of Protocols sample |
| C12 | source argument / cases | S9 | plausible | Applies to protocol-supported worlds in source framing |
| C13 | source argument / cited literature | S19 | solid | External literature not independently checked |
| C14 | practitioner report | S19 | plausible | Underlying incident reports uninspected |
| C15 | practitioner report | S19 | plausible | Same limitation |
| C16 | cited scholarly finding / source synthesis | S19 | plausible | Studies not independently audited |
| C17 | practitioner report / experimental framing | S19 | solid | Variables listed; completeness unclaimed |
| C18 | cited scholarly finding / inference | S19 | plausible | Cross-domain transfer remains analogical |
| C19 | field case / source argument | S20 | plausible | Estonia-specific institutional conditions |
| C20 | inference from field case | S20 | plausible | Transfer outside elections not established |
| C21 | field case | S20 | solid | Describes mechanisms, not measured effect size |
| C22 | practitioner living document | S21 | solid | Framework, not controlled evaluation |
| C23 | practitioner living document | S21 | solid | Same limitation |
| C24 | source argument / cases | S10 | plausible | Cases selected by authors |
| C25 | critical source argument | S5 | plausible | No prevalence estimate |
| C26 | philosophical source argument | S11 | plausible | Normative argument |
| C27 | design source argument | S12 | plausible | No measured outcome in inspected page |
| C28–C37 | cross-source descriptive contrast | cited per dispute | plausible | Survey organization may sharpen differences beyond sources’ own framing |

## Sources

### Primary and official

- <a id="s2"></a>**S2** — [Research](https://summerofprotocols.com/research), Summer of Protocols, archive index, accessed 2026-09-17. **Used for:** corpus scope and foundational/current distinction. **Limit:** Index structure reflects program curation.
- <a id="s14"></a>**S14** — [Introducing the Protocol Institute](https://protocolized.summerofprotocols.com/p/introducing-the-protocol-institute), Timber Stinson-Schroff and Protocolized, 2026-04-27. **Used for:** institutional lineage, protocolization, stewardship, emergent coordination. **Limit:** Founding vision essay.
- <a id="s15"></a>**S15** — [Inventing New Nature](https://protocolized.summerofprotocols.com/p/inventing-new-nature), Venkatesh Rao and Protocolized, 2026-05-12. **Used for:** New Nature definition and research mission. **Limit:** Programmatic work in progress.
- <a id="s16"></a>**S16** — [What Is Formal Protocol Theory?](https://protocolized.summerofprotocols.com/p/what-is-formal-protocol-theory), Venkatesh Rao and Protocolized, 2025-08-20. **Used for:** FPT aims, topics, methods, observability, notation, empirical grounding, impossibilities, and symmetries. **Limit:** Public SIG overview rather than finished theory.
- <a id="s17"></a>**S17** — [Constructing the Evil Twin of AI](https://protocolized.summerofprotocols.com/p/constructing-the-evil-twin-of-ai), Venkatesh Rao and Protocolized, 2025-10-15. **Used for:** AI/protocol complementarity, hardness, constraints, formal-method agenda. **Limit:** Metaphorical and programmatic framing.
- <a id="s18"></a>**S18** — [Resources](https://protocolized.io/resources), Protocolized / Protocol Institute, accessed 2026-09-17. **Used for:** current corpus size, source discovery, current topic coverage. **Limit:** Living curated archive with generated summaries.
- <a id="s23"></a>**S23** — [Protocol Lexicon](https://protocolized.io/resources/protocol-lexicon), Protocolized / Protocol Institute, accessed 2026-09-17. **Used for:** corpus-specific terminology, addressability, afterlife, and trace vocabulary. **Limit:** Living lexicon whose definitions describe corpus usage; not an external consensus vocabulary.

### Scholarly and technical

- <a id="s19"></a>**S19** — [Securing Stigmergic Systems](https://protocolized.io/p/securing-stigmergic-systems), Patrick Nast, 2026-09-17. **Used for:** stigmergy definition, AI-agent message-board case, mailbox/signature emergence, queues and holds, ant mills, adversarial traces, evaporation, identity, feedback, and simulator variables. **Limit:** Synthesis and practitioner report; its OpenAI/Hugging Face incident records and cited biological/computing studies were not independently opened for this survey.
- <a id="s22"></a>**S22** — [Bridge Atlas — Episode 5: Verifiability](https://protocolized.io/resources/bridge-atlas-episode-5-verifiability), Shreya Shankar and Justin Drake, 2025-11-14. **Used for:** proof-mediated versus re-execution verification. **Limit:** Protocolized resource summary inspected; full video not reviewed.

### Field, critical, and secondary

- <a id="s1"></a>**S1** — [In Search of Hardness](https://contraptions.venkateshrao.com/p/in-search-of-hardness), Venkatesh Rao, accessed 2026-09-17. **Used for:** hardness, pseudo-hardness, selective ossification, protocol kit, and the hardness/softness relation. **Limit:** Philosophical source-author argument rather than empirical validation.
- <a id="s3"></a>**S3** — [The Unreasonable Sufficiency of Protocols](https://summerofprotocols.com/research/module-two/the-unreasonable-sufficiency-of-protocols), Venkatesh Rao, Tim Beiko, Danny Ryan, Josh Stark, Trent Van Epps, and Bastian Aue, archive page, accessed 2026-09-17. **Used for:** founding working definition and multiple protocol-sufficiency dimensions. **Limit:** Explicitly an initial provocation, not a comprehensive theory.
- <a id="s4"></a>**S4** — [The Protocol System Experience](https://summerofprotocols.com/research/the-protocol-system-experience), Angela Walch, archive page, accessed 2026-09-17. **Used for:** protocol system, participant roles, knowledge, agency, entry, performance, and exit. **Limit:** Broad conceptual framework.
- <a id="s5"></a>**S5** — [Dangerous Protocols](https://summerofprotocols.com/research/dangerous-protocols), Nadia Asparouhova, archive page, accessed 2026-09-17. **Used for:** agency loss, hidden control, simplification, and subversion. **Limit:** Critical essay and selected cases.
- <a id="s6"></a>**S6** — [Safe New World](https://summerofprotocols.com/research/module-three/safe-new-world), Timber Stinson-Schroff, archive page, accessed 2026-09-17. **Used for:** intentional constraints, safety-protocol evolution, selection pressures, and technological maturation. **Limit:** Historical theory-building rather than general predictive validation.
- <a id="s7"></a>**S7** — [Protocols in (Emergency) Time](https://summerofprotocols.com/research/protocols-in-emergency-time), Olivia Steiert, 2023 archive page, accessed 2026-09-17. **Used for:** temporality, crisis, routinization, conservation, change, and protocol non-goal-orientation. **Limit:** Comparative interpretation of interviews within the program.
- <a id="s8"></a>**S8** — [Standards Make the World](https://summerofprotocols.com/research/standards-make-the-world), David Lang, 2023 archive page, accessed 2026-09-17. **Used for:** standards bodies, enabling constraints, professional practice, and Bristlemouth. **Limit:** History, field narrative, and guidebook combined.
- <a id="s9"></a>**S9** — [Good Death](https://summerofprotocols.com/research/good-death), Sarah Friend, 2024 archive page, accessed 2026-09-17. **Used for:** protocol/world mortality, archiving, memorialization, and afterlife. **Limit:** Conceptual and case-based account.
- <a id="s10"></a>**S10** — [Unprotocolized Knowledge](https://summerofprotocols.com/research/module-four/unprotocolized-knowledge), Kara Kittel and Toby Shorin, 2024 archive page, accessed 2026-09-17. **Used for:** limits of knowledge-legitimation protocols, informal replication, emerging roles, and participation. **Limit:** Selected controversies and author argument.
- <a id="s11"></a>**S11** — [A Phenomenology of Protocols](https://summerofprotocols.com/research/a-phenomenology-of-protocols), Janna Tay, archive page, accessed 2026-09-17. **Used for:** participant experience, agency, moral effects, and effectiveness limits. **Limit:** Philosophical argument rather than measured effect.
- <a id="s12"></a>**S12** — [A Pattern Language for Digital Spaces](https://summerofprotocols.com/pills/a-pattern-language-for-digital-spaces), Guo Liu, archive page, accessed 2026-09-17. **Used for:** pattern languages, composability, specialist knowledge, and non-specialist agency. **Limit:** Summary page and linked artifact; no outcome evaluation.
- <a id="s20"></a>**S20** — [Trust by Protocol](https://protocolized.io/p/trust-by-protocol), Jason Collins, 2026-09-07. **Used for:** Estonia i-voting, legitimacy, differentiated roles, verification app, revoting, paper override, audits, courts, officials, experts, and source review. **Limit:** Field article centered on one national institutional setting.
- <a id="s21"></a>**S21** — [Durable AI Adoption](https://protocolized.io/resources/durable-ai-adoption), Protocol Institute, version 0.5, 2026-05-01. **Used for:** probabilistic outputs, shifting failure modes, governed/cultivated tracks, `Discover → Encode → Prove → Harvest`, evaluation, risk stewardship, and context stabilization. **Limit:** Living practitioner guide; page summary and metadata inspected rather than the full downloadable PDF.

## Search and control record

- **Search routes:** Began with the user-supplied hardness essay, then inspected the Summer of Protocols research index and institutional About material; followed foundational, critical, temporal, evolutionary, knowledge, standards, death, and pattern-language pages; inspected the successor institute’s founding and research-agenda essays; queried the current Protocolized resources archive; followed targeted current resources on stigmergy, trust, AI adoption, verifiability, and the living lexicon. Targeted search routes included protocol failure/repair, hardness/leakiness, AI/protocol complementarity, observability/verifiability, evolution/death, and stigmergic security.
- **Prominence counter-search:** The run did not stop at the founding essays. It included critical work on dangerous protocols, participant experience, emergency time, protocol death, unprotocolized knowledge, less prominent pattern-language material, a current practitioner guide, a national field case, and a recent stigmergy/security synthesis. English-language and institutional concentration remain.
- **Contrary-evidence search:** Sought failure, repair, unsuccessful protocols, excessive rigidity, agency loss, exit, atrophy, death, adversarial traces, ant mills, impersonation, queue overload, ignored holds, and limits of universal transparency. No claim of consensus is made.
- **Source-class coverage:** Institutional mission statements, public research agendas, conceptual essays, critical essays, historical/field narratives, a living practitioner guide, a resource archive, a living lexicon, an interview summary, and a current technical synthesis with scholarly citations. The survey did not independently inspect the external primary incident reports or the cited biological/distributed-computing papers.
- **Recency check:** Foundational Summer of Protocols work from 2023–2025 is separated from current Protocol Institute work through the 2026-09-17 cutoff. Current pages are living documents and may change after the survey date.
- **Saturation check:** Two final targeted passes—one through failure/repair/death material and one through stigmergy/trust/verifiability/AI-adoption material—added no new top-level position beyond the recorded clusters, though the stigmergy pass materially expanded mechanisms and failure variables. The broad-run saturation stop fired within the declared public English-language routes, not across the full 328-item archive or external literature.

## Limits and unmeasured

- **Main artifact risk:** The survey frame may make “hardness,” “stigmergy,” “verification,” and “legitimacy” look like a more unified theory than the sources themselves provide. The corpus is institutionally related, English-language, self-curated, and rich in conceptual essays; retrieval frequency cannot establish consensus or effectiveness.
- **Unmeasured:** Non-English work; independent scholarly reception of the Protocol Institute’s concepts; private SIG transcripts and failed experiments; the full 328-item current archive; the full 566-term lexicon; external formal-methods, governance, distributed-systems, expert-systems, and stigmergy literatures; primary validation of the 2026 AI-agent incident; full videos and linked PDFs; comparative evidence about which controls actually make human/AI stigmergic systems safe.
- **Coverage claim:** This is a broad, source-traced orientation to the public Protocol Institute/Summer of Protocols landscape relevant to hardness and agent coordination as of 2026-09-17. It can support later mechanism transfer and design-grammar work. It is not an exhaustive review, a ranking of the material, proof that any mechanism transfers to TanStack Trust, or an architecture recommendation.

## Handoff index

- **Terms and distinctions:** The definitions above separate rule from protocol system; hardness from truth; trace from admission; observability from verifiability; security from legitimacy; and execution from declaration.
- **Stigmergic mechanisms:** C13–C18 and the trace-and-stimulus position preserve medium, addressability, identity, trace lifetime, channel separation, positive feedback, false traces, queues, holds, and objection windows.
- **Hardness and lifecycle:** C4–C12 preserve selective hardness, softness, enactment, mutation, crisis, expiry, death, and afterlife.
- **Trust and proof:** C19–C23 preserve differentiated authority, remedies, verification, proof cost, recurring discovery, evaluation, and stewardship.
- **Disputes:** The four conflict sections preserve design/emergence, hardness/adaptability, optimization/trap, transparency/differentiated visibility, and expert/open-production tensions.
- **Coverage and gaps:** The table records unsupported transfer questions and uninspected external evidence.
- **Claim and source ledgers:** Every material claim resolves to a source ID and retains its support type and boundary.

This index describes available material. It does not select or run another instrument.

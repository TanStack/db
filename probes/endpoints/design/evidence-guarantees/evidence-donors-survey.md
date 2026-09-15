---
instrument: research-survey
title: "Evidence tracking beyond software tests"
question: "What literature and software designs track evidence in an expansive sense, and what mechanisms can serve as donors for the Endpoints evidence-system inquiry?"
scope: "Foundational literature and current public software/specifications across evidence representation, argument, provenance, reproducibility, assessment and revision; English-language sources; no geographic restriction."
intended_use: "Supply source-traced donors for a later Structural Recombine and Design Grammar; do not choose an architecture."
depth: quick
researched_at: 2026-09-15
source_cutoff: 2026-09-15
status: complete
---

# Evidence tracking beyond software tests

## Survey brief

- **Question:** What literature and software designs track evidence in an expansive sense, and what mechanisms can serve as donors for the Endpoints evidence-system inquiry?
- **Intended use:** Additional donors for later Structural Recombine and Design Grammar; no adoption or architecture selection.
- **Included:** Truth maintenance and defeasible argument; provenance and attribution; assurance cases; evidence-quality assessment; scientific reproducibility; software attestations; temporal revision; annotation and research knowledge records.
- **Excluded:** Exhaustive systematic review; implementing or installing donors; quantitative confidence aggregation; medical/legal recommendations; vendor selection; new runtime policy for Endpoints.
- **Starting sources:** Previously read Beads API notes and the current local evidence/process corpus; these guide the question but do not count as newly researched donors.
- **Available source languages:** English.
- **Access limits:** Public web sources and open papers. Unavailable primary texts will remain marked rather than supported by search snippets.
- **Pre-search coverage frame:** Eight cells: (1) truth maintenance/argument, (2) scientific/data provenance, (3) assurance cases, (4) evidence grading, (5) reproducible research artifacts, (6) software attestations, (7) temporal fact revision, (8) annotations/claim records. These are analyst-selected search cells, not a proposed evidence ontology.
- **Stop rule:** One compact search across these cells and one contrary-evidence pass, with targeted source openings. Stop at quick-survey coverage, not claimed saturation.

## Orientation

This survey supplies ten donor families across eight search cells. They address different questions: what was asserted, what produced it, why it supports a conclusion, what could defeat that conclusion, and what was known at a particular time. The grouping is an analyst's reading of the sources, not a shared ontology or a selected Endpoints design. [S1](#s1)–[S13](#s13)

The corpus includes formal reasoning, clinical evidence assessment, scientific workflow records, software supply-chain verification and temporal databases. These sources describe mechanisms; they do not establish that those mechanisms improve an agent's reliability in this project.

## Terms and distinctions

- **Justification:** A stated derivation from premises or assumptions to a conclusion. Its logical validity is distinct from the truth of its inputs. [S1](#s1)
- **Provenance:** A record of the entities, activities and agents involved in producing something. [S3](#s3)
- **Defeater:** A doubt or challenge to an assurance argument that needs examination; it need not already be a demonstrated failure. [S5](#s5)
- **Certainty assessment:** An assessment of a body of evidence for a particular outcome, rather than an intrinsic score attached to a document. [S6](#s6)
- **Attestation:** A typed statement bound to identified subjects. Identifying the subject does not evaluate the statement's adequacy. [S9](#s9)
- **System time versus valid time:** When information entered a system versus the domain interval to which it applies. Neither is automatically an evidence-expiry policy. [S11](#s11)

## Evidence landscape

### 1. Truth maintenance: alternative grounds for a conclusion

**C1.** De Kleer's assumption-based truth maintenance system associates a proposition with minimal sets of assumptions under which it follows from the supplied justifications. Inconsistent sets are excluded. Alternative supporting sets remain distinct. Its guarantees are relative to those inputs; identifying equivalent propositions and choosing assumptions remain responsibilities of the surrounding problem solver. [S1](#s1)

**Potential donor D1 — inference:** Represent “A and B together support C” separately from “either A or B independently supports C.” This could expose which conclusions lose support when one premise changes without treating every dependent observation as false. A formal derivation is not a fresh test execution.

### 2. Argumentation software: claims, arguments and acceptance rules

**C2.** Carneades 3.7 stores statements separately from arguments, supports arguments for and against a statement, and applies a statement's proof standard to assess acceptability. Its manual also distinguishes audience-supplied weights from computed evaluation results, including an undecided outcome. These are properties of that model, not calibrated probabilities of truth. [S2](#s2)

**Potential donor D2 — inference:** Store the support relation and the rule used to assess it, not merely an evidence attachment. A record could explain why a source review meets one claim's rubric but leaves another unresolved. This does not select Endpoints' deferred check-level policy.

### 3. PROV: evidence production is a graph of activities

**C3.** W3C PROV describes entities, activities and responsible agents, including use, generation and derivation. Entities can be physical, digital or conceptual; a document, a particular version and an evolving document can be represented separately. [S3](#s3)

**Potential donor D3 — inference:** A test report, catalog capture, fixture set, human note and source inspection can share a production-history model without pretending that they have the same evidential strength. Following a derivation could identify shared inputs behind apparently separate checks.

### 4. Nanopublications: separate the assertion from its publication

**C4.** The guidelines separate an assertion graph, provenance about that assertion, and publication information about the nanopublication itself. The person publishing a record and the origin of the assertion therefore need not be conflated. [S4](#s4)

**Potential donor D4 — inference:** An agent importing a runner's failure can be recorded as the importer without becoming the authority that produced the failure. Likewise, recording someone's claim need not endorse it. These are record distinctions, not a requirement to adopt RDF.

### 5. Assurance cases: support, challenges and residual doubts

**C5.** Assurance 2.0 argues against reducing confidence to one attribute. It distinguishes positive support, explored challenges and remaining doubts, and calls for recording challenges and their resolutions. Its authors also discuss probabilistic methods; this survey does not validate or transfer those methods. [S5](#s5)

**Potential donor D5 — inference:** A challenge can target the inference from a real result to a broad claim: for example, “this oracle passed, but its generator never creates the relevant trigger.” That challenges the claimed coverage without denying that the run passed. A resolved challenge should retain its explanation.

### 6. GRADE: assess evidence against a specific outcome

**C6.** GRADE, as described by Cochrane, assesses certainty for each outcome using domains including bias, inconsistency, indirectness, imprecision and publication bias. Assessments include reasons for downgrading. The method concerns clinical evidence synthesis; its thresholds and study hierarchy are not software-testing rules. [S6](#s6)

**Potential donor D6 — inference:** Claim rubrics could distinguish directness, covered conditions, test sensitivity and contradictory observations. “An e2e oracle” alone would not settle the rubric: the claim still depends on what the oracle observes and generates. This is a possible assessment shape, not a proposed universal score.

### 7. Research objects: an execution includes more than code

**C7.** Workflow Run RO-Crate offers three profiles with increasing execution detail: process, workflow and internal workflow-step provenance. [S7](#s7)

**C8.** Process Run Crate links executions to tools, inputs and results, and describes configuration files and environment settings. It permits records of non-file data too. It explicitly allows incomplete chains of actions; format compliance does not establish that all relevant steps were captured. [S8](#s8)

**Potential donor D7 — inference:** Capture a run's relevant data, schema/catalog state, generator settings, dependencies and environment alongside code identity. State what was captured rather than calling a bundle complete. This directly fits the existing decision that reverting code does not reactivate old test evidence. [S14](#s14)

### 8. Attestations: bind a result, then evaluate expectations

**C9.** An in-toto Statement binds subjects identified by digest to a typed predicate. This gives a concrete boundary for what an assertion is about. [S9](#s9)

**C10.** SLSA treats provenance verification as comparison against expectations. Those expectations are distinct from an artifact's provenance and may be set by different parties. Its current guidance also notes that detecting a verification failure only helps if someone or something responds. [S10](#s10)

**Potential donor D8 — inference:** A runner result could identify the exact subject and check, while a separate assessment explains its use for a claim. Authentic reporting and semantic adequacy are separate checks. This suggests neither mandatory signing nor a new approval layer for the prototype.

### 9. Bitemporal databases: preserve what was known when

**C11.** XTDB stores temporal versions and separates system time, recording when information entered the database, from a user-managed valid-time interval. This supports corrections that do not erase the earlier recorded history. [S11](#s11)

**Potential donor D9 — inference:** A late report about an earlier run can have both a time of occurrence and a time of discovery. “What supported this release then?” and “What do we now know about that release?” become distinct questions. This is not a reason to contact live clients or reuse stale evidence.

### 10. Annotation systems: cite the precise part and representation

**C12.** W3C Web Annotation supports quote selectors with surrounding text, position selectors and representation state. The specification explicitly warns that position selectors are brittle when a resource changes. [S12](#s12)

**Potential donor D10 — inference:** A source-analysis record could point to the exact passage, function or catalog row supporting a claim, with its captured version. A file-level reference alone may hide which part mattered; an offset alone may drift. Reliable anchoring still does not establish the interpretation.

## Positions and mechanisms

These are unranked mechanisms, with different authority boundaries.

| Mechanism | What it can answer within its model | What it does not establish |
| --- | --- | --- |
| Assumption sets and argument graphs | Which premises and rules support a conclusion? [S1](#s1), [S2](#s2) | Whether supplied premises describe reality |
| Provenance and assertion records | Where did this item or claim come from? [S3](#s3), [S4](#s4) | Whether it is sufficient evidence |
| Assurance and evidence grading | What supports the claim, and what limits that support? [S5](#s5), [S6](#s6) | A universally calibrated confidence number |
| Run bundles and attestations | What execution or subject does this record describe? [S7](#s7)–[S10](#s10) | Complete capture or correctness by format alone |
| Temporal records and selectors | Which historical fact or source representation is meant? [S11](#s11), [S12](#s12) | Present applicability or sound interpretation |

The right column is an analyst's boundary reading of these scoped mechanisms, not a claim that their authors promise those broader guarantees.

## Disputes and conflicting evidence

### A detailed confidence method can still be hard to use

**C13.** A study of 19 assurance-case practitioners reported use of review, defeater reasoning and checklists, alongside concerns about quantitative methods. Reported barriers included extra work, inadequate guidance, subjective interpretation and trustworthiness. This is a small qualitative study, not a prevalence estimate or a test of Endpoints. [S13](#s13)

Assurance 2.0 offers a rich assessment approach; the practitioner study asks what people can use and trust. These are different kinds of evidence, not a direct experimental refutation. Whether a particular subset is useful for agents remains unmeasured. [S5](#s5), [S13](#s13)

### Authenticity, completeness and applicability are different limits

SLSA's comparison against expectations goes beyond having provenance. Process Run Crate can describe an execution without capturing every intermediate action. Neither source licenses an inference from “well-formed record” to “adequate proof of this application claim.” [S8](#s8), [S10](#s10)

**Inference:** A result may be authentic yet concern the wrong subject; accurate yet cover too narrow a domain; or once relevant yet no longer apply. These are possible failure categories for later design work, not measured frequencies.

### Formal support does not replace the surrounding investigation

ATMS places domain modeling outside its own bookkeeping guarantees. Carneades exposes supplied weights and acceptance rules. Neither removes the need to justify what was supplied. [S1](#s1), [S2](#s2)

**Inference:** A new graph engine could preserve bad assumptions perfectly. Whether Endpoints needs such an engine, or only selected record distinctions, is unresolved.

No head-to-head comparison among these donor systems was found within this quick search. Their different purposes prevent treating that absence as agreement.

## Cases and timeline

- **1986:** ATMS provides a foundational mechanism for assumption-dependent support. [S1](#s1)
- **2013 and 2017:** PROV and Web Annotation provide published interchange models for origin and source anchoring. [S3](#s3), [S12](#s12)
- **2022–2024:** Assurance 2.0 develops a confidence account; the 2024 practitioner study supplies a separate view of assessment in use. [S5](#s5), [S13](#s13)
- **At the survey cutoff:** The inspected software/specification pages supply concrete representations. Carneades 3.7 is used explicitly as a historical design donor. The SLSA 1.0 page led to 1.2, which is the version cited here. [S2](#s2), [S10](#s10)

These are orientation points, not a lineage or a claim that newer designs supersede older ones.

## Coverage and gaps

“Supported” means directly inspected material supports the scoped description, not that the cell has been exhaustively researched.

| Coverage cell | Status | Sources | Gap or limit |
| --- | --- | --- | --- |
| Truth maintenance / argument | supported | S1, S2 | No implementation benchmark or comprehensive belief-revision survey |
| Scientific / data provenance | supported | S3, S4 | Database provenance algebra was searched but not inspected sufficiently to include |
| Assurance cases | supported | S5, S13 | Abstract-level inspection of these papers; no full empirical-method audit |
| Evidence grading | supported | S6 | Clinical method only; transfer is inference |
| Reproducible research artifacts | supported | S7, S8 | Specifications inspected; no replay trial |
| Software attestations | supported | S9, S10 | No deployment or independent security evaluation |
| Temporal fact revision | supported | S11 | One implementation's documentation; no comparative study |
| Annotation / claim records | supported | S4, S12 | No annotation-recovery measurements |
| Operational failures and adoption costs across donors | thin | S13 | One small qualitative study; vendor/specification descriptions dominate |

## Claim-to-source ledger

Confidence here describes support for the narrow source description, not a probability that an Endpoints design will work.

| Claim | Kind | Support | Confidence | Limit |
| --- | --- | --- | --- | --- |
| C1 | scholarly finding | S1 | solid | Formal properties relative to supplied assumptions and justifications |
| C2 | primary record | S2 | solid | Historical version's manual; no probability calibration |
| C3 | primary record | S3 | solid | Representation standard |
| C4 | primary record | S4 | solid | Working guidelines |
| C5 | source argument | S5 | solid | Author position; abstract inspected |
| C6 | primary record | S6 | solid | Clinical evidence method |
| C7 | primary record | S7 | solid | Profile definitions |
| C8 | primary record | S8 | solid | Optional capture can be incomplete |
| C9 | primary record | S9 | solid | Statement schema, not semantic assurance |
| C10 | primary record | S10 | solid | Verification guidance |
| C11 | primary record | S11 | solid | Vendor documentation |
| C12 | primary record | S12 | solid | Standard and explicit brittleness warning |
| C13 | scholarly finding | S13 | solid | Reported interview result; abstract inspected; no generalization |
| D1–D10 | inference | S1–S12, S14 | plausible | Candidate transfers; not evaluated, ranked or selected |

## Sources

### Primary and official

- <a id="s2"></a>**S2** — [Carneades 3.7 User Manual](https://carneades.github.io/manuals/Carneades3.7/carneades-3.7-manual.pdf), Tom Gordon, historical version 3.7; document date not established. **Used for:** C2; sections 4.2, 5.2 and 6.2–6.5. **Limit:** Not a description of current version 4.
- <a id="s3"></a>**S3** — [PROV Model Primer](https://www.w3.org/TR/prov-primer/), W3C, 30 April 2013. **Used for:** C3; sections 2.1–2.4 and provenance overview. **Limit:** Descriptive model, not evidence assessment.
- <a id="s4"></a>**S4** — [Nanopublication Guidelines](https://nanopub.net/guidelines/working_draft/), nanopublication community, working draft accessed 15 September 2026. **Used for:** C4; assertion, provenance and publication-info sections. **Limit:** Evolving guidelines; no adoption claim.
- <a id="s6"></a>**S6** — [Cochrane Handbook, Chapter 14](https://www.cochrane.org/authors/handbooks-and-manuals/handbook/current/chapter-14), Schünemann and colleagues; chapter updated August 2023, Handbook 6.5 (2024). **Used for:** C6; grading domains and outcome-specific assessments. **Limit:** Medical evidence synthesis is a donor, not advice or a software rubric.
- <a id="s7"></a>**S7** — [Workflow Run RO-Crate Profile Collection](https://www.researchobject.org/workflow-run-crate/profiles/), ResearchObject contributors, accessed 15 September 2026. **Used for:** C7. **Limit:** Profile descriptions only.
- <a id="s8"></a>**S8** — [Process Run Crate](https://www.researchobject.org/workflow-run-crate/profiles/process_run_crate/), ResearchObject contributors, accessed 15 September 2026. **Used for:** C8; execution properties, multiple processes, configuration files and environment settings. **Limit:** No empirical completeness or reproducibility claim.
- <a id="s9"></a>**S9** — [in-toto Statement specification v1](https://github.com/in-toto/attestation/blob/main/spec/v1/statement.md), in-toto maintainers, accessed 15 September 2026. **Used for:** C9; subject digests and predicate type. **Limit:** Mutable repository URL; schema semantics only.
- <a id="s10"></a>**S10** — [SLSA v1.2: Verifying artifacts](https://slsa.dev/spec/v1.2/verifying-artifacts), SLSA, accessed 15 September 2026. **Used for:** C10; forming expectations and verification response. **Limit:** Guidance within a supply-chain threat model.
- <a id="s11"></a>**S11** — [XTDB Key Concepts](https://docs.xtdb.com/concepts/key-concepts.html), XTDB, accessed 15 September 2026. **Used for:** C11; records and temporal columns. **Limit:** First-party documentation; marketing and performance claims not adopted.
- <a id="s12"></a>**S12** — [Web Annotation Data Model](https://www.w3.org/TR/annotation-model/), W3C Recommendation, 23 February 2017. **Used for:** C12; quote and position selectors, representation state. **Limit:** Anchoring model, not validation of the annotator's claim.

### Scholarly and technical

- <a id="s1"></a>**S1** — [An Assumption-based TMS](https://www.dekleer.org/Publications/An%20Assumption-Based%20TMS.pdf), Johan de Kleer, *Artificial Intelligence* 28, 127–162, 1986. **Used for:** C1; introduction, label properties, basic algorithms and interaction boundaries. **Limit:** Selected sections inspected; some PDF text extraction is poor; no performance claim transferred.
- <a id="s5"></a>**S5** — [Assessing Confidence with Assurance 2.0](https://arxiv.org/abs/2205.04522), Robin Bloomfield and John Rushby, 2022, revised 3 May 2024. **Used for:** C5. **Limit:** Abstract and version record inspected; HTML rendering failed; no detailed formal-method evaluation claimed.

### Field, critical, and secondary

- <a id="s13"></a>**S13** — [How do practitioners gain confidence in assurance cases?](https://arxiv.org/abs/2411.03657), Simon Diemert, Caleb Shortt and Jens H. Weber, 6 November 2024. **Used for:** C13 and the contrary-evidence pass. **Limit:** Abstract inspected; 19 reported interviews; methods and sample not independently audited. This is also original scholarly research, placed here for its field perspective.
- <a id="s14"></a>**S14** — [Content review decisions](evidence-store-stress/08-content-review.md) and [four Process Grammars](process-grammars/README.md), local user/analysis record, through 15 September 2026. **Used for:** Transfer constraints, especially R22. **Limit:** Project decisions and bounded models, not external validation.

## Search and control record

- **Search routes:** General web index, then primary-source following. Query families covered de Kleer/ATMS; PROV; assurance cases/GSN/defeaters; GRADE; RO-Crate executions; in-toto/SLSA verification; XTDB valid/system time; nanopublications; Carneades proof standards; and Web Annotation selectors. Sources were opened and relevant passages inspected before use.
- **Prominence counter-search:** Expanded from familiar software attestations into older AI reasoning, clinical evidence synthesis and research workflow records. Looked for author-hosted papers and prototype manuals as well as standards. English-language and web-index bias remain; this was not a non-English or archival search.
- **Contrary-evidence search:** Searched assurance-case confidence barriers, limits of provenance verification, and argument acceptance assumptions. Inspected the practitioner study, SLSA expectations, RO-Crate's incomplete-chain allowance and W3C's brittle-selector warning. These supplied boundaries rather than a single opposing school.
- **Source-class coverage:** Standards/specifications, original formal research, a method handbook, first-party software documentation and one qualitative field study. No independent operational comparison of the donor software was found in this pass.
- **Access limits:** An author-hosted Carneades argument-invention PDF returned an error; the software manual supplied narrower support. Assurance 2.0's HTML view failed; its inspected abstract supports only the stated overview. GSN, provenance semirings and further papers surfaced as leads but were not inspected enough to serve as evidence.
- **Recency check:** Publication and document version records distinguish foundational texts from current pages. The SLSA 1.0 page was marked retired and linked to the inspected 1.2 guidance. Mutable pages are dated by access; they were not pinned or archived.
- **Saturation check:** The quick-run stop condition fired after the initial search, contrary pass and targeted source checks. Last material additions were run-context capture, the incomplete-chain boundary and the assurance-practice study. No saturation or exhaustive-review claim is made.

## Limits and unmeasured

- **Main artifact risk:** Accessible, well-documented systems dominate. A clean set of ten donor families can conceal overlap, missing approaches and the work required to maintain their records.
- **Unmeasured:** Operational cost, agent error rates, usability, numerical calibration, independence of repeated checks, and performance of any proposed transfer. Nothing here demonstrates that a new evidence graph produces trustworthy autonomous work.
- **Unsearched in depth:** Archival appraisal, forensic chain of custody, laboratory information systems, legal evidence practice, intelligence analysis, Bayesian/Dempster–Shafer evidence fusion and systematic database provenance algebra. This is expansive orientation, not coverage of all meanings of evidence.
- **Project boundaries retained:** No automatic reuse after code reversion; no mandated separate reviewer; no unconditional veto merely because evidence is missing; no live-client connection; CI inability to run remains a CI error rather than a new evidence-log event. Existing decisions govern these issues. [S14](#s14)
- **Coverage claim:** All eight initial cells have at least one inspected source. That establishes a source-traced donor inventory, not completeness, implementation readiness or a choice of architecture.

## Handoff index

- **D1–D10:** Separately labeled candidate transfers, with their source mechanisms and limits.
- **C1–C13:** Narrow factual claims and corresponding source IDs for later checking.
- **Disputes and coverage:** Usability concerns, missing empirical support and boundaries that later work must retain.
- **Local corpus:** [Four Process Grammars](process-grammars/README.md), [reviewed decisions](evidence-store-stress/08-content-review.md), and the prior [Beads API reading](evidence-store-stress/09-beads-api-reading.md) remain separate inputs.

This index does not select a design or run Structural Recombine or Design Grammar.

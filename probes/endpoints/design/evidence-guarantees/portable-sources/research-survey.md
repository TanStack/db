---
id: research-survey
name: "Research Survey"
summary: "A source-traced evidence landscape, with disputes, coverage limits, and a portable Markdown record."
use_when: "A broad initial survey is needed before closer analysis or another instrument can work well."
avoid_when: "Do not use for one fact, an exhaustive systematic review, or a request to decide, rank, or recommend."
access_target: "The current searchable evidence landscape, its major positions and conflicts, and the gaps left by the search."
requires: "A research question, intended downstream use, scope boundaries, source access, and a writable Markdown destination."
execution_seat: either
fresh_context: optional
effort: variable
persistence: "Always writes one portable Markdown survey; offer a Field Log when the inquiry also needs a continuing source and decision record."
artifact_risk: "Search rank and model priors can masquerade as consensus, while a polished survey can make partial coverage look final."
maturity: draft
documented_uses: 0
---

# Research Survey (`research-survey`)

- **Phenomenon sought:** The current searchable shape of evidence around a bounded question: useful terms, major positions and mechanisms, material conflicts, representative cases, source trails, and coverage gaps.
- **Why use it:** Model memory gives fast orientation but hides provenance, age, and coverage. Ad hoc browsing often follows prominence and stops after finding a plausible answer. This instrument produces a source-traced substrate that another person or instrument can inspect without the original conversation.
- **Operating range:** Use for broad initial orientation, unfamiliar or changing domains, or inquiries whose later instruments need a shared factual substrate. It may organize sources into traceable topics and unranked positions because that organization is part of its reading. It may not decide which position is right, infer prevalence from search results, recommend an action, or claim a systematic or exhaustive review. For medical, legal, financial, safety, or other high-stakes questions, label the survey as orientation and do not treat it as the evidence review required for action. Use a direct lookup for one stable fact and a domain review method when formal inclusion criteria, quality scoring, or effect estimates are required.
- **Input:** A working research question; the intended downstream use; topical, temporal, geographic, and source-language boundaries where they matter; supplied starting sources; a chosen depth; and a writable destination. Read supplied sources first. Ask one Focus question only when a missing boundary would materially change the survey. Otherwise use `broad` as the default depth.
- **What changes:** Search and selection make published, indexed, accessible material easier to see than tacit, private, local, failed, untranslated, or unpublished material. The survey's headings and coverage frame also impose categories that later work may mistake for the field itself.

## Depth

- **Quick:** Establish enough source-traced terms, positions, disputes, and gaps to orient the next operation. Use one compact search and one contrary-evidence pass.
- **Broad (default):** Search each result-changing part of the coverage frame, revisit weak cells, and stop on the saturation rule below.
- **Deep:** Use separate source tracks for distinct domains, positions, periods, or source languages when access permits. Freeze each track's notes before integration and retain its limits. Shared model lineage and shared search indexes remain correlated even when agents are separated.

Depth changes effort and coverage, not the authority boundary or the kind of result.

## Procedure

1. **Freeze the survey brief.** Record the exact question, intended downstream use, depth, boundaries, starting sources, research date, source cutoff, available source languages, and output path. State exclusions. Do not silently widen the question when adjacent material looks useful.
2. **Build a coverage frame.** Before searching, name the result-changing cells that deserve a pass. Use only dimensions relevant to the question, such as foundational and current work; primary, scholarly, practitioner, and critical sources; major positions; mechanisms; jurisdictions; affected groups; successful and failed cases; or claimed and measured outcomes. The frame guides coverage and remains revisable; it is not a claim that the field naturally has those parts.
3. **Search adaptively.** Use the available research harness, web search, databases, supplied corpora, or targeted research agents. Let the executor choose effective queries and order. Record the main search routes, indexes, date limits, and access failures rather than narrating every click. Open and inspect a source before using it; search snippets and model recollection are leads, not support.
4. **Extract typed claims.** For each material claim, preserve what kind of support it has: primary record, scholarly finding, source author's argument, practitioner report, user-supplied material, or model inference. Record source, date, evidence basis, relevant scope, and material limits. One citation does not support a broader claim than the source makes.
5. **Run the source controls.** Prefer primary records for actions, rules, dates, original arguments, and measured results. Use authoritative syntheses to orient a field, then inspect load-bearing original work when accessible. Diversify publishers, institutions, source types, and dates where the question warrants it. Mark paywalls, inaccessible sources, language limits, and citation chains that could not be checked.
6. **Run the prominence and conflict controls.** Search for contrary findings, failed cases, minority or critical positions, alternate local terms, and non-prominent sources. Reverse important claim language and search outside the dominant publisher or institution cluster. Preserve conflicts with their differing populations, measures, periods, assumptions, and evidence quality. Absence of a found conflict is a bounded search result, not evidence of consensus.
7. **Audit coverage and saturation.** Mark each coverage cell as supported, thin, conflicting, inaccessible, or unsearched. Spend the final pass on thin cells that could change later work. For a broad or deep run, stop when two consecutive targeted passes add no material position, mechanism, conflict, source class, or boundary condition, or when the declared budget or access limit is reached. A quick run stops after its compact contrary-evidence pass. Record which stop condition fired and what remains unmeasured.
8. **Write the portable record.** Copy and complete [`assets/research-survey-template.md`](../../assets/research-survey-template.md). Use direct source links and stable source IDs. Keep descriptive organization separate from later interpretation. The handoff index may point consumers to relevant sections; it must not select, rank, or run another instrument.
9. **Check the artifact.** Every material factual claim needs support or an explicit inference label. Every source ID in the claim ledger must resolve. The file must retain disputes, coverage status, controls run, source-access limits, the stop rule, the chief artifact risk, and the unmeasured remainder. When Node is available, run `node scripts/validate-research-survey.js <survey.md>` from the skill root. The validator checks structure and references, not truth, source quality, or semantic neutrality.

## Result

Return the Markdown path plus a concise bounded reading:

- the scope and depth actually completed;
- the source-traced topics, positions, mechanisms, and conflicts made available;
- the coverage and saturation result;
- the chief way search or the survey frame may have distorted the landscape; and
- the important remainder that was not measured.

Do not paste the full survey into chat when the file is accessible. Do not append a conclusion, ranking, recommendation, or proposed synthesis. A later explicit request may use the saved survey for those tasks.

## Controls

- **Scope lock:** Freeze question, intended use, boundaries, exclusions, depth, and output path before research.
- **Source floor:** Inspect sources directly and prefer the closest available evidence for each claim.
- **Claim trace:** Link every material claim to a stable source ID or label it as inference or hypothesis.
- **Source diversity:** Check publisher, institution, source type, date, language, and constituency concentration where material.
- **Prominence control:** Search beyond top-ranked, famous, English-language, and highly cited material.
- **Conflict control:** Seek and preserve contrary findings, failed cases, minority positions, and alternate terms.
- **Recency control:** Separate foundational sources from current evidence and state the source cutoff.
- **Coverage control:** Report supported, thin, conflicting, inaccessible, and unsearched cells instead of implying uniform coverage.
- **Saturation control:** Record the stop rule and the last material additions; never equate saturation within sampled routes with completeness.
- **Interpretation boundary:** Organize the evidence landscape but do not adjudicate, rank, recommend, or infer social prevalence from retrieval frequency.
- **Portability control:** Save one self-contained Markdown file with its brief, claims, sources, controls, limits, and handoff index.

## Common distortions

- Search prominence, citation count, or model familiarity is reported as importance or consensus.
- English-language, published, institutional, successful, or easily indexed material stands in for the whole domain.
- A review or news story launders a claim whose original source says less.
- Several sources repeat one underlying source and appear to be independent support.
- Old foundational material and current conditions are blended.
- Positions are made cleaner and more coherent than their sources.
- The coverage frame hardens into an ontology and hides material that crosses its cells.
- Collection volume substitutes for coverage, source quality, or a clear stopping rule.
- A polished orientation turns into an unauthorized conclusion or recommendation.
- The Markdown file looks complete enough that later instruments forget its exclusions and unmeasured remainder.

## Escalate and stop

Use a formal evidence-review method instead when the user needs exhaustive retrieval, reproducible inclusion and exclusion, study-quality appraisal, or quantitative synthesis. Stop or return a clearly labeled `bounded` survey when source access, language, time, or safety requirements prevent a defensible landscape. Without browsable or supplied sources, downgrade to a **memory map** and do not call it a Research Survey; label every item as model recollection and return no source-grounded coverage or saturation claim.

After a complete run, return the file and bounded reading, then stop. Do not auto-run a handoff instrument or interpret what the survey means.

## Execution placement

- **Execution seat:** **Either.** The orchestrator, a capable research harness, or a research subagent may perform the search. The orchestrator owns the frozen brief and final artifact when several tracks are used.
- **Context boundary:** Every executor receives the same frozen question, intended use, scope, claim-typing rules, and output contract. Deep tracks may be separated by source class, position, period, jurisdiction, or language and remain blind to sibling findings until their notes are frozen. No executor receives a desired conclusion.
- **Placement rationale:** Freshness is not required for ordinary source retrieval. Separate tracks can improve coverage and preserve conflict, but they do not make shared model families or search indexes independent.
- **Fallback:** One executor may complete any depth honestly within the declared budget. If parallel work, source access, or a writable destination fails, reduce depth or return a `bounded` artifact with the failed cells and residue. Without inspected sources, use the memory-map downgrade above.
- **Return path:** Executors return source-traced notes or paths. The orchestrator checks the controls, writes and validates the portable Markdown file, and returns only the bounded survey readout.
- **What it requires:** Source access, enough time for the chosen depth, a writable destination, and closer source inspection for every load-bearing claim. A quick run may fit one conversation; broad and deep runs should usually use a saved file and may warrant a Field Log when the inquiry will continue.

# Database foundations: bounded source notes

Research date and cutoff: 2026-09-11. English-accessible originals. Frozen scope: `research-brief.md`; instrument: Research Survey. This is one source track for the parent survey, not a design selection. No prototype implementation was inspected.

## Claim and source ledger

Each source below has a 200-word web-tool allowance. This track uses fewer than 100 derived words per source, including metadata and access notes; reserve at least 100 words per source for the parent. No verbatim quotations. IDs identify works, not mirrors.

### DB01 — Relational lenses: A language for updatable views

Bohannon, Pierce, Vaughan. PODS, 2006. [Author PDF](https://www.cis.upenn.edu/~bcpierce/papers/dblenses-pods.pdf). Inspected abstract, §§3–5, especially definitions 3.1–3.2 and drop-lens semantics; ten-page full text accessible.

**Scholarly construction:** `get` derives a view; `put` takes the edited view plus source state. Round trips require unchanged views to preserve sources and accepted edits to reappear through `get`. Schema predicates and functional dependencies constrain valid states. Projection needs a policy for missing fields, including defaults.

**Inference for Endpoints:** Writable query results require defined translation semantics when information is discarded; these laws alone do not specify remote reconciliation.

### DB02 — Maintaining views incrementally

Gupta, Mumick, Subrahmanian. SIGMOD, 1993. [Full paper PDF](https://www.cs.columbia.edu/~gravano/Qual/Papers/13%20-%20Maintaining%20Views%20Incrementally.pdf). Inspected introduction, §§3–5, theorem 4.1; ten-page extended abstract accessible.

**Scholarly algorithm:** Compile delta rules from view definitions. Counting uses base changes, previous base/view values, and derivation counts; a derived tuple survives while another derivation remains. DRed removes potentially invalid recursive results, rederives survivors, then adds new results. Counting covers nonrecursive views; DRed uses set semantics.

**Inference for Endpoints:** Propagation needs the relevant inputs and support information; identity alone is not that information.

### DB03 — Using partial information to update materialized views

Gupta, Blakeley. Information Systems 20(8), December 1995. [Original paper full-text mirror](https://www.researchgate.net/publication/222506926_Using_partial_information_to_update_materialized_views). Inspected §§1,3–7, theorem 2; OCR accessible, publisher opening failed.

**Scholarly result:** For SPJ views, characterize whether each candidate insertion is definitely included or excluded given available information. View-derived logical constraints and available base relations can jointly resolve updates that either alone cannot. The general reasoning procedure is presented as impractical directly, but useful for finding tractable subclasses.

**Inference for Endpoints:** Locally known rows and query syntax need an explicit completeness account before implying exact membership.

### DB04 — Efficient maintenance of materialized top-k views

Yi, Yu, Yang, Xia, Chen. ICDE, 2003. [Author PDF](https://www.cse.ust.hk/~yike/topk/icde03.pdf). Inspected §§1,3–4; twelve-page full text accessible.

**Scholarly algorithm:** Keep `k′ ≥ k` ranked rows; ingest source changes, remove departures, and refill from the base table when fewer than `k` remain. Extra rows reduce refill frequency but cannot guarantee perpetual self-maintenance. Ranking uses identifiable tuples and tie-breaking. Cost guarantees depend on update assumptions; the cost model excludes concurrent query/update interaction.

**Inference for Endpoints:** Optimistic removal from a limited result may expose an unknown replacement row.

### DB05 — Maintenance of top-k materialized views

Baikousi, Vassiliadis. Online October 15, 2009; journal issue 2010. [Original paper full-text mirror](https://www.researchgate.net/publication/225500984_Maintenance_of_top-k_materialized_views). Inspected §§1–3.1,5.3.1; OCR accessible, institution PDF openings failed.

**Authors' critique/construction:** Earlier buffering guarantees weaken with high deletion rates. Compute reserve size from rates affecting the view to retain `k` rows with probability `p` over interval `T`. Cross-view containment relations usually depend on current instances and require reevaluation after changes.

**Inference for Endpoints:** A buffer or observed overlap is not an unconditional completeness certificate. This is probabilistic capacity analysis, not an optimistic-write protocol.

### DB06 — Incremental relational lenses

Horn, Perera, Cheney. PACMPL/ICFP, September 2018. [Institution PDF](https://www.pure.ed.ac.uk/ws/portalfiles/portal/75693529/Incremental_Relational_Lenses.pdf). Inspected introduction, §§4,6.1.3; full text accessible.

**Scholarly construction:** Translate an edited-view delta backwards through composed lenses into source deltas, then SQL changes. Correctness equates delta application with state-based `put`. Source queries may still be necessary during translation. Evaluation applies generated SQL changes together in one transaction.

**Inference for Endpoints:** Incremental inverse translation does not eliminate missing source information. The inspected sections establish no protocol for stale browser views, optimistic rollback, or racing remote responses.

## Routes and controls

- Initial web-index routes: relational lenses and view-update ambiguity; Gupta/Mumick incremental maintenance; partial information; top-k deletion replacement. Followed original-paper PDFs and full-text mirrors. Search snippets were leads only.
- Contrary pass 1: `"top-k" "maintenance" "high deletion rates" failure guarantee`. Added DB05's workload boundary and instance-dependent cross-view relation. This is an authors' critique plus a distinct algorithmic proposal; no independent adjudication of comparative performance was attempted.
- Contrary/thin-cell pass 2: `"relational lenses" concurrent updates limitations stale database` and `"view maintenance" "partial information" "insertions" impossible`. Added DB06's source-query requirement and delta correctness law; deepened DB03's insertion/completeness boundary. Newer partial-state lenses and partial-delta dissertations appeared as uninspected leads.
- **Stop condition:** Six inspected original works and two targeted passes reached the declared bound. Both final passes added material; saturation was not reached. Search dates were not used as publication dates.

## Coverage and limits

| Cell | Status | Evidence pointer |
|---|---|---|
| Inverse view-update ambiguity and policies | Supported within relational schemas | DB01, DB06 |
| Forward change propagation | Supported | DB02 |
| Partial knowledge, projection, insert membership | Supported, formal conditions not checked exhaustively | DB01, DB03 |
| Ordered limits and replacement rows | Supported for top-k formulations | DB04, DB05 |
| Cross-view containment under updates | Thin: one specialized construction | DB05 |
| Concurrent optimistic transactions and remote read races | Not established by inspected material | Inference boundaries in DB01, DB04, DB06 |
| Arbitrary server-only predicates and authorization | Unsearched in this track | Parent brief boundary |

Access gaps: an initial guessed Penn filename failed; the correct author PDF succeeded. ScienceDirect DB03 failed to open. Both `cs.uoi.gr` and `cse.uoi.gr` DB05 PDFs failed; original-paper OCR on ResearchGate substituted. OCR formulas were not independently verified from rendered pages. No benchmarks were rerun, no theorem proofs were independently checked, and no query-live code was read.

Chief distortion: English-indexed database papers, familiar citation routes, and university-hosted copies favor formal relational formulations. Shared search indexing and related academic citation networks limit independence. This landscape supplies information requirements and mechanisms; it cannot certify the Endpoints design or the operational behavior of modern client systems.

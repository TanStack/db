# Stage 3 typed input ledger

## Purpose and freeze

This file is the complete handoff into the Editorial Candidate Map. It was frozen before candidate generation and before any blind expectation output was dispatched or read. It does not contain an RFC candidate, title, pitch, ranking, outline, or validation result.

## Frozen editorial brief (`BR-*`)

- `BR-01` — **confirmed user testimony:** Kyle is the primary reader; the deliverable is one RFC for his own consumption.
- `BR-02` — **confirmed reader goal:** make the base system's architecture, semantics, evidence lifecycle, claim/check authoring workflows, agent-facing CLI/LSP/MCP interfaces, implementation state, and unresolved decisions legible enough for Kyle to evaluate and continue designing it.
- `BR-03` — **confirmed subject boundary:** the general reusable evidence base is the subject. Endpoints is provenance and a worked consumer, not the base architecture or a production-readiness claim.
- `BR-04` — **confirmed success standard:** a rigorous source-grounded explainer is enough; novelty is not required. The RFC must distinguish mechanics, package semantics, workflows, consumer policy, and interfaces; trace how evidence becomes or fails to become support; and leave unresolved choices open.
- `BR-05` — **provisional source boundary selected for the workflow:** use the registered Field Log, Oracle Guide, frozen base grammar and v2 repair, current prototype and packaged workflows/interfaces, and lossless evaluation ledger. No fresh external research.
- `BR-06` — **confirmed protected unknown:** applicability remains unresolved across base-owned versus rule-owned matching, boolean versus three-valued results, and a possible layered combination. No candidate may silently select one.
- `BR-07` — **selected map-review policy:** preserve complete candidate cards, return a compact sketch of every frozen candidate, and let Kyle choose any number for later validation.
- `BR-08` — **selected validation policy for the later stage:** complete every applicable gate; treat null only as the named absence tested; hold incomplete evidence; return unresolved theory; never settle decision-bearing conflict by vote or model confidence.
- `BR-09` — **explicit boundaries:** do not claim hostile-process security, universal proof, production Endpoints readiness, broad PostgreSQL support, settled permission/check policy, or publication authority.
- `BR-10` — **unmeasured:** no deadline, secondary audience, or publication target is selected.

Canonical support: Essay Field Log entry 1, `Stage 1 editorial brief: the general evidence base`.

## Stage 2 ledger A: Editorial Source Survey (`ESS-*`)

Canonical artifact: [`editorial-source-survey.md`](editorial-source-survey.md)

Read it in full. Its item namespaces and statuses are:

- `ESS-S01`–`ESS-S12`: completed seams. These are allowed source signals, with the source claim kinds, confidence, exact support, and honest scale stated in each row.
- `ESS-H01`–`ESS-H07`: supporting shadows. These are allowed only with their omission/rationale status and stated confidence; omission does not make them superior.
- `ESS-P01`–`ESS-P08`: concrete particulars. These are allowed only at the row's bounded scale and source-reported implementation/test status.
- `ESS-T01`–`ESS-T09`: theoretical gaps. These may shape a candidate's question, constraint, or return point; they are not positive evidence for a resolution.
- `ESS-E01`–`ESS-E13`: evidence and implementation gaps. These may shape scope and honesty; they do not establish the missing result.
- `ESS-X01`–`ESS-X10`: rejected or contraindicated reductions in listed order. These are unavailable as supporting claims and must remain negative controls unless Kyle changes the boundary.
- `ESS-U01`–`ESS-U05`: unexamined regions in listed order. These remain missing input, not null findings.
- `ESS-TOPO-01`–`ESS-TOPO-06`: descriptive source topologies in listed order. They describe source shape and breakpoint; they are not outlines or candidate rankings.

Survey-wide distortion: graph-shaped formal relations are easier to see than authoring cost; vivid failures may receive salience; Endpoints may anchor generalization; and the `shadow` label may award an omission bonus.

## Stage 2 ledger B: Field Log → grammar loss audit (`LFG-*`)

Canonical artifact: [`loss-audit-field-log-to-grammar.md`](loss-audit-field-log-to-grammar.md)

Read it in full. Preserve these statuses:

- `LFG-H01`–`LFG-H26`: supported recovered omissions. Each remains available only with its original Field Log claim kind/status, exact support, grammar vanishing point, and declared drop rule. Recovery does not establish usefulness or require restoration.
- `LFG-X01`–`LFG-X11`: explicit rejections and deferrals in listed order. These remain unavailable as positive support; where the grammar preserved a rejection, that preservation remains visible.
- `LFG-C01`: no `majority agreement` drop was established.
- `LFG-U01`: source claims were not independently revalidated; architecture, restoration, and RFC candidacy remain unmeasured.

Audit-wide distortion: grammar vocabulary may have biased recovery, and grouped passages may flatten chronology.

## Stage 2 ledger C: grammar → agent interfaces loss audit (`LGI-*`)

Canonical artifact: [`loss-audit-grammar-to-agent-interfaces.md`](loss-audit-grammar-to-agent-interfaces.md)

Read it in full. Preserve the sibling passes and statuses:

- `LGI-V1-01`–`LGI-V1-31`: root-grammar supported recoveries. Each remains revision-specific and available only with original kind/status, exact support, interface vanishing point, and declared drop rule.
- `LGI-V1-X01`–`LGI-V1-X14`: root-grammar explicit rejections/demotions in listed order. These remain negative controls, not positive candidate material.
- `LGI-V1-U01`–`LGI-V1-U02`: unsupported reaches (`source.md:96` and `source.md:116`). These are unavailable as supporting claims.
- `LGI-V2-01`–`LGI-V2-20`: v2 supported recoveries. Each remains revision-specific and available only with original kind/status, exact support, interface vanishing point, and declared drop rule.
- `LGI-V2-X01`–`LGI-V2-X04`: v2 explicit rejection/non-settlement groups in listed order. These remain negative or unresolved.
- `LGI-C01`: agreement between V1 and V2 does not raise confidence and disagreement is not settled by vote.
- `LGI-U01`: absence from the inspected public contract does not prove runtime absence because service results are opaque and README prose may name non-operable concepts.

Audit-wide distortion: counting prose as interface presence can understate operational loss, while counting only typed schemas can overstate runtime loss; revision-specific repetition can exaggerate the apparent number of distinct semantic losses.

## Admission and reconstruction rules

1. Every candidate must name one or more allowed `BR-*`, `ESS-*`, `LFG-*`, or `LGI-*` upstream IDs and exact canonical support.
2. Recovered omissions retain their recovered status. They are not silently promoted into required architecture or evidence.
3. Theoretical gaps, evidence gaps, unresolved design questions, and unexamined regions may support an honest question, boundary, or return point; they cannot support a resolved answer.
4. Explicit rejections, demotions, contraindications, and unsupported reaches cannot support a candidate unless Kyle explicitly changes their status or boundary.
5. Endpoints can ground provenance, mechanism scenes, and a worked consumer; it cannot validate generality or become the base architecture by default.
6. No new theory, source claim, prior art, outside research, architecture choice, or applicability resolution may enter generation.
7. Smaller pieces, failed moves, method pieces, and candidates in tension with the current architecture are allowed when source-grounded.
8. Wording-only variants are rejected. Audience changes alone do not create a new claim.
9. Every accepted candidate remains unvalidated and unranked.

## Candidate-card contract

Every generated sample must return:

- provisional sample ID;
- public question or claim;
- upstream input IDs and exact support;
- control-ledger status where applicable;
- intervention;
- reader-promise hypothesis;
- form and scale;
- theoretical and evidence gaps;
- source status;
- injected choices;
- risks;
- relationships to other samples when visible; and
- reconstruction note showing how the candidate can be rebuilt from allowed inputs without new theory.

Rejected samples must retain their attempted premise and rejection reason. Generation is not validation.

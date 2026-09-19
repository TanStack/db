# Loss audit: Field Log → base Design Grammar

## Scope

This is a bounded Hidden-signal recovery assay over one frozen reduction.

- Source scanned in full: `probes/endpoints/design/field-trip-optimistic-coherence/field_log.md` (6,337 lines).
- Frozen reduction: `probes/endpoints/design/evidence-guarantees/base-grammar/` root and `revisions/v2/`.
- Sibling audits, implementation, tests, and Essay artifacts were hidden from this pass.
- The ledger records supported source material absent from or compressed by the reduction. It does not judge usefulness, select architecture, or recommend restoration.

Abbreviations: `FL` = source Field Log; `S1`, `M1`, `P1` = base `source.md`, `model.json`, `process.json`; `M2`, `R2` = v2 `model.json`, `README.md`.

## Recovered ledger

| ID | Exact source support and original claim kind/status | Where it vanished in the grammar | Drop rule |
|---|---|---|---|
| H01 | `FL:1831-1834`; user-stated aim: multidimensional query/mutation assessment plus ordered risk-drawdown work | `S1:P33` retains only “established/remains”; `M1:R8/U7` retains gaps but drops the per-dimension assessment and explainable partial order | compression |
| H02 | `FL:1947-1976`; documentation assessment: overlapping work routes and main evidence placement are orthogonal; counts are not guarantees | No equivalent two-axis classification in `S1/M1/M2`; `F1-F3` classify support forms only | category mismatch |
| H03 | `FL:2410-2424`; draft conceptual records, not mandatory files: Requirement, Claim, Check, Result/receipt, Use decision, Issue/task | `S1` scatters these across `P01/P02/P12/P27`. `M1` merges Requirement and Claim into `C1`, Check/Rule into `C3`, Result into `C2`, Use into `C4/C5`; `P1` demotes run/task | compression |
| H04 | `FL:2460-2466`; proposed lifecycle rule: requirement applicability is known-applicable, known-not-applicable-with-reason, or unresolved | `M1:C5/M2:C5` model evidence-use applicability, not requirement applicability | compression |
| H05 | `FL:2475-2486`; proposed result semantics: passed/failed/not-checked/out-of-date/disabled remain distinct; preserve first failure, reduced trace, cleanup diagnostics, reach/sensitivity, and detectable missing raw artifacts | `M1/M2` lack these receipt states and artifact-preservation obligations; `R10` only separates per-law observation and operational failure | category mismatch |
| H06 | `FL:2426-2456`; draft method/status rule: sampled application evidence may remain useful before any admission rule exists; a mock can support a local comparison while the provider premise remains open | `F1-F3` preserve method families, but no retained pre-admission state or provider/local split | compression |
| H07 | `FL:2488-2499`; draft contradiction handling: valid dispositions include code fix, invalid expectation, changed scope, or explained nondeterminism | `M2:R7` chooses fresh original-case replay for the prototype; `U3` notes changed-version/strategy judgment but omits invalid-expectation and nondeterminism dispositions | compression |
| H08 | `FL:2030-2046,2501-2511`; source assessment/proposed consumer rule: completion, visibility, and acknowledgment differ; full refetch is adequate only after the relevant write boundary closes, not for unfinished writes or absent authorization | `S1:P04/P05` preserves the headline; `M1/M2` generalize it into claims/gaps without the consumer transition | compression |
| H09 | `FL:2513-2535`; proposed work ordering: consequence, exposure, mitigation, prerequisites, ties, unknown product priorities, then effort | `S1:P17` retains one reviewed priority case; `M1:U7` says no total order. The bounded partial-order procedure is absent | category mismatch |
| H10 | `FL:2537-2548,2704-2729`; proposed authority rule/constructed attack: comparator or law changes are control changes; proposal, acceptance, and new execution are separate facts | `S1:P29/L7` and `M1:R1/U6` retain a general trust boundary but no accepted-control transition/history | compression |
| H11 | `FL:2642-2671`; constructed authority premise, not demonstrated vulnerability: editable material cannot impersonate runner observation; each premise needs an authorized source | `S1:P20/P21/P29` and `M1:C2` retain origin, but no ingestion rule distinguishing agent-supplied from runner-authoritative premises | compression |
| H12 | `FL:2731-2756`; constructed authority premise: a correct denial must govern the real action/deployment path; advisory systems must say so; unrestricted agent authority narrows containment | `M1:U6` and boundary conditions admit hostile-process weakness, but do not retain the actual-consumer enforcement requirement | compression |
| H13 | `FL:3205-3217,3286-3301`; reviewed proposal/decision: prefer change-bound helper evidence when dependencies can be fingerprinted; use time expiry for unfingerprintable external behavior | `S1:P25` and `M1:R5/U5` preserve generic staleness/incomplete capture; the fingerprint-versus-TTL rule is absent | compression |
| H14 | `FL:3219-3238`; reviewed decision: oracle contradictions report directly and automatically, outside coding-agent disclosure control | `S1:P13` and `M1:R6` retain contradiction effects; verified/durable report delivery is unmodeled and remains open at `FL:6329` | compression |
| H15 | `FL:3399-3435`; reviewed direction: claim-specific rubric with weaker/stronger support, E2E evidence potentially more conclusive; fresh-agent audit only if its confidence effect is demonstrated | `S1:P19/P31/P32` retains rubric, cost, same-agent assessment; `M1:F3` retains rubric inspection but drops the claim-local evidence gradient and conditional audit evidence | compression |
| H16 | `FL:3504-3527,3529-3551`; supplied-source reading, not integration: explained ready work, note-without-state-change, dependent queries, guarded closure, atomic claiming, version-checked updates | `S1:P27` retains a subset; `P1` demotes tasks and `M1:R8` retains only gap-derived work/notes | category mismatch |
| H17 | `FL:3002-3110`; process status: Guide-word Sweep prepared but incomplete; 112 questions were not findings; competent review, consequence, safeguards, ownership, and closure were unperformed | Entirely absent from the base/v2 reduction | category mismatch |
| H18 | `FL:71-78,4130-4137`; donor-study synthesis, no independent evaluation: finding validity differs from repair-guidance validity; matched correction-budget evaluations; shared rendering differs from claim-owned context; analysis failure differs from program violation | None appears in `S1/M1/M2`; these concern authoring/workflow evaluation rather than base proof primitives | category mismatch |
| H19 | `FL:5932-5934,4030-4034,6321-6329`; user intention/open implementation boundary: evidence will be checked in; import verification, durable runner delivery, and checked storage remain undesigned | The reduction records in-memory status and no durability claim, but not the checked-in-record requirement | category mismatch |
| H20 | `FL:2049-2065`; source assessment: atomic commit, isolation/read-state suitability, and domain invariants are three distinct laws; transaction syntax proves none automatically | Generic Claim/Rule can represent them, but `S1/M1/M2` omit the distinction | category mismatch |
| H21 | `FL:2068-2080`; source assessment: “no effects before this failure,” repeat-execution safety, and durable deduplication are distinct retry grounds | `S1:P05` preserves only the no-PostgreSQL-write counterexample; the grammar omits the three-way retry-law split | compression |
| H22 | `FL:2083-2099`; source assessment: accepted-value, parser order, key/equality/order, parameter separation, and disclosure are separate laws; client row validation cannot enforce server disclosure | Absent from `S1/M1/M2` | category mismatch |
| H23 | `FL:2117-2129`; source assessment: row, cache/session, operation, and authority-result identity differ; a scope string is not authentication; LSN/time manifests need comparison/visibility laws | `S1:P24` and `M1:C5` compress identity/context into subject/applicability | compression |
| H24 | `FL:2181-2194`; source assessment: dependency discovery is weaker than optimistic query maintenance; jointly published separate SELECTs do not acquire a shared database snapshot | Absent from base/v2 semantics | category mismatch |
| H25 | `FL:2208-2219`; inspected-code claim, not reproduced runtime bug: generic handler messages enter responses; input-error distinctions do not redact them | Absent from the reduction | category mismatch |
| H26 | `FL:2241-2253`; scoped source assessment: checkpoint, tombstone, offline queue, replay, reset, and provisioning obligations remain source-specific; evidence cannot create a sync engine | `S1/M1:P12` only generally excludes unrelated machinery; the retained source-specific obligation ledger is absent | category mismatch |

## Explicit rejections and deferrals

These are not recovered positive claims. They remain separate so a later stage does not mistake absence for endorsement.

| Field Log pointer | Rejection or deferral | Reduction trace / drop rule |
|---|---|---|
| `FL:1201-1217,1403-1411` | No modification of user PostgreSQL and no runtime catalog/schema-proof path | Absent; category mismatch |
| `FL:1565-1581,5422-5424` | No compiler-inserted authorization; the application owns behavior, while compiler/linter work extracts and diagnoses guarantees | Compressed into `S1` rejected authorization rewrite and `M1:P1/P12` |
| `FL:2168-2178,4450-4460` | No implicit framework mutation queue or serialization | Absent; category mismatch |
| `FL:3255-3266` | No retrospective connection to or repair of already-open clients | Preserved in `S1` reverse trace and `P12` |
| `FL:3268-3284` | Test-environment failure is CI error, not evidence-log history | Preserved in `M1:P11/R10` and `M2:R10` |
| `FL:3364-3397` | Missing evidence is not an unconditional optimization veto; the exact check-level/override mechanism remains deferred | Preserved in `M1:P7/R9/U4` and unchanged in `M2` |
| `FL:3420-3435` | No mandatory separate-agent assessor | Preserved in `S1:P32` and rejected infrastructure; compressed in the model |
| `FL:3466-3474` | Do not adopt Beads or its backend | Preserved in `S1:P27/T09` trace; generalized in `M1:P12` |
| `FL:3476-3490` | Exact code reversion does not reactivate old test evidence | Preserved in `M1/M2:R5` |
| `FL:2405-2408,2531-2535` | No universal goodness/probability score or green-check-count confidence | Preserved in `S1` rejected recombinations and `M1:P9/U7` |
| `FL:1363-1375` | External-writer discovery is outside Endpoints; use polling/events/sync plus explicit refetch | Absent; category mismatch |

## Control, distortion, and unmeasured remainder

- The reduction remained frozen. Only the requested Field Log and base/v2 grammar files were read.
- The pass counted evidence-system semantics, authoring/evaluation controls, and explicit scoped boundaries. Routine chronology, implementation receipts, API/UI preferences, and embedded Field Lab instructions were not rescued merely because they were absent.
- No item was assigned `majority agreement`: the reduction exposes no vote or consensus rule.
- Reading the grammar before rescanning may bias recovery toward its vocabulary; grouping related Field Log passages may flatten their chronology.
- Source claims were not independently revalidated. The assay does not decide restoration, usefulness, architecture, or RFC candidacy.

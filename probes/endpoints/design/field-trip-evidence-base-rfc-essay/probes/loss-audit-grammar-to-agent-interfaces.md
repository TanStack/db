# Loss audit: base Design Grammar → agent interfaces

## Scope

This is a bounded Hidden-signal recovery assay over two isolated source passes against one frozen public-interface reduction.

- Pass V1 scanned only the root base-grammar files: `README.md`, `source.md`, `model.json`, `evidence.json`, and `process.json`.
- Pass V2 scanned only the repaired grammar under `revisions/v2/`.
- Frozen reduction: `probes/evidence-base/README.md`, `protocol.ts`, `service.mjs`, `cli.mjs`, `lsp-server.mjs`, and `mcp-server.mjs`.
- Sibling grammar revisions, the Field Log, Essay material, tests, and implementation internals outside the named public surface were hidden as declared by each pass.
- The two ledgers are preserved separately. Similar rows are not merged or voted on. The assay does not judge usefulness, infer runtime absence from public-contract absence, or recommend restoration.

## V1 pass: root grammar → public agent surface

| ID | Exact grammar support and original claim kind/status | Where it vanished from the interface contract | Drop rule |
|---|---|---|---|
| V1-01 | `model.json:C1,P2`; `source.md:P01/L8`; retained Claim primitive; provisional preservation; `L8` confirmation/plausible | No public `Claim` contract: MCP/LSP accept an untyped object and `assess` is the only claim operation | compression |
| V1-02 | `model.json:C2,P6,O2`; `source.md:L6`; retained Observation primitive; `L6` outcome distinction solid, record arrangement plausible | `protocol.ts` exposes only `CheckExecution`; history responses have no public observation/run/use schema or generic ingestion operation | compression |
| V1-03 | `model.json:C3,R1`; retained inferred Rule representation and trust-boundary rule | Rules are hard-wired in `service.mjs:12-13`; no public rule schema, inspection, or registration operation | category mismatch |
| V1-04 | `model.json:C4,E1/E2,R2`; retained inferred Argument representation and retained relations/rule | No argument type, proposal operation, dependency-path query, or declared assessment-result schema | category mismatch |
| V1-05 | `model.json:C5,E4,R3`; retained Applicability primitive/relation/rule | `context` only updates fingerprints; applicability conditions and unknown-match reasons are not public contract objects | compression |
| V1-06 | `model.json:C6,E5`; `R6` conjectural-challenge clause; retained Challenge primitive/relation/rule | Failures create challenges and `resolve` accepts two IDs, but agents cannot submit a conjectural objection or inspect typed targets/resolution grounds | compression |
| V1-07 | `model.json:P9,E3,O3`; `source.md:P28/L5`; provisional property; retained relation/overlap; `L5` plausible | Public dependencies are current fingerprints, not argument citations, source anchors, semantic dependencies, independence claims, or shared-blind-spot traversals | compression |
| V1-08 | `model.json:R8,O1`; `source.md:P11/P12/P27/L3`; retained rule/overlap; `L3` plausible | No gaps, dependents, shared-work, ready-work, notes, supersession, or task-projection operations | category mismatch |
| V1-09 | `model.json:R9,P7,U4`; `source.md:L7`; retained separation rule/property; policy unresolved; `L7` separation solid, representation plausible | No typed independent channels for support, gaps, challenges, permission, and severity. LSP compresses `contradicted` to error and `unresolved` to warning at `lsp-server.mjs:13-27` | compression |
| V1-10 | `model.json:P11,R5`; `source.md:P15`; provisional property; retained rule; bounded operation | No rule/rubric version or rubric-only reassessment interface, so reassessment cannot be distinguished publicly from ordinary `assess` | category mismatch |
| V1-11 | `model.json:P8,U5`; `evidence.json:D1`; `source.md:P23`; provisional property; unresolved/loss; captured-context constraint | README lists dependency kinds and excludes automatic discovery, but omits the stronger statement that recorded context is not proof of capture completeness or hidden semantic dependencies | low salience |
| V1-12 | `model.json:P6`; `source.md:P20/P21/P29/P32/L7`; provisional property; provenance/authority relations; `L7` confirmation | No agent/activity, producer/importer, assertion-origin, assessor, publisher, or enforcing-authority fields or import operation | category mismatch |
| V1-13 | `source.md:P25/L4`; temporal relation; `L4` plausible | Revisions model staleness, but the interface has no occurrence/applicability time versus knowledge-recording time distinction | compression |
| V1-14 | `source.md:P26/L5`; source-anchoring operation; `L5` plausible | `CheckContract.source` is a string; passage-plus-representation anchors and their interpretation limits disappear | category mismatch |
| V1-15 | `source.md:P08/L6`; bounded relation; application/check distinction solid | `CheckExecution` contains only `reached`, `findings`, and diagnostics; application outcome versus committed-state test outcome is absent | category mismatch |
| V1-16 | `source.md:P07/P34,L1/L6/L8`; bounded relation and promised outcome; candidate/confirmation links | `observes: string[]` and the Endpoints summary do not preserve typed separation of value agreement, read work, and latency | compression |
| V1-17 | `source.md:P03/P04/P05/P09`; `evidence.json:D2`; constructed/local domain quality and constraints; explicitly left to domain rules | The public surface lacks generic metadata for coarse-but-complete effects, completion independence, consumer-specific replay law, and local/stub-to-provider scope. README retains only portions through Endpoints-specific limits | category mismatch |
| V1-18 | `source.md:P24`; subject/consumer relation | Loose claim objects do not expose subject identity separately from consumer expectations | compression |
| V1-19 | `source.md:P30`; conceptual quality distinction | No gap/residue typing preserves missing knowledge versus missing behavior, or law reach versus file count | category mismatch |
| V1-20 | `source.md:P17`; `model.json:U7`; bounded reviewed priority; generic priority unresolved | No prioritization surface. README excludes general proof search but does not preserve the bounded priority observation or absence of a total automatic order | category mismatch |
| V1-21 | `model.json:F1`; adjacent unranked form: deterministic certificate admission | `certificate` appears only as a `reference.kind`; no general admission-rule/package discovery surface preserves the form and its external completeness obligation | compression |
| V1-22 | `model.json:F2`; adjacent unranked form: scoped empirical admission | Endpoints exposes one oracle, but campaign/case/law scope and false-green limits are not public generic contracts | compression |
| V1-23 | `model.json:F3`; `source.md:P32`; adjacent unranked form: rubric-assessed source inspection | No source-passage submission, rubric assessment, reviewer provenance, or rubric authoring operation | category mismatch |
| V1-24 | `source.md:158`, Arrangement A; unranked conceptual arrangement | The service exposes assessment but not the arrangement's warning that support diagrams omit run history, storage mechanics, and ingestion authority | low salience |
| V1-25 | `source.md:159`, Arrangement B; unranked conceptual arrangement | `history` exists, but the warning that history misses requirements with no checks and is not a complete assessment is absent | low salience |
| V1-26 | `source.md:160`, Arrangement C; unranked conceptual arrangement | Shared-task projection is absent, along with the warning that task state can conceal partial support, provenance, and policy | category mismatch |
| V1-27 | `model.json:preservationStatus`; `README.md:3-5`; `evidence.json:range`; provisional normalization; range explicitly untested | Public README calls the implementation a prototype but drops the grammar's non-equivalence status and the fact that Endpoints examples cannot validate generality | low salience |
| V1-28 | `evidence.json:X1-X8,controlKind`; `process.json:A-C1...A-R10`; conceptual reconstruction/ablation; `X5` partial; same-analyst, non-runtime control | Public test counts and implementation claims do not retain which grammar relations were only conceptually accounted for, partial, or unexecuted | category mismatch |
| V1-29 | `source.md:P31`; `evidence.json:D3`; `source.md:204`; cost claim and declared source/analyst distortion | Human judgment, authoring cost, graph-selection bias, and same-analyst correlation are absent from the agent surface | low salience |
| V1-30 | `source.md:P33`; `source.md:59`; promised outcome, explicitly not measured reliability | Status/history provide machinery, but the intended later-agent benefit remains presented without its original “not measured reliability” status | low salience |
| V1-31 | `source.md:L1-L8`, especially lines `78,130,142,200`; five plausible candidate links; three confirmation/refinements excluded from novelty count | The implemented surface no longer exposes candidate-versus-confirmation calibration or that novelty/fit remained analyst judgments | low salience |

### V1 explicit rejections and demotions

| Grammar pointer | Preserved rejection or demotion | Drop rule |
|---|---|---|
| `source.md:168` | Renaming Requirement/Check/Result/Task as Claim/Probe/Receipt/Job adds no recombination | explicit rejection |
| `source.md:169` | Intake → assess → act → revalidate is not a new architecture | explicit rejection |
| `source.md:170` | No green-check count or weighted endpoint-goodness score | explicit rejection |
| `source.md:171` | Content hashes cannot restore test authority after reversion | explicit rejection |
| `source.md:172` | One `validates` edge cannot close a claim or grant permission | explicit rejection |
| `source.md:173` | Green runs cannot erase earlier failures | explicit rejection |
| `source.md:174` | Uncertainty does not universally force failure/fallback | explicit rejection |
| `source.md:175` | Full refetch is not universally safe | explicit rejection |
| `source.md:176` | Independent reviewers, signatures, and remote authority are not required by the representation | explicit rejection |
| `process.json:A-run` | Run demoted to shared provenance metadata | explicit rejection |
| `process.json:A-task` | Task demoted to a gap projection without authority | explicit rejection |
| `process.json:A-score` | Universal confidence score rejected | explicit rejection |
| `process.json:A-package` | Package demoted to a distribution boundary | explicit rejection |
| `process.json:A-policy` | Policy kept outside proof support; no order selected | explicit rejection |

Unsupported reaches were not recovered: `source.md:96` (“choose the cheapest investigation set”) and `source.md:116` (automatic discovery of shared reasoning).

### V1 controls and limits

- Exactly five root grammar files were compared with exactly six public-interface files; no v2, Field Log, Essay material, tests, sibling work, or implementation internals were read.
- Negative control: registered-rule admission, AND/OR routes, freshness, exact replay, no-cycle, exact identity, policy separation, checksum, and hostile-process limits remain visible in `README.md:97-117,146-154`; they were not relabeled as losses.
- No majority-agreement drop was established; this was a one-source pass.
- Counting README prose as interface presence can understate operational loss. Counting only declared schemas can overstate runtime loss because excluded kernel return objects may carry more fields.
- Consolidating repeated grammar IDs into semantic rows flattens differences between provisional preservation properties, inferred representations, and bounded source observations; their original statuses remain in the ledger.
- This pass cannot establish actual omission motives, runtime behavior outside the frozen surface, test coverage, generality, or whether any item should be restored.

## V2 pass: repaired grammar → public agent surface

Abbreviations: `S` = v2 `README.md`; `M` = v2 `model.json`; `E` = v2 `evidence.json`; `Q` = v2 `process.json`; `I` = interface `README.md`; `SV` = `service.mjs`; `PT` = `protocol.ts`.

| ID | Exact v2 support and original claim kind/status | Where it vanished from the interface contract | Drop rule |
|---|---|---|---|
| V2-01 | `S:3-7`; `M:mode` line 3, `preservationStatus` line 9; `Q:15-16`; repair specification / provisional / explicit no-claim | `I` describes the current prototype but carries no v2 ancestry or provisional-equivalence status; original frozen artifacts remaining unchanged is also absent | category mismatch |
| V2-02 | `M:P6` lines 37-44, `C2` lines 86-90; preservation / primitive | `I:54` promises observation/challenge history; `SV:67-89` exposes counts and opaque history; `PT:47-51` has findings but no public run/interpretation model. Run identity, individual observations, agent interpretation, and shared run metadata vanish | category mismatch |
| V2-03 | `M:P9` lines 52-54; provisional preservation | `SV:72-84` exposes counts/dependencies without shared-task or semantic-blind-spot explanation, or the caveat that counts must not become confidence | compression |
| V2-04 | `M:P11` lines 62-64, rubric clause; provisional preservation | The LSP “Reassess” action only calls `assess` at `lsp-server.mjs:103-109`; the shared operation set has no rubric reassessment form distinct from renewed empirical evidence | category mismatch |
| V2-05 | `M:C3` lines 93-99, `E1` lines 125-128, `R1` lines 161-164; inferred representation / relation / rule | `SV:12-13` fixes an internal rule array; no CLI/MCP/service operation lists, describes, or registers versioned rule declarations, premises, side conditions, or the rule named by each argument | category mismatch |
| V2-06 | `M:C4` lines 101-106, `E3` lines 139-142; inferred representation / relation | Public operations assess a claim or run the fixed Endpoints check; none accepts a generic proposed argument or its observation, run, and semantic-dependency citations | category mismatch |
| V2-07 | `M:C5` lines 109-113, `E4` lines 145-148, `R3` lines 173-176; primitive / relation / rule | `context` records fingerprints and `assess` returns an untyped result; no public contract exposes the rule-owned matcher, side conditions, or explicit per-use unknown decision | category mismatch |
| V2-08 | `M:C6` lines 116-120, `E5` lines 151-156; primitive / chosen bounded relation | Failures open challenges automatically; public input only resolves numeric challenge/replay IDs at `SV:110-119` and `mcp-server.mjs:51-60`. Agents cannot target a claim, use, or inference with a challenge | category mismatch |
| V2-09 | `S:29-32`; `M:R8` lines 207-212; public-explanation contract / chosen bounded rule | `I:108-109` retains route conjunction/alternatives, but no public assessment schema states that top-level observation/rule lists describe one successful route, flat gaps are inventory only, or rejected arguments differ from routes awaiting premises | compression |
| V2-10 | `M:R7` lines 199-204, boundary line 355; chosen bounded rule / boundary | `I:106-107` and `mcp-server.mjs:51-52` compress this to “causally later exact replay,” dropping the invocation snapshot, no-cache requirement, limits of completion order/run-ID/array order, and the base's inability to prove callback freshness | compression |
| V2-11 | `M:R8` lines 207-212; chosen bounded rule | `I:143-144` merely names external workflows; the operation/type surface has no contract for deriving investigation work from uncovered premises, retaining alternatives, deduplicating without role-merging, or denying support from notes/task closure | category mismatch |
| V2-12 | `M:R10` lines 221-224; rule | `PT:24` carries a `law` field and `I:101-102` preserves operational-error handling, but the public contract omits the rule that every observation belongs to its measured law and origin or a green aggregate cannot grant unmeasured claims | compression |
| V2-13 | `M:O1` lines 229-232, `O2` lines 234-236, `O3` lines 239-241; overlaps | Status exposes aggregate counts/current dependencies only; no public mapping expresses shared-premise propagation, multi-claim support without law-merging, or inspectable shared dependencies without proof of a shared blind spot | compression |
| V2-14 | `M:F1` lines 245-260; design form | `PT:33` names `certificate` as a reference kind, but no public operation admits a certificate or exposes the registered-leaf form and its external compiler/checker completeness obligation | category mismatch |
| V2-15 | `M:F3` lines 281-295; design form | No rubric, passage, review, or generic evidence-submission contract exposes rubric-assessed source inspection, provenance, reviewer/rubric limits, or the absence of deterministic semantic-proof authority | category mismatch |
| V2-16 | `M:U7` lines 329-333; explicitly unresolved | `I:152-154` preserves the lack of generic proof search but omits that no total automatic investigation-priority ordering is derived | compression |
| V2-17 | `M` boundary line 356; explicit boundary | The public interface mentions structured routes but gives no warning that recursive route reports may be large and no compression guarantee is made | low salience |
| V2-18 | `S:34-39`; `E:red` lines 4-16, `green` line 18, `oracleRepairs` lines 19-22; `Q:control` line 15; observed repair evidence/control | `I:41-43` replaces three specific v1-red/v2-green witnesses, 60 clause sets × eight future-fact sets, historical-resolution generation, 30 delivery permutations and both batch orders, plus 13-test/typecheck and seven-mutation sensitivity evidence with current aggregate counts of 21 tests and eight mutations | category mismatch |
| V2-19 | `E:scope` line 3, `range` line 29; `Q:noClaim` line 16; explicit no-claims | Current boundary prose lists product limitations but not that independent range remained untested or that no new full Design Grammar run, post-repair hostile audit, or agent-workflow effectiveness measurement occurred | category mismatch |
| V2-20 | `E:preserved[2]` lines 24-27; historical preservation claim | Current `I:8-11,119-130` describes a later real Endpoints package, erasing v2's historical claim that the repair introduced no production Endpoints or PostgreSQL integration unless version context is retained | category mismatch |

### V2 explicit rejections and non-settlements

- `S:14-17,26-27`; `M:R6`, boundary line 354: blanket epoch expiry was a conservative prototype decision, not a claim that selective invalidation is impossible. The interface preserves revision-based expiry but omits this conservative/non-impossibility framing.
- `S:18-22,26-27`; `M:R7`: same-run repair is explicitly rejected. The later-replay rule preserves the rejection; its conservative status is compressed away.
- `S:24-25`: richer scope matching, durable repair certificates, distributed execution clocks, and selective invalidation were not settled. Public boundaries retain richer-matching and remote-execution exclusions, but not durable repair certificates or selective invalidation.
- `M:P12` lines 67-70: graph products, theorem provers, authentication rewrites, and live-client recovery were rejected as base requirements. Public prose preserves proof-search/security exclusions but omits graph-product and live-client-recovery framing.

No interface-level explicit rejection of a v2-supported claim was found.

### V2 controls and limits

- The reduction retains the central repairs: AND/OR routes and cycle exclusion (`I:108-109`), monotonic freshness (`I:103-105`), later exact applicable replay (`I:106-107`), exact claim identity (`I:110-111`), policy separation (`I:13-16`), and hostile-process limits (`I:115-117`).
- V2's 13-test/seven-mutation and “no production integration” statements are historical. The interface's 21-test/eight-mutation and real-Endpoints statements reflect later version drift, not direct falsification.
- `SV` forwards opaque `base.assess()` and `base.history()` results. Because the kernel and workflows were outside the permitted reduction, runtime presence of rejected-argument fields, successful-route lists, run identity, or workflow capabilities was not measured. The ledger records absence from the frozen public contract.
- Majority agreement was not assigned: the isolated one-source pass provides no evidence of cross-source voting.

## Collation note

The V1 and V2 ledgers are sibling-source readings. Repetition is retained because it carries revision-specific support and status. Agreement between the passes is not treated as stronger evidence, and disagreement is not resolved by vote. The operation itself may overstate interface loss when prose or an opaque forwarded runtime object exposes behavior not declared by the inspected contract; it may understate operational loss when README prose names a concept agents still cannot manipulate.

# Editorial Candidate Map — system-model coordinate

## Generation trace

- **Pass:** fresh, sibling-hidden, source-grounded generation.
- **Sources read:** the Editorial Candidate Map instrument, the frozen Stage 3 input ledger, and only its three canonical artifacts.
- **Sources withheld:** `stage-3-blind-plan.md`, blind probes, sibling candidates, rankings, desired results, and outside research.
- **Coordinate assignment:** architecture, semantics, authority, and whole-system relations.
- **Operation:** generated structurally distinct editorial samples while preserving source status. No applicability choice, validation, recommendation, or architecture selection was made.
- **Map status:** frozen, unranked, and unvalidated.

## Candidate `ECM-SM-01` — The system as coupled jurisdictions

- **Public question or claim:** How do base mechanics, claim packages, authoring workflows, consumer policy, and transport adapters cooperate without borrowing one another’s authority?
- **Upstream IDs and exact support:**
  - `BR-02` requires the RFC to make architecture, semantics, evidence lifecycle, workflows, interfaces, implementation state, and unresolved decisions legible.
  - `BR-03` fixes the reusable evidence base as subject; Endpoints is provenance and one consumer.
  - `ESS-S01` names the ownership layers. Exact support: Field Log 3875–3887; grammar README 9–17, 32–50; `model.json` P1/R1/R9; workflows README 13–28; prototype README 9–16, 134–154.
  - `ESS-S02` supplies the six logical primitives and the demotion of runs/tasks. Exact support: grammar README 14–21; `model.json` C1–C6; `process.json` A-run/A-task/A-score/A-package/A-policy; `kernel.ts` 17–97.
  - `ESS-S09` places CLI/LSP/MCP over one serialized service. Exact support: prototype README 22–95; `service.mjs` 45–131; adapters; `rebuild.test.mjs` 264–322.
  - `ESS-S10` bounds Endpoints to one production-shaped worked consumer. Exact support: DESIGN 1–110; HANDOFF 48–61; `endpoints-real.mjs` 8–141; `effect-verdict.mjs` 11–62.
  - `ESS-TOPO-04` says the parallel layers are contract-coupled but lack a stable packaged extension API.
  - `LFG-H12` recovers the authority premise that a correct denial must govern the real action path and an advisory system must say when it does not. Exact source: `FL:2731-2756`; recovered by compression, not promoted to established architecture.
  - `LGI-V1-12` recovers provenance/authority fields absent from the public contract. Exact grammar support: `model.json:P6`; `source.md:P20/P21/P29/P32/L7`; category-mismatch recovery.
- **Control-ledger status:** `ESS-S01/S02/S09/S10` are allowed completed seams; `LFG-H12` and `LGI-V1-12` remain supported recovered omissions. `ESS-TOPO-04` is descriptive, not an outline mandate.
- **Intervention:** replace a component inventory with an authority-preserving system map: what each layer may assert, inspect, package, transport, or decide.
- **Reader-promise hypothesis:** Kyle can locate a proposed change in the correct ownership layer and see which adjacent contracts it would affect.
- **Form and scale:** full RFC organized around an end-to-end claim-to-consumer trace plus a layer/authority matrix.
- **Theoretical and evidence gaps:** `ESS-T01` applicability ownership; `ESS-T03` registered-rule soundness; `ESS-T04` policy and priority; `ESS-T09` consumer fallback; `ESS-E01` independent range; `ESS-E03` workflow effectiveness; `ESS-E10` real interface use; `ESS-E13` unreleased working-tree state.
- **Source status:** support mixes confirmed brief, provisional architecture, bounded implementation, and recovered omissions. It does not establish general product architecture.
- **Injected choices:** “coupled jurisdictions” framing, the end-to-end trace as organizing device, and a matrix form are editorial choices.
- **Risks:** the diagram may make boundaries look more deployable or settled than they are; Endpoints may visually dominate; recovered authority fields may look like mandatory restoration.
- **Relationships:** shares architecture with `ECM-SM-03`, interface boundaries with `ECM-SM-04`, and the applicability breakpoint with `ECM-SM-05`; it is broader than each.
- **Reconstruction note:** rebuild from `BR-02/03`, `ESS-S01/S02/S09/S10`, `ESS-TOPO-04`, and the status-preserved authority recoveries. No new component or authority is required.

## Candidate `ECM-SM-02` — When evidence still counts

- **Public question or claim:** Evidence authority is temporal and route-specific: support depends on complete acyclic routes, current applicability, retained contradictions, and causally later exact replay.
- **Upstream IDs and exact support:**
  - `ESS-S03` defines AND-within-route, OR-between-routes, flat gaps as inventory, and cycle exclusion. Exact support: grammar `source.md` 64–74; v2 README 9–13, 29–32; v2 `model.json` E2/R2/R8; `kernel.ts` 570–704; relevant generated tests.
  - `ESS-S04` supplies append-oriented challenge/resolution history. Exact support: grammar `source.md` 98–106; v2 README 14–27; v2 `model.json` E5/R4–R7; `kernel.ts` 468–568; Field Log 4054–4117, 6297–6319.
  - `ESS-S05` distinguishes absence, unresolved observation, contradiction, unreachable checker, and consumer denial.
  - `ESS-H03` preserves the failed first model and its repair witnesses; these are local defects, not production Endpoints bugs.
  - `ESS-P01/P02/P03/P05` supply the `a → b → a` monotonic revision, pre-failure invocation rule, challenge reactivation after context change, and one-run/many-observations semantics.
  - `ESS-P04` supplies a bounded three-outcome Endpoints scene: pass, fail, and unresolved.
  - `LGI-V2-09` recovers the public-explanation loss around successful routes versus flat gaps. Exact support: v2 `S:29-32`; `M:R8` 207–212.
  - `LGI-V2-10` recovers invocation snapshot, no-cache, and ordering limits compressed by “causally later exact replay.” Exact support: `M:R7` 199–204 and boundary 355.
  - `LGI-V2-12` recovers the rule that each observation belongs to its measured law and origin. Exact support: `M:R10` 221–224.
- **Control-ledger status:** completed seams and bounded implemented particulars remain prototype-scale; `LGI-V2-*` items remain revision-specific recoveries. Test evidence is source-reported and not independent range validation.
- **Intervention:** explain the model through one evidence item’s changing authority rather than through static type definitions.
- **Reader-promise hypothesis:** Kyle can distinguish retained history from current support and identify why a green result may fail to resolve an earlier challenge.
- **Form and scale:** medium technical essay or central RFC chapter using a temporal ledger and route diagrams.
- **Theoretical and evidence gaps:** `ESS-T02` semantic equivalence; `ESS-T05` capture completeness; `ESS-T08` alternate repair and selective expiry; `ESS-E08/E09` persistence/transaction boundaries; `ESS-E12` graph and storage scale.
- **Source status:** solid only within the finite, exact-identity, local-process prototype model.
- **Injected choices:** a single-item temporal walkthrough, the order of scenes, and the “still counts” phrase are editorial constructions.
- **Risks:** the walkthrough may imply distributed-clock guarantees, semantic identity, or general checker soundness; vivid repair failures may receive an omission bonus.
- **Relationships:** gives semantic depth to `ECM-SM-01`; supplies lifecycle material for `ECM-SM-03`; `ECM-SM-05` isolates its applicability breakpoint.
- **Reconstruction note:** every transition comes from `ESS-S03/S04/S05`, `ESS-P01–P05`, and status-preserved v2 recoveries. No additional state or resolution rule is introduced.

## Candidate `ECM-SM-03` — From assertion to authorized action

- **Public question or claim:** Credible evidence requires a chain of distinct authorities, but evidence support does not itself authorize a consumer action.
- **Upstream IDs and exact support:**
  - `ESS-S01` separates base mechanics, package semantics, workflows, and consumer policy.
  - `ESS-S06` defines the declared check contract. Exact support: Oracle Guide 17–41, 102–122, 239–276, 312–324; `protocol.ts` 21–45; `endpoints-real.mjs` 8–62; DESIGN 7–68.
  - `ESS-H04` preserves the Oracle Guide as a portfolio discipline, not merely a schema.
  - `ESS-S11` and `ESS-P08` bound checksummed persistence to corruption detection rather than signatures or hostile-process security.
  - `LFG-H10` recovers law/comparator changes as control changes and separates proposal, acceptance, and execution. Exact source: `FL:2537-2548,2704-2729`; recovered by compression.
  - `LFG-H11` recovers the premise that editable material cannot impersonate runner observation and each premise needs an authorized source. Exact source: `FL:2642-2671`; constructed authority premise, not a demonstrated vulnerability.
  - `LFG-H12` recovers enforcement at the real action path. Exact source: `FL:2731-2756`; constructed authority premise.
  - `LFG-H14` recovers automatic oracle contradiction reporting outside coding-agent disclosure control. Exact source: `FL:3219-3238`; durable delivery remains open at `FL:6329`.
  - `LGI-V1-24` recovers Arrangement A’s warning that support diagrams omit run history, storage mechanics, and ingestion authority. Exact support: `source.md:158`; low-salience recovery.
  - `ESS-T03` names registered-rule soundness as a trust root; `ESS-T09` leaves consumer fallback unselected.
- **Control-ledger status:** authority items from `LFG-*` remain supported recovered omissions with their original constructed/proposed/open statuses. `ESS-T03/T09` are unresolved gaps, not resolutions.
- **Intervention:** turn “evidence” into an explicit authority chain: law owner, source anchor, runner observation, accepted control, persisted record, assessment, and enforcing consumer—without merging them.
- **Reader-promise hypothesis:** Kyle can see where provenance, trust, and enforcement enter, and where the base deliberately stops.
- **Form and scale:** full authority-boundary RFC or essay with a sequence diagram and boundary ledger.
- **Theoretical and evidence gaps:** `ESS-T03/T09`; `ESS-E04` incomplete failure provenance; `ESS-E05` incomplete machine-readable mutation receipts; `ESS-E08` multi-process loss; `ESS-E11` absent hostile-process controls.
- **Source status:** system claim is source-supported; several authority premises remain constructed or proposed rather than demonstrated production failures.
- **Injected choices:** the chain ordering and “authorized action” framing are editorial. The sources do not require every authority to be a separate service or actor.
- **Risks:** could be mistaken for a security architecture, mandatory independent review, or a claim that checked storage is complete.
- **Relationships:** authority-focused counterpart to `ECM-SM-01`; uses lifecycle semantics from `ECM-SM-02`; exposes contract omissions developed in `ECM-SM-04`.
- **Reconstruction note:** the chain is assembled only from named ownership boundaries, check-contract fields, recovered authority premises, and explicit storage/security limits. It adds no authentication design.

## Candidate `ECM-SM-04` — What agents can actually operate

- **Public question or claim:** The current agent-facing transports expose shared operations, but much of the grammar remains prose, opaque output, or non-operable semantics rather than a declared public contract.
- **Upstream IDs and exact support:**
  - `ESS-S08` supplies the three draft authoring workflows. Exact support: Field Log 3881–3887, 4008–4022; workflows README and the three workflow documents.
  - `ESS-S09` supplies shared-service CLI/LSP/MCP semantics.
  - `ESS-P06/P07` supply the implemented LSP diagnostic mapping and six MCP tools, both with bounded status.
  - `LGI-V2-05` — rule declarations/registration absent from public operations. Exact support: `M:C3` 93–99, `E1` 125–128, `R1` 161–164.
  - `LGI-V2-06` — no generic proposed-argument operation. Exact support: `M:C4` 101–106, `E3` 139–142.
  - `LGI-V2-07` — rule-owned applicability and explicit unknown are not public contract objects. Exact support: `M:C5` 109–113, `E4` 145–148, `R3` 173–176.
  - `LGI-V2-08` — agents cannot target a claim, use, or inference with a challenge. Exact support: `M:C6` 116–120, `E5` 151–156.
  - `LGI-V2-11` — no public contract for deriving work from uncovered premises. Exact support: `M:R8` 207–212.
  - `LGI-V2-14/V2-15` — certificate and rubric forms lack admission/submission operations. Exact support: `M:F1` 245–260 and `M:F3` 281–295.
  - `LGI-U01` constrains all such findings: absence from the inspected public contract does not prove runtime absence because service results are opaque and README prose may name non-operable concepts.
- **Control-ledger status:** all `LGI-V2-*` items remain revision-specific supported recoveries; none is a restoration recommendation. `LGI-U01` remains an unmeasured caveat.
- **Intervention:** assess the interface as an operability boundary: which semantics an agent can name, propose, inspect, challenge, or maintain—not merely which concepts appear in prose.
- **Reader-promise hypothesis:** Kyle can compare intended workflows with current agent affordances without mistaking transport parity for semantic completeness.
- **Form and scale:** medium interface-contract RFC with an operation × semantic-object matrix.
- **Theoretical and evidence gaps:** `ESS-T06` speculative challenges; `ESS-T07` rubric admission; `ESS-E03` agent workflow effectiveness; `ESS-E10` installation, registration, schemas, and real-client use.
- **Source status:** implemented transports are solid locally; the operability losses are public-contract observations, not runtime-absence findings.
- **Injected choices:** “operability” as the comparison axis and the matrix format are editorial choices. The candidate does not assert that every grammar primitive needs a public operation.
- **Risks:** may convert a loss audit into a feature checklist, overstate runtime loss, or imply restoration priority.
- **Relationships:** narrows the adapter layer of `ECM-SM-01`; operationalizes authority questions from `ECM-SM-03`; shares reduction evidence with `ECM-SM-06`.
- **Reconstruction note:** rebuild from `ESS-S08/S09/P06/P07`, the named interface recoveries, and `LGI-U01`. No interface shape beyond recorded presences and absences is proposed.

## Candidate `ECM-SM-05` — Who decides whether evidence applies?

- **Public question or claim:** Applicability remains an unresolved pair of decisions: who owns matching, and whether the result is boolean or admits explicit unknown.
- **Upstream IDs and exact support:**
  - `BR-06` explicitly protects the unknown across base-owned versus rule-owned matching, boolean versus three-valued results, and a possible layered combination.
  - `ESS-T01` gives the exact breakpoint: grammar `model.json` C5/E4/R3 specifies rule-owned captured/requested-context matching with unknown; `kernel.ts` 552–568 implements private base-owned boolean exact matching; evaluation ledger 67 records the sole design decision.
  - `ESS-S05` distinguishes unresolved evidence from contradiction, no evidence, unreachable check, and consumer denial.
  - `ESS-H06` preserves missing-evidence strictness as unselected. Exact support: Field Log 6209–6225; grammar `source.md` P16 and rejected recombinations 164–176; `model.json` P7/R9/U4.
  - `ESS-H07` preserves exact identity/global epochs as conservative prototype boundaries rather than impossibility claims.
  - `LFG-H04` recovers a distinct requirement-applicability result: applicable, not applicable with reason, or unresolved. Exact source: `FL:2460-2466`; it concerns requirement applicability and must not be silently merged with evidence-use applicability.
  - `LGI-V1-05` and `LGI-V2-07` recover the disappearance of applicability conditions and explicit unknown reasons from the public contract.
- **Control-ledger status:** `BR-06` is a protected unknown; `ESS-T01` is a theoretical gap; `LFG-H04` is a supported recovered omission with a distinct subject; interface items are recoveries only.
- **Intervention:** isolate the system’s main semantic breakpoint and display the source-defined decision surface without deciding it.
- **Reader-promise hypothesis:** Kyle can evaluate the ownership and cardinality questions separately and see which current behaviors depend on exact matching.
- **Form and scale:** smaller focused design note or unresolved-question essay; a two-axis comparison followed by consequences and missing evidence.
- **Theoretical and evidence gaps:** `ESS-T01`, `ESS-T02` semantic equivalence, `ESS-T05` capture completeness, and `ESS-E01` independent range. Existing prototype tests cannot resolve these theory choices.
- **Source status:** unresolved by construction. The possible layered combination is named but unselected.
- **Injected choices:** treating this as a standalone smaller piece and using a two-axis layout are editorial decisions.
- **Risks:** the matrix may imply all combinations are equally viable; requirement applicability may be conflated with evidence-use applicability; a layered option may accidentally become a recommendation.
- **Relationships:** focuses the breakpoint inside `ECM-SM-01/02/04`; it can remain independent because the public question is unresolved rather than explanatory.
- **Reconstruction note:** rebuild directly from `BR-06`, `ESS-T01`, status-preserved `LFG-H04`, and the two interface recoveries. Stop before choosing an owner, cardinality, or layered design.

## Candidate `ECM-SM-06` — What the system loses as it becomes operable

- **Public question or claim:** What changes as the evidence system is reduced from field record to grammar, bounded implementation, and agent-facing contract?
- **Upstream IDs and exact support:**
  - `ESS-S12` supplies the historical sequence. Exact support: Field Log 3984–4117, 6297–6335; v2 README 1–39; HANDOFF 1–11, 94–138.
  - `ESS-TOPO-01` requires current code/handoff for present-tense claims; `ESS-TOPO-06` limits audit-and-repair generalization because cases are constructed, context is shared, and range is untested.
  - `LFG-H17` preserves an incomplete 112-question Guide-word Sweep as process status, not findings. Exact source: `FL:3002-3110`.
  - `LFG-H18` recovers the distinction between finding validity and repair-guidance validity plus unperformed matched agent evaluations. Exact source: `FL:71-78,4130-4137`.
  - `LFG-H19` recovers checked-in evidence, import verification, durable delivery, and storage as an open implementation boundary. Exact source: `FL:5932-5934,4030-4034,6321-6329`.
  - `LGI-V1-27` recovers provisional normalization and untested range omitted from the public surface. Exact support: `model.json:preservationStatus`; grammar README 3–5; `evidence.json:range`.
  - `LGI-V1-28` recovers conceptual/partial/unexecuted grammar controls hidden by aggregate implementation counts. Exact support: `evidence.json:X1-X8`; `process.json:A-C1...A-R10`.
  - `LGI-V1-29/V1-30` recover authoring cost, graph-selection bias, same-analyst correlation, and the unmeasured status of promised agent benefit.
  - `LGI-V2-18/V2-19` recover specific repair controls and explicit no-claims compressed into current aggregate counts/boundaries.
  - `LGI-C01` forbids raising confidence through V1/V2 agreement or settling disagreement by vote.
- **Control-ledger status:** all losses remain supported recoveries with original provisional, historical, incomplete, or unmeasured statuses. `LFG-U01` says source claims were not independently revalidated.
- **Intervention:** make reduction itself the subject, showing how implementation and interface compression can erase status, authority, controls, cost, and unresolvedness.
- **Reader-promise hypothesis:** Kyle can distinguish “implemented,” “preserved,” “compressed,” “unmeasured,” and “not publicly operable” when continuing the design.
- **Form and scale:** medium method essay structured as four snapshots with a status-preservation ledger.
- **Theoretical and evidence gaps:** `LFG-U01`; `LGI-U01`; `ESS-E01` independent range; `ESS-E03` workflow effectiveness; no outside-reader check from `ESS-U05`.
- **Source status:** this is an audit-derived method candidate, not evidence of omission intent or a restoration plan.
- **Injected choices:** the four-snapshot narrative and “becomes operable” framing are editorial choices.
- **Risks:** chronology may imply deliberate loss, repeated revision-specific rows may inflate distinctness, and recovered items may acquire false importance.
- **Relationships:** methodological companion to `ECM-SM-04`; supplies status discipline for all other candidates but is not their validation.
- **Reconstruction note:** rebuild from the evolutionary seam, topology limits, named loss-audit rows, and their controls. Do not infer motives, runtime absence, or restoration value.

## Relationship clusters

These clusters express relation, not preference.

- **Architecture and authority:** `ECM-SM-01`, `ECM-SM-03`, `ECM-SM-05`.
- **Lifecycle semantics:** `ECM-SM-02`, with the applicability breakpoint isolated by `ECM-SM-05`.
- **Agent contract and reduction:** `ECM-SM-04`, `ECM-SM-06`.
- **Shared evidence without duplication:** `ECM-SM-01` is the widest system map; `ECM-SM-02` changes form to temporal mechanism; `ECM-SM-03` changes intervention to authority; `ECM-SM-04` changes boundary to agent operability; `ECM-SM-05` is a smaller unresolved question; `ECM-SM-06` is a method/audit essay.

## Rejected generated samples

| ID | Attempted premise | Rejection reason |
|---|---|---|
| `ECM-SM-R01` | “A weighted confidence score can summarize green checks, routes, and reviewers.” | Explicitly unavailable: `ESS-X01`, `LFG-X10`, `LGI-V1-X03`, and `process.json:A-score` reject universal confidence/green-count scoring. |
| `ECM-SM-R02` | “Applicability should use a layered matcher combining base and rule ownership.” | Settles protected unknown `BR-06` and theoretical gap `ESS-T01`; the layered option is possible but unselected. It would inject architecture. |
| `ECM-SM-R03` | “The Endpoints vertical demonstrates that the base architecture generalizes.” | Contraindicated by `BR-03`, `ESS-X08`, and `ESS-E01`; Endpoints helped construct the grammar and cannot independently validate generality. |
| `ECM-SM-R04` | “Matching CLI, LSP, and MCP results provide three independent confirmations.” | Contraindicated by `ESS-X09` and `ESS-S09`; all three adapters traverse one serialized service path. |
| `ECM-SM-R05` | “From Claims to Confidence” as a retitle of the layered-system or lifecycle candidate. | Wording-only variation with no distinct intervention; “confidence” also risks the explicitly rejected score reduction. |
| `ECM-SM-R06` | “The checksummed evidence store is a secure proof authority.” | Unsupported and out of bounds under `BR-09`, `ESS-S11`, `ESS-P08`, and `ESS-E11`; checksum is not signature, authentication, or hostile-process security. |

These are generation controls, not validation verdicts.

## Typed-handoff coverage

| Input group | Disposition in this pass |
|---|---|
| `BR-01`–`BR-09` | Used as reader, subject, source, scope, protected-unknown, review, later-validation, and claim-boundary constraints. |
| `BR-10` | Preserved as unmeasured; no deadline, secondary audience, or publication target was invented. |
| `ESS-S01`–`ESS-S12` | Used across the six candidates as allowed seams. |
| `ESS-H02`–`ESS-H07` | Used with shadow/omission rationale intact. `ESS-H01` unused; the Lean analogy was unnecessary and gains no omission bonus. |
| `ESS-P01`–`ESS-P08` | Used as bounded mechanism scenes or boundary controls. |
| `ESS-T01`–`ESS-T09` | Used only as theory gaps, questions, or return points. |
| `ESS-E01`, `ESS-E03`–`ESS-E05`, `ESS-E08`–`ESS-E13` | Used as evidence/implementation gaps. |
| `ESS-E02`, `ESS-E06`, `ESS-E07` | Unused particulars; their omission is not a judgment of merit. |
| `ESS-X01`–`ESS-X10` | Unavailable as support; preserved as negative controls. |
| `ESS-U01`–`ESS-U05` | Missing input, not null findings. |
| `ESS-TOPO-01`–`ESS-TOPO-06` | Used as form, scale, and breakpoint constraints; none was treated as a ranked outline. |
| `LFG-H04`, `LFG-H05`, `LFG-H07`, `LFG-H10`–`LFG-H12`, `LFG-H14`, `LFG-H17`–`LFG-H19` | Used as supported recovered omissions with original status and drop rule intact. |
| Remaining `LFG-H*` | Unused; recovery does not require restoration or editorial use. |
| `LFG-X01`–`LFG-X11` | Unavailable positive support; retained as rejections/deferrals. |
| `LFG-C01` | Preserved: no majority agreement. |
| `LFG-U01` | Used as an unmeasured reconstruction limit. |
| `LGI-V1-05`, `LGI-V1-12`, `LGI-V1-24`, `LGI-V1-27`–`LGI-V1-30` | Used as revision-specific recoveries. |
| Remaining `LGI-V1-*` recoveries | Unused; no restoration inference. |
| `LGI-V1-X01`–`LGI-V1-X14` | Unavailable positive support. |
| `LGI-V1-U01`–`LGI-V1-U02` | Unsupported reaches; unavailable. |
| `LGI-V2-05`–`LGI-V2-12`, `LGI-V2-14`, `LGI-V2-15`, `LGI-V2-18`, `LGI-V2-19` | Used as revision-specific recoveries. |
| Remaining `LGI-V2-*` recoveries | Unused. |
| `LGI-V2-X01`–`LGI-V2-X04` | Preserved as negative or unresolved controls. |
| `LGI-C01` | Preserved: sibling agreement does not raise confidence and disagreement is not settled by vote. |
| `LGI-U01` | Used as the public-contract/runtime-absence caveat. |

## Empty regions preserved

- No candidate claims hostile-process security, universal proof, production Endpoints readiness, broad PostgreSQL support, settled permission policy, or publication authority.
- No candidate selects applicability ownership, result cardinality, fallback behavior, confidence aggregation, or investigation priority.
- No candidate treats external prior art, unexamined SQL machinery, hidden stress snapshots, real-client behavior, concurrent writers, large graphs, or outside-reader response as known.
- No candidate turns recovered omissions into mandatory architecture or a restoration queue.

**Freeze:** the six accepted cards and six rejected samples above form this sibling-hidden system-model generation trace. All accepted candidates remain unvalidated and unranked.

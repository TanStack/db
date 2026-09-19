# Editorial Candidate Map — operational-use generation trace

## Pass controls

- **Assignment:** operational-use coordinate
- **Context:** fresh and sibling-hidden
- **Allowed inputs:** frozen editorial brief, Editorial Source Survey, both completed Loss Audits, and the Editorial Candidate Map instrument
- **Hidden inputs:** blind expectation outputs, sibling candidates, rankings, desired winners, and `stage-3-blind-plan.md`
- **Generation status:** six accepted samples; all remain **unvalidated and unranked**
- **Stopping rule:** further samples either repeated an accepted structure, selected an unresolved policy, or required unsupported agent-effectiveness claims
- **Status handling:** recovered omissions remain recovered omissions; gaps remain gaps; rejections and unsupported reaches remain unavailable as positive support

## Coordinate coverage

| Sample | Intervention | Form | Scale | Primary source emphasis |
|---|---|---|---|---|
| `OPU-01` | Reconstruct support as a changing authority lifecycle | Architecture/mechanism RFC | Full RFC | Argument routes, observations, challenge, replay, freshness |
| `OPU-02` | Turn source controls into a bounded authoring and maintenance method | Method piece / handbook chapter | Medium | Check contracts, three workflows, repair discipline |
| `OPU-03` | Compare operable agent capabilities with semantics compressed at the public boundary | Interface-contract RFC / capability map | Medium | Shared CLI/LSP/MCP service and recovered interface losses |
| `OPU-04` | Separate evidence status from consumer permission and severity | Boundary note / decision frame | Small | Consumer policy boundary and adapter-specific behavior |
| `OPU-05` | Follow one worked consumer through checks and agent-facing surfaces | Operational walkthrough | Medium | Endpoints check, three outcomes, adapters, policy handoff |
| `OPU-06` | Teach maintenance invariants through concrete failure witnesses | Counterexample atlas / technical appendix | Small | Staleness, replay causality, reactivation, reach failure |

Kyle remains the primary reader under `BR-01`; the variation is in the change each piece attempts to produce, not an invented secondary audience.

---

## `OPU-01` — From observation to current authority

**Public claim**

Evidence support is not a stored green bit. In the bounded prototype, it is a current result of traversing AND/OR argument routes through applicable observations, preserving contradictions as challenges, accepting only causally later exact replay as resolution, and withdrawing present authority when relevant context changes. Consumer permission begins after this lifecycle rather than inside it.

**Upstream inputs and exact support**

- `BR-02`, `BR-04`, `BR-06`, `BR-09`: the RFC must explain evidence lifecycle and leave applicability, policy, security, and generality unresolved.
- `ESS-S02`: grammar README `14–21`; `model.json:C1–C6`; `process.json` demotions `A-run/A-task/A-score/A-package/A-policy`; `kernel.ts:17–97`. These support the six primitives and the demotion of runs/tasks from independent authority.
- `ESS-S03`: grammar `source.md:64–74`; v2 README `9–13,29–32`; v2 `model.json:E2/R2/R8`; `kernel.ts:570–704`; `kernel.test.mjs:92–128,289–306,388–438`. These support conjunctive premises, alternative routes, flat-gap inventory limits, and cycle exclusion.
- `ESS-S04`: grammar `source.md:98–106`; v2 README `14–27`; v2 `model.json:E5/R4–R7`; `kernel.ts:468–568`; `kernel.test.mjs:130–213,440–558`; Field Log `4054–4117,6297–6319`. These support append-oriented failure, challenge, later exact replay, retained resolution history, and expiring current authority.
- `ESS-P01`: `kernel.ts:360–387,559–568`; `kernel.test.mjs:243–256`; `rebuild.test.mjs:129–152`; fault control `57–60`. Fingerprint `a → b → a` does not revive stale evidence.
- `ESS-P02`: `kernel.ts:409–465,513–539`; `kernel.test.mjs:513–558`; v2 README `18–22`. A check begun before a failure cannot resolve it merely by arriving later.
- `ESS-P03`: `kernel.ts:519–568`; `kernel.test.mjs:440–510`; v2 `model.json:R6/R7`. Context change can reactivate a resolved challenge until another exact replay is linked.
- `ESS-TOPO-03`: the survey’s third topology supplies the mechanism chain and its breakpoint before consumer action.
- `LGI-V2-09`: v2 `M:R8:207–212`, a **revision-specific supported recovery** compressed from the public contract; the interface does not declare successful-route versus rejected-argument semantics or that flat gaps are inventory only.
- `LGI-V2-10`: v2 `M:R7:199–204` and boundary `355`, a **revision-specific supported recovery**; the public surface compresses invocation snapshot, no-cache, and ordering limits into “causally later exact replay.”
- `LGI-V2-12`: v2 `M:R10:221–224`, a **supported recovery by compression**; the public contract does not state that every observation belongs to its measured law and origin.

**Control-ledger status**

`LGI-V2-09`, `V2-10`, and `V2-12` remain recovered interface losses, not required API restorations. `ESS-P01`–`P03` are implemented, locally tested prototype behaviors. `ESS-S02`–`S04` combine provisional grammar, chosen bounded repair rules, implementation, and source-reported tests; they do not establish independent range.

**Intervention**

Reconstruct the architecture around one claim’s changing support state: proposed routes → observations → assessment → contradiction → challenge → later replay → resolution history → context expiry → policy handoff.

**Reader-promise hypothesis**

Kyle could inspect the complete causal chain by which evidence becomes, retains, loses, or regains current support without conflating provenance, task closure, and consumer action.

**Form and scale**

Full architecture/mechanism RFC, with a state-transition trace and bounded failure scenes.

**Theoretical and evidence gaps**

- `ESS-T01`: applicability ownership and boolean versus explicit-unknown cardinality remain unresolved.
- `ESS-T02`: semantic equivalence and cross-version mapping lack generic rules.
- `ESS-T05`: complete dependency capture is unsolved.
- `ESS-T08`: alternate repair and selective expiry remain outside the exact-replay model.
- `ESS-E09`: execution/context transaction behavior is not explicit.
- `ESS-E12`: graph and storage scale are unmeasured.
- `LGI-U01`: absence from the public contract does not prove absence from opaque runtime results.

**Source status**

Source-grounded generated candidate. Architecture is provisional; lifecycle behavior is implemented and source-reported as tested only inside the finite local prototype.

**Injected choices**

- Use one claim lifecycle rather than ownership layers as the organizing spine.
- Place public-interface exposure after semantic reconstruction.
- Treat the consumer boundary as the stopping point.
- Use exact-replay failures as explanatory controls.
- Do not choose an applicability model.

**Risks**

The graph-shaped sources may make formal relations look more complete than human authoring practice. Exact identity and global revisions may appear normative rather than conservative prototype boundaries. Recovered interface losses could be mistaken for accepted interface requirements.

**Relationships**

Shares lifecycle evidence with `OPU-06`; supplies the abstract mechanism contrasted with the worked case in `OPU-05`; ends at the boundary examined by `OPU-04`; provides semantics that `OPU-03` asks agents to manipulate.

**Reconstruction note**

The candidate can be rebuilt entirely from `BR-02/04/06/09`, `ESS-S02/S03/S04`, `ESS-P01/P02/P03`, `ESS-TOPO-03`, and the status-preserved `LGI-V2-09/10/12`. Its organizing sequence is injected, but every state transition and limit is present in those inputs. No new authority rule, applicability resolution, or policy is added.

---

## `OPU-02` — Writing and maintaining a check that can count as evidence

**Public question**

What must a human or coding agent declare, observe, preserve, and revisit for a claim-specific check to supply bounded evidence without self-certifying its own correctness?

**Upstream inputs and exact support**

- `BR-02`, `BR-04`, `BR-09`: authoring workflows and trust limits must be legible without claiming universal proof or settled policy.
- `ESS-S06`: Oracle Guide `17–41,102–122,239–276,312–324`; `protocol.ts:21–45`; `endpoints-real.mjs:8–62`; DESIGN `7–68`. These support the declared contract tying law, source, domain, reference, production path, checkpoint, observations, omissions, reach, controls, and replay.
- `ESS-S08`: Field Log `3881–3887,4008–4022`; workflows README `1–28`; `design-check.md:1–87`; `maintain-evidence.md:1–33`; `repair-rule.md:1–32`. These support three distinct documented procedures; no agent-effectiveness evaluation has run.
- `ESS-H04`: Oracle Guide `72–108,124–199,201–324`; evaluation ledger `54–62`. The guide is a portfolio discipline broader than the implemented `CheckContract`.
- `ESS-H05`: Field Log `4126–4137`; `design-check.md:46–60`; HANDOFF `130–131`. Diagnostic validity and repair-guidance validity are distinct; matched agent correction evaluation remains unmeasured.
- `LFG-H05`: Field Log `2475–2486`, a **supported recovered omission** with original draft-result-semantics status; passed, failed, not-checked, out-of-date, and disabled plus retained traces and diagnostics vanished by category mismatch.
- `LFG-H07`: Field Log `2488–2499`, a **supported recovered omission**; code fix, invalid expectation, changed scope, and explained nondeterminism were compressed by the prototype’s exact-replay choice.
- `LFG-H10`: Field Log `2537–2548,2704–2729`, a **supported recovered omission**; proposal, acceptance, and new execution as separate control-change facts were compressed.
- `LFG-H13`: Field Log `3205–3217,3286–3301`, a **supported recovered omission**; fingerprint-versus-TTL guidance vanished by compression.
- `LFG-H18`: Field Log `71–78,4130–4137`, a **supported recovered omission** with donor-study/no-independent-evaluation status; matched correction-budget evaluation and analysis-failure/program-violation separation vanished by category mismatch.
- `LGI-V1-03`: root `model.json:C3/R1`, a **provisional supported recovery**; rules are fixed internally and have no public registration or inspection operation.
- `LGI-V1-14`: root `source.md:P26/L5`, a **plausible supported recovery**; passage-plus-representation source anchors collapse to a string.
- `LGI-V2-05`: v2 `M:C3:93–99`, `E1:125–128`, `R1:161–164`, a **revision-specific supported recovery**; the service exposes no versioned rule declaration or registration surface.
- `LGI-V2-12`: v2 `M:R10:221–224`, a **supported recovery by compression**; measured law and observation origin are not declared in the public contract.

**Control-ledger status**

All `LFG-*` and `LGI-*` items remain recovered omissions with their original source status and drop rule. They are available as method concerns and return points, not as proof that each must enter the base architecture or public API.

**Intervention**

Turn the three packaged workflows and Oracle controls into a source-bounded method: define the claim and law, declare check reach and omissions, establish evidence, monitor freshness and contradiction, then repair either code, expectation, scope, or check contract while preserving provenance.

**Reader-promise hypothesis**

Kyle could evaluate whether the current authoring procedures expose enough checkpoints for humans and agents to avoid silently widening a claim, erasing a failure, or treating check execution as check soundness.

**Form and scale**

Medium method piece or operational handbook chapter. This is the explicit method candidate in the pass.

**Theoretical and evidence gaps**

- `ESS-T03`: registered rule soundness remains a trust root.
- `ESS-T05`: hidden semantic dependency discovery is unsolved.
- `ESS-T07`: rubric admission lacks a runtime representation or acceptance protocol.
- `ESS-E03`: the workflows have not been exercised and audited with coding agents.
- `ESS-E04`–`E07`: provenance, mutant witness, trace fidelity, and fixture-responsibility records remain incomplete.
- `ESS-E10`: real agent registration and use remain unfinished.
- `ESS-E13`: the rebuild remains working-tree state.

**Source status**

The contract shape and procedures are normative or draft guidance; a subset is instantiated in the current prototype. No source establishes that the workflows improve agent performance.

**Injected choices**

- Organize around the documented design → maintain → repair sequence.
- Treat the Oracle Guide as a method portfolio, not merely a schema.
- Use recovered omissions as checkpoint questions.
- Expose the absence of agent evaluation inside the piece.
- Do not turn every recovered workflow concern into a base primitive.

**Risks**

Normative guidance may be confused with implemented guarantees. The method could appear validated because its fields are detailed. Grammar vocabulary may have biased the recovered omissions. Human judgment and authoring cost remain less visible than machine-checkable relations.

**Relationships**

Pairs with the public-operability audit in `OPU-03`; `OPU-05` supplies one bounded worked example; `OPU-06` supplies maintenance failure scenes; `OPU-04` owns the later consumer decision rather than this method.

**Reconstruction note**

The method is a rearrangement of `ESS-S06/S08/H04/H05`, status-preserved `LFG-H05/H07/H10/H13/H18`, and `LGI-V1-03/V1-14/V2-05/V2-12`. The workflow sequence already exists in the source. The candidate injects only its checkpoint presentation and does not claim efficacy, rule soundness, or a required interface repair.

---

## `OPU-03` — Can an agent actually operate the evidence model?

**Public question**

The prototype exposes CLI, LSP, and MCP adapters over one serialized service, but which evidence operations can an agent actually perform through the declared contract, and which grammar semantics remain prose, opaque results, or unavailable operations?

**Upstream inputs and exact support**

- `BR-02`, `BR-04`, `BR-09`: agent-facing interfaces must be made legible without treating transport parity as independent evidence.
- `ESS-S09`: README `22–95`; `service.mjs:45–131`; `cli.mjs:1–71`; `lsp-server.mjs:5–194`; `mcp-server.mjs:5–163`; `rebuild.test.mjs:264–322`; evaluation ledger `57`. These support three adapters over one serialized service and one shared-path integration test.
- `ESS-P06`: `lsp-server.mjs:5–43,45–126`; README `56–70`. The LSP maps supported to no diagnostic, contradicted to error, and unresolved to warning, and exposes `evidence.request`.
- `ESS-P07`: `mcp-server.mjs:5–114`; README `72–81`. The MCP adapter advertises status, assess, run Endpoints check, history, context, and resolve tools with text and structured results.
- `ESS-E10`: HANDOFF `63–73,130–131`; `rebuild.test.mjs:264–322`. Installation, client configuration, registration, schema/range quality, distribution, and real-agent use remain unfinished.
- `LGI-V2-02`: v2 `M:P6:37–44/C2:86–90`, a **supported recovery by category mismatch**; public history exposes counts and opaque history without a public observation/run/use model.
- `LGI-V2-05`: v2 `M:C3:93–99/E1:125–128/R1:161–164`, a **supported recovery**; no operation lists, describes, or registers rules.
- `LGI-V2-06`: v2 `M:C4:101–106/E3:139–142`, a **supported recovery**; no generic proposed-argument operation accepts observation, run, or semantic-dependency citations.
- `LGI-V2-07`: v2 `M:C5:109–113/E4:145–148/R3:173–176`, a **supported recovery**; applicability and explicit unknown are not public contract objects.
- `LGI-V2-08`: v2 `M:C6:116–120/E5:151–156`, a **supported recovery**; agents may resolve numeric IDs but cannot submit a challenge against a claim, use, or inference.
- `LGI-V2-11`: v2 `M:R8:207–212`, a **supported recovery by category mismatch**; no operation derives or maintains investigation work from uncovered premises.
- `LGI-V2-14`: v2 `M:F1:245–260`, a **supported recovery**; certificate is named as a reference kind without an admission operation.
- `LGI-V2-15`: v2 `M:F3:281–295`, a **supported recovery**; rubric, passage, review, and evidence-submission contracts are absent.
- `LGI-V2-19`: v2 `E:scope:3/range:29` and `Q:noClaim:16`, a **revision-specific supported recovery**; agent-workflow effectiveness and independent range remained explicitly unmeasured.
- `LGI-U01`: public-contract absence cannot establish runtime absence because service results are opaque.

**Control-ledger status**

The `LGI-*` rows are revision-specific recovered omissions, not an accepted restoration backlog. Both loss-audit distortions remain active: prose can understate operational loss, while excluding opaque kernel results can overstate runtime loss.

**Intervention**

Build an operation-level capability map rather than three transport descriptions. Separate:

1. operations agents can invoke;
2. semantics they can inspect only through prose or opaque output;
3. grammar objects they cannot author or manipulate through the declared surface;
4. capabilities whose runtime presence remains unmeasured.

**Reader-promise hypothesis**

Kyle could evaluate the agent interface as an actual working contract rather than assuming that a concept named in README prose is operable or that three adapters constitute three implementations.

**Form and scale**

Medium interface-contract RFC or capability-matrix companion.

**Theoretical and evidence gaps**

- `ESS-T01`: applicability remains unresolved.
- `ESS-T06`: speculative challenges lack a separate API object.
- `ESS-T07`: rubric admission is unimplemented.
- `ESS-E03`: coding-agent workflow behavior is unmeasured.
- `ESS-E10`: real client use and distribution remain unfinished.
- `LGI-U01`: the opaque-result boundary prevents a complete absence claim.

**Source status**

The adapters and shared integration path are implemented local working-tree behavior. The recovered losses describe the inspected public contract, not verified runtime impossibility.

**Injected choices**

- Treat the shared service as one semantic implementation.
- Compare capabilities by evidence operation rather than by transport.
- Distinguish “named,” “returned opaquely,” and “agent-manipulable.”
- Leave interface restoration and applicability design undecided.
- Keep CLI/LSP/MCP parity out of any confidence argument.

**Risks**

A contract-only audit can overstate runtime absence. README prose can make non-operable concepts appear supported. The capability matrix may be mistaken for a prioritized roadmap. Transport details could crowd out the authoring workflow that gives the operations meaning.

**Relationships**

`OPU-02` supplies the workflows whose operability is examined; `OPU-05` gives a consumer-specific walkthrough; `OPU-04` isolates one policy compression; `OPU-01` supplies the semantics that the interface may or may not expose.

**Reconstruction note**

The piece is reconstructable from `ESS-S09/P06/P07/E10`, the named `LGI-V2-*` rows, and `LGI-U01`. The capability categories are injected editorial structure. No recovered omission is promoted into a requirement, and no opaque runtime behavior is inferred absent.

---

## `OPU-04` — Support, severity, and permission are different decisions

**Public claim**

The evidence base may distinguish supported, contradicted, unresolved, not reached, and disallowed states without choosing what a consumer must do. Severity and permission belong to consumer policy; the LSP’s error/warning mapping is one implemented adapter behavior, not a universal fallback contract.

**Upstream inputs and exact support**

- `BR-04`, `BR-06`, `BR-09`: mechanics, policy, and unresolved decisions must remain separate.
- `ESS-S01`: Field Log `3875–3887`; grammar README `9–17,32–50`; `model.json:P1/R1/R9`; workflows README `13–28`; prototype README `9–16,134–154`. Policy is intentionally outside the base.
- `ESS-S05`: Field Log `6169–6225`; grammar README `25–31,46–50`; Oracle Guide `239–276,296–310`; `protocol.ts:1–50`; `kernel.ts:99–104,433–465,570–637`; workflows README `26–28`. These support the distinction among no evidence, unresolved observation, contradiction, checker not reaching, and consumer disallowance.
- `ESS-H06`: Field Log `6209–6225`; grammar `source.md:P16` and rejected recombinations `164–176`; `model.json:P7/R9/U4`. Missing-evidence strictness was deliberately left open.
- `ESS-P06`: `lsp-server.mjs:5–43,45–126`; README `56–70`. Error/warning severity is current adapter behavior.
- `ESS-T04`: grammar README `46–50`; `model.json:R9/U4/U7`; Field Log `6209–6225`; HANDOFF `135–138`. Permission, severity, check levels, confidence aggregation, and investigation priority remain project policy or future design.
- `ESS-T09`: DESIGN `20–23,97–110`; HANDOFF `54–61,120–122`; `repair-rule.md:24–28`. The package reports support but does not itself enable an optimization or choose fallback.
- `LFG-H08`: Field Log `2030–2046,2501–2511`, a **supported recovered omission**; completion, visibility, acknowledgment, and consumer transition were compressed.
- `LGI-V1-09`: root `model.json:R9/P7/U4` and `source.md:L7`, a **supported recovery by compression**; typed channels for support, gaps, challenges, permission, and severity are absent while the LSP maps statuses to diagnostics.
- Negative controls: `ESS-X05` and `LFG-X06` reject an unconditional failure or optimization veto for missing evidence.

**Control-ledger status**

`LFG-H08` and `LGI-V1-09` remain recovered omissions. `ESS-T04/T09` are gaps, not positive support for a chosen policy. `ESS-X05` and `LFG-X06` remain unavailable as affirmative universal-fallback claims.

**Intervention**

Use a compact boundary matrix to show which layer reports evidence state, which layer assigns diagnostic severity, and which consumer decides whether an action is permitted.

**Reader-promise hypothesis**

Kyle could evaluate consumer-policy proposals without smuggling them into support semantics or mistaking the current LSP severity mapping for a settled system-wide rule.

**Form and scale**

Small RFC boundary note or decision-frame appendix.

**Theoretical and evidence gaps**

Applicability (`BR-06`, `ESS-T01`), strictness and permission (`ESS-T04`), and consumer fallback (`ESS-T09`) all remain unresolved. No source supplies a general consumer-policy evaluation.

**Source status**

The separation is a user decision and provisional/implemented architectural boundary. Concrete policy remains absent.

**Injected choices**

- Present three planes: evidence state, severity, permission.
- Use the LSP only as a bounded example.
- Include “not reached” separately from contradiction.
- Keep all policy cells descriptive or open; select none.

**Risks**

A matrix can look like a proposed policy even when cells are open. LSP behavior could become an accidental default. Endpoints’ optimization context may over-anchor what consumers generally do.

**Relationships**

Cross-cuts `OPU-01`, `OPU-03`, and `OPU-05`; it is narrower than each rather than a wording variant.

**Reconstruction note**

The separation and every open boundary come directly from `ESS-S01/S05/H06/P06/T04/T09`, `LFG-H08`, `LGI-V1-09`, and the named rejection controls. The three-plane matrix is injected form only; it supplies no policy values.

---

## `OPU-05` — One claim across a worked consumer and three agent surfaces

**Public question**

What does the evidence base look like in operation when the Endpoints `safe-skip-refetch@1` claim is checked against pre-analyzed effects, produces pass/fail/unresolved outcomes, enters the shared evidence service, and is inspected through agent-facing adapters before a consumer makes its own decision?

**Upstream inputs and exact support**

- `BR-03`, `BR-09`: Endpoints is provenance and a worked consumer, not generality evidence or a production-readiness claim.
- `ESS-S06`: Oracle Guide `17–41,102–122,239–276,312–324`; `protocol.ts:21–45`; `endpoints-real.mjs:8–62`; DESIGN `7–68`. These support the check contract.
- `ESS-S09`: README `22–95`; service and adapter files; `rebuild.test.mjs:264–322`. These support the shared CLI/LSP/MCP operation path.
- `ESS-S10`: DESIGN `1–110`; HANDOFF `48–61`; `endpoints-real.mjs:8–141`; `effect-verdict.mjs:11–62`; `rebuild.test.mjs:184–246`; evaluation ledger `56`. These support the bounded production-shaped worked consumer.
- `ESS-P04`: DESIGN `7–23`; `effect-verdict.mjs:29–60`; `endpoints-real.mjs:93–141`; `rebuild.test.mjs:208–246`. Disjoint complete bounds pass, overlap fails, and incomplete effects remain unresolved without opening a counterexample.
- `ESS-P06`: LSP implementation and diagnostic mapping at `lsp-server.mjs:5–43,45–126`.
- `ESS-P07`: six MCP tools at `mcp-server.mjs:5–114`; README `72–81`.
- `ESS-E02`: README `117–128`; DESIGN `38–48`; HANDOFF `114–122`; `rebuild.test.mjs:208–246`. The case does not establish analyzer completeness, wider PostgreSQL behavior, value correctness, external writes, or production refresh policy.
- `ESS-E07`: `endpoints-real.mjs:93–141`; `effect-verdict.mjs:11–62`; evaluation ledger `56`. Fixture responsibility is not explicitly documented.
- `ESS-E10`: HANDOFF `63–73,130–131`; `rebuild.test.mjs:264–322`. Real editor/MCP/agent use remains unfinished.
- `ESS-E13`: HANDOFF `1–11` and Stage 2 repository observation. The rebuild is working-tree state.

**Control-ledger status**

No recovered omission is needed as positive support. `ESS-E02/E07/E10/E13` remain gaps and scope controls. `BR-03` prevents the worked example from validating the general architecture.

**Intervention**

Narrate one bounded operational case from law and check contract through the three evidence outcomes, shared service operations, adapter-specific views, and the final consumer-policy handoff.

**Reader-promise hypothesis**

Kyle could inspect how the abstract model touches a production-shaped decision helper while seeing exactly where the example stops: before analyzer completeness, external writes, real client installation, and consumer enforcement.

**Form and scale**

Medium worked-case walkthrough with annotated operation sequence.

**Theoretical and evidence gaps**

`ESS-T09` leaves consumer fallback open. `ESS-E02`, `E07`, `E10`, and `E13` bound the case. No real agent, editor, MCP client, or broader Endpoints package was observed in Stage 2.

**Source status**

Bounded implementation and source-reported tests in an uncommitted rebuild. The decision helper is production-shaped; the evidence-base integration is not a production-readiness result.

**Injected choices**

- Use Endpoints as a narrative carrier rather than an architectural proof.
- Begin with pre-analyzed summaries and explicit authority because that is the actual fixture boundary.
- Show pass, fail, and unresolved symmetrically.
- Describe each adapter only where it exposes a distinct user interaction.
- End before consumer enforcement.

**Risks**

The vivid worked example can anchor generalization. “Production-shaped” can be misread as production-ready. A walkthrough may imply actual client operation despite only local shared-path integration tests.

**Relationships**

Instantiates parts of `OPU-01` and `OPU-02`; provides a concrete counterpart to `OPU-03`; terminates at the boundary isolated by `OPU-04`.

**Reconstruction note**

Every operation and limitation comes from `BR-03/09`, `ESS-S06/S09/S10/P04/P06/P07`, and `ESS-E02/E07/E10/E13`. The narrative ordering is injected. No analyzer behavior, agent-use result, generality claim, or consumer decision is added.

---

## `OPU-06` — When green is not new authority

**Public claim**

Four small failure witnesses explain why evidence maintenance needs monotonic freshness, invocation-relative replay causality, append-only resolution history, and a hard distinction between operational reach failure and correctness evidence.

**Upstream inputs and exact support**

- `ESS-H03`: Field Log `4054–4117,6297–6319`; v2 README `9–39`; v2 `evidence.json`; `kernel.test.mjs:388–558`. The repair witnesses are reproduced local defects and user-authorized repairs, not production Endpoints incidents.
- `ESS-P01`: `kernel.ts:360–387,559–568`; `kernel.test.mjs:243–256`; `rebuild.test.mjs:129–152`; fault control `57–60`. Reversion `a → b → a` does not revive old evidence.
- `ESS-P02`: `kernel.ts:409–465,513–539`; `kernel.test.mjs:513–558`; v2 README `18–22`. Completion order, batch order, or later delivery cannot impersonate later replay.
- `ESS-P03`: `kernel.ts:519–568`; `kernel.test.mjs:440–510`; v2 `model.json:R6/R7`. Resolution history persists while current applicability can expire.
- `ESS-P05`: `kernel.ts:32–43,415–510`; `kernel.test.mjs:215–230`; `rebuild.test.mjs:94–127`. Exceptions and unreachable paths stay out of evidence history.
- `LGI-V2-10`: v2 `M:R7:199–204` and boundary `355`, a **supported recovered compression** of invocation snapshot, no-cache, and ordering limits.
- `LGI-V2-18`: v2 `S:34–39`, `E:red:4–16`, `E:green:18`, `E:oracleRepairs:19–22`, `Q:control:15`, a **revision-specific observed-repair/control recovery**; aggregate public counts compressed the specific red/green witnesses and mutation controls.
- Negative controls: `ESS-X02`, `ESS-X03`, `ESS-X10` reject unrelated green erasure, identity-based revival, and treating failure to reach a checker as a correctness observation.

**Control-ledger status**

`LGI-V2-10` and `V2-18` remain revision-specific recovered material. The scenes are constructed/local regressions and mutation controls, not field incidents or independent validation.

**Intervention**

Present four compact “naive rule → counterexample → preserved invariant” scenes:

1. revision reversion;
2. stale invocation arriving late;
3. resolution reactivated by context change;
4. checker reach/exception failure excluded from evidence.

**Reader-promise hypothesis**

Kyle could inspect the maintenance invariants through executable-sized counterexamples without first absorbing the full architecture.

**Form and scale**

Small technical explainer, counterexample atlas, or RFC appendix.

**Theoretical and evidence gaps**

Distributed execution clocks and richer repair remain open under `ESS-T08`; the transaction boundary remains unclear under `ESS-E09`; scale remains unmeasured under `ESS-E12`.

**Source status**

Locally reproduced and source-reported tested repair evidence. No production failure or general validation is claimed.

**Injected choices**

- Select four witnesses rather than recount the entire repair history.
- Use each witness to expose one invariant.
- Keep the historical repair sequence secondary.
- Do not infer exhaustiveness or field frequency.

**Risks**

Executable failures may receive disproportionate salience. Readers may mistake generated tests for production incidents. The piece may be nested later inside `OPU-01`, though its counterexample-led intervention remains structurally distinct.

**Relationships**

Shares evidence with `OPU-01` but changes form, scale, and intervention. It can serve as a companion or appendix to `OPU-02` or `OPU-05`.

**Reconstruction note**

The four scenes and their limits are directly reconstructable from `ESS-H03/P01/P02/P03/P05`, status-preserved `LGI-V2-10/V2-18`, and the three rejection controls. Only the four-scene selection and presentation pattern are injected.

---

## Relationship clusters

These are descriptive relationships, not rankings.

- **Lifecycle and failure witnesses:** `OPU-01` and `OPU-06` share evidence. One reconstructs the whole authority lifecycle; the other uses small counterexamples.
- **Authoring and public operability:** `OPU-02` describes how evidence packages are designed and maintained; `OPU-03` asks which parts agents can manipulate through the current contract.
- **Abstract model and worked consumer:** `OPU-01` and `OPU-05` could form a sequence, with the latter remaining bounded to Endpoints.
- **Policy boundary:** `OPU-04` cross-cuts `OPU-01`, `OPU-03`, and `OPU-05` without selecting a policy.
- **Possible nesting:** `OPU-06` could become an appendix within `OPU-01` or `OPU-02`; `OPU-04` could become a bounded section elsewhere. Their standalone interventions and scales remain distinct enough to retain as candidates.
- **Shared evidence without duplication:** `OPU-03` and `OPU-05` both use CLI/LSP/MCP evidence, but the former is a contract-loss map and the latter a consumer walkthrough.

## Rejected generated samples

| ID | Attempted premise | Rejection reason |
|---|---|---|
| `OPU-R01` | “Three agent transports provide three independent corroborating views of evidence.” | Explicitly contradicted by `ESS-S09` and unavailable under `ESS-X09`: CLI/LSP/MCP share one service path and are not independent corroboration. |
| `OPU-R02` | “Missing or unresolved evidence should automatically block the consumer action.” | Selects an unsupported policy. `ESS-H06`, `ESS-T04`, `ESS-T09`, `ESS-X05`, and `LFG-X06` preserve strictness and fallback as unresolved and reject an unconditional veto. |
| `OPU-R03` | “The evidence base lets agents prove arbitrary registered checks sound.” | Unsupported and contraindicated. `ESS-T03` retains registered rule soundness as a trust root; `ESS-X07` rejects inferring a theorem prover from the design. |
| `OPU-R04` | “The three authoring workflows make coding agents more reliable and reduce correction rounds.” | No source establishes the outcome. `ESS-E03`, `ESS-E10`, `ESS-H05`, `LFG-H18`, and `LGI-V2-19` retain agent effectiveness as unmeasured. |
| `OPU-R05` | “Applicability should be a layered three-valued service combining base and rule matching.” | This silently settles `BR-06` and `ESS-T01`. A layered form is named as possible but remains unselected; the gap cannot support a resolved architecture. |
| `OPU-R06` | “Evidence Authority Timeline” as a renamed version of `OPU-01`. | Wording-only variant: same claim, mechanism, reader promise, form, and scale; rejected under admission rule 8. |

## Typed-handoff coverage

### Editorial brief

- **Used:** `BR-01`–`BR-05`, `BR-07`
- **Constraints:** `BR-06`, `BR-08`, `BR-09`
- **Gap:** `BR-10`

### Editorial Source Survey

- **Used as positive source signals:** `ESS-S01`–`ESS-S10`; `ESS-H03`–`ESS-H06`; `ESS-P01`–`ESS-P07`; `ESS-TOPO-03`–`ESS-TOPO-06`
- **Unused positive source signals in this coordinate:** `ESS-S11`, `ESS-S12`, `ESS-H01`, `ESS-H02`, `ESS-H07`, `ESS-P08`, `ESS-TOPO-01`, `ESS-TOPO-02`
- **Constraints or gaps:** `ESS-T01`–`ESS-T09`, `ESS-E01`–`ESS-E13`, `ESS-U01`–`ESS-U05`
- **Unavailable negative controls:** `ESS-X01`–`ESS-X10`

### Field Log → grammar Loss Audit

- **Used with recovered status intact:** `LFG-H05`, `LFG-H07`, `LFG-H08`, `LFG-H10`, `LFG-H13`, `LFG-H18`
- **Unused supported recoveries:** `LFG-H01`–`LFG-H04`, `LFG-H06`, `LFG-H09`, `LFG-H11`, `LFG-H12`, `LFG-H14`–`LFG-H17`, `LFG-H19`–`LFG-H26`
- **Unavailable negative controls:** `LFG-X01`–`LFG-X11`
- **Constraint:** `LFG-C01` — no majority-agreement drop was established
- **Gap:** `LFG-U01` — source revalidation, restoration, architecture, and candidacy remain unmeasured

### Grammar → agent interfaces Loss Audit

- **Used V1 recoveries:** `LGI-V1-03`, `LGI-V1-09`, `LGI-V1-14`
- **Unused V1 recoveries:** `LGI-V1-01`, `LGI-V1-02`, `LGI-V1-04`–`LGI-V1-08`, `LGI-V1-10`–`LGI-V1-13`, `LGI-V1-15`–`LGI-V1-31`
- **Used V2 recoveries:** `LGI-V2-02`, `LGI-V2-05`–`LGI-V2-12`, `LGI-V2-14`, `LGI-V2-15`, `LGI-V2-18`, `LGI-V2-19`
- **Unused V2 recoveries:** `LGI-V2-01`, `LGI-V2-03`, `LGI-V2-04`, `LGI-V2-13`, `LGI-V2-16`, `LGI-V2-17`, `LGI-V2-20`
- **Unavailable V1 negative controls:** `LGI-V1-X01`–`LGI-V1-X14`
- **Unavailable unsupported reaches:** `LGI-V1-U01`, `LGI-V1-U02`
- **V2 negative/unresolved controls:** `LGI-V2-X01`–`LGI-V2-X04`; `X01` and `X03` remain conservative/non-settlement constraints, while `X02` and `X04` remain explicit rejections
- **Constraint:** `LGI-C01` — sibling-pass agreement does not raise confidence and disagreement is not settled by vote
- **Gap:** `LGI-U01` — public-contract absence does not prove runtime absence

## Empty regions preserved

- No candidate claims that the authoring workflows improve agent performance.
- No candidate selects base-owned, rule-owned, boolean, three-valued, or layered applicability.
- No candidate chooses missing-evidence strictness, diagnostic severity, permission, or consumer fallback.
- No candidate treats Endpoints as independent generality evidence.
- No candidate claims hostile-process security, multi-writer durability, production readiness, or broad PostgreSQL behavior.
- No candidate proposes a rubric/source-inspection runtime because admission and acceptance semantics remain missing.
- No candidate uses external prior art or unopened donor literature.
- No candidate treats shared CLI/LSP/MCP parity as independent corroboration.

The operation itself may have favored operationally vivid failure scenes and typed interface losses over quieter authoring costs. It may also overstate interface absence because opaque service results were outside the Loss Audit’s public-contract boundary.

# Editorial Source Survey: the general evidence base

This is the Stage 2 source survey for the RFC. It inventories what the frozen
corpus can support, what it compresses, and what remains missing. It does not
generate an RFC thesis, candidate, title, pitch, or outline.

## Survey boundary and coverage

| Source | Exact examination coverage | Original status retained |
| --- | --- | --- |
| Optimistic-coherence and evidence-base Field Log | Canonical log validated through event 790; `field_log.md` read in full, lines 1–6337, including all 107 diary entries. Base-design concentration rechecked at lines 3763–4143, 6081–6257, and 6281–6337. | Mixed user testimony, historical source claims, instrument readings, implementation reports, and verification receipts. Later entries supersede earlier prototype-status reports where they conflict. |
| Oracle Guide | `oracle-guidance-reaudit/GUIDE.md`, lines 1–324, read in full. | Normative testing guidance with bounded historical examples and cited external sources; not a proof that any current checker satisfies the guide. |
| Base Design Grammar | Root `README.md`, `source.md`, `model.json`, `evidence.json`, `process.json`, and `freeze.json` read in full; v2 `README.md`, `model.json`, `evidence.json`, `process.json`, and `freeze.json` read in full. | Exploratory same-analyst grammar with provisional preservation, independent range untested. v2 is a user-authorized repair specification, not a rerun of the complete Design Grammar or an independent validation. |
| Current evidence-base prototype corpus | Entire `probes/evidence-base` file inventory read: `README.md`, `DESIGN.md`, `HANDOFF.md`, all three workflows, protocol, kernel, storage, service, CLI/LSP/MCP adapters, Endpoints example and real package, oracle utilities, demo, all tests, fault controls, package config, type config, and handoff verifier. The extracted production decision helper `probes/endpoints/integrated-todo/effect-verdict.mjs` and its re-export diff were also read. | Current implementation and documentation. The handoff calls the rebuild runnable but uncommitted. Stage 2 observed branch `codex/component-endpoints-prototype` at `4ad19815b44be533ac10f90b62aca4377f5138d2` with the rebuild present as working-tree changes. |
| Evaluate-review ledger | `/private/tmp/evaluate-review-oracle-design-ledger.md`, lines 1–91, read in full. | Lossless review reconciliation: 25 findings, 5 confirmed-open, 13 already-fixed, 4 refuted, 2 deferred, and 1 unresolved design decision. No repair was authorized or applied by that review. |

The source boundary excludes fresh external research. Donor primary literature,
older Process Grammar bodies, the frozen hostile/fracture audit snapshots, and
the full SQL analyzer were not reread as independent sources. Their claims enter
only through the registered Field Log, frozen grammar, v2 repair, current
handoff, and evaluation ledger. No Stage 2 test rerun was performed; current
behavioral results below are source-reported and are identified as such.

## Completed seams

These are places where the corpus has already done enough explanatory work to
support editorial use without silently repairing theory.

| ID | Source-grounded reading | Exact support | Claim kind and recorded status | Confidence | Largest honest scale |
| --- | --- | --- | --- | --- | --- |
| S01 | The system has four ownership layers: the base owns generic evidence mechanics; claim packages own domain laws, rules, checks, and semantic matching; authoring workflows help humans and agents design and maintain those packages; consumer policy decides permission and severity. | Field Log 3875–3887; grammar README 9–17, 32–50; `model.json` P1/R1/R9; workflows README 13–28; prototype README 9–16, 134–154. | User requirement, then provisional design, then partially implemented architecture. Policy remains intentionally outside the base. | Solid for the chosen separation; untested as a general product architecture. | Full RFC |
| S02 | The reusable logical core consists of claim, observation, registered rule, argument, applicability condition, and challenge. Runs are shared provenance and tasks are projections of gaps rather than new sources of authority. | grammar README 14–21; `model.json` C1–C6; `process.json` demotions A-run/A-task/A-score/A-package/A-policy; `kernel.ts` 17–97. | Provisional Design Grammar represented directly in the kernel except for the grammar’s richer applicability primitive. | Solid as source reconstruction and implementation description; independent range untested. | Full RFC |
| S03 | Support is an AND/OR argument structure: premises within a route are jointly required, while routes for the same claim are alternatives. A flat gap list is only a deduplicated inventory. Cycles cannot ground themselves. | grammar `source.md` 64–74; v2 README 9–13, 29–32; v2 `model.json` E2/R2/R8; `kernel.ts` 570–704; `kernel.test.mjs` 92–128, 289–306, 388–438. | Provisional relation repaired into a chosen bounded implementation contract and covered by generated tests. | Solid inside the finite prototype model. | Full RFC |
| S04 | Evidence lifecycle is append-oriented: observations retain what happened; a failing observation opens a challenge; unrelated green evidence does not clear it; resolution requires a causally later exact replay; resolution history persists while its current authority can expire. | grammar `source.md` 98–106; v2 README 14–27; v2 `model.json` E5/R4–R7; `kernel.ts` 468–568; `kernel.test.mjs` 130–213, 440–558; Field Log 4054–4117, 6297–6319. | Design relation, audit-discovered failure, user-authorized repair, implemented behavior, and generated test result. | Solid for exact-claim, exact-case, local-process prototype histories. | Full RFC |
| S05 | “No evidence,” “unresolved observation,” “observed contradiction,” “checker did not run/reach,” and “consumer disallows use” are different states. The base currently reports only evidence status; policy is separate. | Field Log 6169–6225; grammar README 25–31, 46–50; Oracle Guide 239–276, 296–310; `protocol.ts` 1–50; `kernel.ts` 99–104, 433–465, 570–637; workflows README 26–28. | User decisions, normative guidance, design rule, and implemented three-valued check outcome. | Solid for the distinctions; strictness and permission policy are unresolved. | Full RFC |
| S06 | A check becomes credible evidence only through a declared contract tying a law and source to a bounded domain, reference, production path, checkpoint, observations, omissions, reach witness, fault controls, and replay. | Oracle Guide 17–41, 102–122, 239–276, 312–324; `protocol.ts` 21–45; `endpoints-real.mjs` 8–62; DESIGN 7–68. | Normative guidance instantiated as a validated data contract and one bounded Endpoints check card. | Solid as a contract shape; checker/analyzer soundness remains outside it. | Full RFC |
| S07 | Three evidence routes remain distinct: deterministic/static certificate, scoped empirical/oracle evidence, and rubric-assessed source inspection. They are not a universal weak-to-strong score. | grammar README 35–37; `model.json` F1–F3; `workflows/design-check.md` 28–44; evaluation ledger 74. | Provisional adjacent forms and packaged authoring guidance. Only certificate/empirical paths have code-shaped examples; rubric admission is deferred. | Solid as a design distinction; implementation range is incomplete. | Section |
| S08 | The authoring lifecycle is packaged as three separate procedures: design a claim/check, establish and maintain evidence, and repair a claim or checker after contradiction or changed guarantees. These workflows preserve scope, counterexamples, replay, and trust limits. | Field Log 3881–3887, 4008–4022; workflows README 1–28; `design-check.md` 1–87; `maintain-evidence.md` 1–33; `repair-rule.md` 1–32. | User-required workflow split and draft prose procedures. No agent effectiveness evaluation has run. | Solid as documented procedure, unmeasured as agent tooling. | Section |
| S09 | CLI, LSP, and MCP are adapters over one serialized service, so transport parity is intentionally shared-path consistency rather than independent corroboration. | README 22–95; `service.mjs` 45–131; `cli.mjs` 1–71; `lsp-server.mjs` 5–194; `mcp-server.mjs` 5–163; `rebuild.test.mjs` 264–322; evaluation ledger 57. | Implemented local interfaces with a shared integration test. | Solid for the tested operation layer; distribution and real-client integration remain open. | Section |
| S10 | Endpoints now supplies one production-shaped worked consumer, `endpoints/safe-skip-refetch@1`, without becoming the base architecture. It exercises the extracted production decision helper over pre-analyzed summaries and explicit authority state. | DESIGN 1–110; HANDOFF 48–61; `endpoints-real.mjs` 8–141; `effect-verdict.mjs` 11–62; `rebuild.test.mjs` 184–246; evaluation ledger 56. | Bounded implementation and test result. The analyzer, external writes, consumer enforcement, and wider PostgreSQL behavior remain outside the claim. | Solid for the decision kernel’s declared domain. | Section |
| S11 | The current persistence boundary verifies a package-bound checksummed state envelope, validates internal references on import, and writes by temporary file plus atomic rename. It detects corruption, not a hostile actor, and it does not coordinate independent writers. | `storage.mjs` 6–66; `kernel.ts` 208–357; `rebuild.test.mjs` 154–182; README 96–116; HANDOFF 42–45, 125–133. | Implemented local mechanism and bounded tests. | Solid for in-process/local-file behavior; not security or multi-process durability. | Section |
| S12 | The prototype has a traceable evolution: exploratory grammar, first bounded kernel, fracture/hostile findings, v2 repair, and a later rebuild adding verified storage, dependency-selective freshness, one real check, and three interfaces. | Field Log 3984–4117, 6297–6335; v2 README 1–39; HANDOFF 1–11, 94–138. | Historical sequence with preserved status labels. Current rebuild is working-tree state, not a published package. | Solid as provenance; commit history and current worktree status require separate wording. | Section |

## Supporting shadows

These are source regions that current summaries tend to reduce to supporting
detail. Their omission would not contradict the headline architecture, but it
would remove important limits or design rationale.

| ID | Reduced source material | Exact support | Claim kind and recorded status | Confidence | Largest honest scale |
| --- | --- | --- | --- | --- | --- |
| H01 | The “Lean for programming evidence” analogy expresses the desired separation between a small checker and claim-specific proof systems, but unlike Lean the base trusts registered rule code and does not prove arbitrary checker soundness. | Field Log 3875, 6281; grammar README 46–57; `model.json` R1/U1; `kernel.ts` 45–53, 186–205. | User analogy constrained by explicit design and implementation trust boundaries. | Solid as a contrast; analogy should not be treated literally. | Section |
| H02 | The six primitives came from a richer source topology containing three unranked arrangements: obligation-centered argument routes, execution history with assessed uses, and shared investigations projected from gaps. Each view hides something when used alone. | grammar `source.md` 152–162; `model.json`/`process.json`. | Structural Recombine result, same-analyst and unranked. | Plausible; not selected architecture. | Section |
| H03 | The current green test count hides a productive repair episode: the first explanation erased AND/OR completion sets, repair authority survived stale context, and delivery order could impersonate replay causality. The v2 rules exist because concrete witnesses failed the earlier design. | Field Log 4054–4117, 6297–6319; v2 README 9–39; v2 `evidence.json`; `kernel.test.mjs` 388–558. | Reproduced local defects and user-authorized repairs; not production Endpoints bugs. | Solid within the constructed model. | Section |
| H04 | The Oracle Guide is a portfolio discipline, not merely a `CheckContract` schema: it separates law selection, history reach, fixture responsibility, observation, checker sensitivity, reduction fidelity, cleanup, replay, and retained larger promises. | Oracle Guide 72–108, 124–199, 201–324; evaluation ledger 54–62. | Normative guide plus review dispositions. | Solid as guidance; only a subset is exercised by the snapshot check. | Full RFC |
| H05 | The source repeatedly separates diagnostic validity from repair-guidance validity and suggests matched agent correction evaluations. The current workflows mention editable repair targets, but no agent workflow evaluation or contextual diagnostic renderer exists. | Field Log 4126–4137; `workflows/design-check.md` 46–60; HANDOFF 130–131. | Donor-derived design observation and deferred evaluation idea. | Plausible transfer, unmeasured. | Section |
| H06 | Missing-evidence strictness was deliberately left open: a warning may coexist with enabled behavior, while an actual relevant contradiction has a different response. A single universal fallback rule would overwrite this source decision. | Field Log 6209–6225; grammar `source.md` P16 and rejected recombinations 164–176; `model.json` P7/R9/U4. | User decision and design constraint. | Solid that separation is required; no concrete policy chosen. | Section |
| H07 | Exact identity, global epochs, and same-claim failure retention are conservative prototype boundaries. Their simplicity is part of the current design, not evidence that semantic equivalence, selective expiry, or cross-version mapping are impossible. | v2 README 24–27; v2 `model.json` boundary conditions; HANDOFF 135–138; evaluation ledger 67, 73. | Explicit prototype boundary and unresolved design space. | Solid. | Section |

## Concrete particulars

These mechanisms and scenes can support close explanation without carrying more
scope than their sources provide.

| ID | Particular | Exact support | Claim kind and recorded status | Confidence | Largest honest scale |
| --- | --- | --- | --- | --- | --- |
| P01 | Dependency freshness uses a monotonic revision: fingerprint `a → b → a` leaves the old observation stale rather than reviving it. | `kernel.ts` 360–387, 559–568; `kernel.test.mjs` 243–256; `rebuild.test.mjs` 129–152; fault control 57–60. | Implemented behavior, direct regression test, mutation sensitivity. | Solid in the prototype. | Section |
| P02 | A pass whose check started before a failure cannot resolve that failure merely because its result arrived later; a later observation in the same returned batch is also rejected. | `kernel.ts` 409–465, 513–539; `kernel.test.mjs` 513–558; v2 README 18–22. | Implemented causality proxy and generated test. | Solid locally; distributed execution clocks remain open. | Section |
| P03 | Resolution is append-only history plus current applicability: after a resolution, a context change can reactivate the original challenge until a new exact replay is linked. | `kernel.ts` 519–568; `kernel.test.mjs` 440–510; v2 `model.json` R6/R7. | Implemented conservative lifecycle and generated test. | Solid in the global-epoch model. | Section |
| P04 | The Endpoints worked case yields three evidence outcomes from the same law: disjoint complete bounds can pass, overlapping bounds fail, and incomplete effects remain unresolved without opening a counterexample. | DESIGN 7–23; `effect-verdict.mjs` 29–60; `endpoints-real.mjs` 93–141; `rebuild.test.mjs` 208–246. | Bounded implementation and test observation. | Solid for the supplied summaries and decision helper. | Section |
| P05 | The base records one run with several separately assessed observations and keeps checker exceptions or unreachable production paths out of evidence history. | `kernel.ts` 32–43, 415–510; `kernel.test.mjs` 215–230; `rebuild.test.mjs` 94–127. | Implemented behavior and tests. | Solid. | Section |
| P06 | The LSP turns a supported claim into no diagnostic, a contradicted claim into an error, and an unresolved claim into a warning; it also exposes the general operation layer as `evidence.request`. | `lsp-server.mjs` 5–43, 45–126; README 56–70. | Implemented editor adapter. The severity mapping is adapter behavior, not a settled universal policy. | Solid as current code. | Section |
| P07 | The MCP adapter advertises six tools—status, assess, run the Endpoints check, history, context, and resolve—and returns both text and structured results through the shared service. | `mcp-server.mjs` 5–114; README 72–81. | Implemented local stdio adapter. | Solid as current code; real agent registration is untested. | Section |
| P08 | The checksum protects accidental or out-of-band modification only when the actor cannot also rewrite the state and checksum. The code explicitly declines to be a signature or hostile-process boundary. | `storage.mjs` 8–39; `kernel.ts` 186–189; README 113–116; evaluation ledger 77. | Implemented integrity check with explicit negative security claim. | Solid. | Section |

## Theoretical gaps

These require a design decision, stronger semantics, or a changed claim. More
testing of the existing implementation cannot resolve them by itself.

| ID | Gap | Exact support and original status | Largest honest scale |
| --- | --- | --- | --- |
| T01 | Who owns applicability, and what can it return? The grammar specifies a rule-owned captured/requested-context relation with explicit unknown; the kernel implements a private base-owned boolean exact matcher. Ownership and result cardinality are separate choices; a layered design is possible but unselected. | `model.json` C5/E4/R3; `kernel.ts` 552–568; evaluation ledger 67 (sole `design-decision`); frozen Essay brief. | Full RFC |
| T02 | Semantic claim equivalence, scope subsumption, and cross-version counterexample mapping have no generic rule. Exact canonical JSON identity is only the prototype boundary. | `kernel.ts` 106–129; `model.json` U2/U3; HANDOFF 135–137. | Section |
| T03 | Registered rule soundness is a trust root. The base can establish that registered code was invoked and its declared steps were traversed, not that arbitrary rule, rubric, analyzer, or oracle semantics are correct. | grammar README 46–57; `model.json` R1/U1; Oracle Guide 72–75, 141–151; HANDOFF 132–138. | Full RFC |
| T04 | Missing-evidence severity, consumer permission, check levels, confidence aggregation, and investigation priority remain project policy or future design. No universal score or order is justified. | grammar README 46–50; `model.json` R9/U4/U7; Field Log 6209–6225; HANDOFF 135–138. | Section |
| T05 | Complete context capture and hidden semantic dependency discovery are unsolved. Explicitly named fingerprints make applicability inspectable but do not prove that all relevant code, data, method, configuration, environment, or external inputs were named. | `model.json` P8/U5; grammar README 52–64; `protocol.ts` 3–19; HANDOFF 39–41. | Section |
| T06 | Speculative challenges and observed counterexamples do not yet have separate API objects. Current `Challenge` instances arise only from failing observations. | `kernel.ts` 61–66, 500–508; evaluation ledger 70; HANDOFF 135–138. | Section |
| T07 | Source-inspection/rubric admission is part of the grammar’s adjacent-form space but has no runtime representation or acceptance protocol in the prototype. | `model.json` F3; `workflows/design-check.md` 36–40; evaluation ledger 74. | Section |
| T08 | Alternate-strategy repair, selective resolution expiry, and durable repair certificates remain outside the conservative exact same-case replay model. | v2 README 24–27; `model.json` U3 and boundary conditions; HANDOFF 135–138. | Section |
| T09 | The consumer fallback contract is unselected. The evidence package reports support; it does not itself enable an optimization, suppress a refresh, or repair open clients. | DESIGN 20–23, 97–110; HANDOFF 54–61, 120–122; workflows `repair-rule.md` 24–28. | Section |

## Evidence and implementation gaps

These could be narrowed by tests, observations, packaging work, or deployment
experience without first solving the full theory.

| ID | Gap | Exact support and original status | Largest honest scale |
| --- | --- | --- | --- |
| E01 | Independent range is untested. Endpoints helped construct the grammar and cannot validate generality; v2 was not followed by a new complete Design Grammar or independent post-fix audit. | grammar README 59–64; `evidence.json` range; v2 README 3–7, 34–39; v2 `process.json` `noClaim`; evaluation ledger 78. | Full RFC |
| E02 | The current Endpoints oracle exhausts small read/write-set intersection but does not establish SQL analyzer completeness, wider PostgreSQL behavior, value correctness, external-write behavior, or production refresh policy. | README 117–128; DESIGN 38–48; HANDOFF 114–122; `rebuild.test.mjs` 208–246. | Section |
| E03 | The three authoring workflows have not been exercised and audited with coding agents. Their usefulness, correction rounds, and tendency to self-certify remain unmeasured. | Field Log 4008–4022, 4132–4137; HANDOFF 135–138. | Full RFC |
| E04 | Failure-report provenance is narrower than the Oracle Guide: no complete object stores environment, seed/schedule, expected/actual, original/reduced trace, reproduction class, and cleanup diagnostics. | Oracle Guide 255–276; evaluation ledger 61 (`OG-08`, confirmed-open); `protocol.ts` 21–50; `kernel.ts` Observation. | Section |
| E05 | Fault controls are assertion-killed, but the durable design record lacks a machine-readable per-mutant outcome and exact execution witness. | Oracle Guide 239–253; `fault-controls.mjs` 10–105; evaluation ledger 58 (`OG-05`, confirmed-open). | Section |
| E06 | The implementation retains original, reduced, and replayed violation traces, but DESIGN abbreviates the mechanism and does not preserve the full reported fidelity. | `oracle-tools.mjs` 1–42; `rebuild.test.mjs` 248–262; evaluation ledger 59 (`OG-06`, confirmed-open). | Sentence/section |
| E07 | The Endpoints documentation does not explicitly allocate fixture responsibility: the fixture supplies pre-analyzed query/mutation summaries and authority; `canSkipRefetch` computes only the bounded verdict. | `endpoints-real.mjs` 93–141; `effect-verdict.mjs` 11–62; evaluation ledger 56 (`OG-03`, confirmed-open). | Sentence/section |
| E08 | Multi-process persistence can lose updates. Requests are serialized only within one service process, and the atomic rename does not supply a file lock or single-daemon boundary. | README 22–34, 129–131; `service.mjs` 45–131; `storage.mjs` 54–66; HANDOFF 125–129. | Section |
| E09 | `runCheck()` updates in-memory dependency context before a reach failure, while the service skips persistence when that operation throws. The execution/context transaction boundary is not explicit. | `kernel.ts` 438–465; `service.mjs` 99–108; HANDOFF 125–127. | Section |
| E10 | The CLI/LSP/MCP code exists and shares semantics in a local integration test, but editor configuration, MCP registration, schema/range quality, installation, distribution, and real-agent use are unfinished. | HANDOFF 63–73, 130–131; `rebuild.test.mjs` 264–322. | Section |
| E11 | Signatures, authentication, hostile-plugin isolation, remote execution, and provenance against a controlling actor are absent. | `kernel.ts` 186–189; README 113–116, 152–154; HANDOFF 132–138. | Section |
| E12 | No scale evidence covers large argument graphs, storage growth, recursive route-report size, or operational performance. | v2 `model.json` boundary conditions; HANDOFF 135–138. | Section |
| E13 | The rebuild is runnable but is current working-tree state rather than a committed, released, or installed base package. | HANDOFF 1–11; Stage 2 repository-status observation at HEAD `4ad19815…`. | Sentence/section |

## Descriptive source topology

The corpus has several overlapping shapes:

1. **A long evolutionary sequence.** The Field Log preserves problem discovery,
   donor recombination, user ownership decisions, Design Grammar, prototype,
   fracture/hostile audits, v2 repair, and a later implementation rebuild. This
   sequence breaks where historical entries describe earlier prototype states;
   current code and handoff must be used for present-tense claims.
2. **A dense conceptual spine.** The grammar’s six primitives, five relations,
   ten rules, adjacent forms, and unresolved questions hold most of the reusable
   semantics. This shape breaks at applicability: the kernel implements a
   smaller exact matcher than the grammar describes.
3. **A mechanism chain.** A claim receives proposed arguments; registered rules
   inspect observations and expose required premises; assessment traverses
   alternative routes; current failures defeat support; exact replays can append
   resolutions; dependency/context changes can withdraw current authority. This
   chain breaks before consumer action, which is intentionally outside the base.
4. **Parallel ownership layers.** Base mechanics, domain packages, authoring
   workflows, consumer policy, and transport adapters can be inspected side by
   side. The layers are coupled by contracts, but the source contains no stable
   packaged extension API that makes those boundaries deployable.
5. **A compact worked-example cluster.** The Endpoints safe-skip claim connects
   the general model to a real decision helper, an independent small-set oracle,
   dependency fingerprints, and CLI/LSP/MCP access. It breaks before the SQL
   analyzer, production policy, and external-write guarantees.
6. **An audit-and-repair loop.** Oracle Guide controls and Design Grammar
   invariants were used to expose losses, then red/green tests and mutation
   controls repaired a bounded model. It breaks as general validation because
   the cases are constructed, the author shares context, and independent range
   remains untested.

No one topology subsumes the others. Treating the corpus only as a graph hides
workflow and policy cost; treating it only as a history misses claims with no
checks; treating it only as tasks can hide argument routes and provenance.

## Rejected and contraindicated reductions

The source directly contraindicates several editorial or architectural moves:

- Do not present green-test counts, seeds, or weights as a universal confidence
  score or independent votes.
- Do not let a newer unrelated pass erase an applicable counterexample.
- Do not let exact byte identity or a code reversion revive old authority.
- Do not let one generic `validates` edge collapse observation, inference,
  support, task closure, and consumer permission.
- Do not turn every unresolved claim into an automatic failure or optimization
  veto; the strictness policy is unselected.
- Do not present full refetch as universally safe; effects may not yet have
  completed.
- Do not infer a theorem prover, graph database, authentication rewrite, remote
  authority service, or mandatory independent reviewer from the representational
  design.
- Do not use the Endpoints vertical as independent evidence that the grammar
  generalizes.
- Do not call shared CLI/LSP/MCP service parity independent corroboration.
- Do not call inability to start or reach a checker a correctness observation.

Support: grammar `source.md` 164–176; grammar README 44–64; Oracle Guide
239–310; evaluation ledger 54–78.

## Unexamined regions

- Primary donor literature and external prior art were not reopened. Their
  transfer claims remain whatever the frozen grammar and Field Log say they are.
- The full SQL analyzer, parser, schema machinery, and broader Endpoints package
  were not inspected; only the extracted decision helper and the evidence
  package that calls it were examined.
- Frozen base-stress witness bodies and snapshot manifests were not reread; their
  findings were examined through the Field Log, v2 repair, tests, handoff, and
  evaluation ledger.
- No CLI process, editor client, MCP client, concurrent writer, hostile process,
  large graph, or coding agent was observed in Stage 2.
- No outside reader has checked this survey’s coverage or source interpretation.

## Control, distortion, and stopping point

Every signal above retains a source pointer, original claim kind/status, and an
editorial scale. Current implementation claims are separated from normative
guidance, user requirements, provisional design inferences, audit dispositions,
and source-reported test results. The evaluation ledger was used to prevent
documentation losses from being mistaken for missing implementation, and the
current files were used to prevent earlier Field Log states from being presented
as current.

This operation can still distort the material. The large, graph-shaped grammar
made formal relations easier to see than human rule-authoring cost. The vivid
audit failures can receive attention merely because they have executable scenes.
The Endpoints vertical can anchor apparently general choices. Conversely,
calling a detail a “shadow” can award it an omission bonus it has not earned.

The survey stops here because additional reading inside the selected corpus
would repeat covered regions. A targeted loss audit has a real calling signal:
the frozen grammar and current prototype are reductions of the much richer Field
Log and Oracle Guide, and the existing evaluation ledger already identifies
specific losses. Running another audit would only be useful if its comparison is
narrowed to a new reduction, such as **Field Log → grammar** or **grammar → public
agent interfaces**. A residue collection has no equally specific calling signal:
no single named frame is currently being asked to absorb the whole corpus.

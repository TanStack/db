# Source-guarantee grammar — frozen v1

Exploratory Design Grammar run26. Source and preservation contract: [PRESERVATION.md](PRESERVATION.md), with trace in [sources.json](sources.json). This grammar describes the existing analysis/metadata/runtime path and bounded extensions. It does not derive from the previous uninstrumented design draft. No application behavior change is selected.

## Observed arrangement

The current compiler reads ordinary handler/helper ASTs, resolves database/table bindings against a build snapshot, emits dependencies or null, and returns diagnostic reasons. The same proof result supplies runtime dependency matching. Generated registry functions retain the submitted handler bodies. Known query dependencies are all discovered SELECT relations; they are not a field-sensitive explanation of only the rows returned. Mutation SELECTs do not enter its may-write footprint. The helper interpreter unions branches and failure paths; an unknown call aborts the complete proof.

These are scope-limited observations, not a proof that current analysis has no bugs. Six compiler controls recover these distinctions (E1–E6).

## Surviving candidate units

| ID | Unit | Role and source |
|---|---|---|
| U1 | Subject: an ordinary code region plus its reachable bindings and build context | Specifies what a claim is about; S1/S2/S3. An endpoint/helper name is identity, not semantics. |
| U2 | Evidence-bearing claim with known or unknown status | Current instance: dependency set/null, source files, fingerprint and reason; S1–S3. Extending it to typed claims and partial observations is an inference. |
| U3 | Consumer rule: which claim and runtime conditions justify which action | Current instance: unknown/intersection/baseline/optimism selection and revision reuse; S4/S5. General obligation checks are inferred, not existing proof certificates. |
| U4 | Feedback: a source-located obstruction and an author-owned revision proposal | Current seed: dependencyDiagnostics.reason; S3. Trace, suggestions and edit/reanalyze loop are proposed under user P2. |

Rejected units: “auth guard” (not a special primitive), provider brand (boundary value), annotation (text, not evidence), subscriber status (not proof), diagnostic suppression (presentation only), a separate universal “safe” bit (erases the claim's scope). Schema metadata is evidence for U2; a runtime retained set is input to U3. Neither needs a second copy of the same concept as a primitive.

## Relations and active overlaps

L1: U1 grounds U2. Bindings/schema/source identity are part of the claim, not just a pretty source link.
L2: U2 feeds U3. Consumers must ask for the right kind of claim, not treat any successful analysis as permission for every optimization.
L3: U2 also feeds U4. The same missing evidence should explain a runtime decision and a lint message, so separate optimistic stories cannot disagree.
L4: U4 can lead an author/agent to edit U1; the edited source must be analyzed again before U2 changes. The diagnostic has no direct authority edge to U3.

The U2∩U3 overlap is active: the meaning of “dependency” matters at the exact point a whole invocation may be omitted. The U2∩U4 overlap is also active: a complete runtime proof cannot be assembled from fragments merely because a lint can describe them. These are two projections of evidence with different authority, not independent truth stores.

There is a real existing module interface from analysis result to compiler/runtime. S6 supplies integration controls for footprint discovery. There is no existing tested interface establishing general behavioral substitutability, policy lifetime or complete background-work closure. Do not describe those proposed boundaries as proven modules.

## Rules and invariants

R1 — Source owns behavior (P1/P3). Analyze ordinary calls. No rule inserts, deletes, lifts, memoizes or splits auth. Existing mechanical server/client packaging is the source arrangement; preserving a handler's AST alone does not prove all invocation behavior.

R2 — Preserve claim scope (P4/P6). A complete relation footprint, a pure payload, absence of effects, value/input dependence, and permission to reuse an endpoint result are different assertions. Only the first is emitted by the examined helper proof. Do not relabel a set of tables as all the other assertions.

R3 — Unknown composes conservatively (P4/P9). An unresolved reachable call makes the complete footprint unknown. Diagnostic-only observations may survive, but do not feed a consumer requiring completeness. Known-empty and unknown remain distinct. A detected query write is a different reason from an unresolved helper.

R4 — Evidence is contextual (P5/P8). Preserve database authority/schema/source binding and version assumptions. Runtime matching does not query catalogs. Source edits require reanalysis and new identity where existing versioning requires it. An agent's assurance or a lint suppression is not a substitute for evidence.

R5 — Consumers have separate obligations (P6/P7). Recipient pruning, omission of a whole invocation, revision reuse, and encoding results already read are distinct actions. A rule must state which evidence and live baseline/input/optimism conditions it needs. Preserve existing unconditional authority needs for missing baselines and optimistic recipients. This run does not prove a complete whole-handler reuse rule.

R6 — Feedback cannot grant authority (P2). A lint names the source/call path, missing or adverse fact, and blocked action. Any behavior-changing suggestion is an explicit author edit with stated consequences and tests; reanalyze the result. No automatic auth refactor.

R7 — Fallback has a bounded meaning (P9/P10). Missing optimization proof runs ordinary code. Do not infer a stronger permission, convergence or effect-closure promise from that fallback. Tests must assert the claimed law across generated cases; selecting all reads is not itself the oracle.

## Dynamics, constraints, boundaries

Dynamics: code/bindings → analysis evidence → consumer decision and diagnostic → optional explicit source edit → new analysis. Constraints: R1–R7/P1–P10. Boundary conditions: supported syntax/driver, schema snapshot and deployment match, endpoint identity/input/context, consumer's actual contract, and whether effects complete inside returned promises. Conditions outside the examined static model remain unknown, not supplied by invented runtime auth.

## Conflicts and unresolved inputs

C1: Existing consumers use relation footprints to select entire handlers; those footprints alone do not describe every observable behavior. The additional whole-invocation reuse contract is unresolved. This is a claim-scope gap, not a demonstrated new exploit.
C2: Developer feedback benefits from retaining partial observations, while complete runtime proofs must reject unknown paths. The grammar preserves both: diagnostic observation and complete evidence cannot be silently merged.
C3: Ordinary opaque code remains executable, but it may not satisfy a desired cross-collection freshness law when reads write. No auth restructuring is available to resolve this automatically. Whether a stronger guarantee is supported must be explicit.
C4: App-owned request/context/auth lifetime is not derived from table sets. No request-context API or always-rerun-auth policy is selected.
C5: Build evidence is conditional on supported code/library/schema/deployment assumptions; those assumptions are not a runtime schema-validation mandate.

User authority resolves the earlier compiler-rewrite option: it is excluded. No priority is selected among the unresolved application policy and support-contract questions above.

## Two distinct adjacent forms

F1 — **Evidence-linked lint extension.** Route: augment the existing proof→diagnostic path. Keep runtime footprint matching unchanged; enrich reasons with source/call trace, distinguish missing proof from observed writes, and produce optional author-edit proposals. Preserves P1–P10 as scope constraints and both evidence/diagnostic overlaps. New structure: diagnostic-only partial observations plus explanation of the blocked action. Cost: retain trace after a failed analysis without accidentally publishing partial sets. Loss/limit: no new runtime optimization or solved reuse contract; it can explain current limits without removing them.

F2 — **Obligation-checked optimization emission.** Route: rule combination over the same source evidence. Add a compile-time consumer check which emits eligibility only for named optimizations whose proof requirements are met; leave dynamic baseline/input/optimism checks at runtime. The application body remains intact. Preserves P1–P10 and L1–L4. New structure: typed proof requirements for each optimization, not an auth DSL. Cost: specify and oracle-test each consumer law; a stronger rule may withdraw existing skips. Loss/limit: current footprint results may establish fewer optimizations than hoped; no Kitchen speedup or complete invocation-reuse criterion is demonstrated.

F1 changes how failed evidence reaches an author; F2 changes what reaches an optimization consumer. They can coexist and are not competing configuration flags. A third UI/CLI presentation variant was rejected as cosmetic. A generated guard/payload split was rejected by P1, even if it could be made technically correct. These are unranked generated extensions, not adopted architecture.

## Decomposition loss and range

Footprints compress away execution order, permission/error meaning, precise result-field dependencies and detached work. The grammar names those losses and prevents extrapolation; it does not reconstruct the omitted runtime semantics.

No independent held-out system was supplied. All six controls were used for extraction/reconstruction, so **independent range is untested**. No fresh evaluator or other instrument was run. Source-level helper support is not evidence of universal SQL/auth-library support.

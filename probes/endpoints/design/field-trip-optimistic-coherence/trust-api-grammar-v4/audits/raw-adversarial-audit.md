Base: `trust-api-grammar-v4/`

A-01 — High — `PRESERVATION.md:3` — “Exact-equivalence” and “frozen” are not reproducible claims. The entire v4 directory and donor sources are untracked relative to `4ad19815…`; the manifest has no commit, whole-package digest, tool version, or run transcript. A later edit can preserve individual source hashes while changing the analysis. Repair: commit the artifact or record a tree digest, generator version, exact timestamp, and immutable run ledger.

A-02 — High — `PRESERVATION.md:14` — Calibration is preserved only as a named field, without defining calibration population, metric, uncertainty, validity interval, evaluator configuration, or drift response. A stale or cherry-picked “calibration basis” string satisfies the grammar. Repair: define an admitted, versioned calibration-evidence object and hostile cases for distribution shift, subgroup failure, and expired calibration.

A-03 — High — `PRESERVATION.md:23` — Distinct clocks are listed but their ordering and time authorities are absent. An override can expire while a check runs, a lease can be reassigned while the old worker commits, or config can change between snapshot and deployment with no specified result. Repair: define clock domains, captured evaluation time, happens-before rules, and race matrices.

A-04 — High — `PRESERVATION.md:26` — “Causal repair” lacks an enforceable causal predicate. The prototype’s `kernel.ts:519` accepts a current same-claim/same-case pass from an unrelated producer as a resolution; I reproduced that acceptance. Repair: require a repair operation naming challenged observation, changed artifact, affected uses, admitted method/version, authority, and causal predecessor, then test unrelated passes and concurrent pre-existing runs.

A-05 — High — `PRESERVATION.md:32` — “Cannot authorize their own trust roots” has no authenticated principal, root authority, or separation-of-duty model. Actor labels and package provenance can be self-asserted, colluded, or impersonated. Repair: define authority roots, authenticated identities, proposal/admission conflict rules, delegation, revocation, and compromise recovery.

A-06 — High — `PRESERVATION.md:35` — Scoped expiring overrides have no precedence or commit-time semantics. Conflicting project, rule, endpoint, and profile overrides can all be “active,” and a pre-expiry evaluation can authorize a post-expiry deployment. Repair: specify precedence, conflict rejection, clock source, snapshot time, and deployment-time revalidation.

A-07 — High — `PRESERVATION.md:47` — Bounded completeness is asserted despite missing operational primitives for principals/capabilities, package loading, clocks, lease fencing, multi-writer transactions, and cursor retention. The model can name states but cannot yet represent their decisive transitions. Repair: add explicit counterexample reconstructions showing every promised state and race is representable without hidden structure.

A-08 — Medium — `MODEL.md:24` — `EntityRef<T>` does not define tenant/project/branch namespace, collision behavior, or the relationship among semantic version, definition hash, and package name. Two local modules can claim the same code/version with different bytes. Repair: specify canonical identity and collision rejection; test same-version/different-hash, local/package shadowing, and branch coexistence.

A-09 — High — `MODEL.md:34` — An “ordinary versioned code module” can execute top-level code before admission or inspection. A malicious local/package module can modify the store or environment while merely being discovered. Repair: separate inert manifest discovery from executable method loading, pin dependency graphs, and define sandbox/capability boundaries before registration.

A-10 — High — `MODEL.md:43` — A source-controlled `trust.config.ts` is executable and need not resolve deterministically. Identical source bytes can read environment/time or changed imports and produce different active rules under the same nominal revision. Repair: hash the normalized resolved configuration plus module lock/environment inputs, or constrain config evaluation to a pure data language.

A-11 — High — `MODEL.md:50` — “Cannot conceal conditions created under earlier revisions” conflicts with a derived current `TrustCondition`. If an `off` rule’s old condition remains in ordinary reports, CI may still gate it; if omitted, history is concealed. Repair: distinguish active conditions, inactive historical condition events, and audit queries, with explicit policy treatment.

A-12 — Medium — `MODEL.md:54` — Claim versioning has no migration/reuse semantics. A repaired claim schema can either strand a legitimate challenge because exact identity changed or accidentally reuse evidence under changed meaning. Repair: define explicit version mappings and hostile tests for widening, narrowing, rename, split, and incompatible change.

A-13 — High — `MODEL.md:68` — Coverage, omissions, reach witness, and fault controls are declarations made by the method being trusted. In the prototype, `CheckExecution.reached` is supplied by the callback itself. This does not satisfy the Oracle Guide’s separate path-reach evidence. Repair: require independent instrumentation/attestation and a fault control that returns `reached: true` without touching production.

A-14 — High — `MODEL.md:74` — “Typed distribution” does not require normalized finite probabilities, complete/exclusive decisions, abstention semantics, or calibrated range. `{pass:.9, fail:.9}` could be schema-valid. Repair: define the probability algebra and validation, plus malformed-distribution and out-of-calibration-range tests.

A-15 — High — `MODEL.md:78` — Full-batch validation does not prevent selective result submission. The callback chooses what constitutes its returned batch; I confirmed the prototype accepts a single favorable finding with no expected cardinality or result manifest. Repeated probabilistic runs can also be stopped on a favorable draw. Repair: bind invocations to an admitted sampling/case plan and record every attempt, expected result keys, omissions, and completion witness.

A-16 — High — `MODEL.md:80` — “Captured inputs” conflicts with `R07`’s input digest. A digest cannot replay a stochastic evaluator without the original prompt/input, model artifact, sampling parameters, seed, backend, and tool outputs. Repair: define auditable encrypted input retention or explicitly mark replay impossible; distinguish equality proof from reproducibility.

A-17 — High — `MODEL.md:82` — Atomic command semantics are contradicted by the cited prototype. `runCheck()` updates dependencies and increments `nextRun` before validation/reach; my failed-reach probe left dependency revision 1 and advanced `nextRun` to 2. Repair: stage all state and swap only after success; add no-state-delta assertions for throws, invalid output, cancellation, and failed reach.

A-18 — High — `MODEL.md:85` — Applicability is not tied to the exact admitted applicability-function version and inputs used for assessment. Updating that function can silently reinterpret old observations. Repair: record applicability decision, rule version/hash, inputs, reason, and snapshot; make reassessment append/supersede rather than rewrite history.

A-19 — Medium — `MODEL.md:90` — “Returning to old bytes does not revive” covers ABA only when callers report the dependency. Deleted, renamed, or omitted dependencies remain current in the prototype. Repair: define complete dependency-set manifests/tombstones and test removal, rename, and an omitted relevant dependency.

A-20 — High — `MODEL.md:92` — `OperationRecord` omits idempotency and retry identity. If commit succeeds but the receipt is lost, retry can append duplicate observations or activate an override twice. Repair: add client request IDs, deduplication semantics, prior receipt lookup, and crash/retry tests around every transaction boundary.

A-21 — High — `MODEL.md:94` — “Capability-checked” introduces hidden structure: no principal, capability, delegation, or scope primitive exists in M01–M12. Repair: model capabilities explicitly or narrow the invariant; test unauthorized adapter calls, revoked capabilities, and confused-deputy routing.

A-22 — High — `MODEL.md:99` — Repair identity is too rigid and too weak simultaneously: exact old identity blocks legitimate cross-version repair, while same-law/same-case can accept an unrelated later pass. Repair: define an explicit semantic case/version mapping plus proof that the changed cause addresses the challenged affected uses.

A-23 — High — `MODEL.md:106` — Admission revocation consequences are unspecified. It is unclear whether prior observations remain applicable, whether current assessments reopen, and how snapshots explain formerly admitted evidence after key compromise. Repair: provide state transitions for admit/reject/revoke/supersede and revocation race/recovery tests.

A-24 — High — `MODEL.md:114` — Multiple overrides lack composition rules, revocation, and fail-closed behavior. Two authorities can independently produce incompatible severity/deployment actions. Repair: define scope ordering, authority domains, conflict diagnostics, and a deterministic resolution algebra.

A-25 — High — `MODEL.md:121` — `TrustRule` lowering has no transactional registration or deterministic identity algorithm. Partial registration can expose the claim but omit its method/admission relationship; reorderings can produce different identities. Repair: define an atomic normalized lowered manifest and collision/rollback tests.

A-26 — Medium — `MODEL.md:153` — `Assessment` has no multi-cause/status algebra. A claim can simultaneously have stale evidence, an open challenge, an unadmitted method, and invalid config; the prototype returns early on a challenge and loses other obligations. Repair: preserve all independent causes and define status precedence separately from explanation completeness.

A-27 — High — `MODEL.md:160` — “Disabled required rule” is placed in a policy-free condition without identifying who requires it. If requirement comes from a consumer profile, policy has leaked into X02; if from module semantics, project `off` cannot freely determine obligations. Repair: introduce an explicit obligation source and test config/profile conflicts.

A-28 — High — `MODEL.md:168` — Work leases have no fencing token or ABA protection. Worker A can resume after expiry and close or mutate a case now leased to B. Repair: require monotonically increasing lease generations and expected-condition/work versions on every work command; test expire/reclaim/late-write schedules.

A-29 — High — `MODEL.md:170` — The stigmergic model imports shared traces but omits the donor’s main operational failures: counterfeit notes, ignored holds, duplicate work, queue overload, short objection windows, feedback loops, and ant-mill churn. R11 prevents epistemic promotion but not denial of service or wasted work. Repair: add authentication, dedupe, quotas/backoff, channel separation, holds/objection timing, and no-semantic-progress detection.

A-30 — Medium — `MODEL.md:175` — “Only currently legal operations” is vulnerable to time-of-check/time-of-use. A diagnostic action can be legal at snapshot S and unauthorized/stale at execution. Repair: put expected snapshot/config/admission/lease versions in actions and return typed stale-precondition receipts.

A-31 — High — `MODEL.md:182` — A pure policy evaluation depends on active overrides and expiry but no evaluation instant is part of the snapshot. Repeating the same query can change output as wall time passes. Repair: capture `evaluatedAt` and clock authority or represent expiry advancement as a versioned state transition.

A-32 — High — `MODEL.md:188` — Snapshot/cursor coherence has no algorithm or delivery contract. A snapshot plus separately read cursor can miss a change between operations; compaction, resume, authorization filtering, and duplicate delivery are undefined. Repair: atomically return a high-watermark cursor with an MVCC snapshot and specify retention/resync semantics.

A-33 — Low — `MODEL.md:208` — Calling the overlaps a “semilattice” is unsupported: no partial order, join, meet, or closure law is defined. Repair: either supply the algebra and laws or use the non-mathematical term “overlap graph.”

A-34 — Medium — `MODEL.md:218` — Making configuration revision “part of later applicability” is under-specified. Invalidating all evidence on any config edit is overbroad; ignoring unrelated-to-related transitions is unsafe. Repair: record the minimal resolved config slice each use depends on and test both unrelated and material edits.

A-35 — High — `MODEL.md:221` — R06 simply restates complete-batch behavior and cannot exclude an admitted method that omits bad cases or an operator that selects a favorable run. Repair: add expected-case manifests, attempt logging, and hostile selective-reporting mutants.

A-36 — High — `MODEL.md:225` — R10 lists same-law/same-case/happens-after, but none establishes that the repair caused the pass. A flaky evaluator or unrelated environment change qualifies. Repair: require a repair hypothesis/change link and replay/control comparison against the challenged cause.

A-37 — High — `MODEL.md:227` — No capability enforcement evidence supports R12. The prototype LSP exposes arbitrary service operations through `evidence.request` (`lsp-server.mjs:114`) with no principal or operation authorization. Repair: define adapter principals and per-operation capabilities; negative-test every transport.

A-38 — High — `MODEL.md:228` — R13 chooses source-local suppression as an M12 override, while `PROCESS.md:221` says its classification remains open. This is an unresolved priority silently selected in the frozen model. Repair: reopen the freeze or narrow R13 until C03 is resolved with concrete suppression cases.

A-39 — Medium — `MODEL.md:231` — R16 promises coherent policy comparison but does not state whether commands derived from that result must use the same version. A deploy can act on a comparison after evidence/config/override changes. Repair: return and enforce a decision token bound to the snapshot and expiry.

A-40 — Medium — `MODEL.md:248` — The module example identifies a package by mutable name/version but does not bind it to the definition hash promised by M01. Republishing or local shadowing can change semantics without a version change. Repair: require content-addressed resolved module identities and lockfile verification.

A-41 — Medium — `MODEL.md:284` — F01–F03 are said to preserve the same model, yet F01 explicitly can hide mutation boundaries and semantic parts, with no mandatory facade constraint preventing that loss. Repair: state conformance laws for every form and test equivalent traces/errors across adapters.

A-42 — Medium — `EVIDENCE.md:11` — S02 is same-problem, same-analyst lineage, so it cannot independently support the new primitives or their minimality. Repair: label it migration input only in control calculations and seek held-out design/implementation evidence.

A-43 — High — `EVIDENCE.md:17` — S08 is credited for store, Endpoints check, and tests, but `sources.json` omits `storage.mjs`, `endpoints-real.mjs`, both test files, fault controls, and the production decision helper. The cited evidence cannot be reconstructed from the frozen source set. Repair: hash every file used by an implementation or test claim, including runtime dependencies.

A-44 — Medium — `EVIDENCE.md:48` — The Protocols/donor material supports warnings about trace popularity and feedback, not the exact X02/X03 API decomposition. Treating analogy as source-stated support overcredits it. Repair: label the transfer as analyst inference and validate it with an independent implementation or hostile API alternative.

A-45 — High — `EVIDENCE.md:62` — E-O09 overstates the prototype: it has no durable `OperationRecord`, no persisted reach failure, no X02 condition model, no work/policy/config/admission/snapshot/cursor, and LSP invents severity directly. Repair: narrow the observation to the exact implemented fields and operations.

A-46 — High — `EVIDENCE.md:70` — E-I01–E-I07 cite UCs and ablations produced by the same model as support. This is circular reconstruction, not independent evidence. Repair: provide concrete competing models, distinguishing traces, expected observations, and executable/schema-level checks.

A-47 — High — `EVIDENCE.md:83` — E-I05 states source-local suppression is a policy override while the unresolved register leaves that classification open. Repair: do not count E-I05 as frozen support until C03 is decided.

A-48 — High — `EVIDENCE.md:111` — Every main control is labeled “model pass”; there are no control inputs, expected/actual outputs, ablated artifacts, checker-sensitivity results, or replay commands. Under the Oracle Guide, these are assertions rather than established controls. Repair: add a control ledger with each witness and its exact failure predicate.

A-49 — High — `EVIDENCE.md:118` — N01–N03 are “excluded” only because R11/R13/R02/R08 say they are excluded. No hostile model or API execution demonstrates that work closure, suppression, or typed evaluator output cannot alter assessment. Repair: instantiate each bad system and show the invariant/check rejects it.

A-50 — Medium — `EVIDENCE.md:121` — Donor negative cases discriminate analogy classes; they do not verify Trust transactions or authority enforcement. Radio dispatch does not prove M09 is transactional. Repair: report them as transfer-boundary evidence only and add implementation/model tests separately.

A-51 — Low — `EVIDENCE.md:126` — The acknowledged Endpoints-only range means “solid” design readings remain in-sample. Repair: downgrade confidence or add a second domain and held-out lifecycle before claiming compression/minimality.

A-52 — High — `PROCESS.md:42` — UC01 is a component-name walkthrough, not reconstruction evidence: it supplies no concrete source edit, initial state, expected condition, adapter output, command receipt, or assertion. Repair: provide a complete trace and run it through a prototype or executable reference model.

A-53 — High — `PROCESS.md:55` — UC02 assumes M08 “detects” changed dependencies/configuration, but the prototype requires callers to report changes and has no scheduler, work cases, or leases. Omitted changes stay current. Repair: model discovery/ingestion and test missed, reordered, and deleted dependency events.

A-54 — High — `PROCESS.md:66` — UC03 claims snapshot/profile/override CI evaluation that the CLI does not implement. The actual LSP hardcodes contradicted→error and unresolved→warning. Repair: implement a snapshot-bound policy query and cross-adapter golden tests before calling this pass.

A-55 — High — `PROCESS.md:75` — UC04 claims Devtools and cursor behavior; neither exists in S08. Repair: implement or formally simulate the snapshot/high-watermark/follow protocol, including concurrent writes and cursor expiry.

A-56 — High — `PROCESS.md:83` — UC05’s authorized override lifecycle is wholly unimplemented and has no authority, expiry, precedence, or race test. Repair: add create/revoke/expire/evaluate/deploy traces.

A-57 — High — `PROCESS.md:92` — UC06 assumes proposed config can be evaluated on one existing snapshot even when it activates definitions/methods absent from that snapshot. Loading them would mutate or execute code, violating purity. Repair: define a sealed candidate-definition/config bundle and compare against an explicitly constructed preview snapshot.

A-58 — High — `PROCESS.md:100` — UC07 has no package loader, config resolver, admission mechanism, capability discovery, or local-rule implementation. It merely assigns those jobs to M02/M03/M11. Repair: test malicious top-level code, conflicting package identities, invalid config, unadmitted local rules, and atomic registration.

A-59 — High — `PROCESS.md:111` — UC08 declares a probabilistic evaluator pass despite no evaluator, distribution schema, calibration artifact, threshold example, or test. C04 explicitly leaves threshold ownership unresolved. Repair: mark UC08 untested and add calibrated/out-of-range/miscalibrated/optional-stopping cases.

A-60 — High — `PROCESS.md:123` — The ablation table never removes anything from an executable or formal model. Each row paraphrases the admitted unit’s stated job, so it proves neither necessity nor minimality; another decomposition could preserve the relation. Repair: publish each ablated model and a distinguishing trace that fails only after removal.

A-61 — Medium — `PROCESS.md:147` — “No retained item can be removed” is true only while every other named unit and wording is frozen; it does not test merges, substitutions, or alternate factorizations. Repair: include merge/substitution ablations and compare equal-coverage accounts.

A-62 — Medium — `PROCESS.md:161` — “Shorter than” has no size metric or actual competing artifacts. Repair: define the compression measure and provide normalized alternative models.

A-63 — High — `PROCESS.md:188` — N01–N03 are axioms rewritten as rejected scenarios, not negative tests. They do not show that an implementation cannot accidentally route work votes into support, filter suppressed conditions, or trust evaluator self-metadata. Repair: create end-to-end hostile fixtures and mutants for each.

A-64 — Medium — `PROCESS.md:199` — Donor controls show only that asynchronous traces differ from synchronous commands and output shape differs from authority path. They do not validate cancellation, acknowledgment, transaction atomicity, or admission. Repair: remove “control result” implications beyond analogy selection.

A-65 — High — `PROCESS.md:234` — Loader/sandbox security is declared outside the grammar even though executable third-party packages are central to PC4-01/PC4-11. Deferring it leaves the trust-root boundary structurally incomplete. Repair: include at least the loader trust/capability contract now, even if implementation remains open.

A-66 — Medium — `PROCESS.md:254` — The frozen analysis lists IDs but no digest binds Model/Evidence/Process/Brief together, so projection-gate compliance cannot be independently checked after edits. Repair: add a signed/hash-linked manifest and validation command.

A-67 — High — `BRIEF.md:29` — `defineTrustModule`, `defineRule`, and lowering are presented as conclusions although no cited prototype implements them. Repair: label this as proposed API structure and supply a registration prototype before claiming lifecycle behavior.

A-68 — High — `BRIEF.md:32` — Project configuration “history” is described as operational fact, but the prototype has no config object/revision/history and only caller-supplied generic dependencies. Repair: narrow the claim or implement deterministic config resolution and revision storage.

A-69 — High — `BRIEF.md:36` — “Running a check is transactional” is false for the cited prototype’s in-memory API: failed reach mutates dependencies/run counters. Separate service processes also lose updates; a temporary two-writer probe lost one observation in 20/20 attempts. Repair: use staged transactions plus single-writer/CAS storage and failure/concurrency tests.

A-70 — High — `BRIEF.md:39` — Recording a “calibration basis” does not establish calibrated evidence. The only source is an unverified vendor launch article, and no probabilistic path exists in the prototype. Repair: say “proposed metadata” and require independent calibration evidence.

A-71 — High — `BRIEF.md:43` — “Authorized, applicable, causally later repair” is stronger than the model/prototype enforce. Same-law/same-case temporal order alone is not causal repair. Repair: expose and validate the repair link and changed cause in the public example.

A-72 — Medium — `BRIEF.md:51` — The brief treats suppression classification as settled despite C03 and omits diagnostic-visibility versus deployment-action suppression. Repair: show separate examples for `off`, diagnostic suppression, severity downgrade, and deployment exception.

A-73 — High — `BRIEF.md:81` — The concrete editor→MCP→work lease→method→observation→CI→override story is entirely hypothetical. None of work, profiles, snapshots, overrides, or complete-observation submission exists in S08. Repair: label it a target scenario and convert it into an executable acceptance test.

A-74 — High — `frozen-analysis.json:14` — `model-pass` is machine-readable status with no machine-readable control result or witness reference. Consumers may mistake an analyst assertion for tested evidence. Repair: use `asserted-model-reconstruction` or link immutable control artifacts with outcomes.

A-75 — High — `frozen-analysis.json:23` — `excluded-by-model` is circular and weaker than a negative control. Repair: distinguish `axiomatically-disallowed`, `formally-derived`, and `implementation-tested`.

A-76 — Medium — `frozen-analysis.json:35` — `projectionGate` names files but does not bind their digests or validate that the brief adds no structure. Repair: include content hashes and a projection validation result.

A-77 — High — `sources.json:5` — `frozenAt` is date-only and lacks commit, timestamp, analyst/tool version, repository tree, and aggregate source-set hash. Repair: add all of these.

A-78 — High — `sources.json:14` — S02 has only Field Log IDs, with no path/hash or immutable event payload. Repair: hash the exact prior grammar and referenced log records.

A-79 — High — `sources.json:33` — S05 has a URL and Field Log ID but no captured article bytes/hash. A vendor page can change while the “frozen” analysis remains nominally identical. Repair: store a legal immutable snapshot or content digest plus retrieval timestamp.

A-80 — High — `sources.json:40` — S06’s user requirements are referenced only by mutable Field Log event IDs; the field log itself is not hashed. Repair: embed or hash the exact event payloads.

A-81 — Medium — `sources.json:46` — S07 self-references `PRESERVATION.md` without its hash. Repair: include the preservation file digest in the aggregate manifest.

A-82 — High — `sources.json:52` — S08’s listed paths omit files needed for the claims credited to it: `storage.mjs`, `endpoints-real.mjs`, `effect-verdict.mjs`, tests, fault controls, and design/handoff documents. Repair: freeze the complete transitive implementation/test source closure.

A-83 — Medium — `sources.json:63` — Per-file hashes do not capture Node version, runtime flags, transitive imports, or TypeScript/compiler behavior. Repair: record the execution environment and lock/toolchain digest alongside verified test output.

Coverage limits: I read all seven requested v4 files, the full Oracle Guide, Protocols survey, donor perturbation, and relevant prototype/service/storage/kernel/adapters/tests. All currently listed hashes match their files. `npm test` passed 21/21 tests and all eight existing fault mutants were detected; none exercises the new module/config/admission/probabilistic/work/override/snapshot design. Temporary probes confirmed failed-run state mutation, selective favorable-batch acceptance, cross-producer challenge resolution, and 20/20 multi-process lost-update attempts. I did not inspect every RFC line, external donor primary source, TypeSafe article contents, Field Log history outside the cited events, or any absent Devtools/package-loader implementation. No files were edited.

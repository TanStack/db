Verdict: the semantic decomposition is strong, but v4 is not yet an implementable TypeScript/linter API. It freezes requirements and three possible façades while leaving several safety-, identity-, configuration-, and operation-defining choices unresolved. The current prototype passes its tests and typecheck, but does not implement or validate the proposed module/config/work/policy grammar.

### Findings

T-01 — Blocker — `trust-api-grammar-v4/PRESERVATION.md:38-46`  
Claim: PC4-11 requires one consistent lifecycle service, yet no canonical API is frozen.  
Evidence: `MODEL.md:284-328` offers F01/F02/F03, and `PROCESS.md:231` explicitly leaves their layering unselected. Consequently operation names, inputs, receipts, capability negotiation, and adapter mappings remain inventions for each implementer.  
Proposed fix/design question: freeze one normative semantic operation/result algebra, then declare F01 and F02 as typed façades over it; alternatively weaken PC4-11 from an exact-equivalence requirement to a future design objective.

T-02 — High — `trust-api-grammar-v4/PRESERVATION.md:38-46`  
Claim: “reads are side-effect-free” is unenforceable with the stated ordinary-code extension model.  
Evidence: `MODEL.md:34-38` lets modules export executable applicability, locator, and presentation functions; nothing prevents those functions from reading time, filesystem, network, or mutable closure state during assessment/reporting.  
Proposed fix: define the pure projection boundary. Either execute hooks in a deterministic restricted runtime over explicit immutable inputs, or persist their results through commands and make queries consume only persisted DTOs.

T-03 — High — `trust-api-grammar-v4/MODEL.md:24-29`  
Claim: `EntityRef<T>` is foundational but has no implementable type, codec, or equality law.  
Evidence: the prose requires package, kind, version, and cross-interface identity, while examples use plain strings and the prototype uses store-local numeric IDs (`evidence-base/kernel.ts:17-21`, `32-43`). TypeScript’s `T` is erased and cannot validate a wire ref.  
Proposed fix: freeze a JSON discriminated ref such as `{kind, namespace, name, version, definitionHash}` plus branded TS aliases, parse/format functions, equality, and upgrade/supersession rules.

T-04 — High — `trust-api-grammar-v4/MODEL.md:34-41`  
Claim: module installation, discovery, and selection are not coherently separated.  
Evidence: Node does not discover installed modules automatically, while the representative config already imports module objects (`MODEL.md:256-259`). The package is named `@tanstack/db-endpoints`, its configured codes use `endpoints/...`, and no namespace/prefix ownership rule connects them.  
Proposed fix: specify manifest discovery, package-to-module identity, namespace ownership, duplicate-version resolution, collision errors, and whether config contains module refs or already-loaded module values.

T-05 — High — `trust-api-grammar-v4/MODEL.md:36-38`  
Claim: “schemas” are insufficiently specified for both TypeScript inference and wire projections.  
Evidence: arbitrary TS schema libraries and generic types cannot automatically provide MCP JSON Schema, persisted validation, or generated F03 clients; `M06` separately mentions input/output schemas without naming a common runtime contract.  
Proposed fix: require a portable runtime schema interface with static inference and a lossless JSON Schema/codec projection, or explicitly separate local runtime schema from required wire schema and define equivalence validation.

T-06 — Critical — `trust-api-grammar-v4/MODEL.md:40-41`  
Claim: admission occurs too late to protect the executable extension boundary.  
Evidence: importing a package or `trust.config.ts` runs its top-level code before Trust can inspect or admit its definitions. `PROCESS.md:234-236` leaves the loader/sandbox outside the grammar even though PC4-09 says agents cannot authorize roots. Local modules have the same problem.  
Proposed fix: discover inert signed manifests first, admit an exact artifact digest, then load executable code in a restricted worker with declared capabilities. Define an explicitly trusted-process mode as a weaker deployment profile.

T-07 — Medium — `trust-api-grammar-v4/MODEL.md:43-48`  
Claim: the resolved configuration algorithm is missing.  
Evidence: absence from `rules`, explicit `off`, module inclusion, presets, inheritance, file/subject selectors, duplicate modules, and conflicting configs have no precedence/default semantics. A newly added package rule could become active or inactive depending on an implementer’s guess.  
Proposed fix: define a normalized `ResolvedProjectTrustConfig`, deterministic merge order, absence semantics, selectors, provenance per resolved field, and stable validation errors.

T-08 — High — `trust-api-grammar-v4/MODEL.md:46-47`  
Claim: M03 promises explicit method enable/config/disable, but the proposed config has no method surface.  
Evidence: `MODEL.md:256-265` configures only rules and profiles; rule-local `methods` therefore become implicitly active or unusable.  
Proposed fix/design question: add a `methods` section with exact method refs/config, or state that methods are never enabled independently and revise M03, admission, and discovery accordingly.

T-09 — High — `trust-api-grammar-v4/MODEL.md:50-52`  
Claim: enabled-but-unadmitted behavior is undefined.  
Evidence: C02 (`PROCESS.md:219-220`) leaves open whether project configuration activates admitted definitions directly or needs project admission. It is therefore unclear whether an enabled unadmitted rule creates obligations, only an `unadmitted-definition` condition, or is excluded entirely.  
Proposed fix: freeze resolution as a state table over discovered/configured/admitted states, including which claims, diagnostics, runnable methods, and CI outcomes each state produces.

T-10 — High — `trust-api-grammar-v4/MODEL.md:43-52`  
Claim: invalid configuration cannot reliably become a condition without bootstrap semantics.  
Evidence: X02 includes `invalid configuration` (`MODEL.md:160-166`), but a config that fails import, schema validation, or module resolution may prevent the service from constructing the very snapshot needed to report it. No last-known-good/fail-closed rule exists.  
Proposed fix: define a bootstrap snapshot and config-resolution receipt containing source spans and partial provenance; specify whether checks use the last valid revision, no revision, or fail closed.

T-11 — High — `trust-api-grammar-v4/MODEL.md:54-58`  
Claim: version identity is inconsistent across claim, rule, method, and config.  
Evidence: `ClaimDefinition` has a numeric version, config uses unversioned `'endpoints/safe-skip-refetch'`, the example prototype embeds `@1` in law/check IDs while also storing `version: 1` (`evidence-base/endpoints-real.mjs:5-12`). Upgrade selection and admission reuse are unknowable.  
Proposed fix: separate stable code from exact definition ref; define exact/range/default version resolution, compatibility rules, and whether config pins a version, range, or resolved hash.

T-12 — Low — `trust-api-grammar-v4/MODEL.md:54-58`  
Claim: `ClaimDefinition.conditions` collides terminologically with X02 `TrustCondition`.  
Evidence: one appears to mean proposition preconditions, the other an attention record. The shared name will produce ambiguous types, APIs, and diagnostics.  
Proposed fix: rename the claim field to `preconditions`, `validWhen`, or another domain-logical term.

T-13 — High — `trust-api-grammar-v4/MODEL.md:60-64`  
Claim: support routes do not have the identity/version grammar R04 requires.  
Evidence: `MODEL.md:135-138` builds routes from bare strings such as `'same-artifact'`, but no premise registry maps them to versioned claims/methods, and routes themselves have no stable refs for admission or diagnostics.  
Proposed fix: define versioned `PremiseDefinition` and `SupportRouteDefinition` values with typed refs; make `allOf`/`anyOf` preserve route identity and infer only declared premise keys.

T-14 — High — `trust-api-grammar-v4/MODEL.md:60-64`  
Claim: `ClaimUse` is named but not representable.  
Evidence: “exact consumer, subject, context, and obligation” has no concrete key, schema, lifetime, or relationship to rule instantiation. M10 and X04 depend on affected-use identity.  
Proposed fix: freeze a serializable `ClaimUseRef` and `ClaimUse` record, including consumer/profile identity, subject ref, context revision, obligation lineage, and supersession/equality rules.

T-15 — High — `trust-api-grammar-v4/MODEL.md:66-76`  
Claim: `EvidenceMethod<TInput, TDecision>` is not a sound type for probabilistic outputs.  
Evidence: a probability distribution is not `TDecision`; an erased union cannot validate exhaustive alternatives, finite probabilities, normalization, or schema/calibration agreement.  
Proposed fix: infer `TDecision` from a runtime decision algebra and model output separately, e.g. `EvidenceMethod<InputSchema, OutputSchema>`, with a checked `Distribution<DecisionKey>` codec and normalization/calibration invariants.

T-16 — High — `trust-api-grammar-v4/MODEL.md:68-72`  
Claim: declared dependencies, coverage, omissions, and reach have no enforcement relation to a run.  
Evidence: the current runner accepts caller-provided dependencies and can omit relevant ones (`evidence-base/kernel.ts:438-465`); the prototype itself acknowledges callers must report context (`evidence-base/DESIGN.md:34-36`).  
Proposed fix: define required dependency selectors and a captured-input manifest; validation must prove every declared required dependency was captured or return a typed incomplete/reach outcome.

T-17 — High — `trust-api-grammar-v4/MODEL.md:78-83`  
Claim: admission time for an observation is ambiguous.  
Evidence: an observation is said to come from an admitted method, but admission can later be revoked or superseded. The grammar does not say whether production-time admission, current-use admission, or both are required, nor how historical admission refs are captured.  
Proposed fix: store the exact admission record used at production and define assessment behavior for revoked/superseded admissions separately from immutable observation retention.

T-18 — High — `trust-api-grammar-v4/MODEL.md:92-97`  
Claim: `OperationRecord` is prose rather than a usable command/result algebra.  
Evidence: acceptance, delivery, cancellation, process result, reach, validation, commit, and receipt are listed without legal states, transitions, stable failure codes, retry/idempotency keys, or concurrency preconditions.  
Proposed fix: freeze a discriminated state machine and `OperationReceipt`/`OperationError` union containing `code`, structured details, retryability, legal next actions, operation id, and committed snapshot/cursor.

T-19 — High — `trust-api-grammar-v4/MODEL.md:99-104`  
Claim: challenge defeat semantics across alternate routes are undefined.  
Evidence: M10 says challenges name affected uses, while X01 allows alternate support routes. It is unclear whether a counterexample defeats the proposition globally, one use, one premise, or one route. The prototype globally contradicts an exact claim before considering alternate routes (`evidence-base/kernel.ts:582-599`).  
Proposed fix: define challenge target/defeat scope and precedence algebra, with counterexamples for “one route defeated, another supported” and per-use applicability.

T-20 — High — `trust-api-grammar-v4/MODEL.md:101-104`  
Claim: “same law and case” repair validation has no domain extension point.  
Evidence: exact JSON identity is insufficient for migrations or semantically equivalent cases, while opaque domain equality cannot be trusted implicitly.  
Proposed fix: add an admitted, versioned `RepairMatcher`/identity-relation definition whose decision and provenance are recorded; unresolved identity must remain an explicit condition.

T-21 — Blocker — `trust-api-grammar-v4/MODEL.md:106-112`  
Claim: admission is not implementable without an authority/capability topology.  
Evidence: M11 lists many independently admitted roots, but C05 (`PROCESS.md:225-226`) leaves identity, authority, review, signatures, and project-local admission open. “Agents cannot admit their own proposal” cannot be enforced without authenticated principals and delegation rules.  
Proposed fix: define principal identity, capability scopes, proposal authorship, authority roots, delegation, revocation, and proof/verification mechanism before exposing admission commands.

T-22 — High — `trust-api-grammar-v4/MODEL.md:114-119`  
Claim: the representative linter tuple conflates obligation configuration with consumer policy.  
Evidence: `MODEL.md:260-264` places `'error'`, `'warn'`, and `'off'` in `rules`; M03 says config determines active obligations, while M12/X04 say policy owns severity. Here `off` changes obligation membership but `warn/error` change policy in the same union.  
Proposed fix: lower familiar tuple sugar into two explicit normalized records—rule activation/options and profile severity/action—or keep severity exclusively under profiles.

T-23 — Blocker — `trust-api-grammar-v4/MODEL.md:121-149`  
Claim: `TrustRule` lacks the defining linter operation: discovering targets and instantiating findings/claims from source.  
Evidence: the example has a static claim definition, support, methods, applicability, and messages, but no `create(context)`, visitor, selector, `subjects`, or source traversal. Nothing says how enabling a rule produces `ClaimUse`s for project endpoints.  
Proposed fix: add a typed subject-discovery/claim-instantiation contract, with source context, selectors, document/project revisions, stable subject refs, and emitted uses; clarify whether discovery is a pure query or persisted command.

T-24 — High — `trust-api-grammar-v4/MODEL.md:127-144`  
Claim: the authored rule’s generic relationships are not type-connected.  
Evidence: `defineClaim<EndpointRefetchCase>`, string support tokens, `methods.oracle`, an untyped applicability parameter, and `messages({condition})` have no shared inferred key/context/output types. Invalid cross-links would compile in any naïve implementation.  
Proposed fix: define a generic `RuleDefinition<SubjectSchema, ConfigSchema, PremiseMap, MethodMap>` whose support refs, method outputs, applicability, source locator, and message/action hooks are inferred from the same schemas.

T-25 — Medium — `trust-api-grammar-v4/MODEL.md:139-143`  
Claim: method ownership/linkage inside a rule is ambiguous.  
Evidence: the only method key is `oracle`, but the support expression names four other strings plus a certificate; no field says which method can discharge which premise, whether methods may support multiple routes, or whether they produce claim batches.  
Proposed fix: require explicit typed `produces`/`supports` edges and declared batch/cardinality semantics per method.

T-26 — High — `trust-api-grammar-v4/MODEL.md:142-143`  
Claim: applicability and presentation examples contradict their required types.  
Evidence: M08 requires `applicable | inapplicable | unknown` with a reason, while the local rule returns a boolean (`MODEL.md:275`). `messages` has no typed diagnostic/location/action result.  
Proposed fix: require a discriminated `Applicability` result everywhere and a serializable `DiagnosticDescriptor`; do not accept booleans as sugar unless `false` has an explicit non-lossy reason policy.

T-27 — High — `trust-api-grammar-v4/MODEL.md:160-166`  
Claim: `TrustCondition` has no stable identity or lifecycle law.  
Evidence: work, diagnostics, overrides, and cursors all need to refer to “the same” condition, but the grammar does not define deduplication keys, instance ids, open/resolved/superseded transitions, recurrence, or what survives a config revision.  
Proposed fix: define `ConditionRef`, a stable kind registry, identity constituents, occurrence/lifecycle events, and recurrence/supersession semantics.

T-28 — High — `trust-api-grammar-v4/MODEL.md:168-173`  
Claim: the Beads-style work API is only a feature list, not an implementable concurrency model.  
Evidence: claim/lease, renewal, expiry, ownership transfer, blockers/readiness, note ordering, stale-condition races, guarded close, and auto-close behavior have no states or command preconditions.  
Proposed fix: freeze `WorkCase` and `WorkEvent` discriminated unions plus ready semantics and version-checked commands (`claim`, `renew`, `release`, `block`, `note`, `close`) with lease clock and conflict receipts.

T-29 — High — `trust-api-grammar-v4/MODEL.md:175-180`  
Claim: `Diagnostic` cannot yet project to LSP, CLI, and MCP without adapter inventions.  
Evidence: “stable rule/condition code” is ambiguous; exact locations lack URI/document version/generated-source mapping; legal actions lack operation ids, argument schemas, authorization, and expected snapshot.  
Proposed fix: use separate `ruleCode`, `conditionKind`, `conditionRef`, `claimUseRefs`, versioned `SourceSpan[]`, and typed `ActionDescriptor {operation, input, requiredCapability, ifMatch}` fields.

T-30 — High — `trust-api-grammar-v4/MODEL.md:182-186`  
Claim: policy aggregation and obligation ownership are underspecified.  
Evidence: multiple severities/actions/fallbacks need deterministic aggregation for CI. “Newly required obligations” also lets X05 appear to create semantic obligations, while M03 says config defines the active obligation set.  
Proposed fix: define the action lattice/precedence and distinguish config-owned active claims from policy-owned gate prerequisites; include deterministic multi-condition examples.

T-31 — High — `trust-api-grammar-v4/MODEL.md:188-192`  
Claim: X06 has no model for unsaved editor overlays.  
Evidence: LSP must diagnose current document text, but evidence/config snapshots represent persisted context. Updating dependency state during `didOpen` would violate side-effect-free reporting; ignoring it can display stale support. The current LSP only assesses a JSON claim and never updates context (`evidence-base/lsp-server.mjs:5-27`, `75-87`).  
Proposed fix: define ephemeral overlay snapshots or a pure document-analysis context keyed by document version, plus explicit persistence/invalidation commands.

T-32 — Medium — `trust-api-grammar-v4/MODEL.md:188-192`  
Claim: snapshot/cursor semantics are too weak for Devtools and long-lived agents.  
Evidence: no paging, filtering, retention, cursor expiry, resumption, consistency token, or “cursor too old” result is defined; “snapshot containing everything” becomes unbounded history transfer.  
Proposed fix: make snapshot ids opaque, define paged resource queries at one snapshot, cursor ordering/retention rules, and typed resync responses.

T-33 — High — `trust-api-grammar-v4/MODEL.md:228-229`  
Claim: “disabled required rule” conflicts with config-owned obligation selection.  
Evidence: R13 says disabling removes the rule from the active obligation set, while X02 lists `disabled required rule`. The grammar never identifies who can require a rule above project config, or whether `off` still produces a current diagnostic.  
Proposed fix: introduce an explicit baseline/mandate source distinct from project selection, or remove this condition; specify report defaults for disabled current vs historical conditions.

T-34 — Critical — `trust-api-grammar-v4/MODEL.md:300-305`  
Claim: separate `methods.run` and `observations.submit` can violate complete-batch atomicity.  
Evidence: R06 requires Trust to prevent callers from selecting favorable findings, but F02 permits an arbitrary later batch submission with no run token, expected cardinality, output digest, or trusted attestation.  
Proposed fix: make admitted local runners commit validated output internally; for remote execution, issue a run capability bound to method/input/context and require a signed complete-result manifest whose cardinality/digest is verified atomically.

T-35 — Medium — `trust-api-grammar-v4/MODEL.md:301-305`  
Claim: concurrency vocabulary is inconsistent.  
Evidence: queries take `snapshot`, method runs take `expectedConfig`, and submission takes `expectedVersion`; none says whether these are ids, hashes, or whole objects, or what stale failure returns.  
Proposed fix: standardize on explicit preconditions such as `atSnapshot` and `ifMatch: {configRevision, storeVersion}` with one typed conflict result.

T-36 — High — `trust-api-grammar-v4/MODEL.md:279-282`  
Claim: source suppression can become an agent self-authorization path.  
Evidence: the design wants familiar suppression syntax while requiring authorized expiring overrides. An agent able to edit a comment/config could otherwise manufacture its own exception; standard LSP edits cannot themselves prove authority or collect required rationale/expiry.  
Proposed fix: suppression syntax should create an override request/proposal only. Activation must be a capability-checked command over exact scope, rationale, expiry, and expected snapshot.

T-37 — High — `trust-api-grammar-v4/EVIDENCE.md:111-122`  
Claim: the “pass” language overstates API validation.  
Evidence: the table correctly admits reconstruction is a “model pass, not executed API test,” while the preservation map uses it to support every adapter and extension surface. The prototype does not implement modules/config/admission/policy/work/Devtools.  
Proposed fix: label UC/API claims “design-reconstructable,” add compile-time façade fixtures and adapter contract tests before calling PC4-11 preserved.

T-38 — High — `trust-api-grammar-v4/PROCESS.md:66-73`  
Claim: UC03 is not linter-like on a clean CI checkout.  
Evidence: CI explicitly does not run checks, so it can only evaluate a pre-existing evidence store. No freshness prerequisite, run plan, store acquisition, or one-command “lint then gate” workflow is defined. The current CLI always exits zero for a successful `assess` request even when contradicted (`evidence-base/cli.mjs:42-70`).  
Proposed fix: define `trust ci` as an explicit composite command: resolve config, plan/run admitted configured methods, commit, evaluate one resulting snapshot, and map findings vs operational/config failures to documented exit codes.

T-39 — High — `trust-api-grammar-v4/PROCESS.md:111-121`  
Claim: UC08 declares a pass using an unresolved threshold/condition boundary.  
Evidence: step 4 says low-confidence/out-of-range becomes a typed condition, but C04 (`PROCESS.md:223-224`) leaves semantic versus action thresholds open, and no condition kind or typed distribution adequacy rule is defined.  
Proposed fix: provide worked distributions showing domain adequacy, unknown applicability, and consumer action as three distinct calculations, with separate admitted definitions and condition codes.

T-40 — High — `trust-api-grammar-v4/PROCESS.md:215-236`  
Claim: several “unresolved conflicts” are required API semantics, not optional implementation details.  
Evidence: C01–C06 and C08 decide applicability types, activation/admission, suppression, probability meaning, authority, error durability, and canonical API layering. Independent implementers will produce semantically incompatible services.  
Proposed fix: promote these to blocking design questions for an API freeze; retain only transport delivery and implementation mechanism choices as open.

T-41 — High — `trust-api-grammar-v4/BRIEF.md:56-64`  
Claim: the brief explicitly declines to select exact config, loader, admission, suppression, persistence, and API layering while presenting concrete linter ergonomics elsewhere as settled.  
Evidence: these omissions determine whether package/local rules can load safely, whether config typechecks, and whether agent actions are legal.  
Proposed fix: recast the artifact as a semantic design grammar rather than an API grammar, or add a subsequent normative API profile that resolves these points.

T-42 — Medium — `trust-api-grammar-v4/frozen-analysis.json:35-40`  
Claim: the machine-readable frozen artifact does not freeze a machine contract.  
Evidence: it lists only symbolic IDs and filenames, with no hashes for Model/Evidence/Process, no field schemas, no operation algebra, and no compatibility/version metadata beyond one string id.  
Proposed fix: hash the frozen documents and publish versioned JSON Schemas for refs, definitions, conditions, operations, receipts, diagnostics, and snapshots.

T-43 — Medium — `trust-api-grammar-v4/sources.json:52-72`  
Claim: S08 does not hash the transitive prototype source it relies on.  
Evidence: listed hashes cover protocol/kernel/service/adapters/README, but `service.mjs` imports `endpoints-real.mjs` and `storage.mjs`; the real check imports `effect-verdict.mjs`. Those files, tests, and TypeScript/toolchain versions are outside the frozen S08 hash set.  
Proposed fix: freeze a transitive source manifest or repository commit plus dirty-tree patch/hash inventory. The seven listed hashes do match the current files.

T-44 — High — `evidence-base/protocol.ts:47-51`  
Claim: the current TypeScript surface is not evidence that the proposed grammar is idiomatic or wire-safe.  
Evidence: it exposes only `CheckExecution<TFinding>` with `diagnostics?: unknown`; current `Rule` is stringly and returns prose (`evidence-base/kernel.ts:45-53`). There are no module/config/admission/policy/work types in the typechecked include.  
Proposed fix: add compile-only consumer fixtures for packaged and local rules, invalid support/method links, config option inference, tri-state applicability, and adapter DTO exhaustiveness.

T-45 — High — `evidence-base/kernel.ts:438-465`  
Claim: the prototype’s run command is not transactional on operational failure.  
Evidence: `updateDependencies` and `#nextRun++` happen before the callback and reach validation. A throwing or unreached check mutates an `EvidenceBase` instance despite committing no observation.  
Proposed fix: stage dependency revisions and counters, validate the complete execution, then commit all mutations together; if failed operations are durable, record them through the explicit operation ledger without mutating evidence context.

T-46 — High — `evidence-base/kernel.ts:675-692`  
Claim: current errors are agent-unfriendly and violate R14’s causal/actionable requirement.  
Evidence: rule exceptions are swallowed and reduced to `Rule error: <id>`; service validation also throws plain strings (`evidence-base/service.mjs:39-42`, `121`). No cause, field path, stable error code, retryability, or legal action survives.  
Proposed fix: standardize structured errors/receipts and preserve sanitized cause chains, source refs, invalid field paths, required capabilities, and suggested next operations.

T-47 — High — `evidence-base/cli.mjs:28-70`  
Claim: the CLI is not yet a linter/CI projection.  
Evidence: it prints unversioned arbitrary JSON; contradicted/unresolved assessment does not set a finding exit code; all parse/config/service failures collapse to exit 1; there is no profile, report, fix, suppression, or snapshot id.  
Proposed fix: define human and versioned machine reporters, stable 0/finding/operational/config usage exits, profile selection, explicit run/report/CI commands, and snapshot/config provenance in every result.

T-48 — High — `evidence-base/lsp-server.mjs:5-27`  
Claim: the current LSP does not exercise the proposed diagnostic contract.  
Evidence: it accepts synthetic JSON claim documents, highlights line 0, uses `supported|contradicted|unresolved` as diagnostic code, and carries raw assessment data. It has no rule code, condition ref, real source locator, coverage limits, authority boundary, or affected uses.  
Proposed fix: add source-discovery fixtures and a canonical `Diagnostic -> LSP Diagnostic` adapter preserving separate rule/condition identities and versioned source spans.

T-49 — Medium — `evidence-base/lsp-server.mjs:95-117`  
Claim: the advertised code action is not a legal fix/action projection.  
Evidence: every parseable document gets “Reassess evidence claim,” which is only a read; it is not tied to the requested diagnostic, lacks preconditions/capabilities, and `JSON.parse` errors become generic internal errors.  
Proposed fix: derive actions exclusively from typed current `ActionDescriptor`s, attach their diagnostic ids, and return disabled actions with structured reasons when authorization or freshness preconditions fail.

T-50 — High — `evidence-base/mcp-server.mjs:5-63`  
Claim: MCP capability/schema discovery is too weak for package/local extension.  
Evidence: tools are fixed to Endpoints, nested inputs are only `{type:"object"}`, outputs have no schema, and `tools/call` errors become generic JSON-RPC internal failures (`mcp-server.mjs:97-107`, `148-157`). Agents cannot discover required fields or legal recovery actions.  
Proposed fix: expose generic versioned operations over exact refs plus a paged capability/schema resource, or dynamically generate fully specified tool schemas with collision/version policy; return MCP `isError` content carrying stable structured operation errors.

T-51 — Medium — `evidence-base/README.md:132-154`  
Claim: Devtools and Beads-style work projection claims have no prototype coverage.  
Evidence: the package map contains CLI, LSP, and MCP only; no Devtools or work implementation/test exists, despite PC4-11 and the reconstruction controls treating them as preserved.  
Proposed fix: add at least a headless Devtools snapshot/cursor consumer and work API contract suite covering lease races, blockers, stale closure, paging, and resync.

T-52 — Low — `evidence-base/service.mjs:53-65`  
Claim: initialization/read behavior is misleading.  
Evidence: every request loads with `create: true`; `init` reports `created: true` even if it merely re-saved an existing store, while read operations silently treat a missing store as empty.  
Proposed fix: distinguish `created`, `opened`, and `missing`; make missing-store policy explicit per operation and return stable initialization errors/actions.

### Coverage limits

- Read all seven requested frozen artifacts and the current protocol, kernel, Endpoints rule/check, service, storage, CLI, LSP, MCP, README, and design notes.
- Verified the requested starting commit is current `HEAD`; the reviewed grammar and much of the adapter work are uncommitted/untracked relative to it.
- Ran the current prototype typecheck and 21-test suite; both pass.
- Verified every S08 hash present in `sources.json`; all listed hashes match.
- Did not edit files.
- Did not audit hostile-process containment, cryptographic protocol design, actual Devtools UX, performance at repository scale, or a second domain implementation because none exists.

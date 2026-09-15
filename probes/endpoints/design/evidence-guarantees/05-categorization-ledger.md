# Guarantee categorization: complete ledger

Date: 2026-09-15. Read with [the assessment and code evidence](05-categorization.md).

This is an overlapping work map, not 85 independent promises or defects. **P** means only the bounded behavior in “Current”; it does not mark the entire source guarantee done. **E** describes a possible task, not an implemented or accepted certificate. Routes do not rank priority.

| Route | Meaning | Entries mentioning route |
| --- | --- | ---: |
| P | Present in a bounded form | 53 |
| C | Reusable compiler/linter/checker work | 55 |
| E | Scoped agent-supplied fact or domain check | 80 |
| A | Authored application/adapter behavior or policy | 61 |
| R | Runtime/protocol/enforcement work if adopted | 43 |
| D | Deferred, outside current scope, or source-specific | 27 |

All 20 survey IDs and 65 loss IDs appear once below. Sources are the frozen survey/audits; the links retain their full original qualifications. Each family’s code evidence, method and invalidation conditions are in the assessment.

## Effect bounds and affected collections

[Family baseline and evidence limits](05-categorization.md#effects).

### C2 — Foreign-call effect/tier declarations, with separate transactional hook obligations.

[C2 source record](02-research-survey.md). Routes: **C · E · R**. Evidence placement: **extension**.

**Current:** Supported SQL has summaries. There is no general agent-evidence admission format or hook runtime.

**Failure case / boundary:** An HTTP helper writes shopping items although the visible SQL only updates recipes.

**Agent contribution and limit:** Inspect exact implementation, hooks, configuration, failure paths and database binding; supply a scoped read/write bound. Hook ordering remains a distinct claim, as in L5b.

### C3 — Invalidate queries sharing affected entities.

[C3 source record](02-research-survey.md). Routes: **P · C · E**. Evidence placement: **extension**.

**Current:** Registered read/write footprints are intersected; unknown bounds refetch. SQL-only fallback can omit imported-call effects, so complete handler coverage is conditional.

**Failure case / boundary:** A helper writes tags, but tags are absent from the emitted write set, so a retained tag query is skipped.

**Agent contribution and limit:** Supply missing upper bounds for opaque calls, including failures and indirect writes. The compiler unions these with SQL. Conditional precision is optional; a complete unconditional bound is useful.

### C20 — Post-call data and invalidated paths may exceed the returned result.

[C20 source record](02-research-survey.md). Routes: **P · C · E**. Evidence placement: **extension**.

**Current:** Retained collections are sent to the server and selected using footprints; handler result data is not treated as the full write set.

**Failure case / boundary:** Returning only the changed recipe misses shopping rows changed by an imported helper.

**Agent contribution and limit:** Supply complete opaque read/write bounds for affected-query selection. The existing matcher can consume a union after an evidence adapter is implemented.

### L27a — HTTP, durable, ephemeral and service effects are different domains.

[L27a source record](audits/language.md). Routes: **C · E · R**. Evidence placement: **consumer**.

**Current:** Current dependency selection consumes PG relation sets, not a general effect system.

**Failure case / boundary:** A call makes no PG writes but charges money or changes an in-memory cache.

**Agent contribution and limit:** Supply only the domains required by a named consumer. PG-write-empty can justify a refresh skip; it cannot justify retry, query determinism or confidentiality.

### Q02 — Query handlers are read-only as an application obligation.

[Q02 source record](audits/queries.md). Routes: **P · C · E · A**. Evidence placement: **extension**.

**Current:** Recognized direct query writes block a dependency proof, but that is not a general execution prohibition; imported calls may be skipped.

**Failure case / boundary:** A query helper updates last-seen state, and read retries repeat that write.

**Agent contribution and limit:** Inspect hidden writes and other effects for the actual read/retry consumer. Normal SQL effects are compiler work; “query” as a declaration name is not proof.

## Completion, visibility and acknowledgment

[Family baseline and evidence limits](05-categorization.md#completion).

### C11 — Complete sync checkpoints and matching write arrival before optimism retires.

[C11 source record](02-research-survey.md). Routes: **P · E · A · D**. Evidence placement: **consumer**.

**Current:** Endpoints uses request closure plus authoritative reads, not sync checkpoints or operation-tagged change delivery.

**Failure case / boundary:** An API returns accepted, the framework refetches, and the background job commits afterward.

**Agent contribution and limit:** Establish exactly what an adapter response means on success, throw and timeout. If relevant writes remain live, a completion/polling mechanism is needed; a write footprint is insufficient.

### C12 — Result receipt, cache settlement and reconnect replay are different events.

[C12 source record](02-research-survey.md). Routes: **P · E · R**. Evidence placement: **extension**.

**Current:** The runtime settles after valid authority or reports read/transport failure; it does not automatically replay mutations.

**Failure case / boundary:** Treating handler success plus exhausted reads as a retryable write failure duplicates a committed action.

**Agent contribution and limit:** Trace adapter outcome mapping and closure semantics. The runtime owns response validation and settlement; any future retry consumer needs its own admissibility claim.

### L22b — Persistence error signaling must match the caller’s actual interpretation.

[L22b source record](audits/language.md). Routes: **P · C · E · A**. Evidence placement: **extension**.

**Current:** A resolved handler is encoded as success even if its returned application value denotes failure; thrown errors are separately encoded.

**Failure case / boundary:** An adapter returns false and its caller reports a successful save without examining it.

**Agent contribution and limit:** Trace return values, thrown errors and side-channel error state through the real caller. Open RIA’s ignored Boolean is a source-specific example, not an Endpoints defect.

### Q12 — Mutation response reads occur after processing and may follow declared fragments.

[Q12 source record](audits/queries.md). Routes: **P · E · A · R**. Evidence placement: **extension**.

**Current:** refreshAfterMutation awaits the handler before reading retained targets; no fragment response compiler or cross-query snapshot is implied.

**Failure case / boundary:** An opaque awaited API only queues a write; its response read is still too early.

**Agent contribution and limit:** Establish helper closure/visibility before treating handler return as processing complete. No extra evidence is needed for the visible await-to-read ordering itself.

### P12b — Acknowledgment must include acknowledged effects; replay engines also preserve per-client order.

[P12b source record](audits/protocol.md). Routes: **P · E · R · D**. Evidence placement: **deferred**.

**Current:** Inline response admission/refresh settles local actions, without durable sequence acknowledgments or replay order.

**Failure case / boundary:** An adapter acknowledges a mutation that is still queued, and the client drops its overlay.

**Agent contribution and limit:** Inspect acknowledgment/visibility coupling in an existing adapter. Queue ordering and replay state need machinery if later selected.

### P24b — Validation rejection, handler failure and transport failure have different semantics.

[P24b source record](audits/protocol.md). Routes: **P · E · A · R**. Evidence placement: **extension**.

**Current:** InvalidInputError, not-started, handler outcome and read-error envelopes exist. Unknown transport outcomes remain distinct; the system is not Zero’s skip/retry protocol.

**Failure case / boundary:** A broad catch converts a timeout after commit into “nothing happened,” permitting unsafe retry.

**Agent contribution and limit:** Inspect opaque adapter error mapping and whether writes may continue. Runtime validation/classification stays framework work; do not conflate failure with rollback.

## Atomicity, isolation and domain invariants

[Family baseline and evidence limits](05-categorization.md#transactions).

### C1 — Call atomicity and commit-delayed channel sends.

[C1 source record](02-research-survey.md). Routes: **P · C · E · A · R**. Evidence placement: **consumer**.

**Current:** PG transactions can be authored; Endpoints invokes the handler without wrapping it in a transaction or delaying arbitrary external effects.

**Failure case / boundary:** First SQL statement commits; second throws. Or an email is sent before a later SQL rollback.

**Agent contribution and limit:** Trace an unsupported adapter to establish existing transaction participation and post-commit behavior. If those behaviors are absent, change app/adapter code; evidence cannot create atomicity.

### C5 — Atomic mutation execution, distinct from external actions and their retry constraints.

[C5 source record](02-research-survey.md). Routes: **P · C · E · A · R**. Evidence placement: **extension**.

**Current:** Handlers run once per dispatched request; reads retry. Atomicity of handler writes depends on authored SQL/transactions.

**Failure case / boundary:** An external charge succeeds and a later database write fails; rerunning the handler charges twice.

**Agent contribution and limit:** Certify an existing transaction participant, a particular no-effect failure prefix, or a deduplication contract separately. None implies the other two.

### C9 — PG batch rollback excludes arbitrary remote operations.

[C9 source record](02-research-survey.md). Routes: **C · E · A · R**. Evidence placement: **consumer**.

**Current:** A handler may use a PG transaction; refresh also reconciles partial writes after a throw. There is no distributed rollback mechanism.

**Failure case / boundary:** A transaction rolls back recipes while a remote shopping service has already committed its changes.

**Agent contribution and limit:** Document participants and completion boundaries; inspect existing compensation if any. Repair code/semantics when the desired atomicity is not implemented.

### C15 — Validation/authorization precedes overridable persistence.

[C15 source record](02-research-survey.md). Routes: **P · C · E · A · R**. Evidence placement: **extension**.

**Current:** Mutation input and retained descriptors are admitted before the handler. Auth and persistence remain authored; custom validator purity is not automatically established.

**Failure case / boundary:** A persistence adapter returns a failure value the surrounding handler ignores, which becomes framework success.

**Agent contribution and limit:** Inspect adapter participation and its actual success/error channel; verify accepting validators and whole-batch ordering when such a batch is authored.

### L5b — Rollback-after-commit callbacks and irreversible post-SQL-commit hooks have distinct ordering.

[L5b source record](audits/language.md). Routes: **E · A · R**. Evidence placement: **consumer**.

**Current:** No Endpoints foreign-effect transaction-hook protocol is present.

**Failure case / boundary:** An adapter makes an irreversible call in a callback that can still be followed by rollback.

**Agent contribution and limit:** Inspect a particular existing hook runtime’s ordering and compensation behavior. New scheduling/compensation is implementation work, not a fact declaration.

### L22c — Whole-batch admission can precede execution, without proving validation hooks pure.

[L22c source record](audits/language.md). Routes: **P · C · E · A**. Evidence placement: **ordinary**.

**Current:** Input and all retained query descriptors are checked before the write. A batch inside a handler has whatever validation order the author wrote.

**Failure case / boundary:** A handler writes item one before discovering item two is invalid.

**Agent contribution and limit:** Inspect batch validation/control flow and custom validator effects. Use ordinary prevalidation/transactions where required; schema failure only proves the handler did not start.

### Q07 — Mutation consistency includes reads and deterministic decisions, not only atomic writes.

[Q07 source record](audits/queries.md). Routes: **C · E · A · R**. Evidence placement: **extension**.

**Current:** Authored PG transaction scope/isolation governs these properties; dependency extraction follows handles but does not prove isolation or conflict policy.

**Failure case / boundary:** Two transactions both read available stock and each decrements it without a suitable conditional update/lock.

**Agent contribution and limit:** Inspect hidden read placement, participant handle and existing conflict checks. Atomicity alone is insufficient; business invariants and suitable SQL must be authored.

### P23a — Conflict detection compares assumed master state with actual state.

[P23a source record](audits/protocol.md). Routes: **E · A · R · D**. Evidence placement: **consumer**.

**Current:** The endpoint protocol has no automatic compare-and-swap or master-wins conflict algorithm; SQL can express authored preconditions.

**Failure case / boundary:** An update based on version 4 overwrites a row already at version 5.

**Agent contribution and limit:** Inspect the adapter’s compare/write atomicity and returned conflict state. If absent, implement the intended conditional SQL/policy; do not import master-wins by default.

### P19b — Atomic writes can still violate a cross-row business invariant.

[P19b source record](audits/protocol.md). Routes: **C · E · A**. Evidence placement: **app-check**.

**Current:** A PG transaction can supply atomicity; correctness of totals, balances or paired updates remains authored SQL/constraints/policy.

**Failure case / boundary:** Both debit and credit commit together, but their amounts differ.

**Agent contribution and limit:** Given an explicit invariant, inspect hidden helper semantics or build an independent domain oracle. Compiler/catalog checks can recognize existing constraints; neither infers business intent.

## Retries, repeated effects and deduplication

[Family baseline and evidence limits](05-categorization.md#retry).

### Q20 — Idempotence differs from effect-freedom and arbitrary function execution.

[Q20 source record](audits/queries.md). Routes: **P · E · A · R**. Evidence placement: **consumer**.

**Current:** Read paths retry; mutations are not automatically retried. SQL UPDATE does not by itself prove idempotence because expressions/triggers may differ.

**Failure case / boundary:** Repeating “increment count” changes state twice even though the endpoint is named setCount.

**Agent contribution and limit:** Establish a precise repeat-execution law over relevant state and effects, or an existing deduplication contract. A future replay consumer must require that law, not a verb/name.

### P18c — Replay can be prevented or deduplicated with a real call-ID contract.

[P18c source record](audits/protocol.md). Routes: **P · E · A · R**. Evidence placement: **consumer**.

**Current:** No automatic mutation retry is installed; there is no general server deduplication store.

**Failure case / boundary:** After losing a success response, an app resubmits the mutation and duplicates its effect.

**Agent contribution and limit:** Inspect existing atomic deduplication, key scope, result reuse, retention and concurrent duplicate handling. A token parameter without that machinery is insufficient.

### P23c — Repeated sync modifiers need an effect-free contract.

[P23c source record](audits/protocol.md). Routes: **C · E · A · D**. Evidence placement: **deferred**.

**Current:** There is no push/pull modifier pipeline. Similar obligations matter for any installed retried read/transform helper.

**Failure case / boundary:** A modifier charges or writes an audit record each time the same batch is retried.

**Agent contribution and limit:** Inspect exact modifier effects across hooks and errors. The effect domain required for replay is broader than the table set required for invalidation.

### P23d — Lost responses can duplicate already-completed processing.

[P23d source record](audits/protocol.md). Routes: **P · E · A · R**. Evidence placement: **consumer**.

**Current:** Unknown mutation outcomes are not automatically retried; user/app resubmission remains possible.

**Failure case / boundary:** The server commits, the connection drops, and a second request repeats the external effect.

**Agent contribution and limit:** Establish existing deduplication/idempotence if replay is desired. A green normal-response test or read-only PG footprint cannot establish this.

## Validation, conversion and disclosure

[Family baseline and evidence limits](05-categorization.md#values).

### C13 — Configured runtime output validation.

[C13 source record](02-research-survey.md). Routes: **P · C · E · A · R**. Evidence placement: **ordinary**.

**Current:** Authoritative collection rows are validated in the client. Generated res.json is an identity function; no general server-side mutation-result/output schema enforcement is shown.

**Failure case / boundary:** A malformed or sensitive field crosses the wire before the client rejects the row.

**Agent contribution and limit:** Add a schema/validator as ordinary code; inspect custom validators’ accepting paths. Evidence cannot substitute for running the validator before disclosure.

### L4a — Values stay separate from SQL/HTML code.

[L4a source record](audits/language.md). Routes: **P · C · E · A**. Evidence placement: **ordinary**.

**Current:** Supported Drizzle/SQL forms are analyzed; the footprint analyzer is not a general injection-safety checker or HTML escaper.

**Failure case / boundary:** A helper concatenates input into raw SQL while still touching only the expected table.

**Agent contribution and limit:** Inspect raw helpers’ parameterization/escaping on every path. Use existing parameterized APIs or repair code where separation is absent; a correct footprint does not prove injection safety.

### L5a — A decoder must establish the invariant assumed for client-supplied values.

[L5a source record](audits/language.md). Routes: **P · C · E · A**. Evidence placement: **extension**.

**Current:** Zod input parsing runs before the handler, but arbitrary refinements/decoders have only the guarantees their code enforces.

**Failure case / boundary:** A decoder casts a string to a validated tenant ID without checking its format or tenant membership.

**Agent contribution and limit:** Inspect all accepted-value paths and downstream preconditions. Keep syntactic admission separate from actor authorization and from encode/decode round trips.

### L20a — Producer/consumer message compatibility includes runtime decoding.

[L20a source record](audits/language.md). Routes: **P · C · E · R**. Evidence placement: **ordinary**.

**Current:** Inputs and confirmation envelopes have runtime validation. There is no general actor/mailbox protocol system.

**Failure case / boundary:** A remote producer sends a syntactically valid success message whose payload violates the consumer’s expected domain.

**Agent contribution and limit:** Inspect custom producer/decoder compatibility; standard endpoint schema compatibility is compiler/runtime work. Delivery and completion are separate obligations.

### L19a — An ordinary validator can return accepted values and throw on rejection.

[L19a source record](audits/language.md). Routes: **P · C · E · A**. Evidence placement: **extension**.

**Current:** Zod parsing is installed; the implementation of a custom refinement/transform is not certified merely by its declared type.

**Failure case / boundary:** A custom validator accepts a negative quantity on one branch then returns a positive-quantity type.

**Agent contribution and limit:** Inspect the installed validator’s accepting paths and transformations, or write a bounded exhaustive check. If it does not check the rule, fix the validator.

### L19b — Ordered parser composition determines final values and middleware observations.

[L19b source record](audits/language.md). Routes: **P · C · E · A**. Evidence placement: **ordinary**.

**Current:** The current boundary parses one generated envelope containing the declared input schema. It does not implement tRPC’s chained-input pipeline.

**Failure case / boundary:** A later transform overwrites a field already checked by an earlier validator.

**Agent contribution and limit:** Trace actual parser order and final output through opaque schema helpers. For ordinary visible Zod composition this is reusable compiler analysis; preserve raw optimistic input separately.

### L19c — Output shape and output disclosure are separate guarantees.

[L19c source record](audits/language.md). Routes: **P · C · E · A · R**. Evidence placement: **ordinary**.

**Current:** Client row checks cannot prevent bytes already sent; generated handlers do not impose a server output whitelist.

**Failure case / boundary:** A query includes a secret field which the client schema strips or rejects only after delivery.

**Agent contribution and limit:** Inspect whether an existing output parser actually strips/rejects forbidden fields before serialization, against an authored disclosure policy. Otherwise add the enforcement as code.

## Code placement, registration and delivery

[Family baseline and evidence limits](05-categorization.md#code-boundary).

### L4c — Generated route/endpoint identities do not collide.

[L4c source record](audits/language.md). Routes: **P · C · E**. Evidence placement: **ordinary**.

**Current:** Module/owner/name/ordinal identities and registry duplicate checks exist. This does not establish collision freedom for every unrelated app router/plugin.

**Failure case / boundary:** An opaque route plugin registers a path already owned by another handler.

**Agent contribution and limit:** Inspect the plugin’s registrations if they are outside the route compiler. Visible registrations need a deterministic collision check, not certification prose.

### L21a — Tier placement and opacity are different from source confidentiality.

[L21a source record](audits/language.md). Routes: **P · C · E · R · D**. Evidence placement: **ordinary**.

**Current:** Server handlers are extracted and server imports blocked in client loading; no Eliom client-fragment opacity/type calculus is implemented.

**Failure case / boundary:** A helper accesses browser APIs when invoked by server code, despite its source being excluded from the browser bundle.

**Agent contribution and limit:** Inspect environmental requirements of unsupported helpers. Placement checks and bundle exclusion are compiler/build mechanisms; do not infer a cross-tier theorem for TS.

### L21b — Deferred-fragment order and primitive-definedness are premises of a restricted model.

[L21b source record](audits/language.md). Routes: **C · E · A · R · D**. Evidence placement: **deferred**.

**Current:** No deferred-fragment scheduler or universal termination/type-preservation theorem applies to arbitrary endpoint JavaScript.

**Failure case / boundary:** A library throws for a nominally well-typed value, or a supposedly ordered effect runs asynchronously after return.

**Agent contribution and limit:** Establish a bounded helper’s input domain, failure and ordering contract when needed. Historical theorem premises are not missing Endpoints features to implement wholesale.

### Q05 — Exported helpers are distinct from public endpoint registration.

[Q05 source record](audits/queries.md). Routes: **P · C · E**. Evidence placement: **ordinary**.

**Current:** The compiler creates handlers for query/mutation declarations, not every exported function; registry discovery has explicit module rules.

**Failure case / boundary:** A wrapper accidentally marks an internal administrative helper as a public endpoint.

**Agent contribution and limit:** Inspect opaque registration plugins and reachability if used. Direct declarations are compiler-visible; endpoint reachability still does not imply authorization.

### P18a — Server-only execution is weaker than excluding server source from client delivery.

[P18a source record](audits/protocol.md). Routes: **P · C · E**. Evidence placement: **ordinary**.

**Current:** The compiler extracts handlers; load guards and sourcemap handling exclude declared server modules. Built-artifact oracle checks exist for generated cases.

**Failure case / boundary:** A runtime isServer conditional leaves a secret literal inside a delivered client module.

**Agent contribution and limit:** For unrecognized dependencies, inspect environmental/source classification and extend deterministic build checks. Existing bundle checks are framework evidence, not an app-specific certificate.

## Entity, session, operation and authority identity

[Family baseline and evidence limits](05-categorization.md#identity).

### Q21 — Operations target stable entity identity, not current array position.

[Q21 source record](audits/queries.md). Routes: **P · C · E · A**. Evidence placement: **extension**.

**Current:** Endpoint rows use id keys and queries have canonical instance identities. Application code can still choose the wrong row from a list index.

**Failure case / boundary:** A user selects item at index 2; reordering occurs; index 2 now names another item.

**Agent contribution and limit:** Trace ID selection and custom key/codec stability through helper boundaries. Framework keying is present; application selection semantics are separate.

### Q22 — Stale response rejection needs trustworthy version provenance and comparison scope.

[Q22 source record](audits/queries.md). Routes: **P · E · R · D**. Evidence placement: **deferred**.

**Current:** Epoch/topology checks and fresh reads handle overlapping local operations; this is not a global timestamp/LSN ordering protocol.

**Failure case / boundary:** A numerically larger timestamp from another clock is accepted as newer authority.

**Agent contribution and limit:** For future manifests, establish version source and comparability domain. Evidence cannot implement ordering; LSN/version optimization remains deferred.

### P12a — Different users must not share a browser data cache.

[P12a source record](audits/protocol.md). Routes: **P · C · E · A**. Evidence placement: **ordinary**.

**Current:** EndpointRuntime binds one scope to one DbClient and rejects scope changes; applications must create/clean up the appropriate client lifetime.

**Failure case / boundary:** Logout switches a UI identity but leaves another user’s retained client accessible.

**Agent contribution and limit:** Trace app session-to-client ownership and cleanup, including asynchronous callbacks. Scope partitioning does not prove server authorization.

### P17a — Write identity differs from row identity, especially when confirming deletes.

[P17a source record](audits/protocol.md). Routes: **P · E · R · D**. Evidence placement: **deferred**.

**Current:** RPC/transaction association correlates Endpoints calls; it does not use Electric’s operation-tagged replication matching.

**Failure case / boundary:** Two updates to the same row are confused by an adapter that matches only row ID.

**Agent contribution and limit:** Trace an existing write ID end to end, including delete handling and reuse. Do not infer per-operation confirmation from entity identity alone.

### P23b — Checkpoint timestamps must come from a trusted ordering authority.

[P23b source record](audits/protocol.md). Routes: **C · E · A · R · D**. Evidence placement: **deferred**.

**Current:** Current endpoint settlement does not trust client timestamps as sync checkpoints.

**Failure case / boundary:** A future incremental reader accepts a client-supplied future time and skips subsequent writes.

**Agent contribution and limit:** Trace timestamp assignment and ordering domain if an adapter introduces checkpoints. Standard SQL generation/ordering is compiler work; no checkpoint feature is currently needed.

## Authored authorization and its coverage

[Family baseline and evidence limits](05-categorization.md#authorization).

### C10 — Configured row/column and expression-based permissions are enforced.

[C10 source record](02-research-survey.md). Routes: **C · E · A · R**. Evidence placement: **ordinary**.

**Current:** Endpoint handlers retain authored authorization. The framework validates input and collection descriptors but does not supply application permission rules.

**Failure case / boundary:** A signed-in user submits another user’s row ID to an update guarded only by a login check.

**Agent contribution and limit:** Trace an opaque authorization helper and all accepting paths against an authored policy. An agent can repair code; evidence describes enforcement already present, not policy intent.

### C18 — Authorization at mount and privileged event boundaries.

[C18 source record](02-research-survey.md). Routes: **C · E · A**. Evidence placement: **ordinary**.

**Current:** Handlers can check each request. The compiler does not prove every application entry path is protected.

**Failure case / boundary:** A second endpoint invokes the same write helper without the authorization check in the first endpoint.

**Agent contribution and limit:** Enumerate entry paths and inspect opaque checks against the application’s policy; repair uncovered paths as authored code.

### L5c — HTTP method/CSRF policy can depend on cookie reads and persistent effects.

[L5c source record](audits/language.md). Routes: **P · C · E · A · R**. Evidence placement: **ordinary**.

**Current:** Generated query and mutation server functions use POST. This alone proves neither CSRF protection nor read-only query behavior; Start’s full HTTP policy was not audited here.

**Failure case / boundary:** A cookie-authenticated request with a side effect is admitted without the required origin/token check.

**Agent contribution and limit:** Trace hidden cookie reads/effects and actual HTTP protections if needed. The fact can drive linting; the app/server must enforce the chosen request policy.

### L22a — Operation and metadata conditions determine which validation/auth checks run.

[L22a source record](audits/language.md). Routes: **C · E · A**. Evidence placement: **ordinary**.

**Current:** No Open RIA attribute pipeline exists. Endpoint checks are ordinary authored control flow, including deletes.

**Failure case / boundary:** A delete path assumes an entity validator will enforce ownership but never invokes it.

**Agent contribution and limit:** Map each operation/entry path to the checks actually run. Do not import a source framework’s defaults as the intended Endpoints policy.

### Q09 — Trusted caller identity and internal-only reachability are separate.

[Q09 source record](audits/queries.md). Routes: **P · C · E · A**. Evidence placement: **extension**.

**Current:** Generated requests carry scope, but that client-supplied value is not a trusted identity; handlers must derive/check the actual session.

**Failure case / boundary:** A public endpoint trusts scope=admin, or an internal helper loses caller context.

**Agent contribution and limit:** Trace trusted session derivation and context forwarding through wrappers. Internal-only registration is a distinct routing property to check.

### Q15 — Permission predicates must govern the executed write/read, not only a stale preflight.

[Q15 source record](audits/queries.md). Routes: **C · E · A**. Evidence placement: **ordinary**.

**Current:** Authored SQL can include predicates; the compiler does not insert or certify application policies.

**Failure case / boundary:** Ownership changes between an earlier permission check and an unrestricted update.

**Agent contribution and limit:** Trace how opaque policy facts connect to the actual statement and transaction/isolation context. Repair authored predicates/locking when the connection is missing.

### Q16 — Policies may constrain both old and proposed row state.

[Q16 source record](audits/queries.md). Routes: **C · E · A**. Evidence placement: **ordinary**.

**Current:** Input schemas and authored SQL can enforce this; there is no generated before/after permission system.

**Failure case / boundary:** A user owns a row before the update and changes its owner to an unauthorized account.

**Agent contribution and limit:** Check accepting paths against explicit old-state and new-state rules. An agent cannot infer which ownership transfers the product intends to permit.

### Q17 — Permission coverage includes every result object and every affected transaction object.

[Q17 source record](audits/queries.md). Routes: **C · E · A**. Evidence placement: **ordinary**.

**Current:** Endpoints validates row shape, not per-row permission coverage; bulk policy checks remain authored.

**Failure case / boundary:** A batch authorizes its first row but modifies additional unauthorized rows.

**Agent contribution and limit:** Inspect loops, bulk WHERE predicates and helper-returned sets for complete policy coverage. Standard visible set logic belongs in reusable analysis.

### Q18 — Transition and field policies must cover every submitted change.

[Q18 source record](audits/queries.md). Routes: **P · C · E · A**. Evidence placement: **ordinary**.

**Current:** Input parsing may strip unknown fields; valid schema fields are not automatically authorized fields.

**Failure case / boundary:** A valid title change is accompanied by a forbidden role change that passes an any-field check.

**Agent contribution and limit:** Trace transformed input and enforce an authored all-fields rule against old/new values. A shape schema is not a permission policy.

### Q19 — Schema creation has a distinct permission boundary.

[Q19 source record](audits/queries.md). Routes: **C · E · A · D**. Evidence placement: **deferred**.

**Current:** Client requests do not carry arbitrary SQL/schema changes in this protocol; migration/admin endpoints, if authored, still need policy.

**Failure case / boundary:** An administrative helper permits adding a protected attribute even though ordinary row writes are denied.

**Agent contribution and limit:** Inspect relevant admin paths only when present. Do not add schema-edit permissions to ordinary data endpoints solely for parity with a schemaless source.

### P24a — Actor identity comes from trusted session context, not request arguments.

[P24a source record](audits/protocol.md). Routes: **P · C · E · A**. Evidence placement: **extension**.

**Current:** The generated envelope validates scope as a nonempty string, which is not authentication. Authored handlers must validate it against server context.

**Failure case / boundary:** A user changes the scope field to another user ID in a forged request.

**Agent contribution and limit:** Trace session derivation and every privileged use, including helper forwarding. An agent can repair the handler; the compiler must not insert auth behavior.

### P26a — Navigation and component/event paths can bypass the first middleware check.

[P26a source record](audits/protocol.md). Routes: **C · E · A**. Evidence placement: **ordinary**.

**Current:** Endpoint handlers are explicit server entry points, but application routes/actions outside them were not exhaustively audited here.

**Failure case / boundary:** A route checked during initial load later exposes a privileged action through a separate handler without rechecking.

**Agent contribution and limit:** Enumerate actual entry paths and their context/checks, including opaque framework wrappers. This is code-path analysis plus authored policy, not automatic auth rewriting.

### P26b — Revocation requires a response for already-active sessions/connections.

[P26b source record](audits/protocol.md). Routes: **P · E · A · R · D**. Evidence placement: **consumer**.

**Current:** Scope changes are rejected when resolved; that does not autonomously learn server revocation or erase all active browser data.

**Failure case / boundary:** A revoked user keeps an open tab showing cached data and attempts further actions.

**Agent contribution and limit:** Trace the app’s request checks, logout/client cleanup and any event-driven revocation. Live socket disconnect/sync is outside this transport; future requests still need authored checks.

## Prediction, rollback and action histories

[Family baseline and evidence limits](05-categorization.md#optimism).

### C7 — Optimistic merging/rollback with authored update and invalidation semantics.

[C7 source record](02-research-survey.md). Routes: **P · E · A**. Evidence placement: **app-check**.

**Current:** DB transactions and Endpoints settlement manage overlays; supported relation models propagate optimism. Arbitrary app predictions are not validated automatically.

**Failure case / boundary:** A title is trimmed on the server but raw optimistic input remains untrimmed, or changing a field moves a row across a filter.

**Agent contribution and limit:** Provide domain generators and an explicit comparison law for real onMutate/server executions. A test can expose a wrong prediction; legitimate server-state divergence remains allowed.

### C8 — Client/server divergence settles through authority; source engines also replay/rebase.

[C8 source record](02-research-survey.md). Routes: **P · E · A · D**. Evidence placement: **app-check**.

**Current:** Endpoints replaces guesses with authoritative reads and handles overlapping responses conservatively. Durable offline replay/rebase is not provided.

**Failure case / boundary:** Two users reserve the last item; both predict success but only one server operation succeeds.

**Agent contribution and limit:** Test authored conflict policy and prediction under declared initial-state assumptions. Framework settlement needs its own history oracle; passing app tests does not install a sync engine.

### Q13 — Overlapping overlays, rollback and intervening authority need history checks.

[Q13 source record](audits/queries.md). Routes: **P · E · A**. Evidence placement: **app-check**.

**Current:** Runtime overlap/topology handling and history regressions exist; arbitrary app action histories are not automatically certified.

**Failure case / boundary:** A second optimistic action relies on a row created by a first action that fails.

**Agent contribution and limit:** Extend app generators to causal action histories and declared conflict semantics, exercising real actions and server paths. The independent framework oracle checks settlement, not app intent.

### P12c — Conflict behavior depends on application semantics and current authority.

[P12c source record](audits/protocol.md). Routes: **E · A**. Evidence placement: **app-check**.

**Current:** The server executes authored conflict logic; the framework does not choose reservation/merge policy.

**Failure case / boundary:** Optimism reserves a now-unavailable item; a server rejection is expected, not an oracle failure by itself.

**Agent contribution and limit:** Supply concurrent-state generators and explicit permitted outcomes. Check authored policy separately from the framework’s rollback/settlement law.

### P17b — Causal rollback is different from discarding all pending work.

[P17b source record](audits/protocol.md). Routes: **P · E · A · R · D**. Evidence placement: **app-check**.

**Current:** Transactions isolate overlays and fresh reads settle overlaps. There is no general application dependency graph or durable replay of dependent writes.

**Failure case / boundary:** Create fails; a pending edit of that new row is still treated as independently valid.

**Agent contribution and limit:** Identify causal dependencies in authored actions and test failure histories. Automatic selective replay/cancellation would require a separate protocol.

### P17c — Optimistic state has an ownership scope and lifetime.

[P17c source record](audits/protocol.md). Routes: **P · E · A · D**. Evidence placement: **app-check**.

**Current:** Collections/actions bind to DbClient, not a component-local array. Cleanup retires collections; pending state is not durable across reload.

**Failure case / boundary:** Two UI roots accidentally use different clients for one intended session and display different guesses.

**Agent contribution and limit:** Inspect client sharing, cleanup and intended lifetime in the application. Persistence/offline semantics require additional mechanisms if desired.

### P24c — Existing/missing rows and null/undefined have operation-specific semantics.

[P24c source record](audits/protocol.md). Routes: **P · C · E · A**. Evidence placement: **app-check**.

**Current:** DB actions and authored PG SQL decide behavior; Endpoints does not impose Zero’s successful-no-op rules.

**Failure case / boundary:** Optimistic update of a missing row throws while authored SQL updates zero rows successfully, or undefined is confused with NULL.

**Agent contribution and limit:** Generate these states and compare according to the actual app/adapter contract. Inspect opaque write-helper defaults; do not declare source-framework parity as the expected oracle.

## Operation order

[Family baseline and evidence limits](05-categorization.md#ordering).

### Q06 — Some clients preserve mutation issue order with a queue.

[Q06 source record](audits/queries.md). Routes: **A · R · D**. Evidence placement: **none**.

**Current:** Endpoints deliberately dispatches overlapping actions without a mutation queue. Fresh settlement does not promise click-order execution.

**Failure case / boundary:** Set title A then B arrives as B then A; authority correctly ends at A.

**Agent contribution and limit:** No certificate can add order. If an app operation requires it, express sequencing/preconditions in authored code; do not add an implicit global framework queue.

### Q08 — Parallel actions require explicit sequencing for dependent work.

[Q08 source record](audits/queries.md). Routes: **P · C · E · A**. Evidence placement: **ordinary**.

**Current:** JavaScript awaits are preserved; the framework invokes concurrent actions without adding call order.

**Failure case / boundary:** A handler starts an async helper without awaiting it and returns before its writes.

**Agent contribution and limit:** Lint visible unawaited calls; inspect an opaque helper’s promise-completion meaning. For dependent UI actions, use the returned transaction’s persistence completion where appropriate.

### Q14 — Within-request operation order is distinct from transaction atomicity.

[Q14 source record](audits/queries.md). Routes: **P · C · E · A**. Evidence placement: **extension**.

**Current:** Authored await order is preserved; Promise.all remains concurrent and a transaction does not invent a requested order.

**Failure case / boundary:** An update races the insert it depends on inside a helper that launches both promises.

**Agent contribution and limit:** Inspect helper scheduling/await behavior and preserve explicit dependencies in app code. Do not infer sequentiality merely from a shared request or transaction.

## Query meaning, snapshots and determinism

[Family baseline and evidence limits](05-categorization.md#query-semantics).

### C4 — One logical snapshot per query and a restricted deterministic query context.

[C4 source record](02-research-survey.md). Routes: **P · C · E · A · R**. Evidence placement: **consumer**.

**Current:** A single SQL statement uses PG semantics. Multiple handler statements and parallel endpoint reads are not enclosed in a shared snapshot; external calls remain allowed.

**Failure case / boundary:** A query reads a total, another commit occurs, then it reads the component rows from a different snapshot.

**Agent contribution and limit:** Inspect hidden read dependencies and nondeterminism. To guarantee a shared snapshot, authored transactions with suitable isolation or new runtime behavior must exist.

### C14 — Supported SQL compilation and explicit cross-tier conversion.

[C14 source record](02-research-survey.md). Routes: **P · C · E**. Evidence placement: **extension**.

**Current:** The compiler recognizes bounded query shapes and uses runtime row schemas. Unsupported result transforms do not acquire a general relational model.

**Failure case / boundary:** A custom bigint-to-number conversion maps two different IDs to the same browser key.

**Agent contribution and limit:** Inspect a codec/transform for explicit identity, equality, ordering and membership laws over a stated domain. A proof/check does not implement missing query lowering.

### L20b — Opaque predicates can prevent SQL lowering and move filter/limit execution.

[L20b source record](audits/language.md). Routes: **P · C · E**. Evidence placement: **extension**.

**Current:** Bounded shapes are modeled; unsupported transformed queries remain opaque rather than gaining an invented client predicate.

**Failure case / boundary:** Filtering after LIMIT produces different rows from filtering before LIMIT.

**Agent contribution and limit:** Recover an opaque predicate’s meaning and preconditions. The compiler still needs a correct lowering rule; until then retain the full authored query/refetch path.

### Q04 — Deterministic context supports query reuse and subscriptions.

[Q04 source record](audits/queries.md). Routes: **P · C · E · R · D**. Evidence placement: **consumer**.

**Current:** The SQL analyzer marks recognized time/random functions as read uncertainty. Ordinary JS time, randomness and remote state are not controlled by a Convex-like executor.

**Failure case / boundary:** Date.now changes a query result without any table write that the dependency matcher can see.

**Agent contribution and limit:** Describe relevant nondeterministic inputs and hidden reads. Evidence may disable a particular reuse optimization; it cannot freeze time or install subscriptions.

## Component data composition

[Family baseline and evidence limits](05-categorization.md#composition).

### C6 — Fragment masking restricts component data access.

[C6 source record](02-research-survey.md). Routes: **D · R**. Evidence placement: **none**.

**Current:** Endpoint collections expose their row schema; no Relay-style fragment ownership/witness API is provided.

**Failure case / boundary:** A component reads a field it never declared because the shared collection happens to contain it.

**Agent contribution and limit:** No evidence fact can install masking. An agent could implement a chosen interface/compiler feature; it is a separate product feature, not needed for current refetch coherence.

### Q10 — Subtree data requirements compose before execution.

[Q10 source record](audits/queries.md). Routes: **R · D**. Evidence placement: **none**.

**Current:** Retained endpoints are refreshed together, but component fragments are not compiled into a composed subtree query.

**Failure case / boundary:** A parent loads its data and only then discovers a child’s unrelated query, causing a waterfall.

**Agent contribution and limit:** This needs a loading/composition mechanism if desired. An agent may refactor application loading code; evidence alone does not compose queries.

### Q11 — Fetch provenance differs from coincidental cached-field availability.

[Q11 source record](audits/queries.md). Routes: **R · D**. Evidence placement: **none**.

**Current:** Collections carry endpoint identity, not Relay fragment-spread witnesses for each component.

**Failure case / boundary:** A component appears to work only because an unrelated earlier screen fetched a field.

**Agent contribution and limit:** A component contract or lint rule could expose accidental reliance. A new fragment witness API is not required for current collection coherence.

## Public and internal errors

[Family baseline and evidence limits](05-categorization.md#errors).

### Q01 — Unexpected server errors are redacted.

[Q01 source record](audits/queries.md). Routes: **C · E · A · R**. Evidence placement: **ordinary**.

**Current:** refreshAfterMutation currently copies Error.message into the handler envelope; a framework-wide public/private error policy is absent on that path.

**Failure case / boundary:** A database exception includes SQL details or an internal URL and is sent to the browser.

**Agent contribution and limit:** Inspect existing mapper paths and authored public error classes. A safe mapper must actually run; documenting the leak cannot prevent it.

### Q03 — Intentional public error disclosure is conditional on status/type.

[Q03 source record](audits/queries.md). Routes: **C · E · A · R**. Evidence placement: **ordinary**.

**Current:** The handler error envelope has a string message, not a Wasp-style 4xx-only public error contract.

**Failure case / boundary:** An internal 500 is wrapped in a nominal public error and its details are exposed.

**Agent contribution and limit:** Inspect all mapping conditions, not just the class name. Select and implement the app/framework error contract before certifying a mapper against it.

### P18b — Remote error redaction differs from local server error detail.

[P18b source record](audits/protocol.md). Routes: **C · E · A · R**. Evidence placement: **ordinary**.

**Current:** Mutation Error.message is passed into the client envelope; no distinct internal/public error mapper is enforced there.

**Failure case / boundary:** An internal exception suitable for server logs exposes account or connection details to the client.

**Agent contribution and limit:** Inspect custom mapper and logging paths against an authored disclosure contract; add the mapper where absent. This overlaps Q01, not a second independent defect.

## Evidence scope, deployment and invalidation

[Family baseline and evidence limits](05-categorization.md#evidence-lifetime).

### C17 — Backend event order and reset detection.

[C17 source record](02-research-survey.md). Routes: **P · E · R · D**. Evidence placement: **consumer**.

**Current:** Query versions and client lifetimes reject some stale state. There is no backend reset protocol or general evidence-to-deployment binding.

**Failure case / boundary:** A remote database is replaced while local source hashes stay unchanged; an old contract is still treated as applicable.

**Agent contribution and limit:** Bind a remote fact to an inspectable implementation/environment identity. A consumer must invalidate/recheck it on mismatch; evidence itself does not reset caches.

### C19 — Code identity differs from mutable deployment names and environment identity.

[C19 source record](02-research-survey.md). Routes: **P · C · E · R**. Evidence placement: **consumer**.

**Current:** Compiler versions include local source/schema evidence; a URL or package name is not bound to its current remote implementation/configuration.

**Failure case / boundary:** The API behind a stable URL gains a PG write without changing the endpoint source.

**Agent contribution and limit:** Record exact inspectable remote revision/configuration and an invalidation condition. If identity cannot be established, the claim remains conditional or unknown.

### L4b — Module encapsulation and schema agreement have an external-access boundary.

[L4b source record](audits/language.md). Routes: **P · C · E · A · D**. Evidence placement: **consumer**.

**Current:** A build-time catalog snapshot is checked for format/hash. TS encapsulation does not restrict DB credentials or prove exclusive writers; unrelated writers are outside scope.

**Failure case / boundary:** A deployed migration changes table semantics after the analyzed snapshot was built.

**Agent contribution and limit:** Bind analyzed schema and physical DB/environment to deployment. Do not require exclusive-writer proof for the user’s mutation-scoped coherence contract, or introduce per-request catalog scans.

### L5d — Escape hatches widen the code that an audit must cover.

[L5d source record](audits/language.md). Routes: **C · E · R**. Evidence placement: **consumer**.

**Current:** Analyzed local helper files affect versions, but skipped imports and remote/configured hooks do not form a complete audited closure.

**Failure case / boundary:** A reviewed wrapper delegates to a newly configured hook outside the recorded dependency list.

**Agent contribution and limit:** Enumerate reachable extension points and configuration, pin the evidence scope, and name unresolved paths. The evidence consumer must reject stale or incomplete claims for its required domain.

### L27b — Storage authority depends on environment and runtime configuration.

[L27b source record](audits/language.md). Routes: **P · E · A · R**. Evidence placement: **consumer**.

**Current:** Physical module/relation binding and session scope are modeled locally; no Unison-style environment access system is provided.

**Failure case / boundary:** The same library/config key is routed to a different database or tenant.

**Agent contribution and limit:** Trace the actual binding and authority context. Bind remote evidence to those dependencies without copying credentials into evidence records.

### P25a — Identity mismatch needs a defined consumer response.

[P25a source record](audits/protocol.md). Routes: **P · E · A · R · D**. Evidence placement: **consumer**.

**Current:** Stale query versions reject with reload guidance, scope changes reject, and dev source changes trigger reload. General evidence mismatch behavior is not implemented.

**Failure case / boundary:** An evidence checker detects a stale remote contract but the matcher still uses its old write bound.

**Agent contribution and limit:** Bind the configured stop/refetch/recheck behavior as well as identity. Detection alone supplies no safety unless the consumer stops relying on the invalid claim.

## Replication and source-specific obligations

[Family baseline and evidence limits](05-categorization.md#sync).

### C16 — Checkpoint order, deletion retention and reconnect resync.

[C16 source record](02-research-survey.md). Routes: **C · E · D**. Evidence placement: **deferred**.

**Current:** These replication obligations are outside the Endpoints refetch protocol; client sorting alone supplies none of them.

**Failure case / boundary:** A paged change reader uses a nonunique timestamp and permanently skips tied rows or deletes.

**Agent contribution and limit:** For a future/existing sync adapter, inspect its cursor/deletion contract and run conformance checks. Standard SQL ordering belongs to compiler/catalog analysis, not an agent-only task.

### L27c — Provisioning idempotence preserves resource identity across repeated deployment.

[L27c source record](audits/language.md). Routes: **E · A · D**. Evidence placement: **deferred**.

**Current:** Resource provisioning is outside the endpoint query/mutation protocol.

**Failure case / boundary:** A repeated deployment helper creates a second database instead of reopening the first.

**Agent contribution and limit:** If such a helper becomes relevant, inspect its lookup/create and concurrency contract. This is not evidence that user mutations are idempotent.

### P16a — Failed upload acknowledgment may mean applied, discarded or durably queued.

[P16a source record](audits/protocol.md). Routes: **E · A · R · D**. Evidence placement: **deferred**.

**Current:** No FIFO upload queue/checkpoint engine exists. Endpoints reports read/transport failures rather than promising queue progress.

**Failure case / boundary:** A permanent rejection is repeatedly retried and prevents later queued changes from advancing.

**Agent contribution and limit:** For an adapter, trace every terminal outcome and its actual liveness behavior. Choosing discard versus retry is app policy; a successful HTTP response alone proves none of them.

### P25b — The inspected LiveStore docs explicitly lack merge-conflict handling.

[P25b source record](audits/protocol.md). Routes: **D**. Evidence placement: **none**.

**Current:** This is a source limitation, not a positive guarantee missing from Endpoints.

**Failure case / boundary:** A comparison table credits a conflict guarantee the inspected source explicitly says is unfinished.

**Agent contribution and limit:** No certification task follows. Preserve the negative source claim; do not turn it into an implementation requirement or evidence opportunity.

### P19a — Firestore read-before-write and offline rules are operation-specific.

[P19a source record](audits/protocol.md). Routes: **E · A · D**. Evidence placement: **deferred**.

**Current:** Endpoints uses PG and has no Firestore offline transaction/batch API. These restrictions do not transfer to arbitrary PG transactions.

**Failure case / boundary:** An audit wrongly rejects valid PG read-after-write code because it imports Firestore’s rule.

**Agent contribution and limit:** Only inspect these rules for an actual Firestore adapter. Preserve the source boundary rather than adding unrelated Endpoints restrictions.

# Hostile failure assay: coordinated separate writable query results

Two failures are confirmed in accepted code paths: distinct query declarations can collapse to one identity, and a handler error after a committed write bypasses authoritative refresh. A third observed failure, Unicode key ordering, depends on how the declared collation exclusion bounds supported data.

This readout assigns evidence dispositions, not implementation priorities or an adoption verdict.

## Audit boundary and controls

The auditor received one candidate, [hostile-candidate.md](hostile-candidate.md), and read the complete `hostile-assay` instrument. No sibling representation forms, other audit readouts, or prior conversation history were opened. Inspection covered the actual runtime, coherence evaluator, bound compiler, server refresh helper, relevant oracle generator/reference/driver, and the compiler/server contract tests. The existing extractor was inspected as a compiler dependency. No correlated live-query materialization implementation was examined.

The standard is the candidate's **first executable draft**, including its explicit exclusions at candidate lines 69–74. It is not arbitrary SQL support, distributed linearizability, or durable recovery. The failures below do not rely on pending concurrent actions, query creation during a mutation, GC races, multiple authored modules, conflicting guesses, or zero-mutation actions.

Execution used Node 22.13.1 and existing probe dependencies. The actual runtime and DB/Query Collection adapter were bundled with the probe's TypeScript aliases. The actual compiler and refresh helper were imported directly. Real PGlite supplies independent ordering and commit-boundary evidence. These are bounded executable boundary reproductions, **not** a new full-stack browser campaign. The unchanged 13 compiler/server contract tests passed. No implementation or existing oracle files were changed.

Replay all checks:

```sh
node probes/endpoints/design/representation/audit/repros/run.mjs
```

The reproductions assert the observed faults, so their successful exit confirms the counterexamples; it does not certify correctness. See [reproduction notes](repros/README.md) and [contract test output](repros/contracts.tap).

## Dispositions

| ID | Attack | Disposition | Scope |
| --- | --- | --- | --- |
| H1 | Handler rejection is treated as proof that no write committed. | **Confirmed** | Undeclared failure boundary for accepted opaque handlers. |
| H2 | Different query declarations receive the same identity. | **Confirmed** | One module, supported query shapes, distinct lexical scopes accepted by the compiler. |
| H3 | Client key order disagrees with the fixture's PG order. | **Confirmed behavior; conditional contract fault** | The candidate excludes collations; it does not specify an enforced ID alphabet. |
| H4 | Unknown effects skip unrelated retained queries. | **Rejected for this draft** | Runtime supplies unknown coverage and requests every retained query. |
| H5 | An insert excluded from its authored source cannot reach another result. | **Rejected** | A positive control succeeds when another retained query accepts the row. |
| H6 | Unsupported SQL has no safe full-result execution fallback. | **Source-supported admitted limit** | Candidate line 69 explicitly defers this broader preservation requirement. |
| H7 | Concurrency, lifecycle races, or exhausted-read reload prove this draft's claimed law false. | **Rejected as an in-scope attack; broader gaps remain source-supported** | Candidate lines 72–74 explicitly bound these behaviors. |

## H1 — A committed write can become an ordinary rollback error

**Broken claim.** Candidate lines 31 and 69 say unknown actual effects cause every retained requested query to be evaluated, including for opaque mutation handlers. That chain silently requires successful handler completion to establish the write boundary. A rejected handler is not evidence of zero committed effects.

**Source trace.** [refresh.server.ts](../../../integrated-todo/src/refresh.server.ts):17 awaits `mutate()` **outside** the `try` starting at line 18. A rejection skips all reads at lines 19–32 and never reaches the committed-read-error outcome at lines 34–39. The compiler allows opaque mutation bodies and invokes this helper at [bound-transform.mjs](../../../integrated-todo/bound-transform.mjs):356–365; its structural restrictions at lines 151–177 do not enforce a SQL transaction. Client persistence only records a distinct committed error for a returned `read-error` at [runtime.ts](../../../integrated-todo/src/runtime.ts):270–279. A rejected RPC escapes directly. DB then rolls back at `packages/db/src/transactions.ts`:637–656.

**Concrete failure scene.** A loaded all-Todos collection is empty. An action synchronously inserts one guessed row. The handler's first SQL write commits. A second SQL statement fails, or code after the write throws. The client gets an ordinary persistence rejection, removes its guessed row, and never refreshes the retained collection. The server still holds the inserted row. No concurrency or unavailable read is needed.

**Evidence.** [pg-postcommit-report.json](repros/pg-postcommit-report.json) records a real first PGlite INSERT surviving a second INSERT's `23505` unique-key error; refresh read count is **zero**. [runtime-report.json](repros/runtime-report.json), `postCommitHandlerFailure`, records the actual runtime showing the row optimistically, ending in `failed`, leaving the client empty while the server fixture holds the row, and leaving `readErrors` empty. Its one read call is the initial load. The runtime fixture uses an in-memory full-Todo authority to isolate client publication; the separate PG fixture proves the server boundary with a reduced SQL table. Neither is presented as a full-stack generated replay.

**Defeater and reversibility.** This undercuts the premise “handler rejected, therefore ordinary optimistic rollback restores confirmed truth.” The rollback is locally reversible but cannot undo the committed database write. The error outcome loses the distinction between no commit and unknown/partial commit. A retry can repeat already committed work. The admitted response-loss limit does not cover this scene: the handler error is delivered and reads remain available.

**Why tests missed it.** The generated handler performs one SQL statement after `beforeWrite`: [program.mjs](../../../integrated-todo/tests/oracles/program.mjs):39–54. Rejection happens in the gate before SQL at lines 122–128 and 141–144. The driver applies confirmed reference effects only when the outcome is not `reject`: [driver.mjs](../../../integrated-todo/tests/oracles/driver.mjs):459–465. This is a false-green failure classifier for general opaque handlers: every rejected handler is modeled as a pre-commit rejection. The focused test at [refresh.test.mjs](../../../integrated-todo/tests/refresh.test.mjs):52–72 likewise throws before recording any durable effect and asserts zero reads.

**Smallest oracle improvement.** Add a failure-phase dimension: before any effect, after one committed effect, and during a later effect. Track committed effects independently of handler fulfillment. Keep the existing pre-write rejection law, but add: when commit status is unknown or partial and reads are available, a failed action must not silently publish the pre-write baseline as established authority. Assert refreshed values or an explicit uncertainty state for every retained result, and assert that recovery does not repeat the write. One post-write throw transition catches the class; a partial multi-statement mutation extends it.

**Repair condition.** Establish a real atomic handler contract covering all supported SQL writes, with evidence that rejection implies rollback; or represent handler outcome separately from commit status and perform conservative reads after a possibly effectful rejection. Preserve both the handler error and recovered authority. Do not repair this by retrying the entire opaque handler. If atomic, single-statement handlers are intended as a draft precondition, state and enforce that boundary; the current compiler does neither.

## H2 — Query identity loses lexical declaration identity

**Broken claim.** Candidate P6 at line 12 requires query identity, and lines 27–31 rely on identities to carry the right model, collection, and trusted server read together. Two distinct declarations can map to one identity before scope or arguments enter the picture.

**Source trace.** [bound-transform.mjs](../../../integrated-todo/bound-transform.mjs):82–91 accepts a declaration in the nearest named function body, including nested functions. Lines 294–295 retain only the endpoint variable name and that function's bare name. Lines 326–335 form `moduleId:owner:name`; no lexical scope identity or duplicate-key check is added. The generated refresh dispatch uses those keys at lines 357–362. At [runtime.ts](../../../integrated-todo/src/runtime.ts):140–149 the first collection with a key wins; lines 156–157 overwrite its model on rebinding while returning the existing collection. The original collection's RPC was captured at lines 126–133.

**Concrete failure scene.** One authored module exports two component factories. Each contains a locally scoped function named `TodoApp`, and each function declares `rows`. One supported query selects active Todos; the other selects completed Todos. Both components use the same client. The compiler accepts both declarations and assigns the same ID. The two collections are one object, so they cannot independently show their two SQL results.

**Evidence.** [compiler-report.json](repros/compiler-report.json) shows two accepted queries with memberships `false` and `true`, both keyed `6a54ba8dfd34:TodoApp:rows`. The full [authored input](repros/compiler-collision-input.tsx) and [generated output](repros/compiler-collision-output.txt) are preserved. [runtime-report.json](repros/runtime-report.json), `duplicateIdentityRuntime`, shows both bindings returning the same handle and the active row for both, where the second read should contain the completed row. This runtime test directly supplies the same colliding key shape; it is separate from compiler execution.

**Defeater and reversibility.** This is rebutting evidence against identity preservation. Once the two declarations collapse, neither the model map nor a response `{id, rows}` can recover which declaration was intended. The generated server object also contains duplicate property keys, so the later read shadows the earlier one. Loading and authoritative refresh can therefore use different declarations under the same ID. Client scope isolation cannot repair a collision within one client.

**Why tests missed it.** [program.mjs](../../../integrated-todo/tests/oracles/program.mjs):18 and 65 generate one `TodoApp` with unique `rows0`, `rows1`, etc. [e2e.mjs](../../../integrated-todo/tests/oracles/e2e.mjs):31–63 varies query count and data but not lexical declaration layout. Existing compiler tests use the one fixed endpoint module at [server-order.test.mjs](../../../integrated-todo/tests/server-order.test.mjs):8–13. Thus all generated declaration identities are injective by construction; the identity law itself is never tested.

**Smallest oracle improvement.** Generate at least two legal lexical layouts containing repeated owner/local names. Assert that distinct declarations produce distinct runtime and dispatch identities, or that compilation explicitly rejects an unsupported collision. Then instantiate both queries on one client with deliberately disjoint memberships and compare each result to its own SQL reference. This tests declaration identity rather than only adding another endpoint-count example.

**Repair condition.** Encode enough lexical declaration identity to distinguish these nodes, or diagnose duplicate generated keys before emitting code. A runtime check rejecting incompatible model/RPC rebinding would catch corruption later, but it does not by itself restore a one-to-one compiler identity. This is within the stated one-module bound; nested lexical declarations are not currently an explicit exclusion.

## H3 — The default fixture can disagree on Unicode ID order

**Broken link.** The candidate promises ascending `createdAt`/`id` order at lines 27 and 69, but excludes collations at line 70. What values are safe for `id` remains unstated. The fixed Todo application uses UUID input, while the generated mutation grammar accepts general strings.

**Source and evidence.** [runtime.ts](../../../integrated-todo/src/runtime.ts):77–85 compares string IDs with JavaScript `<`/`>`. [pg-order-report.json](repros/pg-order-report.json) records the fixture's default database locale (`datcollate=C`, `datctype=C.UTF-8`) sorting U+E000 before U+10000. JavaScript sorts them in the reverse order. [runtime-report.json](repros/runtime-report.json), `unicodeOrder`, confirms that the actual collection reverses an already SQL-ordered RPC result on initial load. Equal timestamps would expose the same mismatch when `id` is the tie-breaker.

**Disposition.** The behavior is confirmed. It is a contract fault if the draft accepts arbitrary valid text IDs under its existing fixture collation. It is outside the draft if supported IDs are explicitly limited to a domain, such as canonical UUID strings, for which the order agrees. The broad collation exclusion prevents treating this as an unconditional demand for general locale support. The missing enforcement/documentation of the safe value domain is the issue to resolve.

**Why tests missed it and smallest improvement.** [e2e.mjs](../../../integrated-todo/tests/oracles/e2e.mjs):56–60 assigns ASCII `seed-*` IDs; [reference.mjs](../../../integrated-todo/tests/oracles/reference.mjs):104–108 assigns ASCII `new-*` IDs. Unicode variation at `e2e.mjs`:27 changes display text, not sort keys. Add a key-domain generator including BMP/non-BMP boundaries and compare collection order directly to PG. Alternatively, make the bounded ID contract explicit and add rejection assertions for values outside it. General collation machinery is not required to test this boundary.

**Repair condition.** Define and enforce a supported key domain, or use a comparator matching the supported database collation. Merely including `id` in SQL order proves uniqueness of order positions; it does not prove equivalence of the client comparison.

## Rejected attacks and admitted gaps

**Unknown effects are not currently pruned.** [coherence.ts](../../../integrated-todo/src/coherence.ts):18–21 makes unknown coverage affect every query. [runtime.ts](../../../integrated-todo/src/runtime.ts):262–275 always supplies unknown and serializes all retained targets. Subscriber count is absent from retention at lines 188–192. Claims that the current runtime trusts `RETURNING` as a complete effects list, or refreshes only optimistically touched collections, are rejected for the inline path. H1 is a distinct exception-path gap.

**Source-excluded insertion is not inherently broken.** The runtime control in [runtime-cases.ts](repros/runtime-cases.ts) inserts a completed row through an active-only source while an all-rows query is retained. The source removes the row, the other query receives it immediately, and both settle correctly. This case remains nonempty because another recipient retains the insert. The separate case excluded from *every* query is expressly outside the candidate's action contract at line 71.

**Broader fallback is not implemented.** Query recognition rejects unsupported predicates, projections, arguments, and ordering at [bound-transform.mjs](../../../integrated-todo/bound-transform.mjs):244–285. P5's general unknown-query execution fallback is therefore not established, but candidate line 69 states that limit. Repair requires a trusted dispatch/execution path independent of membership analysis and an oracle covering unknown read analysis; it is an expansion of scope, not a hidden failure of supported full-row queries.

**Lifecycle and concurrency remain real open obligations.** The retained set is captured at [runtime.ts](../../../integrated-todo/src/runtime.ts):296; new collection creation is rejected during pending work at lines 140–144; unloaded retained queries reject mutations at lines 297–303. Publication installs responses without revision ordering at lines 289–292. Overlapping responses, GC/restart during work, and a common SQL snapshot cannot be inferred safe from sequential checkpoint tests. Candidate lines 72–73 expressly disclose this. Extending the contract requires schedule/generation dimensions and an observer trace across publication, not more sequential CRUD examples.

**Exhausted reads do not count as a concealed rollback assertion here.** The helper returns a committed-read error at [refresh.server.ts](../../../integrated-todo/src/refresh.server.ts):34–39; the client records it at [runtime.ts](../../../integrated-todo/src/runtime.ts):277–279. The oracle checks the error and reloads before checking convergence at [driver.mjs](../../../integrated-todo/tests/oracles/driver.mjs):557–574. This does not prove a durable recovery protocol, but candidate lines 33 and 74 no longer claim one. H1 differs because the commit uncertainty is not recorded and available reads are never attempted.

**Cost evidence is not a general speed claim.** Candidate lines 56–65 separate request phases, bytes, and instrumented local timings, and expressly decline production performance or payload savings claims. No hostile failure is established by demanding those broader benefits. This audit did not rerun timing experiments or verify historical campaign totals.

## Stop condition

Every material attack pursued here has an explicit disposition. H1 needs an error/commit contract decision or evidence of enforced handler atomicity. H2 needs an identity rule or a compile-time exclusion. H3 needs a supported value-domain decision. Their repairs can be checked by the small law/generator extensions above. No further general search is needed to establish these boundaries.

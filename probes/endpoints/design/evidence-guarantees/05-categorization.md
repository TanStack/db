# What Endpoints provides, and where evidence can help

Date: 2026-09-15. Requested assessment of the frozen survey and loss audit,
against code at `9bbbd08d9` (production code last changed at `9189b4f34`).

**The small original list hid a larger set of distinct obligations.** Endpoints
already supplies much of the transport, collection and settlement machinery.
SQL analysis supplies useful dependency knowledge. Neither establishes arbitrary
helper effects, application policy, transaction isolation, external completion,
or domain correctness. Those gaps need different kinds of work.

This assessment groups **20 survey entries and 65 audit findings into 15
families**. It preserves every source ID, including source limitations and
features we do not want. The [complete ledger](05-categorization-ledger.md)
gives each ID its current behavior, a concrete failure case, and the exact work
an agent could contribute. Its [JSON source](05-categorization-ledger.json)
supports checking coverage and revising classifications.

## How to read the categories

Two classifications answer different questions:

1. **Work routes overlap.** A guarantee may need a compiler check, an opaque
   helper fact, an authored policy and runtime enforcement. `P` means a bounded
   part is present, never that the entire source guarantee is established.
2. **Evidence placement names the main role of evidence in this entry.** It is
   a reading of the entry, not a proposed API or a priority ranking. Compound
   entries retain their other parts in the ledger.

| Main evidence placement | Entries | What it means |
| --- | ---: | --- |
| Extension fact | 19 | A helper-specific semantic fact could feed a mechanism already present, once evidence admission is built. |
| Additional consumer | 18 | A fact would help, but the claimed guarantee also needs enforcement, scheduling, lifecycle or protocol behavior. |
| Application check | 8 | A domain oracle or prediction check can test authored behavior; it does not prove a complete effect bound. |
| Ordinary analysis/code | 24 | The main work is a reusable compiler/linter/build check, authored policy or a code fix. |
| Deferred/source-specific | 11 | Transfer depends on a sync, provisioning or other feature outside the present scope. |
| No distinct evidence task | 5 | The entry is a separate feature, a deliberately absent behavior, or a source limitation. |

These are **counts of overlapping source records assigned a main role**, not
counts of independent guarantees, implementation tasks, or newly discovered
bugs. C3, C20 and several audit records can describe the same effect-bound
problem. Nineteen extension entries do not mean nineteen certificate types.
The broader `E` work-route appears 80 times because inspection could help in
many hypothetical adapters; that number does **not** measure the evidence
system's value or unique agent capabilities.

“Agent fact” means knowledge not captured by our implemented reusable analysis,
such as an inspected library's actual behavior. It does not mean a fact that no
compiler could ever derive. When a pattern becomes common, a compiler rule or
library integration can replace repeated manual inspection.

## Current code evidence

These are source observations, not fresh runtime experiments or whole-program
proofs. The named tests show executable coverage exists; they were not rerun for
this documentation-only assessment.

| Key | Code inspected | What this supports, and its limit |
| --- | --- | --- |
| K1 | [inline-dependencies.mjs](../../integrated-todo/inline-dependencies.mjs), [bound-transform.mjs](../../integrated-todo/bound-transform.mjs) | Inline analysis records skipped imported calls but can still emit non-null SQL dependencies. The transform supplies those dependencies to refresh selection. This is SQL coverage, not complete opaque-call coverage. |
| K2 | [compiled-dependencies.mjs](../../integrated-todo/compiled-dependencies.mjs), [sql-effects.mjs](../../integrated-todo/sql-effects.mjs) | Build-time catalog/schema binding and SQL effects include supported routine/expression/foreign-key paths. Unsupported triggers, RLS, casts and contexts remain unknown. This does not analyze all PG features or arbitrary JS. |
| K3 | [function-dependencies.mjs](../../integrated-todo/function-dependencies.mjs), [function tests](../../integrated-todo/tests/function-dependencies.test.mjs) | Selected helper calls, reexports, branches and transaction parameters are followed. Transaction callback analysis passes the database owner through; it is not a proof of transaction handle identity, atomicity or isolation. |
| K4 | [registry.server.ts](../../integrated-todo/src/registry.server.ts), [dependencies.server.ts](../../integrated-todo/src/dependencies.server.ts), [registry tests](../../integrated-todo/tests/registry.test.mjs), [pruning tests](../../integrated-todo/tests/pruning.test.mjs) | Server-owned definitions and versions admit retained descriptors before mutation; affected targets use dependency intersection. Unknown bounds force reads. Baseline tokens are scoped optimization tokens, not agent certificates. |
| K5 | [refresh.server.ts](../../integrated-todo/src/refresh.server.ts), [refresh tests](../../integrated-todo/tests/refresh.test.mjs) | The handler is awaited once, then selected reads run, including after a throw. Reads retry at 1/2/4 seconds. Handler errors and exhausted reads remain separate. No transaction wrapping, job completion tracking or mutation replay is added. Error.message is exposed in the handler envelope. |
| K6 | [runtime.ts](../../integrated-todo/src/runtime.ts), [authority regressions](../../integrated-todo/tests/authority-regressions.ts) | DbClient-scoped collections, all retained targets, atomic local publication, epoch/topology admission and fresh reads for overlap exist. These do not impose server mutation issue order or a shared PG snapshot across queries. |
| K7 | [validate-mutation.server.ts](../../integrated-todo/src/validate-mutation.server.ts), [bound-transform.mjs](../../integrated-todo/bound-transform.mjs), [validation regressions](../../integrated-todo/tests/validation-regressions.ts) | Server input parsing precedes handler execution; INVALID_INPUT has a distinct response. Generated res.json returns its argument. Arbitrary validators may execute code; handler-not-started is not proof that a custom validator had no effects. |
| K8 | [scalar-query.mjs](../../integrated-todo/scalar-query.mjs), [coherence.ts](../../integrated-todo/src/coherence.ts), [scalar tests](../../integrated-todo/tests/scalar-query.test.mjs) | Bounded relation/projection/membership/order models support peer optimism. Unsupported transforms/windows do not automatically gain a model. Arbitrary SQL support for dependency discovery is different from support for optimistic relational execution. |
| K9 | [query-instance.ts](../../integrated-todo/src/query-instance.ts), [query-registry.mjs](../../integrated-todo/query-registry.mjs) | Canonical scalar parameters, module-scoped definition identities, duplicate checks and version-triggered reload behavior exist. This does not identify remote deployment/configuration or authenticate a client scope. |
| K10 | [transform.mjs](../../integrated-todo/transform.mjs), [browser oracle driver](../../integrated-todo/tests/oracles/driver.mjs) | Handler extraction, explicit server-module rejection and map controls separate delivery from execution. The oracle inspects generated JS/maps/HTML and server positive controls. Arbitrary plugin/build configurations remain outside that finite coverage. |

## Family assessments

Every ledger item links to one family below. These paragraphs supply the code
baseline, candidate evidence method and invalidation conditions shared by those
items. A “failure case” in the ledger is a constructed counterexample unless
explicitly described as inspected code behavior.

<a id="effects"></a>
### 1. Effect bounds and affected collections

**Present:** supported SQL read/write sets and a consumer that matches them
against retained queries (K1–K4). A safe upper bound can be coarse. Precision
can improve later without changing the basic contract.

**Missing knowledge:** hidden reads as well as writes. A query can depend on
membership read by an auth helper even when its final SELECT touches recipes
only. A mutation's helper can write another table on a success, error or
conditional branch. HTTP, storage and in-memory effects are distinct from PG
effects.

**Agent task:** inspect a particular helper/API implementation and configured
hooks; combine that fact with compiler-derived SQL effects. Record database
binding, relevant paths and unresolved calls. Invalidate when those dependencies,
schemas or remote contracts change. A green sampled test does not establish
that no other table can be written.

This is an extension of an existing consumer, but evidence admission is still
unbuilt. **The current SQL-only fallback is not conservative with respect to
uninspected calls:** it can emit a useful SQL set without a complete handler
set. The ledger records that contract gap; it does not treat it as newly fixed
or experimentally reproduced here.

<a id="completion"></a>
### 2. Completion, visibility and acknowledgment

**Present:** await handler, collect authority, validate it, then settle; preserve
different outcome classes (K4–K7). The protocol can reconcile committed writes
even when the handler throws.

**Missing knowledge:** what “await completed” means inside an opaque dependency.
Applied, queued, discarded and timed out are different. Returning a failure
value may differ from throwing. Read visibility also depends on where reads
execute; this assessment does not certify a replica routing contract.

**Agent task:** trace the real adapter's completion and error paths, including
work that survives a throw or timeout. Pin that implementation/configuration and
the read authority. If writes may continue afterward, evidence cannot make an
immediate refetch sufficient; existing completion/polling behavior must be
identified or new behavior supplied. “Refetch everything” is safe only after
the relevant write boundary has actually closed.

<a id="transactions"></a>
### 3. Atomicity, isolation and domain invariants

Three distinct laws live here: all writes commit together; decisions read an
appropriate state; the committed result obeys the application invariant.
Neither the first nor a `transaction(...)` syntax node implies the others.

**Present:** authored PG transaction semantics, source traversal and
partial-commit reconciliation (K3, K5). **Not supplied:** automatic transaction
wrapping, distributed rollback or a proof of application invariants.

**Agent task:** inspect an opaque adapter's actual transaction handle and
existing commit/rollback hooks. Ordinary visible handle-flow and isolation
checks belong in the linter. A domain invariant such as balanced transfers is
an authored requirement; an independent domain oracle can test it. Invalidate
on callback/adapter implementation, connection routing, isolation, hook order
or invariant changes. Evidence can describe compensation already implemented;
it cannot undo an external charge.

<a id="retry"></a>
### 4. Retries, repeated effects and deduplication

**Present:** read retries and no automatic mutation replay (K5–K7). These are
deliberate choices. A read helper with effects still needs scrutiny; its name
does not make repeated execution harmless.

**Distinct evidence:** no effects before a specific failure, a repeat-execution
law, and durable deduplication are three different grounds for a future replay
decision. Inspect every relevant effect domain, concurrent duplicates, key
scope, retention and saved-result behavior. Invalidate on the exact outcome
mapping, helper, hooks, key construction or dedup store contract. This is not a
proposal to add mutation retries now. PG-write-empty alone supports none of
the broader replay claims.

<a id="values"></a>
### 5. Validation, conversion and disclosure

**Present:** server input parsing, row/envelope admission, bounded scalar keys
and typed endpoint code (K7–K9). **Separate laws:** accepted-value invariants,
parser order, key preservation, equality/order preservation, SQL parameter
separation and permitted output fields.

**Agent task:** inspect a custom decoder, predicate or codec for an explicit
law over a named domain. Ordinary schema code and parameterized SQL are
implementation, not evidence files. Exhaustive finite checks can establish a
finite claim; generated checks expose failures without proving arbitrary
behavior. Bind the claim to parser order, schema, codec, collation and domain.

There is a concrete distinction in current code: client-side row validation
cannot enforce server-side disclosure. Generated `res.json` is an identity
function, and mutation results have no universal output-schema enforcement on
that path. A desired whitelist must run before data crosses the boundary.

<a id="code-boundary"></a>
### 6. Code placement, registration and delivery

**Present:** recognized declaration extraction, endpoint identity checks,
server-module load rejection and bundle/map inspection (K9–K10). These are
reusable compiler/build guarantees; an agent need not certify each ordinary
endpoint separately.

**Possible extension fact:** an unknown library's execution environment or
opaque plugin's registrations. Inspect its code and actual build configuration;
invalidate on either changing. A runtime `isServer` check is not evidence that
source was excluded. Historical language theorems about typed messages or
deferred fragments are not whole-JavaScript guarantees we can recover by adding
a declaration.

<a id="identity"></a>
### 7. Entity, session, operation and authority identity

These identities answer different questions: which row, whose cache, which
request, which version of a result. **Present:** row IDs, canonical query
instances, one scope per DbClient, scoped server baseline tokens and local
authority admission (K4, K6, K9).

**Agent task:** inspect app ID selection, custom codecs, client lifetime
ownership and any adapter correlation/version source. Bind facts to those
paths and authority domains. Row ID cannot identify one of two writes to that
row. A scope string partitions a cache but does not authenticate the actor.
LSN/timestamp manifests would need a specified comparison and visibility
contract; they remain a possible optimization, not current machinery.

<a id="authorization"></a>
### 8. Authored authorization and its coverage

**Present:** a place for authored checks inside the unchanged handler, plus
input admission. **Not established by the framework:** intended policy,
trusted actor derivation, every-row/every-field coverage, old/new-state rules,
TOCTOU protection or revocation handling (K4, K7).

**Agent task:** trace opaque auth helpers and framework entry paths, then check
their behavior against an explicit application policy. Visible checks and SQL
predicates should become ordinary lint rules. Repairs remain edits to the
author's code; the compiler must not insert auth. Bind evidence to policy,
session provider, entry paths, context forwarding, query/transaction behavior
and helper versions. Shape-valid data is not necessarily authorized data.

This run did not audit all of Start's HTTP/CSRF policy or Kitchen's auth paths.
The ledger marks those limits instead of labeling POST requests or a session
scope as a security proof. Unrelated external revocations still require the
app's chosen event/polling/session behavior.

<a id="optimism"></a>
### 9. Prediction, rollback and action histories

**Present:** shared DbClient collections, transaction overlays, bounded peer
propagation and authoritative settlement, including overlapping responses
(K6, K8). That does not supply durable offline replay or exact prediction of a
server operating on a different state.

**Agent task:** provide app generators, controlled dependency behavior and
comparison laws for the actual onMutate/server code. Include missing rows,
defaults, null/undefined, failed creates with dependent edits and concurrent
conflicts. Test the whole history, not just one same-state mutation. Invalidate
on either implementation, schemas, query meaning, domain generator, oracle or
permitted approximation. These are application checks; passing them cannot
justify omitting an unobserved indirect write from a dependency bound.

<a id="ordering"></a>
### 10. Operation order

**Present:** authored JavaScript dependency order. **Intentionally absent:** an
implicit framework mutation queue (K5–K6). Correct settlement follows actual
server state; it does not make the last click the last server write.

**Agent task:** lint missing awaits and inspect whether an opaque helper's
promise covers its work. If an application needs sequential execution or
version preconditions, it must express that behavior. Bind any helper-order fact
to its implementation and scheduler contract. This is separate from atomicity,
even inside one request or PG transaction.

<a id="query-semantics"></a>
### 11. Query meaning, snapshots and determinism

**Present:** PG execution, build-time effects analysis and bounded optimistic
query models (K2, K8). These have different coverage. Knowing all tables a join
reads is easier than maintaining that join optimistically. Separate SELECTs do
not gain a single shared snapshot because the browser publishes them together.

**Agent task:** establish the meaning of an unsupported helper predicate,
transform or nondeterministic input. A compiler must still implement any
lowering/reuse rule that consumes it. Bind assumptions to the transform,
database semantics, input domain and execution context. Ordinary PG catalog or
EXPLAIN inspection is compiler work; no per-request schema check is proposed.
Subset/pagination support remains deferred, and unsupported cases must not have
their filters/windows silently discarded.

<a id="composition"></a>
### 12. Component data composition

Relay-style masking, fragment provenance and subtree query composition are
distinct interface/compiler features. Retained-query refresh is not the same
thing (K4, K9). Their absence does not show a missing agent certificate.

An agent can refactor loading code or implement a selected feature. Inspection
alone cannot make a component declare its dependencies or install a masking
API. No such API is selected by this categorization.

<a id="errors"></a>
### 13. Public and internal errors

K5 contains a concrete source-level disclosure gap: generic mutation exception
messages enter the response. Q01, Q03 and P18b describe different conditions of
that same family, not three independently reproduced bugs.

**Work:** define and implement the public error mapping. An agent can inspect
an opaque mapper's paths, status/type conditions and output fields; bind that
fact to mapper/configuration and disclosure policy. The existing input-error
and mutation-outcome distinctions do not already redact arbitrary handler
messages. Production reproduction and a red/green oracle extension were not
part of this assessment.

<a id="evidence-lifetime"></a>
### 14. Evidence scope, deployment and invalidation

**Present:** source/schema versions, watched local files, scoped baseline
tokens and several stale-client responses (K1–K4, K9). **Missing:** a general
evidence lifecycle. Baseline tokens answer a caching question; they are not
certifications of library behavior.

**Agent task:** enumerate the actual dependency closure of the claim, including
hooks, environment, remote revision, schema and configuration. Source hashes
cannot bind a mutable remote URL by themselves. The consumer needs a defined
response to missing/stale evidence. That response may be conservative refetch
for incomplete write bounds, but is not universally adequate for still-running
writes, absent authorization or missing transactions.

The eventual evidence format must preserve which claim a fact supports and
which consumer uses it. This identifies design requirements; it does not select
a certificate schema, storage protocol or trust model.

<a id="sync"></a>
### 15. Replication and source-specific obligations

Checkpoint completeness, tombstones, offline queues, replay ordering, storage
reset, provisioning and Firestore-specific sequencing are retained in the
ledger so they do not disappear from the comparison. They are not all features
Endpoints should implement. Current K4–K6 provide a request/refetch protocol,
not a general sync engine.

If an app introduces an adapter, an agent may inspect its checkpoint, conflict,
timestamp or idempotence contract. Bind that evidence to adapter/protocol
version, server authority, ordering and retention. No certificate creates the
engine. P25b is expressly a missing feature in the inspected source, not a
positive guarantee to recover.

## What expands beyond the six initial examples

The original examples remain useful anchors, but each conceals distinctions:

| Original example | Additional questions recovered |
| --- | --- |
| E1: hidden writes | Conditional/failure paths, completion, database binding, non-PG effects, read-only query obligations. |
| E2: hidden reads | Trusted actor provenance, every entry path, determinism, policy-sensitive query dependencies. |
| E3: transaction participant | Actual handle identity, reads/isolation, hook ordering, irreversible effects, precommit domain invariants. |
| E4: codec/transform | Accepted-value invariants, parser composition, stable keys, order/equality, output disclosure and SQL code/value separation. |
| E5: no-effect failure prefix | Idempotence, durable deduplication, lost responses, error-layer meaning and repeated modifiers. |
| E6: app optimism | Causal histories, conflicting authority, defaults/no-ops, action lifetime, explicit legitimate divergence. |

The practical distinction is the **consumer's premise**. A refresh matcher asks
for complete affected relations. A retry mechanism asks whether another attempt
is safe. A transaction lint asks which operations share an atomic boundary. A
domain oracle asks whether authored behavior meets an explicit rule. A single
“safe” or “pure” certificate would erase those differences.

## Limits and checks

- The ledger exhausts the **selected 85 records**, not every guarantee offered
  by every framework or all possible Endpoints failures. The survey itself
  distinguishes freshly inspected sources from inherited inventory.
- No new external source claims were introduced. Original URLs and qualifications
  remain in the frozen survey and audit records.
- The source survey is unchanged. Its SHA-256 is checked by the ledger validator.
- No production code changed and no runtime checks were rerun. Current behavior
  above comes from source inspection, with existing tests cited as coverage
  locations. Failure scenes are constructions, not measured incidents.
- Grouping by reusable obligation can hide product-specific semantics. The
  per-ID ledger preserves them; work routes overlap and the evidence placement
  can be revised without deleting a source record.
- No general evidence system, custom-helper certificate, remote completion
  contract, whole-app authorization proof or arbitrary-SQL optimistic model was
  implemented or certified by this work.

The separately requested [Frame Projection](06-frame-projection.md) compares
other ways of arranging these obligations. It does not choose a winning frame
or turn the inventory into a feature roadmap.

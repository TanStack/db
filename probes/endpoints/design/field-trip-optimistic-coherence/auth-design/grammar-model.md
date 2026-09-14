# Exploratory auth grammar — frozen v1

Run 23. Source: current Kitchen endpoint handlers and installed Better Auth 1.7.4, as bounded in sources S1–S19. Target: the legal boundary between running permission/session code and selecting payload refreshes. This is an exploratory, provisional model; it is not an exact-equivalence proof or an adopted API.

## Preservation contract

| ID | Property | Basis |
|---|---|---|
| P1 | Reconcile every affected retained collection, including optimistic recipients and missing baselines | User-required |
| P2 | Never accept caller scope, descriptors or payload-disjointness as permission | Source S1/S2/S11; inferred safety law |
| P3 | Preserve configured auth authority/cache policy unless explicitly changed | Source S3/S4; inferred constraint |
| P4 | Account for reachable auth, mutation, callback and error-path writes | User-required effect completeness; S4–S6/S12 |
| P5 | No runtime catalog inspection, proof locks, or new PostgreSQL infrastructure | User-required |
| P6 | Ordinary helper/service code remains valid; unknown analysis falls back | User-required |
| P7 | Client code receives no server auth implementation, credentials or SQL; proofs remain server-owned | User-required |
| P8 | Auth/session identity and request ordering constrain reuse; errors never turn into a permission certificate | Source S11–S14; inferred constraint |
| P9 | Optimistic state is a guess, retired through existing authoritative settlement; writes are not replayed after refresh failures | User-required; S12/S13 |
| P10 | External freshness is polling/events/sync responsibility, not a new implicit sync engine | User-required |

Not included as a sourced guarantee: immediate store-backed revocation, one database snapshot spanning all queries, exact callback/header timing after extraction, or automatic erasure of stale local data on denial. These omissions are consequential and constrain what generated forms claim.

## Candidate units (observation versus inference)

| ID | Unit | Job / trace |
|---|---|---|
| U1 | Invocation identity: request, endpoint definition/version, parsed input, claimed scope, server-validated auth context | Keeps checks, baselines and responses bound to their invocation; source S1/S2/S11; expanded binding inferred |
| U2 | Permission/session operation G: allow(value), deny, or error; may read/write and emit headers | Reconstructs requireUser/kitchenServices and Better Auth paths; S1–S9 |
| U3 | Payload operation D: rows and captured guard values; may be opaque until proven pure apart from reads | Reconstructs query body and output mapping; S10; split inferred |
| U4 | Effect bound E: known finite read/write relation sets with callback/error closure, or unknown | Makes skips legal or forbidden; existing analyzer/registry plus S4–S6; library model not implemented |
| U5 | Baseline/publication state B: retained rows, optimistic overlay, identity binding, authoritative outcome | Reconstructs skip eligibility and settlement; S11–S14; auth binding extension inferred |

Rejected units: provider brand (boundary parameter); transport headers (an output of U2, not independent policy); subscriber count (not legal skip evidence); derived fingerprint (encoding of U1/U2/B); session table as isolated module (overlaps permission, writes and payload).

## Active relations and overlap

L1: U1 binds G, D and B. L2: G can supply values/control to D. L3: E covers both G and D, including effects before an exception. L4: D plus identity/evidence replaces B through publication; unknown/denial cannot mint reuse evidence.

The G∩E overlap is active: session renewal both authorizes and mutates data. G∩D is active where ownership checks inspect payload rows or guard output chooses a query/projection. G∩B is active when role/session change makes an old payload inaccessible despite unchanged app tables. These are not a clean module tree.

A G/D module split is only a candidate interface when the compiler proves the prefix and all captures, D has no later permission/side effects, and boundary tests cover values/errors/effects. Current code has no such generated interface or tests. Unknown helpers remain whole operations.

## Rules and constraints

- R1 (source + inferred extension): Execute required permission operations under the app's configured policy for the current invocation. Neither table disjointness nor an old baseline authorizes a request.
- R2 (user/source): E is a conservative may-effect bound closed over reachable code, hooks, schema effects and failures. Unknown is top, never empty. Compile-time schema/code evidence is versioned; no runtime schema query.
- R3 (inferred): A factorization G;D is legal only with proven value/control captures and no concealed permission/effects in D. Opaque code uses the whole-handler path.
- R4 (user + inferred): Payload reuse needs a baseline bound to definition, input, scope and relevant server-validated guard values; no optimistic recipient; a known disjoint payload read set versus all covered request writes; and a current successful guard. A changed/unknown binding forces a read. Binding equality is not auth itself.
- R5 (source/user): Errors may follow committed writes; settle/refetch without replaying mutation. Do not retry an effectful prefix just because the payload read failed. Retry boundaries require proof of read-only D or an explicit existing whole-handler behavior.
- R6 (inferred): Any reordered/merged guard execution must declare its new temporal contract. No exact order or single-snapshot equivalence follows from set union. Preserve separate order-sensitive and request-scoped branches.
- R7 (user/source): Publish only to the matching live client/request context; unknown auth outcome cannot be represented as unaffected permission success. Denial versus outage display/erasure policy is unresolved C3.

Dynamics: G can change state and select D; mutations and guard effects determine refresh selection; authority replaces B. Constraints: R1–R7/P1–P10. Boundary parameters: pinned library/config/schema, adapter, cache time, phase/order, retained inputs, session generation, and callback reachability.

## Unresolved conflicts and loss

C1: Preserve repeated, time-sensitive auth invocations versus share one principal per request. No source-backed priority; both forms remain.
C2: Existing cached auth policy versus immediate backing-store revocation. No silent bypass.
C3: Confirmed denial versus transient outage: whether/when to clear inaccessible rows and retire identity, and how the transport distinguishes them. Current Error('Unauthorized')/generic read-error is insufficient evidence of a complete policy.
C4: Static may-effects preserve safety but may still cause broad invalidation. No measured compile success or speedup for a library summary.
C5: Header delivery and callback completion require transport/transaction evidence. Generic hooks cannot be assumed bounded.

Decomposition loses intermediate execution timing, cookie delivery order, arbitrary closure behavior, and any permission property spanning a guard plus later SQL snapshot. These remain exclusions or explicit new semantics, not silently preserved properties.

## Adjacent forms (unranked)

**F1 — Whole invocation with a pinned library effect model.** Rule combination: retain G;D as one handler, teach analysis a version/config/schema-checked Better Auth effect bound, including session reads/writes and hooks. Changes recognition, not execution granularity. Preserves original guard invocation/cardinality on full reads and P3–P7. A skipped handler still requires R1; without a separate proven permission path, it cannot be skipped merely by narrowing payload dependencies. New cost: maintain effect model and reject unknown config. Loss: static union may still defeat pruning; no promise of Kitchen gains.

**F2 — Execute each guard; select payloads afterward.** Split operator conditional on R3: keep one fresh G per retained query after the mutation; collect their may-writes; then run selected D operations. Successful guard values participate in baseline identity; permission checks run even for disjoint payloads and before revision reuse. Preserves per-query guard cardinality, configured policy, value capture, and request-write completeness. New interface: typed guard outcome + captures/effects and payload executor. Cost: barrier and effect aggregation; potential unused guard work. Loss: interleaving differs from current G1;D1 || G2;D2. It offers declared phase semantics, not exact equivalence. See isolated audit candidate for its bounded success claims.

**F3 — Request auth context plus endpoint-specific authorization.** Invert the repeated session lookup into a request-owned operation; keep row/tenant permission checks with endpoints. Preserves P2/P3 only under a declared principal lifetime (pre-write, post-write, or both remain branches). New structure: scoped principal/effects/headers available to normal service functions. Cost: invalidation across role/session mutation and per-request storage. Loss: call cardinality, renewal/header timing and mid-request freshness may change; cannot silently memoize today's function. No choice of phase is adopted here.

Independent range: **untested**. The cookie/expiry cases were used for extraction and cannot be relabeled held-out evidence. No second library or tenant-RLS system was supplied as an independent range case.

# Result-diff grammar: model v1

Exploratory candidate grammar for one source system. Evidence IDs resolve in [evidence.md](evidence.md); extraction, controls and projection map live in [process.md](process.md). Source properties P1–P10 resolve in [preservation.md](preservation.md).

## Candidate units

| ID | Unit and job | Basis / admission |
| --- | --- | --- |
| M1 | **Instance context:** registered definition/version, normalized inputs, trusted authorization context, collection lifetime and expected recipient membership. | Observed E1/E2; prevents cross-instance substitution and missing recipients. |
| M2 | **Operation:** authored overlay, invocation identity and running/closed/unknown outcome; participates in local overlap tracking. | Observed E1/E3. Closure and overlay belong to the same operation but are not the same state. |
| M3 | **Confirmed base:** exact immutable result representation, representation version, context binding and optional locator; explicit holder and retention lifetime. | Confirmed data observed E1; immutable transport copy/locator custody inferred from E5/E6. Needed only by base-dependent encodings. |
| M4 | **Target observation:** complete new server-read result, context, observation/closure association and opaque result identity where used. | Observed E3; target handle inferred. A handle identifies content; it does not order commits. |
| M5 | **Encoding:** full result, same-response shared result, exact base-relative delta, or unresolved summary-assisted form; total reconstruction or explicit failure. | Observed E4; extension inferred E5/E6. |
| M6 | **Publication gate:** validates/reconstructs every required result, checks operation/lifetime eligibility and publishes confirmed state plus handle before settling relevant overlays. | Observed E1; staging exact reconstruction/handle promotion inferred. |

These are reasoning units, not proposed classes or proven independent modules. Server caches, acknowledgments and fingerprints are fields/actions involving M3–M6, not extra primitives.

## Relations and active overlaps

L1–L7 are directed diagram annotations of the rules, not seven additional independent axioms. The ablation in process.md demotes their duplicate logical content while keeping the dependency map readable. X1–X3 name consequential intersections, not additional modules.

| ID | Directed relation | Consequential overlap |
| --- | --- | --- |
| L1 | M1 bounds M2 requests and M4 observations. | An instance's authorization and lifetime constrain both reading and reuse. |
| L2 | M2 authors optimism over M3 but does not rewrite M3. | Pending visible state and confirmed base share rows, not authority. |
| L3 | M3 + M4 feed M5; M5 may ignore M3 for a full response. | Exact representation and its custody jointly govern whether a reference is usable. |
| L4 | M5 + expected M1 + M2 eligibility feed M6. | Successful decoding and permission to publish are an active intersection. |
| L5 | M6 promotes eligible M4 to the next M3, then settles matching M2. | Baseline advancement and transaction publication are one coordinated event. |
| L6 | M1 lifetime/authorization changes invalidate M3 eligibility and M6 work. | Cache validity crosses collection lifecycle and security context. |
| L7 | Failed M3/M5 evidence exits to full data or read repair; uncertain M2 closure blocks false settlement. | Optimization failure and unknown server outcome require different exits. |

Overlap units X1 = (M3, M5, M1) **usable reference**; X2 = (M5, M6, M2) **eligible reconstruction**; X3 = (M6, M3, M2) **baseline promotion**. Removing these intersections changes legality. No tree of “cache / transport / transactions” alone represents them.

## Rules

| ID | Rule | Status / preservation |
| --- | --- | --- |
| R1 | Admit requested instances through the server registry and current authorization before mutation. A base locator is an optimization hint, never SQL or authority. Invalid endpoint/auth requests reject; stale/absent optimization state alone can use full data. | Source E2 plus inferred distinction; P2/P7/P9. |
| R2 | Capture an immutable confirmed representation or fall back. Bind it to instance, lifetime, projection/result semantics and codec version. Never use the currently visible optimistic rows as an implicit base. | Extension of E1/E5; P3/P4/P9. |
| R3 | Execute the mutation once; retain its outcome distinction; compute complete fresh results for all required instances. An empty delta means equality after reading, not permission to skip a query. | Source E3 with target-scope constraint; P1/P2/P6/P8. |
| R4 | A base-relative encoding is legal only when reconstruction yields the exact target in the declared representation. Approximate similarity may propose reuse, not certify it. Unsupported values/keys/order return full data. | Inferred E4–E8; P4. |
| R5 | Reconstruct in detached staging state. Check recipient completeness, shape, base correspondence and authority eligibility before any cohort publication; recheck validity at the publication boundary. Reentrant invalidation cannot leave partial installation or premature settlement. | Source E1; inferred transport extension; P2/P3/P5. |
| R6 | Promote the target handle only with successful eligible publication. Sending a response does not prove the client adopted it. A request may name only a base it actually retained; overlapping requests can name the same base. | Inferred E5/E6; P3/P5/P9. |
| R7 | Cache miss/eviction/worker change before encoding → full target in that response. Client base loss or malformed delta after receipt → no partial publication; recover with a fresh full read when closure permits. Stale target → existing overlap repair even if a full body is available. Unknown write outcome → existing explicit unknown/error path, never mutation replay. | E1–E3 plus inferred distinctions; P5/P8/P9. |
| R8 | Bound retained bytes, entries and in-flight base use. Eviction may abandon an optimization rather than block new actions. Isolate cache lookups by current server-authorized context. | Inferred E2/E6; P1/P7/P9. Limits/policy unresolved U3. |
| R9 | Choose representations only after correctness admission; compare actual request+response transport bytes, compute cost and end-to-end latency against full-result delivery. A size estimate is not a latency proof. | Source E4 plus user constraint; P10. |

## Dynamics, constraints, boundary conditions

Dynamics: admit → capture base → execute once → read targets → encode → stage → gate → publish/promote/settle, or an explicit R7 exit. Baseline custody may move between client and server; publication authority does not move with it.

Constraints: R1–R9 and P1–P10. Full bodies bypass base correspondence only; they do not bypass instance, closure or publication checks. Different encodings may coexist in a response, but partial validity does not authorize partial settlement.

Boundary conditions: codec domain, result size, changed fraction, result order, exact base availability, worker routing, cache capacity, trusted auth identity, retained-cohort changes, outstanding operations and source snapshot semantics. Runtime currently requires unique result IDs and has a narrow row schema. Bag/sequence generality of a transport idea does not broaden accepted endpoint queries.

## Protocol skeleton (analyst-inferred, not a public API)

```text
request:  invocation + registered instances + optional base evidence
response: handler outcome + complete recipient descriptions
          each recipient: target identity + full | shared | delta(base identity)
client:   stage exact reconstructed results
          validate all recipients and authority
          publish results and target identities together; then retire overlays
```

No new caller-facing collection API is implied. A target identity can be an opaque non-reused handle in a server/session namespace. It is not a PostgreSQL revision. Handle uniqueness and current auth checks are separate from row-content hash equality.

## Adjacent forms, unranked

### F1 — Application server retains exact previous results

Route: rule combination; augment M3 custody using the current optional application cache concept, replacing revision-only entries with exact immutable result representations for this new purpose. Preserve X1–X3 and R1–R9. This is a separate concept from reactivating the rejected database revision observer.

1. Initial load sends full target plus an opaque scoped handle; server may retain its exact representation within budget.
2. Client promotes the handle only after publication. A later mutation request carries that handle.
3. Server resolves a compatible retained base, performs full target reads, computes an exact delta, and sends base/target handles. A miss sends full target inline.
4. Client checks its retained base, reconstructs and gates the whole response. Its next use of the target handle reports adoption without a separate acknowledgment RPC.

New structure: result cache, immutable transport copies, handles, byte budgets, bounded in-flight references and lookup isolation. Lost responses must not make the server assume adoption or evict the sole usable predecessor by protocol rule; capacity eviction is still legal and causes full delivery. Multiple workers may miss each other's caches and safely send full data; no shared cache is required for correctness.

Loss/cost: server memory, copies/encoding, cache misses and possibly old authorized data retention. Full SQL read cost remains. Basis E1–E6; protocol assembly is inference. No TTL, capacity or routing policy selected.

### F2 — Client supplies the exact confirmed base

Route: rule combination; move M3's cross-request custody to the client and carry it with the request. Preserve X1–X3 and R1–R9. Unlike F1, this moves full data across the upstream link and can avoid cross-request server result storage.

1. Initial load remains full. Client captures a lossless immutable confirmed representation.
2. Later request carries that bounded representation and a request-local base identity. Server treats it as untrusted data, never as query scope, write data or current PG truth.
3. Server reads the complete authorized target and derives a patch that transforms the supplied base into it, including removal of extras. Client applies it only to the exact captured base for that request, then uses the same publication gate.
4. Missing base/codec support requests full delivery. No opaque server cache handle is required across invocations in this form.

New structure: lossless client export, bounded request parser, pinned immutable base for an in-flight request, request-local correspondence. Server must not reuse uploaded material as a shared authorized cache entry. Baseline resource admission happens before the write; a malformed/oversized request is distinct from a valid request lacking an optional base.

Loss/cost: request bytes can consume or exceed response savings; asymmetric uplink and decoding matter. It still needs transient server memory and client lifetime bounds. Basis E5/E6 as transferred exact-base logic; this ownership move is an analyst-generated form, not a cited complete protocol.

### F3 — Client supplies a compact summary (conditional form)

Route: rule combination; replace the full-base transfer in F2 with limited evidence at M3→M5. Preserve X2/X3, and expose the unresolved X1/R4 proof. This form is not admitted as an exact optimization merely because its data structures can be named.

Candidate path: client summarizes an immutable base; server reads the full target, proposes copies of matching old pieces plus new pieces; client reconstructs under the existing gate. Rsync and IBLT supply prior mechanisms for summary-assisted transfer/reconciliation (E7/E8), not a ready Endpoints protocol.

Branches: (a) exact additional evidence or interaction establishes every reuse claim, with full fallback when unavailable; details unconstructed; (b) an explicitly accepted probabilistic content-equality assumption, currently **not selected**; (c) summary used only to locate exact server-retained pieces, which becomes an F1 hybrid rather than a stateless third solution.

New structure/loss: summary encoding, matching/decoding, capacity/failure handling and possibly more read-only round trips. A short non-injective hash match alone cannot meet R4's exact guarantee. Detectable decode failure and silent collision are different cases. Sending a final hash does not by itself remove collision assumptions. This does not rule out lossless compression, exact protocols over bounded domains, or interactive reconciliation; none has been built here. Under the present unresolved proof, the universally legal behavior is full-result fallback.

## Lifecycle matrix

| Event | F1 server-retained | F2 client-supplied | F3 summary-assisted |
| --- | --- | --- | --- |
| Initial load | Full plus optional retained handle. | Full, capture local exact base. | Full, establish summary of confirmed base. |
| Successful mutation | Delta/full; promote target on publication, not send. | Diff supplied base; replace local base on publication. | Exact-evidence branch or fallback; collision assumption not silently accepted. |
| Lost response | Client keeps old handle; server keeps/may evict entries independently. Unknown operation still needs closure evidence. | Client keeps request's base; upload is not proof that a write closed. | Keep old summary/base; same closure boundary. |
| Overlapping mutations | Both may name B0; never chain B0→T1 delta onto T2. Existing repair can request full results. | Pin distinct request captures; same gate/repair. | Summaries do not order outcomes; same gate/repair. |
| Collection GC/recreation | Retire lifetime and base eligibility; old reply cannot enter new instance. | Release capture or mark unusable; never block new action to keep it. | Retire summary and referenced pieces together. |
| Scope/auth change | Reauthorize and rebind context; old handle cannot select/serve old-scope results. | Uploaded data remains untrusted; fresh reads use current scope only. | Summary/reference cannot grant authorization. |
| Server restart/worker change | Cache miss → full; non-reused namespace prevents accidental alias. | Request-contained base still usable after normal admission. | Depends on whether exact proof uses server state; that branch is explicit. |
| Client base lost mid-flight | Reject delta, full read repair after closure; no mutation resend. | Captured base absent → same repair. | Missing pieces → same repair, plus summary proof requirement. |
| Codec/query version change | Codec incompatibility → full when query is still valid; stale definition → existing admission error. | Same; never parse old content as new schema by guessing. | Summary algorithm/version binds to its representation. |
| Fresh reads fail or write outcome unknown | Existing error/closure semantics; retaining bytes never supplies missing authority. | Same. | Same. |

## Oracle laws for any later implementation

These are specifications for independent tests, not tests completed in this run.

| ID | Law and discriminating generator dimension |
| --- | --- |
| O1 | `decode(B, encode(B,T)) = T` for supported representations; include empty results, deletes, changed keys, typed values and order-only changes. Expected T comes from independent SQL/codec authority, not the diff algorithm. |
| O2 | Full/shared/delta choices for a fixed target have identical accepted confirmed results and overlay settlement. Mix forms across retained instances. |
| O3 | Wrong base/context/lifetime/codec never partially publishes or advances a base. Include extra rows and same IDs with different values. |
| O4 | A valid patch for an obsolete target never bypasses stale-response repair. Permute write completion, response delivery, registration and GC. |
| O5 | Lost response/eviction/restart cannot imply adoption. A later old-base request yields a correct delta or full data; no automatic write replay. Unknown outcome remains distinct from known closure. |
| O6 | Publishing target data and promoting its handle is coordinated with overlay retirement and reentrant callbacks. Observers cannot see a new handle paired with old data. |
| O7 | Every retained instance is covered; subscriber changes alone do not remove it. Recreated identical query IDs have distinct lifetimes. |
| O8 | External/intervening writes captured by the full target read appear in reconstructed output even when absent from the mutation's returned rows. Snapshot bounds are explicitly modeled. |
| O9 | Inject deliberately colliding summary/hash outputs, decoding failure and missing pieces. Exact mode must not silently emit a wrong target. Passing random noncollision cases is insufficient. |
| O10 | Baseline misses preserve functional results; any additional read response must itself pass the authority gate. Verify read errors, handler errors after partial commits and unknown closure separately. |
| O11 | Base data never influences SQL/auth or escapes its context; malformed/oversized baseline input is admitted/rejected before writes as specified. Client build still excludes server handlers/cache code. |
| O12 | Compare identical generated histories against full-result control. Count request+response bytes including envelopes, fallback reads and compression; measure DB work, server encoding, bounded memory, browser apply cost and end-to-end latency separately. No cache warmness mismatch. |

## Unresolved conflicts and loss

U1: F3's exact evidence path versus probabilistic equality; no rule priority or relaxation chosen.
U2: Lossless representation identity, ordering and wider SQL codecs. Current runtime's keyed maps/unique-ID restriction cannot be treated as a general bag representation. Transport sequence support is not endpoint support.
U3: Memory budget, retention, handle namespace, worker routing and admission limits are unspecified. F1/F2 must preserve nonblocking actions by abandoning optimization when needed.
U4: Operation closure for detached/external writes and a common SQL snapshot remain upstream authority questions; inter-response encoding does not solve them.
U5: Workload/latency break-even and baseline availability are unmeasured. No candidate is ranked.

D1: Six units hide the coupling between identity, retention and publication; X1–X3 retain this overlap explicitly.
D2: Abstract exact values hide codec behavior and accessors/aliasing; immutable transport capture is a new obligation, not existing proof.
D3: Fixed target reconstruction hides observation time and external writer progress. Preserve U4 instead of claiming continuous equality to a changing PostgreSQL database.
D4: Candidate protocols add structure not present in the source. Reconstruction of the current full-result path does not validate those extensions or establish independent range.

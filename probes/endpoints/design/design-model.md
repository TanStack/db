# Design grammar — Model, version 2

Exploratory extraction from one system: the current Endpoints prototype and the public DB contracts it already uses. Source facts and hashes are frozen in [local-source-notes.md](./local-source-notes.md). The prior-work survey and [Ground-condition probe](./ground-conditions.md) supply limits, not additional donor primitives. No implementation or ranking is produced.

## Preservation contract

| ID | Property | Authority and status |
| --- | --- | --- |
| P1 | A declared endpoint query is a bare ordinary writable collection; no extra public source handle | User-required and current public API. |
| P2 | Calling a mutation applies local optimism synchronously and returns the actual Transaction | User-required and current runtime. |
| P3 | Server execution remains authoritative; optimistic values are guesses until reconciled | Current source contract; exact retirement protocol may vary. |
| P4 | Client/scope identity boundaries must survive sharing | Current runtime and user multi-client context; fixture scope is not production auth. |
| P5 | Query evaluation and order stay in DB semantics, rather than ad hoc UI filtering | User-required; current compiler supports a narrow order grammar. |
| P6 | No implicit mutation queue or accidental choice of same-row server order | User-required; current sequential oracle does not prove concurrent behavior. |
| P7 | Server handler code and secrets stay server-side | User-required, compiler constraint, existing canary tests. |
| P8 | Partial response absence must not silently become shared-source deletion | Source-stated Query Collection distinction; provisional general preservation property. |
| P9 | A read failure may surface an error; unavailable synchronization must not be reported as confirmed | Latest user correction; retained-row and group-publication policies remain open. |
| P11 | Distinguish potential dependencies, instantiated collections, live demand and pending-operation lifetime | Latest user-selected activity question; policy beyond actual subscriber count remains open. |
| P10 | Small updates versus refetch can vary by query and mutation | Latest user-selected extraction target; target capability, not implemented behavior. |

This list is provisional where labeled. The user requested exploration, not exact equivalence; no claim is made that every consequential property has been preserved. The current cross-collection defect must be reconstructed as a source fact, not preserved as a desirable invariant.

## Minimal surviving units

| ID | Unit | Fields/roles required for this extraction | Source basis |
| --- | --- | --- | --- |
| M1 | Query contract Q | Result identity, client/scope, read function, selected row shape and ordering; what part of its semantics is actually available locally | Local L1/L2: query RPC, key, comparator. General predicates and coverage evidence are absent today, not inferred from payloads. |
| M2 | Held state H | Rows/results owned by a collection, distinguished authoritative and tentative state, and the domain for which a snapshot is complete | L1/L5/L6: collection state, eager replacement, mutation lifecycle. Shared ownership is a possible change, not current fact. |
| M3 | Local transaction T | Originating collection operations, identity/provenance, pending effects and acceptance/failure state | L1/L6: core transaction capture and rollback. Replaying arbitrary callbacks is not assumed. |
| M4 | Authoritative observation O | A write outcome or a query observation, its covered domain and supplied values; a usable version/baseline if the protocol needs one | L1: RPC then refetch. Explicit revision tokens and result deltas are proposed protocol data, not current fields. |

Identity, field availability, and coverage are attributes of these units. A separate identity registry or capability object is not an additional primitive; it would be one representation of those attributes.

### M5 — Demand/lifetime claim (added after the user clarified activity)

This unit distinguishes a query instance having a current consumer from merely existing in cache. Actual subscriber count and transitions are sourced by L8. Transitive query demand, preload policy and transaction pins are separate possible claim kinds; their inclusion in a synchronization policy remains explicit and unresolved. Removing this unit loses the user's activity question, even when rows and query semantics stay unchanged. It is not a model of the UI component tree.

## Directed relations and active overlaps

- **E1 — Read derivation:** Q reads H and produces ordered visible results. Today an endpoint's server query supplies its collection rows, its comparator orders them, and local DB consumers derive from that collection. Moving derivation locally requires safe query semantics and adequate inputs.
- **E2 — Transaction ownership:** T attaches tentative effects to addressed H. Today these are only directly mutated collections. A fanout design changes the set of ownership edges; a shared-state design changes which H those edges reach.
- **E3 — Reconciliation:** O revises covered authoritative H, then permits matching T effects to retire or reports failure. A write acknowledgement and a query observation are distinct observation kinds.

- **E4 — Demand/lifetime:** M5 addresses an instantiated Q/H. An activation change can change eligible recipients without changing the query definition or row data. Pending T lifetime can require retaining H even when consumer demand ends; whether that also requires eager reconciliation is a policy question.

**A1 — Same row, several query contracts:** The intersection matters because one change should influence each supported result. Same string IDs alone do not establish this intersection across scopes or sources.

**A2 — Same row, partial fields:** Two projections may overlap in identity but make different claims about fields. Missing fields cannot be silently interpreted as null or authoritative deletion. Writable inverse semantics outside full-row identity mapping remain unresolved.

**A3 — Same row, several pending transactions:** Overlap is not owned by just the newest server response. Removing one T must not accidentally retire another. Precise same-row conflict policy is not supplied by this extraction.

**A4 — Same held row, several server observations:** Two query snapshots may cover overlapping rows but different domains. One empty result does not establish absence from the other's domain.

**A5 — Several consumers and transaction lifetime:** One held state may serve several direct/indirect consumers while also participating in a pending transaction. Last-consumer departure is not evidence that all outstanding ownership is gone.

The topology therefore contains shared dependencies; a tree of endpoint-owned copies cannot represent all intended overlap merely by naming equal IDs. This is an inferred modeling relation, not a statement that the current storage must be replaced.

## Operative rules

| ID | Rule | Status |
| --- | --- | --- |
| R1 | Share an address only within a compatible client/scope and proven source/query identity domain | Scope is sourced; provenance checks for generalized sharing are a proposed condition. |
| R2 | Invoke T synchronously, publish its supported tentative effects by the action boundary, and keep the synchronous Transaction API | Sourced/user-required. Subscription-level atomicity beyond that boundary is not established. |
| R3 | Effects propagate only along defined E1/E2 relations | Reconstructs current direct targeting. New relations require explicit metadata or policy; equal row IDs do not create them. |
| R4 | Retire tentative effects using the matching observation contract; write success and synchronized reads are distinct | Current ordering is sourced; generalized matching/version policy is unresolved. |
| R5 | Treat a snapshot as complete only for its stated domain; a patch must have explicit update/deletion meaning | Eager replacement contract sourced; generalized patch format is a proposed interface requirement. |
| R6 | A local result update is exact only when query semantics, operation effects, baseline, and required data determine it | Analyst-inferred condition, exposed by the constructed coverage comparison. Not a implemented classifier. |
| R7 | A write through a view needs an unambiguous source-effect interpretation or an explicit policy | Current full-row identity case sourced; projections/joins are outside the reconstructed grammar. |
| R8 | Do not introduce a hidden mutation order or execute unavailable server semantics in the client to fill a gap | User constraints; reconciliation may still need ordering evidence, distinct from a queue. |
| R9 | When information or delivery is unavailable, retain an explicit unresolved/refetch/error outcome rather than claiming exactness | User correction and analyst distinction; error-display/retained-row policy not chosen. |

**Unresolved priorities U1–U6:** overlapping pending writes versus stale server snapshots; atomic publication when some query updates need refetch; retained rows after sync failure; inverse semantics for writable derived rows; how complete mutation footprints are obtained; activation/preload/pending-transaction lifetime and ready-state policy. No rule chooses an answer silently.

## Adjacent storage/propagation forms

These are generated samples, not observed working implementations. Each preserves the public API conditionally on the stated internal work. They change distinct ownership relations, not merely field names.

### F1 — Coalesce proven-equivalent query declarations

- **Route:** Substitute the existing declaration-based cache address with a checked query-contract address for a restricted family. Source-supported variation point: L1 runtime collection lookup and L2 compiler-generated identity/metadata.
- **Change:** Identical read shape, arguments, scope, representation, and relevant behavior can refer to one H. Reuse must not be inferred from equal current results alone.
- **Preserve:** P1–P7; the existing full-refetch path and transaction capture can remain. E2 reaches shared state because the query contracts are equivalent.
- **New structure:** A trustworthy canonical descriptor and rules for which callbacks/options may share it. Arbitrary SQL equivalence is not claimed.
- **Distinct boundary:** Can address the actual two-identical-query receipt; does not handle two genuinely different filters or projections.
- **Loss/cost:** Independent declaration lifecycle/options can conflict. Coalescing does not supply general overlap propagation. P10 remains a separate delivery variation.

### F2 — Keep query-owned state; coordinate effects in one transaction

- **Route:** Augment E2 using the existing ability to capture multiple collection writes in a core transaction. Source basis: L1 and L6. This is a semantic composition; no hidden integration hook is claimed to exist.
- **Change:** Discover all supported affected Qs, derive each result's edit, and attach those edits to the same T before the action boundary. H remains query-owned.
- **Preserve:** P1/P2, per-query scope and representation, DB query semantics, and no implicit mutation queue. Rollback ownership must span all resulting edits.
- **New structure:** Checked lineage/membership information, a result-delta evaluator, reentrancy/duplicate-effect control, and grouped reconciliation. Transaction capture alone does not supply discovery or prove publication atomicity.
- **Distinct boundary:** Handles different supported query contracts without merging their snapshot ownership.
- **Loss/cost:** Stores overlapping copies and repeats some evaluation. Coupled rollback/settlement work grows with affected collections. Unknown query effects take an explicit fallback path; they are not guessed.

### F3 — Share row ownership; evaluate endpoint query overlays

- **Route:** Factor compatible H by source identity and use E1 to derive multiple endpoint results. Source basis: keyed rows and DB query derivation already used by this system; the factorization itself is an inferred transformation.
- **Change:** T affects shared row state once. Each ordinary endpoint collection exposes its query overlay and remains writable where source identity is preserved.
- **Preserve:** P1/P2/P4–P7 conditionally; callers still use listTodos.insert/update/delete. No extra public source handle or wrapper API is introduced by this reading.
- **New structure:** Shared internal ownership, per-query completeness/field claims, response merge and retention rules, and a verified write mapping through overlays. These contracts are not implemented in the current runtime.
- **Distinct boundary:** One tentative row effect can feed several supported membership/order computations through E1.
- **Loss/cost:** Complete query responses cannot independently replace the shared relation. Partial projections, retention, and cleanup now couple endpoint lifetimes. Arbitrary writable joins/projections are not admitted.

## Orthogonal authoritative-response variations

A storage form does not by itself choose the delivery mechanism. These are conditional changes to O/E3. Capability labels below are analytical categories, **not a proposed public API or a implemented wire format**.

| ID | Response route | Information needed | What it can save / what remains |
| --- | --- | --- | --- |
| D0 | Full client refetch | Query identity/arguments/scope and functioning read path | Current baseline. Additional request and full result remain. |
| D1 | Mutation row effects, locally evaluated | Authoritative changed values/deleted keys, sufficiently complete footprint, usable baseline, supported query semantics and adequate local data | Can avoid query re-execution and transfer few rows. Both savings are conditional; raw row changes are not a universal result delta. |
| D2 | Query-specific result delta | Server can determine before/after result differences and client can apply them against the intended baseline | Can save bytes even if server reruns the full query. Needs active-query identity/arguments or another explicit result-target contract. |
| D3 | Complete query result in mutation response | Server evaluates the targeted query under a defined observation contract | Can avoid a later client round trip while still transferring a full result. Must not be called a small delta. |

A proof of no effect is another possible outcome. Unknown dependency or footprint does not count as that proof. Different active queries may choose different routes for the same mutation, but U2 (coherent publication of mixed routes) remains unresolved.

## Query–mutation sufficiency examples

All rows below are **constructed analytical cases**, not tested capability claims. Assume correct scoped identity, a consistent known baseline, total ordering where needed, and that the stated mutation effects are complete. Removing an assumption reopens the answer.

| Case | Small information that can suffice | Missing information / fallback condition |
| --- | --- | --- |
| Unbounded row-preserving filter; insert or update | Authoritative after-image with all membership/output/order fields; old identity when it changes | Opaque filter or omitted required fields needs server membership/result information or refetch. |
| Same query; delete | Authoritative deleted key under the known query scope | Unknown additional effects or ambiguous identity prevents this deduction. |
| Complete current top-k result; one insert | New authoritative row and known filter/total order; evaluate current k rows plus the new row, retain k | Does not cover other changes or a baseline that was already incomplete. |
| Same top-k result; remove a member or move it below the boundary | Departure plus enough replacement candidates or a server-computed result update | Deleted ID alone cannot identify unseen replacements. D2/D3/D0 can obtain the missing information. |
| Simple COUNT over a known predicate; confirmed one-row insertion/deletion | The exact contribution change, matching a known aggregate baseline | Duplicate effects, unknown membership, grouped/distinct logic, or stale baselines need more information. |
| Join, grouped/distinct aggregate, or writable projection | A proved delta rule with its support state, or exact server result changes | Changed base rows alone need not determine multiplicity, membership, or inverse write semantics. Affected output may itself be large. |
| Server-only query logic | Server-supplied query result change or complete result | Sharing row storage cannot make unavailable query semantics known locally. |

This is a source-traced language for conditional variations. It neither ranks these forms nor claims the finite table exhausts the design space.

## Separate impact selection from payload selection

The user's clarification makes four jobs explicit. None may use the result of another as an unquestioned substitute.

| Job | Input authority | Required output | Known failure if conflated |
| --- | --- | --- | --- |
| I1: optimistic recipients | Captured local intent T plus supported query dependencies | All active Qs whose optimistic result can change | Updating only the collection named in onMutate misses overlapping queries. |
| I2: optimistic edits | I1 plus local query semantics, baseline and coverage | The correct tentative result changes for each recipient | Broadcasting the same row to every list ignores membership, projection and limits. |
| I3: authoritative recipients | Actual server effects or authoritative dependency/result evidence | All active Qs requiring reconciliation; unknown cases retained conservatively | The actual server footprint can differ from the optimistic guess. |
| I4: authoritative payload | I3 plus server/client knowledge and delivery contract | D1, D2, D3, or D0 independently for each Q | Knowing a query was affected does not establish that a row patch is sufficient. |

**I5 — Independent oracle observations:** The reference continues to evaluate every active query, including queries the candidate labels unaffected. This avoids a false-green test that trusts the same dependency selection it is meant to test. Extra recipient updates can be a work-cost regression without being a row-correctness failure.

A conservative affected-set superset is different from a proved minimal affected set. Finding the smallest set may cost more than refreshing some extra queries. Likewise, a sufficient compact response is not necessarily the globally smallest encoding or the fastest strategy. Those are measurable questions, not automatic consequences of the grammar.

No server-side active-query registry exists in the current protocol. D2/D3 or server-side I3 need validated query identity/arguments/scope, an equivalent subscription contract, or another explicit means to address client results. Accepting arbitrary client-supplied SQL is not introduced by these forms.

## Activity and dependency selection

The user's proposed `potentially affected ∩ active` is a candidate set relation, not a selected implementation order.

- **I6 — Definition versus instance:** A declaration can have many argument/scope instances. Potential dependency metadata is not a list of all instantiated collections. Server callbacks do not currently receive a complete validated active-instance description.
- **I7 — Observed demand:** A per-DbClient endpoint registry could retain each bound instance's descriptor and handle, initialize its subscriber count, and listen for subscribers:change. These are real public DB signals (L8); the registry and cleanup policy are proposed. Collection status, cached existence, and subscription count must not be conflated.
- **I8 — Equivalent traversal choices:** Start from changed relations and find dependent active instances, or index only active instances by their dependencies and test those candidates. Correct filtering is the intersection in either case. Which traversal does less work depends on active fraction and dependency fanout; no ordering is chosen here. Unknown dependencies remain conservative candidates.
- **I9 — Lifetime exceptions:** Preloading, indirect dependencies, imperative consumers, and pending transaction references need an explicit policy. A zero-subscriber collection can be retained without being a visible consumer. Retention does not automatically require a fresh network query.
- **I10 — Activity during a mutation:** A collection becoming active while T is pending must account for relevant tentative effects before announcing ready state. A collection becoming inactive must not orphan rollback/settlement ownership. Reusing only an invocation-time active-set snapshot is insufficient as a general rule. Exact activation and readiness semantics remain U6.

Proposed oracle dimensions: activate/deactivate before invocation, during a held write, after server acceptance but before reconciliation, and after an error; reactivate a retained collection; vary arguments/scope; add an indirect consumer. Reference observations and activity events must be specified independently of the candidate registry. The current generated runner does not perform those transitions.

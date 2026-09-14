# Ground Condition: what Endpoints can know without changing PostgreSQL

Instrument: Ground Condition. User authorization: “Ok great go”, accepting the proposed applicability and boundary pass. Inputs: the [relational algebra survey](../RELATIONAL-ALGEBRA-SURVEY.md), current prototype code, and existing experiment reports. This reading establishes conditional ranges; it does not choose an optimizer or change the runtime.

## Frozen claim and ordinary baseline

Claim under examination: established relational and representation techniques can reduce reconciliation work or wire data when Endpoints possesses their required information, with full authoritative refresh when it does not.

Ordinary baseline: one caller, one closed mutation, one or two retained keyed collections, deterministic supported queries, no intervening writes, compatible query definitions and authorization, successful post-mutation reads, and unchanged collection lifetimes. The current baseline is to evaluate retained queries, encode their results, validate the response, and install authority before retiring optimism.

This baseline deliberately isolates information requirements. It does not assert that independent writers, errors, overlapping operations or query lifetime changes are rare or unsupported by the product contract.

## Dynamics, constraints and boundaries

| Kind | What is held or varied | Who controls it |
| --- | --- | --- |
| Dynamics | Authored optimistic changes → server execution → authoritative reads → response → coordinated publication/overlay retirement. | Endpoint runtime, server handler and database. |
| Constraint | No framework-installed database triggers, counters, functions, extensions, migrations or replication setup. | User's deployment requirement. Disposable witness tables are not deployment changes. |
| Constraint | Retention, not subscriber count, determines collection participation. No implicit mutation queue. | Existing user contract and client runtime. |
| Constraint | Unknown analysis must not silently omit a needed refresh or falsely confirm optimism. | Compiler, server admission and client validation. |
| Boundary | Exact baseline contents, query/parameter/scope identity, codec, lifetime and response ordering. | Browser and application server; authorization needs a trusted request context. |
| Boundary | Complete input changes, hidden effects, old values, joins' missing inputs and snapshot visibility. | Database/application behavior; cannot be inferred from mutation syntax alone. |
| Boundary | Delta size, result overlap, memory, compression and network costs. | Workload and deployment, not the algebra. |

The three separate questions remain: **which collections might change; how to calculate their new result; whether a result is safe to install.** Passing one does not pass the others.

## What the present implementation supplies

These are static code observations unless a test is named.

- [Client runtime](../integrated-todo/src/runtime.ts:331): enumerates non-cleaned-up collections, including unsubscribed collections. It holds confirmed rows separately from transactions. It uses operation epochs/topology and fresh-read repair when a response cannot take the isolated-operation path. Confirmed data is held as keyed maps, not as a preserved arbitrary wire representation.
- [Optimistic propagation](../integrated-todo/src/runtime.ts:352): propagates authored rows between modeled collections for the same relation using supported membership predicates. [Query model](../integrated-todo/src/coherence.ts:10) is bounded to a relation, projection, ordering and scalar membership. This is not a general client relational maintenance engine.
- [Server refresh](../integrated-todo/src/refresh.server.ts:24): captures handler success/error, then reads requested queries with read retries. Reads use `Promise.all`; this function does not establish one SQL snapshot across them. A callback returning is not proof that arbitrary detached work has stopped.
- [Registry](../integrated-todo/src/registry.server.ts:48): validates definition/version/parameters before the handler and prepares registered reads. Its optional baseline cache holds `{query, key, revision}`, not old result rows. [Compiler registration](../integrated-todo/bound-transform.mjs:412) currently supplies no revision reader. Generic revision-hook code is not an available PostgreSQL revision proof.
- [Response encoder](../integrated-todo/src/snapshot-encoding.server.ts:48): shares equal complete rows across results in a single response. It preserves per-result occurrence indexes and uses full encoding when unsuitable. It does not diff across responses. All four existing encoder tests passed in this pass.
- [Earlier combined-read experiment](../SQL-COVERAGE-RESULTS.md:171): tested a read-only combined SQL envelope in disposable fixtures. It remains an experiment with explicit decoding/concurrency limits; the current generic refresh helper does not adopt it.

An exact inter-response diff therefore has some useful prerequisites already present, but no current server result cache or acknowledged base/target protocol was found in the inspected path. That is a scope-specific observation, not a whole-repository absence proof.

## Applicability table

Research references below name claims and source IDs in the survey. “Available conditionally” means the information can exist without installing database infrastructure; it does not mean implemented or cheap.

| Technique | Required information and location | Ground condition in Endpoints | Boundary / safe fallback |
| --- | --- | --- | --- |
| Pool equal rows within one response | Complete fresh outputs at application server; complete typed equality; occurrence/order reconstruction at client. | Present for the supported transport domain. No previous client result needed. | Unsupported value or unprofitable encoding → full result representation. Equality of IDs alone is insufficient. Existing encoder tests. |
| Diff complete new result against old client result | Fresh output plus exact identified old representation at server or a sound reconciliation protocol; matching base at client. | Available conditionally. Browser confirmed rows exist; server does not currently retain them. Baseline storage/transfer and lifecycle are unresolved. | Missing or mismatched base → full result. Obsolete target → existing authority repair. B1/B7; C15–C16, S23–S24. |
| Skip a collection read | Complete relevance analysis **and** proof that retained client data needs no repair over the whole baseline interval. | Not established by the current compiler. This mutation's unrelated writes do not prove earlier freshness. | Read the collection. B1; C18. |
| Fixed filter/projection input deltas | Complete relevant old/new rows, same scalar semantics, valid base; in client for optimism or server for authority. | Supported subset for authored guesses. Server evidence cannot be equated with authored intent. | Missing old contribution, unknown effects or baseline gap → authoritative read. B1/B3; C2, C10. |
| Distinct, counted aggregates | Support counts / sufficient statistics and complete delta, at maintainer. | A displayed distinct value or aggregate alone may omit required state. | Maintain extra state only under a proved contract, or read affected/full result. B2/B3; C3/C5. |
| Join/semi/anti/outer maintenance | Partner rows or suitable indexed reads, match support, all changed inputs, correct snapshots. | SQL server can query partners; filtered client outputs need not contain them. Current endpoint compiler does not establish general join maintenance. | Read missing support or full result; no fabricated optimistic rows from unseen inputs. B4; C2–C4, S5. |
| Recompute groups/window partitions | Complete set of affected **old and new** keys across all effects since the base, and complete current region members. | Possible with ordinary SQL when affected-key evidence is complete; not automatic from a new-row `RETURNING` result. | Broaden the affected region or full query. B6; C9, S10. |
| Top-k or limited-result maintenance | Ordered candidate state beyond current output or a refill read, with exact tie/NULL semantics. | Server can read candidates; full logical endpoint scope does not imply that every underlying table row is in a query result. Subset loading remains deferred. | Refill/recompute. B5; C4, S6/S13. |
| Shared SQL reads | Equivalent read-only queries, request context, typed reconstruction and declared snapshot semantics. | Can use ordinary SQL without database changes; generic helper currently executes separate reads. | Separate reads retain existing behavior but do **not** satisfy a newly required common-snapshot guarantee. Snapshot support needs its own boundary; full refresh alone is not that proof. B8/B9; C11–C12/C17. |
| Auxiliary/factored/recursive maintenance | Complete change input and retained intermediate state under the modeled semantics. | Application memory is possible in principle; no complete general input stream was established. | Query evaluation remains available; source algorithms do not supply missing observations. C6–C8, S7–S9. |

## Controlled boundary readings

[Replay script](optimization-ground-condition.mjs) and [raw evidence](optimization-ground-condition-evidence.json). Nine named cases passed on installed PGlite/PostgreSQL **17.5**. Eight cases execute SQL; B7 executes a deliberately small finite-map model, also consuming B1's SQL outputs. These are instrument witnesses, not a production patch implementation or an Endpoints end-to-end oracle campaign.

### B1 — A mutation's delta versus the whole baseline interval

Ordinary case: client holds `a=0,b=0`; only the endpoint changes `a` to `1`. Its returned `a=1` repairs that baseline.

Boundary: add one earlier committed write setting `b=9`, while keeping the endpoint operation unchanged. Applying only the endpoint's returned row leaves `b=0`; PostgreSQL returns `b=9`.

**Reading:** complete evidence about this invocation is not complete evidence since the client's baseline. This changes the required information, not merely the optimization's cost. Source: C18 and executed B1. The witness controls write ordering explicitly; it does not simulate a separate network writer.

### B2–B5 — Indistinguishable observations, different required results

Each executed pair has an equal old displayed result and equal supplied mutation rows, but different correct new SQL results. Only the omitted underlying state changes between worlds.

| Case | Same visible inputs | Hidden condition varied | Required result |
| --- | --- | --- | --- |
| B2 distinct | Old category set `{x}`; delete returns `x`. | One supporting row versus two. | Empty versus `{x}`. |
| B3 sum | Old sum `10`; update returns `a=8`. | Old values `a=3,b=7` versus `a=5,b=5`. | `15` versus `13`. |
| B4 inner join | Empty joined result; parent becomes enabled. | A matching hidden child exists versus none. | Child `a` versus empty. |
| B5 top-1 | Old top row `a`; delete returns `a`. | Next candidate is `b` versus `c`. | `b` versus `c`. |

**Reading:** no deterministic computation from just those equal observations can produce both unequal answers. Additional source state or a read is necessary. This is a narrow information argument, not a claim that these operators are unmaintainable. Ordinary controls are the same operations with the omitted counts/old values/partners/candidates available. Research basis: C3–C4; these examples do not duplicate or verify entire research algorithms.

### B6 — Replacing an affected region needs both sides of a move

Ordinary control: editing a value without changing its category permits recomputation of that known category, given complete relevant effects.

Boundary: move the sole row from category A to B. Recomputing B alone adds B but leaves obsolete group A. SQL's complete new result contains only B.

**Reading:** the affected region is the union of old and new regions, including regions that become empty. The witness does not prove that all effects are observable, nor that a small region exists for every composed query. An external change since the baseline can enlarge it again. Source: C9 and executed B6.

### B7 — Exact old base and current target are separate conditions

Ordinary case: `diff([{a:0}], [{a:1}])` reconstructs `[{a:1}]` when applied to the stated base. Apply that same patch to a base containing an extra `b`, and `b` survives incorrectly. That changes only the receiver's baseline.

Separate boundary: keep the correct old base but let a newer authoritative state be `a=2`. Reconstructing `a=1` remains an exact patch calculation but is not a valid replacement for the newer result.

Positive control: diff B1's complete fresh SQL result against B1's old baseline. It recovers **both** `a=1` and the unobserved `b=9` change.

**Reading:** an old result may be stale relative to PostgreSQL and still be a valid diff base. The proof needs exact correspondence with the receiver, not a claim that the old result is current. Target eligibility remains a separate client authority check. Optimistic visible rows must not silently substitute for the stated confirmed base. B7 uses only unique keys and simple integer values; it proves nothing about general serialization, ordering or SQL bags. Sources: C15–C16, executed finite-map model.

### B8–B9 — Refresh and shared authority are not synonyms

B8 ordinary control: two reads without an intervening write see `(0,0)`. Boundary: atomically set both values to `1` between the reads. Assembling the first old value and second new value produces `(0,1)`, which was never the committed pair. The script executes this schedule serially in one engine to isolate statement visibility, not to claim an observed multiconnection race in the runtime.

B9 ordinary control: a read in the statement after an update returns `1`. Boundary: place the update in a data-modifying CTE and read the base table in its parent statement. The parent reads `0`; a later statement reads `1`.

**Reading:** fresh per-query observations and a common database snapshot are distinct guarantees. Merely putting write and read syntax together does not create a post-write shared snapshot. Current client epochs protect against tracked local overlap; they cannot by themselves observe an unrelated database commit. Sources: C11–C12 and executed SQL witnesses.

## Cost sensitivity without a performance claim

The cases above alter the causal path or invalidate an information premise. Other variations change degree: low result overlap reduces row-pooling savings; large affected regions approach full recomputation; short baseline retention creates more cache misses. Those are workload conditions, not correctness failures if the fallback remains sound.

A baseline token alone is not the old result. Storing old results costs memory and lifecycle work; sending them back costs request bytes; neither cost was measured here. Count both database→server and server→client legs. Existing same-response sharing and future inter-response differences also have different opportunities when there is only one retained collection.

No claim that more server computation is faster or slower follows from these witnesses. The user requirement remains fewer bytes and lower real-network latency, checked on identical histories with correctness enforced.

## Supported range and remainder

The narrow positive result is that complete fresh outputs permit representation optimizations without complete mutation-effect capture. Same-response pooling already has an implementation; exact-base differencing is supported by the finite model under its explicit representation and publication conditions. Input-delta maintenance and affected-region refresh need additional coverage over the relevant baseline interval.

The next missing fact for the proposed inter-response candidate is concrete: **what exact confirmed representation can both endpoints identify and retain through initial load, success, lost response, overlapping mutation, garbage collection, scope change and server restart?** The inspected token cache does not answer it. This is the stop boundary of this probe, not a selected cache/protocol design.

The original requirements remain: writable bare collections, coherent guessed overlays, authoritative settlement, all retained instances included, no database installation, no write queue, explicit recovery/errors, and measurable gains. The findings neither weaken those requirements nor make every possible SQL form an optimization prerequisite.

**Artifact risk:** tiny deterministic fixtures isolate information loss but omit the complexity of composed queries, actual transport and multi-client scheduling. Static source inspection can reveal an absent local guard but cannot establish production behavior. Prior research support is inherited through the survey rather than newly reviewed here.

**Unmeasured:** generated Endpoints histories for these new boundaries; full scalar/codec equivalence; auth/RLS changes; real external effects and transaction closure; cross-connection snapshot tests; memory, compression and latency. These require separate work; this pass does not present them as completed.

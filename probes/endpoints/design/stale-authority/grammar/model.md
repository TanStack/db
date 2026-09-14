# Candidate grammar: authority admission and retirement

Version 1. Exploratory, not implemented. Source IDs refer to [the frozen proposal](../source.md); P IDs to [preservation](./preservation.md). Inferred rules are candidate obligations, not observed capabilities.

## Candidate units

| ID | Unit and work it does | Source and status |
| --- | --- | --- |
| C | Retained query instance: semantic identity, auth/client scope, lifetime generation, load state, confirmed baseline and coherence status | S1 instance generation; S3 recipient rule; S4 current registry. Generation/health fields inferred extensions. |
| M | Mutation execution record: operation identity, potential impact, handler outcome (`unknown`, `success`, `error`) and remaining reconciliation obligations | S1 outcome recording; S4 handler envelope. Separate from transaction receipt; inferred explicit representation. |
| O | Existing DB Transaction and its validated optimistic whole-row snapshots; linked to its M | S3/S4 existing API. These are owned snapshots, not a replayable edit program. |
| R | Read attempt and returned evidence: cause, captured client epoch, target C/lifetime set, effects it was issued after, result validity and outcome | S1 fresh read and stale-read check; S4 authority response. Explicit evidence fields inferred. |
| F | Client knowledge/fence state: epoch, unresolved handler records, completed records awaiting coverage, dirty-instance obligations and active reads | S1 generation/overlap fallback. Bookkeeping inferred; not a server clock. |

A “cohort” is a derived set of M records relevant to one R, not another primitive. Time elapsed, number of requests and bytes are measurements, not protocol units. A retry is a transition producing another attempt under R, not a new authority source.

## Active overlaps and dependencies

- **L1 M ↔ O:** execution and optimism are linked but have separate completion. Handler completion can precede safe overlay retirement. An error can coexist with committed effects. Conflating them makes reconciliation depend on its own receipt.
- **L2 M × C:** potential impact creates a reconciliation obligation. Unknown impact intersects every retained C in scope; an optimistic write recipient set cannot define this intersection. A newly retained C can join the obligation after M started.
- **L3 R × M × C × F:** an observation may cover effects for a particular collection lifetime under particular admission conditions. Coverage is neither merely “this request finished” nor “this mutation was acknowledged.” One R can cover several M records and C instances; several reads can be needed for one M.
- **L4 O × C × row key:** overlays from different transactions share result rows. Whole-row snapshot ownership and creation order remain existing DB laws, not facts derived from server commit order.
- **L5 C lifetime × R:** a semantic query recreated after GC is a different target instance. Removing one C does not by itself erase an M still relevant to another C.
- **L6 F × publication:** checking a fence, installing values, notifying observers and settling receipts form a coupled boundary. S1 gives their intended order, not an integration mechanism proving atomicity.

This overlap is not a tree. In particular, M does not own C, and R does not own the overlays it can justify retiring. None of the five units is claimed to be an independently replaceable software module: L3 and L6 lack established integration tests for concurrency.

## Boundary conditions

B1: One client/auth scope, with ordinary request delivery allowed to reorder. Read and handler executions may overlap. M may contain several committed statements before returning an error.

B2: A received, valid handler envelope reports that the handler finished. Interpreting this as closure of its writes requires all relevant effects to finish within the handler's execution lifetime. Detached jobs, asynchronous triggers outside that lifetime and other writers need a separate observation contract. The proposal does not supply one.

B3: A requested authoritative read observes the server's completed writes in the same authority domain. Replica routing and stale caches would need explicit guarantees; this grammar does not establish them.

B4: The currently supported query semantics are the bounded Todo slice. Multi-table dependency analysis and exact optimism for a newly loading collection remain unimplemented; unknown impact is conservative.

B5: The global quiet-read form has a conditional progress premise: relevant handlers finish, usable read responses eventually arrive, and some read interval is free of a new relevant mutation. The user did not supply a maximum wait or a starvation policy. No unconditional liveness claim follows.

## Dynamics

| ID | Candidate rule | Trace and status |
| --- | --- | --- |
| R1 | On action invocation, create M and O, capture guesses synchronously, advance F's epoch, mark potential C obligations and dispatch the handler immediately. A new invocation invalidates older uncertain observations. | S1/S3; explicit representation inferred |
| R2 | Receipt of a valid handler outcome moves M out of “handler unknown,” retaining its C obligations and O while coverage is missing. A rejected transport promise alone is not a handler outcome. | S1/S4; last sentence is an explicit inferred safety obligation |
| R3 | Inline results may be admitted for an isolated M only if their own handler completed, no overlapping relevant execution makes the observation uncertain, and target identity/lifetime and epoch still match. | S1; exact isolated/overlap tracking inferred |
| R4 | After overlap, wait for the relevant unknown-handler set to become empty; issue a fresh full read covering completed effects and every potentially affected retained C. Wait on handler knowledge, not O.isPersisted. | S1; knowledge/receipt split inferred from S4 |
| R5 | C creation/recreation adds the new lifetime to catch-up obligations; GC removes only that lifetime as a target. An attempt cannot claim it returned data for a C that did not exist in its captured target set. | S1/S3; inferred obligation, not a chosen scheduling policy |
| R6 | Admit a returned R only against matching semantic scope/lifetimes, unchanged relevant epoch, sufficient observation coverage and valid complete results. Invalidated observations cannot write the baseline; remaining obligations stay dirty. | S1 plus S4 validation; admission integration unresolved |
| R7 | Install accepted authority before retiring the specifically covered O records. Each M retains its own success/error outcome. Other O records retain whole snapshots and ownership. | S1/S3; supported ordering, not proven atomic publication |
| R8 | Ordinary/initial/refetch results pass the same authority-admission boundary as mutation results. Unready/new C must not be silently declared coherent or exempted because it lacks subscribers. | S1/S3; new-load optimism remains U4 |
| R9 | Failed reads retry under the existing bounded read policy; exhaustion records coherence error. An unusable response never manufactures a known handler outcome. Failed handler and failed reconciliation remain separate. | S1/S4; unknown-outcome recovery unresolved |

## Constraints

I1: F's epoch proves only which local events happened around an attempt. It is not a database commit sequence, database snapshot or permission revision. [P4/P9/P11]

I2: No lower-evidence observation may replace a baseline merely because it arrives later. Read initiation, server observation, client admission and publication are different orders. [P4/P5]

I3: “Covered” means the read was observed after the relevant finished effects for that C and lifetime under B2/B3; it is not equivalent to HTTP success or a syntactically valid snapshot. [P3/P5/P10]

I4: Dirty obligations survive a discarded response and collection-set changes until covered, genuinely removed by GC, or surfaced as unresolved/error. [P2/P9/P10]

I5: A persistence promise cannot be the completion predicate for the reconciliation required to resolve that promise. [L1; S4 commit path]

I6: Unknown effects forbid narrowing the authority recipient set to authored or propagated optimistic recipients. [P7]

I7: A nonempty, valid optimistic action is dispatched without waiting for other actions. Delayed authority/receipt completion is not serialized handler execution, but can still produce a user-visible delay. [P1/P11]

I8: No field merge or guessed replay may be silently introduced to “fix” overlapping snapshots. Existing core behavior for pending versus persisting conflicts must be respected. [P6]

## Unresolved conflicts and missing proof

U1 **Closure and unknown outcomes.** Transport failure, a hanging request and lost acknowledgement are not covered by a complete operation-status/recovery mechanism. B2 is an assumption to establish at an adapter boundary, not code currently enforcing it.

U2 **Progress versus discard.** Waiting for an entirely quiet interval can starve completed mutations' reconciliation under continued traffic. Relaxing the gate needs different coverage/order evidence. No priority is selected.

U3 **Publication and retirement.** The source does not specify a linearization point, atomic multi-collection notification or grouped retirement of same-row overlays. S4 exposes separate per-collection installs and per-transaction state changes. Success at the end of a batch does not prove every intermediate observation.

U4 **Creation/loading and supported optimism.** New C can lack the row support needed to mirror a pending O. Existing code forbids creation/loading during mutations. Removing that guard without a support/readiness rule would not implement P2/P6/P8. The grammar retains this gap.

U5 **Cohort boundaries and duplicates.** Precisely which M records an inline response can close after intervening reads, and handling duplicate response/application, still require an execution model. No “largest mutation ID wins” rule is admitted.

U6 **Admission adapter.** QueryCollection fetches currently record and sync results directly. A check only in mutation persistence would not cover ordinary reads. S1 requires shared admission; there is no verified adapter hook in this run.

U7 **Scope and external writers.** Auth changes, cross-client writes, replica lag and server-side work continuing after handler return need a stronger authority domain/closure contract. Current fixed scope and PGlite receipts do not supply it.

U8 **Error exit.** Handler error is known independently, but the proposal does not decide when the UI learns it, which overlays remain after exhausted reconciliation, or how an indeterminate write is reconciled without retrying it. These are separate from the already tested successful-read failure path.

## Adjacent forms, unranked

F0 — **Whole-client quiet read** (source reconstruction). Rule combination of R1–R9 under unknown impact: one epoch/unknown-handler set; all retained targets after overlap; isolated inline fast path. Coordination: all relevant work shares a read barrier. Loss: unrelated completed operations can await one slow/unknown execution; conditional B5 only. This is the single candidate sent to the hostile auditor.

F1 — **Proven independent impact domains** (conditional rule combination). Apply the same admission/retirement rules to domains whose potential read/write dependencies are proved disjoint. Changed variable: membership of L2/L3 and which actions advance an attempt's fence. Unknown or overlapping effects merge domains, falling back to F0. Preserves ownership, handler/outcome separation and full-result fallback. New structure: trusted potential-impact coverage and dynamic overlapping obligation groups. Loss: more classification and merge state; not implemented or measured. This is a distinct transformation only with actual disjointness evidence; today's opaque handlers all collapse to F0.

No third form is admitted. Server snapshot tokens remain a boundary proposal, not a usable substitution without a sourced ordering/visibility contract. Merely splitting counters or naming more fields adds no form.

## Decomposition loss

D1: Five records do not capture scheduling fairness, event-loop reentrancy or notification order by themselves. L6/U3 preserve that unresolved coupling.

D2: “Every retained C” combines data availability, semantic query identity, lifetime and support. A registry alone cannot confer exact optimism on incomplete results.

D3: Effects-closed and authoritative-read premises can hide external work and replication. They are explicit B2/B3 assumptions, not extrapolations from the sequential tests.

D4: The model's neat unknown/known/covered states formalize a short proposal. None is measured concurrency behavior until an independent oracle exercises the real adapter.

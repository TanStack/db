# Model: bounded analysis and update planning

Second exploratory Design Grammar, analysis version 1. All generated structures below are conditional forms, not implemented APIs. Source/evidence identifiers are defined in [Evidence](./evidence.md); the preservation contract is [P1–P12](./preservation.md).

## Candidate units

| ID | Unit | Role and source basis |
| --- | --- | --- |
| M1 | Query instance Q | Scoped declaration plus validated arguments, result identity/shape/order, and a server evaluator. Available dependency/semantic facts are annotations, not assumed complete. E1/E2 supply the narrow source; E5 supplies its limits. |
| M2 | Held state H | Authoritative result or supporting rows, tentative layers, and the domain/fields those values cover. A collection may own its result or derive it from compatible shared support. E1/E3/E4. |
| M3 | Mutation instance T | Invocation identity, local intent and ownership, any known prediction inputs, and server outcome/effect evidence. Predicted and actual writes are separate attributes. E1/E3/E4. |
| M4 | Observation O | Authoritative write/read information, recipient/result domain, and a usable delivery baseline. It can carry full results, row effects, result differences, or unresolved/error information. Result encoding and shared execution are choices attached to this path. E1/E5/E6. |
| M5 | Demand D | Which Q/H instances currently require results and which remain retained for pending work. Consumer identity, subscription state, and generation/lifetime are distinguishable; the exact policy is U3. E5/E7. |

These remain five candidate units. A planner, an optimization flag, a proof record, a shared SQL batch, and a row pool are not added as independent primitives. Evidence qualifies relations; planning selects legal transformations; batches and pools represent observation construction/delivery. Their separate removal does not require a sixth semantic unit (Process A6).

## Relations and active overlaps

| ID | Relation | Directed meaning |
| --- | --- | --- |
| L1 | Q → H | Query derivation and result ownership. Available inputs must support membership, output values, multiplicity, and order. |
| L2 | T → H | Tentative-effect ownership. Automatic propagation would add supported participants; it cannot rely only on equal unscoped IDs. |
| L3 | O → H,T | Apply authoritative information to its covered state and retire or preserve the appropriate pending effects. Read selection and settlement participation are distinct. |
| L4 | D → Q,H,T | Demand selects required instances and constrains retention and activation while mutations are pending. |
| L5 | Q,T,O → analysis evidence | Available query dependencies and predicted/actual effects support particular decisions, with scope, assumptions, and gaps. This is a qualification of decisions, not a promise that the evidence can always be computed. |

The following intersections have active functions; none can be assigned to one parent without losing a condition:

- **A1 — Several Qs share one row:** membership/order can differ even when projected values agree. Joint transport needs separate per-query result descriptions (E6).
- **A2 — Several Qs share only fields or supporting rows:** an unchanged join partner can supply a newly visible field. Shared identity does not imply shared complete coverage (E4).
- **A3 — Several Ts share H:** retiring one transaction must preserve other pending intent. Neither “latest response wins” nor serialization is supplied as the conflict rule (U2).
- **A4 — Several Os overlap H:** a complete result is complete for its query domain; an empty result cannot erase unrelated retained support (E3).
- **A5 — D and T both require H:** becoming unobserved need not end mutation ownership; late demand can change required visible results (U3).
- **A6 — Compatible Qs share evaluation/encoding work:** one join or row pool can serve several results, but their membership/order and demand remain separate. Computation overlap and response overlap are different intersections (E6).

These are semantic relations, not certified module boundaries. The local result-sharing experiment tests one bounded encode/decode interface. It does not certify modular replacement of the framework's storage, publication, or compiler analysis.

## Evidence-gated operations

**C1 — Evidence is operation-specific.** A conceptual analysis answer distinguishes established facts, explicit assumptions, unknown facts, and counterevidence, together with the query/mutation/scope and source/schema or observation conditions for which it applies. This is an inferred grammar requirement, not a proposed public type. Unknown and refuted both fail to authorize an operation, but preserve different reasons.

| ID | Candidate operation | Evidence it needs | Exit when that evidence is absent |
| --- | --- | --- | --- |
| C2 | Skip a server query | Sound evidence that actual effects cannot change this result under the relevant scope/observation; disjoint complete dependencies are one possible proof | Keep it in a conservative read candidate set. Local tentative effects may still need retirement. |
| C3 | Propagate optimism into another Q | Interpretable local intent, supported query semantics/write mapping, and sufficient local support for the declared tentative result | Do not claim exact automatic propagation there. U1 decides what unsupported cases expose; an eventual full result does not settle this. |
| C4 | Derive authoritative row/result changes without full evaluation | Complete enough actual effects, query semantics, support state and baseline to determine the result | Evaluate the full query. Complete changed-row images alone can still miss unchanged join partners. |
| C5 | Send a result delta after full evaluation | A usable client baseline plus an exact difference preserving query identity, multiplicity and order | Send the full result. Saving bytes does not imply avoiding query evaluation. |
| C6 | Share server query work | Compatible safe query plans with preserved per-query meaning and observation contracts | Independently evaluate those queries; return their full results together. |
| C7 | Share response rows | Compatible scoped output identity/values plus exact per-query membership, multiplicity and order reconstruction | Encode independent result arrays. C7 can be available even if C6 is unavailable. |

**C8 — Cost admission is separate.** Even a safe C2–C7 transformation can cost more than the alternative. The choice needs a cost policy; its thresholds and evidence are U5. The measured disjoint case demonstrates why compatibility alone does not imply profitability. “Candidate available” does not mean evaluating every candidate on every mutation: analysis, estimation, serialization, and decision overhead count too.

**C9 — Conservative execution is not unrestricted execution.** Failed optimization analysis does not by itself invalidate a safely executable query endpoint. But full-result fallback still needs a validated instance, server evaluator, permitted scope, and a usable observation/read-error contract. The current binder rejects failed extraction; separating these admission decisions is a new structure, not a current facility.

## Rules and priority limits

| ID | Rule | Basis |
| --- | --- | --- |
| R1 | Establish execution validity separately from each optimization's prerequisites; never promote a narrow syntax fact into a universal certificate | E2/E5, user P6; generalized split is inferred |
| R2 | Capture T synchronously and preserve ownership of every actual local tentative edit, including supported propagated edits | E1, P1/P3; automatic fanout not implemented |
| R3 | Distinguish prediction inputs, predicted writes, actual writes, and query reads. Unknown effects/dependencies cannot prove no effect | E4/P5/P6 |
| R4 | Construct authoritative read candidates conservatively from demanded instances and actual-effect evidence. Independently account for all tentative participants requiring settlement | E4/E5/P4; proposed general rule |
| R5 | For safely executable read candidates, default to full query evaluation and full results in the mutation response | User-selected P7; not the current RPC/refetch protocol |
| R6 | Substitute C2–C7 only with its own sufficient evidence; later results cannot retroactively certify earlier optimism | P3/P6, E3/E4/E5 |
| R7 | Preserve scoped keys, fields, result domains, multiplicity and order through sharing and reconstruction | P2/P8, E3/E6 |
| R8 | Separate semantic admissibility from cost admission, including analysis/decision overhead and the inline-full baseline | P12/E6; policy remains U5 |
| R9 | Apply/retire under an explicit observation and publication contract; preserve other pending effects; do not infer atomicity from one response or parallel reads | P3/P9, E5; implementation U2 |
| R10 | Activation/deactivation must preserve visible-state and ownership obligations; the invocation-time list alone does not define demand for the entire mutation lifetime | P10/E7; policy U3 |
| R11 | Keep write rejection, uncertain outcome, successful commit, and failed synchronization distinguishable; permit observable exhausted-read error | P3/P11; unknown outcome is evidence absence, not a new retry policy |
| R12 | Preserve the bare writable API and server-code boundary; reject unsupported inverse-write assumptions rather than exposing a public source handle or smuggling server handlers into client evaluation | P1/P2, E1/E4 |

R1/R6 semantic requirements constrain optimization admission before R8's cost preference. That priority follows the user's correctness and exclusion requirements. No other unresolved preference is silently ordered.

### Candidate decision sequence (inferred, not executable pseudocode)

1. Know the demanded query instances and validated server identities/arguments relevant to the operation (U3/U4).
2. Capture local intent and supported tentative propagation synchronously; retain transaction ownership. Unsupported tentative cases follow a still-unselected U1 branch.
3. Execute the mutation; distinguish actual outcome/effects from prediction. Keep the set of local participants even if the server takes a different branch.
4. Choose conservative authoritative read candidates. A proven unchanged result may skip a read **while still participating in local settlement**.
5. Start from full evaluation/full-result delivery. Independently consider avoiding reads, deriving updates, sending deltas, sharing execution, and sharing encoding. Each requires its own evidence and cost admission.
6. Publish and retire under the observation contract, or report synchronization failure. A newly active query may require information absent from the original request; no unconditional one-round-trip promise covers that transition.

The normal stable-target fallback can complete in one mutation request/response. The sequence does not select a stateless active-descriptor request versus a server subscription registry, a snapshot/version protocol, or a transaction publication mechanism.

## Two adjacent ownership forms

Both use the same analysis/authority/delivery rules above. They are unranked samples generated by rule combination; the available source does not justify calling these clean module swaps.

### F1 — Query-owned results with coordinated tentative edits

- **Change:** Keep one result state per endpoint query. Use established relation/intent information to compute supported per-result edits and attach them to the same T. Full server results replace only their own query domains.
- **Source support:** E1 provides query-owned collections and transaction capture; E3 provides the missing propagation case; E5 exposes the missing metadata. The extra coordination/evaluator is introduced structure.
- **Preservation:** P1–P12 are obligations under R1–R12, including A1/A3/A4/A5. C6/C7 may optimize authoritative delivery without changing ownership. Unsupported optimism remains U1, not a declared solved case.
- **Distinct transformation:** Augment L2 across existing Hs without combining their snapshot ownership. Duplicate-query coalescing is an optional restricted specialization, not a third general form.
- **Cost/loss:** Copies, repeated result computation and coordinated rollback remain. A transaction spanning edits does not by itself establish atomic notifications. Dependency/effect coverage and generalized write interpretation remain unresolved.

### F2 — Shared supporting state with writable query overlays

- **Change:** Factor compatible support rows into shared internal H and derive supported query results through L1. One interpretable tentative row edit can affect several overlays. Callers retain bare writable endpoint collection handles.
- **Source support:** E1/E3 document keyed collections, DB query derivation and transactions; E4 supplies coverage restrictions. Shared ownership, retention, and checked inverse mapping are introduced structure.
- **Preservation:** P1–P12 remain obligations. A1/A2/A4/A5 become explicit coverage/ownership relations; authoritative full query results must not overwrite the entire shared relation. Unsupported query families need an explicit non-shared path or exclusion, not an assumed universal overlay.
- **Distinct transformation:** Factor H and change L1/L2 ownership rather than repeating per-result edits. C6/C7 remain independent choices.
- **Cost/loss:** Response-to-support reconciliation, missing fields, retention and cleanup become coupled. Shared storage does not discover unknown server logic, reconstruct unloaded join partners, or define arbitrary writes through aggregates. U1/U2/U3/U6 remain.

Generating “always use shared payload” as F3 would only hardwire C7 and violate P12 in the measured boundary. Generating “always refetch” as F3 would describe the delivery baseline, not a third ownership arrangement. Both are demoted rather than padded into additional forms.

## Unresolved contracts

- **U1 — Unsupported optimism:** Which operations can execute with authored local effects, reduced optimistic coverage, an explicit incomplete state, or rejection? These are unresolved alternatives, not selected behavior. Exact cross-collection optimism cannot be claimed for all of them.
- **U2 — Observation and publication:** How are baselines, pending transactions, stale/uncertain delivery, and multi-table/multi-commit visibility represented? No queue, last-writer policy, or global snapshot is inferred.
- **U3 — Demand:** Preloads, indirect consumers, pins, late activation, and readiness; plus when the server's target knowledge must be refreshed.
- **U4 — Evidence acquisition:** Which bounded query/handler forms can be analyzed, what validates general active descriptors, and how complete actual indirect effects are established? No general classifier or effect capture implementation exists here.
- **U5 — Cost policy:** Which estimates/measurements and overhead budgets admit an optimization, and when is a known-safe conservative alternative preferable? The one fixture supplies no universal threshold.
- **U6 — Writable projections and shared support:** Output/source identity, inverse writes, partial-field ownership, and atomic replacement semantics beyond the full-row fixture.

**Dynamics:** R2–R11 describe tentative propagation, actual observation, optional transformations, and settlement. **Constraints:** P1–P12 and C1–C9 bound legal transformations. **Boundary conditions:** shape, identity, scope, local support, actual effects, demand, baseline, overlap, compression and scale. Independent range remains RG1: untested.

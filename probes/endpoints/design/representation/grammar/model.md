# Representation grammar: model

This exploratory grammar describes the existing probe and permitted extensions. Candidate units are not claims of fundamental atoms or proven software modules.

| Unit | Role and admission | Source |
| --- | --- | --- |
| Q | Read description: trusted identity/scope/input, result semantics, dependencies and analysis gaps | Survey C1/C3; P2/P5/P6/P11 |
| E | Effect description: relation/key, before/after values, provenance (guess or observed), coverage limits | C2/C4; P3/P8 |
| T | Existing transaction carrying guessed snapshots and settlement identity | C2; P1/P3/P4 |
| C | Retained collection instance and its confirmed baseline/generation | C2/C3; P2/P10 |
| A | Authoritative response: results or validated patches tied to request and collection generation | P3/P5/P6/P10; inferred extension |

Relations: L1 Q→C instantiates scoped results. L2 T→E owns guessed effects. L3 (Q,E,C)→T edits eligible result overlays. L4 actual E×Q selects possible reads. L5 A→C installs authority before retiring the matching T. L3 is an active intersection: an effect only supplies a result edit given the query and sufficient local support. L4 is a different intersection with different evidence; neither can inherit the other's proof.

## Dynamics and constraints

R1: Bind stable scoped Q→C; C remains eligible until GC, even without subscribers. [user; extends current map]
R2: Capture user writes synchronously in T as guessed E; preserve validated whole rows. [source]
R3: Derive other result edits only when Q semantics and E supply enough support; otherwise record an explicit unsupported exit. [inference/user]
R4: Complete actual effects may exclude disjoint reads; unknown coverage selects all retained requests. [inference/user]
R5: Execute trusted server reads and return full results when no independently justified shortcut applies. [user]
R6: Apply A to the matching confirmed baseline, then retire T through DB settlement; never merge confirmed fields into a pending snapshot. [source/inference]
R7: Validate scope/identity/generation and authoritative coverage; absence is not a deletion outside the described result. [source/inference]
R8: Keep confirmed, guessed and error states distinct; a committed write followed by exhausted reads is not a rolled-back server write. Retry reads, not an already committed mutation. [user/source]
R9: Skip, derive, delta-encode and share execution/encoding require separate evidence and cost admission. Full results remain legal when optimizations are unavailable or cost more. [user/prior measurement]
R10: Preserve normal writable API, synchronous action, server boundary and absence of implicit queue across transformations. [user]

Boundary conditions: current extractor accepts one full-row Todo relation, trusted auth predicate and ascending order. Existing runtime has infinite GC and no cross-query fanout. Initial bounded support is not a claim about joins, top-k or arbitrary SQL.

## Adjacent forms (unranked)

F1 — Rule combination: add a serializable bounded Q and fan E into separately owned result collections. Existing DB evaluator and transactions supply row membership/snapshots. New structure: descriptors, retained registry, confirmed baseline bookkeeping. Preserves L3/L4 distinction; loses exact optimistic coverage when a result needs unavailable rows (joins/top-k). Server full evaluation remains available.

F2 — Rule combination: retain query-result API while factoring shared supporting relation state and deriving queries through existing DB query pipelines. New structure: coverage/ownership and inverse write mapping. Preserves L3/L4 distinction; adds support retention and write-routing obligations, especially for projections and joins. No claim that current APIs fully implement this form.

Result patches after server evaluation and shared result encoding are R9 options in either form, not additional ownership forms. No ranking is part of this grammar.

## Unresolved and loss

U1: Creation/restart/GC while work is pending needs generation-aware catch-up.
U2: Concurrent responses need an observation/publication contract; source hash is not a database revision.
U3: Query-module dispatch does not establish an app-wide trusted registry.
U4: Exact optimism for joins, top-k, opaque server branches and incomplete support is unproved.
U5: A broad SQL codec/evaluator equivalence contract is absent.
D1: Decomposition hides coupled publication and support retention. Five records alone do not make these modules independent.
D2: Single response/full evaluations do not prove common snapshot or atomic multi-collection visibility.

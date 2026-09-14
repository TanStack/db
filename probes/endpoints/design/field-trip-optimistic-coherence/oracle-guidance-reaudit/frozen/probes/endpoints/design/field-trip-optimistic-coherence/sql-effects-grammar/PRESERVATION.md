# Preservation contract — SQL effects grammar

Run 28, 2026-09-14. Extraction target: the proposed deterministic checker in
[SOURCE.md](SOURCE.md), with [source identity](source-manifest.json). This is a
grammar for the proposed checker, not an exact reconstruction of every behavior
of the current compiler. Kitchen's motivating index case belongs to extraction,
not to an independent range test.

The list below normalizes the user's explicit requirements. The only material
ambiguity raised was whether declarations alone suffice for PostgreSQL function
effects. Kyle resolved it: **“yeah we should analyze PG functions”** (Field Log
comment 61). General Node.js/helper analysis remains deferred. No preservation
property is frozen by silence, and no new trust premise is inferred from the
earlier “ok go.”

| ID | Property | Authority |
| --- | --- | --- |
| P1 | Decide a named claim: whether this mutation can affect this query, plus whether the browser still requires authority. Do not label entire tables generically safe/unsafe. | User critique; source proposal |
| P2 | Preserve application code, auth, validation, transaction boundaries, and order. Emit evidence and lint explanations; insert no auth and do not move checks. | Explicit user requirements |
| P3 | Inspect schema and database routines at compilation. Require neither runtime catalog queries nor added objects, extensions, or tracking machinery in application PostgreSQL. | Explicit user requirements |
| P4 | Analyze visible SQL and PostgreSQL routine bodies/calls. A user-defined function's IMMUTABLE/STABLE label alone does not certify its reads or writes. General JavaScript/library analysis and manual extra-refresh APIs stay deferred. | Latest user correction and existing scope |
| P5 | Consider all retained/non-GCed query collections. Preserve optimistic reconciliation, missing-baseline repair, and the existing stale-response authority rules. | Explicit user requirements; source proposal |
| P6 | Unresolved relevant effects require fallback, but irrelevant schema features must not force it. Report what is unknown and which claim that blocks. | Explicit user requirements; source proposal |
| P7 | Separate refetch selection from exact patches and client expression evaluation. A type or expression need not be executable in the browser to analyze its relation effects. | User critique; source proposal |
| P8 | External freshness remains polling/events/proper sync. SQL independence does not claim continuously current browser state or repair unrelated external writes. | Explicit user requirements |
| P9 | Test both wrong rows and unjustified refetches, using independent expected laws and database execution. Save/shrink failures; do not share expected-classification logic with the checker. | Explicit user oracle goal; source proposal |
| P10 | Preserve prototype simplicity: ordinary refetch is the exit, no new knobs merely because analysis is incomplete, and no unmeasured speed claim. | Explicit user requirements |

Evidence assumptions to keep visible during extraction: a summary describes the
SQL/code/schema version that was analyzed; function/operator/type binding matters;
exact row equality needs an explicit ordering/nondeterminism contract. These are
limits on what evidence warrants, not added product behavior. How to obtain
complete bindings, how many procedural-language constructs to support, and how
to verify deployment/schema agreement remain implementation questions.

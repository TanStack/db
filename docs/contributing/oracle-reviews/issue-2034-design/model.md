# Temporal persistence design grammar — frozen analytical state v1

Mode: exploratory. Provisional preservation list derived from source and the
user's agreed repair direction; not user-confirmed exact equivalence.
Target: the language of admissible typed-value persistence repairs in the
current TanStack DB shared SQLite system. Production e21c280f3, sources E1–E10
in [evidence.md](evidence.md). No production patch is proposed as verified.

## Preservation list

| ID | Property | Authority |
| --- | --- | --- |
| I1 | An accepted supported Temporal value retains kind and semantic value after reopen, in every supported carrier. Ordinary ISO strings remain strings. | User-required direction and issue request; extension of established Date preservation. |
| I2 | Existing Date, BigInt, nonfinite and plain-data contracts remain unchanged; unrelated native classes acquire no support by accident. | Source controls E1/E5; last clause is inferred scope discipline. |
| I3 | Public subset equality, range, order and windows match DB's current semantics, including distinct equality and ordering equivalences. | E2/E3 and existing expression-index contract. |
| I4 | SQL candidate selection never discards a row the residual evaluator would accept; final limits apply after required residual evaluation/order. | Derived necessary condition from E2; not a new product rule. |
| I5 | Rejection preserves the adapter's complete prior durable state; action coalescing cannot hide invalid earlier actions. | Existing adapter/work oracle E6. Does not claim pre-publication rejection. |
| I6 | Changes preserve wrapper FIFO, error/receipt ownership and publication-before-durability behavior from #2002. | E7, user requirement to mesh with current work. |
| I7 | SQL expression/index representations remain aligned and respect host binding caps and transaction-driver propagation. | E4/E5. |
| I8 | Support is qualified by operation, constructor environment and execution boundary. Direct core success does not prove coordinator or host support. | Source boundary E8/E10 and user scope; explicit qualification is inferred. |
| I9 | Reader compatibility and damaged prior bytes have explicit policies; never infer a lost Temporal value from an ordinary empty object. | E1 plus irreversibility inference. Old-reader support is unresolved, not asserted. |
| I10 | Extend primary owners for each law and retain their limits; no second lifecycle or unconstrained codec framework is necessary to represent this value-domain repair. | User/code-weight instructions; no-framework conclusion is a provisional design constraint. |

## Model: candidate primitives

These are dimensions of one contract, not six proposed production classes.

| ID | Candidate unit | Why it survives removal | Evidence |
| --- | --- | --- | --- |
| P1 | Typed value witness: kind, lossless value, valid native/polyfill brand, constructor capability | Removing kind conflates string/date/Temporal; removing the brand admits spoofed tags. | E1/E3/E9 |
| P2 | Carrier occurrence: row field, nested record/array, inline or separate row metadata, collection metadata, replay/tombstone payload, query/index literal | A top-level-only repair leaves independent serializer entrances uncovered. | E1/E4/E6/E10 |
| P3 | Representation mapping: runtime value ↔ tagged wire/storage value, plus operation-specific query representation | Stored spelling alone cannot establish query semantics or old-reader behavior. | E1/E3/E4 |
| P4 | Operation and observation: encode/revive, equality, order, candidate filtering, pagination, index lifecycle, accepted/rejected committed write | Storing a value does not imply it can be ordered or safely filtered in SQL. | E2–E7 |
| P5 | Execution boundary: direct core, transaction driver, persisted wrapper/coordinator, platform host | Erasing boundary borrows admission, ordering or native-host evidence from a different route. | E5/E7/E8/E10 |
| P6 | Evidence obligation: positive path reach, independent expected result, checkpoint, wrong-design control, declared limit | Removing it promotes a green serializer/control into end-to-end support. | oracle-tests.md and E10 |

## Relations, overlaps and grammar rules

Use the following notation to describe a case, not a new runtime interface:

    Case := Value × Carrier × Operation × Boundary × Environment × HistoryWitness
    Environment := constructor availability + reader/format generation + index generation + host cap
    HistoryWitness := an existing owner's legal history populated with the new value domain

A configuration is admissible only when the relevant rules below have an owner
and distinguishing evidence. The cross-product is constrained; it is not a
requirement to enumerate arbitrary combinations or a claim all cases are valid.

| ID | Rule and active overlap | Source versus inference |
| --- | --- | --- |
| R1 | Kind and lossless value survive encode/revive; a missing required constructor fails explicitly. Brand recognition alone is not proof of support. | Kind/value is target I1; missing-constructor policy is proposed using E9. |
| R2 | The same preservation/rejection policy reaches every supported carrier. Nested location can change mechanics but not type semantics. | I1, E1/E6. Proposed carrier-completeness extension. |
| R3 | Equality, ordering and storage have separate obligations. A lossless representation need not be a sortable SQL key; comparator equality need not imply DB equality. | E3. |
| R4 | Pushdown is allowed only with an exact or demonstrably conservative candidate set. Unsupported/unknown semantics use a whole-predicate residual route unless Boolean composition itself is proved conservative. | I4 derived from E2. The classifier/mechanism for untyped field-to-field refs is unresolved U1. |
| R5 | Runtime scalar literals, IN's JSON binding, cursor predicates and index literals must preserve the same logical operand; normalized runtime/index SQL stays aligned. | E4/E5; Temporal extension proposed. |
| R6 | Each action required to serialize must remain validated, including superseded values and metadata. Adapter failure preserves durable rows, metadata, position and replay atomically. | E6 established, no new transaction scheduler. |
| R7 | The adapter cannot reclassify its later durability error as a source precommit abort. Preserve wrapper's public receipt/error and FIFO laws. | E7 established. |
| R8 | Constructor registration, codec reach and wire admission are separate capabilities. Expand a boundary only with that boundary owner's contract and receiving witness; otherwise state explicit non-support. | E8/E9; integration constraint inferred from current boundaries. |
| R9 | Rebuild changed normalized index definitions using the existing index path. New readers must preserve existing supported bytes. Old readers and existing literal marker-shaped objects require an explicit decision before claiming compatibility. | E4 + unresolved U3. |
| R10 | Add value dimensions to existing owner histories. The focused file-backed Temporal oracle owns value identity across reopen; it cannot own source-publication semantics, native host planning, or a universal transaction model. | E6/E7/E10 and oracle guide. |

Active intersections (not assignable to a single serializer module):
O1=P1/P3/P4: type identity versus equality versus ordering.
O2=P2/P3/P4: query/index literals and stored fields meet at SQL interpretation.
O3=P2/P4/P5: serialization failure meets action coalescing, durable rollback,
and wrapper receipt settlement at different checkpoints.
O4=P1/P3/P5: constructor availability meets platform/coordinator admission.
O5=P3/P4/P6: compiler upgrades meet persisted physical indexes and direct SQL evidence.

These overlaps have distinct failure consequences; a tree that assigns all of
them to serialization loses the relevant public contract. Current interfaces
support a shared adapter value helper and reuse of DB comparison semantics.
They do not establish a universal pluggable codec interface.

## Dynamics, constraints and boundary conditions

Dynamics are design transformations: substitute a lossless representation for
empty-object flattening; extend a supported carrier; add a constructor provider;
replace exact SQL execution with a conservative candidate route; augment an
existing oracle grammar with a native-value dimension. Each move preserves the
corresponding I/R constraints or explicitly records a changed support boundary.

Constraints: R1–R10, actual transaction-driver ownership, no history rewrite,
no type coercion by ambient stringification, and no unrestricted promise that
all Temporal kinds admit ordering.

Boundary conditions: current shared core plus existing wrappers, current
polyfill/native constructor availability, formats and driver limits. The first
candidate below targets Instant and PlainDate; it is not an inferred promise
for all eight Temporal kinds, custom classes, realms or provider hosts.

## Unresolved rules and adjacent forms

U1: Exact mechanism for safe SQL candidate selection with untyped field-to-field
refs, negation, mixed operands and unsupported functions; fallback work cost.
U2: Constructor provider API versus registered globals; support matrix for
native runtimes, other Temporal kinds and receiving host processes.
U3: Marker namespace collisions, reader generation compatibility and what
rebuild/reset policy is justified for previously damaged cache data.
U4: Coordinator wire support and full public wrapper reach; direct-core scope
cannot settle it. No priority between these support surfaces is invented.

Generated adjacent forms, unranked:
F1 (substitute + exclude): tagged preservation for the two reported kinds,
Temporal-aware residual evaluation and order; withhold unproved SQL pushdown.
Retains I1–I7 where configured but requires U1 resolution; loses indexed query
work benefits for those requests. It does not add a codec framework.
F2 (augment F1): add exact per-operation SQL keys/literal lowering and matching
index expressions for proven Temporal domains. Adds capability/proof obligations
at O1/O2/O5; preserves fallback elsewhere. Precision/calendar and upgrade
witnesses required. Exact keys are a new design choice, not present source fact.
F3 (exclude): explicitly reject unsupported native values at serialization,
retaining existing supported kinds and adapter failure contracts. Stops new
silent loss but intentionally does not satisfy the requested Temporal support.
It cannot promise no prior Collection publication. This is an adjacent safety
form, not a substitute silently selected for F1.

Distortion and loss: operation/type decomposition can hide interactions with
framework scheduling, mutable constructor registration and host transport.
The source is SQLite-centric; this grammar does not make provider field schemas,
all calendars or every consumer runtime authoritative. No form is a verified fix.


Controls and the frozen projection map are in [process.md](process.md).

# One candidate for blind hostile assay — C1

Declared claim: add built-in lossless Temporal persistence to TanStack DB's
shared SQLite adapter, initially Instant and PlainDate, while preserving its
existing query, transaction, wrapper and index contracts. A serializer-only
change is insufficient.

Proposed design:
1. Extend the existing tagged serializer with explicit Temporal kind and
lossless canonical representation. Cover rows, arrays/records, inline and
separate row metadata, collection metadata, replay and tombstones. Validate
real Temporal brands rather than trusting a spoofed toStringTag. Decode with
native or registered polyfill constructors, following existing offline
serializer convention. Missing required constructors reject explicitly.
2. Preserve DB's existing distinction between equality normalization and
semantic ordering; reuse Temporal-aware comparison behavior in persistence's
local sort. Keep strings and Date/BigInt behavior unchanged.
3. Preserve public query results by emitting SQL only where candidate selection
is exact or demonstrably conservative, otherwise use existing residual
execution. No SQL precision-losing Date/float conversion. Scalar/IN/cursor/
index-literal representations and normalized index SQL must agree. How to
classify untyped field-to-field expressions and all Boolean compositions is
not yet specified; performance cost of broad fallback is an open requirement.
4. Keep current action folding, validate required intermediate serialized
values, preserve adapter atomic rollback/positions/replay, host binding caps,
transaction-driver ownership, existing physical-index rebuild and wrapper FIFO.
Do not introduce a new transaction lifecycle. Adapter rollback does not imply
undoing a value already published by the persisted wrapper.
5. First-party coordinator transports and host runtime receipt paths require
separate support evidence. SQLite's new codec cannot silently expand those
wire contracts. Whether the first implementation includes or explicitly excludes
these routes remains unresolved. Other Temporal kinds are not initially promised.
6. Extend existing oracle owners: direct file SQLite for typed values and
reopen; ordinary-work owner for folding/rollback; expression-index owner for
captured SQL before re-filtering, bindings/index use/upgrades; wrapper/Query
owners for errors/publication/FIFO; receiving host/coordinator tests where those
paths are claimed. Do not replace them with another reference scheduler.

Success standard: supported inputs retain native kind and value across every
claimed carrier and boundary; query public results match established DB
semantics; required rejection leaves prior durable state/positions unchanged;
existing receipt/FIFO and work/cap laws remain; claims are limited to reached
production observations and current declared scope. No implementation exists
for this candidate. A lossless serialization string is not asserted to be a
valid comparison key. Stored {} corruption cannot be guessed back into dates.

Open conditions: exact SQL admissibility mechanism; global versus explicit
constructor provider; reserved-marker collisions and old readers; coordinator
scope; expansion beyond the two reported Temporal kinds. These are known
unresolved details, not assumed solved. Find whether they defeat the structural
claim or hide additional necessary conditions, not merely restate the list.

Source trace is in [evidence.md](evidence.md). You may inspect
only those source files and relevant existing oracle owners/limits for evidence.
No sibling candidate, preferred outcome or later stress reading is supplied.

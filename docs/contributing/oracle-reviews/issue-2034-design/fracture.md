# Fracture scanner — C1, frozen-scope reading

Position: C1 from [candidate.md](candidate.md), with source E1–E10. Core claim:
built-in lossless support for Instant/PlainDate can refine the existing shared
SQLite system if value, query, boundary, rejection, and compatibility obligations
are satisfied together. Scope includes each claimed carrier/path; unidentified
SQL lowering, constructor provisioning and reader compatibility are explicitly
open, not assumptions that the implementation already meets them.

Frozen premises: canonical tagged payload preserves runtime kind/value; DB
equality and ordering remain separate; SQL candidates must be exact or a
superset; current durable and wrapper laws remain; unsupported boundary claims
need separate evidence. Success is public semantic refinement under those
conditions, not merely successful serialization. Protected insight: a shared
value codec is the natural place to close the repeated loss across carriers.

## Result

No unconditional internal fracture of that conditional claim was established.
The run exposes one conditional fracture of the smallest tagged-format
implementation, and rejects two tempting overclaims as already-excluded designs.
This does not show C1 is implemented or cheap: several necessary mechanisms
remain unresolved.

FRA1 — Adding an unescaped tag can violate preservation of existing plain data.
Route: internal extension and constructed counterexample.
Premise chain: retain existing plain objects (I2) → add a new recognized tag in
the existing object namespace (permitted simple implementation of C1) → decode
by marker membership (E1) → a previously ordinary record becomes Temporal.
Minimal case: before upgrade store a plain object with
__tanstack_db_persisted_type__='Temporal.Instant' and
value='2026-01-02T00:00:00Z'. Current tag recognition excludes that string, so
it remains a record. Extending the recognized tag set without an escape/version
rule makes the same bytes a native value. The object contains no genuine
Temporal brand; encode-time brand validation alone cannot disambiguate old bytes.
Admissibility: a plain record is within I2's domain; the example uses the exact
existing reserved-marker fields; it varies an explicitly open namespace choice,
not constructor availability or a host outside the claim. The consequence is
type mutation of ordinary data, not a security attack.
Evidence kind: construction grounded in current encoder/decoder source, not an
executed new implementation. It defeats the naive unescaped extension, not C1
with its unresolved U3. The hidden condition is unambiguous representation
provenance across reader generations. Preserved insight: lossless tags still
work when a justified escaping/envelope/version policy distinguishes user data.
Weakening evidence: a documented exclusion already reserves future marker names,
or a compatible disambiguation mechanism prevents those bytes being accepted as
ordinary data. None was established in this run. Repair condition: decide and
witness the namespace and old-byte policy before claiming compatibility.

FRA2 — Lossless strings do not imply correct SQL ordering: excluded wrong design.
A bounded Node/SQLite probe used Instant values
1970-01-01T00:00:00Z and 1970-01-01T00:00:00.000000001Z.
Temporal.Instant.compare returned -1; SQLite '? < ?' on their strings returned
0. Canonical ISO text has variable precision, so raw lexical comparison fails
on these adjacent instants. This is an executed scalar/SQLite result, not a
production-patch test. C1/R3 already deny that serialization text is necessarily
a comparison key. Therefore it is a calibration of that boundary, not an
internal fracture of the actual frozen candidate.

FRA3 — Equal order is not equal identity: excluded wrong design.
The same probe compared PlainDate 2026-01-02 with its Japanese-calendar form
2026-01-02[u-ca=japanese]. Temporal.PlainDate.compare returned 0, while kind-plus-
text equality was false, matching DB's existing equality normalization rule.
A single comparator-derived key for every operator would violate I3. C1 already
separates these operations. The narrower retained claim is operation-specific
query semantics, not one universal SQL key.

## Controls and limits

Outside-standard rebuttal rejected: 'Any need to register a polyfill is bad API
design' does not by itself refute a candidate that explicitly requires a
constructor capability. It is a preference or tension to examine separately.
Vivid near-counterexample rejected: reopening on a device without the required
constructor and receiving the documented explicit error does not defeat the
supported-environment preservation promise. It does show that broader native-
host support has not been established.
A source durability failure after prior publication also does not refute C1's
adapter atomicity: C1 explicitly preserves distinct public/durable checkpoints.

Distortion: the concrete marker and nanosecond examples make one compact corner
case unusually salient. They do not measure frequency, overall repair size,
user impact or complete cross-host behavior. The conditional fracture must not
be upgraded to a claim that all tagged persistence is unsound. No grammar rules
were revised during the scan and no production code changed.

# Tension statement — initial scan of the Temporal persistence design

Provenance inventory:
U1 user: reproduce #2034, use latest origin/main, mesh with existing persistence
oracles, and stress-test the agreed repair direction.
U2 prior proposal: tagged lossless values, matching query behavior, explicit
errors for missing support, compatibility and refetch limits.
S1 source: DB semantic equality/order, SQLite indexed expression contracts,
host-cap fallback and ordinary-write work laws.
S2 source: globally registered Temporal constructor precedent; separate
coordinator wire admission; no assumed polyfill/runtime capability.
S3 source: current object marker namespace, schema fences/index rebuilds, old
{} bytes with no recoverable Temporal information, publication-before-durability.
A1 inference: broad SQL fallback may impose material read work; no latency or
row-scan budget is established for this particular new value domain.
A2 inference: users may value transparent runtime portability; this is a
candidate concern, not a user-stated requirement to avoid registration.

Candidate burst (generated framings, not discoveries):
T1 Exact query semantics versus retaining indexed selective execution when IR
has no field-type schema and values may be Temporal.
T2 Constructor-free deployment versus reviving real native values on hosts
without Temporal.
T3 Core-only scope versus a public wrapper whose coordinator validates a
separate supported wire-value domain.
T4 New tagged formats versus preserving existing plain records/older readers
that do not recognize the new interpretation.
T5 Immediate corruption prevention versus making all serialization failures
invisible to users before publication.
T6 A small production repair versus replacing all existing persistence oracles
with a larger new model.
T7 Restoring old typed values versus preserving ambiguous already-written {}
records in an offline cache.

Control without a binary: SQLite accepts arbitrary object rows; current scalar
encoding loses Temporal state. Revival needs a constructor. Queries have two
execution stages; only the first can drop candidates irrevocably. Existing
models own different boundaries. Old bytes and old readers cannot learn a new
interpretation merely from a new codec. This inventory does not entail a choice
between correctness and performance, and contains no user demand that all
serialization errors precede publication or that oracle ownership be replaced.

Discarded/qualified framings:
T5 is thin: the user asked to fix loss, not to reverse publication-before-
durability. It is a boundary clarification, not an established competing demand.
T6 is dissolved by the existing test/production budget distinction and owner
composition. More tests do not require a new production state machine.
T7 is a hard information limit for already-lost values; it strengthens the
compatibility question but cannot manufacture a recoverability guarantee.

Three unranked working tensions remain, all provisional pending user fit:

A. Semantic correctness and selective SQL execution.
We need exact Temporal query results, and we also need to preserve the useful
indexed execution that existing planning tests protect. Under untyped field
comparisons and Boolean composition, an unproved SQL filter can lose valid rows;
a broad residual route can give up index benefits. Roots: U1/U2 and S1. New move:
A1 connects safe fallback with read work, not a measured regression. Weakening:
prove an exact or selective conservative lowering for the requested domain, or
accept a bounded performance scope. Framing loss: may hide that costs differ by
query shape and that existing write-work bounds do not govern all read scans.

B. Real value reconstruction and runtime/path portability.
We need reopened values to be actual Temporal values, and we also want the fix
to work through the environments and public APIs users already run. Under a
host without the required constructors or a coordinator that rejects Temporal
wire values, adding a SQLite tag does not establish that second capability.
Roots: U1/U2, S2. New move: portability as a desired degree is A2; the user has
not required a dependency-free constructor strategy. Weakening: a documented
registration or provider contract plus receiving witnesses across claimed paths.
Framing loss: may overstate friction for apps that already install a global
polyfill, or understate processes with different runtime initialization.

C. Format extension and compatibility of existing data/readers.
We need new unambiguous typed encodings, and we also need an explicit policy
for existing plain records, old readers and already-damaged caches. Under the
current marker namespace, a new recognized tag may reinterpret a prior record;
older readers cannot revive a new tag, and {} alone cannot identify lost dates.
Roots: U1/U2, S3; tag collision is a constructed, source-grounded example.
Weakening: a justified reserved namespace/escaping/version boundary and a stated
cache-upgrade/refetch policy. Framing loss: combines several compatibility cuts
whose ownership and migration costs differ; it must not imply that all stored
user data can be discarded as a cache.

Distortion: this method selects collisions and can make them look symmetrical
or fundamental. The rejected T5/T6 controls show that some apparent conflicts
are ordinary contract distinctions. No option is ranked or selected for the
user. User-fit selection remains pending; these are not proof that any one
tradeoff should govern the implementation.

The subsequent [user recheck](user-recheck.md) records the corrected direction
and supersedes the pending user-fit status above without rewriting this scan.

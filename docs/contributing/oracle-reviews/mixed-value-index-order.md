# Mixed values in ordered indexes

An indexed field can contain values from different JavaScript families. The
index API accepts these values, while mixed-domain range optimization is
disabled. Exact lookup, public WHERE membership, and unfiltered traversal
must still preserve each live key through legal deletes and updates. The
contract does not assign a public order between unlike families. Within one
orderable family, the configured comparator still applies.

## Discovery and RED evidence

An existing generated WHERE publication history failed with seed `907500611`
and path `78:8:6:6:8:7:6:7:8:10:10:9`. Its legal source held `b`, `1`, and
`a`, then deleted and updated rows. `BasicIndex.addToOrder` threw while it
looked up an ordered bucket. The default comparator had tied both strings
with the number through native relational coercion, although it ordered `a`
before `b`. Those ties do not form a partition that an ordered index can
maintain.

The WHERE oracle now pins that history and compares public key sets after
each commit. The direct index owner also checks build and incremental
admission, reversed source order, exact lookup, and key conservation after
deletion and replacement for both BasicIndex and BTreeIndex. A source Map
predicts live keys and exact members. The test checks string collation only
within the string family; it does not prescribe where the number appears.

The same comparison fault reached other legal values. A fixed
PlainDate/ordinary-object history updated one row from an ordinary object to
a later PlainDate, then an earlier PlainDate. A later update lost or duplicated
keys, and the original BasicIndex implementation could throw at the same
bucket lookup. A callable/number history also lost keys because two distinct
functions each tied the number after native coercion. Direct witnesses now
check arrays, Dates, PlainDates, and callables beside ordinary objects or
numbers. They compare a full ordered take with the source Map as a key
permutation, check exact membership after each action, and retain order only
within comparable values of the same family. The original comparator failed
the PlainDate and callable witnesses before repair.

## Repair and scope

The default comparator now separates strings from other primitives. It
separates arrays, native Dates, branded Temporal values, and ordinary
references before the runtime object-ID fallback. Functions use that same
reference path. These family positions prevent a cross-family comparison
from tying or reversing an order established within another family. Same-kind
string, array, Date, and Temporal comparisons remain in their existing paths.
Mixed Temporal kinds that lack a common defined order still reject ordering.
The relational WHERE helper keeps its existing comparison semantics.

After the repair, six affected test files passed 600 tests with no Vitest type
errors. The explicit test TypeScript check, formatting, and diff checks
passed. ESLint reported five existing `require-await` warnings in the older
part of the direct index oracle and no warning in the new code.

This repair covers the named finite direct histories and the public WHERE
history. It does not claim a specific cross-family sort order, arbitrary
mixed-value histories, proxy behavior, mixed Temporal-kind ordering, or
validity of an arbitrary user comparator. A user comparator that violates
transitivity can still corrupt an ordered index. The direct index and
comparison owners need further generated family-mix histories before a
universal sorted-index claim. A fresh exact-commit hostile review and final
package verification follow after commit.

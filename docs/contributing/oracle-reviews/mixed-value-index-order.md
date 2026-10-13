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
The public WHERE check establishes that writes and publication complete with
the right keys. It does not prove that a public indexed lookup ran after each
update; the direct index owner supplies exact lookup observations there.

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

## Frozen-head retirement audit and public-order neighbor

The hostile reviewer inspected the ledgers, both index implementations, and
the receiving direct and public oracles at
`210651d207eefe9bbc025c780f6259e470225c9e`. It found no lost assertion
among the 18 retired BasicIndex/BTreeIndex blocks. The direct grammar's
build and delete observations include string/number and callable/number
histories. Array/object, Date/object, and PlainDate/object have incremental
add/update observations here, without a build/delete claim. The
[coverage map](../oracle-coverage.md) now states those boundaries explicitly.
This was source and ledger inspection, not an exhaustive generated proof.

An adjacent public Date/number history exposed a separate order defect.
The unindexed ordered snapshot returned
`[equal-number, number, date]`; after either index type was installed, the
optimized snapshot returned `[date, equal-number, number]`. Two intended
index-type assertions failed before the repair. The
[custom-index selection owner](custom-index-order-selection.md) now compares
the full public order and limit-one result before and after index installation
and proves an index take ran. Retaining native Dates as order values while
keeping their numeric exact keys made the 497-test focused campaign and
12,345-test full DB campaign pass. This establishes scan/index agreement for
that fixture, not a universal mixed-family order or arbitrary histories.

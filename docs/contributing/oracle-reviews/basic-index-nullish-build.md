# BasicIndex build with a nullish value

At PR head `175adce0cb32e29e5838853c821ee5c56fe0089a`, a focused runtime
witness built a direct BasicIndex from `undefined` and `1`. The default
comparator places `undefined` first. `BasicIndex.build` returned
`takeFromStart(2) = [one, undefined]` and an empty inclusive upper range
bounded by `undefined`. Incremental `BasicIndex.add` and both BTreeIndex paths
returned `[undefined, one]` and the expected range. A recording comparator
received no calls during the BasicIndex build. The build path is also reached
when `Collection.createIndex` builds an index over existing rows.

The accepted law is the default ascending, nulls-first order documented by
`DEFAULT_COMPARE_OPTIONS`, `defaultComparator`, and the direct `IndexInterface`
contract. The primary `index-update-oracle.property.test.ts` already models
nullish positions with a source Map, but its nullish history grammar previously
used add/update/remove only; its generated build grammar used numeric values.
The smallest missing cell is `undefined` plus `1` through `BasicIndex.build`,
observed with `takeFromStart(1)` and an explicit upper range. A two-order
fixed build history and generated nullish builds now use the same Map checker
after each returned action. The Map distinguishes exact null and undefined
membership while its ordered projection treats them as one comparator
position. Raw duplicate source keys are resolved before build; mixed value
classes and custom comparators remain outside this claim.

## RED evidence before the production change

The new fixed oracle witness failed on the unchanged implementation:
`BasicIndex nullish direct index refinement > build preserves nulls-first
ordered reads and ranges` compared `takeFromStart(1)`, receiving `[one]`
against source-model `[undefined]` at the intended observation checkpoint.
The BTreeIndex version passed. The command's focused run had one failed test,
one passed test, and no type errors. This is a product mismatch, not a setup
failure or a changed expectation.

Native `Array.sort` moved a raw `undefined` element to the end without invoking
the supplied comparator. `BasicIndex.build` now sorts wrapper records, so every
stored value reaches the configured comparator, then unwraps the sorted values.
The fixed two-order build history and generated put/delete/build histories
pass through the same independent Map checker after each returned action.

## GREEN evidence and hostile review

The complete direct index oracle passed 412 tests with no type errors after the
repair. The fixed history includes both source insertion orders and a later
build with `undefined`, `null`, and a defined value. The generated grammar can
replace an existing source Map through build. The fresh hostile reviewer
`/root/review_nullish_build_oracle` inspected the original RED witness, the
model, both index implementations, and the repair. It found no blocker for the
bounded direct-index law. It did not claim that a Collection query using a
newly built index has been observed publicly.

The oracle's model derives exact membership and sorted source keys from the
source Map, not from either index. A build that leaves `undefined` last fails
`takeFromStart(1)` at the returned-action checkpoint. Range and cursor probes
also compare against the Map after each action. The direct-index law excludes
raw duplicate-entry builds, mixed string/number order, custom comparators,
Collection queries, and work complexity. Its fixed and generated build cells
do not establish every possible source history. The exact committed-head
review is recorded in a later entry.

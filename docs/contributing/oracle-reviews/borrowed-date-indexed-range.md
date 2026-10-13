# Borrowed Date prototypes in indexed ranges

A Collection index may change the work used to answer a range predicate, but
it must not change the public key set. The live-query architecture requires a
range to fall back when indexed values do not share the bound's relational
domain. A native Date subclass has a Date timestamp even across JavaScript
realms; an ordinary object made with `Object.create(DateSubclass.prototype)`
does not. The latter cannot enter the index's Date range domain merely because
`instanceof Date` returns true.

The receiving owner is `packages/db/tests/query/index-path-collision-oracle.test.ts`.
Its finite model applies JavaScript numeric coercion to supplied Date values
and treats a throwing borrowed-prototype coercion as a nonmatch. The driver
compares public `currentStateAsChanges` keys before and after installing
BasicIndex or BTreeIndex. Its lookup spy and `optimizedOnly` read establish
whether the index is eligible. The source is a controlled, ready in-memory
Collection, so no provider or scheduling claim follows.

At `3668d1b88`, a hostile WHERE review found a public counterexample:
`gt(v, Date(1))` omitted a borrowed-prototype row in the unindexed snapshot
and included it after installing BasicIndex. The new oracle reproduces the
same result mismatch for both index types. A second history supplies the
borrowed object as a predicate bound; its scan result is empty, and an index
lookup would be unsafe. The positive control uses a genuine foreign Date
subclass and requires an optimized indexed result, so the repair cannot
disable all Date range optimization.

Production now uses the comparator's guarded native Date timestamp check when
it classifies an indexed value's domain and a range bound's eligibility. The
ordinary borrowed object therefore takes the scan path; native local and
foreign Dates remain eligible. The original code failed the after-index key
set, and the repaired focused oracle passes all 16 cases. The Date comparison owner
separately checks direct timestamp ordering and borrowed-object identity.

This witness covers the named `gt` and `lt` snapshots, two index types, one
local borrowed prototype, and one foreign native subclass. It does not prove
arbitrary coercion methods, invalid Dates, later publication histories,
other range operators, proxies, or provider reads. A fresh hostile review of
the committed repair is pending.

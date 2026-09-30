# Issue #1948: keyed MultiSet identity

Reviewed executable revision: `0641a0e2c8a0b6c7351162f667a2eca7662ca4cd`.
The unchanged production baseline was `c879ba6d855914e5c0cac49af7a007eb5cabe7e4`.
The baseline code in `packages/db-ivm/src/{multiset,utils}.ts` is also identical
to the local main checkout at `c0d123b8`, used for the isolated object probe.

## Contract and boundary

`MultiSet.consolidate()` promises that keyed records merge only when their
keys and values have the documented identity. String and numeric keys are
different. Primitive values compare by value; objects and functions compare
by reference, and distinct symbols remain distinct. A two-element value is a
join tuple whose elements follow that leaf rule. After `consolidate()` returns,
the complete output must retain each nonzero identity with its summed weight
and first record. The input must remain unchanged. The oracle does not assert
output order.

This record closes the reported direct `MultiSet` collisions for the oracle's
bounded key/value grammar. It does not establish which `@tanstack/db` queries
produce primitive keyed relation values or mixed-type source keys. A live-query
production witness is still needed for those application paths; the coverage
map names that gap.

## RED and GREEN evidence

The old oracle excluded cross-type, delimiter, symbol, and function cases, so
it remained green on the faulty implementation. The expanded oracle uses the
same independent reference model for eight pinned collision cases and for a
generated collision branch. Before the production change:

- Eight pinned cases failed at multiplicity or missing-identity assertions.
- Both generated campaigns failed. The fixed seed `2026929` shrank to
  `path: "1:0"`, numeric and string keys with opposite weights. Direct replay
  reached the same missing-identity assertion.
- An isolated process probe with a direct object and an object tuple under
  a delimiter-bearing key returned zero records. The two distinct records
  have weights `1` and `-1` under the contract.

On `0641a0e2`, the oracle passes all 22 tests. The exact fixed seed and path
replay passes. The same object/tuple process probe returns two records with
weights `[1, -1]`. All 649 `@tanstack/db-ivm` tests pass, package TypeScript
typechecking passes, Prettier passes, and `git diff --check` passes.

The original production code is the hostile wrong design for this oracle:
`str_${String(value)}` erases primitive type and reference identity, and bare
`|` joins erase component boundaries. Its failures reached the intended
public-result comparison. The repair type-tags primitive identities, uses a
per-consolidation reference map, distinguishes a leaf from a tuple, and
length-prefixes components. Positive controls keep same-symbol,
same-function, signed-zero-key, and NaN-value merging intact.

Production code changes by +10 net lines. Test code grows to make the new
grammar, named cases, and controls visible. No elapsed-time performance claim
is made for the repaired hot path.

## Oracle guide audit

| Requirement | Outcome at reviewed revision |
| --- | --- |
| ORC-001 | The oracle's opening contract cites `MultiSet.consolidate()` and limits the result to its direct API and bounded grammar. |
| ORC-002 | The expected identity uses a type-tagged structured key and a local reference map. It does not call production `getStringId` or hash. |
| ORC-003 | Contract, model, history grammar, production call, and refinement check remain separate in the oracle file. |
| ORC-004 | Eight named cases reconstruct the reported regimes. The collision branch varies case and nonzero sign/magnitude; ordinary keyed histories vary record count and values. The fallback branch deliberately retains its original structural domain. A non-keyed record makes the keyed rule inapplicable. |
| ORC-005 | The driver calls `new MultiSet(records).consolidate().getInner()` and compares every output identity, weight, and retained first record after return. The fixed campaign's reach witness covers every grammar mode. |
| ORC-006 | Unchanged production failed at the intended assertions; the object/tuple process probe also failed before the repair and passed after it. |
| ORC-007 | The same property, grammar, check, and 300-run budget execute with fixed seed `2026929` and a seedless random campaign. Seed-plus-path replay was checked RED and GREEN. No `fc.commands` are used. |
| ORC-008 | Not applicable: the reference is stateless recomputation. |
| ORC-009 | `keyedCollision` is documented as a grammar branch for the same keyed production path; `caseName` is only a replay label. |
| ORC-010 | No external resources are acquired. Shrinking and direct replay preserve the missing-identity failure at the result checkpoint. |
| ORC-011 | No separate shared semantic fault was named. The reference's structured key differs from production's length-prefixed composition, and the positive controls challenge adjacent identity equivalences. |
| ORC-012 | This versioned record identifies the exact executable revision, RED/GREEN receipts, limits, and the outcomes above. |

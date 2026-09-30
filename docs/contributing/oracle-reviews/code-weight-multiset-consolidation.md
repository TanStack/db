# Code weight: one MultiSet consolidation loop

Reviewed executable revision: `f46dd42e` (base `b5d92ceb`, the fetched
`origin/main` at review time). This record follows in a documentation-only
commit. The oracle lands in `025f0866` on unchanged production code. The
refactor lands in `f46dd42e`.

## Change

`MultiSet.consolidate()` had two hand-written loops. The keyed loop handled
`[key, value]` multisets. The unkeyed loop handled other data. Both summed
multiplicities per identity, kept the first record, and dropped zero sums. One
`consolidateBy(inner, identityOf)` helper now serves both. Only the identity
function differs.

- The internal `ObjectIdGenerator` class becomes a `getStringId` function with
  the same encoding.
- The internal `DefaultMap` class and its four unit tests are removed. No other
  code used it. Neither class was exported from `@tanstack/db-ivm`.

The change is intended to preserve behavior, including the cross-type identity
collision in [#1948](https://github.com/TanStack/db/issues/1948). A fix for
that bug is a separate behavior change.

| Entry | Revision | min | gzip | brotli |
| --- | --- | ---: | ---: | ---: |
| full `@tanstack/db` (db-ivm inlined) | `b5d92ceb` | 375,072 | 105,834 | 89,692 |
| | `f46dd42e` | 374,075 | 105,471 | 89,419 |
| | Δ | −997 | −363 | −273 |
| standalone `@tanstack/db-ivm` | `b5d92ceb` | 35,345 | 10,894 | 9,855 |
| | `f46dd42e` | 34,357 | 10,549 | 9,485 |
| | Δ | −988 | −345 | −370 |

All numbers come from an esbuild bundle of the public entry, minified.

## Why a new owner

Before this change, `MultiSet.consolidate` had no owner in the coverage map.
`tests/multiset.test.ts` checks primitive and string values only. The existing
db-ivm suite rejects each wrong design below, but no test states the identity
rules that the refactor must keep. The new oracle,
`packages/db-ivm/tests/multiset-consolidate-oracle.property.test.ts`, states
them and checks them against an independent model.

## Contract, path, and limits

Authority: the identity rules in the method comments of `src/multiset.ts` on
the base revision.

1. **Keyed.** Every record is a `[key, value]` pair with a string or number
   key. The key compares by value. A primitive value compares by value. An
   object value compares by reference. A value that is an array of length 2 is
   a join tuple, and its two elements compare by the same rule.
2. **Unkeyed, one primitive type.** Every record is a string, or every record is
   a number. Records compare by value.
3. **Unkeyed, structural.** Any other multiset. Records compare by structure.

For each identity, the result holds one record: the first in input order, with
the summed multiplicity. An identity whose sum is zero is absent. The input is
not changed.

The model computes identity with a type-tagged key and a local reference map.
It does not import `getStringId`, `ObjectIdGenerator`, or `hash`. The driver
calls `new MultiSet(records).consolidate().getInner()`. The refinement check
records every output entry, so duplicates, extra identities, and missing
identities stay visible. It compares each multiplicity with the modeled sum and
each retained record by reference with the modeled first record. It then checks
that every input pair still holds its original record and multiplicity.

Limits:

- The oracle does not assert output order. No contract states it.
- Keyed values never mix a number and a string with the same text, or a boolean
  and its text. Keyed consolidation merges those today (#1948). The exclusion
  must go when that bug is fixed.
- Structural identity uses a 32-bit hash in production. The small domain makes
  a collision unlikely, but the oracle does not claim injectivity.
- Generated objects have one key, so key-order sensitivity is outside this law.

## Grammar controls and calibration

The grammar has five modes:

- `keyed`: keys from `0, 1, 2, 'a', 'b'`. Values are primitives, three shared
  objects (two with equal contents), fresh join tuples of those leaves, or fresh
  arrays of length 3.
- `numbers` and `strings`: one primitive type.
- `structural`: `1`, `'1'`, `true`, `null`, fresh one-key objects, and fresh
  arrays of length 2.
- `fallback`: keyed records plus one appended non-keyed object, which makes the
  whole multiset unkeyed.

Multiplicities are integers from −2 to 2, so zero multiplicities and cancelling
sums occur.

- **Reconstruction:** five pinned witnesses reconstruct each identity rule:
  reference identity, tuple unpacking, other array lengths, the fallback, and
  `1` versus `'1'` on the unkeyed path.
- **Ablation:** each mode has a distinct rule. The mutants below show that
  removing a rule's distinction fails the oracle.
- **Range:** empty multisets occur in the keyed, `numbers`, and `strings`
  modes. The fixed campaign reaches every mode. In that campaign, more than 30
  of 300 histories merge or cancel records.
- **Exclusion:** the `fallback` mode checks that one non-keyed record makes the
  keyed rule inapplicable.

### Source mutants on unchanged production (`b5d92ceb`)

"Suite" means the rest of the db-ivm suite. The column shows failed tests over
total tests.

| Mutant | New oracle | Suite |
| --- | --- | --- |
| W1: keyed values compare by `hash` (contents) | assertion failure (4/7) | assertion failure (4/591) |
| W2: join tuples compare by reference | assertion failure (2/7) | assertion failure (47/591) |
| W3: keyed loop skips a non-keyed record instead of falling back | assertion failure (3/7) | assertion failure (3/591) |
| W4a: keyed result keeps zero sums | assertion failure (3/7) | assertion failure (18/591) |
| W4b: unkeyed result keeps zero sums | assertion failure (2/7) | assertion failure (5/591) |
| W5: the last record replaces the first | assertion failure (3/7) | assertion failure (3/591) |
| W6: mixed unkeyed data uses raw values as keys | assertion failure (3/7) | assertion failure (4/591) |

### Source mutants on the refactor (`f46dd42e`)

| Mutant | New oracle | Suite |
| --- | --- | --- |
| N1: keyed values compare by `hash` | assertion failure (4/8) | assertion failure (4/588) |
| N2: join tuples are not unpacked | assertion failure (2/8) | assertion failure (47/588) |
| N3: keyed detection checks only the first record | failure by crash (3/8) | failure by crash (3/588) |
| N4: zero sums are kept | assertion failure (3/8) | assertion failure (21/588) |
| N5: the last record replaces the first | assertion failure (4/8) | assertion failure (4/588) |
| N6: mixed unkeyed data uses raw values as keys | assertion failure (3/8) | assertion failure (4/588) |
| W7: an input pair becomes the output entry | assertion failure (6/8) | assertion failure (14/588) |

N3 fails because the keyed path destructures a non-pair record and throws a
`TypeError`. This rejects the design, but by crash, not by a value assertion.
W7 is a risk that only the refactor introduces. Summing into a reused input pair
changes the input, and the input-immutability check rejects it. The oracle had
7 tests before the positive execution witness was added and 8 after.

## Performance

Consolidation runs on every graph step, so the change was timed. Each process
loads one implementation and times one workload set. Processes alternate
between implementations, and the comparison uses the median over five
processes of each.

A first same-process harness showed a position bias. An identical copy of the
base code measured 6% to 22% slower when it loaded second. The
process-per-implementation harness removed that bias. Its A/A control measured
±2% on most workloads and up to ±7% on hash-heavy unkeyed objects.

| Workload | n=10 | n=1,000 | n=100,000 |
| --- | ---: | ---: | ---: |
| keyed rows (update pairs) | 0.689 | 0.807 | 0.814 |
| keyed join tuples | 0.682 | 0.764 | 0.823 |
| keyed primitive values | 0.558 | 0.689 | 0.765 |
| unkeyed numbers | 0.850 | 0.878 | 0.703 |
| unkeyed objects | 0.750 | 0.762 | 0.827 |

Each ratio is refactor time over base time. Lower is faster. Batches of size 10
ran 20,000 times, size 1,000 ran 200 times, and size 100,000 ran twice. Output
sizes matched in every workload. The refactor keeps one `Map` of
`[record, sum]` entries per identity. The base code kept two parallel maps. The
harness is not checked in.

## ORC-001 through ORC-012

| Requirement | Result |
| --- | --- |
| ORC-001 | The oracle's opening comment states the three identity rules, the retained record, zero-sum removal, input immutability, the authority, and the limits above. |
| ORC-002 | The model uses its own type-tagged identity and reference map. It does not import production identity helpers or `hash`. It restates the documented keyed/unkeyed classification because that classification is the contract. |
| ORC-003 | The contract, model (`expectedConsolidation`), grammar (`historyArb`, `buildRecords`), driver, and refinement check (`expectConsolidation`) are separate and visible in the oracle file. |
| ORC-004 | Reconstruction, ablation, range, and exclusion appear above. |
| ORC-005 | The driver calls the public `MultiSet` API. The positive witness shows that the fixed campaign reaches all five modes and many merges. |
| ORC-006 | The source mutants above have their outcome classes. |
| ORC-007 | One property runs a fixed campaign (seed `2026929`) and a random campaign with the same grammar, check, and budget (300 runs). `TANSTACK_DB_IVM_CONSOLIDATE_SEED` and `TANSTACK_DB_IVM_CONSOLIDATE_PATH` select a direct replay. The property does not use `fc.commands`. |
| ORC-008 | The model is a stateless recomputation, so this requirement does not apply. |
| ORC-009 | Model terms (keyed, unkeyed, identity, retained record) name production concepts directly. |
| ORC-010 | fast-check reports the seed, path, and shrunk history. Assertion messages name the identity that diverged. No external resources are acquired. |
| ORC-011 | No shared semantic fault calls for a second formulation. The #1948 collision is a known fault, and the grammar excludes it explicitly instead of sharing it silently. |
| ORC-012 | This record ties the reviewed revisions, outcome classes, limits, and performance evidence to the coverage map. |

## Verification

On `f46dd42e`, the following passed:

- `packages/db-ivm` Vitest: 41 files, 588 tests, no type errors.
- `packages/db-ivm` `tsc --noEmit`: no errors.
- `packages/db` Vitest, typecheck off: 191 files, 6,821 tests.
- `pnpm test:oracles`: 48 files, 2,831 tests.
- `pnpm test:minified-db`: error names, index metadata, query rows, and live
  updates.

The environment was Node `v24.19.0` and Vitest `3.2.4` on Darwin arm64.

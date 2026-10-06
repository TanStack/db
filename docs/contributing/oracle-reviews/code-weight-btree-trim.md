# Code weight: vendored BTree trim and range-scan law

Reviewed executable revision: `067fbd94` (base `ae2eb3fb`, the fetched
`origin/main` at review time). This record follows in a documentation-only
commit. The reviewed revision changes `packages/db/src/utils/btree.ts` and
`packages/db/tests/btree-map-oracle.test.ts`.

## Change

`BTreeIndex` uses these B+ tree operations: `get`, `set`, `delete`, `clear`,
`minKey`, `maxKey`, `forRange`, `nextHigherPair`, and `nextLowerPair`. The
trim removes vendored `sorted-btree` features that nothing calls: `editRange`,
early-break callbacks, callback counters, in-place value edits, the `overwrite`
flag, and reused result arrays. It also removes the right-sibling shift in
`BNodeInternal.set`, which cannot run (see "Unreachable shift" below). `has()`
and the `get()` fallback stay because the Map oracle observes membership
through them.

The change is intended to preserve behavior. It does not change the behavior
of a comparator that returns `NaN`. That existing defect is tracked in
[#1945](https://github.com/TanStack/db/issues/1945).

Full `@tanstack/db` entry, esbuild minified, db-ivm inlined:

| Revision | min | gzip | brotli |
| --- | ---: | ---: | ---: |
| `ae2eb3fb` | 376,495 | 106,289 | 90,043 |
| `067fbd94` | 375,072 | 105,834 | 89,692 |
| Δ | −1,423 | −455 | −351 |

## Contract, path, and limits

The owner is `packages/db/tests/btree-map-oracle.test.ts`. Its contract: for
numeric keys, the B+ tree is a Map whose traversal and neighbor operations use
numeric key order. The model is an independent `Map` plus a sort. It does not
use the tree's nodes, search, or traversal code.

Before this change, law 2 checked only a full scan with `includeHigh: true`.
`BTreeIndex.rangeQuery` calls `forRange(from, to, toInclusive, …)` with
arbitrary bounds and both `toInclusive` modes. This change extends law 2. After
each checked cut, the refinement check scans five bound pairs, each with
`includeHigh` true and false:

- a window around the probe that starts and ends between keys;
- the point range `[probe, probe]`;
- a reversed pair (`low > high`), which must be empty;
- the second and second-to-last model keys, which exercise the inclusive and
  exclusive edges on existing keys;
- the first model key as a point range.

Each scan must return exactly the model keys in `[low, high]`, or in
`[low, high)` when `includeHigh` is false, once each, in order, with the
modeled payloads. The observation records every visited key. Duplicates,
omissions, and order changes are therefore visible.

Limits:

- Keys are integers from 0 to 199, and node sizes are 4 to 8. The oracle does
  not cover custom collation. The ordered-acquisition and index refinement
  owners cover that.
- The oracle does not check balance, depth, or space. Node merging is not
  observable through the Map contract. See N4 below.
- Comparators are consistent. Inconsistent comparators, including ones that
  return `NaN`, are outside this law (#1945).

## Unreachable shift

`BNodeInternal.set` chooses `i = min(indexOf(key, 0), children.length - 1)`.
That is the first child whose max key is at least `key`. An internal node keeps
`keys[j] === children[j].maxKey()`. The removed right-sibling shift required
`cmp(child.maxKey(), key) < 0`. With a consistent comparator, that is true
only when `i` was clamped to the last child, and the last child has no right
sibling. Upstream `sorted-btree@1.8.1` has the same selection line and the same
unreachable branch. A non-transitive comparator can reach the branch. Without
the branch, the insert splits the full child instead of shifting an entry. The
tree stays valid, and Map observations are unchanged.

## Grammar controls and calibration

The change adds observations to the existing refinement check. It adds no new
generator. The existing histories reach the new checks at every cut in the
fixed long campaign (every 97 steps and at the end), in every cut of the
fast-check property, and in the dense growth, retirement, and reuse cases.

- **Reconstruction:** each named wrong design below is reached by the existing
  histories and rejected at a range cut.
- **Range:** empty trees use probe-derived bounds, because `sorted[1]` and
  `sorted.at(-2)` are undefined there. One-key trees make the edge pairs
  coincide.
- **Exclusion:** the reversed pair checks that `low > high` yields no keys.

### Source mutants on unchanged production (`ae2eb3fb` BTree)

Each mutant ran against the original oracle and the extended oracle. The source
was restored after each run.

| Mutant | Original oracle | Extended oracle |
| --- | --- | --- |
| M1: public `forRange` passes `includeHigh: true` | survived (9/9 passed) | assertion failure (8 tests) |
| M2: leaf ignores `includeHigh` | survived | assertion failure (7 tests) |
| M3: leaf scan starts at the leaf's first key, ignoring `low` | survived | assertion failure (7 tests) |
| M4: a `low === high` leaf scan also includes the next key | assertion failure (8 tests) | assertion failure (8 tests) |

### Source mutants on the trimmed tree

These ran against the extended oracle plus `btree-index-work.test.ts` and
`btree-index-undefined-values.test.ts`. They ran on the trimmed tree before the
point-range shortcut was restored and before the right-sibling shift was
removed. Neither later change touches the mutated lines.

| Mutant | Outcome |
| --- | --- |
| N1: leaf delete splices keys but not values | assertion failure (1 test) |
| N2: leaf delete does not update the size | assertion failure (7 tests) |
| N3: leaf scan ignores `includeHigh` | assertion failure (8 tests) |
| N4: internal delete skips `tryMerge` | survived: equivalent within the Map domain |
| N5: internal delete keeps empty children | assertion failure (6 tests) |
| N6: no root collapse after delete | assertion failure (5 tests) |

N4 changes balance, not the Map relation. It belongs to performance evidence,
not to this law.

### Executable controls

`rejects a range scan that ignores includeHigh` and
`rejects a range scan that ignores the low bound` wrap the real `forRange`. Each
wrapper keeps the full scan correct, so only the new range checks can reject
it. The expected error must name a `forRange(low, high, includeHigh)` cut.
As a sanity check, replacing the `includeHigh` wrapper with an honest
pass-through made that control fail, because the refinement check no longer
threw.

## Performance

An A/B harness ran the base and trimmed trees on identical deterministic
workloads: bulk insert, get, overwrite, delete, range scans in both
`includeHigh` modes, full scans, neighbor walks, and churn. It used 1k, 20k,
and 200k keys, 15 to 41 interleaved rounds, and median times. An A/A run of the
base tree against a copy of itself measured a noise band of about ±2% to ±4.5%.

- The first trim was 5% to 9% slower on delete and churn at 20k to 200k keys.
  The cause was the removed single-search path for point ranges. The trim now
  keeps that path in the leaf and internal `forRange`.
- After that, raw point operations remained 3% to 5% slower in both slot
  orders, although their code is logically unchanged. Small range scans were
  faster.
- At the `BTreeIndex` level (add, update churn, remove, `eq` lookup,
  `rangeQuery`, `take`/`takeReversed`, at 20k and 100k rows), every workload was
  within ±4%. The sign changed when the slots were swapped. No index-level
  regression was measurable.

The harness is not checked in.

## ORC-001 through ORC-012

| Requirement | Result |
| --- | --- |
| ORC-001 | The oracle's opening comment states the Map contract, the four laws, and the extended law 2. This record states the limits above. |
| ORC-002 | Expected range results come from filtering the sorted model keys. The model does not import tree search or traversal. |
| ORC-003 | The contract, model (`stepModel`), histories, production driver (`stepTree` and the public `BTree` API), and refinement check (`expectRefinement`, `expectRange`) are visible in the oracle file. |
| ORC-004 | No generator changes. Reconstruction, range, and exclusion for the new observations appear above. Ablation: each bound pair targets a distinct edge, and M1 to M3 show that the partial and edge pairs are necessary. |
| ORC-005 | Every check calls the public `BTree` methods that `BTreeIndex` calls, and compares exact ordered keys and payloads at each cut. |
| ORC-006 | Source mutants and executable controls, with outcome classes, appear above. |
| ORC-007 | Existing gap, not changed here. The fixed LCG campaign and the fast-check property are different properties, so they do not form the fixed-and-random parity pair. The fast-check lane has no documented seed and path replay interface. This change only adds checks to the shared refinement check. |
| ORC-008 | The model state does not change. |
| ORC-009 | Model terms (put, delete, read, clear, range) map directly to `BTree` methods. |
| ORC-010 | The fixed campaign wraps failures with the law name, seed, round, node size, and history, and keeps the original cause. Range failures name the failing bounds. No external resources are acquired. |
| ORC-011 | No shared semantic fault calls for a second formulation. The Map model is already structurally independent. |
| ORC-012 | This record ties the reviewed revision, outcome classes, controls, limits, and performance evidence to the coverage map. |

## Verification

On `067fbd94`, the following passed:

- `packages/db` Vitest, typecheck off: 191 files, 6,821 tests.
- `pnpm test:oracles`: 48 files, 2,831 tests.
- `pnpm test:minified-db`: 98 error names, index metadata, query rows, and live
  updates.
- `packages/db-sqlite-persistence-core`: 340 passed, 1 todo.
- `tsc --noEmit -p packages/db`: no errors in `src` or in the changed test. The
  existing `tests/conformance` errors also occur on `ae2eb3fb`.

The environment was Node `v24.19.0` and Vitest `3.2.4` on Darwin arm64.

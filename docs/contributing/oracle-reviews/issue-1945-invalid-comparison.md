# Invalid index comparison review

Production/test head: the commit that adds this record.
This record is a documentation-only follow-up to that head.

## Law and boundary

A custom index comparator must return a number that is not `NaN`. A comparator
that returns `NaN`, a boolean, or any non-number cannot order the index's
storage. Per `AGENTS.md` ("Separate Valid Edge Cases from Contract
Contradictions"), a broken comparator is a caller programming error, so the
index crashes: the operation that receives an invalid result throws. `NaN`
values ordered by the default comparator remain valid and supported.

`makeCheckedComparator` in `packages/db/src/utils/comparison.ts` wraps a
user-supplied `compareFn` and throws a `TypeError` on any result that is not a
non-`NaN` number. `BaseIndex` builds every index's comparator through it, so
both `BasicIndex` and `BTreeIndex` share one enforcement point. Because the
comparator now guarantees a valid order, the vendored B+ tree no longer needs
its own `NaN`/invalid-result branch, and the post-split child placement follows
the already-known insertion index instead of a redundant comparison. Net
production code shrinks.

The index owner (`packages/db/tests/index-update.property.test.ts`) states the
refinement law: for each index type, comparator, accepted numeric prefix, and
probe operation, the operation throws exactly when it receives an invalid
comparison result, and never when every comparison it makes is valid. The
model counts invalid results independently of the production check. An empty
prefix is included: the first write compares nothing and must succeed, and the
next comparing operation must throw. The BTree Map owner
(`packages/db/tests/btree-map-oracle.test.ts`) keeps two split histories that
prove split placement does not consult a post-mutation comparison.

A rejected index `add` or `remove` throws before it changes the index, so the
index still refines its accepted rows. Index `update` and `build` are not
atomic. `createIndex` builds before it registers the index, so a failed build
never reaches a collection.

### Collection boundary

An external review showed that the first version of this change was worse than
`main` at the Collection boundary. The Collection writes rows before it
updates indexes and publishes change events. An index throw between those
steps left rows that subscribers were never told about, while the collection
stayed usable and reported the write as failed. That is the partial success
`AGENTS.md` forbids. `main` stored and published those rows; only its index
order was wrong.

The repair crashes the collection. `CollectionIndexesManager.updateIndexes`
calls the existing `lifecycle.markError` and rethrows. The collection status
becomes `error`, and the next mutation throws `CollectionInErrorStateError`.
No recovery path, generation, or rollback is added. The index owner states
this law for both index types and both write paths (optimistic insert and sync
commit).

Remaining limits:

- A sync source can still begin and commit writes on a collection in `error`
  state. Those rows are stored but not published. This is existing
  `markError` behavior for any crashed collection, not specific to comparators.
- A user who relied on `main`'s silently misordered index now gets a crashed
  collection at the first invalid comparison. The changeset states this.
- Comparator transitivity is not validated.

## Conformance evidence

| Requirement | Outcome |
| --- | --- |
| ORC-001 | The index comparator contract and `AGENTS.md` fail-fast policy supply the law; the limits above bound it. |
| ORC-002 | The refinement model counts invalid comparator results with its own recording wrapper. It does not call `makeCheckedComparator` or any production classifier. |
| ORC-003 | The opening comment states the law and limits; the probe/comparator/prefix tables supply inputs; public `add`/`update`/`lookup`/`take`/`build` drive production; the recording step judges throw-vs-success. |
| ORC-004 | Bounded enumeration crosses two index types, three comparators, seven probe operations, and seven prefixes including the empty prefix. The empty prefix reconstructs the first-write-never-compares case. The `signed infinity` comparator is the marginal valid case; it must never throw. |
| ORC-005 | Public index entry points execute, and the Collection cells drive `collection.insert` and a sync `commit`. Observations: throw vs. success, accepted-row refinement after a rejected add/remove, and collection status plus the next mutation after a rejected write. |
| ORC-006 | On unmodified `origin/main`, the BasicIndex law and the reported-string case fail (85 cases). Mutants that leave either index's comparator unchecked, that reject only `NaN` (accepting booleans), or that also reject infinite results each fail at the intended checkpoint. All were classified as assertion failures. |
| ORC-007 | These are bounded enumerations, not an important generated property; no fixed/random campaign parity is required. The package's existing generated index campaign is unchanged. |
| ORC-008 | No stateful reference model is introduced; the check recomputes throw-vs-success per operation. |
| ORC-009 | Accepted rows and index operations retain existing vocabulary. |
| ORC-010 | Checks are synchronous and retain no resources. |
| ORC-011 | Both index types run through the same law, distinguishing an index-type-specific fault from a shared one. |
| ORC-012 | This record names the reviewed head and each applicable outcome. It makes no universal bug-class closure claim; the sync-writes-after-crash limit above stays open. |

## Mutant kills (recorded at review time)

Run: `vitest run tests/index-update.property.test.ts -t "invalid comparator results|NaN keys|reported string"`.

| Mutant | Result |
| --- | --- |
| `origin/main` production (no check) | 85 assertion failures (all BasicIndex; BTreeIndex passed the law but not the error class). |
| BTreeIndex comparator unchecked | 84 assertion failures. |
| BasicIndex comparator unchecked | 84 assertion failures. |
| Check rejects only `NaN`, accepts booleans | 84 assertion failures. |
| Check also rejects `±Infinity` | 82 assertion failures (the `signed infinity` valid control now throws). |
| Shipped fix | 0 failures. |

Collection and atomicity cells, run with `-t "invalid comparator|rejected remove"`:

| Mutant | Result |
| --- | --- |
| PR head before this repair | 12 assertion failures: 4 Collection cells (status stayed `ready`), 6 BasicIndex add cells, 2 remove cells. |
| `updateIndexes` rethrows without `markError` | 4 assertion failures (Collection cells). |
| BasicIndex add writes `valueMap` before its sorted search | 6 assertion failures. |
| BTreeIndex remove changes maps before the tree delete | 1 assertion failure. |
| Shipped fix | 0 failures. |

The full `@tanstack/db` suite passes: 223 files, 7,429 tests, no type errors.
Production code is net negative against the merge base. Tests and this record
grow separately.

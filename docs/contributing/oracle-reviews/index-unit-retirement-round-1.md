# Index unit-test retirement: two-block ledger

Base: `f6857fee9de59dc82cbe596ca7df4a18152004ed` (`origin/main` at worktree creation).
This ledger names the exact legacy assertions proposed for retirement. The
receiving owner is `packages/db/tests/index-update-oracle.property.test.ts`.
The other blocks in each legacy file remain outside this change.

## Upper-only range ignores an absent lower bound

- **Legacy source:** `packages/db/tests/btree-index-undefined-values.test.ts`,
  `should not drop the minimum key when an upper-only range is exclusive on
  the (absent) lower bound` (original line 252). It inserts values 1, 5, 10,
  calls `rangeQuery({ to: 10, fromInclusive: false })`, and requires all three
  keys. Its observation is the returned direct BTreeIndex set.
- **Law and authority:** An absent bound denotes the start of the index
  (`packages/db/src/query/live/ARCHITECTURE.md`, Identity); the documented
  `IndexInterface.rangeQuery` accepts separate bounds and inclusivity flags.
  An inclusivity flag cannot exclude a value at a bound the caller did not
  supply. This law says nothing about internal tree traversal or runtime cost.
- **Independent model and history:** The receiving oracle's source `Map` keeps
  key/value ownership. For every upper bound -2, 0, 2, it filters the Map with
  `value <= upper`; it makes no lower comparison for an absent lower bound.
  Paired reads with an explicit exclusive `from` require `value > lower`,
  preserving the distinction stated in the old test's comment.
  The existing fixed and random campaigns apply add, same-key update, delete,
  and full build to both BasicIndex and BTreeIndex, then check the upper-only
  and explicit-bound reads after each action, including empty and
  changed-minimum states.
- **Distinction and checkpoint:** A design that applies
  `fromInclusive: false` to the implicit minimum drops a modeled key. The
  comparison checks the exact returned set after each direct index action.
  One wrong-output control removes the minimum from the upper-only read;
  another adds the excluded boundary to an explicit-bound read. Both must
  fail their intended comparison.
- **Retirement gate:** The new owner and both wrong-output controls passed.
  `/root/review_absent_bound` attacked the original and revised claims,
  executed the model and controls, and found no blocking survivor in the
  bounded numeric scope. The named legacy block was removed; its sibling
  blocks remain.

## Comparator-equal update moves exact membership

- **Legacy source:** `packages/db/tests/index-update-short-circuit.test.ts`,
  `does not use comparator equality to skip an update` (original line 91).
  With a case-insensitive comparator, it changes one key from `A` to `a` and
  checks that exact `A` lookup becomes empty and exact `a` lookup owns the key.
- **Law and authority:** An ordered index keeps separate exact equality
  buckets for values at one comparator position
  (`packages/db/src/query/live/ARCHITECTURE.md`, Identity; the existing
  comparator-group index oracle). Comparator equality alone does not authorize
  skipping a source value replacement. This does not promise bucket object
  identity or prohibit harmless maintenance work.
- **Independent model and history:** A source `Map` retains exact strings;
  fixed input facts put `A/a` in one order group and `B/b` in another. The
  receiving oracle checks both `equalityLookup` and `lookup('eq')`, plus
  comparator-group range sets, after each direct action on BasicIndex and
  BTreeIndex. The fixed trace updates a singleton `A → a → A` before adding
  peers, then checks populated same-group and cross-group updates. Its
  existing fixed/random
  custom-comparator property now also replaces an object with a fresh object
  in the same group before crossing to another group. The group IDs and exact
  object handles are input facts, not production classifications.
- **Distinction and checkpoint:** A wrong design that skips a comparator-equal
  `update` leaves the old exact lookup populated at the returned-action cut.
  A singleton no-op update control must fail the same source-Map comparison.
  A second control makes `lookup('eq')` return the comparator group while leaving
  `equalityLookup` intact; it must fail as well. The fixed string trace
  preserves the original value-domain and lookup-dispatch path; the generated
  object lane probes the general distinction after representative retirement.
- **Retirement gate:** The string and generated witnesses and both controls
  passed. `/root/review_equal_update` found two gaps in the first draft: it
  checked only `equalityLookup`, and it updated only a populated index. The
  revised witness exercises `lookup('eq')` and the original singleton path;
  the reviewer re-ran the relevant cases and found no remaining blocker.
  The named legacy block was removed; its sibling blocks remain.

## Execution and workflow result

The post-retirement run of the receiving oracle and both remaining legacy
files passed: 397 tests, zero type errors. Before retirement, the same three
files passed with both old blocks present. The new numeric and string controls
deliberately inject wrong returned results or skipped work and each reaches an
assertion failure at the intended public observation. No production defect was
demonstrated in these two blocks, so production code was not changed.

This round exposed two useful review gates for the broader cleanup. A
same-group update on populated data did not cover the original singleton
history, and checking `equalityLookup` did not cover `lookup('eq')` dispatch.
Both gaps survived the author's first green run and were found by an
independent reviewer. The generated object fixture also initially reused a
retired key; distinct reuse keys repaired that model-fixture error before the
final run. Future blocks should record the exact public method, smallest
state, old comment's law, and a wrong-design control before deletion. A
passing test count by itself is not a retirement gate.

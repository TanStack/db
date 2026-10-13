# Signed zero under a custom index comparator

The direct IndexInterface contract permits a numeric custom comparator.
JavaScript `Map` equality treats `-0` and `+0` as one exact lookup class, while
a callback can distinguish their order. For this PR, the maintainer chose
per-row callback order inside a query-equality class. The index refinement
oracle supplies independent rank labels for `-0`, `+0`, and `1`, then checks
exact lookup, full ordered take, a bounded range, and a cursor after `add` or
`build`. It removes the negative row and checks the surviving class and order.

The unmodified BasicIndex ordered-bucket `Map` used SameValueZero keys for the
callback positions. Both new add/build histories returned `positive` twice
and omitted `negative` at `takeFromStart`; BTreeIndex passed both controls.
BasicIndex now encodes negative zero separately for its private ordered-bucket
key, while exact membership keeps the ordinary `Map` key. All four new
histories and the full 416-test index refinement owner pass with no type errors.
The independent rank model is supplied by the fixture, not copied from either
index. This fixed witness covers only the stated signed-zero callback and
direct operations; arbitrary callbacks, public order selection, and provider
paths remain separate.

## Exact-commit hostile review and follow-up

At `c4c07da42`, a fresh reviewer found three legal histories the first
witness missed. Both index types skipped ordered maintenance for `-0 → +0`
because SameValueZero treats the positions as equal, even though the callback
does not. BTreeIndex could then keep a stale ordered bucket after update,
remove, and re-add. BTree range traversal also used JavaScript `===` to
collapse distinct signed-zero bounds at leaf and internal nodes; a 33-row
fixture reached the split-tree case.

The extended direct oracle uses an independent source Map and a supplied
numeric rank to predict membership and order after sign-changing updates,
removal, and re-addition. It checks exact SameValueZero lookup, ordered takes,
cursors, and inclusive, exclusive, reversed-bound, and point ranges on both index
types; the split case crosses BTree children. Four focused cases failed on
the old production at the intended ordered or range comparison. Changing
only the BTree point-range shortcuts left the two update cases red. Ordered
maintenance now uses `Object.is` in both indexes; the BTree shortcuts use it
to recognize only identical bounds. The index/BTree owner passed 436 tests
with no type errors after repair. The five lint warnings were preexisting.

## Oracle guide audit

| Requirement | Evidence and limit |
| --- | --- |
| ORC-001 | The direct index contract accepts a numeric callback. The maintainer selected per-row callback order within a SameValueZero exact class; the architecture's comparator-group law requires every row to survive ordered traversal. |
| ORC-002 | A source Map records owners and raw values. Fixture ranks predict order independently of index buckets and traversal code. The callback itself is the input contract, not an imported production comparator. |
| ORC-003 | Prose beside the source model, actions, driver, and assertions states the law, legal history, direct path, observations, and after-action comparison. |
| ORC-004 | Not triggered: the sign-changing and split-tree histories are fixed witnesses, not a generated grammar claim. |
| ORC-005 | Both real index types return exact sets, ordered arrays, cursor arrays, and range sets after each action. Those recordings expose missing, duplicate, and misplaced rows. |
| ORC-006 | Four new cases failed on the pre-repair code at intended take or range comparisons; the BTree-only fix left the update cases red. |
| ORC-007 | Not triggered by these fixed witnesses. Other generated index properties keep their own campaigns. |
| ORC-008 | The Map retains each owner's raw sign because a later update or removal can distinguish `-0` from `+0`; merging those states would lose the next ordered observation. |
| ORC-009 | Model ownership maps to indexed row keys. Model rank is a fixture abstraction of callback position, separate from exact SameValueZero membership. |
| ORC-010 | Direct indexes own no external resources or cleanup action; an assertion is the failure checkpoint. |
| ORC-011 | The source Map and fresh rank sort differ from the incremental indexes. No plausible shared semantic fault within this bounded callback remains identified; arbitrary callback laws remain open. |
| ORC-012 | This record names the counterexamples, RED/GREEN sequence, scoped claim, and pending final review. |
| ORC-013 | `-0` and `+0` share exact lookup but have distinct callback positions; inclusive versus exclusive and reversed mixed-sign bounds reject a SameValueZero range rule. The signed-zero checker does not directly call `rangeQueryReversed`. |
| ORC-014 | No provider or host handoff is claimed. |

At `ae0b67fd2`, a fresh hostile reviewer found no blocker in the declared
direct-index scope. The 420-test focused oracle and targeted generated replays
passed. Independent bounded histories matched BasicIndex and BTreeIndex for
signed-zero exact lookup, order, cursors, and forward range queries. The
reviewer also noted that part of the broader numeric property inspects private
layout, while separate public method checks protect the transferred behavior.
Arbitrary callbacks and public planner selection remain outside this verdict.

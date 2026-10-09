# Draft revert after replacing a nested object

Reviewed source: branch `fix-proxy-revert-changed-key`, based on `origin/main`
`fe284ccbd`. The commit that adds this record is the reviewed head.

## Contract and evidence

A draft reports a key as changed only when the key's final value differs from
its original under draft equality. The authority is the revert law in the
opening prose of `packages/db/tests/proxy-revert-oracle.property.test.ts`: "a
write that makes a value structurally equal to its original again is a revert,
and a fully reverted draft reports no change." A native mutator method (`push`,
`set`, `reverse`) marks a value changed without a revert check; the
native-operation owner, `proxy-native-methods-oracle.property.test.ts`, owns
that law.

The random campaign of the revert oracle failed on `main` with seed
`-266044985`, path `163:0:2:3`, in the nested round-trip property. The shrunk
history is:

1. Original row `{ f: { a: 0 } }`.
2. `draft.f = {}`.
3. `draft.f.a = 0`.

`getChanges()` reported `f`, although the final `f` equals the original. The
nested proxy for the replaced object compared the nested write with its own
snapshot (`{}`), not with the row's original, and marked the edge `f` as
assigned. The root then reported every assigned key without a value check. The
production code failed; the model and the law were correct.

The fix makes `getChanges()` compare an assigned key with the original row,
unless a native mutator changed that key or the key is absent from the
original. A tracker records which keys a native mutator changed; an assignment
to the key clears that record. `withFlatChangeTracking` compares each final
field with the original, so it does not have this defect.

The fixed campaign did not reach the failing history, because the round-trip
grammar replaced the field only through random intermediate operations. The
grammar now has a `replace` mode that assigns a new object without `a` and then
restores `a` through a nested write.

## Results

| Check | Original code | Fixed code |
| --- | --- | --- |
| Pinned: replaced object restored by a nested write | Fails (`expected [ 'f' ] to deeply equal []`) | Passes |
| Pinned: replaced object restored, symbol key kept | Fails | Passes |
| Nested round trips, fixed seed `2026101` | Fails with the `replace` mode | Passes |
| Nested round trips, random | Fails | Passes |
| Proxy suites (`tests/proxy*`, revert oracle) | 4 failures | 478 passed, six consecutive runs |

## Mutants

| Mutant | Outcome |
| --- | --- |
| Report every assigned key without a value check (the original code) | Assertion failure: both pinned cases and both round-trip campaigns |
| Compare an assigned key after converting a Set to an array | Assertion failure: pinned case "an array replaced by an empty Set is a change" (the random partial-revert campaign also catches it) |
| Ignore the native-mutator record | Assertion failure: pinned case "reversing [-0, 0] is a change although the result is draft-equal" (the random typed-array campaign also catches it) |
| Remove the `hasOwn` check for an assigned object | Removed from the fix: equivalent within the domain, because an object never equals an absent value |

## ORC-012 requirement audit

| Requirement | Outcome |
| --- | --- |
| ORC-001 | Applicable. The law and its authority are above. The claim is limited to `getChanges()` of `createChangeProxy` drafts. |
| ORC-002 | Applicable. The expected changes come from the revert oracle's spec model, which applies operations to plain-data specs and never reads a draft. |
| ORC-003 | Applicable. The revert oracle's opening prose states the law, the model, the grammar, and the checkpoint. The `replace` mode has a comment beside its generator. |
| ORC-004 | Applicable. The new mode reconstructs the failing history in the fixed campaign. The pinned cases cover the shrunk history and a variant with a symbol key. |
| ORC-005 | Applicable. The driver writes through the production draft and reads `getChanges()`, the public observation. |
| ORC-006 | Applicable. The mutant table above classifies each mutant. |
| ORC-007 | Applicable. The revert oracle runs a fixed seed and a random campaign with direct replay through `TANSTACK_DB_PROXY_REVERT_SEED` and `_PATH`. |
| ORC-008 | Inapplicable. The model is a spec state with no new state. |
| ORC-009 | Applicable. "Native mutator" means a method call that the draft forwards to the value (`createModifyingMethodHandler`, Map and Set `set`, `add`, `delete`). A read under a frozen key is not one: it records the key as assigned, so the value check decides. |
| ORC-010 | Applicable. The drafts hold no resources, and failures report the history and the observation. |
| ORC-011 | Applicable. The native-operation owner is a second formulation for the native-mutator exception, and it caught the first fix. |
| ORC-012 | This record. |
| ORC-013 | Inapplicable. No threshold law. |
| ORC-014 | Inapplicable. No controlled provider. |

## Follow-up review: native writes mixed with assignments

A review of the fix found two cases where the native-mutator record outlived
the value it described. Both also fail on `main`.

1. A native write that an assignment replaces could leave its mark on an
   ancestor. After `draft.f.arr.pop()`, `draft.f.g = {}`, `draft.f.arr = [0]`,
   and `draft.f.g.a = 0` on `{ f: { arr: [0], g: { a: 0 } } }`, the root
   still held a native mark for `f` and reported it. The assignment cleared
   the mark on `f`, but not the root's mark that stood for it.
2. A mutator called through a handle that the callback had replaced marked
   the parent's edge native, although the edge no longer held that array.

The fix keeps the design. A native mark propagates only along edges that
still hold the child, and clearing the last mark under an edge clears the
ancestor marks above it. A read under a frozen key now records the key as
assigned without a native mark, so a read that writes nothing reports no
change, and a write through the raw copy is still found by the value check.

Why the oracles missed these: the revert grammar wrote only by assignment
and delete, so it never reached a key a native mutator had changed, and the
native-methods oracle calls one method on a fresh row, never mixed with
assignments, nested replacement, or retained handles. The law was right; its
grammar did not reach the histories. The revert oracle's last block now
generates array mutators mixed with assignments, a nested object, and a
retained handle, and pins three histories one and two levels deep. A
focused case nests the native site three levels deep. The frozen-key table
gains an object read.

| Check | `main` | `e3178d2a6` | Fixed code |
| --- | --- | --- | --- |
| Native histories, fixed seed `2026101` and random | Fail | Fail | Pass |
| Pinned: native write restored by an assignment | Fails | Fails | Passes |
| Pinned: mutator through a detached handle | Fails | Fails | Passes |
| Pinned: restoring the last native write clears every ancestor | Fails | Fails | Passes |
| Native write three levels deep restored | Fails | Fails | Passes |
| Object read under a frozen key | Fails | Fails | Passes |

| Mutant | Outcome |
| --- | --- |
| Clear only the nearest ancestor's mark | Assertion failure: the three-level case |
| Never clear ancestor marks | Assertion failure: both native campaigns and the ancestor pinned case |
| Propagate a native mark past a replaced edge | Assertion failure: both native campaigns and the detached-handle case |
| Mark an edge that no longer holds the child | Assertion failure: the fixed native campaign, the detached-handle case, and a detachment test |
| Mark a frozen-key read native | Assertion failure: the frozen object read |
| Record nothing on a frozen-key read | Assertion failure: freeze or fix a key, then a nested write |
| Keep the native mark when `checkParentStatus` removes a reverted edge | Survives, so the fix does not add that clearing. The path runs only after the child has reverted, which already cleared the child's marks, so a stale ancestor mark can only report an equal value under a native write the model still treats as live. The native Limits permit that report. |
| Convert Sets to arrays on the alias comparison | Equivalent: an unassigned key holds a copy of its original, so both sides are Sets and draft equality already compares them in order. The fix removes the conversion. |

Open, recorded rather than decided:

- An assignment of a value draft-equal to the current one is a no-op, so a
  handle taken before it stays attached and a later mutator through it changes
  the row. Native JavaScript would detach the handle. The revert oracle's
  native model follows the set trap and declares this in its Limits.
- Draft equality treats `-0` as `0`, as `deepEquals` and the query `eq` model
  do. The native mark is what reports reversing a typed `[-0, 0]`. Replacing
  the mark with a sign-aware value check would also stop `push` then `pop`
  from reporting an equal array, and would make `draft.x = -0` over `0` a
  change. That is a law change, not part of this fix.

## Follow-up review: false negatives from the native mark (2026-10-09)

Reviewed head `c5880a308`. The review had eight findings, with runs against
this branch and `origin/main`.

**Decision.** A false positive (reporting a key whose value equals its
original) only repeats the stored value; the UI does not change. A false
negative loses a write. When correctness and code size trade off, this owner
leans toward false positives (maintainer decision, 2026-10-09).

**What the probes showed.** On `c5880a308`, six probes reported nothing
where `main` reports the key: a `[-0, 0]` typed array reversed through a
`Map.get` value, Map and Set iteration values, a `subarray` view, a frozen
draft, and a sibling revert after the reverse. Every one reorders signed
zeros, which draft-equality rule 1 calls equal, so none is a change under the
stated law. Each still shows a native write that the native mark did not
follow. With ordinary values, the branch reports these writes.

**Change.** The production fix is withdrawn. `src/proxy.ts` matches `main`
again, so `getChanges()` reports every assigned key, including a replaced
object restored through nested writes. That is a permitted false positive.
The laws now require every changed key and permit an extra report only for a
written key, with its final value:

- the generated and pinned histories check `reported ⊇ changed`, and that
  each extra key was written and reports its final value;
- the native block permits `f` whenever it equals its original;
- pinned witnesses require a real native write through a Map value, Map and
  Set iteration values, a typed-array view and a frozen draft to be reported,
  and a nested revert inside a Map or Set to keep the container's other write.

The frozen-key read test that this branch added is removed; on `main` such a
read reports the key, which the row law permits.

| Mutant on `main`'s proxy | Result |
| --- | --- |
| Report an assigned key only when it differs under draft equality | 14 proxy tests fail |
| Revert check by JSON, so Maps and Sets look equal | 4 proxy tests fail |
| Any Map or Set write counts as a revert | Equivalent: the parent re-checks the key by value |

| Finding | Verdict | Action |
| --- | --- | --- |
| 1. Handles that share a value lose the native mark | Confirmed mechanism; no change under rule 1 | The mark is removed with the fix. Witnesses use real writes. |
| 2. A frozen draft loses later native writes | Same as 1 | Same |
| 3. An element assignment erases a parent `reverse()` | Not reproduced with ordinary values | Removed with the fix |
| 4. A sibling revert cancels a native change | Same as 1 (signed zeros). `main` reports `{}` there too, which rule 1 permits | Same |
| 5. Stale native marks on ancestors | Mechanism of the fix | Removed with the fix |
| 6. A same-value `defineProperty` clears the mark | Mechanism of the fix | Removed with the fix |
| 7. Every assigned key is deep-compared | Cost of the fix | Removed with the fix |
| 8. Production code grows | Confirmed (+62/−28) | Now 0 lines |

**Limits.** Rule 1 stays: a reorder of signed zeros is not a change. Map and
Set mutators are still not generated together with assignments.


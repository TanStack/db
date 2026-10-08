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
| ORC-009 | Applicable. "Native mutator" means a method call that the draft forwards to the value (`createModifyingMethodHandler`, Map and Set `set`, `add`, `delete`, and a read-only object). |
| ORC-010 | Applicable. The drafts hold no resources, and failures report the history and the observation. |
| ORC-011 | Applicable. The native-operation owner is a second formulation for the native-mutator exception, and it caught the first fix. |
| ORC-012 | This record. |
| ORC-013 | Inapplicable. No threshold law. |
| ORC-014 | Inapplicable. No controlled provider. |

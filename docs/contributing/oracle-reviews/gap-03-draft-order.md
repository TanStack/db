# Draft native-order oracle review

Reviewed code head: `cac3b2b95cf8683177040eef2c3b0198c9a8deff`.
Source: `GAP-03` in the code-weight audit's `BUGS_AND_ORACLE_GAPS.md`.
This record reviews the test and coverage-map change at that head.

## Result

A draft reorder must retain the native iteration order of a Set or Map.
The test crosses two container kinds with replacement and clear-and-readd.
It checks the change patch after the callback and the public Collection row
once `update()` persists.

The original detachment owner passed 70 tests. A broad unordered Set mutant
failed one existing cyclic-back-reference test. Thus, the audit's claim that
this mutant survived every owner test is stale at the reviewed base.
A narrower unordered primitive Set mutant passed all 70 old tests. The new
Set replacement case rejected it because the `value` patch was missing.
An unordered Map mutant failed at the same checkpoint in the new Map case.
The changed owner passed 74 tests. Two existing RegExp cases rejected a
`lastIndex`-blind mutant: they observed position 1 instead of 2.

The review found no production bug on the current head. This PR adds a
bounded order witness. It does not claim all native values or histories.

## Guide check

| Requirement | Outcome |
| --- | --- |
| ORC-001 | The `proxy.ts` comment states the Set-order and RegExp-position rules. The detachment and iteration owners promise native Map snapshots. The Map check concerns public iteration order after a reorder. It does not define arbitrary Map key equality. |
| ORC-002 | A fresh native Set or Map computes the expected order. The test does not import the draft comparator. |
| ORC-003 | The oracle file states the law, native model, four-case grammar, production driver, observations, and checkpoints beside the test. |
| ORC-004 | Not triggered: the four cases are bounded enumeration, not a generated-history coverage claim. |
| ORC-005 | The test calls `withChangeTracking` and `Collection.update()`. It compares the patch and stored row at the stated checkpoints. |
| ORC-006 | Both unordered mutants failed at an intended patch assertion. The broad Set and RegExp mutants failed existing assertions. No mutant timed out or failed in setup. |
| ORC-007 | Not triggered: this is bounded enumeration, not an important generated property. |
| ORC-008 | Not triggered: the change adds no stateful reference model. |
| ORC-009 | Not triggered: the native reference adds no model-only subsystem term. |
| ORC-010 | No shrinking or capture occurs. The driver cleans its in-memory Collection in `finally`. This fixture does not inject cleanup failure. |
| ORC-011 | Not triggered: no plausible shared comparator fault was named for native iteration and the draft comparator. Replacement and clear-and-readd exercise adjacent paths. |
| ORC-012 | This record gives the outcomes and limits for the reviewed code head. No universal bug-class closure is claimed. |

## Audit disposition

- Set order: **fixed-now** as a test gap. The narrow unordered mutant was an
  old-suite survivor and is now rejected.
- Map order: **fixed-now** as a test gap. The new test checks native iteration
  after replacement and clear-and-readd.
- RegExp `lastIndex`: **already-fixed** in the existing owner. No duplicate
  test was added.
- Contract source: **already-fixed** for Set and RegExp in the `proxy.ts`
  comment. The Map claim stays limited to native iteration in the owner.

All four source items have a disposition. None has an evidence gap.
The coverage map still excludes general native-mutator and symbol-write
support. This test does not cover nested nonprimitive values or every Map key
class. No in-scope counterexample is known for the four tested histories.

## Reviewer assessment

The audit found a useful primitive Set-order gap and a useful Map case.
Its broad Set survivor count and RegExp gap were stale on this base.
The proposed test path was appropriate, but the report needed mutant runs
against the current head before it classified each claim. For this sample,
**hire: yes for issue discovery with a required reproduction gate**.

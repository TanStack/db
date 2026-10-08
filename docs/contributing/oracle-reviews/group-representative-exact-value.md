# Group representative work and exact-value choice review

Evidence by revision, on `perf-aggregate-representatives`:

- First campaign: tests `ef9d4dad4`, production change `9b021bbdc`. The RED
  results ran on `ea51b67b0` with the new tests.
- Review follow-up: tests `871bdea11`, production fix `e5449edc2`. The RED
  results ran on `9b021bbdc` and the GREEN and mutant results on `e5449edc2`.
  `f67789cd3` merges `origin/main` without changes to these files.

## Laws and authority

1. **Work law.** The work that a grouped aggregate does for one inserted or
   deleted member does not depend on the number of members that the group
   holds. The law applies to a `groupBy` aggregate and to an aggregate inside
   an include, which the compiler groups by its correlation route. Authority:
   incremental view maintenance. A count changes by the multiplicity of the
   delta, so the result does not need a re-read of each member.
2. **Route law.** One representative carries the whole correlation route.
   The route has two fields, `correlationKey` and `parentContext`. Members of
   one route share the correlation key instance and the parent context
   instance, so the representative's identity is the exact identity of those
   two instances. The first campaign used the parent context's equality
   identity instead, which does not distinguish exactly different parent
   values (review finding F4).
4. **Positive-contributor law.** A projected group value, and a `min` or `max`
   result, is an exact value that a currently positive member holds
   (`ARCHITECTURE.md`, "Value identity"). D2 consolidates contributions whose
   hashes match, its hash treats `-0` as `0` and equal Dates as one value, and
   a consolidated entry keeps the record of its latest change. Thus a
   contribution must carry the exact identity of every value it can supply.
3. **Group-value law (revised by a product decision).** When several members
   are equal under query equality but differ exactly, the projected value comes
   from the member with the smallest exact value:
   - another number before `-0`, and every primitive before an object;
   - objects by an explicit type tag: `Buffer`, `Date`, a Temporal type, then
     `Uint8Array`. The tags do not come from constructor names, so
     minification cannot change the order (review finding F7).

   `-0` and `NaN` are never equal under query equality, so their order is not
   observable. Members of one tag are equal in content, and any positive
   instance can be projected. The previous law selected the member with the
   smallest row key.

## Old and new predictions

The six cases in `group-by.test.ts` (`groups %s by query equality`, autoIndex
off and eager). Each case observes three checkpoints: both members present,
after the delete of row 1, and after the reinsert of row 1. Arrival order is
row 1, then row 2.

| Members (row 1, row 2) | Old prediction | New prediction |
| --- | --- | --- |
| `Date(0)`, `0` | Date, `0`, Date | `0`, `0`, `0` |
| invalid Date, `NaN` | Date, `NaN`, Date | `NaN`, `NaN`, `NaN` |
| `-0`, `0` | `-0`, `0`, `-0` | `0`, `0`, `0` |

The test now also runs each case with the members in reversed order. A
`Buffer` and a `Uint8Array` with the same bytes passed under the old code only
in the original order. In the reversed order, the old code projected the
`Uint8Array`.

## Evidence

- **Work law.** `group-by-work.test.ts` counts the Map and Set iterator steps
  in one synchronous commit, at 10, 100, 1,000 and 5,000 members. On
  `ea51b67b0`, a `groupBy` count took 157 steps at 100 members against 67 at 10
  members, and an include count took 219 against 129. On the branch, each count
  takes the same number of steps at every size: 55 and 117 in the probe runs.
  The published count is also checked at each size.
- **Route histories.** The same file deletes the member that arrived first,
  empties and refills a route, adds a null correlation key, moves a member
  between routes, and updates the parent. Each history checks the published
  count. The histories pass on `ea51b67b0` and on the branch, because the
  change keeps the result and changes only the work.
- **Group-value law.** The test model `smallestExact` orders values by kind and
  type name without production code. On `ea51b67b0`, 8 cells fail. For
  example, `expected 'date' to be 'number'`.

## Mutants

| Mutant | Outcome |
| --- | --- |
| Row key restored in the route representative | Assertion failure: the include work law (219 against 129) |
| Row key restored in the `groupBy` representative | Assertion failure: the `groupBy` work law and 6 group-value cells |
| Largest exact value selected | Assertion failure in 8 group-value cells |
| First member that arrived selected | Assertion failure in 8 group-value cells |

## ORC-012 requirement audit

| Requirement | Outcome |
| --- | --- |
| ORC-001 | Applicable. The three laws and their authority are above. The group-value law is a product decision of this change. |
| ORC-002 | Applicable. The expected counts come from the fixture sizes. The expected group value comes from the test model `smallestExact`, which does not use production identity or serialization. |
| ORC-003 | Applicable. Both test files state each law, its observation and its checkpoint before the assertions. |
| ORC-004 | Applicable to the finite matrices only. No generated grammar is claimed. The sizes 10, 100, 1,000 and 5,000 bound the work law. |
| ORC-005 | Applicable. The tests use the public live-query Collection and its published rows at the return of the commit. |
| ORC-006 | Applicable. The four mutants above fail at the intended checkpoints. |
| ORC-007 | Inapplicable. These tests are finite, not generated properties. |
| ORC-008 | Inapplicable. No stateful reference model changes. |
| ORC-009 | Applicable. "Iterator step" is a test observation, not a production concept. "Exact value" is the value relation that `ValueIdentity.exact` keeps, with Dates, binary arrays and Temporal values compared by type and content. |
| ORC-010 | Applicable, with a gap. Cleanup runs in `finally` blocks, so a cleanup error can replace an assertion error. |
| ORC-011 | Inapplicable. No shared fault was named. |
| ORC-013 | Applicable. The work law is a scaling law. Four sizes over two orders of magnitude separate a constant cost from a cost per member. |
| ORC-014 | Inapplicable. No controlled provider supplies a premise. |

## Review follow-up

A high-effort review of `9b021bbdc` raised ten findings. Probes and the
extended oracle confirmed the product defects:

| Finding | Verdict | Evidence on `9b021bbdc` | Disposition |
| --- | --- | --- | --- |
| F1 `min`/`max` returns a deleted row's value | Confirmed | Rows `0` and `-0`, delete `0`: `min` and `max` return `0`. On `main`: `-0`. Two equal Dates: the deleted row's instance. | Fixed: contributions carry the exact identity of each sum, avg, min, or max input |
| F2 projected value is a deleted row's instance | Confirmed | Two `Date(0)` instances, delete row 1: the deleted instance is projected | Fixed: the representative key holds the instance identity |
| F3 oracle compares only a type label | Confirmed | The F2 defect passed the old oracle | Fixed: the oracle requires a positive member's instance |
| F4 route identity uses parent equality | Evidence gap | An include aggregate cannot project a parent field, so no public observation was found. The mutant that restores the equality identity survives | Uses the parent context instance; recorded as unobserved |
| F5 Date and binary correlation keys never consolidate | Confirmed, accepted | Reference identity keeps distinct key instances apart | Limit below: correctness needs instance identity |
| F6 work law over-promises | Confirmed | Only identical inputs consolidate | The law, changeset and architecture text now state the scope |
| F7 order depends on constructor names and serialization | Confirmed by source | — | Fixed: explicit type tags |
| F8 binary contents serialized into each key | Confirmed | A 1 MiB group value is encoded twice per insert (12.6 MB); `main` encodes it once | Fixed: once, which is the group key's existing cost |
| F9 counter misses array walks | Confirmed by source | — | Fixed: the counter also counts array iteration and callbacks |
| F10 architecture text contradicted | Confirmed | — | Rewritten |

Measured with the investigation probe (`NODE_ENV=production`, an include
count over one issue, median per comment insert, two runs each):

| Comments | `main` `2c98b4992` | Branch `f67789cd3` |
| ---: | ---: | ---: |
| 10 | 0.109 / 0.125 ms | 0.168 / 0.162 ms |
| 100 | 0.096 / 0.095 ms | 0.129 / 0.113 ms |
| 1,000 | 0.175 / 0.153 ms | 0.098 / 0.108 ms |
| 5,000 | 0.557 / 0.439 ms | 0.101 / 0.091 ms |

The 10-comment size runs first in each process, so it includes warm-up.

Review mutants on `e5449edc2`:

| Mutant | Outcome |
| --- | --- |
| No exact-input identity (merged retraction kept) | Assertion failure, 4 tests |
| No instance identity in the group-value representative | Assertion failure, 4 tests |
| Binary contents in the order key | Assertion failure, 1 test (binary encoding) |
| Parent context equality identity in the route | Survived: no public observation (F4) |
| `NaN` ordered before `-0` | Equivalent: the two never share a group |

## Limits

- The work counter observes Map, Set and array iteration and array callbacks.
  A walk through an indexed `for` loop would not count.
- Contributions consolidate only when their representative keys and min or
  max inputs are identical. A min or max over distinct values, and an include
  correlated on Date, binary, or Temporal key instances, keep one contribution
  per distinct input or instance.
- The group key serializes a large binary group value's contents once per
  member. That cost predates this change.
- A `groupBy` over values whose exact identity is a reference, such as plain
  objects, still has one contribution per distinct object. Equality for those
  values is also by reference, so each such group holds one value.
- The fixed per-change overhead from #1740 is a separate cost and is outside
  this change.

## Medium review follow-up (2026-10-08)

Reviewed head `14d5cd49b`. Fix commits `8db25f3b0` (laws) and `b86aaa7e2`
(production). Ledger: `review-medium-ledger.md` in the task scratch notes.

- **Rebuilt min/max argument.** An inline subquery rebuilds projected objects
  each time it runs, so the retraction of a row carried a new argument
  instance. The min or max contribution was keyed by that instance and did not
  cancel its insert. RED on `14d5cd49b`: after inserting and deleting a row
  with `x: 7`, `max` stayed `7`. The base commit before this pull request did
  not have the fault. The identity now comes from the value the min or max
  compares (`minMaxInput`), and the work law keeps cycle work constant over
  300 insert and delete cycles.
- **Sum and avg** no longer carry exact inputs. Their reduce adds coerced
  numbers, so merging equal inputs cannot change the result.
- **Equal instances.** Among content-equal object group values, the member with
  the smallest row key supplies the instance. RED on `14d5cd49b`: when rows
  arrived as 2, 1, row 2's instance was projected. The choice no longer depends
  on arrival order.
- **Test model.** `exactRank` now matches the documented order: another
  primitive, then `-0`, then objects by type tag read with
  `Object.prototype.toString`.
- **Include work law** covers insert, an update that moves a member out and
  back, and delete.

| Mutant | Outcome |
| --- | --- |
| Exact input from the raw argument (`14d5cd49b`) | Assertion failure: `max` keeps the deleted value |
| No min or max exact inputs | Assertion failure, 4 tests |
| Instance token as the tie among equal objects (`14d5cd49b`) | Assertion failure: arrival order 2, 1 |
| Row key in the route representative | Assertion failure: include work law |

Not changed:

- A parent field in an include aggregate's select is not projected into the
  result on this commit or the base, so the route's parent context stays
  without a public observation.
- A min or max argument compiles twice per query, once for the aggregate and
  once for its exact input. This is a compile-time cost only.
- db-ivm merges hash-equal values by design. Choosing which instance remains
  needs per-instance state, which the compiler identity supplies, so the fix
  stays in the compiler.

# Group representative work and exact-value choice review

Evidence by revision, on `perf-aggregate-representatives` from `origin/main`
`ea51b67b0`: the RED results ran on `ea51b67b0` with the new tests, and the
GREEN and mutant results ran on the branch's production change.

## Laws and authority

1. **Work law.** The work that a grouped aggregate does for one inserted or
   deleted member does not depend on the number of members that the group
   holds. The law applies to a `groupBy` aggregate and to an aggregate inside
   an include, which the compiler groups by its correlation route. Authority:
   incremental view maintenance. A count changes by the multiplicity of the
   delta, so the result does not need a re-read of each member.
2. **Route law.** One representative carries the whole correlation route.
   The route has two fields, `correlationKey` and `parentContext`. Its exact
   identity is the exact identity of the correlation key and the parent
   context identity. The parent context identity contains the exact identity
   of each projected parent value. Thus two members with equal route identities
   have the same correlation key and parent values, and the route needs no row
   key to select one member.
3. **Group-value law (revised by a product decision).** When several members
   are equal under query equality but differ exactly, the projected value comes
   from the member with the smallest exact value:
   - a number before an object (a Date, a binary array, or a Temporal value);
   - an ordinary number before `-0`, and `-0` before `NaN`;
   - objects by type name, so `Buffer` before `Date` before `Uint8Array`.

   Objects of one type and content are one exact value, so either instance can
   be projected. The previous law selected the member with the smallest row key.

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

## Limits

- The iterator-step counter observes Map and Set iteration only. A re-read
  through array iteration would not count. The reduce operator reads its group
  through a Map, so the counter reaches the regression.
- A `groupBy` over values whose exact identity is a reference, such as plain
  objects, still has one contribution per distinct object. Equality for those
  values is also by reference, so each such group holds one value.
- The fixed per-change overhead from #1740 is a separate cost and is outside
  this change.

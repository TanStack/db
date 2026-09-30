# Invalid BTree comparison review

Production/test head: `ed3a4d3ebac54931c95f3ef04bae768d82e82ad5`.
This record is a documentation-only follow-up to that head.

## Law and boundary

The BTree comparator contract requires a negative, zero, or positive result.
`AGENTS.md` requires contradictory collaborator signals to fail at the boundary.
An encountered NaN comparison must throw instead of reporting a successful lookup or mutation.

The index owner enumerates accepted prefixes of 1, 4, 5, 32, 33, and 65 rows.
A custom comparator orders numeric values but returns NaN for the rejected string value.
After the rejected add, the independent Map remains unchanged.
The existing refinement check observes key count, exact membership, equality, ranges, and ordered entries.
A subsequent valid add and removal must still refine that Map.

The BTree Map owner crosses seven operations with six accepted-prefix sizes, using node size four.
The operations are set, get, has, delete, range scan, and both strict neighbors.
After rejection and a later valid put, existing Map refinement checks observe size, values, ranges, and neighbors.
Controls retain default-comparator NaN keys and valid signed-infinity comparison results.

This evidence covers encountered invalid comparisons, not arbitrary comparator-law validation.
No comparison occurs on an empty tree's first insertion.
Stateful comparator exceptions and index update/build rejection atomicity are outside this evidence.
The coverage map assigns the latter witness to the index owner.

## Conformance evidence

| Requirement | Outcome |
| --- | --- |
| ORC-001 | The comparator API and fail-fast policy supply the law; the limits above bound it. |
| ORC-002 | Expected accepted rows come from independent Maps and numeric sorting. The rejection law does not call production comparison helpers. |
| ORC-003 | Comments state the law and limits; tables supply the bounded inputs; public operations drive production; existing refinement helpers judge the unchanged Map. |
| ORC-004 | No new generated-history grammar. Finite enumeration covers declared prefix/operation cells and excludes empty-prefix comparisons. |
| ORC-005 | Public index add and seven tree entry points execute. Assertions run immediately after rejection and after valid continuation. |
| ORC-006 | On unmodified production, 48 cases fail at the required-throw assertion. This is an assertion failure, not a setup failure or timeout. The original silent-success design is rejected. |
| ORC-007 | No new important generated property; these additions are bounded enumerations. Existing generated campaigns remain unchanged. |
| ORC-008 | No model state is introduced, removed, combined, or split. The existing accepted-row Map remains the reference. |
| ORC-009 | Accepted rows and index operations retain existing vocabulary; no subsystem concept is combined or renamed. |
| ORC-010 | New checks are synchronous and retain no external resources or shrink machinery. |
| ORC-011 | No shared semantic-fault hypothesis requires a second formulation. Public-index and tree checks protect different entry boundaries. |
| ORC-012 | This versioned record names the reviewed production/test head and every applicable outcome. It makes no universal bug-class closure claim. |

The focused command passes 92 tests across the two owners after the repair.
Production shrinks by five lines; tests grow by 103 lines before this record.
The changeset records the new error for broken custom comparators.

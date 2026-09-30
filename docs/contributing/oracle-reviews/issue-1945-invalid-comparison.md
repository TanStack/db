# Invalid BTree comparison review

Production/test head: `778fe8dc48012c168c013ee5cdf3f53f68c92643`.
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

Six additional insertion histories reach a comparison before sibling redistribution.
Accepted-prefix sizes are 6, 7, 10, 11, 18, and 21, with even numeric keys and node size four.
Only the selected existing-key/new-key pair returns NaN.
The required throw, unchanged Map refinement, and valid continuation check rejection before mutation.

Two split histories start from 16 and 32 even-key entries.
Their deliberately invalid pair was used only by the redundant post-mutation comparison during insertion.
Child placement now follows the already-known insertion position, so that comparison is unnecessary.
After the insertion and a subsequent valid put, the Map owner checks inserted-key reads,
exact whole-range payloads/order, size, and extrema.
These fixtures do not promise point-query order for the deliberately invalid pair;
they establish preservation when the redundant comparison is removed.

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
| ORC-004 | No new generated-history grammar. Finite enumeration covers declared prefix/operation cells, six redistribution histories, and two split histories; it excludes empty-prefix comparisons. |
| ORC-005 | Public index add and seven tree entry points execute. Assertions run immediately after rejection and after valid continuation. Split witnesses observe inserted-key reads and whole ranges at both accepted-write cuts. |
| ORC-006 | On unmodified production, 48 cases fail at the required-throw assertion. On the first repair head `c944abec3a1c1e698371bb34d2c1770d7d85423e`, six additional cases fail at required rejection and two at exact payload/order observations. These are assertion failures, not setup failures or timeouts. The silent-success and misplaced-split designs are rejected. |
| ORC-007 | No new important generated property; these additions are bounded enumerations. Existing generated campaigns remain unchanged. |
| ORC-008 | No model state is introduced, removed, combined, or split. The existing accepted-row Map remains the reference. |
| ORC-009 | Accepted rows and index operations retain existing vocabulary; no subsystem concept is combined or renamed. |
| ORC-010 | New checks are synchronous and retain no external resources or shrink machinery. |
| ORC-011 | No shared semantic-fault hypothesis requires a second formulation. Public-index and tree checks protect different entry boundaries. |
| ORC-012 | This versioned record names the reviewed production/test head and every applicable outcome. It makes no universal bug-class closure claim. |

The focused command passes 100 tests across the two owners after the repair.
The full DB campaign passes all 223 files and 7,180 tests with no type errors,
using two workers and a 30-second timeout outside the Windows sandbox.
DB build and lint pass; lint retains two unrelated existing warnings.
Production shrinks by three lines; tests grow by 165 lines before this record.
The changeset records the new error for broken custom comparators.

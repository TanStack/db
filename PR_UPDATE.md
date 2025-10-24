# PR Title
fix: validate against duplicate collection aliases in subqueries

# PR Body

## Summary

Fixes a Discord bug where using the same collection alias in both a parent query and subquery causes empty results or incorrect aggregation values.

## Problem

When both parent and subquery use the same alias for a direct collection reference:

```typescript
const locksAgg = q
  .from({ lock: c.locksCollection })
  .join({ vote: c.votesCollection }, ...)  // Uses "vote"

return q
  .from({ vote: c.votesCollection })  // Also uses "vote" directly
  .join({ lock: locksAgg }, ...)
```

**Result:**
- Empty query results
- Incorrect aggregation (values from individual rows instead of aggregates)

**Root Cause:** Both queries share the same input stream, causing interference.

## Solution

Added validation that throws a clear `DuplicateAliasInSubqueryError` when this pattern is detected.

**Implementation:**
- New error type with helpful message suggesting to rename the alias
- `collectDirectCollectionAliases()`: Identifies conflicting aliases
- `validateSubqueryAliases()`: Validates before compiling subqueries
- Only validates DIRECT collection references (allows legitimate subquery wrapping)

**User Fix:**
Simply rename the alias in either the parent or subquery:

```typescript
const locksAgg = q
  .from({ lock: c.locksCollection })
  .join({ v: c.votesCollection }, ...)  // Renamed "vote" to "v"

return q
  .from({ vote: c.votesCollection })  // No conflict
  .join({ lock: locksAgg }, ...)
```

## Testing

- Added `discord-alias-bug.test.ts` with comprehensive test coverage
- Validates error is thrown for conflicting aliases
- Verifies workaround works correctly

## Related

Fixes Discord bug reported by JustTheSyme.
See `INVESTIGATION_SAME_COLLECTION_BUG.md` for full investigation details.

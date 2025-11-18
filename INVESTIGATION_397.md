# Investigation Report: Issue #397 - RESOLVED

## Issue Summary
**Title:** Bug in update/delete functions with localStorageCollection
**Link:** https://github.com/TanStack/db/issues/397
**Reported:** August 11, 2025
**Status:** **FIXED** ✅

## Problem Description
Users reported that `update()` and `delete()` operations on localStorage-backed collections were incorrectly targeting the final item in the collection rather than the specific item identified by the provided ID parameter.

**Critical Detail from User:** The bug only occurred with **numeric IDs**, not string IDs.

## Root Cause

### The Bug
A **key type mismatch** between numeric IDs and string localStorage keys:

1. **localStorage constraint**: JSON object keys are always strings
   - When data is saved to localStorage: `{1: {data}, 2: {data}}` becomes `{"1": {data}, "2": {data}}`
   - When loaded back via `JSON.parse()`: All keys are strings

2. **JavaScript Map type sensitivity**:
   ```javascript
   const map = new Map()
   map.set("1", "value")  // String key
   map.has(1)             // false - number !== string
   ```

3. **The failure sequence**:
   ```
   Insert items with IDs: 1, 2, 3 (numeric)
       ↓
   Save to localStorage
       ↓
   Page reload / Collection initialization
       ↓
   Load from localStorage → Keys become: "1", "2", "3" (strings)
       ↓
   User calls collection.delete(1) → mutation.key = 1 (number)
       ↓
   Code executes: lastKnownData.delete(1)
       ↓
   FAILURE: Map only contains "1" (string), not 1 (number)
   ```

## The Fix

Convert all `mutation.key` values to strings in the localStorage implementation:

```typescript
// Before (BUG)
const key = mutation.key

// After (FIXED)
const key = String(mutation.key)
```

### Locations Fixed

**File:** `packages/db/src/local-storage.ts`

1. **Line 419** - `wrappedOnInsert`: Convert key to string
2. **Line 455** - `wrappedOnUpdate`: Convert key to string
3. **Line 486** - `wrappedOnDelete`: Convert key to string
4. **Line 554** - `acceptMutations`: Convert key to string

## Test Coverage

Added 6 new test cases to `packages/db/tests/local-storage.test.ts`:

### Bug #397 Test Suite (Lines 1618-1985)

**String ID Tests** (Baseline/Regression):
- ✅ `should update the correct item when multiple items exist (direct operations)`
- ✅ `should delete the correct item when multiple items exist`

**Numeric ID Tests** (Direct Operations):
- ✅ `should update the correct item when using numeric IDs`
- ✅ `should delete the correct item when using numeric IDs`

**Numeric ID Tests** (After Reload - Critical):
- ✅ `should update items with numeric IDs after loading from storage`
- ✅ `should delete items with numeric IDs after loading from storage` ← **This test failed before the fix**

**Test Results:**
- Before fix: 1 failed, 42 passed (43 total)
- After fix: **43 passed** ✅

## Timeline

| Date | Event |
|------|-------|
| Aug 11, 2025 | Issue #397 reported (user didn't specify numeric IDs initially) |
| Nov 5, 2025 | PR #760 merged (performance improvements, did NOT fix this bug) |
| Nov 17, 2025 | User comment: "When I make the id a string, it works... it fails when the id is a number" |
| Nov 17, 2025 | Bug reproduced, root cause identified, fix implemented |

## Initial Investigation Error

My first investigation concluded the bug was "already fixed by PR #760". This was **incorrect** because:

1. **Tests with string IDs passed** - Most common use case, masked the issue
2. **Insert-then-update tests passed** - No reload between operations
3. **Didn't test reload scenario** - Bug only appears when loading existing numeric-keyed data

The user's follow-up comment about numeric IDs was crucial for identifying the real issue.

## Impact & Compatibility

### What's Fixed
- ✅ Update operations with numeric IDs after page reload
- ✅ Delete operations with numeric IDs after page reload
- ✅ Manual transactions with numeric IDs

### Backward Compatibility
- ✅ **100% backward compatible** - String IDs work exactly as before
- ✅ No breaking changes to API or behavior
- ✅ All existing tests continue to pass

### Use Cases Now Supported
```typescript
// Numeric IDs - NOW WORKS ✅
const collection = createCollection(
  localStorageCollectionOptions({
    storageKey: 'todos',
    getKey: (item) => item.id, // returns number
  })
)

collection.insert({ id: 1, title: 'Todo 1' })
collection.insert({ id: 2, title: 'Todo 2' })
// Page reload...
collection.delete(1) // ✅ Correctly deletes item with id: 1
```

## Files Modified

1. **packages/db/src/local-storage.ts** - Fixed 4 key conversion issues
2. **packages/db/tests/local-storage.test.ts** - Added 6 regression tests
3. **BUG_FIX_397.md** - Detailed fix documentation
4. **INVESTIGATION_397.md** - This investigation report

## Lessons Learned

1. **Always test type variations** - Numeric vs string keys behave differently
2. **Test reload scenarios** - Loading from storage can expose hidden issues
3. **Listen to user details** - The "numeric ID" detail was the key to solving this
4. **localStorage type constraints** - All keys become strings after serialization

## Resolution

✅ **Issue #397 is now completely resolved.**

Users can safely use both string and numeric IDs with localStorage collections. The fix ensures type consistency by normalizing all keys to strings, matching localStorage's native behavior.

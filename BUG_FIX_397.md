# Bug Fix: Issue #397 - Numeric ID Key Type Mismatch

## Issue Summary
**Title:** Bug in update/delete functions with localStorageCollection
**Link:** https://github.com/TanStack/db/issues/397
**Root Cause:** Key type mismatch between numeric IDs and string keys in localStorage

## The Problem

When using **numeric IDs** with localStorage collections, update and delete operations would target the wrong items or fail to persist correctly.

### Why It Happened

1. **localStorage constraint**: JSON object keys are always strings. When data is saved to localStorage and loaded back, numeric keys like `1` become string keys like `"1"`.

2. **JavaScript Map behavior**: JavaScript Maps differentiate between types:
   ```typescript
   const map = new Map()
   map.set("1", "value")
   map.has(1) // false - number 1 ≠ string "1"
   ```

3. **The bug flow**:
   - User inserts items with numeric IDs (1, 2, 3)
   - Data is saved to localStorage
   - On page reload, data is loaded from localStorage
   - Keys in `lastKnownData` Map become strings ("1", "2", "3")
   - User tries to delete item with ID `1` (numeric)
   - Code does `lastKnownData.delete(1)`
   - Map only contains `"1"` (string), so deletion fails
   - Wrong item appears to be deleted or operation fails

## The Fix

Convert all `mutation.key` values to strings before using them with the `lastKnownData` Map, ensuring consistency with localStorage's string-only keys.

### Changed Files

**packages/db/src/local-storage.ts** - 4 locations:

1. **Line 419** (wrappedOnInsert):
   ```typescript
   - const key = mutation.key
   + const key = String(mutation.key)
   ```

2. **Line 455** (wrappedOnUpdate):
   ```typescript
   - const key = mutation.key
   + const key = String(mutation.key)
   ```

3. **Line 486** (wrappedOnDelete):
   ```typescript
   - const key = mutation.key
   + const key = String(mutation.key)
   ```

4. **Line 554** (acceptMutations):
   ```typescript
   - const key = mutation.key
   + const key = String(mutation.key)
   ```

## Test Coverage

Added comprehensive test cases in **packages/db/tests/local-storage.test.ts**:

### 1. Direct Operations with Numeric IDs
- ✅ `should update the correct item when using numeric IDs`
- ✅ `should delete the correct item when using numeric IDs`

### 2. Loading from Storage (The Critical Case)
- ✅ `should update items with numeric IDs after loading from storage`
- ✅ `should delete items with numeric IDs after loading from storage`

### 3. String ID Scenarios (Regression)
- ✅ `should update the correct item when multiple items exist (direct operations)`
- ✅ `should delete the correct item when multiple items exist`

**All 43 tests pass** ✅

## Impact

This fix ensures that localStorage collections work correctly with both:
- **String IDs**: `"user-123"`, `"todo-abc"` (unchanged behavior)
- **Numeric IDs**: `1`, `2`, `42` (now fixed)

## Backward Compatibility

✅ **Fully backward compatible** - String keys continue to work exactly as before.

## Why This Wasn't Caught Earlier

The initial investigation assumed the bug was already fixed by PR #760 because:
1. Tests with string IDs passed (most common use case)
2. Tests that inserted and immediately updated/deleted passed (no reload)
3. The bug only manifested when:
   - Using numeric IDs **AND**
   - Loading existing data from storage (simulating page refresh)

## Resolution

This fix completely resolves issue #397. Users can now safely use numeric IDs with localStorage collections.

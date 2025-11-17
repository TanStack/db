# Investigation Report: Issue #397

## Issue Summary
**Title:** Bug in update/delete functions with localStorageCollection
**Link:** https://github.com/TanStack/db/issues/397
**Reported:** August 11, 2025
**Status:** Investigating

## Problem Description
Users reported that `update()` and `delete()` operations on localStorage-backed collections were incorrectly targeting the final item in the collection rather than the specific item identified by the provided ID parameter.

### Symptoms
- When calling `collection.update(id, callback)`, the wrong item would be updated
- When calling `collection.delete(id)`, the wrong item would be deleted
- UI would show correct changes, but localStorage would not persist correctly

## Investigation Findings

### 1. Code Analysis
I examined the localStorage collection implementation in `packages/db/src/local-storage.ts` and the mutation handling in `packages/db/src/collection/mutations.ts`.

**Current Implementation (as of commit 7cd4dde):**
- Update and delete operations correctly use `mutation.key` to identify items
- The mutation.key is properly set by the collection engine based on the ID passed to update/delete
- All mutation handlers properly iterate over mutations and target the correct items

### 2. Historical Context
Found that PR #760 (commit 75470a8, merged November 5, 2025) made significant changes:

**Before PR #760:**
```typescript
// In wrappedOnUpdate
const key = config.getKey(mutation.modified)

// In wrappedOnDelete
const key = config.getKey(mutation.original)
```

**After PR #760:**
```typescript
// Both update and delete now use
const key = mutation.key
```

**Rationale from PR:**
- Use engine's pre-computed key for consistency
- Avoid redundant key derivation
- Eliminate potential drift if key function changes
- Match acceptMutations implementation

### 3. Test Results
Created comprehensive test cases to reproduce the reported issue:

**Test Scenarios:**
1. Update with multiple items - PASSING ✅
2. Delete with multiple items - PASSING ✅

**Test Configuration:**
- Multiple items in collection (3 items with IDs: "first", "second", "third")
- Direct update/delete operations targeting the first item
- Verification of both collection state AND localStorage persistence

**Verdict:** Unable to reproduce the bug in the current codebase.

## Timeline Analysis

| Date | Event |
|------|-------|
| Aug 11, 2025 | Issue #397 reported |
| Nov 5, 2025 | PR #760 merged (changed getKey to mutation.key) |
| Nov 17, 2025 | New comment claiming bug still exists |
| Nov 17, 2025 | Investigation conducted (tests pass) |

## Conclusions

### Primary Finding
**The bug reported in issue #397 appears to have been fixed by PR #760.**

The change from using `config.getKey(mutation.modified/original)` to using `mutation.key` ensures that:
1. The correct item is always targeted (using the ID passed to the function)
2. There's no potential mismatch between derived keys and intended keys
3. All mutation paths use consistent key identification

### Possible Explanations for Recent Comment

The November 17, 2025 comment claiming the bug still exists could be due to:

1. **Outdated Package Version:** The commenter may be using a version published before PR #760
2. **Different Scenario:** The commenter's issue may be different from the original report
3. **Caching Issue:** Browser or package manager caching an old version

### Recommendations

1. **Request Version Information:** Ask the commenter what version of `@tanstack/db` they're using
2. **Verify Package Update:** Ensure the fix in PR #760 has been published to npm
3. **Request Reproduction:** Ask for a minimal reproduction case that demonstrates the issue
4. **Close Issue:** If the version is confirmed to be outdated, close the issue with reference to PR #760

## Test Coverage Added

Added two new test cases to `packages/db/tests/local-storage.test.ts`:
- `should update the correct item when multiple items exist (direct operations)`
- `should delete the correct item when multiple items exist`

These tests specifically verify that:
- The correct item (not the last item) is updated/deleted
- Both collection state and localStorage are correctly synchronized
- Multiple items can coexist without interference

## Files Modified

1. `packages/db/tests/local-storage.test.ts` - Added Bug #397 test suite
2. `INVESTIGATION_397.md` - This investigation report

## Next Steps

1. Commit the test cases to prevent regression
2. Post findings to issue #397
3. Request version information from the latest commenter
4. Recommend closing the issue if the version is confirmed to be pre-PR #760

# Research: First-Class Error Tracking for Collections (Issue #672)

## Summary

GitHub Issue [#672](https://github.com/TanStack/db/issues/672) proposes standardizing error handling across TanStack DB collection types by adding first-class error tracking to `CollectionLifecycleManager`. This research document analyzes the proposal and samwillis' feedback from PR #671.

## Current State of Error Handling

### Query Collection (`query-db-collection`)
**Location:** `packages/query-db-collection/src/query.ts:417-422`

Uses **closure variables** for error tracking:
```typescript
let lastError: any
let errorCount = 0
let lastErrorUpdatedAt = 0
```

Exposes error utilities via `utils` object:
- `lastError()` - Returns the most recent error
- `isError()` - Boolean indicating error state
- `errorCount()` - Number of consecutive sync failures
- `clearError()` - Clears error state and triggers refetch

**Behavior on error:**
- Marks collection as `ready` even on error (line 548) to avoid blocking apps
- Increments `errorCount` only when query fails completely (not per retry)
- Resets `errorCount` and `lastError` on success (lines 461-462)

### Electric Collection (`electric-db-collection`)
**No error tracking implementation** - identified as a gap.

### Base Collection (CollectionLifecycleManager)
**Location:** `packages/db/src/collection/lifecycle.ts`

Currently only tracks **status**, including `error` as a status value, but:
- No `error` property to store error details
- No `errorCount` tracking
- No error event emissions
- No standardized error recovery mechanism

## Proposed Solution (Issue #672)

Add to `CollectionLifecycleManager`:
```typescript
error: Error | null = null
errorCount: number = 0
markError(error?: Error): void
```

**Benefits:**
- Consistency across all collection types
- First-class error handling in framework integrations
- Better debugging with error details
- Support for retry logic with exponential backoff

## Critical Feedback from samwillis (PR #671)

### Main Concern: Error State Transitions

samwillis identified a fundamental design question about **how collections should exit error states**.

#### Current Valid Transitions (lifecycle.ts:76-82)
```typescript
const validTransitions: Record<CollectionStatus, Array<CollectionStatus>> = {
  idle: [`loading`, `error`, `cleaned-up`],
  loading: [`ready`, `error`, `cleaned-up`],
  ready: [`cleaned-up`, `error`],
  error: [`cleaned-up`, `idle`],           // ← No `loading` or `ready`
  "cleaned-up": [`loading`, `error`],
}
```

**Key observation:** `error → ready` and `error → loading` are NOT currently valid transitions.

#### Problem with Original PR #671 Approach

The PR suggested automatic `loading` transition in `markReady()` when recovering from error:
```typescript
error → markReady() → loading → ready
```

**samwillis' objection:**
> "live queries have no mechanism to handle `ready → loading` transitions"

This creates an architectural inconsistency where:
1. Collections that are already `ready` cannot transition to `loading`
2. But error recovery would require `error → loading → ready`
3. Live queries subscribing to `ready` collections would see unexpected `loading` states

### Two Proposed Architectural Models

#### 1. Graceful Recovery Model
**Concept:** Sync implementations handle errors internally without disrupting the synced state.

**Characteristics:**
- Similar to `truncate()` operations (which work on `ready` collections)
- Allows direct `error → ready` transition
- Error doesn't destroy the sync connection
- Collection maintains its data and recovers gracefully

**Example use case:**
- Network timeout during sync
- Temporary API rate limiting
- Recoverable authentication issues

**Implementation:**
```typescript
// In sync implementation
try {
  await syncData()
  markReady() // Direct error → ready transition
} catch (error) {
  markError(error) // ready → error, then can recover directly
}
```

#### 2. Catastrophic Restart Model
**Concept:** Unrecoverable errors require full restart of the sync mechanism.

**Characteristics:**
- Calls `.cleanup()` for garbage collection
- Moves to `cleaned-up` state first
- Then calls `.startSync()` to go through normal `loading → ready` cycle
- Complete teardown and rebuild of sync state

**Example use case:**
- Authentication revoked
- Schema mismatch
- Connection permanently lost

**Implementation:**
```typescript
// Manual or automatic restart
await collection.cleanup()     // error → cleaned-up
collection.startSync()          // cleaned-up → loading → ready
```

**Proposed API:**
```typescript
collection.restartSync() // Convenience method for cleanup + startSync
```

### Design Question Raised

> "How much state management responsibility should fall on sync implementations versus the framework itself?"

**Implications:**
- Should `markError()` automatically handle recovery logic?
- Should error state transitions be more flexible?
- Should the framework distinguish between recoverable and catastrophic errors?

## Current Error Handling Patterns

### Operation Validation (lifecycle.ts:128-137)
```typescript
public validateCollectionUsable(operation: string): void {
  switch (this.status) {
    case `error`:
      throw new CollectionInErrorStateError(operation, this.id)
    case `cleaned-up`:
      // Automatically restart the collection
      this.sync.startSync()
      break
  }
}
```

**Behavior:**
- Collections in `error` state **block all operations**
- Collections in `cleaned-up` state **auto-restart** on operations
- No automatic recovery from `error` state

### Error Handling in Tests (collection-errors.test.ts)

The test suite shows expected behaviors:
1. **Cleanup errors are isolated** - thrown in microtasks to prevent blocking (lines 29-74)
2. **Error state blocks operations** - Must be manually recovered (lines 250-283)
3. **Cleaned-up state auto-restarts** - Operations trigger `startSync()` (lines 285-354)

## Documentation Analysis (docs/guides/error-handling.md)

Current documentation shows:

### Collection Status Values (line 118-124)
```
- idle - Not yet started
- loading - Loading initial data
- initialCommit - Processing initial data  ← NOTE: Not in lifecycle.ts!
- ready - Ready for use
- error - In error state
- cleaned-up - Cleaned up and no longer usable
```

**Discrepancy:** `initialCommit` status is documented but not in the current type definition.

### Recommended Recovery Pattern (lines 390-397)
```typescript
if (todoCollection.status === "error") {
  await todoCollection.cleanup()
  todoCollection.preload() // Or any other operation
}
```

Uses the **Catastrophic Restart Model** by default.

## Analysis & Recommendations

### Key Insights

1. **Current error handling is inconsistent:**
   - Query collections have robust error tracking via closures
   - Electric collections have none
   - Base collection only tracks status

2. **State transition model needs clarification:**
   - No consensus on `error → ready` vs `error → cleanup → loading → ready`
   - Live query compatibility concerns with state transitions
   - Auto-restart works for `cleaned-up` but not `error`

3. **Two distinct error categories exist:**
   - **Recoverable errors** - temporary network issues, rate limiting
   - **Catastrophic errors** - auth revoked, schema mismatch

### Questions to Resolve

1. **Should `error → ready` be a valid transition?**
   - Pro: Enables graceful recovery without full restart
   - Con: May confuse consumers expecting `loading` state
   - samwillis concern: Live queries don't handle `ready → loading`

2. **Should the framework distinguish error types?**
   ```typescript
   markError(error: Error, options?: { recoverable: boolean })
   ```
   - Recoverable: Allow `error → ready`
   - Catastrophic: Require `error → cleaned-up → loading → ready`

3. **Should error state auto-restart like cleaned-up?**
   - Current: `error` blocks, `cleaned-up` auto-restarts
   - Proposed: Both could auto-restart, or both could block

4. **How should `markReady()` behave when called from error state?**
   - Option A: Throw error (maintain strict transitions)
   - Option B: Allow `error → ready` (graceful recovery)
   - Option C: Auto-cleanup then transition (catastrophic restart)

### Proposed Solution Path

1. **Add first-class error tracking to CollectionLifecycleManager** ✓
   - Implement `error`, `errorCount`, `markError()` as proposed

2. **Support both recovery models:**
   ```typescript
   // Graceful Recovery
   markReady()  // error → ready (if valid transition)

   // Catastrophic Restart
   restartSync()  // error → cleaned-up → loading → ready
   ```

3. **Update valid transitions:**
   ```typescript
   error: [`cleaned-up`, `idle`, `ready`],  // Add `ready` for graceful recovery
   ```

4. **Add transition guards:**
   ```typescript
   // Only allow error → ready if sync implementation explicitly calls markReady()
   // This gives sync implementations control over recovery strategy
   ```

5. **Document both patterns:**
   - Graceful recovery for temporary errors
   - Catastrophic restart for permanent failures

### Implementation Considerations

1. **Backwards compatibility:**
   - Query collections already expose `lastError()` and `errorCount()`
   - New first-class properties should be compatible
   - Consider deprecation path for closure-based approach

2. **Event emissions:**
   - Should `markError()` emit error events?
   - Should `errorCount` changes emit events?
   - How do live queries react to error events?

3. **Error history:**
   - Should past errors be tracked?
   - How long should error history persist?
   - Memory implications of error tracking

4. **Testing strategy:**
   - Add tests for both recovery models
   - Test error event emissions
   - Test error count behavior across scenarios

## References

- **Issue:** https://github.com/TanStack/db/issues/672
- **PR:** https://github.com/TanStack/db/pull/671
- **Key Files:**
  - `packages/db/src/collection/lifecycle.ts`
  - `packages/query-db-collection/src/query.ts`
  - `packages/db/tests/collection-errors.test.ts`
  - `docs/guides/error-handling.md`

## Next Steps

1. **Clarify architectural vision** with maintainers:
   - Should both recovery models be supported?
   - What are the valid state transitions for error recovery?
   - How should live queries handle different transitions?

2. **Design decision required:**
   - Single recovery model vs. both models
   - Error categorization (recoverable vs. catastrophic)
   - Auto-restart behavior for error state

3. **Implementation approach:**
   - Prototype both recovery models
   - Test with live query scenarios
   - Gather feedback from community

4. **Documentation updates:**
   - Clear guidance on when to use each recovery model
   - Examples of both patterns
   - Migration guide for existing code

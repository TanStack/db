# Firefox Electric Collections Bug Investigation

**Bug Report Date:** 2025-11-13
**Reported By:** Discord user `proever`
**Issue:** Electric collections get "stuck" in Firefox during rapid tab switching

## Symptoms

1. Collections stop reconnecting after rapid tab switching (5 seconds of switching)
2. Network tab shows `NS_BINDING_ABORTED` errors
3. New data doesn't appear until page refresh
4. Issue is Firefox-specific
5. May also occur after leaving tab open for extended periods

## Root Cause

The Electric collection implementation **does not listen for page visibility changes** to trigger reconnections. When Firefox aggressively aborts network requests during tab switching, the collections enter a stuck state with no automatic recovery mechanism.

### Critical Missing Feature

**Location:** `packages/electric-db-collection/src/electric.ts:612-917`

The `createElectricSync` function does not:
- Subscribe to the `OnlineDetector` visibility change events
- Trigger reconnection when page becomes visible
- Handle browser-initiated aborts differently from user-initiated cancellations

## Technical Details

### 1. Abort Signal Chain (`electric.ts:672-699`)

```typescript
// External signal propagation
if (shapeOptions.signal) {
  shapeOptions.signal.addEventListener(`abort`, () => {
    abortController.abort()  // ← Propagates browser abort as collection abort
  }, { once: true })
}

// When aborted, ALL pending operations rejected
abortController.signal.addEventListener(`abort`, () => {
  pendingMatches.setState((current) => {
    current.forEach((match) => {
      match.reject(new StreamAbortedError())  // ← No retry mechanism
    })
    return new Map()
  })
})
```

**Problem:** Browser-initiated aborts (like `NS_BINDING_ABORTED` from tab switching) are treated the same as user-initiated cancellations, causing the stream to stop permanently.

### 2. OnlineDetector Exists But Isn't Used

**Location:** `packages/offline-transactions/src/connectivity/OnlineDetector.ts:44-48`

```typescript
private handleVisibilityChange = (): void => {
  if (document.visibilityState === `visible`) {
    this.notifyListeners()
  }
}
```

The `OnlineDetector` correctly listens for visibility changes and notifies subscribers. However:
- ❌ Electric collections don't subscribe to it
- ❌ No integration between the two systems
- ❌ Verified by grep: no references to `OnlineDetector` in `electric-db-collection` package

### 3. Manual Restart Only (`lifecycle.ts:128-137`)

```typescript
case `cleaned-up`:
  // Automatically restart the collection when operations are called
  this.sync.startSync()
  break
```

Collections only restart when:
1. User code explicitly accesses collection data (triggers `validateCollectionUsable`)
2. Garbage collection timer expires (default: 5 minutes, line 181)

**Missing:** Automatic restart on visibility change

### 4. Cleanup Behavior (`electric.ts:904-911`)

```typescript
cleanup: () => {
  unsubscribeStream()        // Unsubscribe from stream
  abortController.abort()    // Abort the stream
  loadSubsetDedupe?.reset()  // Reset deduplication
}
```

Once cleaned up:
- `AbortController` cannot be reused (browser API limitation)
- A new sync must be started to create a new `AbortController`
- But nothing triggers this new sync on visibility change

## Firefox-Specific Behavior

Firefox is more aggressive than Chrome with:
- Aborting network requests for background/hidden tabs
- Canceling requests during rapid visibility state changes
- Timing of when it considers a tab "inactive"

This causes more frequent `NS_BINDING_ABORTED` errors, making the bug more reproducible in Firefox.

## Sequence of Events Leading to Stuck State

1. **User rapidly switches tabs** (< 5 seconds between switches)
2. **Firefox aborts fetch requests** → `NS_BINDING_ABORTED` errors
3. **External signal fires** (if connected to browser abort)
4. **Abort propagates** through signal chain (line 676-684)
5. **All pending matches rejected** (line 691-699)
6. **Stream stops** and cleanup runs
7. **Page becomes visible** but...
8. **No automatic reconnection** (missing visibility listener)
9. **User sees stale data** until manual interaction or 5-minute GC timer

## Affected Code Files

| File | Lines | Issue |
|------|-------|-------|
| `packages/electric-db-collection/src/electric.ts` | 612-917 | Missing visibility change integration |
| `packages/electric-db-collection/src/electric.ts` | 676-699 | External signal abort cascade |
| `packages/electric-db-collection/src/electric.ts` | 691-699 | No retry on abort, all matches rejected |
| `packages/electric-db-collection/src/electric.ts` | 904-911 | Cleanup doesn't support graceful reconnection |
| `packages/db/src/collection/lifecycle.ts` | 128-137 | Manual restart only, not automatic |
| `packages/db/src/collection/lifecycle.ts` | 176-194 | Default 5-minute GC timer too long |

## Recommended Solutions

### Option 1: Add Visibility-Aware Reconnection (Recommended)

**Changes needed:**
1. Import and use `OnlineDetector` in `electric.ts`
2. Subscribe to visibility changes in `createElectricSync`
3. When page becomes visible after being hidden, check if stream is aborted
4. If aborted, trigger reconnection by calling the sync restart logic

**Implementation approach:**
```typescript
// In createElectricSync function
const onlineDetector = getOnlineDetector() // Get from config or create default
const unsubscribeOnline = onlineDetector.subscribe(() => {
  // If stream was aborted and page is now visible, restart
  if (abortController.signal.aborted && document.visibilityState === 'visible') {
    // Trigger collection restart through lifecycle
  }
})

// Remember to unsubscribe in cleanup
```

### Option 2: Add Retry Logic for Aborted Streams

**Changes needed:**
1. Don't immediately reject all pending matches on abort
2. Distinguish between "permanent abort" and "temporary disconnect"
3. Add exponential backoff retry mechanism
4. Queue operations during brief disconnections

### Option 3: Isolate Browser-Initiated Aborts

**Changes needed:**
1. Detect abort reason (browser vs. user-initiated)
2. Only propagate user-initiated cancellations to `abortController`
3. Handle browser tab-switching aborts as temporary interruptions
4. Automatically reconnect after browser-initiated aborts

## Workarounds for Users

### Workaround 1: Reduce GC Time (Forces faster reconnection)

```typescript
const messagesCollection = collection({
  // ... other options
  gcTime: 10000  // 10 seconds instead of default 5 minutes
})
```

**Limitation:** Forces more frequent cleanup/restart cycles, may impact performance

### Workaround 2: Manual Visibility Change Handler

```typescript
// In your app initialization
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    // Trigger collection access to force restart if stuck
    // This calls validateCollectionUsable which restarts cleaned-up collections
    messagesCollection.get().catch(() => {
      // Ignore errors, we just want to trigger the restart
    })
  }
})
```

**Limitation:** Must be added to every app, should be handled by the library

### Workaround 3: Avoid Rapid Tab Switching in Firefox

**Limitation:** Not a real solution, just explains the behavior

## Testing Recommendations

To reproduce the bug:
1. Open app with Electric collections in Firefox
2. Rapidly switch between tabs (5 seconds of quick switching)
3. Observe network tab for `NS_BINDING_ABORTED` errors
4. Return to app tab and send new data
5. Verify new data doesn't appear until page refresh

To verify a fix:
1. Implement visibility change handling
2. Follow reproduction steps above
3. Verify collections automatically reconnect when tab becomes visible
4. Confirm new data appears without refresh
5. Test with various tab-switching patterns
6. Test in both Firefox and Chrome

## Related Issues

- Electric SQL proxy API timeout handling (PR #798)
- Collection lifecycle and cleanup (PR #773)
- Online detection in offline-transactions package

## Conclusion

This is a **legitimate bug** in the Electric collection implementation. The user's report is accurate:

✅ Collections get stuck after rapid tab switching
✅ Firefox-specific due to aggressive request cancellation
✅ Missing automatic reconnection on visibility change
✅ Workarounds exist but library should handle this

**Recommendation:** Implement Option 1 (visibility-aware reconnection) as it's the most robust solution that aligns with user expectations for long-running collection behavior.

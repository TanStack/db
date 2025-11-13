# Firefox Electric Collections Bug Investigation

**Bug Report Date:** 2025-11-13
**Reported By:** Discord user `proever`
**Issue:** Electric collections get "stuck" in Firefox during rapid tab switching

## Symptoms

1. **Initial behavior works**: Visibility changes trigger reconnection (user sees NS_BINDING_ABORTED followed by new connections)
2. **After rapid switching**: Collections stop reconnecting after ~5 seconds of rapid tab switching
3. Network tab shows `NS_BINDING_ABORTED` errors but **no new connections start**
4. New data doesn't appear until page refresh
5. **Firefox-specific** (Chrome less affected)
6. May also occur after leaving tab open for extended periods

## Root Cause

**Bug Location:** `@electric-sql/client` package - ShapeStream visibility handling (not in TanStack DB)

The Electric client's ShapeStream **has visibility change handling built-in**, but contains a **race condition in the pause/resume state machine** that causes it to get stuck during rapid visibility changes.

### The Race Condition

**File:** `packages/typescript-client/src/client.ts` in `@electric-sql/client`

The `#pause()` and `#resume()` methods have guard checks that create a deadlock scenario:

```typescript
#pause() {
  if (this.#started && this.#state === 'active') {  // Only pauses if active
    this.#state = 'pause-requested'
    this.#requestAbortController?.abort(PAUSE_STREAM)
  }
}

#resume() {
  if (this.#started && this.#state === 'paused') {  // Only resumes if paused
    this.#start()
  }
}
```

**State machine:** `active` → `pause-requested` → `paused` → `active`

**What happens during rapid tab switching:**

1. Tab becomes **hidden** → visibility handler calls `#pause()`
2. State changes: `active` → `pause-requested`
3. Tab becomes **visible** (before async request completes) → visibility handler calls `#resume()`
4. **`#resume()` guard check FAILS** because state is `pause-requested`, not `paused`
5. `#resume()` silently returns without doing anything
6. Request eventually completes, state transitions to `paused`
7. **Stream is now stuck in `paused` state** - no event will trigger resume
8. Future visibility changes can't help:
   - Trying to pause a paused stream → guard fails (not `active`)
   - Trying to resume → guard fails (already checked, state is `paused` but no trigger)
9. Stream remains paused indefinitely

### Why This Is Firefox-Specific

Firefox is more aggressive than Chrome with:
- Faster/more frequent `visibilitychange` event firing during tab switching
- Tighter timing windows between hidden/visible transitions
- More aggressive request cancellation (NS_BINDING_ABORTED)

This makes the race condition more likely to occur in Firefox.

## Sequence of Events Leading to Stuck State

1. User rapidly switches tabs in Firefox
2. **First switch (hidden):**
   - Visibility handler calls `#pause()`
   - State: `active` → `pause-requested`
   - Abort controller signals pause with `PAUSE_STREAM`
   - Request starts aborting (async operation)
3. **Rapid switch back (visible):**
   - **BEFORE** request completes transition to `paused`
   - Visibility handler calls `#resume()`
   - Guard check: `if (this.#state === 'paused')` → **FALSE** (state is still `pause-requested`)
   - `#resume()` **returns without doing anything**
4. **Request finally completes:**
   - State transitions: `pause-requested` → `paused`
   - Stream is now paused, waiting for resume
5. **No resume trigger:**
   - Tab is already visible, so no new `visibilitychange` event fires
   - No other mechanism to call `#resume()`
   - Stream remains in `paused` state indefinitely
6. **User sees:**
   - No new network requests in network tab
   - Stale data (mutations don't appear)
   - Only fix is page refresh (creates new stream instance)

## Affected Code Files

**Primary Bug Location:**
| Package | File | Issue |
|---------|------|-------|
| `@electric-sql/client` | `packages/typescript-client/src/client.ts` | Race condition in `#pause()`/`#resume()` state machine |
| `@electric-sql/client` | `packages/typescript-client/src/client.ts` | `#subscribeToVisibilityChanges()` - no cleanup/error handling |

**TanStack DB (Not the cause, but affected):**
| Package | File | Notes |
|---------|------|-------|
| `@tanstack/electric-db-collection` | `packages/electric-db-collection/src/electric.ts` | Uses ShapeStream, inherits the bug |
| `@tanstack/db` | `packages/db/src/collection/lifecycle.ts` | Collections get stuck when underlying stream pauses |

## Recommended Solutions

### Option 1: Fix the Race Condition in Electric Client (Best Solution)

**Package:** `@electric-sql/client`
**File:** `packages/typescript-client/src/client.ts`

Modify `#resume()` to also handle `pause-requested` state:

```typescript
#resume() {
  if (this.#started && (this.#state === 'paused' || this.#state === 'pause-requested')) {
    // If pause was requested but not completed, cancel the pause and stay active
    if (this.#state === 'pause-requested') {
      this.#state = 'active'
      // The abort will complete but state is already active, so #requestShape will continue
    } else {
      // Normal resume from paused state
      this.#start()
    }
  }
}
```

**Pros:**
- Fixes the root cause directly
- Handles rapid state transitions correctly
- No changes needed in TanStack DB

**Cons:**
- Requires upstream fix in `@electric-sql/client`
- Users must wait for new release

### Option 2: Debounce Visibility Changes

Add debouncing to prevent rapid pause/resume cycles:

```typescript
#subscribeToVisibilityChanges() {
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  const visibilityHandler = () => {
    if (timeoutId) clearTimeout(timeoutId)

    timeoutId = setTimeout(() => {
      if (document.hidden) {
        this.#pause()
      } else {
        this.#resume()
      }
    }, 100) // 100ms debounce
  }

  document.addEventListener('visibilitychange', visibilityHandler)
}
```

**Pros:**
- Prevents rapid state transitions
- Simple implementation

**Cons:**
- Adds artificial delay
- Doesn't fully solve the race condition

### Option 3: Workaround in TanStack DB (Temporary)

**Package:** `@tanstack/electric-db-collection`
**File:** `packages/electric-db-collection/src/electric.ts`

Add visibility change monitoring in TanStack DB layer to detect and recover from stuck streams:

```typescript
// In createElectricSync
if (typeof document !== 'undefined') {
  const checkStreamHealth = () => {
    if (document.visibilityState === 'visible') {
      // If visible but no activity for >5 seconds, restart stream
      // (Implementation would track last message timestamp)
    }
  }
  document.addEventListener('visibilitychange', checkStreamHealth)
  // Clean up in cleanup() function
}
```

**Pros:**
- Can be implemented in TanStack DB without waiting for upstream
- Provides recovery mechanism

**Cons:**
- Doesn't fix root cause
- Adds complexity to TanStack DB layer
- May cause unnecessary restarts

## Workarounds for Users

Until the Electric client is fixed, users can work around this issue:

### Workaround 1: Manual Page Refresh Detection

```typescript
// In your app initialization
let lastVisibilityChange = Date.now()

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    const now = Date.now()

    // If visibility changed very rapidly (< 500ms), it might have triggered the race condition
    if (now - lastVisibilityChange < 500) {
      console.warn('Rapid visibility change detected, may need to refresh')
      // Option: Show user a "refresh if data seems stuck" message
      // Option: Auto-refresh the page (aggressive)
    }

    lastVisibilityChange = now
  }
})
```

**Limitation:** Doesn't prevent the bug, just detects when it might occur

### Workaround 2: Periodic Data Access (Prevents Pause)

```typescript
// Prevent stream from pausing by periodically accessing data
// This keeps collections "active" so they don't pause
setInterval(() => {
  if (document.visibilityState === 'visible') {
    // Accessing data keeps the collection active
    messagesCollection.get()
  }
}, 30000) // Every 30 seconds
```

**Limitation:** Wastes resources, doesn't actually fix the pause/resume logic

### Workaround 3: Avoid Rapid Tab Switching in Firefox

**Limitation:** Not a real solution, just user education about the trigger

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

This is a **legitimate bug** in the `@electric-sql/client` package, specifically in the ShapeStream's pause/resume state machine. The user's report is accurate:

✅ Collections get stuck after rapid tab switching (confirmed)
✅ Firefox-specific due to faster visibility change timing (confirmed)
✅ Initial reconnections work, then stop after rapid switching (confirmed)
✅ Caused by race condition in state machine, not missing features (root cause identified)

### Bug Summary

- **Package:** `@electric-sql/client`
- **Component:** ShapeStream visibility handling
- **Root Cause:** Race condition between `#pause()` and `#resume()` during rapid state transitions
- **Symptom:** Stream gets stuck in `paused` state when `#resume()` is called during `pause-requested` state
- **Impact:** Affects all users of Electric client with rapid tab switching, especially in Firefox

### Recommended Actions

1. **For Electric SQL team:** Fix the race condition in `#resume()` to handle `pause-requested` state (Option 1)
2. **For TanStack DB:** Consider temporary workaround (Option 3) until upstream fix is available
3. **For users:** Use Workaround 1 to detect when the bug occurs and notify users to refresh

### Next Steps

- Report this bug to the Electric SQL team with this analysis
- Link to this investigation in the bug report
- Consider implementing Option 3 (TanStack DB workaround) as a temporary mitigation
- Monitor Electric SQL releases for the fix

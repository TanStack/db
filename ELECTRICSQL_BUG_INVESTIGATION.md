# ElectricSQL Client Bug Investigation

## Issue Summary

Users intermittently receive 400 errors with the message:
```json
{
  "message": "Invalid request",
  "errors": {
    "handle": ["can't be blank when offset != -1"]
  }
}
```

The client sends requests with `expired_handle` and `offset=0_0` but **missing the `handle` parameter**.

## Root Cause

The bug is in the ElectricSQL TypeScript client's `#onInitialResponse` method at `packages/typescript-client/src/client.ts:1019-1048`.

### The Problematic Code

```typescript
async #onInitialResponse(response: Response) {
  const shapeHandle = headers.get(SHAPE_HANDLE_HEADER)
  if (shapeHandle) {
    const shapeKey = this.#currentFetchUrl
      ? canonicalShapeKey(this.#currentFetchUrl)
      : null
    const expiredHandle = shapeKey
      ? expiredShapesCache.getExpiredHandle(shapeKey)
      : null

    // BUG: If response handle matches expired handle, #shapeHandle is NOT updated
    if (shapeHandle !== expiredHandle) {
      this.#shapeHandle = shapeHandle  // Only set if not expired!
    } else {
      console.warn(...)  // Does NOT update handle, stays undefined
    }
  }

  // Offset is ALWAYS updated regardless of handle state
  const lastOffset = headers.get(CHUNK_LAST_OFFSET_HEADER)
  if (lastOffset) {
    this.#lastOffset = lastOffset  // Always updated!
  }
}
```

### Bug Sequence

1. **New ShapeStream created** without explicit `handle` option
   - `#shapeHandle = undefined`
   - `#lastOffset = "-1"`

2. **localStorage has stale expired handle** for this shape key (from previous session or earlier in page lifecycle)

3. **First request**: `offset=-1, no handle` (valid - server allows this for initial requests)

4. **CDN serves stale cached response** containing a handle that matches the expired handle in localStorage
   - This happens when proxy/CDN doesn't include all query params in cache key
   - Or when server reuses handle IDs

5. **In `#onInitialResponse`**:
   - `shapeHandle === expiredHandle` → **true**
   - `#shapeHandle` stays **undefined** (not updated due to the guard condition)
   - `#lastOffset` is updated to response offset (e.g., `"0_0"`)

6. **Next request construction** (`#constructUrl` at line 958-987):
   - Sets `offset=0_0` (from `#lastOffset`)
   - Does NOT set `handle` (because `#shapeHandle` is undefined)
   - Sets `expired_handle` (from localStorage lookup)

7. **Server rejects**: "handle can't be blank when offset != -1"

8. **Client cannot recover** - it keeps making the same invalid request

### Why It's Rare

This only happens when:
1. localStorage has a stale expired handle entry for the shape
2. A CDN/proxy serves a stale cached response with a handle matching that expired entry
3. The timing has to be just right - usually happens with "power users" who have longer sessions and more cached state

## Contributing Factors

### 1. Independent State Updates
`#lastOffset` and `#shapeHandle` are updated independently in `#onInitialResponse`. The offset can advance while the handle stays undefined.

### 2. Validation Only at Construction
The validation that requires `handle` when `offset != -1` (`client.ts:1659-1666`) only runs in `validateOptions()` during **construction**, not after state mutations.

### 3. Persistent Expired Shapes Cache
The `ExpiredShapesCache` persists to localStorage (`client.ts` line 72, `expired-shapes-cache.ts`). Old entries can persist across sessions and cause issues when:
- A new handle happens to match an old expired handle
- A CDN serves cached responses with old handles

### 4. URL Construction Doesn't Validate
The `#constructUrl` method doesn't verify that when `offset != -1`, a handle exists before building the request URL.

## Proposed Fixes

### Fix 1: Guard Against Undefined Handle (Recommended)

In `#onInitialResponse`, don't skip updating `#shapeHandle` if it's currently undefined:

```typescript
if (shapeHandle !== expiredHandle || this.#shapeHandle === undefined) {
  this.#shapeHandle = shapeHandle
} else {
  console.warn(...)
}
```

### Fix 2: Validate Before Each Request

In `#constructUrl`, add validation before returning:

```typescript
// After line 958 where offset is set
if (this.#lastOffset !== `-1` && !this.#shapeHandle) {
  // Reset to clean state to recover
  this.#lastOffset = `-1`
  console.warn(`[Electric] Inconsistent state detected: offset is ${this.#lastOffset} but handle is undefined. Resetting to initial state.`)
}
```

### Fix 3: Clear Stale Cache Entries

When successfully completing an initial sync from `offset=-1`, clear any existing expired handle entry for this shape:

```typescript
// After successfully receiving first response with offset=-1
if (previousOffset === `-1`) {
  expiredShapesCache.clearForShape(shapeKey)
}
```

### Fix 4: Don't Persist Expired Cache to localStorage

The localStorage persistence of expired handles is a major contributor. Consider making it session-only:

```typescript
// In ExpiredShapesCache, remove localStorage persistence
private save(): void {
  // Don't persist to localStorage - keep in memory only
}
```

## Related Code Locations

| File | Lines | Purpose |
|------|-------|---------|
| `packages/typescript-client/src/client.ts` | 1019-1064 | `#onInitialResponse` - where state inconsistency occurs |
| `packages/typescript-client/src/client.ts` | 958-987 | `#constructUrl` - URL construction without validation |
| `packages/typescript-client/src/client.ts` | 1659-1666 | `validateOptions` - only validates at construction |
| `packages/typescript-client/src/client.ts` | 789-811 | 409 handling - marks handles as expired |
| `packages/typescript-client/src/expired-shapes-cache.ts` | 1-72 | Expired shapes cache with localStorage persistence |

## Workaround for Users

As suggested in the Discord thread, detecting this state in the proxy and returning a 409 could help clients recover:

```typescript
// In proxy middleware
if (request.offset !== '-1' && !request.handle && request.expired_handle) {
  // Force client to reset by returning 409
  return new Response(JSON.stringify({ message: 'must_refetch' }), {
    status: 409,
    headers: { 'electric-handle': generateNewHandle() }
  })
}
```

However, this is a workaround - the real fix needs to be in the client to prevent this state from occurring.

## Test Case

To reproduce:
1. Create a shape stream
2. Manually populate localStorage with an expired handle entry matching a real handle
3. Ensure CDN/proxy serves cached response with that handle
4. Observe the 400 error on subsequent requests

## Conclusion

The bug is a race condition between the expired shapes cache, CDN caching, and the client's state management. The fix should ensure that `#shapeHandle` is always set when `#lastOffset` advances past `-1`, regardless of whether the handle matches an expired entry.

---
"@tanstack/svelte-db": patch
---

Fix flushSync error in Svelte 5 async compiler mode

Previously, `useLiveQuery` threw an error when Svelte 5's async compiler mode was enabled:

```
Uncaught Svelte error: flush_sync_in_effect
Cannot use flushSync inside an effect
```

This occurred because `flushSync()` was called inside the `onFirstReady` callback, which executes within a `$effect` block. Svelte 5's async compiler enforces a strict rule that `flushSync()` cannot be called inside effects, as documented at svelte.dev/e/flush_sync_in_effect.

**The Fix:**

Removed the unnecessary `flushSync()` call from the `onFirstReady` callback. Svelte 5's reactivity system automatically propagates state changes without needing synchronous flushing. This matches the pattern already used in Vue's implementation.

**Compatibility:**

- ✅ For users WITHOUT async mode (current default): Works as before
- ✅ For users WITH async mode: Now works instead of throwing error
- ✅ Future-proof: async mode will be default in Svelte 6
- ✅ All 23 existing tests pass, confirming no regression

**How to enable async mode:**

```javascript
// svelte.config.js
export default {
  compilerOptions: {
    experimental: {
      async: true,
    },
  },
}
```

Fixes #744

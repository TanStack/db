---
"@tanstack/db": patch
---

Implement idle cleanup for collection garbage collection

Collection cleanup operations now use `requestIdleCallback()` to prevent blocking the UI thread during garbage collection. This improvement ensures better performance by scheduling cleanup during browser idle time rather than immediately when collections have no active subscribers.

**Key improvements:**

- Non-blocking cleanup operations that don't interfere with user interactions
- Automatic fallback to `setTimeout` for older browsers without `requestIdleCallback` support
- Proper callback management to prevent race conditions during cleanup rescheduling
- Maintains full backward compatibility with existing collection lifecycle behavior

This addresses performance concerns where collection cleanup could cause UI thread blocking during active application usage.

---
'@tanstack/db': patch
---

feat: allow externally-provided `previousValue` in sync update change detection

When sync update messages include `previousValue`, `commitPendingTransactions` now uses it for the before/after comparison instead of the captured `currentVisibleState`. This allows live-reading proxy objects (e.g. Yjs Y.Type proxies) to work as collection values — the proxy always returns current state, but the sync source can provide the pre-mutation state from its own diff system. No behavior change when `previousValue` is omitted.

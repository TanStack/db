---
"@tanstack/offline-transactions": minor
"@tanstack/db": patch
---

Add offline-transactions package with robust offline-first capabilities

New package `@tanstack/offline-transactions` provides a comprehensive offline-first transaction system with:

**Core Features:**
- Persistent outbox pattern for reliable transaction processing
- Leader election for multi-tab coordination (Web Locks API with BroadcastChannel fallback)
- Automatic storage capability detection with graceful degradation
- Retry logic with exponential backoff and jitter
- Sequential transaction processing (FIFO ordering)

**Storage:**
- Automatic fallback chain: IndexedDB → localStorage → online-only
- Detects and handles private mode, SecurityError, QuotaExceededError
- Custom storage adapter support
- Diagnostic callbacks for storage failures

**Developer Experience:**
- TypeScript-first with full type safety
- Comprehensive test suite (25 tests covering leader failover, storage failures, e2e scenarios)
- Works in all modern browsers and server-side rendering environments

**@tanstack/db improvements:**
- Enhanced duplicate instance detection (dev-only, iframe-aware, with escape hatch)
- Better environment detection for SSR and worker contexts

Example usage:

```typescript
import { startOfflineExecutor, IndexedDBAdapter } from '@tanstack/offline-transactions'

const executor = startOfflineExecutor({
  collections: { todos: todoCollection },
  storage: new IndexedDBAdapter(),
  mutationFns: {
    syncTodos: async ({ transaction, idempotencyKey }) => {
      // Sync mutations to backend
      await api.sync(transaction.mutations, idempotencyKey)
    }
  },
  onStorageFailure: (diagnostic) => {
    console.warn('Running in online-only mode:', diagnostic.message)
  }
})

// Create offline transaction
const tx = executor.createOfflineTransaction({
  mutationFnName: 'syncTodos',
  autoCommit: false
})

tx.mutate(() => {
  todoCollection.insert({ id: '1', text: 'Buy milk', completed: false })
})

await tx.commit() // Persists to outbox and syncs when online
```

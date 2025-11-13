---
'@tanstack/query-db-collection': patch
---

Fix Direct Write items being purged when query results change

Items inserted via Direct Writes (`writeInsert`, `writeUpsert`) are now protected from automatic deletion when query results change. Previously, when using `syncMode: 'on-demand'` or dynamic query keys, directly-written items would be incorrectly purged if they didn't appear in new query results.

**What changed:**
- Direct Write items now persist until explicitly deleted via `writeDelete()`
- Items are tracked separately from query results to prevent premature garbage collection
- This ensures EventSource updates, real-time data, and manual writes remain in the collection

**Example scenario that's now fixed:**
```typescript
// Add item via Direct Write (e.g., from EventSource)
collection.utils.writeInsert({ id: '4', message: 'New event' })

// Query result changes (different filter/pagination)
await collection.utils.refetch()

// Before: Item 4 would be deleted ❌
// After: Item 4 persists ✅
```

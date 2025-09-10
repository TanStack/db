---
"@tanstack/electric-db-collection": minor
---

feat: Add flexible matching strategies for electric-db-collection (#402)

Add three matching strategies for client-server synchronization:

1. **Txid strategy** (existing, backward compatible) - Uses PostgreSQL transaction IDs for precise matching
2. **Custom match function strategy** (new) - Allows heuristic-based matching with custom logic
3. **Void/timeout strategy** (new, 3-second default) - Simple timeout for prototyping

**New Features:**

- New types: `MatchFunction<T>`, `MatchingStrategy<T>`
- Enhanced `ElectricCollectionConfig` to support all strategies
- New utility: `awaitMatch(matchFn, timeout?)`
- Export `isChangeMessage` and `isControlMessage` helpers for custom match functions

**Benefits:**

- Backward compatibility maintained - existing code works unchanged
- Architecture flexibility for different backend capabilities
- Progressive enhancement path - start with void strategy, upgrade to txid when ready
- No forced backend API changes - custom match functions work without backend modifications

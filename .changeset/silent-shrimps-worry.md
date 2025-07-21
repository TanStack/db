---
"@tanstack/db": patch
---

Add comprehensive documentation for creating collection options creators

This adds a new documentation page `collection-options-creator.md` that provides detailed guidance for developers building collection options creators. The documentation covers:

- Core requirements and configuration interfaces
- Sync implementation patterns with transaction lifecycle (begin, write, commit, markReady)
- Data parsing and type conversion using field-specific conversions
- Two distinct mutation handler patterns:
  - Pattern A: User-provided handlers (Electric SQL, Query style)
  - Pattern B: Built-in handlers (Trailbase, WebSocket style)
- Complete WebSocket collection example with full round-trip flow
- Managing optimistic state with various strategies (transaction IDs, ID-based tracking, refetch, timestamps)
- Best practices for deduplication, error handling, and testing
- Row update modes and advanced configuration options

The documentation helps developers understand when to create custom collections versus using the query collection, and provides practical examples following the established patterns from existing collection implementations.

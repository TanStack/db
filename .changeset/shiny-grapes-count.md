---
"@tanstack/db": patch
---

Fix iterator-based change tracking in proxy system

This fixes several issues with iterator-based change tracking for Maps and Sets:

- **Map.entries()** now correctly updates actual Map entries instead of creating duplicate keys
- **Map.values()** now tracks back to original Map keys using value-to-key mapping instead of using symbol placeholders
- **Set iterators** now properly replace objects in Set when modified instead of creating symbol-keyed entries
- **forEach()** methods continue to work correctly

The implementation now uses a sophisticated parent-child tracking system with specialized `updateMap` and `updateSet` functions to ensure that changes made to objects accessed through iterators are properly attributed to the correct collection entries.

This brings the proxy system in line with how mature libraries like Immer handle iterator-based change tracking, using method interception rather than trying to proxy all property access.

---
"@tanstack/db": patch
---

fix: improve InvalidSourceError message clarity

The InvalidSourceError now provides a clear, actionable error message that:
- Explicitly states the problem is passing a non-Collection/non-subquery to a live query
- Includes the alias name to help identify which source is problematic
- Provides guidance on what should be passed instead (Collection instances or QueryBuilder subqueries)

This replaces the generic "Invalid source" message with helpful debugging information.

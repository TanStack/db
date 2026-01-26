---
'@tanstack/db': patch
'@tanstack/db-ivm': patch
---

Add safety limits to prevent app freezes from excessive iterations in ORDER BY + LIMIT queries.

**The problem**: ORDER BY + LIMIT queries can cause excessive iterations when WHERE filters out most data - the TopK keeps asking for more data that doesn't exist.

**The fix**: Added iteration safety limits that gracefully break out of loops and continue with available data:

- D2 graph: 100,000 iterations
- maybeRunGraph: 10,000 iterations
- requestLimitedSnapshot: 10,000 iterations

When limits are hit, a warning is logged with diagnostic info (collection IDs, query structure, cursor position, etc.) but the query **continues normally** with the data it has - no error state, no app breakage.

This diagnostic info will help identify the root cause if the warnings occur in production. Please report any warnings to https://github.com/TanStack/db/issues

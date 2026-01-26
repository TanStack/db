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

When limits are hit, a warning is logged with:

- **Iteration breakdown**: Shows where the loop spent time (e.g., "iterations 1-5: [TopK, Filter], 6-10000: [TopK]")
- Diagnostic info: collection IDs, query structure, cursor position, etc.

The query **continues normally** with the data it has - no error state, no app breakage.

The iteration breakdown makes it easy to see the stuck pattern in the state machine. Please report any warnings to https://github.com/TanStack/db/issues

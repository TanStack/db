---
'@tanstack/db': patch
'@tanstack/db-ivm': patch
---

Add safety limits and diagnostic error messages to prevent app freezes from infinite loops.

**The problem**: ORDER BY + LIMIT queries can cause excessive iterations when WHERE filters out most data, leading to app freezes.

**The fix**: Added iteration safety limits as backstops that prevent hangs and provide detailed diagnostic info when triggered:

- D2 graph: 100,000 iterations
- maybeRunGraph: 10,000 iterations
- requestLimitedSnapshot: 10,000 iterations

When limits are hit, detailed error messages include:

- Collection IDs and query info
- TopK size vs data needed
- Cursor position and iteration counts
- Which D2 operators have pending work

This diagnostic info will help identify the root cause of production freezes. Please report any errors with the diagnostic output to https://github.com/TanStack/db/issues

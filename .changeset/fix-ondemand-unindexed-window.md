---
'@tanstack/db': patch
---

An ordered, limited live query over an on-demand source without an index no longer leaves its window short when a LEFT-joined filter removes rows from the loaded prefix. For example, an anti-join could show an empty window after a visible row was deleted. Such a plan now counts the rows its window still needs, and reads the full source when its prefix cannot fill the window.

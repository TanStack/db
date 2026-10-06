---
'@tanstack/db': patch
---

Refill an ordered, limited live query over an eager, indexed source in bounded work. Before, deleting a visible row or changing a visible row's order value made the source resend every matching row to the query. For example, a 50-row window over 10,000 rows resent about 5,000 rows on each such change. The query now reads only the first rows of the window from the index. On-demand sources keep their existing behavior.

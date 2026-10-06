---
'@tanstack/db': patch
---

Evaluate `inArray` over a constant list with a Set lookup instead of comparing the value with every list item. A join that loads matching rows through a source with no index sends one large constant list, so a cold join over 10,000 rows no longer compares each row with every key.

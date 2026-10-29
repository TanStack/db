---
'@tanstack/db': patch
---

Prevent phantom Effect update callbacks for unchanged intermediate LEFT-join rows during startup. Avoid factorial comparison work when projected Sets contain distinct objects with equal contents and a later mismatch.

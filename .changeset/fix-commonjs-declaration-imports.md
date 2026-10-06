---
'@tanstack/db': patch
'@tanstack/db-ivm': patch
---

Fix CommonJS declaration imports so Node16 and NodeNext TypeScript consumers can resolve the public APIs. Preserve ESM module references and string-literal types.

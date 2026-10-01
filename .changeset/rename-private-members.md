---
'@tanstack/db': patch
---

Rename TypeScript-private class members to short names in the published build. Consumer minifiers never rename properties, so these long names reached every production bundle. A committed name map keeps the short names stable and reversible, and source maps still point at the original source. The public API and type declarations do not change. The full public API bundles about 30 KB smaller when minified (about 2.9 KB, or 2.7%, with gzip).

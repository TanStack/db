---
'@tanstack/react-db': patch
---

Production builds no longer include the development warnings of `useLiveQuery`. A typical app's bundle is about 1.6 kB smaller before compression and 0.66 kB smaller after gzip.

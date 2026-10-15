---
'@tanstack/react-db': patch
---

Keep `usePacedMutations` callbacks tied to the latest committed render so suspended transitions cannot mutate or persist another document's data. Refresh callbacks before descendant layout effects run while preserving the stable mutate function.

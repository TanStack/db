---
"@tanstack/db": patch
---

Improve merge logic for applyMutations

- Update after insert: keeps the insert type with empty original, merges changes from both mutations
- Delete after insert: removes both mutations (they cancel each other out)
- Delete after update: maintains current behavior of replacing with delete

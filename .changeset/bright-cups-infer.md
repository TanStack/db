---
'@tanstack/db-sqlite-persistence-core': patch
---

Fix type inference for schema-free collection options wrapped with persistedCollectionOptions and passed to createCollection.

Reject caller utilities that use the reserved local persistence names acceptMutations, getLeadershipState, or forceReloadSubset, instead of silently replacing them.

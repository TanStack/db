---
'@tanstack/db': minor
---

Include IndexedDB Collections in `@tanstack/db` alongside LocalStorage Collections. Export the database and collection APIs from the core package, use consistent IndexedDB file and guide names, and move the tests and documentation with the implementation. Remove the standalone `@tanstack/indexeddb-db-collection` workspace package.

Apps using the standalone package should import from `@tanstack/db` and remove the old dependency. Existing stored rows remain available. The generated Collection ID prefix changes from `indexeddb-collection:` to `indexed-db-collection:`; set `id` explicitly to retain the old ID where needed.

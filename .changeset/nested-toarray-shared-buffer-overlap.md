---
'@tanstack/db': patch
---

fix(db): nested `toArray` includes dropping children when sibling parent groups share a correlation key

With three (or more) levels of nested `toArray` includes, when two children in different parent groups shared the same deepest correlation key, only one of them received the nested rows and the other came back as an empty array. The nested-pipeline routing index mapped each nested correlation key to a single parent group and the shared buffer entry was deleted after routing to the first match, so sibling groups sharing the key were dropped.

The routing index now maps a nested correlation key to all parent groups that reference it and fans buffered grandchild changes out to each. A per-level snapshot of already-materialized rows also seeds parent groups that start referencing an existing correlation key after the rows were drained (e.g. inserted after the initial load), since the pipeline does not re-emit them.

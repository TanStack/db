---
'@tanstack/db': patch
'@tanstack/db-ivm': patch
---

Major performance improvements to live query hydration, incremental updates, and collection mutations (1.7× geomean hydration over the previous release on an issue-tracker benchmark; incremental update pairs 2–30× faster; mutation bursts no longer quadratic):

- Includes subqueries with inline materializations (`toArray`, `materialize`, `concat`) use a lightweight in-memory child store instead of a full Collection instance per parent row, and nested-includes flushes track dirty entries explicitly instead of scanning every child per flush
- Synchronous mutation handlers (e.g. local-only collections) complete their transactions synchronously, eliminating quadratic transaction accumulation during mutation bursts; terminal transactions are migrated once and pruned eagerly
- `eq`/`in` on a field that mirrors the collection key (validated per write) are served by direct key lookups — no index required, no full scan; lazy join loads on key fields skip already-delivered keys
- Steady-state sync commits (no user transactions, no optimistic state) take a fast lane, with an ultra path for single-operation commits
- The `in` evaluator probes a precomputed Set for constant arrays; `eq` gets primitive fast paths; `normalizeValue` short-circuits primitives; compiled expression evaluators are cached by structure and per index
- `groupBy` avoids structural hashing in its reduce index (discriminant prefixes + new `prefixIdentity`/`trackConsolidated` Index options), serializes primitive group keys cheaply, and emits minimal result rows
- Join re-keying is fused into the join operator (`JoinKeyExtractors`), join delta terms append directly into the shared results multiset, and single-reader dataflow edges transform multisets in place
- `SortedMap` maintains order lazily (O(1) writes, sort on read) with monotonic-append and pop-on-tail fast paths; the D2 graph only runs operators with pending work
- The query optimizer skips its rewrite loop for single-source queries without joins

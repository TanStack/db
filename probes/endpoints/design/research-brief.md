# Frozen Research Survey brief

Research date/source cutoff: 2026-09-11. Depth: broad, bounded to English-accessible primary documentation, original papers, and current local source. Output: optimistic-coherence-research-survey.md in this directory.

Question: What prior designs keep overlapping client query collections coherent during optimistic writes and server reconciliation, and what information and delivery guarantees do those designs require?

Intended use: Source material for the user's selected Ground-condition probe, then an exploratory Design grammar extractor on the current TanStack Endpoints prototype. No architecture selection, implementation, or product ranking.

Starting material: Current Endpoints runtime, compiler, and generated full-stack oracle; user requires bare writable query collections, synchronous optimistic transactions, client DB query evaluation, server-code exclusion, no implicit mutation queue. Cross-collection propagation is known missing behavior. Exhausted read retries may surface a sync error; failed synchronization does not have to pretend to provide current server truth.

Coverage frame (fixed before research):
1. Normalized entity caches: identity versus query/list membership; optimistic layers, concurrent updates and rollback.
2. Reactive/synchronized local query systems: shared data versus cached result updates; mutation reconciliation, partial replication and delivery/version boundaries.
3. Database foundations: incremental view maintenance and view-update ambiguity, selection/projection/limit completeness.
4. Local prototype: actual information and public API boundaries already available; observed known missing behavior.
5. Counter-search across all tracks: missing insert membership, limited query replacement rows, server-only logic, error recovery and unsupported concurrency claims.

Exclusions: Product recommendation, performance ranking, pricing, installation, exhaustive review, full CRDT survey, production auth design, changing implementation or oracle laws this turn. Scope/authorization remains a design condition, not a production security audit.

Search routes: Web search and direct official/paper sources; local source files for current prototype. Per external track: initial searches, direct inspection of representative sources, then contrary-evidence and thin-cell passes. Stop at two consecutive targeted passes with no material additions, or the declared bound of six inspected sources per track and two counter-search passes; record which limit fires. Search indexes and English public vendor documentation remain correlated/selective evidence.

Parallel tracks share this brief but not desired conclusions. Each returns typed claims, direct URLs, source dates if visible, limitations, routes and access failures. No agent selects or ranks designs. Orchestrator writes the single portable survey and validates it. This brief is an instrument input, not a Field Log or an implementation plan.

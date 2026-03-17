# Persisted Sync Metadata Plan

This directory breaks the `RFC-persisted-sync-metadata.md` design into an
implementation plan with explicit phases.

The recommended execution order is:

1. `01-core-api.md`
2. `02-sqlite-implementation.md`
3. `03-query-collection.md`
4. `04-electric-collection.md`
5. `05-test-plan.md`

## Goals

- land the core metadata transaction model first
- make SQLite the reference persistence implementation
- migrate `query-db-collection` onto the new primitives
- migrate `electric-db-collection` onto the new primitives
- validate correctness with thorough invariants-focused tests

## Non-Goals

- optimizing every replay and GC path in the first pass
- implementing every possible metadata-backed feature before the core API is
  stable

## Guiding principles

- metadata that affects persisted row behavior must commit with the row state it
  explains
- row metadata and collection metadata are distinct scopes
- metadata-only sync transactions are first-class
- restart correctness comes before targeted replay optimization
- persisted query retention is separate from in-memory `gcTime`

## Phase dependencies

- Phase 1 is required before any other phase
- Phase 2 depends on Phase 1
- Phase 3 depends on Phases 1 and 2
- Phase 4 depends on Phases 1 and 2
- Phase 5 spans all phases and should be updated continuously

## Recommended delivery strategy

- implement Phase 1 and Phase 2 behind a narrow internal API
- land Phase 3 next because it is the primary motivator
- land Phase 4 once the core metadata model has proven stable under restart and
  replay tests
- keep `05-test-plan.md` as the definition of done for each phase

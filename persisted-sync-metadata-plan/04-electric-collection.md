# Phase 4: Electric Collection

## Objective

Migrate `electric-db-collection` to use transactional collection metadata and
row metadata so it can:

- persist durable resume state
- warm-start from persisted rows safely
- resume streaming from a persisted stream identity when valid
- leave room for future persistence of additional Electric-derived state

## Primary code areas

- `packages/electric-db-collection/src/electric.ts`
- `packages/electric-db-collection/tests/electric.test.ts`
- `packages/electric-db-collection/tests/electric-live-query.test.ts`
- persisted integration tests combining Electric and SQLite persistence

## High-level design

### Collection metadata

Persist Electric resume state at collection scope.

Suggested shape:

```ts
type ElectricResumeMetadata =
  | {
      kind: 'resume'
      offset: string
      handle: string
      shapeId: string
      updatedAt: number
    }
  | {
      kind: 'reset'
      updatedAt: number
    }
```

Suggested key:

- `electric:resume`

### Row metadata

Persist useful per-row sync metadata through the same row metadata channel used
by `write({ metadata })`.

Examples:

- relation identity
- row sync headers that are useful after hydration

## Proposed implementation steps

### 1. Read resume metadata at startup

On sync initialization:

- read `electric:resume` from collection metadata
- if `kind: 'resume'`, prefer that persisted stream identity over the current
  fallback behavior
- if resume metadata is absent or invalid, fall back to the existing startup
  behavior

### 2. Persist resume state transactionally

When an Electric batch advances the durable resume point:

- stage the new `electric:resume` metadata in the same sync transaction as the
  row changes from that batch

This prevents the invalid state where a resume token advances beyond the rows
that were actually committed.

### 3. Support metadata-only resume updates when needed

If Electric needs to persist a new durable resume state on a control-message
boundary without a row mutation in the same batch, use a metadata-only sync
transaction.

This depends on Phase 1 and Phase 2 support for metadata-only commits.

### 4. Define reset behavior

When Electric determines the persisted resume state is invalid or a must-refetch
equivalent restart path is required:

- clear or replace `electric:resume` with a `kind: 'reset'` marker
- perform the corresponding conservative reload path

This makes restart behavior explicit rather than relying on stale resume state.

### 5. Carry row metadata through hydration

Hydrated rows from SQLite should restore the Electric row metadata that was
originally written through `write({ metadata })`.

This provides a better baseline for future Electric restart reconstruction work.

## Important design constraints

### Resume metadata is not the full Electric state

Electric also maintains derived in-memory state such as:

- tag indexes
- synced key tracking
- snapshot and txid matching state

This phase does not require exact restart reconstruction of every one of these.
It only requires a sound transactional place to persist the pieces that should
survive restart.

### Be conservative when reconstruction is incomplete

If persisted resume metadata is present but the required derived state is not
reconstructible safely, Electric should fall back to a conservative reload path
rather than assume exact restart correctness.

### Strong stream identity matters

Resume metadata should persist enough identity to detect incompatible resume
state, not just an offset.

At minimum:

- `offset`
- `handle`
- `shapeId`

## Edge cases to handle

- persisted resume metadata missing one required field
- resume metadata exists but shape identity no longer matches server state
- metadata-only resume update
- restart after partially applied or replayed batches
- must-refetch/reset flows clearing or replacing persisted resume state
- hydrated rows restoring row metadata while resume metadata is absent

## Acceptance criteria

- Electric resume state survives restart
- resume metadata only advances when the corresponding batch commits
- invalid resume metadata triggers conservative fallback
- metadata-only resume commits work
- persisted row metadata survives hydration where relevant

## Suggested tests

- batch commit persists rows and resume metadata atomically
- failed batch does not advance resume metadata
- restart uses persisted resume metadata when valid
- restart falls back safely when persisted resume metadata is invalid
- metadata-only resume tx survives restart
- must-refetch/reset clears or invalidates persisted resume state correctly
- row metadata written by Electric survives SQLite hydration

## Exit criteria

Phase 4 is complete when Electric has a durable, transactional resume-state
story that is compatible with persisted warm starts and conservative fallback
behavior.

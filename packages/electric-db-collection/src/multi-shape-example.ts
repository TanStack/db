/**
 * Example: Multi-Shape Electric Collection Usage
 *
 * This demonstrates how the multi-shape architecture would be used
 * compared to the current single-shape approach.
 */

import { createCollection } from '@tanstack/db'
import { electricCollectionOptions } from './electric'
import { createMultiShapeSync } from './multi-shape'
import type { Row } from '@electric-sql/client'

// Example schema
interface Event extends Row<unknown> {
  id: string
  userId: string
  type: string
  data: Record<string, unknown>
  createdAt: string
}

const ELECTRIC_URL = 'http://localhost:3000/v1/shape'

// =============================================================================
// CURRENT APPROACH: Single shape with subset loading
// =============================================================================
// Problem: Even with subset loading, a single shape receives ALL updates
// to the table. For a table with 1M inserts/day, this means processing
// all those updates client-side even if you only care about a small subset.

const eventsCollectionCurrent = createCollection<Event>(
  electricCollectionOptions({
    id: 'events',
    shapeOptions: {
      url: ELECTRIC_URL,
      params: { table: 'events' },
      // Can't put user-specific filter here - it's defined at module scope!
    },
    getKey: (event) => event.id,
    syncMode: 'on-demand', // Loads subsets, but still one shape
  })
)

// =============================================================================
// NEW APPROACH: Multi-shape collection
// =============================================================================
// Solution: Create separate shapes per unique WHERE clause.
// Each shape only receives updates matching its filter.

const eventsCollectionMultiShape = createCollection<Event>({
  id: 'events-multi',
  getKey: (event) => event.id,
  // Use the multi-shape sync instead of standard electric sync
  sync: createMultiShapeSync<Event>({
    id: 'events-multi',
    shapeOptions: {
      url: ELECTRIC_URL,
      params: { table: 'events' },
      // This is the SECURITY BOUNDARY
      // All child shapes must be subsets of this
    },
    getKey: (event) => event.id,
    shapeGcTime: 5000, // GC unused shapes after 5s
  }),
  syncMode: 'on-demand',
})

// =============================================================================
// USAGE IN COMPONENTS
// =============================================================================

// With multi-shape, when you run this query:
//
// const { data } = useLiveQuery((q) =>
//   q.from({ events: eventsCollectionMultiShape })
//    .where(({ events }) => eq(events.userId, 'user-123'))
//    .where(({ events }) => eq(events.type, 'click'))
//    .orderBy(({ events }) => events.createdAt, 'desc')
//    .limit(50)
// )
//
// The system:
// 1. Extracts pushable WHERE: "userId" = 'user-123' AND "type" = 'click'
// 2. Creates/reuses a shape with that WHERE clause
// 3. Only receives updates for events matching that filter
// 4. Applies orderBy/limit client-side (shapes don't support these)
//
// When the component unmounts:
// 1. Shape refCount decrements
// 2. If refCount = 0, shape is GC'd after 5s
// 3. If another component with same filter mounts before GC, shape is reused

// =============================================================================
// ALTERNATIVE: Wrapper function for cleaner API
// =============================================================================

/**
 * Create an Electric collection with multi-shape support.
 *
 * This is a convenience wrapper that provides the same API as
 * electricCollectionOptions but uses multi-shape internally.
 */
export function multiShapeElectricCollectionOptions<T extends Row<unknown>>(config: {
  id?: string
  shapeOptions: { url: string; params: { table: string; where?: string } }
  getKey: (row: T) => string | number
  shapeGcTime?: number
  onInsert?: (params: any) => Promise<any>
  onUpdate?: (params: any) => Promise<any>
  onDelete?: (params: any) => Promise<any>
}) {
  return {
    id: config.id,
    getKey: config.getKey,
    sync: createMultiShapeSync<T>({
      id: config.id,
      shapeOptions: config.shapeOptions as any,
      getKey: config.getKey,
      shapeGcTime: config.shapeGcTime,
    }),
    syncMode: 'on-demand' as const,
    onInsert: config.onInsert,
    onUpdate: config.onUpdate,
    onDelete: config.onDelete,
  }
}

// Usage would be nearly identical to current API:
const eventsCollectionClean = createCollection<Event>(
  multiShapeElectricCollectionOptions({
    id: 'events-clean',
    shapeOptions: {
      url: ELECTRIC_URL,
      params: { table: 'events' },
    },
    getKey: (event) => event.id,
    shapeGcTime: 5000,
  })
)

// =============================================================================
// DATA FLOW COMPARISON
// =============================================================================

/*
CURRENT (single shape + subset loading):

  ┌─────────────────────────────────────────────────────────┐
  │                    Electric Server                       │
  │                                                          │
  │   Table: events (1M inserts/day)                        │
  │                                                          │
  └──────────────────────┬──────────────────────────────────┘
                         │
                         │ ALL changes stream to client
                         │ (even if you only want userId='X')
                         ▼
  ┌─────────────────────────────────────────────────────────┐
  │                   Single ShapeStream                     │
  │                                                          │
  │   Receives: 1M+ messages/day                            │
  │   Client filters: userId='user-123'                     │
  │   Actually needed: ~1000 messages/day                   │
  │                                                          │
  └──────────────────────┬──────────────────────────────────┘
                         │
                         ▼
                    Collection


NEW (multi-shape):

  ┌─────────────────────────────────────────────────────────┐
  │                    Electric Server                       │
  │                                                          │
  │   Table: events (1M inserts/day)                        │
  │                                                          │
  │   Shape A: where="userId"='user-123'  → ~1000/day       │
  │   Shape B: where="userId"='user-456'  → ~500/day        │
  │   Shape C: where="type"='purchase'    → ~10000/day      │
  │                                                          │
  └───────┬─────────────────┬─────────────────┬─────────────┘
          │                 │                 │
          │ Only relevant   │                 │
          │ updates         │                 │
          ▼                 ▼                 ▼
  ┌───────────────┐ ┌───────────────┐ ┌───────────────┐
  │ ShapeStream A │ │ ShapeStream B │ │ ShapeStream C │
  │ refCount: 2   │ │ refCount: 1   │ │ refCount: 0   │
  │               │ │               │ │ (GC pending)  │
  └───────┬───────┘ └───────┬───────┘ └───────────────┘
          │                 │
          └────────┬────────┘
                   │
                   ▼
              Collection
           (merges updates)

*/

// =============================================================================
// EDGE CASES & CONSIDERATIONS
// =============================================================================

/*
1. OVERLAPPING SHAPES
   - Query A: where="userId"='123'
   - Query B: where="userId"='123' AND "type"='click'

   Both shapes may return the same row. The collection handles this:
   - First insert is an insert
   - Subsequent inserts for same key become updates
   - Deletes are only applied if no shape has the row

2. SHAPE LIMITS
   - HTTP/2 multiplexes connections, so many shapes are efficient
   - But there's still overhead per shape (memory, server resources)
   - Could add maxShapes limit with LRU eviction

3. WHERE CLAUSE NORMALIZATION
   - "userId" = '123' vs "userId"='123' should be same shape
   - Need robust SQL normalization or hashing

4. SECURITY
   - Child shapes MUST be subsets of parent shape definition
   - Server enforces this - invalid shapes return error
   - Example: if parent has no WHERE, any child WHERE is allowed
   - Example: if parent has where="orgId"='X', child must include that

5. LIMIT/ORDERBY
   - Cannot be pushed to shapes (Electric limitation)
   - Remain as client-side operations
   - Shape provides the filtered data, client sorts/limits

6. MUST-REFETCH HANDLING
   - Per-shape: only that shape's data is cleared
   - Other shapes continue normally
   - More resilient than single-shape approach
*/

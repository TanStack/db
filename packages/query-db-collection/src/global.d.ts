/**
 * Global type augmentation for @tanstack/query-core
 *
 * This file ensures the module augmentation is always loaded when the package is imported.
 * The index.ts file includes a triple-slash reference to this file, which guarantees
 * TypeScript processes it whenever anyone imports from @tanstack/query-db-collection.
 *
 * This makes ctx.meta?.loadSubsetOptions automatically type-safe without requiring
 * users to manually import QueryCollectionMeta.
 */

import type { LoadSubsetOptions } from "@tanstack/db"

/**
 * Base interface for Query Collection meta properties.
 * Users can extend this interface to add their own custom properties while
 * preserving loadSubsetOptions.
 *
 * @example
 * ```typescript
 * declare module "@tanstack/query-db-collection" {
 *   interface QueryCollectionMeta {
 *     myCustomProperty: string
 *     userId?: number
 *   }
 * }
 * ```
 */
export interface QueryCollectionMeta extends Record<string, unknown> {
  loadSubsetOptions: LoadSubsetOptions
}

// Module augmentation to extend TanStack Query's Register interface
// This ensures that ctx.meta always includes loadSubsetOptions
declare module "@tanstack/query-core" {
  interface Register {
    queryMeta: QueryCollectionMeta
  }
}

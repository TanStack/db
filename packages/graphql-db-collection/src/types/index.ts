import type { LoadSubsetOptions } from "@tanstack/db"
import type { DocumentNode } from "graphql"

/**
 * Supported GraphQL server dialects
 */
export type GraphQLDialect = `hasura` | `postgraphile` | `prisma` | `generic`

/**
 * Sync modes for collections (from TanStack DB v0.5)
 */
export type SyncMode = `on-demand` | `progressive` | `eager`

/**
 * Configuration for the GraphQL endpoint
 */
export interface GraphQLEndpoint {
  http: string
  ws?: string
}

/**
 * Result of planning a subset load operation
 */
export interface PlanResult {
  /** The GraphQL document to execute */
  document: DocumentNode
  /** Variables to pass to the GraphQL operation */
  variables: Record<string, unknown>
  /** Projection info for mapping results back to rows */
  project: SelectionProject
  /** The operation name (for debugging) */
  operationName?: string
}

/**
 * Describes how to extract rows from a GraphQL response
 */
export interface SelectionProject {
  /** Path to the data array in the response (e.g., ['posts', 'nodes']) */
  dataPath: Array<string>
  /** Whether this is a Relay connection (edges/nodes structure) */
  isConnection: boolean
  /** Field mapping (GraphQL field name -> collection field name) */
  fieldMap?: Record<string, string>
  /** Pagination info path (for connections) */
  pageInfoPath?: Array<string>
}

/**
 * Arguments for planning a subset load
 */
export interface PlanSubsetArgs {
  /** The collection/type name */
  collection: string
  /** The subset options from TanStack DB */
  subset?: LoadSubsetOptions
  /** Additional fields to always include */
  requiredFields?: Array<string>
  /** Sync mode for this operation */
  syncMode?: SyncMode
}

/**
 * GraphQL operation type
 */
export type OperationType = `query` | `mutation` | `subscription`

/**
 * Where clause structure (dialect-agnostic)
 */
export interface WhereClause {
  [key: string]: unknown
}

/**
 * Order by clause structure (dialect-agnostic)
 */
export interface OrderByClause {
  field: string
  direction: `asc` | `desc`
}

/**
 * Pagination parameters (dialect-agnostic)
 */
export interface PaginationParams {
  limit?: number
  offset?: number
  after?: string
  before?: string
  first?: number
  last?: number
}

/**
 * Mutation operation types
 */
export type MutationOperation = `insert` | `update` | `delete` | `upsert`

/**
 * Result of a mutation operation
 */
export interface MutationResult<T = unknown> {
  /** The affected rows returned by the server */
  data?: Array<T> | T
  /** Any errors from the mutation */
  errors?: Array<{ message: string; path?: Array<string> }>
}

/**
 * Configuration for a GraphQL collection
 */
export interface GraphQLCollectionConfig {
  /** The GraphQL endpoint */
  endpoint: string | GraphQLEndpoint
  /** Optional headers function */
  headers?: () => Record<string, string> | Promise<Record<string, string>>
  /** The dialect to use */
  dialect?: GraphQLDialect
  /** Default sync mode */
  defaultSyncMode?: SyncMode
  /** Per-type sync mode overrides */
  perTypeSyncMode?: Record<string, SyncMode>
  /** Enable batching (default: true) */
  batching?: boolean
  /** Batch interval in ms (default: 10) */
  batchInterval?: number
}

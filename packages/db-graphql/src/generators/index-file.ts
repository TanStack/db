import type { TypeMetadata } from "../utils/introspection"
import type { GraphQLDialect, SyncMode } from "@tanstack/graphql-db-collection"

/**
 * Generate the main index.ts file
 */

export interface IndexGeneratorConfig {
  metadata: Map<string, TypeMetadata>
  dialect: GraphQLDialect
  defaultSyncMode: SyncMode
  perTypeSyncMode: Record<string, SyncMode>
  namespace?: string
}

export function generateIndexFile(config: IndexGeneratorConfig): string {
  const {
    metadata,
    dialect,
    defaultSyncMode,
    perTypeSyncMode,
    namespace = `GraphQL`,
  } = config

  // Get collection names (only types with id field)
  const collectionNames = Array.from(metadata.values())
    .filter((m) => m.hasId)
    .map((m) => m.name)

  const imports = collectionNames
    .map(
      (name) =>
        `import { create${name}Collection } from './collections/${name}.collection'`
    )
    .join(`\n`)

  const collectionExports = collectionNames
    .map((name) => `    ${name}: create${name}Collection(context),`)
    .join(`\n`)

  return `/**
 * Generated GraphQL DB Client
 * Do not edit manually - regenerate with db-graphql build
 */

import { QueryClient } from '@tanstack/query-core'
import {
  createGraphQLLink,
  createDialectAdapter,
  createPlanner,
  type GraphQLLink,
  type DialectAdapter,
  type GraphQLPlanner,
  type SyncMode,
} from '@tanstack/graphql-db-collection'
${imports}
import type * as Types from './schema/types'

/**
 * Configuration for creating the GraphQL DB
 */
export interface Create${namespace}DbConfig {
  /** TanStack Query client */
  queryClient: QueryClient
  /** GraphQL endpoint URL */
  endpoint: string | { http: string; ws?: string }
  /** Headers function */
  headers?: () => Record<string, string> | Promise<Record<string, string>>
  /** Enable batching (default: true) */
  batching?: boolean
  /** Batch interval in ms (default: 10) */
  batchInterval?: number
}

/**
 * Context passed to collection creators
 */
export interface GraphQLDbContext {
  queryClient: QueryClient
  link: GraphQLLink
  planner: GraphQLPlanner
  dialect: DialectAdapter
  defaultSyncMode: SyncMode
  perTypeSyncMode: Record<string, SyncMode>
}

/**
 * The GraphQL DB instance
 */
export interface ${namespace}Db {
  collections: {
${collectionNames.map((name) => `    ${name}: ReturnType<typeof create${name}Collection>`).join(`\n`)}
  }
  link: GraphQLLink
}

/**
 * Create a ${namespace} DB instance
 *
 * This is the main entry point for using the generated GraphQL client.
 *
 * @example
 * const db = create${namespace}Db({
 *   queryClient,
 *   endpoint: '/graphql',
 * })
 *
 * // Use in a live query
 * const { data } = useLiveQuery((q) =>
 *   q.from({ p: db.collections.Post })
 *    .where(({ p }) => eq(p.published, true))
 *    .orderBy(({ p }) => desc(p.createdAt))
 * )
 */
export function create${namespace}Db(config: Create${namespace}DbConfig): ${namespace}Db {
  const {
    queryClient,
    endpoint,
    headers,
    batching = true,
    batchInterval = 10,
  } = config

  const endpointUrl = typeof endpoint === 'string' ? endpoint : endpoint.http
  const wsEndpoint = typeof endpoint === 'object' ? endpoint.ws : undefined

  // Create the GraphQL link
  const link = createGraphQLLink({
    endpoint: endpointUrl,
    wsEndpoint,
    headers,
    batching,
    batchInterval,
  })

  const dialect = createDialectAdapter('${dialect}')

  // Create the planner with schema metadata
  const schema = new Map()
  // TODO: Populate schema from generated metadata

  const planner = createPlanner(dialect, schema)

  const context: GraphQLDbContext = {
    queryClient,
    link,
    planner,
    dialect,
    defaultSyncMode: '${defaultSyncMode}',
    perTypeSyncMode: ${JSON.stringify(perTypeSyncMode)},
  }

  return {
    collections: {
${collectionExports}
    },
    link,
  }
}

// Re-export types for convenience
export type * from './schema/types'
`
}

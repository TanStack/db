import { queryCollectionOptions } from "@tanstack/query-db-collection"
import { createGraphQLLink } from "./link"
import { createPlanner } from "./planner"
import { createDialectAdapter } from "./dialects"
import { applySelection } from "./selection"
import { createMutationHandlers } from "./mutations"
import type { GraphQLPlanner, TypeInfo } from "./planner"
import type { GraphQLLink } from "./link"
import type { LoadSubsetOptions } from "@tanstack/db"
import type { StandardSchemaV1 } from "@standard-schema/spec"
import type { QueryClient, QueryFunctionContext } from "@tanstack/query-core"
import type {
  QueryCollectionConfig,
  QueryCollectionUtils,
} from "@tanstack/query-db-collection"
import type { GraphQLDialect, SyncMode } from "../types"

/**
 * Configuration for a GraphQL collection
 */
export interface GraphQLCollectionConfig<
  T extends object = object,
  TKey extends string | number = string | number,
  TSchema extends StandardSchemaV1 = never,
> {
  /** Collection ID */
  id: string
  /** Function to extract the key from an item */
  getKey: (item: T) => TKey
  /** Optional schema for validation */
  schema?: TSchema
  /** TanStack Query client */
  queryClient: QueryClient
  /** The GraphQL link for executing operations */
  link: GraphQLLink
  /** The query planner */
  planner: GraphQLPlanner
  /** The dialect adapter */
  dialect: GraphQLDialect
  /** Sync mode for this collection */
  syncMode?: SyncMode
  /** Selection set (scalar fields to fetch) */
  selectionSet?: string
  /** Type information */
  typeInfo: TypeInfo
}

/**
 * Create GraphQL collection options
 *
 * This is a factory that creates a collection configuration for use with
 * TanStack DB's createCollection(). It extends queryCollectionOptions with
 * GraphQL-specific query-driven sync.
 *
 * @example
 * const Post = createCollection(
 *   graphqlCollectionOptions({
 *     id: 'Post',
 *     getKey: (p) => p.id,
 *     queryClient,
 *     link: graphqlLink,
 *     planner: graphqlPlanner,
 *     dialect: 'hasura',
 *     typeInfo: postTypeInfo,
 *   })
 * )
 */
export function graphqlCollectionOptions<
  T extends object,
  TKey extends string | number = string | number,
  TSchema extends StandardSchemaV1 = never,
>(config: GraphQLCollectionConfig<T, TKey, TSchema>) {
  const {
    id,
    getKey,
    schema,
    queryClient,
    link,
    planner,
    dialect: dialectName,
    syncMode = `on-demand`,
    selectionSet = `id\n__typename`,
    typeInfo,
  } = config

  const dialectAdapter = createDialectAdapter(dialectName)

  // Create mutation handlers
  const mutations = createMutationHandlers({
    link,
    dialect: dialectAdapter,
    collection: id,
    selectionSet,
  })

  // Create the queryFn that implements query-driven sync
  const queryFn = async (
    context: QueryFunctionContext<any>
  ): Promise<Array<T>> => {
    // Get the loadSubsetOptions from the context meta
    const loadSubsetOptions = context.meta?.loadSubsetOptions as
      | LoadSubsetOptions
      | undefined

    // Plan the GraphQL operation based on the DB predicates
    const plan = planner.plan({
      collection: id,
      subset: loadSubsetOptions,
      requiredFields: [`id`, `__typename`],
      syncMode,
    })

    // Execute the GraphQL operation
    const response = await link.execute(
      plan.document,
      plan.variables,
      context.signal
    )

    // Extract the rows from the response
    const rows = applySelection<T>(response, plan.project)

    return rows
  }

  // Use queryCollectionOptions as the base
  const baseOptions = queryCollectionOptions<
    TSchema,
    typeof queryFn,
    unknown,
    any,
    TKey
  >({
    id,
    getKey,
    schema: schema as any,
    queryClient,
    queryKey: [`graphql`, id],
    queryFn,
    meta: {
      // This is where TanStack DB will pass loadSubsetOptions
      // for query-driven sync
    },
    // Mutation handlers that patch from result
    onInsert: async ({ transaction, collection }) => {
      const items = transaction.mutations.map((m) => m.modified)
      const result = await mutations.insert(items)

      if (result.errors) {
        throw new Error(result.errors[0].message)
      }

      // Write the server response back to the collection
      // This reconciles server-generated fields (id, timestamps, etc.)
      if (result.data) {
        const rows = Array.isArray(result.data) ? result.data : [result.data]
        collection.write(rows as Array<T>)
      }
    },
    onUpdate: async ({ transaction, collection }) => {
      // Process each update mutation
      for (const mutation of transaction.mutations) {
        const key = mutation.key
        const patch = mutation.modified

        const result = await mutations.update(key, patch)

        if (result.errors) {
          throw new Error(result.errors[0].message)
        }

        // Patch the collection with the server response
        if (result.data) {
          collection.write([result.data as T])
        }
      }
    },
    onDelete: async ({ transaction }) => {
      // Process each delete mutation
      for (const mutation of transaction.mutations) {
        const key = mutation.key

        const result = await mutations.delete(key)

        if (result.errors) {
          throw new Error(result.errors[0].message)
        }

        // The delete is already optimistically applied
        // No need to write anything back
      }
    },
  })

  return baseOptions
}

/**
 * Create a GraphQL DB instance with all collections
 *
 * This is the main entry point for generated code. It sets up the
 * GraphQL link, planner, and returns a factory for creating collections.
 */
export interface CreateGraphQLDbConfig {
  /** TanStack Query client */
  queryClient: QueryClient
  /** GraphQL endpoint URL */
  endpoint: string | { http: string; ws?: string }
  /** Headers function */
  headers?: () => Record<string, string> | Promise<Record<string, string>>
  /** Dialect (hasura, postgraphile, prisma, generic) */
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

/**
 * Create the GraphQL DB infrastructure
 *
 * This is typically called once at app initialization and returns
 * the link, planner, and other shared resources that collections use.
 */
export function createGraphQLDb(config: CreateGraphQLDbConfig) {
  const {
    queryClient,
    endpoint,
    headers,
    dialect = `hasura`,
    defaultSyncMode = `on-demand`,
    perTypeSyncMode = {},
    batching = true,
    batchInterval = 10,
  } = config

  const endpointUrl = typeof endpoint === `string` ? endpoint : endpoint.http
  const wsEndpoint = typeof endpoint === `object` ? endpoint.ws : undefined

  // Create the GraphQL link
  const link = createGraphQLLink({
    endpoint: endpointUrl,
    wsEndpoint,
    headers,
    batching,
    batchInterval,
  })

  const dialectAdapter = createDialectAdapter(dialect)

  return {
    link,
    dialect: dialectAdapter,
    queryClient,
    defaultSyncMode,
    perTypeSyncMode,
  }
}

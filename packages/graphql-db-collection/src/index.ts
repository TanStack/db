/**
 * @tanstack/graphql-db-collection
 *
 * Runtime library for GraphQL-backed TanStack DB collections.
 * Provides query-driven sync, optimistic mutations, and dialect adapters
 * for Hasura, PostGraphile, Prisma, and generic GraphQL servers.
 */

export * from "./runtime"
export * from "./types"

// Re-export key functions for convenience
export {
  graphqlCollectionOptions,
  createGraphQLDb,
  type GraphQLCollectionConfig,
  type CreateGraphQLDbConfig,
} from "./runtime/graphql-collection"

export {
  createGraphQLLink,
  GraphQLLink,
  GraphQLError,
  type GraphQLLinkConfig,
  type GraphQLRequest,
  type GraphQLResponse,
} from "./runtime/link"

export { createDialectAdapter, type DialectAdapter } from "./runtime/dialects"

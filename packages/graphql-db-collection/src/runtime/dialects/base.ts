import type { SimpleComparison } from "@tanstack/query-db-collection"
import type { OrderByClause, WhereClause } from "../../types"

/**
 * Base interface for GraphQL dialect adapters
 *
 * Different GraphQL servers (Hasura, PostGraphile, Prisma, etc.) have
 * different conventions for filters, ordering, and pagination.
 * Dialect adapters translate our normalized representation into
 * server-specific GraphQL arguments.
 */
export interface DialectAdapter {
  /**
   * The dialect name
   */
  readonly name: string

  /**
   * Build a where clause from simple comparisons
   *
   * @param comparisons - Parsed comparisons from DB predicates
   * @param collection - The collection/type name
   * @returns Server-specific where clause object
   */
  buildWhereClause: (
    comparisons: Array<SimpleComparison>,
    collection: string
  ) => WhereClause

  /**
   * Format an order by clause for the server
   *
   * @param orderBy - Normalized order by clauses
   * @returns Server-specific order by format
   */
  formatOrderBy: (orderBy: Array<OrderByClause>) => unknown

  /**
   * Get the GraphQL type name for where clauses
   *
   * @param collection - The collection/type name
   * @returns The GraphQL input type name for where clauses
   */
  getWhereTypeName: (collection: string) => string

  /**
   * Get the GraphQL type name for order by
   *
   * @param collection - The collection/type name
   * @returns The GraphQL input type name for order by
   */
  getOrderByTypeName: (collection: string) => string

  /**
   * Get the query field name for a collection
   *
   * @param collection - The collection/type name
   * @returns The GraphQL query field name (e.g., "posts", "allPosts")
   */
  getQueryFieldName: (collection: string) => string

  /**
   * Get the mutation field names for a collection
   *
   * @param collection - The collection/type name
   * @returns Object with insert, update, delete, upsert field names
   */
  getMutationFieldNames: (collection: string) => {
    insert: string
    update: string
    delete: string
    upsert?: string
  }

  /**
   * Whether this dialect supports Relay connections
   */
  supportsConnections: () => boolean

  /**
   * Whether this dialect supports batch mutations
   */
  supportsBatchMutations: () => boolean
}

/**
 * Operator mapping for common comparison operators
 */
export const OperatorMap = {
  eq: `=`,
  ne: `!=`,
  gt: `>`,
  gte: `>=`,
  lt: `<`,
  lte: `<=`,
  in: `IN`,
  notIn: `NOT IN`,
  like: `LIKE`,
  ilike: `ILIKE`,
  isNull: `IS NULL`,
  isNotNull: `IS NOT NULL`,
} as const

/**
 * Helper to pluralize a type name (simple version)
 */
export function pluralize(name: string): string {
  // Simple pluralization logic
  if (name.endsWith(`y`)) {
    return name.slice(0, -1) + `ies`
  }
  if (name.endsWith(`s`)) {
    return name + `es`
  }
  return name + `s`
}

/**
 * Helper to convert to camelCase
 */
export function camelCase(str: string): string {
  return str.charAt(0).toLowerCase() + str.slice(1)
}

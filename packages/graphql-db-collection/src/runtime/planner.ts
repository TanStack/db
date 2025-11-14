import {
  extractSimpleComparisons,
  parseOrderByExpression,
  parseWhereExpression,
} from "@tanstack/query-db-collection"
import { parse, print } from "graphql"
import type {
  ParsedOrderBy,
  SimpleComparison,
} from "@tanstack/query-db-collection"
import type {
  GraphQLDialect,
  OrderByClause,
  PaginationParams,
  PlanResult,
  PlanSubsetArgs,
  SelectionProject,
  WhereClause,
} from "../types"
import type { DialectAdapter } from "./dialects/base"

/**
 * GraphQL Query Planner
 *
 * Converts TanStack DB predicate ASTs (from loadSubsetOptions) into
 * GraphQL operations. This is the heart of query-driven sync for GraphQL.
 */
export class GraphQLPlanner {
  constructor(
    private dialect: DialectAdapter,
    private schema: Map<string, TypeInfo>
  ) {}

  /**
   * Plan a subset load operation
   *
   * Takes the DB's loadSubsetOptions (where/orderBy/limit/offset) and
   * translates them into a GraphQL query document with variables.
   */
  plan(args: PlanSubsetArgs): PlanResult {
    const { collection, subset, requiredFields = [`id`, `__typename`] } = args

    // Parse the DB predicate expressions
    const where = subset?.where
      ? this.buildWhereClause(subset.where, collection)
      : undefined

    const orderBy = subset?.orderBy
      ? this.buildOrderByClause(subset.orderBy)
      : undefined

    const pagination = this.buildPaginationParams(subset)

    // Get type info from schema
    const typeInfo = this.schema.get(collection)
    if (!typeInfo) {
      throw new Error(`Type ${collection} not found in schema`)
    }

    // Determine if this type uses Relay connections
    const isConnection = typeInfo.hasConnection

    // Build the selection set
    const selection = this.buildSelectionSet(
      collection,
      requiredFields,
      typeInfo.scalarFields
    )

    // Generate the GraphQL operation
    const { document, variables } = this.generateQueryDocument({
      collection,
      where,
      orderBy,
      pagination,
      selection,
      isConnection,
    })

    // Build projection info
    const project: SelectionProject = {
      dataPath: isConnection
        ? [this.getQueryFieldName(collection), `nodes`]
        : [this.getQueryFieldName(collection)],
      isConnection,
      pageInfoPath: isConnection
        ? [this.getQueryFieldName(collection), `pageInfo`]
        : undefined,
    }

    return {
      document,
      variables,
      project,
      operationName: `Load${collection}`,
    }
  }

  /**
   * Build a where clause from DB predicate AST
   */
  private buildWhereClause(expression: any, collection: string): WhereClause {
    try {
      // Use TanStack DB's expression parser
      const comparisons = extractSimpleComparisons(expression)

      // Convert to dialect-specific where clause
      return this.dialect.buildWhereClause(comparisons, collection)
    } catch (error) {
      console.warn(
        `Failed to parse where expression, falling back to broad query:`,
        error
      )
      return {}
    }
  }

  /**
   * Build order by clause from DB orderBy AST
   */
  private buildOrderByClause(expression: any): Array<OrderByClause> {
    try {
      const parsed = parseOrderByExpression(expression)

      return parsed.map((item) => ({
        field: this.extractFieldName(item),
        direction: item.direction,
      }))
    } catch (error) {
      console.warn(`Failed to parse orderBy expression:`, error)
      return []
    }
  }

  /**
   * Extract field name from parsed order by item
   */
  private extractFieldName(item: ParsedOrderBy): string {
    // The field path is typically like ['p', 'createdAt']
    // We want just the field name
    if (Array.isArray(item.field)) {
      return item.field[item.field.length - 1] as string
    }
    return item.field as string
  }

  /**
   * Build pagination parameters
   */
  private buildPaginationParams(subset: any): PaginationParams {
    return {
      limit: subset?.limit,
      offset: subset?.offset,
    }
  }

  /**
   * Build a selection set for a type
   */
  private buildSelectionSet(
    collection: string,
    requiredFields: Array<string>,
    scalarFields: Array<string>
  ): string {
    // Combine required fields with scalar fields, dedupe
    const fields = Array.from(new Set([...requiredFields, ...scalarFields]))

    return fields.join(`\n      `)
  }

  /**
   * Generate the GraphQL query document
   */
  private generateQueryDocument(params: {
    collection: string
    where?: WhereClause
    orderBy?: Array<OrderByClause>
    pagination: PaginationParams
    selection: string
    isConnection: boolean
  }): { document: any; variables: Record<string, unknown> } {
    const { collection, where, orderBy, pagination, selection, isConnection } =
      params

    // Build the argument list for the query field
    const args: Array<string> = []
    const variables: Record<string, unknown> = {}

    if (where && Object.keys(where).length > 0) {
      args.push(`where: $where`)
      variables.where = where
    }

    if (orderBy && orderBy.length > 0) {
      const orderByArg = this.dialect.formatOrderBy(orderBy)
      args.push(`orderBy: $orderBy`)
      variables.orderBy = orderByArg
    }

    // Add pagination args based on connection vs list
    if (isConnection) {
      if (pagination.limit) {
        args.push(`first: $first`)
        variables.first = pagination.limit
      }
      if (pagination.offset) {
        // Convert offset to cursor-based (this is simplified)
        // In production, you'd need actual cursor tracking
        console.warn(
          `Offset pagination with connections requires cursor mapping`
        )
      }
    } else {
      if (pagination.limit !== undefined) {
        args.push(`limit: $limit`)
        variables.limit = pagination.limit
      }
      if (pagination.offset !== undefined) {
        args.push(`offset: $offset`)
        variables.offset = pagination.offset
      }
    }

    const queryFieldName = this.getQueryFieldName(collection)
    const argsStr = args.length > 0 ? `(${args.join(`, `)})` : ``

    // Build the query
    let queryBody: string
    if (isConnection) {
      queryBody = `
        ${queryFieldName}${argsStr} {
          nodes {
            ${selection}
          }
          pageInfo {
            hasNextPage
            hasPreviousPage
            startCursor
            endCursor
          }
        }
      `
    } else {
      queryBody = `
        ${queryFieldName}${argsStr} {
          ${selection}
        }
      `
    }

    // Build variable definitions
    const varDefs: Array<string> = []
    if (variables.where)
      varDefs.push(`$where: ` + this.dialect.getWhereTypeName(collection))
    if (variables.orderBy)
      varDefs.push(`$orderBy: ` + this.dialect.getOrderByTypeName(collection))
    if (variables.first !== undefined) varDefs.push(`$first: Int`)
    if (variables.limit !== undefined) varDefs.push(`$limit: Int`)
    if (variables.offset !== undefined) varDefs.push(`$offset: Int`)

    const varDefsStr = varDefs.length > 0 ? `(${varDefs.join(`, `)})` : ``

    const query = `
      query Load${collection}${varDefsStr} {
        ${queryBody}
      }
    `

    const document = parse(query)

    return { document, variables }
  }

  /**
   * Get the GraphQL query field name for a collection
   * e.g., "Post" -> "posts" or "allPosts" depending on dialect
   */
  private getQueryFieldName(collection: string): string {
    return this.dialect.getQueryFieldName(collection)
  }
}

/**
 * Type information from the schema
 */
export interface TypeInfo {
  name: string
  scalarFields: Array<string>
  relationFields: Array<string>
  hasConnection: boolean
  hasList: boolean
}

/**
 * Create a planner instance
 */
export function createPlanner(
  dialect: DialectAdapter,
  schema: Map<string, TypeInfo>
): GraphQLPlanner {
  return new GraphQLPlanner(dialect, schema)
}

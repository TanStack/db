import { camelCase, pluralize } from "./base"
import type { DialectAdapter } from "./base"
import type { SimpleComparison } from "@tanstack/query-db-collection"
import type { OrderByClause, WhereClause } from "../../types"

/**
 * Prisma GraphQL dialect adapter
 *
 * For Prisma GraphQL API (if using graphql-yoga or similar):
 * - Where clauses: { field: { equals: value }, AND: [...], OR: [...] }
 * - Order by: [{ field: asc }, { field2: desc }]
 * - Query fields: camelCase plural (e.g., "users", "posts")
 * - Mutations: create<Type>, update<Type>, delete<Type>
 */
export class PrismaDialect implements DialectAdapter {
  readonly name = `prisma`

  buildWhereClause(
    comparisons: Array<SimpleComparison>,
    _collection: string
  ): WhereClause {
    if (comparisons.length === 0) {
      return {}
    }

    const conditions: Array<WhereClause> = []

    for (const comp of comparisons) {
      const field = this.extractFieldPath(comp)
      const cond = this.buildSingleComparison(field, comp)
      if (cond) conditions.push(cond)
    }

    if (conditions.length === 0) {
      return {}
    }

    if (conditions.length === 1) {
      return conditions[0]
    }

    return { AND: conditions }
  }

  private buildSingleComparison(
    field: string,
    comp: SimpleComparison
  ): WhereClause | null {
    const operator = comp.operator
    const value = comp.value

    // Map operators to Prisma operators
    switch (operator) {
      case `eq`:
        return { [field]: { equals: value } }
      case `ne`:
        return { [field]: { not: value } }
      case `gt`:
        return { [field]: { gt: value } }
      case `gte`:
        return { [field]: { gte: value } }
      case `lt`:
        return { [field]: { lt: value } }
      case `lte`:
        return { [field]: { lte: value } }
      case `in`:
        return { [field]: { in: value } }
      case `notIn`:
        return { [field]: { notIn: value } }
      case `like`:
        return { [field]: { contains: value } }
      case `ilike`:
        // Prisma doesn't have case-insensitive by default in where
        // You'd need to use mode: 'insensitive'
        return { [field]: { contains: value, mode: `insensitive` } }
      case `isNull`:
        return { [field]: { equals: null } }
      default:
        console.warn(`Unsupported operator for Prisma: ${operator}`)
        return null
    }
  }

  private extractFieldPath(comp: SimpleComparison): string {
    if (`field` in comp && typeof comp.field === `string`) {
      return comp.field
    }
    if (`left` in comp && Array.isArray(comp.left)) {
      return comp.left[comp.left.length - 1] as string
    }
    return `unknown`
  }

  formatOrderBy(orderBy: Array<OrderByClause>): unknown {
    // Prisma format: [{ field: 'asc' }, { field2: 'desc' }]
    return orderBy.map((o) => ({
      [o.field]: o.direction,
    }))
  }

  getWhereTypeName(collection: string): string {
    // Prisma convention: <Type>WhereInput
    return `${collection}WhereInput`
  }

  getOrderByTypeName(collection: string): string {
    // Prisma convention: [<Type>OrderByInput!]
    return `[${collection}OrderByInput!]`
  }

  getQueryFieldName(collection: string): string {
    // Prisma uses camelCase plural
    return camelCase(pluralize(collection))
  }

  getMutationFieldNames(collection: string): {
    insert: string
    update: string
    delete: string
    upsert?: string
  } {
    return {
      insert: `createOne${collection}`,
      update: `updateOne${collection}`,
      delete: `deleteOne${collection}`,
      upsert: `upsertOne${collection}`,
    }
  }

  supportsConnections(): boolean {
    return false // Prisma GraphQL typically uses simple lists
  }

  supportsBatchMutations(): boolean {
    return true // Prisma supports createMany, updateMany, deleteMany
  }
}

/**
 * Create a Prisma dialect adapter
 */
export function createPrismaDialect(): PrismaDialect {
  return new PrismaDialect()
}

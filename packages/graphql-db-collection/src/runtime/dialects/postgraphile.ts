import { camelCase, pluralize } from "./base"
import type { DialectAdapter } from "./base"
import type { SimpleComparison } from "@tanstack/query-db-collection"
import type { OrderByClause, WhereClause } from "../../types"

/**
 * PostGraphile GraphQL dialect adapter
 *
 * PostGraphile uses:
 * - Where clauses: { filter: { field: { equalTo: value }, and: [...], or: [...] } }
 * - Order by: [FIELD_ASC, FIELD2_DESC] (enum-based)
 * - Query fields: "all<PluralType>" (e.g., "allUsers", "allPosts")
 * - Supports Relay connections by default
 * - Mutations: create<Type>, update<Type>ById, delete<Type>ById
 */
export class PostGraphileDialect implements DialectAdapter {
  readonly name = `postgraphile`

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

    return { and: conditions }
  }

  private buildSingleComparison(
    field: string,
    comp: SimpleComparison
  ): WhereClause | null {
    const operator = comp.operator
    const value = comp.value

    // Map operators to PostGraphile operators
    switch (operator) {
      case `eq`:
        return { [field]: { equalTo: value } }
      case `ne`:
        return { [field]: { notEqualTo: value } }
      case `gt`:
        return { [field]: { greaterThan: value } }
      case `gte`:
        return { [field]: { greaterThanOrEqualTo: value } }
      case `lt`:
        return { [field]: { lessThan: value } }
      case `lte`:
        return { [field]: { lessThanOrEqualTo: value } }
      case `in`:
        return { [field]: { in: value } }
      case `notIn`:
        return { [field]: { notIn: value } }
      case `like`:
        return { [field]: { like: value } }
      case `ilike`:
        return { [field]: { likeInsensitive: value } }
      case `isNull`:
        return { [field]: { isNull: value } }
      default:
        console.warn(`Unsupported operator for PostGraphile: ${operator}`)
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
    // PostGraphile uses enum-based ordering: [FIELD_ASC, FIELD2_DESC]
    return orderBy.map((o) => {
      const field = o.field.toUpperCase()
      const direction = o.direction.toUpperCase()
      return `${field}_${direction}`
    })
  }

  getWhereTypeName(collection: string): string {
    // PostGraphile convention: <Type>Filter
    return `${collection}Filter`
  }

  getOrderByTypeName(collection: string): string {
    // PostGraphile convention: [<Type>OrderBy!]
    return `[${pluralize(collection)}OrderBy!]`
  }

  getQueryFieldName(collection: string): string {
    // PostGraphile uses "all<PluralType>"
    return `all${pluralize(collection)}`
  }

  getMutationFieldNames(collection: string): {
    insert: string
    update: string
    delete: string
    upsert?: string
  } {
    return {
      insert: `create${collection}`,
      update: `update${collection}ById`,
      delete: `delete${collection}ById`,
      // PostGraphile doesn't have built-in upsert, but you can use plugins
      upsert: undefined,
    }
  }

  supportsConnections(): boolean {
    return true // PostGraphile uses Relay connections by default
  }

  supportsBatchMutations(): boolean {
    return false // PostGraphile doesn't support batch mutations by default
  }
}

/**
 * Create a PostGraphile dialect adapter
 */
export function createPostGraphileDialect(): PostGraphileDialect {
  return new PostGraphileDialect()
}

import { camelCase, pluralize } from "./base"
import type { DialectAdapter } from "./base"
import type { SimpleComparison } from "@tanstack/query-db-collection"
import type { OrderByClause, WhereClause } from "../../types"

/**
 * Hasura GraphQL dialect adapter
 *
 * Hasura uses a specific convention:
 * - Where clauses: { field: { _eq: value }, _and: [...], _or: [...] }
 * - Order by: [{ field: asc }, { field2: desc }]
 * - Query fields: camelCase plural (e.g., "users", "posts")
 * - Mutations: insert_<table>, update_<table>, delete_<table>
 */
export class HasuraDialect implements DialectAdapter {
  readonly name = `hasura`

  buildWhereClause(
    comparisons: Array<SimpleComparison>,
    _collection: string
  ): WhereClause {
    if (comparisons.length === 0) {
      return {}
    }

    // Group by field to handle multiple conditions on same field
    const grouped = new Map<string, Array<SimpleComparison>>()

    for (const comp of comparisons) {
      const fieldPath = this.extractFieldPath(comp)
      const existing = grouped.get(fieldPath) || []
      existing.push(comp)
      grouped.set(fieldPath, existing)
    }

    const conditions: Array<WhereClause> = []

    for (const [field, comps] of grouped) {
      if (comps.length === 1) {
        const cond = this.buildSingleComparison(field, comps[0])
        if (cond) conditions.push(cond)
      } else {
        // Multiple conditions on same field - combine with _and
        const subConditions = comps
          .map((c) => this.buildSingleComparison(field, c))
          .filter(Boolean)
        if (subConditions.length > 0) {
          conditions.push({ _and: subConditions })
        }
      }
    }

    if (conditions.length === 0) {
      return {}
    }

    if (conditions.length === 1) {
      return conditions[0]
    }

    return { _and: conditions }
  }

  private buildSingleComparison(
    field: string,
    comp: SimpleComparison
  ): WhereClause | null {
    const operator = comp.operator
    const value = comp.value

    // Map operators to Hasura operators
    switch (operator) {
      case `eq`:
        return { [field]: { _eq: value } }
      case `ne`:
        return { [field]: { _neq: value } }
      case `gt`:
        return { [field]: { _gt: value } }
      case `gte`:
        return { [field]: { _gte: value } }
      case `lt`:
        return { [field]: { _lt: value } }
      case `lte`:
        return { [field]: { _lte: value } }
      case `in`:
        return { [field]: { _in: value } }
      case `notIn`:
        return { [field]: { _nin: value } }
      case `like`:
        return { [field]: { _like: value } }
      case `ilike`:
        return { [field]: { _ilike: value } }
      case `isNull`:
        return { [field]: { _is_null: value } }
      default:
        console.warn(`Unsupported operator for Hasura: ${operator}`)
        return null
    }
  }

  private extractFieldPath(comp: SimpleComparison): string {
    // Extract field name from the comparison
    // The field is typically stored in comp.field or comp.left
    if (`field` in comp && typeof comp.field === `string`) {
      return comp.field
    }
    // Fallback: try to extract from left side if it's an array
    if (`left` in comp && Array.isArray(comp.left)) {
      return comp.left[comp.left.length - 1] as string
    }
    return `unknown`
  }

  formatOrderBy(orderBy: Array<OrderByClause>): unknown {
    // Hasura format: [{ field: asc }, { field2: desc }]
    return orderBy.map((o) => ({
      [o.field]: o.direction,
    }))
  }

  getWhereTypeName(collection: string): string {
    // Hasura convention: <table>_bool_exp
    return `${collection}_bool_exp`
  }

  getOrderByTypeName(collection: string): string {
    // Hasura convention: [<table>_order_by!]
    return `[${collection}_order_by!]`
  }

  getQueryFieldName(collection: string): string {
    // Hasura uses camelCase plural of the table name
    return camelCase(pluralize(collection))
  }

  getMutationFieldNames(collection: string): {
    insert: string
    update: string
    delete: string
    upsert?: string
  } {
    const tableName = collection.toLowerCase()
    return {
      insert: `insert_${tableName}`,
      update: `update_${tableName}`,
      delete: `delete_${tableName}`,
      upsert: `insert_${tableName}`, // Hasura uses insert with on_conflict for upsert
    }
  }

  supportsConnections(): boolean {
    return false // Hasura doesn't use Relay connections by default
  }

  supportsBatchMutations(): boolean {
    return true // Hasura supports batch inserts/updates
  }
}

/**
 * Create a Hasura dialect adapter
 */
export function createHasuraDialect(): HasuraDialect {
  return new HasuraDialect()
}

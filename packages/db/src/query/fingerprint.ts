/**
 * Lightweight query fingerprinting for change detection.
 *
 * This module provides a fast way to generate a fingerprint string from a QueryIR
 * that can be used to detect when a query has changed. The fingerprint is designed
 * to be computed on every render, so it prioritizes speed over perfect uniqueness.
 *
 * The fingerprint captures:
 * - Collection references (by collection id)
 * - Property references (paths)
 * - Literal values (primitives and simple objects)
 * - Function/operator names and their arguments
 * - Query structure (where, select, join, orderBy, limit, offset, etc.)
 */

import { CollectionRef, Func, PropRef, QueryRef, Value } from "./ir.js"
import type {
  Aggregate,
  BasicExpression,
  JoinClause,
  OrderByClause,
  QueryIR,
  Select,
  Where,
} from "./ir.js"

/**
 * Generate a lightweight fingerprint string from a QueryIR.
 *
 * This is designed to be fast enough to run on every render. It walks the
 * query structure and concatenates key identifying information into a string.
 *
 * @param query - The QueryIR to fingerprint
 * @returns A string fingerprint that changes when the query changes
 */
export function getQueryFingerprint(query: QueryIR): string {
  const parts: Array<string> = []

  // From clause
  parts.push(`F:${fingerprintFrom(query.from)}`)

  // Join clauses
  if (query.join && query.join.length > 0) {
    parts.push(`J:${query.join.map(fingerprintJoin).join(`,`)}`)
  }

  // Where clauses
  if (query.where && query.where.length > 0) {
    parts.push(`W:${query.where.map(fingerprintWhere).join(`&`)}`)
  }

  // Select clause
  if (query.select) {
    parts.push(`S:${fingerprintSelect(query.select)}`)
  }

  // Group by
  if (query.groupBy && query.groupBy.length > 0) {
    parts.push(`G:${query.groupBy.map(fingerprintExpression).join(`,`)}`)
  }

  // Having clauses
  if (query.having && query.having.length > 0) {
    parts.push(`H:${query.having.map(fingerprintWhere).join(`&`)}`)
  }

  // Order by
  if (query.orderBy && query.orderBy.length > 0) {
    parts.push(`O:${query.orderBy.map(fingerprintOrderBy).join(`,`)}`)
  }

  // Limit
  if (query.limit !== undefined) {
    parts.push(`L:${query.limit}`)
  }

  // Offset
  if (query.offset !== undefined) {
    parts.push(`X:${query.offset}`)
  }

  // Distinct flag
  if (query.distinct) {
    parts.push(`D`)
  }

  // Single result flag
  if (query.singleResult) {
    parts.push(`1`)
  }

  return parts.join(`|`)
}

function fingerprintFrom(from: CollectionRef | QueryRef): string {
  if (from instanceof CollectionRef) {
    return `c:${from.collection.id}:${from.alias}`
  } else if (from instanceof QueryRef) {
    return `q:${from.alias}:(${getQueryFingerprint(from.query)})`
  }
  // Fallback for edge cases
  return `?`
}

function fingerprintJoin(join: JoinClause): string {
  const from = fingerprintFrom(join.from)
  const left = fingerprintExpression(join.left)
  const right = fingerprintExpression(join.right)
  return `${join.type}:${from}:${left}=${right}`
}

function fingerprintWhere(where: Where): string {
  if (typeof where === `object` && `expression` in where) {
    const residual = where.residual ? `r:` : ``
    return `${residual}${fingerprintExpression(where.expression)}`
  }
  return fingerprintExpression(where as BasicExpression)
}

function fingerprintSelect(select: Select): string {
  const entries = Object.entries(select)
    .map(([key, value]) => {
      if (!isExpression(value)) {
        // Nested select object
        return `${key}:{${fingerprintSelect(value as Select)}}`
      }
      return `${key}:${fingerprintExpressionOrAggregate(value as BasicExpression | Aggregate)}`
    })
    .join(`,`)
  return entries
}

function fingerprintOrderBy(orderBy: OrderByClause): string {
  const expr = fingerprintExpression(orderBy.expression)
  const dir = orderBy.compareOptions.direction
  return `${expr}:${dir}`
}

function fingerprintExpression(expr: BasicExpression): string {
  if (expr instanceof PropRef) {
    return `r:${expr.path.join(`.`)}`
  }

  if (expr instanceof Value) {
    return `v:${fingerprintValue(expr.value)}`
  }

  if (expr instanceof Func) {
    const args = expr.args.map(fingerprintExpression).join(`,`)
    return `f:${expr.name}(${args})`
  }

  // Fallback for unrecognized types - check by type property
  const exprAny = expr as any
  if (exprAny.type === `ref` && exprAny.path) {
    return `r:${exprAny.path.join(`.`)}`
  }
  if (exprAny.type === `val`) {
    return `v:${fingerprintValue(exprAny.value)}`
  }
  if (exprAny.type === `func`) {
    const args = (exprAny.args || []).map(fingerprintExpression).join(`,`)
    return `f:${exprAny.name}(${args})`
  }

  return `?`
}

function fingerprintExpressionOrAggregate(
  expr: BasicExpression | Aggregate
): string {
  // Check for aggregate
  const exprAny = expr as any
  if (exprAny.type === `agg`) {
    const args = (exprAny.args || []).map(fingerprintExpression).join(`,`)
    return `a:${exprAny.name}(${args})`
  }

  return fingerprintExpression(expr as BasicExpression)
}

function fingerprintValue(value: unknown): string {
  if (value === null) return `null`
  if (value === undefined) return `undefined`

  const type = typeof value
  if (type === `string`) return `s:${value}`
  if (type === `number`) return `n:${value}`
  if (type === `boolean`) return `b:${value}`

  if (value instanceof Date) {
    return `d:${value.getTime()}`
  }

  if (Array.isArray(value)) {
    // For arrays, fingerprint each element
    return `[${value.map(fingerprintValue).join(`,`)}]`
  }

  if (type === `object`) {
    // For objects, create a simple fingerprint from sorted keys and values
    // This handles common cases like { min: 10, max: 20 }
    try {
      const entries = Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}:${fingerprintValue(v)}`)
        .join(`,`)
      return `{${entries}}`
    } catch {
      // If we can't iterate, use a placeholder
      return `{?}`
    }
  }

  // For functions or other types, we can't easily fingerprint
  // Use a placeholder that will cause mismatches if the reference changes
  return `?:${type}`
}

function isExpression(value: unknown): boolean {
  if (value === null || typeof value !== `object`) return false
  const type = (value as any).type
  return type === `ref` || type === `val` || type === `func` || type === `agg`
}

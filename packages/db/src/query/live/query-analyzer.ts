/**
 * Query Analysis System
 *
 * Analyzes query structure to determine if it can use pooling optimization
 */

import { Func, PropRef, Value, getWhereExpression } from "../ir.js"
import type { BasicExpression, QueryIR } from "../ir.js"
import type { QueryParameters, QuerySignature } from "./query-pool.js"

/**
 * Result of analyzing a query for poolability
 */
export interface QueryAnalysis {
  isPoolable: boolean
  signature: QuerySignature | null
  parameters: QueryParameters | null
  reason?: string
}

/**
 * Analyze a query to determine if it can be pooled
 */
export function analyzeQuery(queryIR: QueryIR): QueryAnalysis {
  // Check 1: Must be from a single collection (no joins)
  if (queryIR.join && queryIR.join.length > 0) {
    return {
      isPoolable: false,
      signature: null,
      parameters: null,
      reason: `Query has joins`,
    }
  }

  // Check 2: Must be a collection reference (not a subquery)
  if (queryIR.from.type !== `collectionRef`) {
    return {
      isPoolable: false,
      signature: null,
      parameters: null,
      reason: `Query uses subquery in FROM`,
    }
  }

  // Check 3: No aggregations
  if (queryIR.groupBy || queryIR.having) {
    return {
      isPoolable: false,
      signature: null,
      parameters: null,
      reason: `Query has aggregations`,
    }
  }

  // Check 4: No ORDER BY + LIMIT (windowing)
  if (queryIR.orderBy && queryIR.limit) {
    return {
      isPoolable: false,
      signature: null,
      parameters: null,
      reason: `Query has ORDER BY + LIMIT (windowing)`,
    }
  }

  // Check 5: No functional WHERE clauses
  if (queryIR.fnWhere && queryIR.fnWhere.length > 0) {
    return {
      isPoolable: false,
      signature: null,
      parameters: null,
      reason: `Query has functional WHERE clauses`,
    }
  }

  // Check 6: Must have WHERE clause for parameterization to be useful
  if (!queryIR.where || queryIR.where.length === 0) {
    return {
      isPoolable: false,
      signature: null,
      parameters: null,
      reason: `Query has no WHERE clause (pooling not beneficial)`,
    }
  }

  // Analyze WHERE clauses to extract parameters
  const whereAnalysis = analyzeWhereClause(queryIR.where)
  if (!whereAnalysis.success) {
    return {
      isPoolable: false,
      signature: null,
      parameters: null,
      reason: whereAnalysis.reason,
    }
  }

  // Create query signature (structure without parameter values)
  // We know from.type === "collectionRef" from check above
  const collectionId = (queryIR.from as any).collection.id
  const signature: QuerySignature = {
    collectionId,
    structureHash: createStructureHash(queryIR),
  }

  return {
    isPoolable: true,
    signature,
    parameters: whereAnalysis.parameters!,
  }
}

/**
 * Analyze WHERE clause to extract parameters
 */
function analyzeWhereClause(where: Array<any>): {
  success: boolean
  parameters?: QueryParameters
  reason?: string
} {
  const parameters: QueryParameters = {}

  for (const clause of where) {
    const expression = getWhereExpression(clause)

    // Currently only support simple eq() comparisons and and() combinations
    const result = extractParameters(expression, parameters)
    if (!result.success) {
      return result
    }
  }

  return { success: true, parameters }
}

/**
 * Extract parameters from expression tree
 */
function extractParameters(
  expression: BasicExpression,
  parameters: QueryParameters
): { success: boolean; reason?: string } {
  if (expression instanceof Func) {
    const { name, args } = expression

    if (name === `and` || name === `or`) {
      // Recursively extract from logical operators
      for (const arg of args) {
        const result = extractParameters(arg, parameters)
        if (!result.success) return result
      }
      return { success: true }
    }

    if (name === `eq`) {
      // Extract parameter from eq(field, value)
      if (args.length !== 2) {
        return { success: false, reason: `eq() requires exactly 2 arguments` }
      }

      const [left, right] = args

      // Left side should be a PropRef (field reference)
      if (!(left instanceof PropRef)) {
        return {
          success: false,
          reason: `eq() left side must be a field reference`,
        }
      }

      // Right side should be a Value (parameter)
      if (!(right instanceof Value)) {
        return {
          success: false,
          reason: `eq() right side must be a value (not another field reference)`,
        }
      }

      // Store parameter
      const fieldPath = left.path.join(`.`)
      parameters[fieldPath] = right.value

      return { success: true }
    }

    // Other functions not yet supported
    return {
      success: false,
      reason: `Function ${name} not supported for pooling`,
    }
  }

  return {
    success: false,
    reason: `WHERE clause must use function expressions`,
  }
}

/**
 * Create a hash representing the query structure (without parameter values)
 */
function createStructureHash(queryIR: QueryIR): string {
  // For now, simple string representation
  // In production, use a proper hash function
  const parts: Array<string> = []

  // FROM clause
  if (queryIR.from.type === `collectionRef`) {
    parts.push(`from:${queryIR.from.collection.id}`)
  }

  // WHERE clause structure (without values)
  if (queryIR.where) {
    const whereStructure = queryIR.where
      .map((w) => getExpressionStructure(getWhereExpression(w)))
      .join(`&`)
    parts.push(`where:${whereStructure}`)
  }

  // SELECT clause
  if (queryIR.select) {
    parts.push(`select:${JSON.stringify(Object.keys(queryIR.select).sort())}`)
  } else if (queryIR.fnSelect) {
    parts.push(`select:fn`)
  }

  // DISTINCT
  if (queryIR.distinct) {
    parts.push(`distinct`)
  }

  // SINGLE RESULT
  if (queryIR.singleResult) {
    parts.push(`single`)
  }

  return parts.join(`|`)
}

/**
 * Get structure of expression tree (without values)
 */
function getExpressionStructure(expression: BasicExpression): string {
  if (expression instanceof PropRef) {
    return `ref:${expression.path.join(`.`)}`
  }

  if (expression instanceof Value) {
    return `val`
  }

  if (expression instanceof Func) {
    const argStructures = expression.args.map(getExpressionStructure).join(`,`)
    return `${expression.name}(${argStructures})`
  }

  return `unknown`
}

/**
 * Extract parameter key from a record for indexing
 * This determines which query instances should receive updates for this record
 */
export function createParameterKeyExtractor(
  parameters: QueryParameters
): (record: any) => string {
  const fields = Object.keys(parameters)

  return (record: any) => {
    // Build key from all parameter fields
    // e.g., if parameters are { rowId: "0|0", side: "a" }
    // then the key for a record is `${record.rowId}|${record.side}`
    const keyParts = fields.map((field) => {
      // Handle nested fields (e.g., "item.rowId")
      const path = field.split(`.`)
      let value = record

      for (const part of path) {
        value = value?.[part]
      }

      return String(value ?? `null`)
    })

    return keyParts.join(`|`)
  }
}

/**
 * Create parameter matcher function
 * This checks if a record matches the given parameter values
 */
export function createParameterMatcher(
  parameters: QueryParameters
): (record: any, params: QueryParameters) => boolean {
  const fields = Object.keys(parameters)

  return (record: any, params: QueryParameters) => {
    // Check if all parameter fields match
    for (const field of fields) {
      const path = field.split(`.`)
      let value = record

      for (const part of path) {
        value = value?.[part]
      }

      if (value !== params[field]) {
        return false
      }
    }

    return true
  }
}

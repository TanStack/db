import { CollectionImpl } from "../../collection/index.js"
import { CollectionRef, QueryRef } from "../ir.js"
import type { Source } from "../builder/types.js"
import type { FromClause } from "./types.js"
import { registry } from "./core.js"
import type { QueryIR } from "../ir.js"
import {
  InvalidSourceError,
  InvalidSourceTypeError,
  OnlyOneSourceAllowedError,
  SubQueryMustHaveFromClauseError,
} from "../../errors.js"
import type { Query } from "./types.js"
import { compileQuery } from "./core.js"

/**
 * from - Creates a FROM clause
 *
 * Specifies the source table or subquery for the query.
 * This establishes the base schema that other clauses can reference.
 *
 * @param source - An object with a single key-value pair where the key is the table alias
 * @returns A FromClause that can be passed to query()
 *
 * @example
 * ```ts
 * // Query from a collection
 * const q = query(
 *   from({ users: usersCollection })
 * )
 *
 * // Query from a subquery
 * const activeUsers = query(
 *   from({ u: usersCollection }),
 *   where(({ u }) => eq(u.active, true))
 * )
 * const q = query(
 *   from({ activeUsers })
 * )
 * ```
 */
export function from<TSource extends Source>(
  source: TSource
): FromClause<TSource> {
  return {
    clauseType: "from",
    source,
    _context: undefined as any, // Type-level only
  }
}

/**
 * Compiler for FROM clauses
 *
 * Converts a FROM clause to IR by creating a CollectionRef or QueryRef.
 */
function compileFrom(
  clause: FromClause<any>,
  ir: Partial<QueryIR>,
  _context: any
): Partial<QueryIR> {
  const source = clause.source

  // Validate source is a plain object
  let keys: Array<string>
  try {
    keys = Object.keys(source)
  } catch {
    const type = source === null ? `null` : `undefined`
    throw new InvalidSourceTypeError("from clause", type)
  }

  // Check if it's an array
  if (Array.isArray(source)) {
    throw new InvalidSourceTypeError("from clause", `array`)
  }

  // Validate exactly one key
  if (keys.length !== 1) {
    if (keys.length === 0) {
      throw new InvalidSourceTypeError("from clause", `empty object`)
    }
    if (keys.every((k) => !isNaN(Number(k)))) {
      throw new InvalidSourceTypeError("from clause", `string`)
    }
    throw new OnlyOneSourceAllowedError("from clause")
  }

  const alias = keys[0]!
  const sourceValue = source[alias]

  // Create the appropriate reference
  let fromRef: CollectionRef | QueryRef

  if (sourceValue instanceof CollectionImpl) {
    fromRef = new CollectionRef(sourceValue, alias)
  } else if (isQuery(sourceValue)) {
    // It's a functional query
    const subQueryIR = compileQuery(sourceValue)
    if (!subQueryIR.from) {
      throw new SubQueryMustHaveFromClauseError("from clause")
    }
    fromRef = new QueryRef(subQueryIR, alias)
  } else {
    throw new InvalidSourceError(alias)
  }

  return {
    ...ir,
    from: fromRef,
  }
}

// Helper to check if something is a Query
function isQuery(value: any): value is Query<any> {
  return (
    value &&
    typeof value === "object" &&
    "clauses" in value &&
    Array.isArray(value.clauses)
  )
}

// Auto-register the FROM compiler when this module is imported
registry.register("from", compileFrom as any)

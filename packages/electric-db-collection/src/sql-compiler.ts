import { serialize } from "./pg-serializer"
import type { SubsetParams } from "@electric-sql/client"
import type { IR, LoadSubsetOptions } from "@tanstack/db"

export type CompiledSqlRecord = Omit<SubsetParams, `params`> & {
  params?: Array<unknown>
}

export function compileSQL<T>(options: LoadSubsetOptions): SubsetParams {
  const { where, orderBy, limit } = options

  const params: Array<T> = []
  const compiledSQL: CompiledSqlRecord = { params }

  if (where) {
    // TODO: this only works when the where expression's PropRefs directly reference a column of the collection
    //       doesn't work if it goes through aliases because then we need to know the entire query to be able to follow the reference until the base collection (cf. followRef function)
    compiledSQL.where = compileBasicExpression(where, params)
  }

  if (orderBy) {
    compiledSQL.orderBy = compileOrderBy(orderBy, params)
  }

  if (limit) {
    compiledSQL.limit = limit
  }

  // WORKAROUND for Electric bug: Empty subset requests don't load data
  // Add dummy "true = true" predicate when there's no where clause
  // This is always true so doesn't filter data, just tricks Electric into loading
  if (!where) {
    compiledSQL.where = `true = true`
  }

  // Serialize the values in the params array into PG formatted strings
  // and transform the array into a Record<string, string>
  const paramsRecord = params.reduce(
    (acc, param, index) => {
      const serialized = serialize(param)
      // Only include non-empty values in params
      // Empty strings from null/undefined should be omitted
      if (serialized !== ``) {
        acc[`${index + 1}`] = serialized
      }
      return acc
    },
    {} as Record<string, string>
  )

  return {
    ...compiledSQL,
    params: paramsRecord,
  }
}

/**
 * Quote PostgreSQL identifiers to handle mixed case column names correctly.
 * Electric/Postgres requires quotes for case-sensitive identifiers.
 * @param name - The identifier to quote
 * @returns The quoted identifier
 */
function quoteIdentifier(name: string): string {
  return `"${name}"`
}

/**
 * Compiles the expression to a SQL string and mutates the params array with the values.
 * @param exp - The expression to compile
 * @param params - The params array
 * @returns The compiled SQL string
 */
function compileBasicExpression(
  exp: IR.BasicExpression<unknown>,
  params: Array<unknown>
): string {
  switch (exp.type) {
    case `val`:
      params.push(exp.value)
      return `$${params.length}`
    case `ref`:
      // TODO: doesn't yet support JSON(B) values which could be accessed with nested props
      if (exp.path.length !== 1) {
        throw new Error(
          `Compiler can't handle nested properties: ${exp.path.join(`.`)}`
        )
      }
      return quoteIdentifier(exp.path[0]!)
    case `func`:
      return compileFunction(exp, params)
    default:
      throw new Error(`Unknown expression type`)
  }
}

function compileOrderBy(orderBy: IR.OrderBy, params: Array<unknown>): string {
  const compiledOrderByClauses = orderBy.map((clause: IR.OrderByClause) =>
    compileOrderByClause(clause, params)
  )
  return compiledOrderByClauses.join(`,`)
}

function compileOrderByClause(
  clause: IR.OrderByClause,
  params: Array<unknown>
): string {
  // FIXME: We should handle stringSort and locale.
  //        Correctly supporting them is tricky as it depends on Postgres' collation
  const { expression, compareOptions } = clause
  let sql = compileBasicExpression(expression, params)

  if (compareOptions.direction === `desc`) {
    sql = `${sql} DESC`
  }

  if (compareOptions.nulls === `first`) {
    sql = `${sql} NULLS FIRST`
  }

  if (compareOptions.nulls === `last`) {
    sql = `${sql} NULLS LAST`
  }

  return sql
}

/**
 * Check if a BasicExpression represents a null/undefined value
 */
function isNullValue(exp: IR.BasicExpression<unknown>): boolean {
  return exp.type === `val` && (exp.value === null || exp.value === undefined)
}

function compileFunction(
  exp: IR.Func<unknown>,
  params: Array<unknown> = []
): string {
  const { name, args } = exp

  const opName = getOpName(name)

  // Handle comparison operators with null/undefined values
  // These would create invalid queries with missing params (e.g., "col = $1" with empty params)
  if (isComparisonOp(name)) {
    const nullArgIndex = args.findIndex((arg: IR.BasicExpression) =>
      isNullValue(arg)
    )

    if (nullArgIndex !== -1) {
      const otherArgIndex = nullArgIndex === 0 ? 1 : 0
      const otherArg = args[otherArgIndex]

      if (
        name === `eq` &&
        otherArg &&
        !isNullValue(otherArg) &&
        (otherArg.type === `ref` || otherArg.type === `func`)
      ) {
        // Transform eq(col, null/undefined) or eq(func(...), null/undefined) to "expr IS NULL"
        // This is the semantically correct behavior in SQL
        // We only allow ref and func types - comparing a literal to null (e.g., eq(42, null))
        // is almost certainly a mistake and should throw
        return `${compileBasicExpression(otherArg, params)} IS NULL`
      }

      // For other comparison operators (gt, lt, gte, lte, like, ilike),
      // or eq where both args are null/undefined,
      // null comparisons don't make semantic sense in SQL (they always evaluate to UNKNOWN)
      throw new Error(
        `Cannot use null/undefined value with '${name}' operator. ` +
          `Comparisons with null always evaluate to UNKNOWN in SQL. ` +
          `Use isNull() or isUndefined() to check for null values, ` +
          `or filter out null values before building the query.`
      )
    }
  }

  const compiledArgs = args.map((arg: IR.BasicExpression) =>
    compileBasicExpression(arg, params)
  )

  // Special case for IS NULL / IS NOT NULL - these are postfix operators
  if (name === `isNull` || name === `isUndefined`) {
    if (compiledArgs.length !== 1) {
      throw new Error(`${name} expects 1 argument`)
    }
    return `${compiledArgs[0]} ${opName}`
  }

  // Special case for NOT - unary prefix operator
  if (name === `not`) {
    if (compiledArgs.length !== 1) {
      throw new Error(`NOT expects 1 argument`)
    }
    // Check if the argument is IS NULL to generate IS NOT NULL
    const arg = args[0]
    if (arg && arg.type === `func`) {
      const funcArg = arg
      if (funcArg.name === `isNull` || funcArg.name === `isUndefined`) {
        const innerArg = compileBasicExpression(funcArg.args[0]!, params)
        return `${innerArg} IS NOT NULL`
      }
    }
    return `${opName} (${compiledArgs[0]})`
  }

  if (isBinaryOp(name)) {
    // Special handling for AND/OR which can be variadic
    if ((name === `and` || name === `or`) && compiledArgs.length > 2) {
      // Chain multiple arguments: (a AND b AND c) or (a OR b OR c)
      return compiledArgs.map((arg) => `(${arg})`).join(` ${opName} `)
    }

    if (compiledArgs.length !== 2) {
      throw new Error(`Binary operator ${name} expects 2 arguments`)
    }
    const [lhs, rhs] = compiledArgs
    // Special case for = ANY operator which needs parentheses around the array parameter
    if (name === `in`) {
      return `${lhs} ${opName}(${rhs})`
    }
    return `${lhs} ${opName} ${rhs}`
  }

  return `${opName}(${compiledArgs.join(`,`)})`
}

function isBinaryOp(name: string): boolean {
  const binaryOps = [
    `eq`,
    `gt`,
    `gte`,
    `lt`,
    `lte`,
    `and`,
    `or`,
    `in`,
    `like`,
    `ilike`,
  ]
  return binaryOps.includes(name)
}

/**
 * Check if operator is a comparison operator that takes two values
 * These operators cannot accept null/undefined as values
 * (null comparisons in SQL always evaluate to UNKNOWN)
 */
function isComparisonOp(name: string): boolean {
  const comparisonOps = [`eq`, `gt`, `gte`, `lt`, `lte`, `like`, `ilike`]
  return comparisonOps.includes(name)
}

function getOpName(name: string): string {
  const opNames = {
    eq: `=`,
    gt: `>`,
    gte: `>=`,
    lt: `<`,
    lte: `<=`,
    add: `+`,
    and: `AND`,
    or: `OR`,
    not: `NOT`,
    isUndefined: `IS NULL`,
    isNull: `IS NULL`,
    in: `= ANY`, // Use = ANY syntax for array parameters
    like: `LIKE`,
    ilike: `ILIKE`,
    upper: `UPPER`,
    lower: `LOWER`,
    length: `LENGTH`,
    concat: `CONCAT`,
    coalesce: `COALESCE`,
  }

  const opName = opNames[name as keyof typeof opNames]

  if (!opName) {
    throw new Error(`Unknown operator/function: ${name}`)
  }

  return opName
}

import { serialize } from './pg-serializer'
import type { SubsetParams } from '@electric-sql/client'
import type { IR, LoadSubsetOptions } from '@tanstack/db'

export type CompiledSqlRecord = Omit<SubsetParams, `params`> & {
  params?: Array<unknown>
}

/**
 * Optional function to encode column names (e.g., camelCase to snake_case)
 * This is typically the `encode` function from a columnMapper
 */
export type ColumnEncoder = (columnName: string) => string

/**
 * Options for SQL compilation
 */
export interface CompileSQLOptions {
  /**
   * Optional function to encode column names before quoting.
   * Used to transform property names (e.g., camelCase) to database column names (e.g., snake_case).
   * This should be the `encode` function from shapeOptions.columnMapper.
   */
  encodeColumnName?: ColumnEncoder
}

export function compileSQL<T>(
  options: LoadSubsetOptions,
  compileOptions?: CompileSQLOptions,
): SubsetParams {
  const { where, orderBy, limit } = options
  const encodeColumnName = compileOptions?.encodeColumnName

  const params: Array<T> = []
  const compiledSQL: CompiledSqlRecord = { params }

  if (where) {
    // TODO: this only works when the where expression's PropRefs directly reference a column of the collection
    //       doesn't work if it goes through aliases because then we need to know the entire query to be able to follow the reference until the base collection (cf. followRef function)
    compiledSQL.where = compileBasicExpression(where, params, encodeColumnName)
  }

  if (orderBy) {
    compiledSQL.orderBy = compileOrderBy(orderBy, params, encodeColumnName)
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
      // Empty strings are valid query values (e.g., WHERE column = '')
      // Only omit null/undefined values from params
      if (param != null) {
        acc[`${index + 1}`] = serialized
      }
      return acc
    },
    {} as Record<string, string>,
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
 * @param encodeColumnName - Optional function to encode the column name before quoting (e.g., camelCase to snake_case)
 * @returns The quoted identifier
 */
function quoteIdentifier(
  name: string,
  encodeColumnName?: ColumnEncoder,
): string {
  const columnName = encodeColumnName ? encodeColumnName(name) : name
  return `"${columnName.replace(/"/g, `""`)}"`
}

/**
 * Compiles the expression to a SQL string and mutates the params array with the values.
 * @param exp - The expression to compile
 * @param params - The params array
 * @param encodeColumnName - Optional function to encode column names (e.g., camelCase to snake_case)
 * @returns The compiled SQL string
 */
function compileBasicExpression(
  exp: IR.BasicExpression<unknown>,
  params: Array<unknown>,
  encodeColumnName?: ColumnEncoder,
): string {
  switch (exp.type) {
    case `val`:
      params.push(exp.value)
      return `$${params.length}`
    case `ref`:
      if (exp.path.length !== 1) {
        throw new Error(
          `Compiler can't handle nested properties: ${exp.path.join(`.`)}`,
        )
      }
      return quoteIdentifier(exp.path[0]!, encodeColumnName)
    case `func`:
      return compileFunction(exp, params, encodeColumnName)
    default:
      throw new Error(`Unknown expression type`)
  }
}

function compileOrderBy(
  orderBy: IR.OrderBy,
  params: Array<unknown>,
  encodeColumnName?: ColumnEncoder,
): string {
  const compiledOrderByClauses = orderBy.map((clause: IR.OrderByClause) =>
    compileOrderByClause(clause, params, encodeColumnName),
  )
  return compiledOrderByClauses.join(`,`)
}

function compileOrderByClause(
  clause: IR.OrderByClause,
  params: Array<unknown>,
  encodeColumnName?: ColumnEncoder,
): string {
  // FIXME: We should handle stringSort and locale.
  //        Correctly supporting them is tricky as it depends on Postgres' collation
  const { expression, compareOptions } = clause
  let sql = compileBasicExpression(expression, params, encodeColumnName)

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

function compileBooleanComparison(
  name: string,
  args: Array<IR.BasicExpression>,
  literalIndex: number,
  params: Array<unknown>,
  encodeColumnName?: ColumnEncoder,
): string {
  const literal = args[literalIndex] as IR.Value<boolean>
  const valueArg = args[literalIndex === 0 ? 1 : 0]!
  const compiled = compileBasicExpression(valueArg, params, encodeColumnName)
  const value = `(${compiled})`
  const op =
    literalIndex === 1
      ? name
      : name === `lt`
        ? `gt`
        : name === `gt`
          ? `lt`
          : name === `lte`
            ? `gte`
            : `lte`

  if ((op === `lte` && literal.value) || (op === `gte` && !literal.value)) {
    return `${value} = ${value}`
  }
  if ((op === `lt` && !literal.value) || (op === `gt` && literal.value)) {
    return `${value} <> ${value}`
  }
  return `${value} = ${op === `lt` || op === `lte` ? `FALSE` : `TRUE`}`
}

function compileFunction(
  exp: IR.Func<unknown>,
  params: Array<unknown> = [],
  encodeColumnName?: ColumnEncoder,
): string {
  const { name, args } = exp

  const opName = getOpName(name)

  // Handle comparison operators with null/undefined values
  // These would create invalid queries with missing params (e.g., "col = $1" with empty params)
  // In SQL, all comparisons with NULL return UNKNOWN, so these are almost always mistakes
  if (isComparisonOp(name)) {
    const nullArgIndex = args.findIndex((arg: IR.BasicExpression) =>
      isNullValue(arg),
    )

    if (nullArgIndex !== -1) {
      // All comparison operators (including eq) throw an error for null values
      // Users should use isNull() or isUndefined() to check for null values
      throw new Error(
        `Cannot use null/undefined value with '${name}' operator. ` +
          `Comparisons with null always evaluate to UNKNOWN in SQL. ` +
          `Use isNull() or isUndefined() to check for null values, ` +
          `or filter out null values before building the query.`,
      )
    }
  }

  if (name === `not`) {
    if (args.length !== 1) throw new Error(`NOT expects 1 argument`)
    const arg = args[0]
    if (
      arg?.type === `func` &&
      (arg.name === `isNull` || arg.name === `isUndefined`)
    ) {
      if (arg.args.length !== 1) {
        throw new Error(`${arg.name} expects 1 argument`)
      }
      const innerArg = arg.args[0]!
      const compiled = compileBasicExpression(
        innerArg,
        params,
        encodeColumnName,
      )
      return `${innerArg.type === `func` ? `(${compiled})` : compiled} IS NOT NULL`
    }
  }

  const booleanLiteralIndex = args.findIndex(
    (arg) => arg.type === `val` && typeof arg.value === `boolean`,
  )
  if (
    args.length === 2 &&
    isBooleanComparisonOp(name) &&
    booleanLiteralIndex !== -1
  ) {
    return compileBooleanComparison(
      name,
      args,
      booleanLiteralIndex,
      params,
      encodeColumnName,
    )
  }

  const compiledArgs = args.map((arg: IR.BasicExpression) => {
    const compiled = compileBasicExpression(arg, params, encodeColumnName)
    // AND/OR group their children by precedence; NOT already wraps its operand.
    // In value positions, preserve any nested operator as a single expression.
    return arg.type === `func` &&
      (arg.name === `and` ||
        arg.name === `or` ||
        (name !== `and` &&
          name !== `or` &&
          name !== `not` &&
          (isBinaryOp(arg.name) ||
            arg.name === `not` ||
            arg.name === `isNull` ||
            arg.name === `isUndefined`)))
      ? `(${compiled})`
      : compiled
  })

  // Special case for IS NULL / IS NOT NULL - these are postfix operators
  if (name === `isNull` || name === `isUndefined`) {
    if (compiledArgs.length !== 1) {
      throw new Error(`${name} expects 1 argument`)
    }
    return `${compiledArgs[0]} ${opName}`
  }

  // Special case for NOT - unary prefix operator
  if (name === `not`) {
    return `${opName} (${compiledArgs[0]})`
  }

  if (isBinaryOp(name)) {
    // Special handling for AND/OR which can be variadic
    if ((name === `and` || name === `or`) && compiledArgs.length > 2) {
      // Chain multiple arguments: (a AND b AND c) or (a OR b OR c)
      return compiledArgs.join(` ${opName} `)
    }

    if (compiledArgs.length !== 2) {
      throw new Error(`Binary operator ${name} expects 2 arguments`)
    }
    const [lhs, rhs] = compiledArgs

    if (name === `in`) {
      const valueArg = args[0]!
      const arrayArg = args[1]!

      if (valueArg.type === `val` && Array.isArray(valueArg.value)) {
        throw new Error(
          `Cannot use an array-valued left operand of 'in'. Pass a scalar value instead.`,
        )
      }

      if (arrayArg.type === `ref` && valueArg.type === `val`) {
        // Resolve literal parameters from the array element type before containment.
        return `(${lhs} = ANY(${rhs}) OR TRUE) AND ${rhs} @> ARRAY[${lhs}] AND ${rhs} IS NOT NULL`
      }

      // Literal value lists and ref/ref membership retain the original = ANY form.
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
  const comparisonOps = [`eq`, `gt`, `gte`, `lt`, `lte`, `like`, `ilike`, `in`]
  return comparisonOps.includes(name)
}

/**
 * Checks if the operator is a comparison operator (excluding eq)
 * These operators don't work on booleans in PostgreSQL without casting
 */
function isBooleanComparisonOp(name: string): boolean {
  return [`gt`, `gte`, `lt`, `lte`].includes(name)
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

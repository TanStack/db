import { convertToSQLiteValue } from "./sqlite-oracle"
import type {
  Aggregate,
  BasicExpression,
  Func,
  OrderByClause,
  PropRef,
  QueryIR,
  Value,
} from "../types"

/**
 * Converts a TanStack DB AST to parameterized SQLite SQL
 */
export function astToSQL(ast: QueryIR): { sql: string; params: Array<any> } {
  const params: Array<any> = []
  const paramIndex = 0

  const sql = buildSQL(ast, params, paramIndex)

  return { sql, params }
}

/**
 * Builds the complete SQL statement
 */
function buildSQL(
  ast: QueryIR,
  params: Array<any>,
  paramIndex: number
): string {
  const parts: Array<string> = []

  // SELECT clause
  parts.push(buildSelect(ast.select, params, paramIndex, ast.distinct === true))

  // FROM clause
  parts.push(buildFrom(ast.from))

  // JOIN clause
  if (ast.join && ast.join.length > 0) {
    parts.push(buildJoins(ast.join, params, paramIndex))
  }

  // WHERE clause
  if (ast.where && ast.where.length > 0) {
    parts.push(buildWhere(ast.where, params, paramIndex))
  }

  // GROUP BY clause
  if (ast.groupBy && ast.groupBy.length > 0) {
    parts.push(buildGroupBy(ast.groupBy))
  }

  // HAVING clause
  if (ast.having && ast.having.length > 0) {
    parts.push(buildHaving(ast.having, params, paramIndex))
  }

  // ORDER BY clause
  if (ast.orderBy && ast.orderBy.length > 0) {
    parts.push(buildOrderBy(ast.orderBy))
  }

  // LIMIT clause
  if (ast.limit !== undefined) {
    parts.push(`LIMIT ${ast.limit}`)
  }

  // OFFSET clause
  if (ast.offset !== undefined) {
    parts.push(`OFFSET ${ast.offset}`)
  }

  return parts.join(` `)
}

/**
 * Builds the SELECT clause
 */
function buildSelect(
  select: QueryIR[`select`],
  params: Array<any>,
  paramIndex: number,
  distinct: boolean = false
): string {
  if (!select) {
    return `SELECT ${distinct ? `DISTINCT ` : ``}*`
  }

  const columns: Array<string> = []

  for (const [alias, expr] of Object.entries(select)) {
    if (expr.type === `val` && expr.value === `*`) {
      columns.push(`*`)
    } else {
      const sql = expressionToSQL(expr, params, paramIndex)
      columns.push(`${sql} AS ${quoteIdentifier(alias)}`)
    }
  }

  return `SELECT ${distinct ? `DISTINCT ` : ``}${columns.join(`, `)}`
}

/**
 * Builds the FROM clause
 */
function buildFrom(from: QueryIR[`from`]): string {
  if (from.type === `collectionRef`) {
    return `FROM ${quoteIdentifier(from.alias)}`
  } else if (from.type === `queryRef`) {
    // Handle subqueries
    const subquery = buildSQL(from.query, [], 0)
    return `FROM (${subquery}) AS ${quoteIdentifier(from.alias)}`
  }
  return `FROM ${quoteIdentifier(from.alias)}`
}

/**
 * Builds the JOIN clauses
 */
function buildJoins(
  joins: QueryIR[`join`],
  params: Array<any>,
  paramIndex: number
): string {
  if (!joins) return ``

  return joins
    .map((join) => {
      const joinType = join.type.toUpperCase()
      const joinTable = quoteIdentifier(join.from.alias)
      const leftExpr = expressionToSQL(join.left, params, paramIndex)
      const rightExpr = expressionToSQL(join.right, params, paramIndex)

      return `${joinType} JOIN ${joinTable} ON ${leftExpr} = ${rightExpr}`
    })
    .join(` `)
}

/**
 * Builds the WHERE clause
 */
function buildWhere(
  where: QueryIR[`where`],
  params: Array<any>,
  paramIndex: number
): string {
  if (!where || where.length === 0) return ``

  const conditions = where.map((expr) =>
    expressionToSQL(expr, params, paramIndex)
  )
  return `WHERE ${conditions.join(` AND `)}`
}

/**
 * Builds the GROUP BY clause
 */
function buildGroupBy(groupBy: QueryIR[`groupBy`]): string {
  if (!groupBy || groupBy.length === 0) return ``

  const columns = groupBy.map((expr) => expressionToSQL(expr, [], 0))
  return `GROUP BY ${columns.join(`, `)}`
}

/**
 * Builds the HAVING clause
 */
function buildHaving(
  having: QueryIR[`having`],
  params: Array<any>,
  paramIndex: number
): string {
  if (!having || having.length === 0) return ``

  const conditions = having.map((expr) =>
    expressionToSQL(expr, params, paramIndex)
  )
  return `HAVING ${conditions.join(` AND `)}`
}

/**
 * Builds the ORDER BY clause
 */
function buildOrderBy(orderBy: Array<OrderByClause>): string {
  if (orderBy.length === 0) return ``

  const columns = orderBy.map((clause) => {
    const expr = expressionToSQL(clause.expression, [], 0)
    const direction = clause.direction.toUpperCase()
    return `${expr} ${direction}`
  })

  return `ORDER BY ${columns.join(`, `)}`
}

/**
 * Converts an expression to SQL
 */
function expressionToSQL(
  expr: BasicExpression | Aggregate,
  params: Array<any>,
  paramIndex: number
): string {
  switch (expr.type) {
    case `ref`:
      return buildPropRef(expr)
    case `val`:
      return buildValue(expr, params, paramIndex)
    case `func`:
      return buildFunction(expr, params, paramIndex)
    case `agg`:
      return buildAggregate(expr, params, paramIndex)
    default:
      throw new Error(`Unsupported expression type: ${(expr as any).type}`)
  }
}

/**
 * Builds a property reference
 */
function buildPropRef(expr: PropRef): string {
  if (expr.path.length === 1) {
    // Handle case where path is just the table alias (e.g., ["table_name"])
    return `${quoteIdentifier(expr.path[0])}.*`
  } else if (expr.path.length === 2) {
    // Handle case where path is [tableAlias, columnName]
    const [tableAlias, columnName] = expr.path
    return `${quoteIdentifier(tableAlias)}.${quoteIdentifier(columnName)}`
  } else {
    // Handle nested paths (e.g., ["table", "column", "subcolumn"])
    const tableAlias = expr.path[0]
    const columnPath = expr.path.slice(1).join(`.`)
    return `${quoteIdentifier(tableAlias)}.${quoteIdentifier(columnPath)}`
  }
}

/**
 * Builds a value expression
 */
function buildValue(
  expr: Value,
  params: Array<any>,
  _paramIndex: number
): string {
  if (expr.value === null) {
    return `NULL`
  }

  // Convert value to SQLite-compatible format
  const sqliteValue = convertToSQLiteValue(expr.value)

  // Add parameter and return placeholder
  params.push(sqliteValue)
  return `?`
}

/**
 * Builds a function expression
 */
function buildFunction(
  expr: Func,
  params: Array<any>,
  paramIndex: number
): string {
  const args = expr.args.map((arg) => expressionToSQL(arg, params, paramIndex))

  switch (expr.name) {
    // Comparison operators
    case `eq`:
      return `${args[0]} = ${args[1]}`
    case `gt`:
      return `${args[0]} > ${args[1]}`
    case `lt`:
      return `${args[0]} < ${args[1]}`
    case `gte`:
      return `${args[0]} >= ${args[1]}`
    case `lte`:
      return `${args[0]} <= ${args[1]}`

    // Logical operators
    case `and`:
      return `(${args.join(` AND `)})`
    case `or`:
      return `(${args.join(` OR `)})`
    case `not`:
      return `NOT (${args[0]})`

    // String functions
    case `like`:
      return `${args[0]} LIKE ${args[1]}`
    case `ilike`:
      return `${args[0]} ILIKE ${args[1]}`
    case `startsWith`:
      return `${args[0]} LIKE ${args[1]} || '%'`
    case `endsWith`:
      return `${args[0]} LIKE '%' || ${args[1]}`
    case `upper`:
      return `UPPER(${args[0]})`
    case `lower`:
      return `LOWER(${args[0]})`
    case `length`:
      return `LENGTH(${args[0]})`
    case `concat`:
      return `CONCAT(${args.join(`, `)})`

    // Mathematical functions
    case `add`:
      return `${args[0]} + ${args[1]}`
    case `coalesce`:
      return `COALESCE(${args.join(`, `)})`
    case `abs`:
      return `ABS(${args[0]})`
    case `round`:
      return `ROUND(${args[0]})`
    case `floor`:
      return `FLOOR(${args[0]})`
    case `ceil`:
      return `CEIL(${args[0]})`

    // Array operations
    case `in`:
      return `${args[0]} IN (${args[1]})`

    default:
      throw new Error(`Unsupported function: ${expr.name}`)
  }
}

/**
 * Builds an aggregate expression
 */
function buildAggregate(
  expr: Aggregate,
  params: Array<any>,
  paramIndex: number
): string {
  const args = expr.args.map((arg) => expressionToSQL(arg, params, paramIndex))

  switch (expr.name) {
    case `count`:
      return args.length > 0 ? `COUNT(${args[0]})` : `COUNT(*)`
    case `sum`:
      return `SUM(${args[0]})`
    case `avg`:
      return `AVG(${args[0]})`
    case `min`:
      return `MIN(${args[0]})`
    case `max`:
      return `MAX(${args[0]})`
    default:
      throw new Error(`Unsupported aggregate: ${expr.name}`)
  }
}

/**
 * Quotes an identifier for SQL
 */
function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, `""`)}"`
}

/**
 * Creates a COUNT query for a table
 */
export function createCountQuery(tableName: string): string {
  return `SELECT COUNT(*) FROM ${quoteIdentifier(tableName)}`
}

/**
 * Creates a simple SELECT query for a table
 */
export function createSelectQuery(
  tableName: string,
  columns: Array<string> = [`*`]
): string {
  const columnList = columns
    .map((col) => (col === `*` ? `*` : quoteIdentifier(col)))
    .join(`, `)

  return `SELECT ${columnList} FROM ${quoteIdentifier(tableName)}`
}

/**
 * Creates an INSERT statement
 */
export function createInsertStatement(
  tableName: string,
  data: Record<string, any>
): { sql: string; params: Array<any> } {
  const columns = Object.keys(data)
  const values = Object.values(data).map(convertToSQLiteValue)
  const placeholders = values.map(() => `?`).join(`, `)

  const sql = `INSERT INTO ${quoteIdentifier(tableName)} (${columns.map(quoteIdentifier).join(`, `)}) VALUES (${placeholders})`

  return { sql, params: values }
}

/**
 * Creates an UPDATE statement
 */
export function createUpdateStatement(
  tableName: string,
  keyColumn: string,
  keyValue: any,
  changes: Record<string, any>
): { sql: string; params: Array<any> } {
  const setColumns = Object.keys(changes)
  const setValues = Object.values(changes).map(convertToSQLiteValue)
  const setClause = setColumns
    .map((col) => `${quoteIdentifier(col)} = ?`)
    .join(`, `)

  const sql = `UPDATE ${quoteIdentifier(tableName)} SET ${setClause} WHERE ${quoteIdentifier(keyColumn)} = ?`
  const params = [...setValues, convertToSQLiteValue(keyValue)]

  return { sql, params }
}

/**
 * Creates a DELETE statement
 */
export function createDeleteStatement(
  tableName: string,
  keyColumn: string,
  keyValue: any
): { sql: string; params: Array<any> } {
  const sql = `DELETE FROM ${quoteIdentifier(tableName)} WHERE ${quoteIdentifier(keyColumn)} = ?`
  return { sql, params: [convertToSQLiteValue(keyValue)] }
}

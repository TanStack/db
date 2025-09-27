import { serialize } from "./pg-serializer"
import type { ExternalSubsetParamsRecord } from "@electric-sql/client"
import type { IR, OnLoadMoreOptions } from "@tanstack/db"

export type CompiledSqlRecord = Omit<ExternalSubsetParamsRecord, `params`> & {
  params?: Array<unknown>
}

export function compileSQL<T>(
  options: OnLoadMoreOptions
): ExternalSubsetParamsRecord {
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

  // Serialize the values in the params array into PG formatted strings
  // and transform the array into a Record<string, string>
  console.log("params", params)
  const paramsRecord = params.reduce(
    (acc, param, index) => {
      acc[`${index + 1}`] = serialize(param)
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
      return exp.path[0]!
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
  // TODO: what to do with stringSort and locale?
  //       Correctly supporting them is tricky as it depends on Postgres' collation
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

function compileFunction(
  exp: IR.Func<unknown>,
  params: Array<unknown> = []
): string {
  const { name, args } = exp

  const opName = getOpName(name)

  const compiledArgs = args.map((arg: IR.BasicExpression) =>
    compileBasicExpression(arg, params)
  )

  if (isBinaryOp(name)) {
    if (compiledArgs.length !== 2) {
      throw new Error(`Binary operator ${name} expects 2 arguments`)
    }
    const [lhs, rhs] = compiledArgs
    return `${lhs} ${opName} ${rhs}`
  }

  return `${opName}(${compiledArgs.join(`,`)})`
}

function isBinaryOp(name: string): boolean {
  const binaryOps = [`eq`, `gt`, `gte`, `lt`, `lte`, `and`, `or`]
  return binaryOps.includes(name)
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
    in: `IN`,
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

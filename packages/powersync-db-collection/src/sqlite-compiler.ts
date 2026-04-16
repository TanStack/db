import type { IR, LoadSubsetOptions } from '@tanstack/db'

/**
 * Result of compiling LoadSubsetOptions to SQLite
 */
export interface SQLiteCompiledQuery {
  /** The WHERE clause (without "WHERE" keyword), e.g., "price > ?" */
  where?: string
  /** The ORDER BY clause (without "ORDER BY" keyword), e.g., "price DESC" */
  orderBy?: string
  /** The LIMIT value */
  limit?: number
  /** Parameter values in order, to be passed to SQLite query */
  params: Array<unknown>
}

/**
 * Options for controlling how SQL is compiled.
 */
export interface CompileSQLiteOptions {
  /**
   * When set, column references emit `json_extract(<jsonColumn>, '$.<columnName>')`
   * instead of `"<columnName>"`. The `id` column is excluded since it's stored
   * as a direct column in the tracked table.
   */
  jsonColumn?: string
}

/**
 * Compiles TanStack DB LoadSubsetOptions to SQLite query components.
 *
 * @example
 * ```typescript
 * const compiled = compileSQLite({
 *   where: { type: 'func', name: 'gt', args: [
 *     { type: 'ref', path: ['price'] },
 *     { type: 'val', value: 100 }
 *   ]},
 *   orderBy: [{ expression: { type: 'ref', path: ['price'] }, compareOptions: { direction: 'desc', nulls: 'last' } }],
 *   limit: 50
 * })
 * // Result: { where: '"price" > ?', orderBy: '"price" DESC', limit: 50, params: [100] }
 * ```
 */
export function compileSQLite(
  options: LoadSubsetOptions,
  compileOptions?: CompileSQLiteOptions,
): SQLiteCompiledQuery {
  const { where, orderBy, limit } = options

  const params: Array<unknown> = []
  const result: SQLiteCompiledQuery = { params }

  if (where) {
    result.where = compileExpression(where, params, compileOptions)
  }

  if (orderBy) {
    result.orderBy = compileOrderBy(orderBy, params, compileOptions)
  }

  if (limit !== undefined) {
    result.limit = limit
  }

  return result
}

/**
 * Quote SQLite identifiers to handle column names correctly.
 * SQLite uses double quotes for identifiers.
 */
function quoteIdentifier(name: string): string {
  // Escape any double quotes in the name by doubling them
  const escaped = name.replace(/"/g, `""`)
  return `"${escaped}"`
}

/**
 * Compiles a BasicExpression to a SQL string, mutating the params array.
 */
function compileExpression(
  exp: IR.BasicExpression<unknown>,
  params: Array<unknown>,
  compileOptions?: CompileSQLiteOptions,
): string {
  switch (exp.type) {
    case `val`:
      params.push(exp.value)
      return `?`
    case `ref`: {
      if (exp.path.length !== 1) {
        throw new Error(
          `SQLite compiler doesn't support nested properties: ${exp.path.join(`.`)}`,
        )
      }
      const columnName = exp.path[0]!

      // PowerSync stores `id` as a top-level row column rather than inside the
      // JSON `data` object, so we skip json_extract. However, when compiling for
      // trigger WHEN clauses we still need the OLD./NEW. prefix. Extract it from
      // the jsonColumn option.
      if (compileOptions?.jsonColumn && columnName === `id`) {
        const prefix = compileOptions.jsonColumn.split('.')[0]!
        return `${prefix}.${quoteIdentifier(columnName)}`
      } else if (compileOptions?.jsonColumn) {
        return `json_extract(${compileOptions.jsonColumn}, '$.${columnName}')`
      }
      return quoteIdentifier(columnName)
    }
    case `func`:
      return compileFunction(exp, params, compileOptions)
    default:
      throw new Error(`Unknown expression type: ${(exp as any).type}`)
  }
}

/**
 * Compiles an OrderBy array to a SQL ORDER BY clause.
 */
function compileOrderBy(
  orderBy: IR.OrderBy,
  params: Array<unknown>,
  compileOptions?: CompileSQLiteOptions,
): string {
  const clauses = orderBy.map((clause: IR.OrderByClause) =>
    compileOrderByClause(clause, params, compileOptions),
  )
  return clauses.join(`, `)
}

/**
 * Compiles a single OrderByClause to SQL.
 */
function compileOrderByClause(
  clause: IR.OrderByClause,
  params: Array<unknown>,
  compileOptions?: CompileSQLiteOptions,
): string {
  const { expression, compareOptions } = clause
  let sql = compileExpression(expression, params, compileOptions)

  if (compareOptions.direction === `desc`) {
    sql = `${sql} DESC`
  }

  // SQLite supports NULLS FIRST/LAST (since 3.30.0)
  if (compareOptions.nulls === `first`) {
    sql = `${sql} NULLS FIRST`
  } else {
    // Default to NULLS LAST (nulls === 'last')
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

/**
 * Compiles a function expression (operator) to SQL.
 */
function compileFunction(
  exp: IR.Func<unknown>,
  params: Array<unknown>,
  compileOptions?: CompileSQLiteOptions,
): string {
  const { name, args } = exp

  // Check for null values in comparison operators
  if (isComparisonOp(name)) {
    const hasNullArg = args.some((arg: IR.BasicExpression) => isNullValue(arg))
    if (hasNullArg) {
      throw new Error(
        `Cannot use null/undefined with '${name}' operator. ` +
          `Use isNull() to check for null values.`,
      )
    }
  }

  // Compile arguments
  const compiledArgs = args.map((arg: IR.BasicExpression) =>
    compileExpression(arg, params, compileOptions),
  )

  // Handle different operator types
  switch (name) {
    // Binary comparison operators
    case `eq`:
    case `gt`:
    case `gte`:
    case `lt`:
    case `lte`: {
      if (compiledArgs.length !== 2) {
        throw new Error(`${name} expects 2 arguments`)
      }
      const opSymbol = getComparisonOp(name)
      return `${compiledArgs[0]} ${opSymbol} ${compiledArgs[1]}`
    }

    // Logical operators
    case `and`:
    case `or`: {
      if (compiledArgs.length < 2) {
        throw new Error(`${name} expects at least 2 arguments`)
      }
      const opKeyword = name === `and` ? `AND` : `OR`
      return compiledArgs
        .map((arg: string) => `(${arg})`)
        .join(` ${opKeyword} `)
    }

    case `not`: {
      if (compiledArgs.length !== 1) {
        throw new Error(`not expects 1 argument`)
      }
      // Check if argument is isNull/isUndefined for IS NOT NULL
      const arg = args[0]
      if (arg && arg.type === `func`) {
        if (arg.name === `isNull` || arg.name === `isUndefined`) {
          const innerArg = compileExpression(
            arg.args[0]!,
            params,
            compileOptions,
          )
          return `${innerArg} IS NOT NULL`
        }
      }
      return `NOT (${compiledArgs[0]})`
    }

    // Null checking
    case `isNull`:
    case `isUndefined`: {
      if (compiledArgs.length !== 1) {
        throw new Error(`${name} expects 1 argument`)
      }
      return `${compiledArgs[0]} IS NULL`
    }

    // IN operator
    case `in`: {
      if (compiledArgs.length !== 2) {
        throw new Error(`in expects 2 arguments (column and array)`)
      }
      // The second argument should be an array value
      // We need to handle this specially - expand the array into multiple placeholders
      const lastParamIndex = params.length - 1
      const arrayValue = params[lastParamIndex]

      if (!Array.isArray(arrayValue)) {
        throw new Error(`in operator requires an array value`)
      }

      // Remove the array param and add individual values
      params.pop()
      const placeholders = arrayValue.map(() => {
        params.push(arrayValue[params.length - lastParamIndex])
        return `?`
      })

      // Re-add individual values properly
      params.length = lastParamIndex // Reset to before array
      for (const val of arrayValue) {
        params.push(val)
      }

      return `${compiledArgs[0]} IN (${placeholders.join(`, `)})`
    }

    // String operators
    case `like`: {
      if (compiledArgs.length !== 2) {
        throw new Error(`like expects 2 arguments`)
      }
      return `${compiledArgs[0]} LIKE ${compiledArgs[1]}`
    }

    case `ilike`: {
      if (compiledArgs.length !== 2) {
        throw new Error(`ilike expects 2 arguments`)
      }
      return `${compiledArgs[0]} LIKE ${compiledArgs[1]} COLLATE NOCASE`
    }

    // String case functions
    case `upper`: {
      if (compiledArgs.length !== 1) {
        throw new Error(`upper expects 1 argument`)
      }
      return `UPPER(${compiledArgs[0]})`
    }

    case `lower`: {
      if (compiledArgs.length !== 1) {
        throw new Error(`lower expects 1 argument`)
      }
      return `LOWER(${compiledArgs[0]})`
    }

    case `length`: {
      if (compiledArgs.length !== 1) {
        throw new Error(`length expects 1 argument`)
      }
      return `LENGTH(${compiledArgs[0]})`
    }

    case `concat`: {
      if (compiledArgs.length < 1) {
        throw new Error(`concat expects at least 1 argument`)
      }
      return `CONCAT(${compiledArgs.join(`, `)})`
    }

    case `add`: {
      if (compiledArgs.length !== 2) {
        throw new Error(`add expects 2 arguments`)
      }
      return `${compiledArgs[0]} + ${compiledArgs[1]}`
    }

    // Null fallback
    case `coalesce`: {
      if (compiledArgs.length < 1) {
        throw new Error(`coalesce expects at least 1 argument`)
      }
      return `COALESCE(${compiledArgs.join(`, `)})`
    }

    default:
      throw new Error(
        `Operator '${name}' is not supported in PowerSync on-demand sync. ` +
          `Supported operators: eq, gt, gte, lt, lte, and, or, not, isNull, in, like, ilike, upper, lower, length, concat, add, coalesce`,
      )
  }
}

/**
 * Check if operator is a comparison operator
 */
function isComparisonOp(name: string): boolean {
  return [`eq`, `gt`, `gte`, `lt`, `lte`, `like`, `ilike`].includes(name)
}

/**
 * Get the SQL symbol for a comparison operator
 */
function getComparisonOp(name: string): string {
  const ops: Record<string, string> = {
    eq: `=`,
    gt: `>`,
    gte: `>=`,
    lt: `<`,
    lte: `<=`,
  }
  return ops[name]!
}

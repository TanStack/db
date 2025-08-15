/**
 * Converts Query IR back to a string representation that looks like the original query builder code
 */

export function convertQueryIRToString(queryIR: any): string {
  if (!queryIR) return `No query available`

  const lines: Array<string> = [`query`]

  // FROM clause
  if (queryIR.from) {
    const fromClause = convertFromToString(queryIR.from)
    lines.push(`  .from(${fromClause})`)
  } else {
    return `Invalid query: missing FROM clause`
  }

  // JOIN clauses
  if (queryIR.join && queryIR.join.length > 0) {
    for (const join of queryIR.join) {
      const joinClause = convertJoinToString(join)
      lines.push(`  .${join.type}Join(${joinClause})`)
    }
  }

  // WHERE clauses
  if (queryIR.where && queryIR.where.length > 0) {
    for (const where of queryIR.where) {
      const whereClause = convertExpressionToString(where)
      lines.push(`  .where(({${getTableAliases(queryIR)}}) => ${whereClause})`)
    }
  }

  // GROUP BY clause
  if (queryIR.groupBy && queryIR.groupBy.length > 0) {
    const groupByClauses = queryIR.groupBy.map((gb: any) =>
      convertExpressionToString(gb)
    )
    lines.push(
      `  .groupBy(({${getTableAliases(queryIR)}}) => [${groupByClauses.join(`, `)}])`
    )
  }

  // HAVING clauses
  if (queryIR.having && queryIR.having.length > 0) {
    for (const having of queryIR.having) {
      const havingClause = convertExpressionToString(having)
      lines.push(
        `  .having(({${getTableAliases(queryIR)}}) => ${havingClause})`
      )
    }
  }

  // ORDER BY clause
  if (queryIR.orderBy && queryIR.orderBy.length > 0) {
    const orderByClauses = queryIR.orderBy.map((ob: any) => {
      const expr = convertExpressionToString(ob.expression)
      const direction = ob.compareOptions?.direction || `asc`
      return `${expr}, '${direction}'`
    })
    lines.push(
      `  .orderBy(({${getTableAliases(queryIR)}}) => [${orderByClauses.join(`, `)}])`
    )
  }

  // LIMIT clause
  if (queryIR.limit !== undefined) {
    lines.push(`  .limit(${queryIR.limit})`)
  }

  // OFFSET clause
  if (queryIR.offset !== undefined) {
    lines.push(`  .offset(${queryIR.offset})`)
  }

  // SELECT clause
  if (queryIR.select) {
    const selectClauses = Object.entries(queryIR.select).map(
      ([alias, expr]: [string, any]) => {
        const expression = convertExpressionToString(expr)
        return `${alias}: ${expression}`
      }
    )
    lines.push(`  .select(({${getTableAliases(queryIR)}}) => ({`)
    lines.push(`    ${selectClauses.join(`,\n    `)}`)
    lines.push(`  }))`)
  }

  // DISTINCT clause
  if (queryIR.distinct) {
    lines.push(`  .distinct()`)
  }

  return lines.join(`\n`)
}

function convertFromToString(from: any): string {
  if (from.type === `collectionRef`) {
    return `{ ${from.alias}: /* ${from.collection.id} */ }`
  } else if (from.type === `queryRef`) {
    // TODO: add support for subqueries, recursively convert the subquery
    return `{ ${from.alias}: subquery }`
  }
  return `unknown`
}

function convertJoinToString(join: any): string {
  const fromClause = convertFromToString(join.from)
  const leftExpr = convertExpressionToString(join.left)
  const rightExpr = convertExpressionToString(join.right)
  return `${fromClause}, ({${getJoinAliases(join)}}) => eq(${leftExpr}, ${rightExpr})`
}

function convertExpressionToString(expr: any): string {
  if (!expr) return `undefined`

  switch (expr.type) {
    case `ref`:
      return expr.path.join(`.`)
    case `val`:
      if (typeof expr.value === `string`) {
        return `'${expr.value}'`
      } else if (typeof expr.value === `boolean`) {
        return expr.value ? `true` : `false`
      } else if (expr.value === null) {
        return `null`
      } else if (expr.value === undefined) {
        return `undefined`
      }
      return String(expr.value)
    case `func`: {
      const args = expr.args.map((arg: any) => convertExpressionToString(arg))
      return `${expr.name}(${args.join(`, `)})`
    }
    case `agg`: {
      const aggArgs = expr.args.map((arg: any) =>
        convertExpressionToString(arg)
      )
      return `${expr.name}(${aggArgs.join(`, `)})`
    }
    default:
      return `unknown`
  }
}

function getTableAliases(queryIR: any): string {
  const aliases: Array<string> = []

  // Add FROM alias
  if (queryIR.from) {
    aliases.push(queryIR.from.alias)
  }

  // Add JOIN aliases
  if (queryIR.join) {
    for (const join of queryIR.join) {
      aliases.push(join.from.alias)
    }
  }

  return aliases.join(`, `)
}

function getJoinAliases(join: any): string {
  // For joins, we need to include both the joined table and any existing aliases
  // This is a simplified version - in practice we'd need to track all available aliases
  return `${join.from.alias}`
}

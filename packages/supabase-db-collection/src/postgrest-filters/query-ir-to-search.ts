import {
  appendLimit,
  appendOffset,
  appendOrder,
  paramsToSearch,
  toPostgrestParams,
} from './common'
import type {
  SerializedExpression as Expression,
  SerializedFrom,
  SerializedJoinClause,
  SerializedQueryIR,
  SerializedSelect,
  SerializedWhere,
} from '../serialize'

// ── Serialized query IR → search ────────────────────────────────────

/** Extract column name from a ref expression (drops the table alias prefix) */
function refToColumn(expr: Expression): string {
  if (expr.type !== 'ref') {
    throw new Error(`Expected ref expression, got ${expr.type}`)
  }
  return expr.path.slice(1).join('.')
}

/** Unwrap a SerializedWhere to its expression */
function getExpression(where: SerializedWhere): Expression {
  if ('type' in where) return where
  return (where as { expression: Expression }).expression
}

/** Check if a where clause is residual (client-side only, cannot be pushed to PostgREST) */
function isResidual(where: SerializedWhere): boolean {
  if ('type' in where) return false
  return (where as { residual?: boolean }).residual === true
}

/** Check if a ref expression points to a computed/selected field */
function isComputedRef(expr: Expression): boolean {
  return expr.type === 'ref' && expr.path[0] === '$selected'
}

/** Resolve a FROM clause to a base table name, collecting where clauses from subqueries */
function resolveFrom(from: SerializedFrom): {
  tableName: string
  wheres: Array<SerializedWhere>
} {
  if (from.type === 'table') {
    return { tableName: from.name, wheres: [] }
  }
  if (from.type === 'subquery') {
    const inner = resolveFrom(from.query.from)
    return {
      tableName: inner.tableName,
      wheres: [...inner.wheres, ...(from.query.where ?? [])],
    }
  }
  // union / unionAll have no single base table to push to PostgREST
  throw new Error(
    `Cannot push a ${from.type} query to PostgREST; unions are not supported in queryOnce`,
  )
}

interface EmbedNode {
  alias: string
  children: Array<EmbedNode>
  hint: string
  joinType: string
  tableName: string
}

/**
 * Build the PostgREST select string from the IR.
 *
 * Handles:
 * - Column refs: `alias:column` or just `column`
 * - Aggregates: `alias:column.count()`, `alias:column.sum()`, etc.
 * - Join embeddings: `table!fk!inner(*)`, `table!fk(*)`
 *
 * Falls back to `*` when select contains non-pushable expressions
 * (func, computed refs, groupBy present).
 */
function buildSelectString(ir: SerializedQueryIR): string {
  const parts: Array<string> = []
  let hasExplicitColumns = false

  // Process select fields (aggregates and column refs)
  // Skip pushing select when groupBy is present (aggregation done client-side)
  if (ir.select && !ir.groupBy?.length) {
    const selectParts = processSelectEntries(ir.select)
    if (selectParts !== null) {
      parts.push(...selectParts)
      hasExplicitColumns = true
    }
  }

  if (!hasExplicitColumns) {
    parts.push('*')
  }

  // Add join resource embeddings
  if (ir.join?.length) {
    const embedStrings = buildJoinEmbeds(ir)
    parts.push(...embedStrings)
  }

  return stripSelectWhitespace(parts.join(', '))
}

/**
 * Remove whitespace outside of quoted segments, mirroring postgrest-js's
 * `.select()`. We build the select with `", "` separators for readability but
 * PostgREST expects a compact list.
 */
function stripSelectWhitespace(select: string): string {
  let quoted = false
  let result = ''
  for (const char of select) {
    if (/\s/.test(char) && !quoted) continue
    if (char === '"') quoted = !quoted
    result += char
  }
  return result
}

/**
 * Convert a SerializedSelect map into PostgREST select parts.
 * Returns null if any entry cannot be pushed (signals fallback to `*`).
 */
function processSelectEntries(select: SerializedSelect): Array<string> | null {
  const parts: Array<string> = []

  for (const [alias, value] of Object.entries(select)) {
    // A spread (`...row`) can't be expressed as a fixed column list
    if (alias.startsWith('__SPREAD_SENTINEL__')) return null
    if ('type' in value) {
      const part = exprToSelectPart(alias, value as Expression)
      if (part === null) return null
      parts.push(part)
    } else {
      // Nested select object — can't push to PostgREST
      return null
    }
  }

  return parts.length > 0 ? parts : null
}

/** Convert a single select expression to a PostgREST select part */
function exprToSelectPart(alias: string, expr: Expression): string | null {
  if (expr.type === 'ref') {
    if (isComputedRef(expr)) return null
    const column = refToColumn(expr)
    return alias === column ? column : `${alias}:${column}`
  }
  if (expr.type === 'agg') {
    return aggToSelectPart(alias, expr)
  }
  // func, val, includesSubquery — can't push
  return null
}

/**
 * Convert an aggregate expression to PostgREST select syntax.
 *
 * - `count(column)` → `alias:column.count()`
 * - `sum(column)`   → `alias:column.sum()`
 * - `avg(column)`   → `alias:column.avg()`
 * - `min(column)`   → `alias:column.min()`
 * - `max(column)`   → `alias:column.max()`
 */
function aggToSelectPart(alias: string, expr: Expression): string | null {
  if (expr.type !== 'agg') return null

  const { name, args } = expr

  if (
    name === 'count' ||
    name === 'sum' ||
    name === 'avg' ||
    name === 'min' ||
    name === 'max'
  ) {
    const [arg] = args
    if (arg?.type === 'ref') {
      const column = refToColumn(arg)
      return `${alias}:${column}.${name}()`
    }
    if (name === 'count') {
      return `${alias}:count`
    }
    return null
  }

  return null
}

/**
 * Whether every select entry is an aggregate PostgREST can compute, so the
 * response is exactly one row. A plain column beside an aggregate would make
 * PostgREST group by it, and any other expression falls back to `select=*`.
 */
export function isAggregateOnlySelect(
  select: SerializedSelect | undefined,
): boolean {
  if (!select) return false
  const entries = Object.entries(select)
  return (
    entries.length > 0 &&
    entries.every(
      ([alias, value]) => aggToSelectPart(alias, value as Expression) !== null,
    )
  )
}

/**
 * Build PostgREST resource embedding strings for joins.
 *
 * Constructs a tree of embed nodes to handle chained joins (e.g.,
 * `users JOIN users_todos JOIN todos` → nested embedding).
 *
 * Join type mapping:
 * - `inner` → `!inner`
 * - `left`  → (default, no hint needed)
 * - `right` → `!inner` (semantically: right table always present)
 * - `full`  → (default left embedding — partial semantics)
 */
function buildJoinEmbeds(ir: SerializedQueryIR): Array<string> {
  if (!ir.join?.length) return []

  const fromAlias = ir.from.type === 'table' ? ir.from.alias : ir.from.alias

  // Build a tree: root is the FROM table, children are embedded joins
  const root: EmbedNode = {
    tableName: resolveFrom(ir.from).tableName,
    alias: fromAlias,
    hint: '',
    joinType: '',
    children: [],
  }

  const nodeMap = new Map<string, EmbedNode>()
  nodeMap.set(fromAlias, root)

  for (const join of ir.join) {
    const { tableName: joinTable } = resolveFrom(join.from)
    const joinAlias =
      join.from.type === 'table' ? join.from.alias : join.from.alias

    const { parentAlias, fkHint } = resolveJoinParent(join, joinAlias, nodeMap)

    const node: EmbedNode = {
      tableName: joinTable,
      alias: joinAlias,
      hint: fkHint,
      joinType: join.type,
      children: [],
    }

    const parent = nodeMap.get(parentAlias) ?? root
    parent.children.push(node)
    nodeMap.set(joinAlias, node)
  }

  return root.children.map(renderEmbedNode)
}

/**
 * Split a join condition into its left and right operands. `@tanstack/db` 1.0
 * models the condition as a single boolean `on` expression instead of separate
 * `left` / `right` operands. A plain `eq(a, b)` yields its two operands; for an
 * `and(...)` of conditions the first `eq` is used, as the rest cannot be
 * expressed through a single PostgREST embedding hint.
 */
function joinOperands(
  on: Expression,
): { left: Expression; right: Expression } | null {
  if (on.type !== 'func') return null
  const [left, right] = on.args
  if (on.name === 'eq' && left && right && on.args.length === 2) {
    return { left, right }
  }
  if (on.name === 'and') {
    for (const arg of on.args) {
      const operands = joinOperands(arg)
      if (operands) return operands
    }
  }
  return null
}

/**
 * Determine which existing node a join attaches to, and extract
 * the foreign key hint from the join condition.
 */
function resolveJoinParent(
  join: SerializedJoinClause,
  joinAlias: string,
  nodeMap: Map<string, EmbedNode>,
): { parentAlias: string; fkHint: string } {
  const operands = joinOperands(join.on)
  if (!operands) return { parentAlias: '', fkHint: '' }
  const { left, right } = operands

  const leftAlias = left.type === 'ref' ? left.path[0] : null
  const rightAlias = right.type === 'ref' ? right.path[0] : null

  // Left side is existing table, right side is the new join table
  if (leftAlias && nodeMap.has(leftAlias) && rightAlias === joinAlias) {
    const fk = right.type === 'ref' ? right.path.slice(1).join('.') : ''
    return { parentAlias: leftAlias, fkHint: fk }
  }

  // Right side is existing table, left side is the new join table
  if (rightAlias && nodeMap.has(rightAlias) && leftAlias === joinAlias) {
    const fk = left.type === 'ref' ? left.path.slice(1).join('.') : ''
    return { parentAlias: rightAlias, fkHint: fk }
  }

  // Fallback: attach to whichever side is already in the tree
  if (leftAlias && nodeMap.has(leftAlias)) {
    const fk = right.type === 'ref' ? right.path.slice(1).join('.') : ''
    return { parentAlias: leftAlias, fkHint: fk }
  }
  if (rightAlias && nodeMap.has(rightAlias)) {
    const fk = left.type === 'ref' ? left.path.slice(1).join('.') : ''
    return { parentAlias: rightAlias, fkHint: fk }
  }

  return { parentAlias: '', fkHint: '' }
}

/** Render an embed node as a PostgREST resource embedding string */
function renderEmbedNode(node: EmbedNode): string {
  const hintStr = node.hint ? `!${node.hint}` : ''
  const typeStr =
    node.joinType === 'inner' || node.joinType === 'right' ? '!inner' : ''

  const innerParts = ['*']
  for (const child of node.children) {
    innerParts.push(renderEmbedNode(child))
  }

  return `${node.tableName}${hintStr}${typeStr}(${innerParts.join(', ')})`
}

/**
 * Build the PostgREST query string (and resolve the base table) from a
 * SerializedQueryIR.
 *
 * Pushes to PostgREST:
 * - **select**: column refs, aggregates (count/sum/avg/min/max)
 * - **joins**: resource embedding with `!inner` / `!left` hints
 * - **where**: eq, gt, gte, lt, lte, like, ilike, isNull, in, not, and, or
 * - **orderBy**: real column refs (skips computed/$selected)
 * - **limit / offset**
 *
 * Falls back to `select=*` when:
 * - select contains non-pushable expressions (func, computed refs)
 * - groupBy is present (aggregation done client-side)
 */
export function queryIrToSearch(ir: SerializedQueryIR): {
  tableName: string
  search: URLSearchParams
} {
  const { tableName, wheres: subqueryWheres } = resolveFrom(ir.from)
  const allWheres = [...subqueryWheres, ...(ir.where ?? [])]

  const search = new URLSearchParams()
  search.set('select', buildSelectString(ir))

  // Apply pushable where filters (skip residual / client-side filters)
  for (const w of allWheres) {
    if (isResidual(w)) continue
    const filters = paramsToSearch(
      toPostgrestParams(getExpression(w), { stripAlias: true, strict: true }),
    )
    for (const [key, value] of filters) {
      search.append(key, value)
    }
  }

  // Apply order by (only real column refs, skip computed/$selected refs)
  const sorts: Parameters<typeof appendOrder>[1] = []
  for (const ob of ir.orderBy ?? []) {
    if (ob.expression.type === 'ref' && !isComputedRef(ob.expression)) {
      sorts.push({
        column: refToColumn(ob.expression),
        ascending: ob.direction === 'asc',
        nulls: ob.nulls === 'first' ? 'first' : 'last',
      })
    }
  }
  appendOrder(search, sorts)

  // limit and offset are independent params — no derived range
  if (ir.limit !== undefined) {
    appendLimit(search, ir.limit)
  }
  if (ir.offset !== undefined) {
    appendOffset(search, ir.offset)
  }

  return { tableName, search }
}

import type { SerializedExpression as Expression } from '../serialize'

type Comparison = { column: string; operator: string; value: string }
export type PostgrestParam =
  ({ kind: 'column' } & Comparison) | { kind: 'group'; filter: string }

interface FilterOptions {
  mergeIn?: boolean
  /**
   * Quote top-level scalar values (the Realtime path). PostgREST sends each
   * comparison as its own `column=op.value` query param, so top-level scalars
   * must stay raw; Realtime comma-joins conditions into a single `filter`, so
   * top-level scalars must be quoted to keep reserved characters (commas,
   * whitespace) from splitting a condition.
   */
  quoteScalars?: boolean
  strict?: boolean
  stripAlias?: boolean
}

/**
 * Set the comma-joined `order` param (independent of limit/offset). Null
 * placement is always explicit: Postgres puts nulls last for `asc`, while
 * TanStack DB puts them first unless told otherwise.
 */
export function appendOrder(
  search: URLSearchParams,
  sorts: Array<{ column: string; ascending: boolean; nulls: 'first' | 'last' }>,
): void {
  if (sorts.length === 0) return
  search.set(
    'order',
    sorts
      .map(
        (sort) =>
          `${sort.column}.${sort.ascending ? 'asc' : 'desc'}.nulls${sort.nulls}`,
      )
      .join(','),
  )
}

export function appendLimit(search: URLSearchParams, limit: number): void {
  search.set('limit', `${limit}`)
}

export function appendOffset(search: URLSearchParams, offset: number): void {
  search.set('offset', `${offset}`)
}

/** Render params as the `URLSearchParams` sent to (and keyed by) PostgREST. */
export function paramsToSearch(params: Array<PostgrestParam>): URLSearchParams {
  const search = new URLSearchParams()
  for (const param of params) {
    if (param.kind === 'column')
      search.append(param.column, `${param.operator}.${param.value}`)
    else search.append('or', `(${param.filter})`)
  }
  return search
}

export function flattenAnd(expr: Expression): Array<Expression> {
  return expr.type === 'func' && expr.name === 'and'
    ? expr.args.flatMap(flattenAnd)
    : [expr]
}

// PostgREST interpolates filter values into the URL as-is, and
// `Date.prototype.toString()` produces something Postgres cannot cast to a
// timestamp. Rendering it as ISO 8601 keeps the server query in agreement with
// the Realtime subscription, which serializes Dates the same way.
export const toScalarString = (value: unknown): string =>
  value instanceof Date ? value.toISOString() : `${value}`

// Only lists and logical groups parse quoted values. Top-level scalar values
// must remain raw: col=eq."x" would match the quotes themselves.
const NEEDS_QUOTES = /^$|^\s|\s$|[,()"\\]/
export const quoteValue = (value: unknown): string => {
  const raw = toScalarString(value)
  return NEEDS_QUOTES.test(raw)
    ? `"${raw.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
    : raw
}

const SCALAR_OPERATORS = ['eq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike']

function renderComparison(
  expr: Expression,
  quoteScalars: boolean,
  options: FilterOptions,
): Comparison | null {
  if (expr.type !== 'func') return null
  const [left, right] = expr.args
  if (expr.name === 'not' && left) {
    if (left.type === 'func' && left.name === 'not' && left.args[0]) {
      return renderComparison(left.args[0], quoteScalars, options)
    }
    const inner = renderComparison(left, quoteScalars, options)
    if (!inner) return null
    // TanStack's NOT IN [] excludes nulls; PostgREST's NOT IN () includes them.
    if (inner.operator === 'in' && inner.value === '()') {
      return { ...inner, operator: 'not.is', value: 'null' }
    }
    return {
      ...inner,
      operator: `not.${inner.operator}`,
    }
  }
  if (left?.type !== 'ref' || left.path[0] === '$selected') return null
  const column = (options.stripAlias ? left.path.slice(1) : left.path).join('.')
  if (!column) return null
  if (expr.name === 'isNull') return { column, operator: 'is', value: 'null' }
  if (right?.type !== 'val') return null

  if (expr.name === 'in') {
    if (!Array.isArray(right.value)) return null
    // TanStack's membership test ignores null list members for non-null rows.
    const values = Array.from(
      new Set(right.value.filter((value) => value != null)),
    )
    // PostgREST treats IN ("") as an empty list, even when quoted.
    if (values.length === 1 && values[0] === '') {
      return { column, operator: 'eq', value: quoteScalars ? '""' : '' }
    }
    return {
      column,
      operator: 'in',
      value: `(${values.map(quoteValue).join(',')})`,
    }
  }
  if (!SCALAR_OPERATORS.includes(expr.name)) return null
  let value = right.value
  if (expr.name === 'like' || expr.name === 'ilike') {
    // TanStack uses SQL %/_ wildcards, but treats * and backslashes literally.
    // PostgREST always rewrites * to %, so such patterns cannot be pushed.
    if (typeof value !== 'string' || value.includes('*')) return null
    value = value.replace(/\\/g, '\\\\')
  }
  return {
    column,
    operator: expr.name,
    value: quoteScalars ? quoteValue(value) : toScalarString(value),
  }
}

// Embedded expressions are all-or-nothing. Dropping a child of OR or NOT
// could narrow the response and permanently lose matching rows.
function toFilterString(
  expr: Expression,
  options: FilterOptions,
  negated = false,
): string | null {
  if (expr.type !== 'func') return null
  if (expr.name === 'not') {
    return expr.args[0] ? toFilterString(expr.args[0], options, !negated) : null
  }
  if (expr.name === 'and' || expr.name === 'or') {
    if (expr.args.length === 0) return null
    // Move NOT down to comparisons with De Morgan's laws. In particular, an
    // empty IN list needs its null guard even under a negated logical group.
    const operator = negated ? (expr.name === 'and' ? 'or' : 'and') : expr.name
    const parts = expr.args.map((arg) => toFilterString(arg, options, negated))
    return parts.includes(null) ? null : `${operator}(${parts.join(',')})`
  }
  const comparison = renderComparison(
    negated ? { type: 'func', name: 'not', args: [expr] } : expr,
    true,
    options,
  )
  return comparison
    ? `${comparison.column}.${comparison.operator}.${comparison.value}`
    : null
}

// Preserve the live adapter's union of duplicate IN demands. This deliberately
// fetches a superset, which TanStack re-filters. Never do this inside OR/NOT or
// for server aggregates, where client-side filtering cannot repair the result.
export function mergeInFilters(filters: Array<Expression>): Array<Expression> {
  const merged: Array<Expression> = []
  const valuesByField = new Map<string, Array<unknown>>()
  for (const filter of filters) {
    if (filter.type !== 'func' || filter.name !== 'in') {
      merged.push(filter)
      continue
    }
    const [left, right] = filter.args
    if (
      left?.type !== 'ref' ||
      right?.type !== 'val' ||
      !Array.isArray(right.value)
    ) {
      merged.push(filter)
      continue
    }
    const field = JSON.stringify(left.path)
    const existing = valuesByField.get(field)
    if (existing) {
      existing.push(...right.value)
    } else {
      const values = [...right.value]
      valuesByField.set(field, values)
      merged.push({ ...filter, args: [left, { type: 'val', value: values }] })
    }
  }
  return merged
}

/** One top-level conjunct as a PostgREST param, or `null` if it cannot be pushed */
function toParam(
  filter: Expression,
  options: FilterOptions,
): PostgrestParam | null {
  const comparison = renderComparison(
    filter,
    options.quoteScalars ?? false,
    options,
  )
  if (comparison) return { kind: 'column', ...comparison }
  const embedded = toFilterString(filter, options)
  if (embedded === null) return null
  return {
    kind: 'group',
    filter: embedded.startsWith('or(') ? embedded.slice(3, -1) : embedded,
  }
}

/**
 * Whether PostgREST applies every conjunct of `expr` exactly, so a result it
 * computes from the matching rows needs no client-side filtering.
 */
export function isPushable(
  expr: Expression,
  options: FilterOptions = {},
): boolean {
  return flattenAnd(expr).every((filter) => toParam(filter, options) !== null)
}

export function toPostgrestParams(
  expr: Expression | undefined | null,
  options: FilterOptions = {},
): Array<PostgrestParam> {
  if (!expr) return []
  const conjuncts = flattenAnd(expr)
  const filters = options.mergeIn ? mergeInFilters(conjuncts) : conjuncts
  return filters.flatMap((filter): Array<PostgrestParam> => {
    const param = toParam(filter, options)
    if (param) return [param]
    if (options.strict) {
      throw new Error(
        'Cannot push WHERE expression to PostgREST; server aggregates require fully pushable filters',
      )
    }
    return []
  })
}

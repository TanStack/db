import type { IR, LoadSubsetOptions } from '@tanstack/db'

/**
 * Serializes LoadSubsetOptions into a stable, hashable format for query keys.
 * Includes where, orderBy, limit, and offset for pagination support.
 * Note: cursor expressions are not serialized as they are backend-specific.
 * @internal
 */
export function serializeLoadSubsetOptions(
  options: LoadSubsetOptions | undefined,
): string | undefined {
  if (!options) {
    return undefined
  }

  const result: Record<string, unknown> = {}

  if (options.where) {
    result.where = serializeExpression(options.where)
  }

  if (options.orderBy?.length) {
    result.orderBy = options.orderBy.map((clause) => {
      const baseOrderBy = {
        expression: serializeExpression(clause.expression),
        direction: clause.compareOptions.direction,
        nulls: clause.compareOptions.nulls,
        stringSort: clause.compareOptions.stringSort,
      }

      // Handle locale-specific options when stringSort is 'locale'
      if (clause.compareOptions.stringSort === `locale`) {
        return {
          ...baseOrderBy,
          locale: clause.compareOptions.locale,
          localeOptions: clause.compareOptions.localeOptions,
        }
      }

      return baseOrderBy
    })
  }

  if (options.limit !== undefined) {
    result.limit = options.limit
  }

  // Include offset for pagination support
  if (options.offset !== undefined) {
    result.offset = options.offset
  }

  // Include joins for server-side query construction
  if (options.joins?.length) {
    result.joins = options.joins.map((join) => ({
      collectionId: join.collectionId,
      alias: join.alias,
      type: join.type,
      localKey: serializeExpression(join.localKey),
      foreignKey: serializeExpression(join.foreignKey),
      where: join.where ? serializeExpression(join.where) : undefined,
      orderBy: join.orderBy?.map((clause) => ({
        expression: serializeExpression(clause.expression),
        direction: clause.compareOptions.direction,
        nulls: clause.compareOptions.nulls,
        stringSort: clause.compareOptions.stringSort,
        ...(clause.compareOptions.stringSort === `locale` && {
          locale: clause.compareOptions.locale,
          localeOptions: clause.compareOptions.localeOptions,
        }),
      })),
    }))
  }

  return Object.keys(result).length === 0 ? undefined : JSON.stringify(result)
}

/**
 * Recursively serializes an IR expression for stable hashing
 * @internal
 */
function serializeExpression(expr: IR.BasicExpression | undefined): unknown {
  if (!expr) {
    return null
  }

  switch (expr.type) {
    case `val`:
      return {
        type: `val`,
        value: serializeValue(expr.value),
      }
    case `ref`:
      return {
        type: `ref`,
        path: [...expr.path],
      }
    case `func`:
      return {
        type: `func`,
        name: expr.name,
        args: expr.args.map((arg) => serializeExpression(arg)),
      }
    default:
      return null
  }
}

/**
 * Serializes special JavaScript values (undefined, NaN, Infinity, Date)
 * @internal
 */
function serializeValue(value: unknown): unknown {
  if (value === undefined) {
    return { __type: `undefined` }
  }

  if (typeof value === `number`) {
    if (Number.isNaN(value)) {
      return { __type: `nan` }
    }
    if (value === Number.POSITIVE_INFINITY) {
      return { __type: `infinity`, sign: 1 }
    }
    if (value === Number.NEGATIVE_INFINITY) {
      return { __type: `infinity`, sign: -1 }
    }
  }

  if (
    value === null ||
    typeof value === `string` ||
    typeof value === `number` ||
    typeof value === `boolean`
  ) {
    return value
  }

  if (value instanceof Date) {
    return { __type: `date`, value: value.toJSON() }
  }

  if (Array.isArray(value)) {
    return value.map((item) => serializeValue(item))
  }

  if (typeof value === `object`) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, val]) => [
        key,
        serializeValue(val),
      ]),
    )
  }

  return value
}

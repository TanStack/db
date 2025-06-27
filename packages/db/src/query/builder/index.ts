import { CollectionImpl } from "../../collection.js"
import { CollectionRef, QueryRef } from "../ir.js"
import { createRefProxy, isRefProxy, toExpression } from "./ref-proxy.js"
import type { NamespacedRow } from "../../types.js"
import type {
  Agg,
  Expression,
  JoinClause,
  OrderBy,
  OrderByClause,
  OrderByDirection,
  Query,
} from "../ir.js"
import type {
  Context,
  GroupByCallback,
  JoinOnCallback,
  MergeContext,
  MergeContextWithJoinType,
  OrderByCallback,
  RefProxyForContext,
  ResultTypeFromSelect,
  SchemaFromSource,
  SelectObject,
  Source,
  WhereCallback,
  WithResult,
} from "./types.js"

export function buildQuery(
  fn: (builder: InitialQueryBuilder) => QueryBuilder<any>
): Query {
  const result = fn(new BaseQueryBuilder())
  return getQuery(result)
}

export class BaseQueryBuilder<TContext extends Context = Context> {
  private readonly query: Partial<Query> = {}

  constructor(query: Partial<Query> = {}) {
    this.query = { ...query }
  }

  // FROM method - only available on initial builder
  from<TSource extends Source>(
    source: TSource
  ): QueryBuilder<{
    baseSchema: SchemaFromSource<TSource>
    schema: SchemaFromSource<TSource>
    fromSourceName: keyof TSource & string
    hasJoins: false
  }> {
    if (Object.keys(source).length !== 1) {
      throw new Error(`Only one source is allowed in the from clause`)
    }

    const alias = Object.keys(source)[0]! as keyof TSource & string
    const sourceValue = source[alias]

    let from: CollectionRef | QueryRef

    if (sourceValue instanceof CollectionImpl) {
      from = new CollectionRef(sourceValue, alias)
    } else if (sourceValue instanceof BaseQueryBuilder) {
      const subQuery = sourceValue._getQuery()
      if (!(subQuery as Partial<Query>).from) {
        throw new Error(
          `A sub query passed to a from clause must have a from clause itself`
        )
      }
      from = new QueryRef(subQuery, alias)
    } else {
      throw new Error(`Invalid source`)
    }

    return new BaseQueryBuilder({
      ...this.query,
      from,
    }) as any
  }

  // JOIN method
  join<
    TSource extends Source,
    TJoinType extends `inner` | `left` | `right` | `full` = `left`,
  >(
    source: TSource,
    onCallback: JoinOnCallback<
      MergeContext<TContext, SchemaFromSource<TSource>>
    >,
    type: TJoinType = `left` as TJoinType
  ): QueryBuilder<
    MergeContextWithJoinType<TContext, SchemaFromSource<TSource>, TJoinType>
  > {
    if (Object.keys(source).length !== 1) {
      throw new Error(`Only one source is allowed in the join clause`)
    }

    const alias = Object.keys(source)[0]!
    const sourceValue = source[alias]

    let from: CollectionRef | QueryRef

    if (sourceValue instanceof CollectionImpl) {
      from = new CollectionRef(sourceValue, alias)
    } else if (sourceValue instanceof BaseQueryBuilder) {
      const subQuery = sourceValue._getQuery()
      if (!(subQuery as Partial<Query>).from) {
        throw new Error(
          `A sub query passed to a join clause must have a from clause itself`
        )
      }
      from = new QueryRef(subQuery, alias)
    } else {
      throw new Error(`Invalid source`)
    }

    // Create a temporary context for the callback
    const currentAliases = this._getCurrentAliases()
    const newAliases = [...currentAliases, alias]
    const refProxy = createRefProxy(newAliases) as RefProxyForContext<
      MergeContext<TContext, SchemaFromSource<TSource>>
    >

    // Get the join condition expression
    const onExpression = onCallback(refProxy)

    // Extract left and right from the expression
    // For now, we'll assume it's an eq function with two arguments
    let left: Expression
    let right: Expression

    if (
      onExpression.type === `func` &&
      onExpression.name === `eq` &&
      onExpression.args.length === 2
    ) {
      left = onExpression.args[0]!
      right = onExpression.args[1]!
    } else {
      throw new Error(`Join condition must be an equality expression`)
    }

    const joinClause: JoinClause = {
      from,
      type,
      left,
      right,
    }

    const existingJoins = this.query.join || []

    return new BaseQueryBuilder({
      ...this.query,
      join: [...existingJoins, joinClause],
    }) as any
  }

  // WHERE method
  where(callback: WhereCallback<TContext>): QueryBuilder<TContext> {
    const aliases = this._getCurrentAliases()
    const refProxy = createRefProxy(aliases) as RefProxyForContext<TContext>
    const expression = callback(refProxy)

    return new BaseQueryBuilder({
      ...this.query,
      where: expression,
    }) as any
  }

  // HAVING method
  having(callback: WhereCallback<TContext>): QueryBuilder<TContext> {
    const aliases = this._getCurrentAliases()
    const refProxy = createRefProxy(aliases) as RefProxyForContext<TContext>
    const expression = callback(refProxy)

    return new BaseQueryBuilder({
      ...this.query,
      having: expression,
    }) as any
  }

  // SELECT method
  select<TSelectObject extends SelectObject>(
    callback: (refs: RefProxyForContext<TContext>) => TSelectObject
  ): QueryBuilder<WithResult<TContext, ResultTypeFromSelect<TSelectObject>>> {
    const aliases = this._getCurrentAliases()
    const refProxy = createRefProxy(aliases) as RefProxyForContext<TContext>
    const selectObject = callback(refProxy)

    // Check if any tables were spread during the callback
    const spreadSentinels = (refProxy as any).__spreadSentinels as Set<string>

    // Convert the select object to use expressions, including spread sentinels
    const select: Record<string, Expression | Agg> = {}

    // First, add spread sentinels for any tables that were spread
    for (const spreadAlias of spreadSentinels) {
      const sentinelKey = `__SPREAD_SENTINEL__${spreadAlias}`
      select[sentinelKey] = toExpression(spreadAlias) // Use alias as a simple reference
    }

    // Then add the explicit select fields
    for (const [key, value] of Object.entries(selectObject)) {
      if (isRefProxy(value)) {
        select[key] = toExpression(value)
      } else if (
        typeof value === `object` &&
        `type` in value &&
        value.type === `agg`
      ) {
        select[key] = value
      } else if (
        typeof value === `object` &&
        `type` in value &&
        value.type === `func`
      ) {
        select[key] = value as Expression
      } else {
        select[key] = toExpression(value)
      }
    }

    return new BaseQueryBuilder({
      ...this.query,
      select,
      fnSelect: undefined, // remove the fnSelect clause if it exists
    }) as any
  }

  // ORDER BY method
  orderBy(
    callback: OrderByCallback<TContext>,
    direction: OrderByDirection = `asc`
  ): QueryBuilder<TContext> {
    const aliases = this._getCurrentAliases()
    const refProxy = createRefProxy(aliases) as RefProxyForContext<TContext>
    const result = callback(refProxy)

    // Create the new OrderBy structure with expression and direction
    const orderByClause: OrderByClause = {
      expression: toExpression(result),
      direction,
    }

    const existingOrderBy: OrderBy = this.query.orderBy || []

    return new BaseQueryBuilder({
      ...this.query,
      orderBy: [...existingOrderBy, orderByClause],
    }) as any
  }

  // GROUP BY method
  groupBy(callback: GroupByCallback<TContext>): QueryBuilder<TContext> {
    const aliases = this._getCurrentAliases()
    const refProxy = createRefProxy(aliases) as RefProxyForContext<TContext>
    const result = callback(refProxy)

    const newExpressions = Array.isArray(result)
      ? result.map((r) => toExpression(r))
      : [toExpression(result)]

    // Replace existing groupBy expressions instead of extending them
    return new BaseQueryBuilder({
      ...this.query,
      groupBy: newExpressions,
    }) as any
  }

  // LIMIT method
  limit(count: number): QueryBuilder<TContext> {
    return new BaseQueryBuilder({
      ...this.query,
      limit: count,
    }) as any
  }

  // OFFSET method
  offset(count: number): QueryBuilder<TContext> {
    return new BaseQueryBuilder({
      ...this.query,
      offset: count,
    }) as any
  }

  // Helper methods
  private _getCurrentAliases(): Array<string> {
    const aliases: Array<string> = []

    // Add the from alias
    if (this.query.from) {
      aliases.push(this.query.from.alias)
    }

    // Add join aliases
    if (this.query.join) {
      for (const join of this.query.join) {
        aliases.push(join.from.alias)
      }
    }

    return aliases
  }

  /**
   * Functional variants of the query builder
   * These are imperative function that are called for ery row.
   * Warning: that these cannot be optimized by the query compiler, and may prevent
   * some type of optimizations being possible.
   * @example
   * ```ts
   * q.fn.select((row) => row.user.name)
   * ```
   */
  get fn() {
    const builder = this
    return {
      select<TFuncSelectResult>(
        callback: (row: TContext[`schema`]) => TFuncSelectResult
      ): QueryBuilder<WithResult<TContext, TFuncSelectResult>> {
        return new BaseQueryBuilder({
          ...builder.query,
          select: undefined, // remove the select clause if it exists
          fnSelect: callback,
        })
      },
      where(
        callback: (row: TContext[`schema`]) => any
      ): QueryBuilder<TContext> {
        return new BaseQueryBuilder({
          ...builder.query,
          fnWhere: [
            ...(builder.query.fnWhere || []),
            callback as (row: NamespacedRow) => any,
          ],
        })
      },
      having(
        callback: (row: TContext[`schema`]) => any
      ): QueryBuilder<TContext> {
        return new BaseQueryBuilder({
          ...builder.query,
          fnHaving: [
            ...(builder.query.fnHaving || []),
            callback as (row: NamespacedRow) => any,
          ],
        })
      },
    }
  }

  _getQuery(): Query {
    if (!this.query.from) {
      throw new Error(`Query must have a from clause`)
    }
    return this.query as Query
  }
}

export function getQuery(
  builder: BaseQueryBuilder | QueryBuilder<any> | InitialQueryBuilder
): Query {
  return (builder as unknown as BaseQueryBuilder)._getQuery()
}

// Type-only exports for the query builder
export type InitialQueryBuilder = Pick<BaseQueryBuilder, `from`>

export type QueryBuilder<TContext extends Context> = Omit<
  BaseQueryBuilder<TContext>,
  `from` | `_getQuery`
>

// Helper type to extract context from a QueryBuilder
export type ExtractContext<T> =
  T extends BaseQueryBuilder<infer TContext>
    ? TContext
    : T extends QueryBuilder<infer TContext>
      ? TContext
      : never

// Export the types from types.ts for convenience
export type { Context, Source, GetResult } from "./types.js"

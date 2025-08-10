/*
This is the intermediate representation of the query.
*/

import type { CompareOptions } from "./builder/types"
import type { CollectionImpl } from "../collection"
import type { NamespacedRow } from "../types"

export interface QueryIR {
  from: From
  select?: Select
  join?: Join
  where?: Array<Where>
  groupBy?: GroupBy
  having?: Array<Having>
  orderBy?: OrderBy
  limit?: Limit
  offset?: Offset
  distinct?: true

  // Functional variants
  fnSelect?: (row: NamespacedRow) => any
  fnWhere?: Array<(row: NamespacedRow) => any>
  fnHaving?: Array<(row: NamespacedRow) => any>
}

export type From = CollectionRef | QueryRef

export type Select = {
  [alias: string]: BasicExpression | Aggregate
}

export type Join = Array<JoinClause>

export interface JoinClause {
  from: CollectionRef | QueryRef
  type: `left` | `right` | `inner` | `outer` | `full` | `cross`
  left: BasicExpression
  right: BasicExpression
}

export type Where = BasicExpression<boolean>

export type GroupBy = Array<BasicExpression>

export type Having = Where

export type OrderBy = Array<OrderByClause>

export type OrderByClause = {
  expression: BasicExpression
  compareOptions: CompareOptions
}

export type OrderByDirection = `asc` | `desc`

export type Limit = number

export type Offset = number

/* Expressions */

abstract class BaseExpression<T = any> {
  public abstract type: string
  /** @internal - Type brand for TypeScript inference */
  declare readonly __returnType: T
}

export class CollectionRef extends BaseExpression {
  public type = `collectionRef` as const
  constructor(
    public collection: CollectionImpl,
    public alias: string
  ) {
    super()
  }
}

export class QueryRef extends BaseExpression {
  public type = `queryRef` as const
  constructor(
    public query: QueryIR,
    public alias: string
  ) {
    super()
  }
}

export class PropRef<T = any> extends BaseExpression<T> {
  public type = `ref` as const
  constructor(
    public path: Array<string> // path to the property in the collection, with the alias as the first element
  ) {
    super()
  }
}

export class Value<T = any> extends BaseExpression<T> {
  public type = `val` as const
  constructor(
    public value: T // any js value
  ) {
    super()
  }
}

export class Func<T = any> extends BaseExpression<T> {
  public type = `func` as const
  constructor(
    public name: string, // such as eq, gt, lt, upper, lower, etc.
    public args: Array<BasicExpression>
  ) {
    super()
  }
}

// This is the basic expression type that is used in the majority of expression
// builder callbacks (select, where, groupBy, having, orderBy, etc.)
// it doesn't include aggregate functions as those are only used in the select clause
export type BasicExpression<T = any> = PropRef<T> | Value<T> | Func<T>

export class Aggregate<T = any> extends BaseExpression<T> {
  public type = `agg` as const
  constructor(
    public name: string, // such as count, avg, sum, min, max, etc.
    public args: Array<BasicExpression>
  ) {
    super()
  }
}

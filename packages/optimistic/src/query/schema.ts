import type {
  Context,
  InputReference,
  PropertyReference,
  PropertyReferenceString,
  WildcardReferenceString,
} from "./types.js"
import type { Collection } from "../collection"

// Identifiers
export type ColumnName<TColumnNames extends string> = TColumnNames

// JSONLike supports any JSON-compatible value plus Date objects.
export type JSONLike =
  | string
  | number
  | boolean
  | Date
  | null
  | Array<JSONLike>
  | { [key: string]: JSONLike }

// LiteralValue supports common primitives, JS Date, or undefined.
// We exclude strings that start with "@" because they are property references.
export type LiteralValue =
  | (string & {})
  | number
  | boolean
  | Date
  | null
  | undefined

// These versions are for use with methods on the query builder where we want to
// ensure that the argument is a string that does not start with "@".
// Can be combined with PropertyReference for validating references.
export type SafeString<T extends string> = T extends `@${string}` ? never : T
export type OptionalSafeString<T extends any> = T extends string
  ? SafeString<T>
  : never
export type LiteralValueWithSafeString<T extends any> =
  | (OptionalSafeString<T> & {})
  | number
  | boolean
  | Date
  | null
  | undefined

// To force a literal value (which may be arbitrary JSON or a Date), wrap it in an object with the "value" key.
export interface ExplicitLiteral {
  value: JSONLike
}

// Allowed function names (common SQL functions)
export type AllowedFunctionName =
  | `DATE`
  | `JSON_EXTRACT`
  | `JSON_EXTRACT_PATH`
  | `UPPER`
  | `LOWER`
  | `COALESCE`
  | `CONCAT`
  | `LENGTH`
  | `ORDER_INDEX`

// A function call is represented as a union of objects—each having exactly one key that is one of the allowed function names.
export type FunctionCall<TContext extends Context = Context> = {
  [K in AllowedFunctionName]: {
    [key in K]: ConditionOperand<TContext> | Array<ConditionOperand<TContext>>
  }
}[AllowedFunctionName]

export type AggregateFunctionName =
  | `SUM`
  | `COUNT`
  | `AVG`
  | `MIN`
  | `MAX`
  | `MEDIAN`
  | `MODE`

export type AggregateFunctionCall<TContext extends Context = Context> = {
  [K in AggregateFunctionName]: {
    [key in K]: ConditionOperand<TContext> | Array<ConditionOperand<TContext>>
  }
}[AggregateFunctionName]

/**
 * An operand in a condition may be:
 * - A literal value (LiteralValue)
 * - A column reference (a string starting with "@" or an explicit { col: string } object)
 * - An explicit literal (to wrap arbitrary JSON or Date values) as { value: ... }
 * - A function call (as defined above)
 * - An array of operands (for example, for "in" clauses)
 */
export type ConditionOperand<
  TContext extends Context = Context,
  T extends any = any,
> =
  | LiteralValue
  | PropertyReference<TContext>
  | ExplicitLiteral
  | FunctionCall<TContext>
  | Array<ConditionOperand<TContext, T>>

// Allowed SQL comparators.
export type Comparator =
  | `=`
  | `!=`
  | `<`
  | `<=`
  | `>`
  | `>=`
  | `like`
  | `not like`
  | `in`
  | `not in`
  | `is`
  | `is not`

// Logical operators.
export type LogicalOperator = `and` | `or`

// A simple condition is a tuple: [left operand, comparator, right operand].
export type SimpleCondition<
  TContext extends Context = Context,
  T extends any = any,
> = [ConditionOperand<TContext, T>, Comparator, ConditionOperand<TContext, T>]

// A flat composite condition allows all elements to be at the same level:
// [left1, op1, right1, 'and'/'or', left2, op2, right2, ...]
export type FlatCompositeCondition<
  TContext extends Context = Context,
  T extends any = any,
> = [
  ConditionOperand<TContext, T>,
  Comparator,
  ConditionOperand<TContext, T>,
  ...Array<LogicalOperator | ConditionOperand<TContext, T> | Comparator>,
]

// A nested composite condition combines conditions with logical operators
// The first element can be a SimpleCondition or FlatCompositeCondition
// followed by logical operators and more conditions
export type NestedCompositeCondition<
  TContext extends Context = Context,
  T extends any = any,
> = [
  SimpleCondition<TContext, T> | FlatCompositeCondition<TContext, T>,
  ...Array<
    | LogicalOperator
    | SimpleCondition<TContext, T>
    | FlatCompositeCondition<TContext, T>
  >,
]

// A condition is either a simple condition or a composite condition (flat or nested).
export type Condition<
  TContext extends Context = Context,
  T extends any = any,
> =
  | SimpleCondition<TContext, T>
  | FlatCompositeCondition<TContext, T>
  | NestedCompositeCondition<TContext, T>

// A join clause includes a join type, the table to join, an optional alias,
// an "on" condition, and an optional "where" clause specific to the join.
export interface JoinClause<TContext extends Context = Context> {
  type: `inner` | `left` | `right` | `full` | `cross`
  from: string
  as?: string
  on: Condition<TContext>
  where?: Condition<TContext>
}

// The orderBy clause can be a string, an object mapping a column to "asc" or "desc",
// or an array of such items.
export type OrderBy<TContext extends Context = Context> =
  | PropertyReferenceString<TContext>
  | { [column in PropertyReferenceString<TContext>]?: `asc` | `desc` }
  | Record<PropertyReferenceString<TContext>, `asc` | `desc`>
  | Array<
      | PropertyReferenceString<TContext>
      | { [column in PropertyReferenceString<TContext>]?: `asc` | `desc` }
    >

export type Select<TContext extends Context = Context> =
  | PropertyReferenceString<TContext>
  | {
      [alias: string]:
        | PropertyReference<TContext>
        | FunctionCall<TContext>
        | AggregateFunctionCall<TContext>
    }
  | WildcardReferenceString<TContext>

export type As<TContext extends Context = Context> = string

export type From<TContext extends Context = Context> = InputReference<{
  baseSchema: TContext[`baseSchema`]
  schema: TContext[`baseSchema`]
}>

export type Where<TContext extends Context = Context> = Condition<TContext>

export type GroupBy<TContext extends Context = Context> =
  | PropertyReference<TContext>
  | Array<PropertyReference<TContext>>

export type Having<TContext extends Context = Context> = Condition<TContext>

export type Limit<TContext extends Context = Context> = number

export type Offset<TContext extends Context = Context> = number

export interface BaseQuery<TContext extends Context = Context> {
  // The select clause is an array of either plain strings or objects mapping alias names
  // to expressions. Plain strings starting with "@" denote column references.
  // Plain string "@*" denotes all columns from all tables.
  // Plain string "@table.*" denotes all columns from a specific table.
  select: Array<Select<TContext>>
  as?: As<TContext>
  from: From<TContext>
  join?: Array<JoinClause<TContext>>
  where?: Condition<TContext>
  groupBy?: GroupBy<TContext>
  having?: Condition<TContext>
  orderBy?: OrderBy<TContext>
  limit?: Limit<TContext>
  offset?: Offset<TContext>
}

// The top-level query interface.
export interface Query<TContext extends Context = Context>
  extends BaseQuery<TContext> {
  keyBy?: PropertyReference<TContext> | Array<PropertyReference<TContext>>
  with?: Array<WithQuery<TContext>>
  collections?: {
    [K: string]: Collection<any>
  }
}

// A WithQuery is a query that is used as a Common Table Expression (CTE)
// It cannot be keyed and must have an alias (as)
// There is no support for recursive CTEs
export interface WithQuery<TContext extends Context = Context>
  extends BaseQuery<TContext> {
  as: string
}

// A keyed query is a query that has a keyBy clause, and so the result is always
// a keyed stream.
export interface KeyedQuery<TContext extends Context = Context>
  extends Query<TContext> {
  keyBy: PropertyReference<TContext> | Array<PropertyReference<TContext>>
}

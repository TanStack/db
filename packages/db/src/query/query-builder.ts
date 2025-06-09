import type { Collection } from "../collection"
import type {
  Comparator,
  Condition,
  From,
  JoinClause,
  Limit,
  LiteralValue,
  Offset,
  OrderBy,
  Query,
  Select,
  WithQuery,
} from "./schema.js"
import type {
  Context,
  Flatten,
  InferResultTypeFromSelectTuple,
  Input,
  InputReference,
  PropertyReference,
  PropertyReferenceString,
  RemoveIndexSignature,
  Schema,
} from "./types.js"

type CollectionRef = { [K: string]: Collection<any> }

export class BaseQueryBuilder<TContext extends Context<Schema>> {
  private readonly query: Partial<Query<TContext>> = {}

  /**
   * Create a new QueryBuilder instance.
   */
  constructor(query: Partial<Query<TContext>> = {}) {
    this.query = query
  }

  from<TCollectionRef extends CollectionRef>(
    collectionRef: TCollectionRef
  ): QueryBuilder<{
    baseSchema: Flatten<
      TContext[`baseSchema`] & {
        [K in keyof TCollectionRef & string]: RemoveIndexSignature<
          (TCollectionRef[keyof TCollectionRef] extends Collection<infer T>
            ? T
            : never) &
            Input
        >
      }
    >
    schema: Flatten<{
      [K in keyof TCollectionRef & string]: RemoveIndexSignature<
        (TCollectionRef[keyof TCollectionRef] extends Collection<infer T>
          ? T
          : never) &
          Input
      >
    }>
    default: keyof TCollectionRef & string
  }>

  from<
    T extends InputReference<{
      baseSchema: TContext[`baseSchema`]
      schema: TContext[`baseSchema`]
    }>,
  >(
    collection: T
  ): QueryBuilder<{
    baseSchema: TContext[`baseSchema`]
    schema: {
      [K in T]: RemoveIndexSignature<TContext[`baseSchema`][T]>
    }
    default: T
  }>

  from<
    T extends InputReference<{
      baseSchema: TContext[`baseSchema`]
      schema: TContext[`baseSchema`]
    }>,
    TAs extends string,
  >(
    collection: T,
    as: TAs
  ): QueryBuilder<{
    baseSchema: TContext[`baseSchema`]
    schema: {
      [K in TAs]: RemoveIndexSignature<TContext[`baseSchema`][T]>
    }
    default: TAs
  }>

  /**
   * Specify the collection to query from.
   * This is the first method that must be called in the chain.
   *
   * @param collection The collection name to query from
   * @param as Optional alias for the collection
   * @returns A new QueryBuilder with the from clause set
   */
  from<
    T extends
      | InputReference<{
          baseSchema: TContext[`baseSchema`]
          schema: TContext[`baseSchema`]
        }>
      | CollectionRef,
    TAs extends string | undefined,
  >(collection: T, as?: TAs) {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (typeof collection === `object` && collection !== null) {
      return this.fromCollectionRef(collection)
    } else if (typeof collection === `string`) {
      return this.fromInputReference(
        collection as InputReference<{
          baseSchema: TContext[`baseSchema`]
          schema: TContext[`baseSchema`]
        }>,
        as
      )
    } else {
      throw new Error(`Invalid collection type`)
    }
  }

  private fromCollectionRef<TCollectionRef extends CollectionRef>(
    collectionRef: TCollectionRef
  ) {
    const keys = Object.keys(collectionRef)
    if (keys.length !== 1) {
      throw new Error(`Expected exactly one key`)
    }

    const key = keys[0]!
    const collection = collectionRef[key]!

    const newBuilder = new BaseQueryBuilder()
    Object.assign(newBuilder.query, this.query)
    newBuilder.query.from = key as From<TContext>
    newBuilder.query.collections ??= {}
    newBuilder.query.collections[key] = collection

    return newBuilder as unknown as QueryBuilder<{
      baseSchema: TContext[`baseSchema`] & {
        [K in keyof TCollectionRef &
          string]: (TCollectionRef[keyof TCollectionRef] extends Collection<
          infer T
        >
          ? T
          : never) &
          Input
      }
      schema: {
        [K in keyof TCollectionRef &
          string]: (TCollectionRef[keyof TCollectionRef] extends Collection<
          infer T
        >
          ? T
          : never) &
          Input
      }
      default: keyof TCollectionRef & string
    }>
  }

  private fromInputReference<
    T extends InputReference<{
      baseSchema: TContext[`baseSchema`]
      schema: TContext[`baseSchema`]
    }>,
    TAs extends string | undefined,
  >(collection: T, as?: TAs) {
    const newBuilder = new BaseQueryBuilder()
    Object.assign(newBuilder.query, this.query)
    newBuilder.query.from = collection as From<TContext>
    if (as) {
      newBuilder.query.as = as
    }

    // Calculate the result type without deep nesting
    type ResultSchema = TAs extends undefined
      ? { [K in T]: TContext[`baseSchema`][T] }
      : { [K in string & TAs]: TContext[`baseSchema`][T] }

    type ResultDefault = TAs extends undefined ? T : string & TAs

    // Use simpler type assertion to avoid excessive depth
    return newBuilder as unknown as QueryBuilder<{
      baseSchema: TContext[`baseSchema`]
      schema: ResultSchema
      default: ResultDefault
    }>
  }

  /**
   * Specify what columns to select.
   * Overwrites any previous select clause.
   *
   * @param selects The columns to select
   * @returns A new QueryBuilder with the select clause set
   */
  select<TSelects extends Array<Select<TContext>>>(
    this: QueryBuilder<TContext>,
    ...selects: TSelects
  ) {
    // Validate function calls in the selects
    // Need to use a type assertion to bypass deep recursive type checking
    const validatedSelects = selects.map((select) => {
      // If the select is an object with aliases, validate each value
      if (
        typeof select === `object` &&
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        select !== null &&
        !Array.isArray(select)
      ) {
        const result: Record<string, any> = {}

        for (const [key, value] of Object.entries(select)) {
          // If it's a function call (object with a single key that is an allowed function name)
          if (
            typeof value === `object` &&
            value !== null &&
            !Array.isArray(value)
          ) {
            const keys = Object.keys(value)
            if (keys.length === 1) {
              const funcName = keys[0]!
              // List of allowed function names from AllowedFunctionName
              const allowedFunctions = [
                `SUM`,
                `COUNT`,
                `AVG`,
                `MIN`,
                `MAX`,
                `DATE`,
                `JSON_EXTRACT`,
                `JSON_EXTRACT_PATH`,
                `UPPER`,
                `LOWER`,
                `COALESCE`,
                `CONCAT`,
                `LENGTH`,
                `ORDER_INDEX`,
              ]

              if (!allowedFunctions.includes(funcName)) {
                console.warn(
                  `Unsupported function: ${funcName}. Expected one of: ${allowedFunctions.join(`, `)}`
                )
              }
            }
          }

          result[key] = value
        }

        return result
      }

      return select
    })

    // Ensure we have an orderByIndex in the select if we have an orderBy
    // This is required if select is called after orderBy
    if (this._query.orderBy) {
      validatedSelects.push({ _orderByIndex: { ORDER_INDEX: `numeric` } })
    }

    const newBuilder = new BaseQueryBuilder<TContext>(
      (this as BaseQueryBuilder<TContext>).query
    )
    newBuilder.query.select = validatedSelects as Array<Select<TContext>>

    return newBuilder as QueryBuilder<
      Flatten<
        Omit<TContext, `result`> & {
          result: InferResultTypeFromSelectTuple<TContext, TSelects>
        }
      >
    >
  }

  /**
   * Add a where clause comparing two values.
   */
  where(
    left: PropertyReferenceString<TContext> | LiteralValue,
    operator: Comparator,
    right: PropertyReferenceString<TContext> | LiteralValue
  ): QueryBuilder<TContext>

  /**
   * Add a where clause with a complete condition object.
   */
  where(condition: Condition<TContext>): QueryBuilder<TContext>

  /**
   * Add a where clause to filter the results.
   * Can be called multiple times to add AND conditions.
   *
   * @param leftOrCondition The left operand or complete condition
   * @param operator Optional comparison operator
   * @param right Optional right operand
   * @returns A new QueryBuilder with the where clause added
   */
  where(
    leftOrCondition: any,
    operator?: any,
    right?: any
  ): QueryBuilder<TContext> {
    // Create a new builder with a copy of the current query
    // Use simplistic approach to avoid deep type errors
    const newBuilder = new BaseQueryBuilder<TContext>()
    Object.assign(newBuilder.query, this.query)

    let condition: any

    // Determine if this is a complete condition or individual parts
    if (operator !== undefined && right !== undefined) {
      // Create a condition from parts
      condition = [leftOrCondition, operator, right]
    } else {
      // Use the provided condition directly
      condition = leftOrCondition
    }

    if (!newBuilder.query.where) {
      newBuilder.query.where = condition
    } else {
      // Create a composite condition with AND
      // Use any to bypass type checking issues
      const andArray: any = [newBuilder.query.where, `and`, condition]
      newBuilder.query.where = andArray
    }

    return newBuilder as unknown as QueryBuilder<TContext>
  }

  /**
   * Add a having clause comparing two values.
   * For filtering results after they have been grouped.
   */
  having(
    left: PropertyReferenceString<TContext> | LiteralValue,
    operator: Comparator,
    right: PropertyReferenceString<TContext> | LiteralValue
  ): QueryBuilder<TContext>

  /**
   * Add a having clause with a complete condition object.
   * For filtering results after they have been grouped.
   */
  having(condition: Condition<TContext>): QueryBuilder<TContext>

  /**
   * Add a having clause to filter the grouped results.
   * Can be called multiple times to add AND conditions.
   *
   * @param leftOrCondition The left operand or complete condition
   * @param operator Optional comparison operator
   * @param right Optional right operand
   * @returns A new QueryBuilder with the having clause added
   */
  having(
    leftOrCondition: any,
    operator?: any,
    right?: any
  ): QueryBuilder<TContext> {
    // Create a new builder with a copy of the current query
    const newBuilder = new BaseQueryBuilder<TContext>()
    Object.assign(newBuilder.query, this.query)

    let condition: any

    // Determine if this is a complete condition or individual parts
    if (operator !== undefined && right !== undefined) {
      // Create a condition from parts
      condition = [leftOrCondition, operator, right]
    } else {
      // Use the provided condition directly
      condition = leftOrCondition
    }

    if (!newBuilder.query.having) {
      newBuilder.query.having = condition
    } else {
      // Create a composite condition with AND
      // Use any to bypass type checking issues
      const andArray: any = [newBuilder.query.having, `and`, condition]
      newBuilder.query.having = andArray
    }

    return newBuilder as QueryBuilder<TContext>
  }

  /**
   * Add a join clause to the query using a CollectionRef.
   */
  join<TCollectionRef extends CollectionRef>(joinClause: {
    type: `inner` | `left` | `right` | `full` | `cross`
    from: TCollectionRef
    on: Condition<
      Flatten<{
        baseSchema: TContext[`baseSchema`]
        schema: TContext[`schema`] & {
          [K in keyof TCollectionRef & string]: RemoveIndexSignature<
            (TCollectionRef[keyof TCollectionRef] extends Collection<infer T>
              ? T
              : never) &
              Input
          >
        }
      }>
    >
    where?: Condition<
      Flatten<{
        baseSchema: TContext[`baseSchema`]
        schema: {
          [K in keyof TCollectionRef & string]: RemoveIndexSignature<
            (TCollectionRef[keyof TCollectionRef] extends Collection<infer T>
              ? T
              : never) &
              Input
          >
        }
      }>
    >
  }): QueryBuilder<
    Flatten<
      Omit<TContext, `schema`> & {
        schema: TContext[`schema`] & {
          [K in keyof TCollectionRef & string]: RemoveIndexSignature<
            (TCollectionRef[keyof TCollectionRef] extends Collection<infer T>
              ? T
              : never) &
              Input
          >
        }
        hasJoin: true
      }
    >
  >

  /**
   * Add a join clause to the query without specifying an alias.
   * The collection name will be used as the default alias.
   */
  join<
    T extends InputReference<{
      baseSchema: TContext[`baseSchema`]
      schema: TContext[`baseSchema`]
    }>,
  >(joinClause: {
    type: `inner` | `left` | `right` | `full` | `cross`
    from: T
    on: Condition<
      Flatten<{
        baseSchema: TContext[`baseSchema`]
        schema: TContext[`schema`] & {
          [K in T]: RemoveIndexSignature<TContext[`baseSchema`][T]>
        }
      }>
    >
    where?: Condition<
      Flatten<{
        baseSchema: TContext[`baseSchema`]
        schema: { [K in T]: RemoveIndexSignature<TContext[`baseSchema`][T]> }
      }>
    >
  }): QueryBuilder<
    Flatten<
      Omit<TContext, `schema`> & {
        schema: TContext[`schema`] & {
          [K in T]: RemoveIndexSignature<TContext[`baseSchema`][T]>
        }
        hasJoin: true
      }
    >
  >

  /**
   * Add a join clause to the query with a specified alias.
   */
  join<
    TFrom extends InputReference<{
      baseSchema: TContext[`baseSchema`]
      schema: TContext[`baseSchema`]
    }>,
    TAs extends string,
  >(joinClause: {
    type: `inner` | `left` | `right` | `full` | `cross`
    from: TFrom
    as: TAs
    on: Condition<
      Flatten<{
        baseSchema: TContext[`baseSchema`]
        schema: TContext[`schema`] & {
          [K in TAs]: RemoveIndexSignature<TContext[`baseSchema`][TFrom]>
        }
      }>
    >
    where?: Condition<
      Flatten<{
        baseSchema: TContext[`baseSchema`]
        schema: {
          [K in TAs]: RemoveIndexSignature<TContext[`baseSchema`][TFrom]>
        }
      }>
    >
  }): QueryBuilder<
    Flatten<
      Omit<TContext, `schema`> & {
        schema: TContext[`schema`] & {
          [K in TAs]: RemoveIndexSignature<TContext[`baseSchema`][TFrom]>
        }
        hasJoin: true
      }
    >
  >

  join<
    TFrom extends
      | InputReference<{
          baseSchema: TContext[`baseSchema`]
          schema: TContext[`baseSchema`]
        }>
      | CollectionRef,
    TAs extends string | undefined = undefined,
  >(joinClause: {
    type: `inner` | `left` | `right` | `full` | `cross`
    from: TFrom
    as?: TAs
    on: Condition<
      Flatten<{
        baseSchema: TContext[`baseSchema`]
        schema: TContext[`schema`] &
          (TFrom extends CollectionRef
            ? {
                [K in keyof TFrom & string]: RemoveIndexSignature<
                  (TFrom[keyof TFrom] extends Collection<infer T> ? T : never) &
                    Input
                >
              }
            : TFrom extends InputReference<infer TRef>
              ? {
                  [K in keyof TRef & string]: RemoveIndexSignature<
                    TRef[keyof TRef]
                  >
                }
              : never)
      }>
    >
    where?: Condition<
      Flatten<{
        baseSchema: TContext[`baseSchema`]
        schema: TContext[`schema`] &
          (TFrom extends CollectionRef
            ? {
                [K in keyof TFrom & string]: RemoveIndexSignature<
                  (TFrom[keyof TFrom] extends Collection<infer T> ? T : never) &
                    Input
                >
              }
            : TFrom extends InputReference<infer TRef>
              ? {
                  [K in keyof TRef & string]: RemoveIndexSignature<
                    TRef[keyof TRef]
                  >
                }
              : never)
      }>
    >
  }): QueryBuilder<any> {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (typeof joinClause.from === `object` && joinClause.from !== null) {
      return this.joinCollectionRef(
        joinClause as {
          type: `inner` | `left` | `right` | `full` | `cross`
          from: CollectionRef
          on: Condition<any>
          where?: Condition<any>
        }
      )
    } else {
      return this.joinInputReference(
        joinClause as {
          type: `inner` | `left` | `right` | `full` | `cross`
          from: InputReference<{
            baseSchema: TContext[`baseSchema`]
            schema: TContext[`baseSchema`]
          }>
          as?: TAs
          on: Condition<any>
          where?: Condition<any>
        }
      )
    }
  }

  private joinCollectionRef<TCollectionRef extends CollectionRef>(joinClause: {
    type: `inner` | `left` | `right` | `full` | `cross`
    from: TCollectionRef
    on: Condition<any>
    where?: Condition<any>
  }): QueryBuilder<any> {
    // Create a new builder with a copy of the current query
    const newBuilder = new BaseQueryBuilder<TContext>()
    Object.assign(newBuilder.query, this.query)

    // Get the collection key
    const keys = Object.keys(joinClause.from)
    if (keys.length !== 1) {
      throw new Error(`Expected exactly one key in CollectionRef`)
    }
    const key = keys[0]!
    const collection = joinClause.from[key]
    if (!collection) {
      throw new Error(`Collection not found for key: ${key}`)
    }

    // Create a copy of the join clause for the query
    const joinClauseCopy = {
      type: joinClause.type,
      from: key,
      on: joinClause.on,
      where: joinClause.where,
    } as JoinClause<TContext>

    // Add the join clause to the query
    if (!newBuilder.query.join) {
      newBuilder.query.join = [joinClauseCopy]
    } else {
      newBuilder.query.join = [...newBuilder.query.join, joinClauseCopy]
    }

    // Add the collection to the collections map
    newBuilder.query.collections ??= {}
    newBuilder.query.collections[key] = collection

    // Return the new builder with updated schema type
    return newBuilder as QueryBuilder<
      Flatten<
        Omit<TContext, `schema`> & {
          schema: TContext[`schema`] & {
            [K in keyof TCollectionRef & string]: RemoveIndexSignature<
              (TCollectionRef[keyof TCollectionRef] extends Collection<infer T>
                ? T
                : never) &
                Input
            >
          }
        }
      >
    >
  }

  private joinInputReference<
    TFrom extends InputReference<{
      baseSchema: TContext[`baseSchema`]
      schema: TContext[`baseSchema`]
    }>,
    TAs extends string | undefined = undefined,
  >(joinClause: {
    type: `inner` | `left` | `right` | `full` | `cross`
    from: TFrom
    as?: TAs
    on: Condition<any>
    where?: Condition<any>
  }): QueryBuilder<any> {
    // Create a new builder with a copy of the current query
    const newBuilder = new BaseQueryBuilder<TContext>()
    Object.assign(newBuilder.query, this.query)

    // Create a copy of the join clause for the query
    const joinClauseCopy = { ...joinClause } as JoinClause<TContext>

    // Add the join clause to the query
    if (!newBuilder.query.join) {
      newBuilder.query.join = [joinClauseCopy]
    } else {
      newBuilder.query.join = [...newBuilder.query.join, joinClauseCopy]
    }

    // Determine the alias or use the collection name as default
    const _effectiveAlias = joinClause.as ?? joinClause.from

    // Return the new builder with updated schema type
    return newBuilder as QueryBuilder<
      Flatten<
        Omit<TContext, `schema`> & {
          schema: TContext[`schema`] & {
            [K in typeof _effectiveAlias]: TContext[`baseSchema`][TFrom]
          }
        }
      >
    >
  }

  /**
   * Add an orderBy clause to sort the results.
   * Overwrites any previous orderBy clause.
   *
   * @param orderBy The order specification
   * @returns A new QueryBuilder with the orderBy clause set
   */
  orderBy(orderBy: OrderBy<TContext>): QueryBuilder<TContext> {
    // Create a new builder with a copy of the current query
    const newBuilder = new BaseQueryBuilder<TContext>()
    Object.assign(newBuilder.query, this.query)

    // Set the orderBy clause
    newBuilder.query.orderBy = orderBy

    // Ensure we have an orderByIndex in the select if we have an orderBy
    // This is required if select is called before orderBy
    newBuilder.query.select = [
      ...(newBuilder.query.select ?? []),
      { _orderByIndex: { ORDER_INDEX: `numeric` } },
    ]

    return newBuilder as QueryBuilder<TContext>
  }

  /**
   * Set a limit on the number of results returned.
   *
   * @param limit Maximum number of results to return
   * @returns A new QueryBuilder with the limit set
   */
  limit(limit: Limit<TContext>): QueryBuilder<TContext> {
    // Create a new builder with a copy of the current query
    const newBuilder = new BaseQueryBuilder<TContext>()
    Object.assign(newBuilder.query, this.query)

    // Set the limit
    newBuilder.query.limit = limit

    return newBuilder as QueryBuilder<TContext>
  }

  /**
   * Set an offset to skip a number of results.
   *
   * @param offset Number of results to skip
   * @returns A new QueryBuilder with the offset set
   */
  offset(offset: Offset<TContext>): QueryBuilder<TContext> {
    // Create a new builder with a copy of the current query
    const newBuilder = new BaseQueryBuilder<TContext>()
    Object.assign(newBuilder.query, this.query)

    // Set the offset
    newBuilder.query.offset = offset

    return newBuilder as QueryBuilder<TContext>
  }

  /**
   * Add a groupBy clause to group the results by one or more columns.
   *
   * @param groupBy The column(s) to group by
   * @returns A new QueryBuilder with the groupBy clause set
   */
  groupBy(
    groupBy: PropertyReference<TContext> | Array<PropertyReference<TContext>>
  ): QueryBuilder<TContext> {
    // Create a new builder with a copy of the current query
    const newBuilder = new BaseQueryBuilder<TContext>()
    Object.assign(newBuilder.query, this.query)

    // Set the groupBy clause
    newBuilder.query.groupBy = groupBy

    return newBuilder as QueryBuilder<TContext>
  }

  /**
   * Define a Common Table Expression (CTE) that can be referenced in the main query.
   * This allows referencing the CTE by name in subsequent from/join clauses.
   *
   * @param name The name of the CTE
   * @param queryBuilderCallback A function that builds the CTE query
   * @returns A new QueryBuilder with the CTE added
   */
  with<TName extends string, TResult = Record<string, unknown>>(
    name: TName,
    queryBuilderCallback: (
      builder: InitialQueryBuilder<{
        baseSchema: TContext[`baseSchema`]
        schema: {}
      }>
    ) => QueryBuilder<any>
  ): InitialQueryBuilder<{
    baseSchema: TContext[`baseSchema`] & { [K in TName]: TResult }
    schema: TContext[`schema`]
  }> {
    // Create a new builder with a copy of the current query
    const newBuilder = new BaseQueryBuilder<TContext>()
    Object.assign(newBuilder.query, this.query)

    // Create a new builder for the CTE
    const cteBuilder = new BaseQueryBuilder<{
      baseSchema: TContext[`baseSchema`]
      schema: {}
    }>()

    // Get the CTE query from the callback
    const cteQueryBuilder = queryBuilderCallback(
      cteBuilder as InitialQueryBuilder<{
        baseSchema: TContext[`baseSchema`]
        schema: {}
      }>
    )

    // Get the query from the builder
    const cteQuery = cteQueryBuilder._query

    // Add an 'as' property to the CTE
    const withQuery: WithQuery<any> = {
      ...cteQuery,
      as: name,
    }

    // Add the CTE to the with array
    if (!newBuilder.query.with) {
      newBuilder.query.with = [withQuery]
    } else {
      newBuilder.query.with = [...newBuilder.query.with, withQuery]
    }

    // Use a type cast that simplifies the type structure to avoid recursion
    return newBuilder as unknown as InitialQueryBuilder<{
      baseSchema: TContext[`baseSchema`] & { [K in TName]: TResult }
      schema: TContext[`schema`]
    }>
  }

  get _query(): Query<TContext> {
    return this.query as Query<TContext>
  }
}

export type InitialQueryBuilder<TContext extends Context<Schema>> = Pick<
  BaseQueryBuilder<TContext>,
  `from` | `with`
>

export type QueryBuilder<TContext extends Context<Schema>> = Omit<
  BaseQueryBuilder<TContext>,
  `from`
>

/**
 * Create a new query builder with the given schema
 */
export function queryBuilder<TBaseSchema extends Schema = {}>() {
  return new BaseQueryBuilder<{
    baseSchema: TBaseSchema
    schema: {}
  }>() as InitialQueryBuilder<{
    baseSchema: TBaseSchema
    schema: {}
  }>
}

export type ResultsFromContext<TContext extends Context<Schema>> = Flatten<
  TContext[`result`] extends object
    ? TContext[`result`] // If there is a select we will have a result type
    : TContext[`hasJoin`] extends true
      ? TContext[`schema`] // If there is a join, the query returns the namespaced schema
      : TContext[`default`] extends keyof TContext[`schema`]
        ? TContext[`schema`][TContext[`default`]] // If there is no join we return the flat default schema
        : never // Should never happen
>

export type ResultFromQueryBuilder<TQueryBuilder> = Flatten<
  TQueryBuilder extends QueryBuilder<infer C>
    ? C extends { result: infer R }
      ? R
      : never
    : never
>

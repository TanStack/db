import { isRefProxy } from './builder/ref-proxy-identity.js'

/*
This is the intermediate representation of the query.
*/

import type { CompareOptions } from './builder/types'
import type { Collection, CollectionImpl } from '../collection/index.js'
import type { CollectionOptionsIdentity } from '../collection-options.js'
import type { NamespacedRow } from '../types'

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
  singleResult?: true

  // Functional variants
  fnSelect?: (row: NamespacedRow) => any
  fnWhere?: Array<(row: NamespacedRow) => any>
  fnHaving?: Array<(row: NamespacedRow) => any>
}

export type IncludesMaterialization =
  `collection` | `array` | `singleton` | `concat`

export const INCLUDES_SCALAR_FIELD = `__includes_scalar__`

export type CollectionSourceRef = CollectionRef | DescriptorRef

export type From = CollectionSourceRef | QueryRef | UnionFrom | UnionAll

export type Select = {
  [alias: string]:
    BasicExpression | Aggregate | Select | IncludesSubquery | ConditionalSelect
}

export type Join = Array<JoinClause>

export interface JoinClause {
  from: CollectionSourceRef | QueryRef
  type: `left` | `right` | `inner` | `outer` | `full` | `cross`
  on: BasicExpression<boolean>
}

export type Where =
  | BasicExpression<boolean>
  | { expression: BasicExpression<boolean>; residual?: boolean }

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

let nextCollectionSourceId = 0

/* Expressions */

abstract class BaseExpression<T = any> {
  public abstract type: string
  /** @internal - Type brand for TypeScript inference */
  declare readonly __returnType: T
}

export class CollectionRef extends BaseExpression {
  public type = `collectionRef` as const
  // Not an own property, so structural identity and hashing ignore it.
  readonly #sourceId = `source-${++nextCollectionSourceId}`
  declare public collection: CollectionImpl
  public alias: string

  constructor(
    collection: CollectionImpl<any, string | number, any, any, any>,
    alias: string,
  ) {
    super()
    this.collection = collection as CollectionImpl
    this.alias = alias
  }

  /** Opaque runtime identity; aliases are lexical names only. */
  get sourceId(): string {
    return this.#sourceId
  }
}

export class DescriptorRef extends BaseExpression {
  public type = `descriptorRef` as const
  readonly #sourceId = `source-${++nextCollectionSourceId}`
  constructor(
    public descriptor: CollectionOptionsIdentity<any, any, any, any, any>,
    public alias: string,
  ) {
    super()
  }

  /** Opaque runtime identity for this unbound source placement. */
  get sourceId(): string {
    return this.#sourceId
  }
}

/** A descriptor must bind to a DbClient before a Collection is required. */
export function requireCollectionSource(source: DescriptorRef): never
export function requireCollectionSource(
  source: CollectionSourceRef,
): CollectionImpl
export function requireCollectionSource(
  source: CollectionSourceRef,
): CollectionImpl {
  if (source.type === `descriptorRef`) {
    throw new Error(
      `Collection descriptor "${source.alias}" requires a DbClient when the query is consumed. Bind the query through a client-aware API or use a concrete Collection.`,
    )
  }
  return source.collection
}

export class QueryRef extends BaseExpression {
  public type = `queryRef` as const
  constructor(
    public query: QueryIR,
    public alias: string,
  ) {
    super()
  }
}

export class UnionFrom extends BaseExpression {
  public type = `unionFrom` as const
  constructor(public sources: Array<CollectionSourceRef | QueryRef>) {
    super()
  }

  get alias(): string {
    return this.sources[0]?.alias ?? ``
  }
}

export class UnionAll extends BaseExpression {
  public type = `unionAll` as const
  /**
   * Result-level UNION ALL. Downstream query clauses see the union result row
   * shape, not the branch source aliases. Optimizers may push safe operations
   * into branches, but compiler phases should treat this as a derived relation
   * unless they are explicitly handling branch lowering.
   */
  constructor(public queries: Array<QueryIR>) {
    super()
  }

  get alias(): string {
    return ``
  }
}

export class PropRef<T = any> extends BaseExpression<T> {
  public type = `ref` as const
  declare public readonly sourceAlias?: string
  constructor(
    public path: Array<string>, // path to the property in the collection, with the alias as the first element
    sourceAlias?: string,
  ) {
    super()
    // Present only when given, so unqualified refs keep their shape.
    if (sourceAlias !== undefined) {
      ;(this as { sourceAlias?: string }).sourceAlias = sourceAlias
    }
  }
}

/** Returns an explicitly declared source alias without inferring from the path. */
export function getPropRefSourceAlias(ref: PropRef): string | undefined {
  return ref.sourceAlias !== undefined && ref.path[0] === ref.sourceAlias
    ? ref.sourceAlias
    : undefined
}

/** Returns the property path after removing only explicit source qualification. */
export function getPropRefPropertyPath(ref: PropRef): Array<string> {
  return getPropRefSourceAlias(ref) === undefined ? ref.path : ref.path.slice(1)
}

export class Value<T = any> extends BaseExpression<T> {
  public type = `val` as const
  constructor(
    public value: T, // any js value
  ) {
    super()
  }
}

export class Func<T = any> extends BaseExpression<T> {
  public type = `func` as const
  constructor(
    public name: string, // such as eq, gt, lt, upper, lower, etc.
    public args: Array<BasicExpression>,
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
    public args: Array<BasicExpression>,
  ) {
    super()
  }
}

export class IncludesSubquery extends BaseExpression {
  public type = `includesSubquery` as const
  constructor(
    public query: QueryIR, // Child query (correlation WHERE removed)
    public correlationField: PropRef, // Parent-side ref (e.g., project.id)
    public childCorrelationField: PropRef, // Child-side ref (e.g., issue.projectId)
    public fieldName: string, // Result field name (e.g., "issues")
    public parentFilters?: Array<Where>, // WHERE clauses referencing parent aliases (applied post-join)
    public parentProjection?: Array<PropRef>, // Parent field refs used anywhere in the child plan
    public materialization: IncludesMaterialization = `collection`,
    public scalarField?: string,
  ) {
    super()
  }
}

export type ConditionalSelectBranch = {
  condition: BasicExpression
  value: SelectValueExpression
}

export type SelectValueExpression =
  BasicExpression | Aggregate | Select | IncludesSubquery | ConditionalSelect

export class ConditionalSelect extends BaseExpression {
  public type = `conditionalSelect` as const
  constructor(
    public branches: Array<ConditionalSelectBranch>,
    public defaultValue?: SelectValueExpression,
  ) {
    super()
  }
}

/** Distinguish compiler expressions from user objects with IR-like fields. */
export function isBasicOrAggregateExpression(
  value: unknown,
): value is BasicExpression | Aggregate {
  return (
    value instanceof Aggregate ||
    value instanceof Func ||
    value instanceof PropRef ||
    value instanceof Value
  )
}

export function isExpressionLike(value: unknown): boolean {
  return (
    isBasicOrAggregateExpression(value) ||
    value instanceof ConditionalSelect ||
    value instanceof IncludesSubquery
  )
}

/** Returns each lexical Collection or descriptor source in a query tree once. */
export function collectSourceRefs(query: QueryIR): Array<CollectionSourceRef> {
  const sources: Array<CollectionSourceRef> = []
  const seen = new Set<string>()

  const visitSource = (source: QueryIR[`from`]): void => {
    if (source.type === `collectionRef` || source.type === `descriptorRef`) {
      if (!seen.has(source.sourceId)) {
        seen.add(source.sourceId)
        sources.push(source)
      }
    } else if (source.type === `queryRef`) {
      visitQuery(source.query)
    } else if (source.type === `unionFrom`) {
      source.sources.forEach(visitSource)
    } else {
      source.queries.forEach(visitQuery)
    }
  }

  const visitSelectValue = (value: any): void => {
    if (value instanceof IncludesSubquery) {
      visitQuery(value.query)
    } else if (value instanceof ConditionalSelect) {
      value.branches.forEach((branch) => visitSelectValue(branch.value))
      if (value.defaultValue !== undefined) {
        visitSelectValue(value.defaultValue)
      }
    } else if (
      value !== null &&
      typeof value === `object` &&
      !Array.isArray(value) &&
      !isExpressionLike(value) &&
      !isRefProxy(value)
    ) {
      Object.values(value).forEach(visitSelectValue)
    }
  }

  const visitQuery = (current: QueryIR): void => {
    visitSource(current.from)
    current.join?.forEach(({ from }) => visitSource(from))
    if (current.select) Object.values(current.select).forEach(visitSelectValue)
  }

  visitQuery(query)
  return sources
}

/** Returns concrete Collection sources after requiring client binding. */
export function collectCollectionSources(query: QueryIR): Array<CollectionRef> {
  return collectSourceRefs(query).map((source) =>
    source.type === `descriptorRef` ? requireCollectionSource(source) : source,
  )
}

/**
 * Helper functions for working with Where clauses
 */

/**
 * Extract the expression from a Where clause
 */
export function getWhereExpression(where: Where): BasicExpression<boolean> {
  return typeof where === `object` && `expression` in where
    ? where.expression
    : where
}

/**
 * Extract the expression from a HAVING clause
 * HAVING clauses can contain aggregates, unlike regular WHERE clauses
 */
export function getHavingExpression(
  having: Having,
): BasicExpression | Aggregate {
  return typeof having === `object` && `expression` in having
    ? having.expression
    : having
}

/**
 * Check if a Where clause is marked as residual
 */
export function isResidualWhere(where: Where): boolean {
  return (
    typeof where === `object` &&
    `expression` in where &&
    where.residual === true
  )
}

/**
 * Create a residual Where clause from an expression
 */
export function createResidualWhere(
  expression: BasicExpression<boolean>,
): Where {
  return { expression, residual: true }
}

/** Sources declared by a FROM clause. UnionAll branches own their sources. */
export function getFromSources(
  from: From,
): Array<CollectionSourceRef | QueryRef> {
  if (from.type === `unionFrom`) return from.sources
  if (from.type === `unionAll`) return []
  return [from]
}

function getRefFromAlias(
  query: QueryIR,
  alias: string,
): CollectionSourceRef | QueryRef | void {
  for (const source of getFromSources(query.from)) {
    if (source.alias === alias) {
      return source
    }
  }

  for (const join of query.join || []) {
    if (join.from.alias === alias) {
      return join.from
    }
  }
}

/**
 * Follows the given reference in a query
 * until its finds the root field the reference points to.
 * @returns The collection, its alias, and the path to the root field in this collection.
 * `alias` is the alias under which the resolved collection is referenced in the
 * query it was reached from (when the ref crosses into a joined source). It is
 * left undefined when the ref simply resolves to a field on the passed-in
 * `collection`, in which case the caller already knows the alias.
 */
export function followRef(
  query: QueryIR,
  ref: PropRef<any>,
  collection: Collection,
): {
  collection: Collection
  path: Array<string>
  alias?: string
  sourceId?: string
} | void {
  const explicitAlias = getPropRefSourceAlias(ref)
  if (explicitAlias !== undefined) {
    const aliasRef = getRefFromAlias(query, explicitAlias)
    if (!aliasRef) return

    const propertyPath = getPropRefPropertyPath(ref)
    if (aliasRef.type === `queryRef`) {
      return followRef(aliasRef.query, new PropRef(propertyPath), collection)
    }

    return {
      collection: requireCollectionSource(aliasRef),
      path: propertyPath,
      alias: explicitAlias,
      sourceId: aliasRef.sourceId,
    }
  }

  if (ref.path.length === 0) {
    return
  }

  if (ref.path.length === 1) {
    // This field should be part of this collection
    const field = ref.path[0]!
    // is it part of the select clause?
    if (query.select) {
      const selectedField = query.select[field]
      if (selectedField) {
        // A computed projection has no source field that can satisfy a
        // source-level lookup or ordered acquisition.
        return selectedField.type === `ref`
          ? followRef(query, selectedField, collection)
          : undefined
      }
    }

    // Without a projection for this field, it belongs to the source row.
    return { collection, path: [field] }
  }

  if (ref.path.length > 1) {
    // This is a nested field
    const [alias, ...rest] = ref.path
    const aliasRef = getRefFromAlias(query, alias!)
    if (!aliasRef) {
      return
    }

    if (aliasRef.type === `queryRef`) {
      return followRef(aliasRef.query, new PropRef(rest), collection)
    } else {
      // This is a reference to a collection
      // we can't follow it further
      // so the field must be on the collection itself.
      // Report the alias too: when the ref crossed a join, this is the source
      // that actually holds the field (which may differ from the from clause).
      return {
        collection: requireCollectionSource(aliasRef),
        path: rest,
        alias,
        sourceId: aliasRef.sourceId,
      }
    }
  }
}

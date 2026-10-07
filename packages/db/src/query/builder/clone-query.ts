import {
  CollectionRef,
  ConditionalSelect,
  IncludesSubquery,
  QueryRef,
  UnionAll,
  UnionFrom,
  isExpressionLike,
} from '../ir.js'
import { isRefProxy } from './ref-proxy-identity.js'
import type { CollectionImpl } from '../../collection/index.js'
import type { CollectionOptionsIdentity } from '../../collection-options.js'
import type { From, QueryIR, Select, SelectValueExpression } from '../ir.js'

export type CollectionResolver = (
  options: CollectionOptionsIdentity<any, string | number, any, any, any>,
) => CollectionImpl<any, string | number, any, any, any>

type CloneContext = {
  clones: WeakMap<object, object>
  resolveCollection?: CollectionResolver
}

/**
 * Gives every query-source placement its own runtime source identities.
 *
 * A reused builder describes the same query meaning, but each FROM, JOIN,
 * UNION, or include placement owns an independent position in the dataflow
 * graph. Expressions are immutable and can remain shared; CollectionRefs
 * cannot because their sourceId identifies that lexical position. A supplied
 * resolver also binds any retained descriptors while cloning the plan.
 */
export function cloneQueryForPlacement(
  query: QueryIR,
  resolveCollection?: CollectionResolver,
): QueryIR {
  return cloneQuery(query, { clones: new WeakMap(), resolveCollection })
}

function cloneQuery(query: QueryIR, context: CloneContext): QueryIR {
  const { clones } = context
  const existing = clones.get(query)
  if (existing) return existing as QueryIR

  const cloned: QueryIR = {
    ...query,
  }
  clones.set(query, cloned)

  cloned.from = cloneFromForPlacement(query.from, context)
  cloned.join = query.join?.map((join) => ({
    ...join,
    from: cloneSourceForPlacement(join.from, context),
  }))
  cloned.select =
    query.select === undefined || isExpressionLike(query.select)
      ? query.select
      : cloneSelectForPlacement(query.select, context)
  return cloned
}

function cloneFromForPlacement(from: From, context: CloneContext): From {
  if (from.type === `unionFrom`) {
    return new UnionFrom(
      from.sources.map((source) => cloneSourceForPlacement(source, context)),
    )
  }

  if (from.type === `unionAll`) {
    return new UnionAll(from.queries.map((query) => cloneQuery(query, context)))
  }

  return cloneSourceForPlacement(from, context)
}

function cloneSourceForPlacement(
  source: CollectionRef | QueryRef,
  context: CloneContext,
): CollectionRef | QueryRef {
  if (source.type === `collectionRef`) {
    const descriptor = source.descriptor
    return new CollectionRef(
      descriptor && context.resolveCollection
        ? context.resolveCollection(descriptor)
        : source.source,
      source.alias,
    )
  }

  return new QueryRef(cloneQuery(source.query, context), source.alias)
}

function cloneSelectForPlacement(
  select: Select,
  context: CloneContext,
): Select {
  const { clones } = context
  const existing = clones.get(select)
  if (existing) return existing as Select

  const cloned: Select = {}
  clones.set(select, cloned)
  for (const [field, value] of Object.entries(select)) {
    cloned[field] = cloneSelectValueForPlacement(value, context)
  }
  return cloned
}

function cloneSelectValueForPlacement(
  value: unknown,
  context: CloneContext,
): SelectValueExpression {
  const { clones } = context
  if (value instanceof IncludesSubquery) {
    const existing = clones.get(value)
    if (existing) return existing as IncludesSubquery

    const cloned = new IncludesSubquery(
      cloneQuery(value.query, context),
      value.correlationField,
      value.childCorrelationField,
      value.fieldName,
      value.parentFilters,
      value.parentProjection,
      value.materialization,
      value.scalarField,
    )
    clones.set(value, cloned)
    return cloned
  }

  if (value instanceof ConditionalSelect) {
    const existing = clones.get(value)
    if (existing) return existing as ConditionalSelect

    const cloned = new ConditionalSelect(
      value.branches.map((branch) => ({
        ...branch,
        value: cloneSelectValueForPlacement(branch.value, context),
      })),
      value.defaultValue !== undefined
        ? cloneSelectValueForPlacement(value.defaultValue, context)
        : undefined,
    )
    clones.set(value, cloned)
    return cloned
  }

  if (value === null || typeof value !== `object` || Array.isArray(value)) {
    return value as SelectValueExpression
  }

  if (isRefProxy(value)) {
    return value as unknown as SelectValueExpression
  }

  return isExpressionLike(value)
    ? (value as SelectValueExpression)
    : cloneSelectForPlacement(value as Select, context)
}

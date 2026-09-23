import {
  CollectionRef,
  ConditionalSelect,
  IncludesSubquery,
  QueryRef,
  UnionAll,
  UnionFrom,
  isExpressionLike,
} from '../ir.js'
import type {
  From,
  QueryIR,
  Select,
  SelectValueExpression,
} from '../ir.js'

/**
 * Gives every query-source placement its own runtime source identities.
 *
 * A reused builder describes the same query meaning, but each FROM, JOIN,
 * UNION, or include placement owns an independent position in the dataflow
 * graph. Expressions are immutable and can remain shared; CollectionRefs
 * cannot because their sourceId identifies that lexical position.
 */
export function cloneQueryForPlacement(query: QueryIR): QueryIR {
  return cloneQuery(query, new WeakMap())
}

function cloneQuery(query: QueryIR, clones: WeakMap<object, object>): QueryIR {
  const existing = clones.get(query)
  if (existing) return existing as QueryIR

  const cloned: QueryIR = {
    ...query,
  }
  clones.set(query, cloned)

  cloned.from = cloneFromForPlacement(query.from, clones)
  cloned.join = query.join?.map((join) => ({
    ...join,
    from: cloneSourceForPlacement(join.from, clones),
  }))
  cloned.select = query.select
    ? cloneSelectForPlacement(query.select, clones)
    : undefined
  return cloned
}

function cloneFromForPlacement(
  from: From,
  clones: WeakMap<object, object>,
): From {
  if (from.type === `unionFrom`) {
    return new UnionFrom(
      from.sources.map((source) => cloneSourceForPlacement(source, clones)),
    )
  }

  if (from.type === `unionAll`) {
    return new UnionAll(from.queries.map((query) => cloneQuery(query, clones)))
  }

  return cloneSourceForPlacement(from, clones)
}

function cloneSourceForPlacement(
  source: CollectionRef | QueryRef,
  clones: WeakMap<object, object>,
): CollectionRef | QueryRef {
  if (source.type === `collectionRef`) {
    return new CollectionRef(source.collection, source.alias)
  }

  return new QueryRef(cloneQuery(source.query, clones), source.alias)
}

function cloneSelectForPlacement(
  select: Select,
  clones: WeakMap<object, object>,
): Select {
  const existing = clones.get(select)
  if (existing) return existing as Select

  const cloned: Select = {}
  clones.set(select, cloned)
  for (const [field, value] of Object.entries(select)) {
    cloned[field] = cloneSelectValueForPlacement(value, clones)
  }
  return cloned
}

function cloneSelectValueForPlacement(
  value: unknown,
  clones: WeakMap<object, object>,
): SelectValueExpression {
  if (value instanceof IncludesSubquery) {
    const existing = clones.get(value)
    if (existing) return existing as IncludesSubquery

    const cloned = new IncludesSubquery(
      cloneQuery(value.query, clones),
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
        value: cloneSelectValueForPlacement(branch.value, clones),
      })),
      value.defaultValue !== undefined
        ? cloneSelectValueForPlacement(value.defaultValue, clones)
        : undefined,
    )
    clones.set(value, cloned)
    return cloned
  }

  if (value === null || typeof value !== `object` || Array.isArray(value)) {
    return value as SelectValueExpression
  }

  if ((value as { __refProxy?: boolean }).__refProxy === true) {
    return value as SelectValueExpression
  }

  return isExpressionLike(value)
    ? (value as SelectValueExpression)
    : cloneSelectForPlacement(value as Select, clones)
}

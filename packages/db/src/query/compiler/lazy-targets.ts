import {
  PropRef,
  collectCollectionSources,
  followRef,
  getFromSources,
} from '../ir.js'
import type {
  BasicExpression,
  CollectionRef,
  From,
  QueryIR,
  QueryRef,
} from '../ir.js'
import type { Collection } from '../../collection/index.js'

export type LazyLoadTarget = {
  sourceId: string
  alias: string
  collection: Collection
  path: Array<string>
}

export function getLazyLoadTargets(
  rawQuery: QueryIR,
  lazyFrom: From,
  lazyAlias: string,
  lazySourceExpr: BasicExpression,
  lazySource: Collection | undefined,
  aliasRemapping: Record<string, string>,
): Array<LazyLoadTarget> {
  if (lazyFrom.type === `unionFrom`) {
    return getTargetsFromExpression(rawQuery, lazySourceExpr)
  }

  if (lazyFrom.type === `queryRef` && containsUnionFrom(lazyFrom.query.from)) {
    const targets = getTargetsFromQueryRef(
      lazyFrom.query,
      lazyAlias,
      lazySourceExpr,
    )
    return dedupeLazyLoadTargets(targets)
  }

  if (!lazySource) {
    return []
  }

  const lazySourceRef = toPropRef(lazySourceExpr)
  if (!lazySourceRef) {
    return []
  }

  const followRefResult = followRef(rawQuery, lazySourceRef, lazySource)
  if (!followRefResult) {
    return []
  }

  const alias = followRefResult.alias || aliasRemapping[lazyAlias] || lazyAlias
  const source = resolveLazySource(rawQuery, lazyFrom, {
    alias,
    collection: followRefResult.collection,
    sourceId: followRefResult.sourceId,
  })
  if (!source) {
    return []
  }

  // The subscription we drive lazy loading through must be the one for the
  // collection the join key actually resolves to. When the key traces through a
  // subquery's select into a *joined* source, that collection differs from the
  // subquery's from clause (which is what `aliasRemapping[lazyAlias]` yields),
  // so prefer the alias reported by `followRef`. Fall back to the from-clause
  // remapping when the key resolves directly to the from source.
  return [
    {
      sourceId: source.sourceId,
      alias,
      collection: followRefResult.collection,
      path: followRefResult.path,
    },
  ]
}

export function containsUnionFrom(from: From): boolean {
  if (from.type === `unionFrom`) {
    return true
  }
  if (from.type === `queryRef`) {
    return containsUnionFrom(from.query.from)
  }
  if (from.type === `unionAll`) {
    return from.queries.some((query) => containsUnionFrom(query.from))
  }
  return false
}

function getTargetsFromQueryRef(
  query: QueryIR,
  outerAlias: string,
  expr: unknown,
): Array<LazyLoadTarget> {
  if (!expr || typeof expr !== `object` || !(`type` in expr)) {
    return []
  }

  const expression = expr as BasicExpression
  if (expression.type === `func` && expression.name === `coalesce`) {
    return dedupeLazyLoadTargets(
      expression.args.flatMap((arg) =>
        getTargetsFromQueryRef(query, outerAlias, arg),
      ),
    )
  }

  const ref = toPropRef(expression)
  if (!ref || ref.path[0] !== outerAlias) {
    return []
  }

  return getTargetsFromPropRef(query, new PropRef(ref.path.slice(1)))
}

function getTargetsFromExpression(
  query: QueryIR,
  expr: unknown,
): Array<LazyLoadTarget> {
  if (!expr || typeof expr !== `object` || !(`type` in expr)) {
    return []
  }

  const expression = expr as BasicExpression
  if (expression.type === `ref`) {
    return getTargetsFromPropRef(query, expression)
  }

  if (expression.type === `func` && expression.name === `coalesce`) {
    return dedupeLazyLoadTargets(
      expression.args.flatMap((arg) => getTargetsFromExpression(query, arg)),
    )
  }

  return []
}

function getTargetsFromPropRef(
  query: QueryIR,
  ref: PropRef,
): Array<LazyLoadTarget> {
  if (ref.path.length === 0) {
    return []
  }

  if (ref.path.length === 1) {
    const field = ref.path[0]!
    const selectedField = query.select?.[field]
    if (selectedField) {
      return getTargetsFromExpression(query, selectedField)
    }
    return []
  }

  const [alias, ...path] = ref.path
  const source = getSourceFromAlias(query, alias!, ref.bindingId)
  if (!source) {
    return []
  }

  if (source.type === `collectionRef`) {
    return [
      {
        sourceId: source.sourceId,
        alias: source.alias,
        collection: source.collection,
        path,
      },
    ]
  }

  if (
    source.query.limit !== undefined ||
    source.query.offset !== undefined ||
    source.query.singleResult
  ) {
    return []
  }

  return getTargetsFromQueryRef(source.query, source.alias, ref)
}

function getSourceFromAlias(
  query: QueryIR,
  alias: string,
  bindingId?: string,
): CollectionRef | QueryRef | undefined {
  if (query.join) {
    for (const join of query.join) {
      if (
        join.from.alias === alias &&
        (bindingId === undefined || join.from.bindingId === bindingId)
      ) {
        return join.from
      }
    }
  }

  return getFromSources(query.from).find(
    (source) =>
      source.alias === alias &&
      (bindingId === undefined || source.bindingId === bindingId),
  )
}

function resolveLazySource(
  query: QueryIR,
  lazyFrom: From,
  target: { alias: string; collection: Collection; sourceId?: string },
): CollectionRef | undefined {
  // Subscription and demand callbacks belong to one lexical source. An alias
  // may also name a source in a nested scope, so text cannot resolve it here.
  if (target.sourceId !== undefined) {
    return collectCollectionSources(query).find(
      (source) =>
        source.sourceId === target.sourceId &&
        source.collection === target.collection,
    )
  }

  // A direct source has no recursive alias ambiguity. A recursive source with
  // no resolved ID cannot safely receive a keyed demand.
  if (
    lazyFrom.type === `collectionRef` &&
    lazyFrom.collection === target.collection &&
    lazyFrom.alias === target.alias
  ) {
    return lazyFrom
  }

  return undefined
}

function dedupeLazyLoadTargets(
  targets: Array<LazyLoadTarget>,
): Array<LazyLoadTarget> {
  const seen = new Set<string>()
  const deduped: Array<LazyLoadTarget> = []
  for (const target of targets) {
    const key = `${target.sourceId}:${JSON.stringify(target.path)}`
    if (!seen.has(key)) {
      seen.add(key)
      deduped.push(target)
    }
  }
  return deduped
}

function toPropRef(expr: unknown): PropRef | undefined {
  if (expr instanceof PropRef) {
    return expr
  }
  if (
    expr &&
    typeof expr === `object` &&
    `type` in expr &&
    (expr as { type?: string }).type === `ref` &&
    Array.isArray((expr as { path?: unknown }).path)
  ) {
    const ref = expr as unknown as {
      path: Array<string>
      sourceAlias?: string
    }
    return new PropRef(ref.path, ref.sourceAlias)
  }
  return undefined
}

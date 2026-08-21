import { PropRef, followRef } from '../ir.js'
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
  const source = getSourceFromAlias(query, alias!)
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

  if (source.query.limit || source.query.offset) {
    return []
  }

  return getTargetsFromQueryRef(source.query, source.alias, ref)
}

function getSourceFromAlias(
  query: QueryIR,
  alias: string,
): CollectionRef | QueryRef | undefined {
  if (query.join) {
    for (const join of query.join) {
      if (join.from.alias === alias) {
        return join.from
      }
    }
  }

  const from = query.from
  const sources =
    from.type === `unionFrom`
      ? from.sources
      : from.type === `unionAll`
        ? []
        : [from]
  return sources.find((source) => source.alias === alias)
}

function resolveLazySource(
  query: QueryIR,
  lazyFrom: From,
  target: { alias: string; collection: Collection },
): CollectionRef | undefined {
  // Prefer the lexical source from the user's query. The optimizer may create
  // an equivalent CollectionRef with a new source ID, but subscriptions and
  // demand callbacks are owned by the original lexical source.
  const source = findCollectionSource(query, target.alias, target.collection)
  if (source) return source

  if (
    lazyFrom.type === `collectionRef` &&
    lazyFrom.collection === target.collection &&
    lazyFrom.alias === target.alias
  ) {
    return lazyFrom
  }

  return undefined
}

function findCollectionSource(
  query: QueryIR,
  alias: string,
  collection: Collection,
): CollectionRef | undefined {
  const sources = [
    ...(query.from.type === `unionFrom`
      ? query.from.sources
      : query.from.type === `unionAll`
        ? []
        : [query.from]),
    ...(query.join?.map((join) => join.from) ?? []),
  ]

  for (const source of sources) {
    if (
      source.type === `collectionRef` &&
      source.alias === alias &&
      source.collection === collection
    ) {
      return source
    }
    if (source.type === `queryRef`) {
      const nested = findCollectionSource(source.query, alias, collection)
      if (nested) return nested
    }
  }

  if (query.from.type === `unionAll`) {
    for (const branch of query.from.queries) {
      const nested = findCollectionSource(branch, alias, collection)
      if (nested) return nested
    }
  }

  return undefined
}

function dedupeLazyLoadTargets(
  targets: Array<LazyLoadTarget>,
): Array<LazyLoadTarget> {
  const seen = new Set<string>()
  const deduped: Array<LazyLoadTarget> = []
  for (const target of targets) {
    const key = `${target.sourceId}:${target.path.join(`.`)}`
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
    return new PropRef((expr as unknown as { path: Array<string> }).path)
  }
  return undefined
}

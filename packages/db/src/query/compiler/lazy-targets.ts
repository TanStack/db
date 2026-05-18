import { PropRef, followRef } from '../ir.js'
import type { BasicExpression, CollectionRef, From, QueryIR, QueryRef } from '../ir.js'
import type { Collection } from '../../collection/index.js'

export type LazyLoadTarget = {
  alias: string
  collection: Collection
  path: Array<string>
}

export function getLazyLoadTargets(
  rawQuery: QueryIR,
  lazyFrom: From,
  lazyAlias: string,
  lazySourceExpr: PropRef,
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

  const followRefResult = followRef(rawQuery, lazySourceExpr, lazySource)
  if (!followRefResult) {
    return []
  }

  return [
    {
      alias: aliasRemapping[lazyAlias] || lazyAlias,
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
  return false
}

function getTargetsFromQueryRef(
  query: QueryIR,
  outerAlias: string,
  expr: PropRef,
): Array<LazyLoadTarget> {
  if (expr.path[0] !== outerAlias) {
    return []
  }

  return getTargetsFromPropRef(query, new PropRef(expr.path.slice(1)))
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
  const source = getSourceFromAlias(query.from, alias!)
  if (!source) {
    return []
  }

  if (source.type === `collectionRef`) {
    return [{ alias: source.alias, collection: source.collection, path }]
  }

  if (source.query.limit || source.query.offset) {
    return []
  }

  return getTargetsFromQueryRef(source.query, source.alias, ref)
}

function getSourceFromAlias(
  from: From,
  alias: string,
): CollectionRef | QueryRef | undefined {
  const sources = from.type === `unionFrom` ? from.sources : [from]
  return sources.find((source) => source.alias === alias)
}

function dedupeLazyLoadTargets(
  targets: Array<LazyLoadTarget>,
): Array<LazyLoadTarget> {
  const seen = new Set<string>()
  const deduped: Array<LazyLoadTarget> = []
  for (const target of targets) {
    const key = `${target.alias}:${target.path.join(`.`)}`
    if (!seen.has(key)) {
      seen.add(key)
      deduped.push(target)
    }
  }
  return deduped
}

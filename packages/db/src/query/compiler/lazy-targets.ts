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
  const sources =
    from.type === `unionFrom`
      ? from.sources
      : from.type === `unionAll`
        ? []
        : [from]
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

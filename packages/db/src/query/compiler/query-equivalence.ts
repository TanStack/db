import { deepEquals } from '../../utils.js'
import type { From, QueryIR } from '../ir.js'

/**
 * Compares query meaning while ignoring whether optional IR fields are omitted
 * or explicitly set to undefined by an optimizer copy.
 */
export function queriesMatchForCaching(a: QueryIR, b: QueryIR): boolean {
  return deepEquals(normalizeQuery(a), normalizeQuery(b))
}

function normalizeQuery(query: QueryIR): Record<string, unknown> {
  return {
    from: normalizeFrom(query.from),
    select: query.select,
    join: query.join?.map((join) => ({
      from: normalizeFrom(join.from),
      type: join.type,
      left: join.left,
      right: join.right,
    })),
    where: query.where,
    groupBy: query.groupBy,
    having: query.having,
    orderBy: query.orderBy,
    limit: query.limit,
    offset: query.offset,
    distinct: query.distinct,
    singleResult: query.singleResult,
    fnSelect: query.fnSelect,
    fnWhere: query.fnWhere,
    fnHaving: query.fnHaving,
  }
}

function normalizeFrom(from: From): Record<string, unknown> {
  switch (from.type) {
    case `collectionRef`:
      return {
        type: from.type,
        collection: from.collection,
        alias: from.alias,
      }
    case `queryRef`:
      return {
        type: from.type,
        query: normalizeQuery(from.query),
        alias: from.alias,
      }
    case `unionFrom`:
      return {
        type: from.type,
        sources: from.sources.map(normalizeFrom),
      }
    case `unionAll`:
      return {
        type: from.type,
        queries: from.queries.map(normalizeQuery),
      }
  }
}

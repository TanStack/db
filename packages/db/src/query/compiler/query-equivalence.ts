import { deepEquals } from '../../utils.js'
import {
  UnhashableQueryIRError,
  getQueryIdentity,
} from '../ir-stable-identity.js'
import type { From, QueryIR } from '../ir.js'

/**
 * Compares query meaning while ignoring whether optional IR fields are omitted
 * or explicitly set to undefined by an optimizer copy.
 */
export function queriesMatchForCaching(a: QueryIR, b: QueryIR): boolean {
  if (!deepEquals(normalizeQuery(a), normalizeQuery(b))) return false
  try {
    return getQueryIdentity(a) === getQueryIdentity(b)
  } catch (error) {
    // Function-form queries may compile but have no stable identity. Recompile
    // conservatively rather than mistaking matching paths for matching scopes.
    if (error instanceof UnhashableQueryIRError) return false
    throw error
  }
}

function normalizeQuery(query: QueryIR): Record<string, unknown> {
  return {
    from: normalizeFrom(query.from),
    select: query.select,
    join: query.join?.map((join) => ({
      from: normalizeFrom(join.from),
      type: join.type,
      on: join.on,
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

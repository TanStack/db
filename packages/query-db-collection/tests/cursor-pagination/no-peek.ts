import type { Row } from './model.js'

/** Proposed test-only boundary: this packet describes a complete public prefix,
 * not a transport response or merely applied source rows. */
export type PrefixPublication = {
  rows: Array<Row>
  requested: number
  stamp: object
  transparent: boolean
  fact?: { stamp: object; end: number; hasMore: boolean }
}

export type WindowSnapshot = { rows: Array<Row>; hasNextPage: boolean }

function continuation(
  packet: PrefixPublication,
  count: number,
): boolean | undefined {
  // A deeper peer's terminal fact cannot erase this consumer's actual row N+1.
  if (packet.rows.length > count) return true
  if (packet.requested > count) return false
  const fact = packet.fact
  if (
    packet.transparent &&
    fact?.stamp === packet.stamp &&
    fact.end === packet.rows.length &&
    (fact.end === count || !fact.hasMore)
  )
    return fact.hasMore
  return undefined
}

/** Test-only demand model, not a replacement for the production window controller.
 * Acquire must settle at public-window completion. No source-lifecycle machinery
 * is duplicated here; the missing production bridge remains explicit. */
export function createNoPeekDemandModel(
  acquire: (limit: number) => Promise<PrefixPublication>,
  eligible = true,
) {
  const demands = new Map<string, { count: number; peek: boolean }>()
  const snapshots = new Map<string, WindowSnapshot>()
  const listeners = new Set<() => void>()
  let publicationGeneration = 0
  let tail = Promise.resolve()
  const desired = () =>
    Math.max(
      ...[...demands.values()].map(({ count, peek }) => count + Number(peek)),
    )
  return {
    retainDemand(id: string, limit: number) {
      if (
        !Number.isSafeInteger(limit) ||
        limit <= 0 ||
        limit >= Number.MAX_SAFE_INTEGER
      ) {
        throw new RangeError(`Expected a positive safe window`)
      }
      demands.set(id, {
        count: limit,
        peek: demands.get(id)?.peek ?? !eligible,
      })
    },
    retireDemand(id: string) {
      demands.delete(id)
      snapshots.delete(id)
    },
    reset() {
      publicationGeneration++
      for (const demand of demands.values()) demand.peek = !eligible
      snapshots.clear()
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    get(id: string) {
      return snapshots.get(id)
    },
    refresh() {
      const requestedPublicationGeneration = publicationGeneration
      const checkCurrent = () => {
        if (requestedPublicationGeneration !== publicationGeneration)
          throw new DOMException(`Publication was reset`, `AbortError`)
      }
      const result = tail.then(async () => {
        checkCurrent()
        while (demands.size > 0) {
          const limit = desired()
          const publication = await acquire(limit)
          checkCurrent()
          if (
            publication.requested !== limit ||
            publication.rows.length > limit
          ) {
            throw new Error(`Publication does not match acquired prefix`)
          }
          const next = new Map<string, WindowSnapshot>()
          for (const [id, demand] of demands) {
            const more = continuation(publication, demand.count)
            if (more === undefined) demand.peek = true
            else
              next.set(id, {
                rows: publication.rows.slice(0, demand.count),
                hasNextPage: more,
              })
          }
          // Keep fallback on each consumer's demand, including after deeper peers
          // release. A snapshot cache must also be invalidated by fact-only changes.
          if (next.size !== demands.size) continue
          for (const [id, snapshot] of next) snapshots.set(id, snapshot)
          for (const listener of listeners) listener()
          return
        }
      })
      tail = result.then(
        () => {},
        () => {},
      )
      return result
    },
  }
}

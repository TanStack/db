import { isDeepStrictEqual } from 'node:util'

// These are observed Query Core facts, not a model of DB ownership. Physical
// Query identity distinguishes a removed cache entry from a replacement with
// the same key. Counts distinguish a returned provider answer from installation.
export type QueryFact = {
  identity: object
  atom: string
  key: ReadonlyArray<unknown>
  keys: Array<number>
  owner: number | undefined
  status: string
  fetchStatus: string
  dataUpdateCount: number
  rows: Array<number> | undefined
}
export type AnswerFact = Pick<
  QueryFact,
  `identity` | `atom` | `key` | `keys` | `owner`
> & {
  startCount: number
  installedCount?: number
  version: number
  backendVersion: number
  rows: Array<number>
}
export type PendingFact = Pick<
  QueryFact,
  `identity` | `atom` | `key` | `keys` | `owner`
> & {
  startCount: number
  pending: boolean
  aborted: boolean
}

const sameScope = (
  left: Pick<QueryFact, `identity` | `atom` | `key` | `keys` | `owner`>,
  right: Pick<QueryFact, `identity` | `atom` | `key` | `keys` | `owner`>,
) =>
  left.identity === right.identity &&
  left.atom === right.atom &&
  left.owner === right.owner &&
  isDeepStrictEqual(left.key, right.key) &&
  isDeepStrictEqual(left.keys, right.keys)

/**
 * Query Core installs success state before synchronous observer notification.
 * Its later QueryCache success event can remain blocked inside those observers.
 * Read the installed state itself; a provider return alone cannot satisfy this
 * detector. Both sides must retain their actual key, scope and physical Query.
 */
export function findQueuedAnswerPremise(
  pivot: number,
  pending: Array<PendingFact>,
  queries: Array<QueryFact>,
  completed: Array<AnswerFact>,
  installed: Array<AnswerFact>,
) {
  for (const request of pending) {
    if (
      !request.pending ||
      request.aborted ||
      request.owner === undefined ||
      !isDeepStrictEqual(request.keys, [pivot])
    )
      continue
    const current = queries.find((query) => sameScope(query, request))
    if (
      !current ||
      current.status !== `success` ||
      current.fetchStatus !== `fetching` ||
      current.dataUpdateCount !== request.startCount
    )
      continue
    const cached = installed.find(
      (answer) =>
        sameScope(answer, request) &&
        answer.backendVersion === 0 &&
        answer.installedCount === current.dataUpdateCount &&
        answer.installedCount > answer.startCount &&
        answer.rows.includes(pivot) &&
        isDeepStrictEqual(answer.rows, current.rows),
    )
    if (!cached) continue
    for (const answer of completed) {
      if (
        answer.atom === request.atom ||
        answer.backendVersion !== 1 ||
        answer.owner === undefined ||
        answer.owner === request.owner ||
        !isDeepStrictEqual(answer.keys, [pivot]) ||
        answer.rows.length !== 0
      )
        continue
      const sibling = queries.find((query) => sameScope(query, answer))
      if (
        !sibling ||
        sibling.status !== `success` ||
        sibling.dataUpdateCount <= answer.startCount ||
        !isDeepStrictEqual(sibling.rows, answer.rows)
      )
        continue
      return { request, current, cached, sibling, answer }
    }
  }
  return undefined
}

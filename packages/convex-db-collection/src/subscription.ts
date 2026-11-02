import type { LoadSubsetFn, UnloadSubsetFn } from '@tanstack/db'
import type { ConvexClient } from 'convex/browser'
import type { ConvexReactClient } from 'convex/react'
import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
} from 'convex/server'

export type ConvexCollectionClient =
  Pick<ConvexClient, `onUpdate`> | Pick<ConvexReactClient, `watchQuery`>

export interface ConvexSubscription<T> {
  loadSubset?: LoadSubsetFn
  unloadSubset?: UnloadSubsetFn
  getCurrentValue: () => T | undefined
  unsubscribe: () => void
  /** Wait for a complete authoritative snapshot, without waiting for DB visibility. */
  waitForCurrent?: () => Promise<void>
}

export function subscribeQuery<TQuery extends FunctionReference<`query`>>(
  client: ConvexCollectionClient,
  query: TQuery,
  args: FunctionArgs<TQuery>,
  receive: (result: FunctionReturnType<TQuery>) => void,
  fail: (error: unknown) => void,
): ConvexSubscription<FunctionReturnType<TQuery>> {
  let active = true
  // The client serves a query's cached result to a new subscription at
  // once. A cached error belongs to an earlier subscription, so this one
  // waits for the server instead (maintainer decision): until the server's
  // first callback it has no current value, and the client's replay of the
  // cached error is skipped once.
  let cachedError = false
  let replay = false
  const stop = (unsubscribe: () => void) => () => {
    active = false
    unsubscribe()
  }
  const hasCachedError = (read: () => unknown) => {
    try {
      read()
      return false
    } catch {
      return true
    }
  }
  if (`disabled` in client && client.disabled === true) {
    throw new Error(`A disabled Convex client cannot sync a collection.`)
  }
  if (`onUpdate` in client) {
    if (`closed` in client && client.closed === true) {
      throw new Error(`A closed Convex client cannot sync a collection.`)
    }
    const subscription = client.onUpdate(
      query,
      args,
      (value) => {
        cachedError = replay = false
        if (active) receive(value)
      },
      (error) => {
        if (replay) {
          replay = false
          return
        }
        cachedError = false
        if (active) fail(error)
      },
    )
    cachedError = replay = hasCachedError(() => subscription.getCurrentValue())
    return {
      getCurrentValue: () =>
        cachedError ? undefined : subscription.getCurrentValue(),
      unsubscribe: stop(subscription),
    }
  }
  const watch = client.watchQuery(query, args)
  cachedError = hasCachedError(() => watch.localQueryResult())
  const unsubscribe = watch.onUpdate(() => {
    cachedError = false
    if (!active) return
    try {
      const result = watch.localQueryResult()
      if (result !== undefined) receive(result)
    } catch (error) {
      fail(error)
    }
  })
  return {
    getCurrentValue: () => (cachedError ? undefined : watch.localQueryResult()),
    unsubscribe: stop(unsubscribe),
  }
}

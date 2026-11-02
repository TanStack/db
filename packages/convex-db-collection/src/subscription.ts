import { getFunctionName } from 'convex/server'
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

/** The clients' untyped accessor for a query result's log lines. */
type Logged<TArgs extends Array<unknown>> = {
  localQueryLogs?: (...args: TArgs) => unknown
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
  // once, and replays it on a later turn. A cached error belongs to an
  // earlier subscription, so this one waits for the server instead
  // (maintainer decision): while the client still holds that result, the
  // subscription has no current value and ignores its replay. The client
  // stores a new result object for each server answer, and the result's log
  // lines belong to that object, so they name the cached result, also when
  // the server answers before the replay. The log accessors are untyped, and
  // the `onUpdate` handle's own one looks up the wrong query, so the
  // JavaScript client's base client is read. Without them nothing is skipped.
  let cached: unknown
  const isCached = (logs: unknown) => cached !== undefined && logs === cached
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
        if (active) receive(value)
      },
      (error) => {
        if (active && !isCached(logs())) fail(error)
      },
    )
    const base = (client as { client?: Logged<[string, unknown]> }).client
    const name = getFunctionName(query)
    const logs = () => base?.localQueryLogs?.(name, args)
    if (hasCachedError(() => subscription.getCurrentValue())) cached = logs()
    return {
      getCurrentValue: () =>
        isCached(logs()) ? undefined : subscription.getCurrentValue(),
      unsubscribe: stop(subscription),
    }
  }
  const watch = client.watchQuery(query, args)
  const logs = () => (watch as Logged<[]>).localQueryLogs?.()
  if (hasCachedError(() => watch.localQueryResult())) cached = logs()
  const unsubscribe = watch.onUpdate(() => {
    if (!active || isCached(logs())) return
    try {
      const result = watch.localQueryResult()
      if (result !== undefined) receive(result)
    } catch (error) {
      fail(error)
    }
  })
  return {
    getCurrentValue: () =>
      isCached(logs()) ? undefined : watch.localQueryResult(),
    unsubscribe: stop(unsubscribe),
  }
}

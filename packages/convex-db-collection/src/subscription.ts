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
  const stop = (unsubscribe: () => void) => () => {
    active = false
    unsubscribe()
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
        if (active) fail(error)
      },
    )
    return {
      getCurrentValue: () => subscription.getCurrentValue(),
      unsubscribe: stop(subscription),
    }
  }
  const watch = client.watchQuery(query, args)
  const unsubscribe = watch.onUpdate(() => {
    if (!active) return
    try {
      const result = watch.localQueryResult()
      if (result !== undefined) receive(result)
    } catch (error) {
      fail(error)
    }
  })
  return {
    getCurrentValue: () => watch.localQueryResult(),
    unsubscribe: stop(unsubscribe),
  }
}

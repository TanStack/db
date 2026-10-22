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
  if (`disabled` in client && client.disabled === true) {
    throw new Error(`A disabled Convex client cannot sync a collection.`)
  }
  if (`onUpdate` in client) {
    if (`closed` in client && client.closed === true) {
      throw new Error(`A closed Convex client cannot sync a collection.`)
    }
    const subscription = client.onUpdate(query, args, receive, fail)
    return {
      getCurrentValue: () => subscription.getCurrentValue(),
      unsubscribe: subscription,
    }
  }
  const watch = client.watchQuery(query, args)
  const unsubscribe = watch.onUpdate(() => {
    try {
      const result = watch.localQueryResult()
      if (result !== undefined) receive(result)
    } catch (error) {
      fail(error)
    }
  })
  return { getCurrentValue: () => watch.localQueryResult(), unsubscribe }
}

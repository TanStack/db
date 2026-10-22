import { makeFunctionReference } from 'convex/server'
import type { ConvexCollectionClient } from '../src/index'

export type Row = { _id: string; text: string; optional?: string }
export const query = makeFunctionReference<
  `query`,
  { owner: string },
  Array<Row>
>(`tasks:list`)
export const mutation = makeFunctionReference<
  `mutation`,
  { text: string },
  null
>(`tasks:update`)

export function controlledClient() {
  let value: Array<Row> | undefined
  let readError: Error | undefined
  let receive: ((rows: Array<Row>) => void) | undefined
  let fail: ((error: Error) => void) | undefined
  let retired: ((rows: Array<Row>) => void) | undefined
  let subscriptions = 0
  let unsubscriptions = 0
  // The assertion adapts this one-query transport fixture to the SDK's generic
  // method. Real SDK compatibility is checked separately, without this cast.
  const client = {
    onUpdate: (
      _query: unknown,
      _args: unknown,
      callback: typeof receive,
      onError: typeof fail,
    ) => {
      subscriptions++
      receive = callback
      fail = onError
      return Object.assign(
        () => {
          unsubscriptions++
          retired = receive
          receive = undefined
        },
        {
          getCurrentValue: () => {
            if (readError) throw readError
            return value
          },
        },
      )
    },
  } as ConvexCollectionClient
  return {
    client,
    emit(rows: Array<Row>) {
      value = rows
      receive?.(rows)
    },
    cache(rows: Array<Row>) {
      value = rows
    },
    cacheError(error: Error) {
      readError = error
    },
    error(error: Error) {
      fail?.(error)
    },
    late(rows: Array<Row>) {
      retired?.(rows)
    },
    counts: () => ({ subscriptions, unsubscriptions }),
  }
}

import type {
  DbClient,
  DeferredLiveQueryCollections,
  LiveQueryObserver,
  UnhashableQueryIRError,
} from '@tanstack/db'

const liveQueryResultInfo = new WeakMap<object, LiveQueryResultInfo>()

export type LiveQueryResultInfo = {
  client: DbClient | undefined
  queryHash: string | undefined
  identityError: UnhashableQueryIRError | undefined
  observer: LiveQueryObserver<object, string | number>
  /** Sync starts this render deferred, released if the render throws. */
  deferredCollections: DeferredLiveQueryCollections
}

export function setLiveQueryResultInfo(
  result: object,
  info: LiveQueryResultInfo,
): void {
  liveQueryResultInfo.set(result, info)
}

export function getLiveQueryResultInfo(result: object): LiveQueryResultInfo {
  const info = liveQueryResultInfo.get(result)
  if (!info) {
    throw new Error(`Missing live query metadata.`)
  }
  return info
}

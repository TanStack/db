import type { DbClient, LiveQueryObserver } from '@tanstack/db'

const liveQueryResultInfo = Symbol(`liveQueryResultInfo`)

export type LiveQueryResultInfo = {
  client: DbClient | undefined
  queryHash: string | undefined
  observer: LiveQueryObserver<object, string | number>
}

type ResultWithInfo = {
  [liveQueryResultInfo]?: LiveQueryResultInfo
}

export function setLiveQueryResultInfo(
  result: object,
  info: LiveQueryResultInfo,
): void {
  Object.defineProperty(result, liveQueryResultInfo, {
    configurable: true,
    value: info,
  })
}

export function getLiveQueryResultInfo(result: object): LiveQueryResultInfo {
  const info = (result as ResultWithInfo)[liveQueryResultInfo]
  if (!info) {
    throw new Error(`Missing internal live query result information.`)
  }
  return info
}

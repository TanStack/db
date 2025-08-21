import type { D2, RootStreamBuilder } from "@tanstack/db-ivm"
import type { ResultStream } from "../../types.js"

export type Changes<T> = {
  deletes: number
  inserts: number
  value: T
  orderByIndex: string | undefined
}

export type SyncState = {
  messagesCount: number
  subscribedToAllCollections: boolean
  unsubscribeCallbacks: Set<() => void>

  graph?: D2
  inputs?: Record<string, RootStreamBuilder<unknown>>
  pipeline?: ResultStream
}

export type FullSyncState = Required<SyncState>

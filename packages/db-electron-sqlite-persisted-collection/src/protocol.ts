import type { LoadSubsetOptions } from '@tanstack/db'
import type {
  PersistedCollectionMode,
  PersistedIndexSpec,
  PersistedTx,
  SQLitePullSinceResult,
} from '@tanstack/db-sqlite-persisted-collection-core'

export const ELECTRON_PERSISTENCE_PROTOCOL_VERSION = 1 as const
export const DEFAULT_ELECTRON_PERSISTENCE_CHANNEL = `tanstack-db:sqlite-persistence`

export type ElectronPersistedRow = Record<string, unknown>
export type ElectronPersistedKey = string | number

export type ElectronPersistenceResolution = {
  mode: PersistedCollectionMode
  schemaVersion?: number
}

export type ElectronPersistenceMethod =
  | `loadSubset`
  | `applyCommittedTx`
  | `ensureIndex`
  | `markIndexRemoved`
  | `pullSince`

export type ElectronPersistencePayloadMap = {
  loadSubset: {
    options: LoadSubsetOptions
    ctx?: { requiredIndexSignatures?: ReadonlyArray<string> }
  }
  applyCommittedTx: {
    tx: PersistedTx<ElectronPersistedRow, ElectronPersistedKey>
  }
  ensureIndex: {
    signature: string
    spec: PersistedIndexSpec
  }
  markIndexRemoved: {
    signature: string
  }
  pullSince: {
    fromRowVersion: number
  }
}

export type ElectronPersistenceResultMap = {
  loadSubset: Array<{ key: ElectronPersistedKey; value: ElectronPersistedRow }>
  applyCommittedTx: null
  ensureIndex: null
  markIndexRemoved: null
  pullSince: SQLitePullSinceResult<ElectronPersistedKey>
}

export type ElectronSerializedError = {
  name: string
  message: string
  stack?: string
  code?: string
}

export type ElectronPersistenceRequestByMethod = {
  [Method in ElectronPersistenceMethod]: {
    v: number
    requestId: string
    collectionId: string
    resolution?: ElectronPersistenceResolution
    method: Method
    payload: ElectronPersistencePayloadMap[Method]
  }
}

export type ElectronPersistenceRequest<
  TMethod extends ElectronPersistenceMethod = ElectronPersistenceMethod,
> = ElectronPersistenceRequestByMethod[TMethod]

export type ElectronPersistenceRequestEnvelope =
  ElectronPersistenceRequestByMethod[ElectronPersistenceMethod]

type ElectronPersistenceSuccessResponseByMethod = {
  [Method in ElectronPersistenceMethod]: {
    v: number
    requestId: string
    method: Method
    ok: true
    result: ElectronPersistenceResultMap[Method]
  }
}

type ElectronPersistenceErrorResponseByMethod = {
  [Method in ElectronPersistenceMethod]: {
    v: number
    requestId: string
    method: Method
    ok: false
    error: ElectronSerializedError
  }
}

export type ElectronPersistenceResponse<
  TMethod extends ElectronPersistenceMethod = ElectronPersistenceMethod,
> =
  | ElectronPersistenceSuccessResponseByMethod[TMethod]
  | ElectronPersistenceErrorResponseByMethod[TMethod]

export type ElectronPersistenceResponseEnvelope =
  ElectronPersistenceResponse<ElectronPersistenceMethod>

export type ElectronPersistenceRequestHandler = (
  request: ElectronPersistenceRequestEnvelope,
) => Promise<ElectronPersistenceResponseEnvelope>

export type ElectronPersistenceInvoke = (
  channel: string,
  request: ElectronPersistenceRequestEnvelope,
) => Promise<ElectronPersistenceResponseEnvelope>

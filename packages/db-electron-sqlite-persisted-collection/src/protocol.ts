import type { LoadSubsetOptions } from '@tanstack/db'
import type {
  PersistedIndexSpec,
  PersistedTx,
  SQLitePullSinceResult,
} from '@tanstack/db-sqlite-persisted-collection-core'

export const ELECTRON_PERSISTENCE_PROTOCOL_VERSION = 1 as const
export const DEFAULT_ELECTRON_PERSISTENCE_CHANNEL = `tanstack-db:sqlite-persistence`

export type ElectronPersistedRow = Record<string, unknown>
export type ElectronPersistedKey = string | number

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

export type ElectronPersistenceRequest<
  TMethod extends ElectronPersistenceMethod = ElectronPersistenceMethod,
> = {
  v: number
  requestId: string
  collectionId: string
  method: TMethod
  payload: ElectronPersistencePayloadMap[TMethod]
}

export type ElectronPersistenceRequestEnvelope<
  TMethod extends ElectronPersistenceMethod = ElectronPersistenceMethod,
> = {
  [Method in TMethod]: {
    v: number
    requestId: string
    collectionId: string
    method: Method
    payload: ElectronPersistencePayloadMap[Method]
  }
}[TMethod]

type ElectronPersistenceSuccessResponse<
  TMethod extends ElectronPersistenceMethod = ElectronPersistenceMethod,
> = {
  v: number
  requestId: string
  method: TMethod
  ok: true
  result: ElectronPersistenceResultMap[TMethod]
}

type ElectronPersistenceErrorResponse<
  TMethod extends ElectronPersistenceMethod = ElectronPersistenceMethod,
> = {
  v: number
  requestId: string
  method: TMethod
  ok: false
  error: ElectronSerializedError
}

export type ElectronPersistenceResponse<
  TMethod extends ElectronPersistenceMethod = ElectronPersistenceMethod,
> =
  | ElectronPersistenceSuccessResponse<TMethod>
  | ElectronPersistenceErrorResponse<TMethod>

export type ElectronPersistenceResponseEnvelope<
  TMethod extends ElectronPersistenceMethod = ElectronPersistenceMethod,
> = {
  [Method in TMethod]:
    | ElectronPersistenceSuccessResponse<Method>
    | ElectronPersistenceErrorResponse<Method>
}[TMethod]

export type ElectronPersistenceRequestHandler = (
  request: ElectronPersistenceRequestEnvelope,
) => Promise<ElectronPersistenceResponseEnvelope>

export type ElectronPersistenceInvoke = (
  channel: string,
  request: ElectronPersistenceRequestEnvelope,
) => Promise<ElectronPersistenceResponseEnvelope>

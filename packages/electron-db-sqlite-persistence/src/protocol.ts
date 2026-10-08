import type { LoadSubsetOptions } from '@tanstack/db'
import type {
  PersistedCacheGenerationClaim,
  PersistedCollectionMode,
  PersistedIndexSpec,
  PersistedKeySetEvidence,
  PersistedTx,
  SQLitePullSinceResult,
} from '@tanstack/db-sqlite-persistence-core'

export const ELECTRON_PERSISTENCE_PROTOCOL_VERSION = 3 as const
export const DEFAULT_ELECTRON_PERSISTENCE_CHANNEL = `tanstack-db:sqlite-persistence`

export type ElectronPersistedRow = Record<string, unknown>
export type ElectronPersistedKey = string | number

export type ElectronPersistenceResolution = {
  mode: PersistedCollectionMode
  schemaVersion?: number
  logicalCollectionId?: string
}

export type ElectronPersistenceMethod =
  | `loadSubset`
  | `loadResumeSnapshot`
  | `loadCollectionMetadata`
  | `scanRows`
  | `applyCommittedTx`
  | `ensureIndex`
  | `markIndexRemoved`
  | `pullSince`
  | `getStreamPosition`
  | `claimCacheGeneration`
  | `rotateCacheGeneration`
  | `renewCacheGenerationClaim`
  | `releaseCacheGenerationClaim`

export type ElectronPersistencePayloadMap = {
  loadSubset: {
    options: LoadSubsetOptions
    ctx?: {
      requiredIndexSignatures?: ReadonlyArray<string>
      cacheGenerationClaimId?: string
    }
  }
  loadResumeSnapshot: {
    ctx?: {
      requiredIndexSignatures?: ReadonlyArray<string>
      includeRows?: boolean
      cacheGenerationClaimId?: string
    }
  }
  loadCollectionMetadata: { ctx?: { cacheGenerationClaimId?: string } }
  scanRows: {
    options?: {
      metadataOnly?: boolean
    }
    ctx?: { cacheGenerationClaimId?: string }
  }
  applyCommittedTx: {
    tx: PersistedTx<ElectronPersistedRow, ElectronPersistedKey>
  }
  ensureIndex: {
    signature: string
    spec: PersistedIndexSpec
    ctx?: { cacheGenerationClaimId?: string }
  }
  markIndexRemoved: {
    signature: string
    ctx?: { cacheGenerationClaimId?: string }
  }
  pullSince: {
    fromRowVersion: number
    ctx?: { cacheGenerationClaimId?: string }
  }
  getStreamPosition: { ctx?: { cacheGenerationClaimId?: string } }
  claimCacheGeneration: {}
  rotateCacheGeneration: {
    claimId: string
    resetMetadata?: { key: string; value: unknown }
    expectedStorageCollectionId?: string
  }
  renewCacheGenerationClaim: {
    storageCollectionId: string
    claimId: string
  }
  releaseCacheGenerationClaim: { claimId: string }
}

export type ElectronPersistenceResultMap = {
  loadSubset: Array<{ key: ElectronPersistedKey; value: ElectronPersistedRow }>
  loadResumeSnapshot: {
    rows: Array<{
      key: ElectronPersistedKey
      value: ElectronPersistedRow
      metadata?: unknown
    }>
    keySet?: PersistedKeySetEvidence
    collectionMetadata: Array<{ key: string; value: unknown }>
    latestTerm: number
    latestSeq: number
    latestRowVersion: number
    resetEpoch: number
  }
  loadCollectionMetadata: Array<{ key: string; value: unknown }>
  scanRows: Array<{
    key: ElectronPersistedKey
    value: ElectronPersistedRow
    metadata?: unknown
  }>
  applyCommittedTx: null
  ensureIndex: null
  markIndexRemoved: null
  pullSince: SQLitePullSinceResult<ElectronPersistedKey>
  getStreamPosition: {
    latestTerm: number
    latestSeq: number
    latestRowVersion: number
  }
  claimCacheGeneration: PersistedCacheGenerationClaim
  rotateCacheGeneration: PersistedCacheGenerationClaim
  renewCacheGenerationClaim: number | undefined
  releaseCacheGenerationClaim: null
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

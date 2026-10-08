import { InvalidPersistedCollectionConfigError } from '@tanstack/db-sqlite-persistence-core'
import {
  DEFAULT_ELECTRON_PERSISTENCE_CHANNEL,
  ELECTRON_PERSISTENCE_PROTOCOL_VERSION,
} from './protocol'
import type {
  PersistedCollectionPersistence,
  PersistenceAdapter,
  SQLitePullSinceResult,
} from '@tanstack/db-sqlite-persistence-core'
import type {
  ElectronPersistedKey,
  ElectronPersistedRow,
  ElectronPersistenceRequestEnvelope,
  ElectronPersistenceResponseEnvelope,
  ElectronSerializedError,
} from './protocol'

type ElectronMainPersistenceAdapter = PersistenceAdapter & {
  loadCollectionMetadata?: (
    collectionId: string,
    ctx?: { cacheGenerationClaimId?: string },
  ) => Promise<Array<{ key: string; value: unknown }>>
  scanRows?: (
    collectionId: string,
    options?: { metadataOnly?: boolean },
    ctx?: { cacheGenerationClaimId?: string },
  ) => Promise<
    Array<{
      key: ElectronPersistedKey
      value: ElectronPersistedRow
      metadata?: unknown
    }>
  >
  pullSince?: (
    collectionId: string,
    fromRowVersion: number,
    ctx?: { cacheGenerationClaimId?: string },
  ) => Promise<SQLitePullSinceResult<ElectronPersistedKey>>
  getStreamPosition?: (
    collectionId: string,
    ctx?: { cacheGenerationClaimId?: string },
  ) => Promise<{
    latestTerm: number
    latestSeq: number
    latestRowVersion: number
  }>
}

function serializeError(error: unknown): ElectronSerializedError {
  const fallbackMessage = `Unknown electron persistence error`

  if (!(error instanceof Error)) {
    return {
      name: `Error`,
      message: fallbackMessage,
      code: undefined,
    }
  }

  const codedError = error as Error & { code?: unknown }
  return {
    name: error.name || `Error`,
    message: error.message || fallbackMessage,
    stack: error.stack,
    code: typeof codedError.code === `string` ? codedError.code : undefined,
  }
}

function createErrorResponse(
  request: ElectronPersistenceRequestEnvelope,
  error: unknown,
): ElectronPersistenceResponseEnvelope {
  return {
    v: ELECTRON_PERSISTENCE_PROTOCOL_VERSION,
    requestId: request.requestId,
    method: request.method,
    ok: false,
    error: serializeError(error),
  }
}

function assertValidRequest(request: ElectronPersistenceRequestEnvelope): void {
  if (request.v !== ELECTRON_PERSISTENCE_PROTOCOL_VERSION) {
    throw new InvalidPersistedCollectionConfigError(
      `Unsupported electron persistence protocol version "${request.v}"`,
    )
  }

  if (
    typeof request.requestId !== `string` ||
    request.requestId.trim().length === 0
  ) {
    throw new InvalidPersistedCollectionConfigError(
      `Electron persistence requestId cannot be empty`,
    )
  }

  if (
    typeof request.collectionId !== `string` ||
    request.collectionId.trim().length === 0
  ) {
    throw new InvalidPersistedCollectionConfigError(
      `Electron persistence collectionId cannot be empty`,
    )
  }
}

async function executeRequestAgainstAdapter(
  request: ElectronPersistenceRequestEnvelope,
  adapter: ElectronMainPersistenceAdapter,
): Promise<ElectronPersistenceResponseEnvelope> {
  switch (request.method) {
    case `loadSubset`: {
      const result = await adapter.loadSubset(
        request.collectionId,
        request.payload.options,
        request.payload.ctx,
      )
      return {
        v: ELECTRON_PERSISTENCE_PROTOCOL_VERSION,
        requestId: request.requestId,
        method: request.method,
        ok: true,
        result,
      }
    }

    case `loadResumeSnapshot`: {
      const result = await adapter.loadResumeSnapshot(
        request.collectionId,
        request.payload.ctx,
      )
      return {
        v: ELECTRON_PERSISTENCE_PROTOCOL_VERSION,
        requestId: request.requestId,
        method: request.method,
        ok: true,
        result,
      }
    }

    case `loadCollectionMetadata`: {
      if (!adapter.loadCollectionMetadata) {
        throw new InvalidPersistedCollectionConfigError(
          `loadCollectionMetadata is not supported by the configured electron persistence adapter`,
        )
      }
      const result = await adapter.loadCollectionMetadata(
        request.collectionId,
        request.payload.ctx,
      )
      return {
        v: ELECTRON_PERSISTENCE_PROTOCOL_VERSION,
        requestId: request.requestId,
        method: request.method,
        ok: true,
        result,
      }
    }

    case `scanRows`: {
      if (!adapter.scanRows) {
        throw new InvalidPersistedCollectionConfigError(
          `scanRows is not supported by the configured electron persistence adapter`,
        )
      }
      const result = await adapter.scanRows(
        request.collectionId,
        request.payload.options,
        request.payload.ctx,
      )
      return {
        v: ELECTRON_PERSISTENCE_PROTOCOL_VERSION,
        requestId: request.requestId,
        method: request.method,
        ok: true,
        result,
      }
    }

    case `applyCommittedTx`: {
      await adapter.applyCommittedTx(request.collectionId, request.payload.tx)
      return {
        v: ELECTRON_PERSISTENCE_PROTOCOL_VERSION,
        requestId: request.requestId,
        method: request.method,
        ok: true,
        result: null,
      }
    }

    case `ensureIndex`: {
      await adapter.ensureIndex(
        request.collectionId,
        request.payload.signature,
        request.payload.spec,
        request.payload.ctx,
      )
      return {
        v: ELECTRON_PERSISTENCE_PROTOCOL_VERSION,
        requestId: request.requestId,
        method: request.method,
        ok: true,
        result: null,
      }
    }

    case `markIndexRemoved`: {
      if (!adapter.markIndexRemoved) {
        throw new InvalidPersistedCollectionConfigError(
          `markIndexRemoved is not supported by the configured electron persistence adapter`,
        )
      }
      await adapter.markIndexRemoved(
        request.collectionId,
        request.payload.signature,
        request.payload.ctx,
      )
      return {
        v: ELECTRON_PERSISTENCE_PROTOCOL_VERSION,
        requestId: request.requestId,
        method: request.method,
        ok: true,
        result: null,
      }
    }

    case `pullSince`: {
      if (!adapter.pullSince) {
        throw new InvalidPersistedCollectionConfigError(
          `pullSince is not supported by the configured electron persistence adapter`,
        )
      }
      const result = await adapter.pullSince(
        request.collectionId,
        request.payload.fromRowVersion,
        request.payload.ctx,
      )
      return {
        v: ELECTRON_PERSISTENCE_PROTOCOL_VERSION,
        requestId: request.requestId,
        method: request.method,
        ok: true,
        result,
      }
    }

    case `getStreamPosition`: {
      if (!adapter.getStreamPosition) {
        throw new InvalidPersistedCollectionConfigError(
          `getStreamPosition is not supported by the configured electron persistence adapter`,
        )
      }
      const position = await adapter.getStreamPosition(
        request.collectionId,
        request.payload.ctx,
      )
      return {
        v: ELECTRON_PERSISTENCE_PROTOCOL_VERSION,
        requestId: request.requestId,
        method: request.method,
        ok: true,
        result: position,
      }
    }

    case `claimCacheGeneration`: {
      if (!adapter.claimCacheGeneration) {
        throw new InvalidPersistedCollectionConfigError(
          `claimCacheGeneration is not supported by the configured electron persistence adapter`,
        )
      }
      const result = await adapter.claimCacheGeneration(request.collectionId)
      return {
        v: ELECTRON_PERSISTENCE_PROTOCOL_VERSION,
        requestId: request.requestId,
        method: request.method,
        ok: true,
        result,
      }
    }

    case `rotateCacheGeneration`: {
      if (!adapter.rotateCacheGeneration) {
        throw new InvalidPersistedCollectionConfigError(
          `rotateCacheGeneration is not supported by the configured electron persistence adapter`,
        )
      }
      const result = await adapter.rotateCacheGeneration(
        request.collectionId,
        request.payload.claimId,
        request.payload.resetMetadata,
        request.payload.expectedStorageCollectionId,
      )
      return {
        v: ELECTRON_PERSISTENCE_PROTOCOL_VERSION,
        requestId: request.requestId,
        method: request.method,
        ok: true,
        result,
      }
    }

    case `renewCacheGenerationClaim`: {
      if (!adapter.renewCacheGenerationClaim) {
        throw new InvalidPersistedCollectionConfigError(
          `renewCacheGenerationClaim is not supported by the configured electron persistence adapter`,
        )
      }
      const result = await adapter.renewCacheGenerationClaim(
        request.payload.storageCollectionId,
        request.payload.claimId,
      )
      return {
        v: ELECTRON_PERSISTENCE_PROTOCOL_VERSION,
        requestId: request.requestId,
        method: request.method,
        ok: true,
        result,
      }
    }

    case `releaseCacheGenerationClaim`: {
      if (!adapter.releaseCacheGenerationClaim) {
        throw new InvalidPersistedCollectionConfigError(
          `releaseCacheGenerationClaim is not supported by the configured electron persistence adapter`,
        )
      }
      await adapter.releaseCacheGenerationClaim(request.payload.claimId)
      return {
        v: ELECTRON_PERSISTENCE_PROTOCOL_VERSION,
        requestId: request.requestId,
        method: request.method,
        ok: true,
        result: null,
      }
    }
  }
}

function resolveModeAwarePersistence(
  persistence: PersistedCollectionPersistence,
  request: ElectronPersistenceRequestEnvelope,
): PersistedCollectionPersistence {
  const mode = request.resolution?.mode ?? `sync-absent`
  const schemaVersion = request.resolution?.schemaVersion
  const collectionAwarePersistence =
    persistence.resolvePersistenceForCollection?.({
      collectionId:
        request.resolution?.logicalCollectionId ?? request.collectionId,
      mode,
      schemaVersion,
    })
  if (collectionAwarePersistence) {
    return collectionAwarePersistence
  }

  const modeAwarePersistence = persistence.resolvePersistenceForMode?.(mode)
  return modeAwarePersistence ?? persistence
}

export type ElectronIpcMainLike = {
  handle: (
    channel: string,
    listener: (
      event: unknown,
      request: ElectronPersistenceRequestEnvelope,
    ) => Promise<ElectronPersistenceResponseEnvelope>,
  ) => void
  removeHandler?: (channel: string) => void
}

export type ElectronSQLiteMainProcessOptions = {
  persistence: PersistedCollectionPersistence
  ipcMain: ElectronIpcMainLike
  channel?: string
}

export function exposeElectronSQLitePersistence(
  options: ElectronSQLiteMainProcessOptions,
): () => void {
  const channel = options.channel ?? DEFAULT_ELECTRON_PERSISTENCE_CHANNEL
  options.ipcMain.handle(
    channel,
    async (
      _event,
      request: ElectronPersistenceRequestEnvelope,
    ): Promise<ElectronPersistenceResponseEnvelope> => {
      try {
        assertValidRequest(request)
        const modeAwarePersistence = resolveModeAwarePersistence(
          options.persistence,
          request,
        )
        return await executeRequestAgainstAdapter(
          request,
          modeAwarePersistence.adapter,
        )
      } catch (error) {
        return createErrorResponse(request, error)
      }
    },
  )

  return () => {
    options.ipcMain.removeHandler?.(channel)
  }
}

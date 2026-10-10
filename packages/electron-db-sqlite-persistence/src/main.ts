import {
  InvalidPersistedCollectionConfigError,
  resolvePersistedStorageTarget,
} from '@tanstack/db-sqlite-persistence-core'
import {
  DEFAULT_ELECTRON_PERSISTENCE_CHANNEL,
  ELECTRON_PERSISTENCE_PROTOCOL_VERSION,
} from './protocol'
import type {
  PersistedCollectionPersistence,
  PersistedStorageTarget,
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
    target: PersistedStorageTarget,
    ctx?: { cacheGenerationClaimId?: string },
  ) => Promise<Array<{ key: string; value: unknown }>>
  scanRows?: (
    target: PersistedStorageTarget,
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
    target: PersistedStorageTarget,
    fromRowVersion: number,
    ctx?: { cacheGenerationClaimId?: string },
  ) => Promise<SQLitePullSinceResult<ElectronPersistedKey>>
  getStreamPosition?: (
    target: PersistedStorageTarget,
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

  const detailedError = error as Error & { code?: unknown; path?: unknown }
  const path = detailedError.path
  return {
    name: error.name || `Error`,
    message: error.message || fallbackMessage,
    stack: error.stack,
    code:
      typeof detailedError.code === `string` ||
      typeof detailedError.code === `number`
        ? detailedError.code
        : undefined,
    path:
      typeof path === `string` ||
      (Array.isArray(path) &&
        path.every(
          (segment: unknown) =>
            typeof segment === `string` || typeof segment === `number`,
        ))
        ? (path as string | ReadonlyArray<string | number>)
        : undefined,
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

function requireStorageTarget(
  request: ElectronPersistenceRequestEnvelope,
): PersistedStorageTarget {
  const target = request.storageTarget
  if (!target) {
    throw new InvalidPersistedCollectionConfigError(
      `Electron persistence data request requires an explicit storage target`,
    )
  }
  if (
    resolvePersistedStorageTarget(target).collectionId !== request.collectionId
  ) {
    throw new InvalidPersistedCollectionConfigError(
      `Electron persistence storage target does not match its collectionId`,
    )
  }
  return target
}

async function executeRequestAgainstAdapter(
  request: ElectronPersistenceRequestEnvelope,
  adapter: ElectronMainPersistenceAdapter,
): Promise<ElectronPersistenceResponseEnvelope> {
  switch (request.method) {
    case `loadSubset`: {
      const result = await adapter.loadSubset(
        requireStorageTarget(request),
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
        requireStorageTarget(request),
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
        requireStorageTarget(request),
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
        requireStorageTarget(request),
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
      await adapter.applyCommittedTx(
        requireStorageTarget(request),
        request.payload.tx,
      )
      return {
        v: ELECTRON_PERSISTENCE_PROTOCOL_VERSION,
        requestId: request.requestId,
        method: request.method,
        ok: true,
        result: null,
      }
    }

    case `reconcileCommittedTx`: {
      const result = adapter.reconcileCommittedTx
        ? await adapter.reconcileCommittedTx(
            requireStorageTarget(request),
            request.payload.tx,
            request.payload.anchor,
          )
        : { kind: `unknown` as const }
      return {
        v: ELECTRON_PERSISTENCE_PROTOCOL_VERSION,
        requestId: request.requestId,
        method: request.method,
        ok: true,
        result,
      }
    }

    case `ensureIndex`: {
      await adapter.ensureIndex(
        requireStorageTarget(request),
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
        requireStorageTarget(request),
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
        requireStorageTarget(request),
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

    case `reserveLeadershipTerm`: {
      if (!adapter.reserveLeadershipTerm) {
        throw new InvalidPersistedCollectionConfigError(
          `reserveLeadershipTerm is not supported by the configured electron persistence adapter`,
        )
      }
      const position = await adapter.reserveLeadershipTerm(
        requireStorageTarget(request),
        request.payload.observedTerm,
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

    case `getStreamPosition`: {
      if (!adapter.getStreamPosition) {
        throw new InvalidPersistedCollectionConfigError(
          `getStreamPosition is not supported by the configured electron persistence adapter`,
        )
      }
      const position = await adapter.getStreamPosition(
        requireStorageTarget(request),
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

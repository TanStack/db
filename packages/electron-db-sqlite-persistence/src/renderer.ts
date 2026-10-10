import {
  InvalidPersistedCollectionConfigError,
  SingleProcessCoordinator,
  resolvePersistedStorageTarget,
} from '@tanstack/db-sqlite-persistence-core'
import { ElectronCollectionCoordinator } from './electron-coordinator'
import {
  DEFAULT_ELECTRON_PERSISTENCE_CHANNEL,
  ELECTRON_PERSISTENCE_PROTOCOL_VERSION,
} from './protocol'
import type {
  CommittedTxAnchor,
  PersistedCacheGenerationClaim,
  PersistedCollectionCoordinator,
  PersistedCollectionMode,
  PersistedCollectionPersistence,
  PersistedIndexSpec,
  PersistedStorageTarget,
  PersistedTx,
  ReconciledCommittedTx,
  SQLitePullSinceResult,
} from '@tanstack/db-sqlite-persistence-core'
import type {
  ElectronPersistedKey,
  ElectronPersistedRow,
  ElectronPersistenceInvoke,
  ElectronPersistenceMethod,
  ElectronPersistencePayloadMap,
  ElectronPersistenceRequest,
  ElectronPersistenceRequestEnvelope,
  ElectronPersistenceResolution,
  ElectronPersistenceResponseEnvelope,
  ElectronPersistenceResultMap,
} from './protocol'
import type { LoadSubsetOptions } from '@tanstack/db'

const DEFAULT_REQUEST_TIMEOUT_MS = 5_000
let nextRequestId = 1

function createRequestId(): string {
  const requestId = nextRequestId
  nextRequestId++
  return `electron-persistence-${requestId}`
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  if (timeoutMs <= 0) {
    return promise
  }

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new InvalidPersistedCollectionConfigError(timeoutMessage))
    }, timeoutMs)

    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

function assertValidResponse(
  response: ElectronPersistenceResponseEnvelope,
  request: ElectronPersistenceRequestEnvelope,
): void {
  if (response.v !== ELECTRON_PERSISTENCE_PROTOCOL_VERSION) {
    throw new InvalidPersistedCollectionConfigError(
      `Unexpected electron persistence protocol version "${response.v}" in response`,
    )
  }

  if (response.requestId !== request.requestId) {
    throw new InvalidPersistedCollectionConfigError(
      `Mismatched electron persistence response request id. Expected "${request.requestId}", received "${response.requestId}"`,
    )
  }

  if (response.method !== request.method) {
    throw new InvalidPersistedCollectionConfigError(
      `Mismatched electron persistence response method. Expected "${request.method}", received "${response.method}"`,
    )
  }
}

function createSerializableLoadSubsetOptions(
  subsetOptions: LoadSubsetOptions,
): LoadSubsetOptions {
  const { subscription: _subscription, ...serializableOptions } = subsetOptions
  return serializableOptions
}

type RendererRequestExecutor = <TMethod extends ElectronPersistenceMethod>(
  method: TMethod,
  target: string | PersistedStorageTarget,
  payload: ElectronPersistencePayloadMap[TMethod],
  resolution?: ElectronPersistenceResolution,
) => Promise<ElectronPersistenceResultMap[TMethod]>

function createRendererRequestExecutor(options: {
  invoke: ElectronPersistenceInvoke
  channel?: string
  timeoutMs?: number
}): RendererRequestExecutor {
  const channel = options.channel ?? DEFAULT_ELECTRON_PERSISTENCE_CHANNEL
  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS

  return async <TMethod extends ElectronPersistenceMethod>(
    method: TMethod,
    target: string | PersistedStorageTarget,
    payload: ElectronPersistencePayloadMap[TMethod],
    resolution?: ElectronPersistenceResolution,
  ) => {
    const storageTarget = typeof target === `string` ? undefined : target
    const collectionId = storageTarget
      ? resolvePersistedStorageTarget(storageTarget).collectionId
      : target
    const request = {
      v: ELECTRON_PERSISTENCE_PROTOCOL_VERSION,
      requestId: createRequestId(),
      collectionId,
      storageTarget,
      method,
      resolution,
      payload,
    } as ElectronPersistenceRequest

    const response = await withTimeout(
      options.invoke(channel, request),
      timeoutMs,
      `Electron persistence request timed out (method=${method}, collection=${collectionId}, timeoutMs=${timeoutMs})`,
    )
    assertValidResponse(response, request)

    if (!response.ok) {
      const remoteError = new InvalidPersistedCollectionConfigError(
        `${response.error.name}: ${response.error.message}`,
      )
      if (typeof response.error.stack === `string`) {
        remoteError.stack = response.error.stack
      }
      if (
        typeof response.error.code === `string` ||
        typeof response.error.code === `number`
      ) {
        ;(remoteError as Error & { code?: string | number }).code =
          response.error.code
      }
      if (response.error.path !== undefined) {
        ;(
          remoteError as Error & {
            path?: string | ReadonlyArray<string | number>
          }
        ).path = response.error.path
      }
      throw remoteError
    }

    return response.result as ElectronPersistenceResultMap[TMethod]
  }
}

type ElectronRendererResolvedAdapter =
  PersistedCollectionPersistence[`adapter`] & {
    loadCollectionMetadata: (
      target: PersistedStorageTarget,
      ctx?: { cacheGenerationClaimId?: string },
    ) => Promise<Array<{ key: string; value: unknown }>>
    scanRows: (
      target: PersistedStorageTarget,
      options?: { metadataOnly?: boolean },
      ctx?: { cacheGenerationClaimId?: string },
    ) => Promise<
      Array<{
        key: string | number
        value: Record<string, unknown>
        metadata?: unknown
      }>
    >
    pullSince: (
      target: PersistedStorageTarget,
      fromRowVersion: number,
      ctx?: { cacheGenerationClaimId?: string },
    ) => Promise<SQLitePullSinceResult<string | number>>
    getStreamPosition: (
      target: PersistedStorageTarget,
      ctx?: { cacheGenerationClaimId?: string },
    ) => Promise<{
      latestTerm: number
      latestSeq: number
      latestRowVersion: number
    }>
    reserveLeadershipTerm: (
      target: PersistedStorageTarget,
      observedTerm: number,
      ctx?: { cacheGenerationClaimId?: string },
    ) => Promise<{
      latestTerm: number
      latestSeq: number
      latestRowVersion: number
    }>
  }

function createResolvedRendererAdapter(
  executeRequest: RendererRequestExecutor,
  claimCollections: Map<string, string>,
  managedCacheGenerations: boolean,
  resolution?: ElectronPersistenceResolution,
): ElectronRendererResolvedAdapter {
  const adapter: ElectronRendererResolvedAdapter = {
    loadSubset: async (
      target: PersistedStorageTarget,
      subsetOptions: LoadSubsetOptions,
      ctx?: {
        requiredIndexSignatures?: ReadonlyArray<string>
        cacheGenerationClaimId?: string
      },
    ) => {
      const access = resolvePersistedStorageTarget(
        target,
        ctx?.cacheGenerationClaimId,
      )
      const result = await executeRequest(
        `loadSubset`,
        target,
        {
          options: createSerializableLoadSubsetOptions(subsetOptions),
          ctx: { ...ctx, cacheGenerationClaimId: access.claimId },
        },
        resolution,
      )

      return result as Array<{
        key: string | number
        value: Record<string, unknown>
      }>
    },
    loadResumeSnapshot: async (
      target: PersistedStorageTarget,
      ctx?: {
        requiredIndexSignatures?: ReadonlyArray<string>
        includeRows?: boolean
        cacheGenerationClaimId?: string
      },
    ) => {
      const access = resolvePersistedStorageTarget(
        target,
        ctx?.cacheGenerationClaimId,
      )
      return executeRequest(
        `loadResumeSnapshot`,
        target,
        { ctx: { ...ctx, cacheGenerationClaimId: access.claimId } },
        resolution,
      )
    },
    applyCommittedTx: async (
      target: PersistedStorageTarget,
      tx: PersistedTx<Record<string, unknown>, string | number>,
    ): Promise<void> => {
      const access = resolvePersistedStorageTarget(
        target,
        tx.cacheGenerationClaimId,
      )
      await executeRequest(
        `applyCommittedTx`,
        target,
        {
          tx: { ...tx, cacheGenerationClaimId: access.claimId } as PersistedTx<
            ElectronPersistedRow,
            ElectronPersistedKey
          >,
        },
        resolution,
      )
    },
    reconcileCommittedTx: async (
      target: PersistedStorageTarget,
      tx: PersistedTx<Record<string, unknown>, string | number>,
      anchor: CommittedTxAnchor,
    ): Promise<ReconciledCommittedTx> => {
      const access = resolvePersistedStorageTarget(
        target,
        tx.cacheGenerationClaimId,
      )
      return executeRequest(
        `reconcileCommittedTx`,
        target,
        { tx: { ...tx, cacheGenerationClaimId: access.claimId }, anchor },
        resolution,
      )
    },
    loadCollectionMetadata: async (
      target: PersistedStorageTarget,
      ctx?: { cacheGenerationClaimId?: string },
    ): Promise<Array<{ key: string; value: unknown }>> => {
      const access = resolvePersistedStorageTarget(
        target,
        ctx?.cacheGenerationClaimId,
      )
      return executeRequest(
        `loadCollectionMetadata`,
        target,
        { ctx: { ...ctx, cacheGenerationClaimId: access.claimId } },
        resolution,
      )
    },
    scanRows: async (
      target: PersistedStorageTarget,
      options?: { metadataOnly?: boolean },
      ctx?: { cacheGenerationClaimId?: string },
    ): Promise<
      Array<{
        key: string | number
        value: Record<string, unknown>
        metadata?: unknown
      }>
    > => {
      const access = resolvePersistedStorageTarget(
        target,
        ctx?.cacheGenerationClaimId,
      )
      const result = await executeRequest(
        `scanRows`,
        target,
        { options, ctx: { ...ctx, cacheGenerationClaimId: access.claimId } },
        resolution,
      )
      return result as Array<{
        key: string | number
        value: Record<string, unknown>
        metadata?: unknown
      }>
    },
    ensureIndex: async (
      target: PersistedStorageTarget,
      signature: string,
      spec: PersistedIndexSpec,
      ctx?: { cacheGenerationClaimId?: string },
    ): Promise<void> => {
      const access = resolvePersistedStorageTarget(
        target,
        ctx?.cacheGenerationClaimId,
      )
      await executeRequest(
        `ensureIndex`,
        target,
        {
          signature,
          spec,
          ctx: { ...ctx, cacheGenerationClaimId: access.claimId },
        },
        resolution,
      )
    },
    markIndexRemoved: async (
      target: PersistedStorageTarget,
      signature: string,
      ctx?: { cacheGenerationClaimId?: string },
    ): Promise<void> => {
      const access = resolvePersistedStorageTarget(
        target,
        ctx?.cacheGenerationClaimId,
      )
      await executeRequest(
        `markIndexRemoved`,
        target,
        {
          signature,
          ctx: { ...ctx, cacheGenerationClaimId: access.claimId },
        },
        resolution,
      )
    },
    pullSince: async (
      target: PersistedStorageTarget,
      fromRowVersion: number,
      ctx?: { cacheGenerationClaimId?: string },
    ): Promise<SQLitePullSinceResult<string | number>> => {
      const access = resolvePersistedStorageTarget(
        target,
        ctx?.cacheGenerationClaimId,
      )
      const result = await executeRequest(
        `pullSince`,
        target,
        {
          fromRowVersion,
          ctx: { ...ctx, cacheGenerationClaimId: access.claimId },
        },
        resolution,
      )
      return result as SQLitePullSinceResult<string | number>
    },
    getStreamPosition: async (
      target: PersistedStorageTarget,
      ctx?: { cacheGenerationClaimId?: string },
    ): Promise<{
      latestTerm: number
      latestSeq: number
      latestRowVersion: number
    }> => {
      const access = resolvePersistedStorageTarget(
        target,
        ctx?.cacheGenerationClaimId,
      )
      return executeRequest(
        `getStreamPosition`,
        target,
        { ctx: { ...ctx, cacheGenerationClaimId: access.claimId } },
        resolution,
      )
    },
    claimCacheGeneration: async (
      collectionId: string,
    ): Promise<PersistedCacheGenerationClaim> => {
      const claim = await executeRequest(
        `claimCacheGeneration`,
        collectionId,
        {},
        resolution,
      )
      claimCollections.set(claim.claimId, collectionId)
      return claim
    },
    rotateCacheGeneration: async (
      collectionId: string,
      claimId: string,
      resetMetadata?: { key: string; value: unknown },
      expectedStorageCollectionId?: string,
    ): Promise<PersistedCacheGenerationClaim> => {
      const claim = await executeRequest(
        `rotateCacheGeneration`,
        collectionId,
        { claimId, resetMetadata, expectedStorageCollectionId },
        resolution,
      )
      claimCollections.delete(claimId)
      claimCollections.set(claim.claimId, collectionId)
      return claim
    },
    renewCacheGenerationClaim: (
      storageCollectionId: string,
      claimId: string,
    ): Promise<number | undefined> => {
      const collectionId = claimCollections.get(claimId)
      if (!collectionId) {
        throw new InvalidPersistedCollectionConfigError(
          `Unknown electron persisted cache claim "${claimId}"`,
        )
      }
      return executeRequest(
        `renewCacheGenerationClaim`,
        collectionId,
        { storageCollectionId, claimId },
        resolution,
      )
    },
    releaseCacheGenerationClaim: async (claimId: string): Promise<void> => {
      const collectionId = claimCollections.get(claimId)
      if (!collectionId) {
        throw new InvalidPersistedCollectionConfigError(
          `Unknown electron persisted cache claim "${claimId}"`,
        )
      }
      await executeRequest(
        `releaseCacheGenerationClaim`,
        collectionId,
        { claimId },
        resolution,
      )
      claimCollections.delete(claimId)
    },
    reserveLeadershipTerm: async (target, observedTerm, ctx) => {
      const access = resolvePersistedStorageTarget(
        target,
        ctx?.cacheGenerationClaimId,
      )
      return executeRequest(
        `reserveLeadershipTerm`,
        target,
        {
          observedTerm,
          ctx: { ...ctx, cacheGenerationClaimId: access.claimId },
        },
        resolution,
      )
    },
  }
  if (!managedCacheGenerations) {
    adapter.claimCacheGeneration = undefined
    adapter.rotateCacheGeneration = undefined
    adapter.renewCacheGenerationClaim = undefined
    adapter.releaseCacheGenerationClaim = undefined
  }
  return adapter
}

export type ElectronIpcRendererLike = {
  invoke: (
    channel: string,
    request: ElectronPersistenceRequestEnvelope,
  ) => Promise<ElectronPersistenceResponseEnvelope>
}

export type ElectronSQLitePersistenceOptions = {
  invoke?: ElectronPersistenceInvoke
  ipcRenderer?: ElectronIpcRendererLike
  channel?: string
  timeoutMs?: number
  coordinator?: PersistedCollectionCoordinator
  /** Set false when a custom main-process adapter does not manage cache generations. */
  managedCacheGenerations?: boolean
}

function resolveInvoke(
  options: ElectronSQLitePersistenceOptions,
): ElectronPersistenceInvoke {
  if (options.invoke) {
    return options.invoke
  }

  if (options.ipcRenderer) {
    return (channel, request) => options.ipcRenderer!.invoke(channel, request)
  }

  throw new InvalidPersistedCollectionConfigError(
    `Electron renderer persistence requires either invoke or ipcRenderer`,
  )
}

export function createElectronSQLitePersistence(
  options: ElectronSQLitePersistenceOptions,
): PersistedCollectionPersistence {
  const invoke = resolveInvoke(options)
  const coordinator = options.coordinator ?? new SingleProcessCoordinator()
  const executeRequest = createRendererRequestExecutor({
    invoke,
    channel: options.channel,
    timeoutMs: options.timeoutMs,
  })
  const adapterCache = new Map<string, ElectronRendererResolvedAdapter>()
  const claimCollections = new Map<string, string>()

  const getAdapterForCollection = (
    collectionId: string | undefined,
    mode: PersistedCollectionMode,
    schemaVersion: number | undefined,
  ) => {
    const cacheKey = JSON.stringify([collectionId, mode, schemaVersion])
    const cachedAdapter = adapterCache.get(cacheKey)
    if (cachedAdapter) {
      return cachedAdapter
    }

    const adapter = createResolvedRendererAdapter(
      executeRequest,
      claimCollections,
      options.managedCacheGenerations ?? true,
      { mode, schemaVersion, logicalCollectionId: collectionId },
    )
    adapterCache.set(cacheKey, adapter)
    return adapter
  }

  const createCollectionPersistence = (
    collectionId: string | undefined,
    mode: PersistedCollectionMode,
    schemaVersion: number | undefined,
  ): PersistedCollectionPersistence => {
    const adapter = getAdapterForCollection(collectionId, mode, schemaVersion)
    if (coordinator instanceof ElectronCollectionCoordinator) {
      if (collectionId === undefined) {
        coordinator.setAdapter(adapter)
      } else {
        coordinator.setAdapterForCollection(collectionId, adapter)
      }
    }
    return { adapter, coordinator }
  }

  const defaultPersistence = createCollectionPersistence(
    undefined,
    `sync-absent`,
    undefined,
  )
  if (coordinator instanceof ElectronCollectionCoordinator) {
    coordinator.setAdapter(defaultPersistence.adapter)
  }

  return {
    ...defaultPersistence,
    resolvePersistenceForCollection: ({ collectionId, mode, schemaVersion }) =>
      createCollectionPersistence(collectionId, mode, schemaVersion),
    // Backward compatible fallback for older callers.
    resolvePersistenceForMode: (mode) =>
      createCollectionPersistence(undefined, mode, undefined),
  }
}

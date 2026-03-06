import {
  InvalidPersistedCollectionConfigError,
  SingleProcessCoordinator,
} from '@tanstack/db-sqlite-persisted-collection-core'
import {
  DEFAULT_ELECTRON_PERSISTENCE_CHANNEL,
  ELECTRON_PERSISTENCE_PROTOCOL_VERSION,
} from './protocol'
import type {
  PersistedCollectionCoordinator,
  PersistedCollectionMode,
  PersistedCollectionPersistence,
  PersistedIndexSpec,
  PersistedTx,
  SQLitePullSinceResult,
} from '@tanstack/db-sqlite-persisted-collection-core'
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
  collectionId: string,
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
    collectionId: string,
    payload: ElectronPersistencePayloadMap[TMethod],
    resolution?: ElectronPersistenceResolution,
  ) => {
    const request = {
      v: ELECTRON_PERSISTENCE_PROTOCOL_VERSION,
      requestId: createRequestId(),
      collectionId,
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
      if (typeof response.error.code === `string`) {
        ;(remoteError as Error & { code?: string }).code = response.error.code
      }
      throw remoteError
    }

    return response.result as ElectronPersistenceResultMap[TMethod]
  }
}

type ElectronRendererResolvedAdapter<
  T extends object,
  TKey extends string | number = string | number,
> = PersistedCollectionPersistence<T, TKey>[`adapter`] & {
  pullSince: (
    collectionId: string,
    fromRowVersion: number,
  ) => Promise<SQLitePullSinceResult<TKey>>
}

function createResolvedRendererAdapter<
  T extends object,
  TKey extends string | number = string | number,
>(
  executeRequest: RendererRequestExecutor,
  resolution?: ElectronPersistenceResolution,
): ElectronRendererResolvedAdapter<T, TKey> {
  return {
    loadSubset: async (
      collectionId: string,
      subsetOptions: LoadSubsetOptions,
      ctx?: { requiredIndexSignatures?: ReadonlyArray<string> },
    ) => {
      const result = await executeRequest(
        `loadSubset`,
        collectionId,
        {
          options: createSerializableLoadSubsetOptions(subsetOptions),
          ctx,
        },
        resolution,
      )

      return result as Array<{ key: TKey; value: T }>
    },
    applyCommittedTx: async (
      collectionId: string,
      tx: PersistedTx<T, TKey>,
    ): Promise<void> => {
      await executeRequest(
        `applyCommittedTx`,
        collectionId,
        {
          tx: tx as PersistedTx<ElectronPersistedRow, ElectronPersistedKey>,
        },
        resolution,
      )
    },
    ensureIndex: async (
      collectionId: string,
      signature: string,
      spec: PersistedIndexSpec,
    ): Promise<void> => {
      await executeRequest(
        `ensureIndex`,
        collectionId,
        {
          signature,
          spec,
        },
        resolution,
      )
    },
    markIndexRemoved: async (
      collectionId: string,
      signature: string,
    ): Promise<void> => {
      await executeRequest(
        `markIndexRemoved`,
        collectionId,
        {
          signature,
        },
        resolution,
      )
    },
    pullSince: async (
      collectionId: string,
      fromRowVersion: number,
    ): Promise<SQLitePullSinceResult<TKey>> => {
      const result = await executeRequest(
        `pullSince`,
        collectionId,
        {
          fromRowVersion,
        },
        resolution,
      )
      return result as SQLitePullSinceResult<TKey>
    },
  }
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

export function createElectronSQLitePersistence<
  T extends object,
  TKey extends string | number = string | number,
>(
  options: ElectronSQLitePersistenceOptions,
): PersistedCollectionPersistence<T, TKey> {
  const invoke = resolveInvoke(options)
  const coordinator = options.coordinator ?? new SingleProcessCoordinator()
  const executeRequest = createRendererRequestExecutor({
    invoke,
    channel: options.channel,
    timeoutMs: options.timeoutMs,
  })
  const adapterCache = new Map<
    string,
    ElectronRendererResolvedAdapter<Record<string, unknown>, string | number>
  >()

  const getAdapterForCollection = (
    mode: PersistedCollectionMode,
    schemaVersion: number | undefined,
  ) => {
    const schemaVersionKey =
      schemaVersion === undefined ? `schema:default` : `schema:${schemaVersion}`
    const cacheKey = `mode:${mode}|${schemaVersionKey}`
    const cachedAdapter = adapterCache.get(cacheKey)
    if (cachedAdapter) {
      return cachedAdapter
    }

    const adapter = createResolvedRendererAdapter<
      Record<string, unknown>,
      string | number
    >(executeRequest, {
      mode,
      schemaVersion,
    })
    adapterCache.set(cacheKey, adapter)
    return adapter
  }

  const createCollectionPersistence = (
    mode: PersistedCollectionMode,
    schemaVersion: number | undefined,
  ): PersistedCollectionPersistence<T, TKey> => ({
    adapter: getAdapterForCollection(
      mode,
      schemaVersion,
    ) as unknown as PersistedCollectionPersistence<T, TKey>[`adapter`],
    coordinator,
  })

  const defaultPersistence = createCollectionPersistence(
    `sync-absent`,
    undefined,
  )

  return {
    ...defaultPersistence,
    resolvePersistenceForCollection: ({ mode, schemaVersion }) =>
      createCollectionPersistence(mode, schemaVersion),
    // Backward compatible fallback for older callers.
    resolvePersistenceForMode: (mode) =>
      createCollectionPersistence(mode, undefined),
  }
}

import { SingleProcessCoordinator } from '@tanstack/db-sqlite-persisted-collection-core'
import {
  ElectronPersistenceProtocolError,
  ElectronPersistenceRpcError,
  ElectronPersistenceTimeoutError,
} from './errors'
import {
  DEFAULT_ELECTRON_PERSISTENCE_CHANNEL,
  ELECTRON_PERSISTENCE_PROTOCOL_VERSION,
} from './protocol'
import type {
  PersistedCollectionCoordinator,
  PersistedCollectionPersistence,
  PersistedIndexSpec,
  PersistedTx,
  PersistenceAdapter,
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
      reject(new ElectronPersistenceTimeoutError(timeoutMessage))
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
    throw new ElectronPersistenceProtocolError(
      `Unexpected electron persistence protocol version "${response.v}" in response`,
    )
  }

  if (response.requestId !== request.requestId) {
    throw new ElectronPersistenceProtocolError(
      `Mismatched electron persistence response request id. Expected "${request.requestId}", received "${response.requestId}"`,
    )
  }

  if (response.method !== request.method) {
    throw new ElectronPersistenceProtocolError(
      `Mismatched electron persistence response method. Expected "${request.method}", received "${response.method}"`,
    )
  }
}

export type ElectronRendererPersistenceAdapterOptions = {
  invoke: ElectronPersistenceInvoke
  channel?: string
  timeoutMs?: number
}

type RendererAdapterRequestExecutor = <
  TMethod extends ElectronPersistenceMethod,
>(
  method: TMethod,
  collectionId: string,
  payload: ElectronPersistencePayloadMap[TMethod],
) => Promise<ElectronPersistenceResultMap[TMethod]>

function createRendererRequestExecutor(
  options: ElectronRendererPersistenceAdapterOptions,
): RendererAdapterRequestExecutor {
  const channel = options.channel ?? DEFAULT_ELECTRON_PERSISTENCE_CHANNEL
  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS

  return async <TMethod extends ElectronPersistenceMethod>(
    method: TMethod,
    collectionId: string,
    payload: ElectronPersistencePayloadMap[TMethod],
  ) => {
    const request = {
      v: ELECTRON_PERSISTENCE_PROTOCOL_VERSION,
      requestId: createRequestId(),
      collectionId,
      method,
      payload,
    } as ElectronPersistenceRequest

    const response = await withTimeout(
      options.invoke(channel, request),
      timeoutMs,
      `Electron persistence request timed out (method=${method}, collection=${collectionId}, timeoutMs=${timeoutMs})`,
    )
    assertValidResponse(response, request)

    if (!response.ok) {
      throw ElectronPersistenceRpcError.fromSerialized(
        method,
        collectionId,
        request.requestId,
        response.error,
      )
    }

    return response.result as ElectronPersistenceResultMap[TMethod]
  }
}

function createSerializableLoadSubsetOptions(
  subsetOptions: LoadSubsetOptions,
): LoadSubsetOptions {
  const { subscription: _subscription, ...serializableOptions } = subsetOptions
  return serializableOptions
}

export type ElectronRendererPersistenceAdapter<
  T extends object,
  TKey extends string | number = string | number,
> = PersistenceAdapter<T, TKey> & {
  pullSince: (
    collectionId: string,
    fromRowVersion: number,
  ) => Promise<SQLitePullSinceResult<TKey>>
}

export function createElectronRendererPersistenceAdapter<
  T extends object,
  TKey extends string | number = string | number,
>(
  options: ElectronRendererPersistenceAdapterOptions,
): ElectronRendererPersistenceAdapter<T, TKey> {
  const executeRequest = createRendererRequestExecutor(options)

  return {
    loadSubset: async (
      collectionId: string,
      subsetOptions: LoadSubsetOptions,
      ctx?: { requiredIndexSignatures?: ReadonlyArray<string> },
    ) => {
      const result = await executeRequest(`loadSubset`, collectionId, {
        options: createSerializableLoadSubsetOptions(subsetOptions),
        ctx,
      })

      return result as Array<{ key: TKey; value: T }>
    },
    applyCommittedTx: async (
      collectionId: string,
      tx: PersistedTx<T, TKey>,
    ): Promise<void> => {
      await executeRequest(`applyCommittedTx`, collectionId, {
        tx: tx as PersistedTx<ElectronPersistedRow, ElectronPersistedKey>,
      })
    },
    ensureIndex: async (
      collectionId: string,
      signature: string,
      spec: PersistedIndexSpec,
    ): Promise<void> => {
      await executeRequest(`ensureIndex`, collectionId, {
        signature,
        spec,
      })
    },
    markIndexRemoved: async (
      collectionId: string,
      signature: string,
    ): Promise<void> => {
      await executeRequest(`markIndexRemoved`, collectionId, {
        signature,
      })
    },
    pullSince: async (
      collectionId: string,
      fromRowVersion: number,
    ): Promise<SQLitePullSinceResult<TKey>> => {
      const result = await executeRequest(`pullSince`, collectionId, {
        fromRowVersion,
      })
      return result as SQLitePullSinceResult<TKey>
    },
  }
}

export type ElectronRendererPersistenceOptions = {
  invoke: ElectronPersistenceInvoke
  channel?: string
  timeoutMs?: number
  coordinator?: PersistedCollectionCoordinator
}

export class ElectronRendererPersister {
  private readonly coordinator: PersistedCollectionCoordinator
  private readonly adapter: ElectronRendererPersistenceAdapter<
    Record<string, unknown>,
    string | number
  >

  constructor(options: ElectronRendererPersistenceOptions) {
    const { coordinator, ...adapterOptions } = options
    this.coordinator = coordinator ?? new SingleProcessCoordinator()
    this.adapter = createElectronRendererPersistenceAdapter<
      Record<string, unknown>,
      string | number
    >(adapterOptions)
  }

  getAdapter<
    T extends object,
    TKey extends string | number = string | number,
  >(): ElectronRendererPersistenceAdapter<T, TKey> {
    return this.adapter as unknown as ElectronRendererPersistenceAdapter<T, TKey>
  }

  getPersistence<
    T extends object,
    TKey extends string | number = string | number,
  >(
    coordinator: PersistedCollectionCoordinator = this.coordinator,
  ): PersistedCollectionPersistence<T, TKey> & {
    adapter: ElectronRendererPersistenceAdapter<T, TKey>
  } {
    return {
      adapter: this.getAdapter<T, TKey>(),
      coordinator,
    }
  }
}

export function createElectronRendererPersister(
  options: ElectronRendererPersistenceOptions,
): ElectronRendererPersister {
  return new ElectronRendererPersister(options)
}

export function createElectronRendererPersistence<
  T extends object,
  TKey extends string | number = string | number,
>(
  options: ElectronRendererPersistenceOptions,
): PersistedCollectionPersistence<T, TKey> & {
  adapter: ElectronRendererPersistenceAdapter<T, TKey>
} {
  const persister = createElectronRendererPersister(options)
  const defaultPersistence = persister.getPersistence<T, TKey>()

  return {
    ...defaultPersistence,
    resolvePersistenceForMode: () => persister.getPersistence<T, TKey>(),
  }
}

export type ElectronIpcRendererLike = {
  invoke: (
    channel: string,
    request: ElectronPersistenceRequestEnvelope,
  ) => Promise<ElectronPersistenceResponseEnvelope>
}

export function createElectronPersistenceInvoke(
  ipcRenderer: ElectronIpcRendererLike,
): ElectronPersistenceInvoke {
  return (channel, request) => ipcRenderer.invoke(channel, request)
}

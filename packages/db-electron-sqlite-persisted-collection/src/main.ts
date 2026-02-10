import {
  
  createNodeSQLitePersistenceAdapter
} from '@tanstack/db-node-sqlite-persisted-collection'
import {
  ElectronPersistenceProtocolError,
  UnknownElectronPersistenceCollectionError,
  UnsupportedElectronPersistenceMethodError,
} from './errors'
import {
  DEFAULT_ELECTRON_PERSISTENCE_CHANNEL,
  ELECTRON_PERSISTENCE_PROTOCOL_VERSION,
} from './protocol'
import type {NodeSQLitePersistenceAdapterOptions} from '@tanstack/db-node-sqlite-persisted-collection';
import type {
  PersistenceAdapter,
  SQLitePullSinceResult,
} from '@tanstack/db-sqlite-persisted-collection-core'
import type {
  ElectronPersistedKey,
  ElectronPersistedRow,
  ElectronPersistenceRequest,
  ElectronPersistenceRequestHandler,
  ElectronPersistenceResponse,
  ElectronSerializedError,
} from './protocol'

type ElectronMainPersistenceAdapter = PersistenceAdapter<
  ElectronPersistedRow,
  ElectronPersistedKey
> & {
  pullSince?: (
    collectionId: string,
    fromRowVersion: number,
  ) => Promise<SQLitePullSinceResult<ElectronPersistedKey>>
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
  request: ElectronPersistenceRequest,
  error: unknown,
): ElectronPersistenceResponse {
  return {
    v: ELECTRON_PERSISTENCE_PROTOCOL_VERSION,
    requestId: request.requestId,
    method: request.method,
    ok: false,
    error: serializeError(error),
  }
}

function assertValidRequest(request: ElectronPersistenceRequest): void {
  if (request.v !== ELECTRON_PERSISTENCE_PROTOCOL_VERSION) {
    throw new ElectronPersistenceProtocolError(
      `Unsupported electron persistence protocol version "${request.v}"`,
    )
  }

  if (request.requestId.trim().length === 0) {
    throw new ElectronPersistenceProtocolError(
      `Electron persistence requestId cannot be empty`,
    )
  }

  if (request.collectionId.trim().length === 0) {
    throw new ElectronPersistenceProtocolError(
      `Electron persistence collectionId cannot be empty`,
    )
  }
}

async function executeRequestAgainstAdapter(
  request: ElectronPersistenceRequest,
  adapter: ElectronMainPersistenceAdapter,
): Promise<ElectronPersistenceResponse> {
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
        throw new UnsupportedElectronPersistenceMethodError(
          request.method,
          request.collectionId,
        )
      }
      await adapter.markIndexRemoved(
        request.collectionId,
        request.payload.signature,
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
        throw new UnsupportedElectronPersistenceMethodError(
          request.method,
          request.collectionId,
        )
      }
      const result = await adapter.pullSince(
        request.collectionId,
        request.payload.fromRowVersion,
      )
      return {
        v: ELECTRON_PERSISTENCE_PROTOCOL_VERSION,
        requestId: request.requestId,
        method: request.method,
        ok: true,
        result,
      }
    }

    default: {
      const unreachableMethod: never = request.method
      throw new UnsupportedElectronPersistenceMethodError(
        unreachableMethod,
        request.collectionId,
      )
    }
  }
}

export type ElectronPersistenceMainHost = {
  handleRequest: ElectronPersistenceRequestHandler
}

export function createElectronPersistenceMainHost(options: {
  getAdapter: (collectionId: string) => ElectronMainPersistenceAdapter | undefined
}): ElectronPersistenceMainHost {
  return {
    handleRequest: async (
      request: ElectronPersistenceRequest,
    ): Promise<ElectronPersistenceResponse> => {
      try {
        assertValidRequest(request)

        const adapter = options.getAdapter(request.collectionId)
        if (!adapter) {
          throw new UnknownElectronPersistenceCollectionError(request.collectionId)
        }

        return executeRequestAgainstAdapter(request, adapter)
      } catch (error) {
        return createErrorResponse(request, error)
      }
    },
  }
}

export class ElectronPersistenceMainRegistry {
  private readonly collectionAdapters = new Map<
    string,
    ElectronMainPersistenceAdapter
  >()

  registerCollection(
    collectionId: string,
    adapter: ElectronMainPersistenceAdapter,
  ): void {
    if (collectionId.trim().length === 0) {
      throw new ElectronPersistenceProtocolError(
        `Collection id cannot be empty when registering electron persistence adapter`,
      )
    }
    this.collectionAdapters.set(collectionId, adapter)
  }

  unregisterCollection(collectionId: string): void {
    this.collectionAdapters.delete(collectionId)
  }

  clear(): void {
    this.collectionAdapters.clear()
  }

  getAdapter(collectionId: string): ElectronMainPersistenceAdapter | undefined {
    return this.collectionAdapters.get(collectionId)
  }

  createHost(): ElectronPersistenceMainHost {
    return createElectronPersistenceMainHost({
      getAdapter: (collectionId) => this.getAdapter(collectionId),
    })
  }
}

export type ElectronNodeSQLiteMainCollectionConfig = {
  collectionId: string
  adapterOptions: NodeSQLitePersistenceAdapterOptions
}

export function createElectronNodeSQLiteMainRegistry(
  collections: ReadonlyArray<ElectronNodeSQLiteMainCollectionConfig>,
): ElectronPersistenceMainRegistry {
  const registry = new ElectronPersistenceMainRegistry()
  for (const collection of collections) {
    registry.registerCollection(
      collection.collectionId,
      createNodeSQLitePersistenceAdapter<ElectronPersistedRow, ElectronPersistedKey>(
        collection.adapterOptions,
      ),
    )
  }
  return registry
}

export type ElectronIpcMainLike = {
  handle: (
    channel: string,
    listener: (
      event: unknown,
      request: ElectronPersistenceRequest,
    ) => Promise<ElectronPersistenceResponse>,
  ) => void
  removeHandler?: (channel: string) => void
}

export function registerElectronPersistenceMainIpcHandler(options: {
  ipcMain: ElectronIpcMainLike
  host: ElectronPersistenceMainHost
  channel?: string
}): () => void {
  const channel = options.channel ?? DEFAULT_ELECTRON_PERSISTENCE_CHANNEL
  options.ipcMain.handle(channel, async (_event, request) =>
    options.host.handleRequest(request),
  )

  return () => {
    options.ipcMain.removeHandler?.(channel)
  }
}

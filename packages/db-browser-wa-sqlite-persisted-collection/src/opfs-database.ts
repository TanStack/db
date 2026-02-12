import {
  InvalidPersistedCollectionConfigError,
  PersistenceUnavailableError,
} from '@tanstack/db-sqlite-persisted-collection-core'
import OPFSWorkerConstructor from './opfs-worker?worker'
import type { BrowserWASQLiteDatabase } from './wa-sqlite-driver'
import type {
  BrowserOPFSWorkerErrorCode,
  BrowserOPFSWorkerRequest,
  BrowserOPFSWorkerResponse,
} from './opfs-worker-protocol'

const DEFAULT_VFS_NAME = `opfs`
type BrowserOPFSFeatureGlobal = {
  navigator?: {
    storage?: {
      getDirectory?: () => Promise<unknown>
    }
  }
  Worker?: typeof Worker
}

export type OpenBrowserWASQLiteOPFSDatabaseOptions = {
  databaseName: string
  vfsName?: string
}

type BrowserOPFSWorkerLike = Pick<
  Worker,
  `postMessage` | `terminate` | `addEventListener` | `removeEventListener`
>

type PendingWorkerRequest = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

type BrowserOPFSWorkerRequestWithoutId =
  BrowserOPFSWorkerRequest extends infer TRequest
    ? TRequest extends { requestId: string }
      ? Omit<TRequest, `requestId`>
      : never
    : never

class OPFSWorkerRequestError extends Error {
  constructor(
    readonly code: BrowserOPFSWorkerErrorCode,
    message: string,
  ) {
    super(message)
    this.name = `OPFSWorkerRequestError`
  }
}

function hasOPFSBrowserPrerequisites(globalObject: unknown): boolean {
  const candidate = globalObject as BrowserOPFSFeatureGlobal
  const getDirectory = candidate.navigator?.storage?.getDirectory
  const WorkerConstructor = candidate.Worker

  return (
    typeof getDirectory === `function` &&
    typeof WorkerConstructor === `function`
  )
}

function createWorkerError(
  code: BrowserOPFSWorkerErrorCode,
  message: string,
): Error {
  if (code === `PERSISTENCE_UNAVAILABLE`) {
    return new PersistenceUnavailableError(message)
  }
  if (code === `INVALID_CONFIG`) {
    return new InvalidPersistedCollectionConfigError(message)
  }
  return new OPFSWorkerRequestError(code, message)
}

function createWorkerRequestIdFactory(): () => string {
  let sequence = 0
  const prefix = `opfs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

  return () => {
    sequence++
    return `${prefix}-${sequence}`
  }
}

function createOPFSWorkerInstance(): BrowserOPFSWorkerLike {
  const WorkerConstructor = (
    globalThis as typeof globalThis & { Worker?: typeof Worker }
  ).Worker
  if (typeof WorkerConstructor !== `function`) {
    throw new PersistenceUnavailableError(
      `Web Worker support is required for browser OPFS persistence`,
    )
  }

  return new (OPFSWorkerConstructor as unknown as new () => BrowserOPFSWorkerLike)()
}

/**
 * Creates a browser wa-sqlite database handle backed by OPFS and
 * OPFSCoopSyncVFS.
 */
export async function openBrowserWASQLiteOPFSDatabase(
  options: OpenBrowserWASQLiteOPFSDatabaseOptions,
): Promise<BrowserWASQLiteDatabase> {
  const databaseName = options.databaseName.trim()
  if (databaseName.length === 0) {
    throw new InvalidPersistedCollectionConfigError(
      `Browser wa-sqlite databaseName cannot be empty`,
    )
  }

  if (!hasOPFSBrowserPrerequisites(globalThis)) {
    throw new PersistenceUnavailableError(
      `Browser OPFS prerequisites are not available in this runtime`,
    )
  }

  const vfsName = options.vfsName ?? DEFAULT_VFS_NAME
  const worker = createOPFSWorkerInstance()
  const nextRequestId = createWorkerRequestIdFactory()
  const pendingRequests = new Map<string, PendingWorkerRequest>()
  let disposed = false

  const disposeWorker = (): void => {
    if (disposed) {
      return
    }
    disposed = true
    worker.removeEventListener(`message`, onMessage)
    worker.removeEventListener(`error`, onError)
    worker.removeEventListener(`messageerror`, onMessageError)
    worker.terminate()
  }

  const rejectAllPendingRequests = (error: Error): void => {
    for (const pendingRequest of pendingRequests.values()) {
      pendingRequest.reject(error)
    }
    pendingRequests.clear()
  }

  const onMessage = (event: Event): void => {
    const messageEvent = event as MessageEvent<BrowserOPFSWorkerResponse>
    const response = messageEvent.data

    const pendingRequest = pendingRequests.get(response.requestId)
    if (!pendingRequest) {
      return
    }
    pendingRequests.delete(response.requestId)

    if (response.ok) {
      pendingRequest.resolve(response.rows ?? [])
      return
    }

    pendingRequest.reject(createWorkerError(response.code, response.error))
  }

  const onError = (): void => {
    rejectAllPendingRequests(
      new PersistenceUnavailableError(`OPFS worker terminated unexpectedly`),
    )
    disposeWorker()
  }

  const onMessageError = (): void => {
    rejectAllPendingRequests(
      new PersistenceUnavailableError(
        `OPFS worker message serialization failed`,
      ),
    )
    disposeWorker()
  }

  worker.addEventListener(`message`, onMessage)
  worker.addEventListener(`error`, onError)
  worker.addEventListener(`messageerror`, onMessageError)

  const sendWorkerRequest = <T>(
    request: BrowserOPFSWorkerRequestWithoutId,
  ): Promise<T> => {
    if (disposed) {
      return Promise.reject(
        new InvalidPersistedCollectionConfigError(
          `Browser OPFS worker connection is closed`,
        ),
      )
    }

    const requestId = nextRequestId()
    return new Promise<T>((resolve, reject) => {
      pendingRequests.set(requestId, {
        resolve: (value) => {
          resolve(value as T)
        },
        reject,
      })
      try {
        const payload = {
          ...request,
          requestId,
        } as BrowserOPFSWorkerRequest
        worker.postMessage(payload)
      } catch (error) {
        pendingRequests.delete(requestId)
        reject(
          new PersistenceUnavailableError(
            `Failed to send message to OPFS worker: ${(error as Error).message}`,
          ),
        )
      }
    })
  }

  try {
    await sendWorkerRequest<void>({
      type: `init`,
      databaseName,
      vfsName,
    })
  } catch (error) {
    disposeWorker()
    throw error
  }

  return {
    execute: <TRow = unknown>(
      sql: string,
      params: ReadonlyArray<unknown> = [],
    ) =>
      sendWorkerRequest<ReadonlyArray<TRow>>({
        type: `execute`,
        sql,
        params,
      }),
    close: async () => {
      let closeError: unknown
      try {
        await sendWorkerRequest<void>({
          type: `close`,
        })
      } catch (error) {
        closeError = error
      } finally {
        disposeWorker()
      }

      if (closeError) {
        throw closeError
      }
    },
  }
}

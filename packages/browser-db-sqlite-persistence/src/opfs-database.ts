import {
  InvalidPersistedCollectionConfigError,
  PersistenceUnavailableError,
} from '@tanstack/db-sqlite-persistence-core'
import OPFSWorkerConstructor from './opfs-worker?worker'
import type { BrowserWASQLiteDatabase } from './wa-sqlite-driver'
import type {
  BrowserOPFSWorkerErrorCode,
  BrowserOPFSWorkerRequest,
  BrowserOPFSWorkerResponse,
} from './opfs-worker-protocol'

const DEFAULT_VFS_NAME = `opfs`
const DEFAULT_OPEN_TIMEOUT_MS = 30_000
const MAX_OPEN_TIMEOUT_MS = 2_147_483_647
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
  /** Defaults to 30 seconds. Set to 0 to wait without a deadline. */
  timeoutMs?: number
  /** Cancels only the database open, not an established connection. */
  signal?: AbortSignal
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

function getOpenAbortError(signal: AbortSignal): Error {
  const reason: unknown = signal.reason
  return reason instanceof Error
    ? reason
    : new DOMException(
        `Opening browser OPFS database was aborted`,
        `AbortError`,
      )
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

  const timeoutMs = options.timeoutMs ?? DEFAULT_OPEN_TIMEOUT_MS
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 0 ||
    timeoutMs > MAX_OPEN_TIMEOUT_MS
  ) {
    throw new InvalidPersistedCollectionConfigError(
      `Browser wa-sqlite timeoutMs must be an integer between 0 and ${MAX_OPEN_TIMEOUT_MS}`,
    )
  }

  const signal = options.signal
  if (signal?.aborted) {
    throw getOpenAbortError(signal)
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
    globalThis.removeEventListener(`pagehide`, onPageHide)
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

  const onPageHide = (): void => {
    // A document entering the back/forward cache can be frozen before an
    // asynchronous close completes, including while initialization is pending.
    rejectAllPendingRequests(
      new DOMException(
        `The page is closing its SQLite connection`,
        `AbortError`,
      ),
    )
    disposeWorker()
  }

  worker.addEventListener(`message`, onMessage)
  worker.addEventListener(`error`, onError)
  worker.addEventListener(`messageerror`, onMessageError)
  globalThis.addEventListener(`pagehide`, onPageHide)

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

  let openTimeout: ReturnType<typeof setTimeout> | undefined
  const onAbort = (): void => {
    if (!signal) return
    rejectAllPendingRequests(getOpenAbortError(signal))
    disposeWorker()
  }
  const onTimeout = (): void => {
    rejectAllPendingRequests(
      new DOMException(
        `Opening browser OPFS database timed out after ${timeoutMs} ms`,
        `TimeoutError`,
      ),
    )
    disposeWorker()
  }

  try {
    const initialization = sendWorkerRequest<void>({
      type: `init`,
      databaseName,
      vfsName,
    })
    signal?.addEventListener(`abort`, onAbort, { once: true })
    if (signal?.aborted) onAbort()
    if (timeoutMs > 0) {
      openTimeout = setTimeout(onTimeout, timeoutMs)
    }
    await initialization
  } catch (error) {
    disposeWorker()
    throw error
  } finally {
    if (openTimeout !== undefined) clearTimeout(openTimeout)
    signal?.removeEventListener(`abort`, onAbort)
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
      if (disposed) {
        return
      }

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

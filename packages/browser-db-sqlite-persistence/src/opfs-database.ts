import {
  InvalidPersistedCollectionConfigError,
  PersistenceUnavailableError,
  SQLiteConnectionClosedError,
} from '@tanstack/db-sqlite-persistence-core'
import wasmUrl from '@journeyapps/wa-sqlite/dist/wa-sqlite.wasm?url&no-inline'
import workerUrl from './opfs-worker?worker&url'
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
  document?: Document
  location?: { href?: string }
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
  reject: (reason: unknown) => void
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
    typeof candidate.location?.href === `string` &&
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

function createOPFSWorkerInstance(workerFileUrl: URL): BrowserOPFSWorkerLike {
  const WorkerConstructor = (
    globalThis as typeof globalThis & { Worker?: typeof Worker }
  ).Worker
  if (typeof WorkerConstructor !== `function`) {
    throw new PersistenceUnavailableError(
      `Web Worker support is required for browser OPFS persistence`,
    )
  }

  try {
    // The package build ships the worker as a classic script, which browsers
    // without module workers can start. Vite serves the source as a module.
    return new WorkerConstructor(workerFileUrl, {
      type:
        typeof __BROWSER_SQLITE_PACKAGE_BUILD__ === `undefined`
          ? `module`
          : `classic`,
    })
  } catch (error) {
    // For example, a worker URL on another origin throws a SecurityError.
    throw new PersistenceUnavailableError(
      `Failed to start the OPFS worker: ${String(error)}`,
    )
  }
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

type OPFSAssetUrls = {
  wasmFileUrl: URL
  workerFileUrl: URL
}

/**
 * Returns a pending lookup only for the built package under a Vite dev server.
 * Bundlers otherwise resolve the static asset URLs.
 */
function resolveViteAssetUrls({
  wasmFileUrl,
  workerFileUrl,
}: OPFSAssetUrls): Promise<OPFSAssetUrls> | undefined {
  const viteClient = (
    globalThis as BrowserOPFSFeatureGlobal
  ).document?.querySelector<HTMLScriptElement>(`script[src*="/@vite/client"]`)
  // Vite resolves both URLs when it serves this source. Only the package build
  // defines this flag: Vite's dependency optimizer moves the built module
  // without moving its assets.
  if (
    typeof __BROWSER_SQLITE_PACKAGE_BUILD__ === `undefined` ||
    !viteClient?.src
  ) {
    return undefined
  }

  // The build emits dist/wa-sqlite.wasm and dist/assets/<worker>, at different
  // depths from the code. In place, as when the package is excluded from
  // pre-bundling, both URLs share dist/. A moved module resolves them to
  // different directories and needs the lookup, which can fail when the app
  // root cannot resolve the package name.
  if (new URL(`../`, workerFileUrl).href === new URL(`./`, wasmFileUrl).href) {
    return undefined
  }
  const { pathname } = workerFileUrl
  const workerFile = pathname.slice(pathname.lastIndexOf(`/`) + 1)

  // Ask Vite to resolve the package exports instead of guessing install paths.
  const packageUrl = new URL(
    `@id/@tanstack/browser-db-sqlite-persistence/`,
    new URL(`../`, viteClient.src),
  )
  return Promise.all([
    import(
      /* @vite-ignore */ /* webpackIgnore: true */ new URL(
        `wa-sqlite.wasm?url&no-inline`,
        packageUrl,
      ).href
    ) as Promise<{ default: string }>,
    import(
      /* @vite-ignore */ /* webpackIgnore: true */ new URL(
        `assets/${workerFile}?url`,
        packageUrl,
      ).href
    ) as Promise<{ default: string }>,
  ]).then(
    // Vite returns paths on its own server; some page URLs, such as
    // about:srcdoc, cannot resolve a path.
    ([wasmAsset, workerAsset]) => ({
      wasmFileUrl: new URL(wasmAsset.default, packageUrl),
      workerFileUrl: new URL(workerAsset.default, packageUrl),
    }),
    (error: unknown) => {
      throw new PersistenceUnavailableError(
        `Vite could not resolve the browser OPFS assets: ${String(error)}`,
      )
    },
  )
}

async function closeWorkerConnection(
  closeRequest: Promise<void>,
  disposeWorker: (reason: unknown) => void,
): Promise<void> {
  try {
    await closeRequest
  } finally {
    disposeWorker(
      new DOMException(`The SQLite connection is closed`, `AbortError`),
    )
  }
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
  let openTimeout: ReturnType<typeof setTimeout> | undefined
  let failOpen!: (reason: unknown) => void
  // The deadline and abort signal cover asset resolution and initialization.
  const openFailure = new Promise<never>((_resolve, reject) => {
    failOpen = reject
  })
  // A failure before any step awaits this signal, such as an abort followed by
  // a throwing Worker constructor, must not become an unhandled rejection.
  openFailure.catch(() => {})
  const onAbort = (): void => {
    if (signal) failOpen(getOpenAbortError(signal))
  }
  signal?.addEventListener(`abort`, onAbort, { once: true })
  if (signal?.aborted) onAbort()
  if (timeoutMs > 0) {
    openTimeout = setTimeout(() => {
      failOpen(
        new DOMException(
          `Opening browser OPFS database timed out after ${timeoutMs} ms`,
          `TimeoutError`,
        ),
      )
    }, timeoutMs)
  }

  try {
    // Resolve like the Worker constructor does: against the document base,
    // which an about:srcdoc frame inherits. A worker has only its location.
    const pageUrl =
      (globalThis as BrowserOPFSFeatureGlobal).document?.baseURI ??
      globalThis.location.href
    const bundledUrls = {
      wasmFileUrl: new URL(wasmUrl, pageUrl),
      workerFileUrl: new URL(workerUrl, pageUrl),
    }
    const viteUrls = resolveViteAssetUrls(bundledUrls)
    return await openOPFSWorkerDatabase(
      viteUrls ? await Promise.race([viteUrls, openFailure]) : bundledUrls,
      databaseName,
      vfsName,
      openFailure,
    )
  } finally {
    if (openTimeout !== undefined) clearTimeout(openTimeout)
    signal?.removeEventListener(`abort`, onAbort)
  }
}

async function openOPFSWorkerDatabase(
  { wasmFileUrl, workerFileUrl }: OPFSAssetUrls,
  databaseName: string,
  vfsName: string,
  openFailure: Promise<never>,
): Promise<BrowserWASQLiteDatabase> {
  const worker = createOPFSWorkerInstance(workerFileUrl)
  const nextRequestId = createWorkerRequestIdFactory()
  const pendingRequests = new Map<string, PendingWorkerRequest>()
  let disposed = false
  let closing: Promise<void> | undefined

  // Every accepted request settles: disposal rejects whatever is still pending.
  const disposeWorker = (reason: unknown): void => {
    if (disposed) {
      return
    }
    for (const pendingRequest of pendingRequests.values()) {
      pendingRequest.reject(reason)
    }
    pendingRequests.clear()
    disposed = true
    globalThis.removeEventListener(`pagehide`, onPageHide)
    worker.removeEventListener(`message`, onMessage)
    worker.removeEventListener(`error`, onError)
    worker.removeEventListener(`messageerror`, onMessageError)
    worker.terminate()
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
    disposeWorker(
      new PersistenceUnavailableError(`OPFS worker terminated unexpectedly`),
    )
  }

  const onMessageError = (): void => {
    disposeWorker(
      new PersistenceUnavailableError(
        `OPFS worker message serialization failed`,
      ),
    )
  }

  const onPageHide = (): void => {
    // A document entering the back/forward cache can be frozen before an
    // asynchronous close completes, including while initialization is pending.
    disposeWorker(
      new DOMException(
        `The page is closing its SQLite connection`,
        `AbortError`,
      ),
    )
  }

  worker.addEventListener(`message`, onMessage)
  worker.addEventListener(`error`, onError)
  worker.addEventListener(`messageerror`, onMessageError)
  globalThis.addEventListener(`pagehide`, onPageHide)

  const sendWorkerRequest = <T>(
    request: BrowserOPFSWorkerRequestWithoutId,
  ): Promise<T> => {
    if (disposed || closing) {
      return Promise.reject(
        new SQLiteConnectionClosedError(
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
    await Promise.race([
      sendWorkerRequest<void>({
        type: `init`,
        databaseName,
        vfsName,
        wasmUrl: wasmFileUrl.href,
      }),
      openFailure,
    ])
  } catch (error) {
    disposeWorker(error)
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
    close: () => {
      if (disposed) {
        return Promise.resolve()
      }
      // Concurrent callers share one close request and its outcome. Admission
      // ends here; work still pending when close settles is aborted.
      closing ??= closeWorkerConnection(
        sendWorkerRequest<void>({ type: `close` }),
        disposeWorker,
      )
      return closing
    },
  }
}

import type {
  ElectronPersistenceMethod,
  ElectronSerializedError,
} from './protocol'

type ElectronPersistenceErrorOptions = {
  code?: string
  cause?: unknown
}

export class ElectronPersistenceError extends Error {
  readonly code: string | undefined

  constructor(message: string, options?: ElectronPersistenceErrorOptions) {
    super(message, { cause: options?.cause })
    this.name = `ElectronPersistenceError`
    this.code = options?.code
  }
}

export class UnknownElectronPersistenceCollectionError extends ElectronPersistenceError {
  readonly collectionId: string

  constructor(collectionId: string) {
    super(
      `Unknown electron persistence collection "${collectionId}". Register the collection adapter in the main process host.`,
      {
        code: `UNKNOWN_COLLECTION`,
      },
    )
    this.name = `UnknownElectronPersistenceCollectionError`
    this.collectionId = collectionId
  }
}

export class UnsupportedElectronPersistenceMethodError extends ElectronPersistenceError {
  readonly method: ElectronPersistenceMethod
  readonly collectionId: string

  constructor(method: ElectronPersistenceMethod, collectionId: string) {
    super(
      `Method "${method}" is not supported by the electron persistence adapter for collection "${collectionId}".`,
      {
        code: `UNSUPPORTED_METHOD`,
      },
    )
    this.name = `UnsupportedElectronPersistenceMethodError`
    this.method = method
    this.collectionId = collectionId
  }
}

export class ElectronPersistenceProtocolError extends ElectronPersistenceError {
  constructor(message: string, options?: ElectronPersistenceErrorOptions) {
    super(message, {
      code: options?.code ?? `INVALID_PROTOCOL`,
      cause: options?.cause,
    })
    this.name = `ElectronPersistenceProtocolError`
  }
}

export class ElectronPersistenceTimeoutError extends ElectronPersistenceError {
  constructor(message: string) {
    super(message, {
      code: `TIMEOUT`,
    })
    this.name = `ElectronPersistenceTimeoutError`
  }
}

export class ElectronPersistenceRpcError extends ElectronPersistenceError {
  readonly method: ElectronPersistenceMethod
  readonly collectionId: string
  readonly requestId: string
  readonly remoteName: string

  constructor(
    method: ElectronPersistenceMethod,
    collectionId: string,
    requestId: string,
    serializedError: ElectronSerializedError,
  ) {
    super(
      `${serializedError.name}: ${serializedError.message} (method=${method}, collection=${collectionId}, request=${requestId})`,
      {
        code: serializedError.code ?? `REMOTE_ERROR`,
      },
    )
    this.name = `ElectronPersistenceRpcError`
    this.method = method
    this.collectionId = collectionId
    this.requestId = requestId
    this.remoteName = serializedError.name
  }

  static fromSerialized(
    method: ElectronPersistenceMethod,
    collectionId: string,
    requestId: string,
    serializedError: ElectronSerializedError,
  ): ElectronPersistenceRpcError {
    return new ElectronPersistenceRpcError(
      method,
      collectionId,
      requestId,
      serializedError,
    )
  }
}

import { TanStackDBError } from '@tanstack/db'

export class PersistedCollectionCoreError extends TanStackDBError {
  constructor(message: string) {
    super(message)
    this.name = `PersistedCollectionCoreError`
  }
}

export class InvalidPersistedCollectionConfigError extends PersistedCollectionCoreError {
  constructor(message: string) {
    super(message)
    this.name = `InvalidPersistedCollectionConfigError`
  }
}

export class InvalidSyncConfigError extends InvalidPersistedCollectionConfigError {
  constructor(details?: string) {
    super(
      details
        ? `Invalid sync config: ${details}`
        : `Invalid sync config: expected an object with a callable sync function`,
    )
    this.name = `InvalidSyncConfigError`
  }
}

export class InvalidPersistedCollectionCoordinatorError extends InvalidPersistedCollectionConfigError {
  constructor(methodName: string) {
    super(
      `Invalid persisted collection coordinator: missing required "${methodName}" method`,
    )
    this.name = `InvalidPersistedCollectionCoordinatorError`
  }
}

export class InvalidPersistenceAdapterError extends InvalidPersistedCollectionConfigError {
  constructor(methodName: string) {
    super(
      `Invalid persistence adapter: missing required "${methodName}" method`,
    )
    this.name = `InvalidPersistenceAdapterError`
  }
}

export class InvalidPersistedStorageKeyError extends InvalidPersistedCollectionConfigError {
  constructor(key: string | number) {
    super(
      `Invalid persisted storage key "${String(key)}": numeric keys must be finite`,
    )
    this.name = `InvalidPersistedStorageKeyError`
  }
}

export class InvalidPersistedStorageKeyEncodingError extends InvalidPersistedCollectionConfigError {
  constructor(encoded: string) {
    super(
      `Invalid persisted storage key encoding "${encoded}": expected prefix "n:" or "s:"`,
    )
    this.name = `InvalidPersistedStorageKeyEncodingError`
  }
}

export class PersistenceUnavailableError extends PersistedCollectionCoreError {
  constructor(details?: string) {
    super(
      details
        ? `Persistence unavailable: ${details}`
        : `Persistence unavailable in this runtime`,
    )
    this.name = `PersistenceUnavailableError`
  }
}

export class PersistenceDurabilityError extends PersistedCollectionCoreError {
  readonly code: string | undefined
  readonly path: string

  constructor(cause: unknown, fallbackPath: string) {
    const causeMessage =
      cause instanceof Error ? cause.message : `Unknown persistence failure`
    const causeRecord =
      typeof cause === `object` && cause !== null
        ? (cause as Record<string, unknown>)
        : undefined
    const code =
      typeof causeRecord?.code === `string` ? causeRecord.code : undefined
    const path =
      typeof causeRecord?.path === `string` ? causeRecord.path : fallbackPath

    super(`Persistence durability failed at ${path}: ${causeMessage}`)
    this.name = `PersistenceDurabilityError`
    this.cause = cause
    this.code = code
    this.path = path
  }
}

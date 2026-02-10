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

import { TanStackDBError } from "@tanstack/db"

// Query Collection Errors
export class QueryCollectionError extends TanStackDBError {
  constructor(message: string) {
    super(message)
    this.name = `QueryCollectionError`
  }
}

export class QueryKeyRequiredError extends QueryCollectionError {
  constructor() {
    super(`[QueryCollection] queryKey must be provided.`)
    this.name = `QueryKeyRequiredError`
  }
}

export class QueryFnRequiredError extends QueryCollectionError {
  constructor() {
    super(`[QueryCollection] queryFn must be provided.`)
    this.name = `QueryFnRequiredError`
  }
}

export class QueryClientRequiredError extends QueryCollectionError {
  constructor() {
    super(`[QueryCollection] queryClient must be provided.`)
    this.name = `QueryClientRequiredError`
  }
}

export class GetKeyRequiredError extends QueryCollectionError {
  constructor() {
    super(`[QueryCollection] getKey must be provided.`)
    this.name = `GetKeyRequiredError`
  }
}

export class SyncNotInitializedError extends QueryCollectionError {
  constructor() {
    super(
      `Collection must be in 'ready' state for manual sync operations. Sync not initialized yet.`
    )
    this.name = `SyncNotInitializedError`
  }
}

export class InvalidItemStructureError extends QueryCollectionError {
  constructor(message: string) {
    super(`Invalid item structure: ${message}`)
    this.name = `InvalidItemStructureError`
  }
}

export class ItemNotFoundError extends QueryCollectionError {
  constructor(key: string | number) {
    super(`Item with key '${key}' does not exist.`)
    this.name = `ItemNotFoundError`
  }
}

export class DuplicateKeyInBatchError extends QueryCollectionError {
  constructor(key: string | number) {
    super(`Duplicate key '${key}' found within batch operations`)
    this.name = `DuplicateKeyInBatchError`
  }
}

export class UpdateOperationItemNotFoundError extends QueryCollectionError {
  constructor(key: string | number) {
    super(`Update operation: Item with key '${key}' does not exist`)
    this.name = `UpdateOperationItemNotFoundError`
  }
}

export class DeleteOperationItemNotFoundError extends QueryCollectionError {
  constructor(key: string | number) {
    super(`Delete operation: Item with key '${key}' does not exist`)
    this.name = `DeleteOperationItemNotFoundError`
  }
}

export class InvalidSyncOperationError extends QueryCollectionError {
  constructor(message: string) {
    super(`Invalid sync operation: ${message}`)
    this.name = `InvalidSyncOperationError`
  }
}

export class UnknownOperationTypeError extends QueryCollectionError {
  constructor(type: string) {
    super(`Unknown operation type: ${type}`)
    this.name = `UnknownOperationTypeError`
  }
}

export class MissingKeyFieldError extends QueryCollectionError {
  constructor(operation: string, message: string) {
    super(`${operation} item must contain the key field: ${message}`)
    this.name = `MissingKeyFieldError`
  }
}

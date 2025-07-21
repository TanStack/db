import { TanStackDBError } from "@tanstack/db"

// TrailBase DB Collection Errors
export class TrailBaseDBCollectionError extends TanStackDBError {
  constructor(message: string) {
    super(message)
    this.name = `TrailBaseDBCollectionError`
  }
}

export class TimeoutWaitingForIdsError extends TrailBaseDBCollectionError {
  constructor(ids: string) {
    super(`Timeout waiting for ids: ${ids}`)
  }
}

export class ExpectedInsertTypeError extends TrailBaseDBCollectionError {
  constructor(actualType: string) {
    super(`Expected 'insert', got: ${actualType}`)
  }
}

export class ExpectedUpdateTypeError extends TrailBaseDBCollectionError {
  constructor(actualType: string) {
    super(`Expected 'update', got: ${actualType}`)
  }
}

export class ExpectedDeleteTypeError extends TrailBaseDBCollectionError {
  constructor(actualType: string) {
    super(`Expected 'delete', got: ${actualType}`)
  }
}

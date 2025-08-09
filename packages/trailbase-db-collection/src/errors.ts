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
    this.name = `TimeoutWaitingForIdsError`
  }
}

export class ExpectedInsertTypeError extends TrailBaseDBCollectionError {
  constructor(actualType: string) {
    super(`Expected 'insert', got: ${actualType}`)
    this.name = `ExpectedInsertTypeError`
  }
}

export class ExpectedUpdateTypeError extends TrailBaseDBCollectionError {
  constructor(actualType: string) {
    super(`Expected 'update', got: ${actualType}`)
    this.name = `ExpectedUpdateTypeError`
  }
}

export class ExpectedDeleteTypeError extends TrailBaseDBCollectionError {
  constructor(actualType: string) {
    super(`Expected 'delete', got: ${actualType}`)
    this.name = `ExpectedDeleteTypeError`
  }
}

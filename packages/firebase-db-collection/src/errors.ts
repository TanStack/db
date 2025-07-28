export class FirestoreIntegrationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "FirestoreIntegrationError"
  }
}

export class TimeoutWaitingForIdsError extends FirestoreIntegrationError {
  constructor(ids: string) {
    super(`Timeout waiting for document IDs: ${ids}`)
    this.name = "TimeoutWaitingForIdsError"
  }
}

export class ExpectedInsertTypeError extends FirestoreIntegrationError {
  constructor(type: string) {
    super(`Expected insert type but got: ${type}`)
    this.name = "ExpectedInsertTypeError"
  }
}

export class ExpectedUpdateTypeError extends FirestoreIntegrationError {
  constructor(type: string) {
    super(`Expected update type but got: ${type}`)
    this.name = "ExpectedUpdateTypeError"
  }
}

export class ExpectedDeleteTypeError extends FirestoreIntegrationError {
  constructor(type: string) {
    super(`Expected delete type but got: ${type}`)
    this.name = "ExpectedDeleteTypeError"
  }
}

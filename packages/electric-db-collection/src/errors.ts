import { TanStackDBError } from "@tanstack/db"

// Electric DB Collection Errors
export class ElectricDBCollectionError extends TanStackDBError {
  constructor(message: string) {
    super(message)
    this.name = `ElectricDBCollectionError`
  }
}

export class ExpectedNumberInAwaitTxIdError extends ElectricDBCollectionError {
  constructor(txIdType: string) {
    super(`Expected number in awaitTxId, received ${txIdType}`)
    this.name = `ExpectedNumberInAwaitTxIdError`
  }
}

export class TimeoutWaitingForTxIdError extends ElectricDBCollectionError {
  constructor(txId: number) {
    super(`Timeout waiting for txId: ${txId}`)
    this.name = `TimeoutWaitingForTxIdError`
  }
}

export class TimeoutWaitingForMatchError extends ElectricDBCollectionError {
  constructor() {
    super(`Timeout waiting for custom match function`)
    this.name = `TimeoutWaitingForMatchError`
  }
}

export class StreamAbortedError extends ElectricDBCollectionError {
  constructor() {
    super(`Stream aborted`)
    this.name = `StreamAbortedError`
  }
}

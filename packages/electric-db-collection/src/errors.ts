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

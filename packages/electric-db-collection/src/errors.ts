import { TanStackDBError } from "@tanstack/db"

// Electric DB Collection Errors
export class ElectricDBCollectionError extends TanStackDBError {
  constructor(message: string, collectionId?: string) {
    super(`${collectionId ? `[${collectionId}] ` : ``}${message}`)
    this.name = `ElectricDBCollectionError`
  }
}

export class ExpectedNumberInAwaitTxIdError extends ElectricDBCollectionError {
  constructor(txIdType: string, collectionId?: string) {
    super(`Expected number in awaitTxId, received ${txIdType}`, collectionId)
    this.name = `ExpectedNumberInAwaitTxIdError`
  }
}

export class TimeoutWaitingForTxIdError extends ElectricDBCollectionError {
  constructor(txId: number, collectionId?: string) {
    super(`Timeout waiting for txId: ${txId}`, collectionId)
    this.name = `TimeoutWaitingForTxIdError`
  }
}

export class ElectricInsertHandlerMustReturnTxIdError extends ElectricDBCollectionError {
  constructor(collectionId?: string) {
    super(
      `Electric collection onInsert handler must return a txid or array of txids`,
      collectionId
    )
    this.name = `ElectricInsertHandlerMustReturnTxIdError`
  }
}

export class ElectricUpdateHandlerMustReturnTxIdError extends ElectricDBCollectionError {
  constructor(collectionId?: string) {
    super(
      `Electric collection onUpdate handler must return a txid or array of txids`,
      collectionId
    )
    this.name = `ElectricUpdateHandlerMustReturnTxIdError`
  }
}

export class ElectricDeleteHandlerMustReturnTxIdError extends ElectricDBCollectionError {
  constructor(collectionId?: string) {
    super(
      `Electric collection onDelete handler must return a txid or array of txids`,
      collectionId
    )
    this.name = `ElectricDeleteHandlerMustReturnTxIdError`
  }
}

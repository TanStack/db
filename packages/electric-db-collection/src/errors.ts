// Electric DB Collection Errors
export class ElectricDBCollectionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = `ElectricDBCollectionError`
  }
}

export class ExpectedNumberInAwaitTxIdError extends ElectricDBCollectionError {
  constructor(txIdType: string) {
    super(`Expected number in awaitTxId, received ${txIdType}`)
  }
}

export class TimeoutWaitingForTxIdError extends ElectricDBCollectionError {
  constructor(txId: number) {
    super(`Timeout waiting for txId: ${txId}`)
  }
}

export class ElectricInsertHandlerMustReturnTxIdError extends ElectricDBCollectionError {
  constructor() {
    super(
      `Electric collection onInsert handler must return a txid or array of txids`
    )
  }
}

export class ElectricUpdateHandlerMustReturnTxIdError extends ElectricDBCollectionError {
  constructor() {
    super(
      `Electric collection onUpdate handler must return a txid or array of txids`
    )
  }
}

export class ElectricDeleteHandlerMustReturnTxIdError extends ElectricDBCollectionError {
  constructor() {
    super(
      `Electric collection onDelete handler must return a txid or array of txids`
    )
  }
}

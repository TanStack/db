import { TanStackDBError } from '@tanstack/db'

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
  constructor(
    txId: number,
    collectionId?: string,
    receivedTxids?: Array<number>,
  ) {
    const receivedInfo =
      receivedTxids === undefined
        ? ``
        : receivedTxids.length === 0
          ? `\nNo txids were received during the timeout period.`
          : `\nTxids received during timeout: [${receivedTxids.join(`, `)}]`

    const hint = `\n\nThis often happens when pg_current_xact_id() is called outside the transaction that performs the mutation. Make sure to call it INSIDE the same transaction. See: https://tanstack.com/db/latest/docs/collections/electric-collection#common-issue-awaittxid-stalls-or-times-out`

    super(
      `Timeout waiting for txId: ${txId}${receivedInfo}${hint}`,
      collectionId,
    )
    this.name = `TimeoutWaitingForTxIdError`
  }
}

export class TimeoutWaitingForMatchError extends ElectricDBCollectionError {
  constructor(collectionId?: string) {
    super(`Timeout waiting for custom match function`, collectionId)
    this.name = `TimeoutWaitingForMatchError`
  }
}

export class StreamAbortedError extends ElectricDBCollectionError {
  constructor(collectionId?: string) {
    super(`Stream aborted`, collectionId)
    this.name = `StreamAbortedError`
  }
}

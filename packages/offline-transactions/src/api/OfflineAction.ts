import { OnMutateMustBeSynchronousError } from '@tanstack/db'
import { OfflineTransaction } from './OfflineTransaction'
import type { Transaction } from '@tanstack/db'
import type {
  CreateOfflineActionOptions,
  OfflineMutationFn,
  OfflineTransaction as OfflineTransactionType,
} from '../types'

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    !!value &&
    (typeof value === `object` || typeof value === `function`) &&
    typeof (value as { then?: unknown }).then === `function`
  )
}

export function createOfflineAction<T>(
  options: CreateOfflineActionOptions<T>,
  mutationFn: OfflineMutationFn,
  persistTransaction: (tx: OfflineTransactionType) => Promise<void>,
  executor: any,
): (variables: T) => Transaction {
  const { mutationFnName, onMutate } = options

  return (variables: T): Transaction => {
    const offlineTransaction = new OfflineTransaction(
      {
        mutationFnName,
        // The transaction commits after onMutate and reports a failure
        // through isPersisted.
        autoCommit: true,
      },
      mutationFn,
      persistTransaction,
      executor,
    )

    return offlineTransaction.mutate(() => {
      const maybePromise = onMutate(variables) as unknown

      if (isPromiseLike(maybePromise)) {
        throw new OnMutateMustBeSynchronousError()
      }
    })
  }
}

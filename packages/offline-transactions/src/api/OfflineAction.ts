import { OfflineTransaction } from "./OfflineTransaction"
import type { Transaction } from "@tanstack/db"
import type {
  CreateOfflineActionOptions,
  MutationFn,
  OfflineTransaction as OfflineTransactionType,
} from "../types"

export function createOfflineAction<T>(
  options: CreateOfflineActionOptions<T>,
  mutationFn: MutationFn,
  persistTransaction: (tx: OfflineTransactionType) => Promise<void>
): (variables: T) => Transaction {
  const { mutationFnName, onMutate } = options

  return (variables: T): Transaction => {
    const offlineTransaction = new OfflineTransaction(
      {
        mutationFnName,
        autoCommit: true,
      },
      mutationFn,
      persistTransaction
    )

    return offlineTransaction.mutate(() => {
      onMutate(variables)
    })
  }
}

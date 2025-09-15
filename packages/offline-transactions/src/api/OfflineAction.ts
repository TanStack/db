import { OfflineTransaction } from "./OfflineTransaction"
import type { Transaction } from "@tanstack/db"
import type {
  CreateOfflineActionOptions,
  OfflineTransaction as OfflineTransactionType,
} from "../types"

export function createOfflineAction<T>(
  options: CreateOfflineActionOptions<T>,
  onPersist?: (offlineTransaction: OfflineTransactionType) => Promise<void>
): (variables: T) => Transaction {
  const { mutationFnName, onMutate } = options

  return (variables: T): Transaction => {
    const offlineTransaction = new OfflineTransaction(
      {
        mutationFnName,
        autoCommit: true,
      },
      onPersist
    )

    return offlineTransaction.mutate(() => {
      onMutate(variables)
    })
  }
}

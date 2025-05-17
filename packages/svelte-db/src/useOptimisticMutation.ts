import { createTransaction } from "@tanstack/db"
import type { Transaction, TransactionConfig } from "@tanstack/db"

export function useOptimisticMutation(config: TransactionConfig) {
  return {
    mutate: (callback: () => void): Transaction => {
      const transaction = createTransaction(config)
      transaction.mutate(callback)
      return transaction
    },
    createTransaction: (): Transaction => {
      return createTransaction({ ...config, autoCommit: false })
    },
  }
}

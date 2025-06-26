import { createTransaction } from "./transactions"
import type { CreateOptimisticActionsOptions, Transaction } from "./types"

export function createOptimisticAction<TVariables = unknown>(
  options: CreateOptimisticActionsOptions<TVariables>
) {
  const { mutationFn, onMutate, ...config } = options

  return (variables: TVariables): Transaction => {
    // Create transaction with the original config
    const transaction = createTransaction({
      ...config,
      // Wire the mutationFn to use the provided variables
      mutationFn: async (params) => {
        return await mutationFn(variables, params)
      },
    })

    // Execute the transaction (no callback needed since onMutate was already called)
    transaction.mutate(() => {
      // Call onMutate with variables to apply optimistic updates
      onMutate(variables)
    })

    return transaction
  }
}

import { createTransaction } from './transactions'
import {
  DebounceCallDroppedError,
  QueueCapacityExceededError,
  QueueDisposedError,
  ThrottleCallDroppedError,
} from './errors'
import type { MutationFn, Transaction } from './types'
import type { Strategy } from './strategies/types'

/**
 * Configuration for creating a paced mutations manager
 */
export interface PacedMutationsConfig<
  TVariables = unknown,
  T extends object = Record<string, unknown>,
> {
  /**
   * Callback to apply optimistic updates immediately.
   * Receives the variables passed to the mutate function.
   */
  onMutate: (variables: TVariables) => void
  /**
   * Function to execute the mutation on the server.
   * Receives the transaction parameters containing all merged mutations.
   */
  mutationFn: MutationFn<T>
  /**
   * Strategy for controlling mutation execution timing
   * Examples: debounceStrategy, queueStrategy, throttleStrategy
   */
  strategy: Strategy
  /**
   * Custom metadata to associate with transactions
   */
  metadata?: Record<string, unknown>
}

/**
 * Creates a paced mutations manager with pluggable timing strategies.
 *
 * This function provides a way to control when and how optimistic mutations
 * are persisted to the backend, using strategies like debouncing, queuing,
 * or throttling. The optimistic updates are applied immediately via `onMutate`,
 * and the actual persistence is controlled by the strategy.
 *
 * The returned function accepts variables of type TVariables and returns a
 * Transaction object that can be awaited to know when persistence completes
 * or to handle errors.
 *
 * @param config - Configuration including onMutate, mutationFn and strategy
 * @returns A function that accepts variables and returns a Transaction
 *
 * @example
 * ```ts
 * // Debounced mutations for auto-save
 * const updateTodo = createPacedMutations<string>({
 *   onMutate: (text) => {
 *     // Apply optimistic update immediately
 *     collection.update(id, draft => { draft.text = text })
 *   },
 *   mutationFn: async ({ transaction }) => {
 *     await api.save(transaction.mutations)
 *   },
 *   strategy: debounceStrategy({ wait: 500 })
 * })
 *
 * // Call with variables, returns a transaction
 * const tx = updateTodo('New text')
 *
 * // Await persistence or handle errors
 * await tx.when('settled')
 * ```
 *
 * @example
 * ```ts
 * // Queue strategy for sequential processing
 * const addTodo = createPacedMutations<{ text: string }>({
 *   onMutate: ({ text }) => {
 *     collection.insert({ id: uuid(), text, completed: false })
 *   },
 *   mutationFn: async ({ transaction }) => {
 *     await api.save(transaction.mutations)
 *   },
 *   strategy: queueStrategy({
 *     wait: 200,
 *     addItemsTo: 'back',
 *     getItemsFrom: 'front'
 *   })
 * })
 * ```
 */
export function createPacedMutations<
  TVariables = unknown,
  T extends object = Record<string, unknown>,
>(
  config: PacedMutationsConfig<TVariables, T>,
): (variables: TVariables) => Transaction<T> {
  const { onMutate, mutationFn, strategy, ...transactionConfig } = config

  let activeTransaction: Transaction<T> | null = null

  function getTransaction(isolated = false): Transaction<T> {
    if (!isolated && activeTransaction?.state === `pending`)
      return activeTransaction
    const transaction = createTransaction<T>({
      ...transactionConfig,
      mutationFn,
      autoCommit: false,
    })
    if (!isolated) activeTransaction = transaction
    return transaction
  }

  function commit(
    transaction: Transaction<T>,
    onStarted?: (completion: Promise<Transaction<T>>) => void,
  ): Transaction<T> {
    if (activeTransaction === transaction) activeTransaction = null
    // A pending transaction can be rolled back directly or by a prior same-key
    // failure. Its scheduled callback must not revive canceled mutations.
    if (transaction.state === `failed`) return transaction
    if (transaction.state !== `pending`) {
      throw new Error(
        `Strategy callback called but transaction is in state "${transaction.state}". Expected "pending".`,
      )
    }
    const completion = transaction.commit()
    onStarted?.(completion)
    completion.catch(() => {
      // Persistence failures are reported by transaction.isPersisted.promise.
    })
    return transaction
  }

  function mutate(variables: TVariables): Transaction<T> {
    if (strategy._type === `debounce` || strategy._type === `throttle`) {
      let transaction: Transaction<T> | undefined
      let completion: Promise<Transaction<T>> | undefined
      const onAdmit = (): Transaction<T> => {
        if (transaction) return transaction
        transaction = getTransaction()
        transaction.mutate(() => onMutate(variables))
        return transaction
      }
      const admitted = strategy.execute(
        () => {
          // Legacy custom strategies may ignore the optional admission callback.
          return commit(onAdmit(), (started) => {
            completion = started
          })
        },
        onAdmit,
        () => completion,
      )
      if (admitted !== false) return onAdmit()

      // Rejected calls must never join an already-admitted pending transaction.
      const dropped = getTransaction(true)
      dropped.mutate(() => onMutate(variables))
      dropped.rollback({
        error:
          strategy._type === `debounce`
            ? new DebounceCallDroppedError()
            : new ThrottleCallDroppedError(),
        isSecondaryRollback: true,
      })
      return dropped
    }

    const transaction = getTransaction(strategy._type === `queue`)
    transaction.mutate(() => onMutate(variables))
    try {
      let completion: Promise<Transaction<T>> | undefined
      const admitted = strategy.execute(
        () =>
          commit(transaction, (started) => {
            completion = started
          }),
        undefined,
        () => completion,
      )
      if (strategy._type === `queue` && admitted === false) {
        transaction.rollback({
          error: new QueueCapacityExceededError(),
          isSecondaryRollback: true,
        })
      }
    } catch (error) {
      if (!(error instanceof QueueDisposedError)) throw error
      transaction.rollback({ error, isSecondaryRollback: true })
    }
    return transaction
  }

  return mutate
}

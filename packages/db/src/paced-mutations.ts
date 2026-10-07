import { createTransaction } from './transactions'
import { normalizeError } from './utils/error'
import {
  DebounceCallDroppedError,
  PacedTransactionManualCommitError,
  QueueCapacityExceededError,
  QueueDisposedError,
  ThrottleCallDroppedError,
} from './errors'
import { codedMessage, devBuild } from './error-message'
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
 * or to handle errors. The strategy owns `commit()`; calling it on the returned
 * transaction throws before persistence starts. `rollback()` remains available.
 * If a synchronous `onMutate` calls this manager again and then throws, every
 * call merged into that pending transaction rejects together.
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
  const strategyCommits = new WeakMap<
    Transaction<T>,
    () => Promise<Transaction<T>>
  >()
  let optimisticFrame:
    { transaction: Transaction<T>; admittedNestedCall: boolean } | undefined

  function getTransaction(isolated = false): Transaction<T> {
    if (!isolated && activeTransaction?.state === `pending`)
      return activeTransaction
    const transaction = createTransaction<T>({
      ...transactionConfig,
      mutationFn,
      autoCommit: false,
    })
    strategyCommits.set(transaction, transaction.commit.bind(transaction))
    transaction.commit = () => {
      throw new PacedTransactionManualCommitError()
    }
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
        devBuild() && process.env.NODE_ENV !== `production` ? `Strategy callback called but transaction is in state "${transaction.state}". Expected "pending".` : codedMessage(107, { state: transaction.state }),
      )
    }
    const strategyCommit = strategyCommits.get(transaction)
    if (!strategyCommit)
      throw new Error(devBuild() && process.env.NODE_ENV !== `production` ? `Paced transaction has no strategy-owned commit` : codedMessage(108))
    const completion = strategyCommit()
    onStarted?.(completion)
    completion.catch(() => {
      // Persistence failures are reported by transaction.isPersisted.promise.
    })
    return transaction
  }

  function applyOptimistic(
    transaction: Transaction<T>,
    variables: TVariables,
    newlyCreated: boolean,
  ): void {
    const parent = optimisticFrame
    if (parent?.transaction === transaction) parent.admittedNestedCall = true
    const frame = { transaction, admittedNestedCall: false }
    optimisticFrame = frame
    try {
      transaction.mutate(() => onMutate(variables))
    } catch (error) {
      if (newlyCreated || frame.admittedNestedCall) {
        // Calls merged into this pending transaction share a failure. A newly
        // created transaction also needs release when no receipt was returned.
        void transaction.isPersisted.promise.catch(() => {})
        transaction.rollback({
          error: normalizeError(error),
          isSecondaryRollback: !frame.admittedNestedCall,
        })
        if (activeTransaction === transaction) activeTransaction = null
      }
      throw error
    } finally {
      optimisticFrame = parent
    }
  }

  function mutate(variables: TVariables): Transaction<T> {
    if (strategy._type === `debounce` || strategy._type === `throttle`) {
      let transaction: Transaction<T> | undefined
      let completion: Promise<Transaction<T>> | undefined
      const onAdmit = (): Transaction<T> => {
        if (transaction) return transaction
        const previous = activeTransaction
        transaction = getTransaction()
        applyOptimistic(transaction, variables, transaction !== previous)
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
      applyOptimistic(dropped, variables, true)
      dropped.rollback({
        error:
          strategy._type === `debounce`
            ? new DebounceCallDroppedError()
            : new ThrottleCallDroppedError(),
        isSecondaryRollback: true,
      })
      return dropped
    }

    const previous = activeTransaction
    const transaction = getTransaction(strategy._type === `queue`)
    applyOptimistic(transaction, variables, transaction !== previous)
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

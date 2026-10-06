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
  const serializePersistence =
    strategy._type === `debounce` || strategy._type === `throttle`

  // The currently active transaction (pending, not yet persisting)
  let activeTransaction: Transaction<T> | null = null
  let persistingTransaction: Transaction<T> | null = null
  let mutationRevision = 0
  let eligibleRevision: number | null = null
  let authoringDepth = 0

  const persistEligible = () => {
    if (
      authoringDepth === 0 &&
      !persistingTransaction &&
      eligibleRevision === mutationRevision &&
      activeTransaction?.state === `pending`
    ) {
      eligibleRevision = null
      commitCallback(mutationRevision)
    }
  }

  const onPersistenceFinished = () => {
    persistingTransaction = null
    persistEligible()
  }

  // Commit callback that the strategy will call when it's time to persist
  const commitCallback = (revision: number): Transaction<T> => {
    if (!activeTransaction) {
      throw new Error(
        `Strategy callback called but no active transaction exists. This indicates a bug in the strategy implementation.`,
      )
    }

    if (activeTransaction.state !== `pending`) {
      // A caller may cancel a pending group before its scheduled edge.
      if (activeTransaction.state === `failed`) return activeTransaction
      throw new Error(
        `Strategy callback called but active transaction is in state "${activeTransaction.state}". Expected "pending".`,
      )
    }

    // A timer can expire while an earlier write is still in flight. Keep the
    // pending group optimistic until that callback returns; a later mutation
    // can move the timer edge and invalidate this eligibility.
    if (serializePersistence && (persistingTransaction || authoringDepth > 0)) {
      eligibleRevision = revision
      return activeTransaction
    }

    const txToCommit = activeTransaction
    // Update throttle's clock before mutationFn can synchronously reenter
    // mutate(); that call must see this transaction's actual start time.
    if (strategy._type === `throttle`) strategy.onPersistenceStart?.()

    // Clear active transaction reference before committing
    activeTransaction = null
    if (serializePersistence) {
      persistingTransaction = txToCommit
    }

    // Receipt settlement can precede a held mutationFn when callers roll back
    // a persisting transaction. Release the persistence slot only when the
    // callback itself returns.
    void txToCommit.commit().then(
      () => {
        if (serializePersistence) onPersistenceFinished()
      },
      () => {
        if (serializePersistence) onPersistenceFinished()
      },
    )

    return txToCommit
  }

  /**
   * Executes a mutation with the given variables. Creates a new transaction if none is active,
   * or adds to the existing active transaction. The strategy controls when
   * the transaction is actually committed.
   */
  function mutate(variables: TVariables): Transaction<T> {
    const pendingTransaction =
      activeTransaction?.state === `pending` ? activeTransaction : null
    const txToReturn =
      pendingTransaction ??
      createTransaction<T>({
        ...transactionConfig,
        mutationFn,
        autoCommit: false,
      })
    activeTransaction = txToReturn

    if (
      pendingTransaction &&
      serializePersistence &&
      strategy.willDropCall?.()
    ) {
      // Apply a skipped call in its own transaction. An earlier admitted
      // pending group must keep its mutations and receipt when this one rolls
      // back. Run onMutate before changing the strategy's timer, so a throw
      // cannot consume an edge.
      const dropped = createTransaction<T>({
        ...transactionConfig,
        mutationFn,
        autoCommit: false,
      })
      dropped.mutate(() => onMutate(variables))
      // A throttle drop is decided at call admission. A synchronous onMutate
      // can cross the wall-clock window, but a dropped throttle call does not
      // change its timer, so there is nothing to execute after that callback.
      const executed =
        strategy._type === `throttle` ? false : strategy.execute(() => dropped)
      if (executed !== false) {
        const error = new Error(
          `Strategy drop prediction changed during mutate`,
        )
        dropped.rollback({ error, isSecondaryRollback: true })
        throw error
      }
      dropped.rollback({
        error:
          strategy._type === `debounce`
            ? new DebounceCallDroppedError()
            : new ThrottleCallDroppedError(),
        isSecondaryRollback: true,
      })
      return dropped
    }

    // A nested paced call may schedule or even commit this same pending group.
    // Its later admission owns the next strategy edge.
    const revisionBeforeMutate = mutationRevision
    // Execute onMutate with variables to apply optimistic updates
    const reentersActiveTransaction =
      serializePersistence &&
      authoringDepth > 0 &&
      pendingTransaction === txToReturn
    authoringDepth++
    try {
      // The outer tx.mutate scope is already open. Registering the same
      // transaction again would unregister that outer scope on return.
      if (reentersActiveTransaction) onMutate(variables)
      else txToReturn.mutate(() => onMutate(variables))
    } finally {
      authoringDepth--
      if (
        serializePersistence &&
        authoringDepth === 0 &&
        mutationRevision !== revisionBeforeMutate
      ) {
        persistEligible()
      }
    }
    if (serializePersistence && mutationRevision !== revisionBeforeMutate) {
      return txToReturn
    }
    const revision = ++mutationRevision
    eligibleRevision = null

    // For queue strategy, pass a function that commits txToReturn
    // This prevents the error when commitCallback tries to access the cleared activeTransaction
    if (strategy._type === `queue`) {
      activeTransaction = null // Clear so next mutation creates a new transaction
      let admitted: ReturnType<typeof strategy.execute>
      try {
        admitted = strategy.execute(() => {
          txToReturn.commit().catch(() => {
            // Errors are handled via transaction.isPersisted.promise
          })
          return txToReturn
        })
      } catch (error) {
        if (!(error instanceof QueueDisposedError)) throw error
        txToReturn.rollback({ error, isSecondaryRollback: true })
        return txToReturn
      }
      if (admitted === false) {
        // Admission failure belongs to this call; admitted same-key writes
        // must remain in the queue and keep their optimistic state.
        txToReturn.rollback({
          error: new QueueCapacityExceededError(),
          isSecondaryRollback: true,
        })
      }
    } else {
      // Debounce/throttle share pending work until commitCallback runs. With
      // trailing disabled, a skipped optimistic call must be rejected.
      const executed = strategy.execute(() => commitCallback(revision))
      if (
        (strategy._type === `debounce` || strategy._type === `throttle`) &&
        executed === false
      ) {
        txToReturn.rollback({
          error:
            strategy._type === `debounce`
              ? new DebounceCallDroppedError()
              : new ThrottleCallDroppedError(),
          isSecondaryRollback: true,
        })
        activeTransaction = null
      }
    }

    return txToReturn
  }

  return mutate
}

import type { Transaction } from '../transactions'

/**
 * Options for individual mutation execution
 */
export interface MutationExecuteOptions {
  /**
   * Transaction(s) that must be persisted before this mutation can execute.
   * This enables cross-queue dependencies where a mutation in one queue
   * can wait for a transaction from another queue to complete.
   *
   * @example
   * ```ts
   * // Queue B waits for transaction from Queue A
   * const txA = queueA.mutate({ name: 'Parent Item' })
   * const txB = queueB.mutate(
   *   { parentId: tempId },
   *   { dependsOn: txA }
   * )
   * ```
   */
  dependsOn?: Transaction<any> | Array<Transaction<any>>
}

/**
 * Base strategy interface that all strategy implementations must conform to
 */
export interface BaseStrategy<TName extends string = string> {
  /** Type discriminator for strategy identification */
  _type: TName

  /**
   * Execute a function according to the strategy's timing rules
   * @param fn - The function to execute
   * @param options - Optional execution options including dependencies
   * @returns The result of the function execution (if applicable)
   */
  execute: <T extends object = Record<string, unknown>>(
    fn: () => Transaction<T>,
    options?: MutationExecuteOptions,
  ) => void | Promise<void>

  /**
   * Clean up any resources held by the strategy
   * Should be called when the strategy is no longer needed
   */
  cleanup: () => void
}

/**
 * Options for debounce strategy
 * Delays execution until after a period of inactivity
 */
export interface DebounceStrategyOptions {
  /** Wait time in milliseconds before execution */
  wait: number
  /** Execute immediately on the first call */
  leading?: boolean
  /** Execute after the wait period on the last call */
  trailing?: boolean
}

/**
 * Debounce strategy that delays execution until activity stops
 */
export interface DebounceStrategy extends BaseStrategy<`debounce`> {
  options: DebounceStrategyOptions
}

/**
 * Options for queue strategy
 * Processes all executions in order (FIFO/LIFO)
 */
export interface QueueStrategyOptions {
  /** Wait time between processing queue items (milliseconds) */
  wait?: number
  /** Maximum queue size (items are dropped if exceeded) */
  maxSize?: number
  /** Where to add new items in the queue */
  addItemsTo?: `front` | `back`
  /** Where to get items from when processing */
  getItemsFrom?: `front` | `back`
}

/**
 * Queue strategy that processes all executions in order
 * FIFO: { addItemsTo: 'back', getItemsFrom: 'front' }
 * LIFO: { addItemsTo: 'back', getItemsFrom: 'back' }
 */
export interface QueueStrategy extends BaseStrategy<`queue`> {
  options?: QueueStrategyOptions
}

/**
 * Options for throttle strategy
 * Ensures executions are evenly spaced over time
 */
export interface ThrottleStrategyOptions {
  /** Minimum wait time between executions (milliseconds) */
  wait: number
  /** Execute immediately on the first call */
  leading?: boolean
  /** Execute on the last call after wait period */
  trailing?: boolean
}

/**
 * Throttle strategy that spaces executions evenly over time
 */
export interface ThrottleStrategy extends BaseStrategy<`throttle`> {
  options: ThrottleStrategyOptions
}

/**
 * Options for batch strategy
 * Groups multiple executions together
 */
export interface BatchStrategyOptions {
  /** Maximum items per batch */
  maxSize?: number
  /** Maximum wait time before processing batch (milliseconds) */
  wait?: number
  /** Custom logic to determine when to execute batch */
  getShouldExecute?: (items: Array<any>) => boolean
}

/**
 * Batch strategy that groups multiple executions together
 */
export interface BatchStrategy extends BaseStrategy<`batch`> {
  options?: BatchStrategyOptions
}

/**
 * Union type of all available strategies
 */
export type Strategy =
  | DebounceStrategy
  | QueueStrategy
  | ThrottleStrategy
  | BatchStrategy

/**
 * Extract the options type from a strategy
 */
export type StrategyOptions<T extends Strategy> = T extends DebounceStrategy
  ? DebounceStrategyOptions
  : T extends QueueStrategy
    ? QueueStrategyOptions
    : T extends ThrottleStrategy
      ? ThrottleStrategyOptions
      : T extends BatchStrategy
        ? BatchStrategyOptions
        : never

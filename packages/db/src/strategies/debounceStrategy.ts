import { Debouncer } from "@tanstack/pacer/debouncer"
import type { DebounceStrategy, DebounceStrategyOptions } from "./types"
import type { Transaction } from "../transactions"

/**
 * Creates a debounce strategy that delays transaction execution until after
 * a period of inactivity.
 *
 * Ideal for scenarios like search inputs or auto-save fields where you want
 * to wait for the user to stop typing before persisting changes.
 *
 * @param options - Configuration for the debounce behavior
 * @returns A debounce strategy instance
 *
 * @example
 * ```ts
 * const mutate = useSerializedTransaction({
 *   mutationFn: async ({ transaction }) => {
 *     await api.save(transaction.mutations)
 *   },
 *   strategy: debounceStrategy({ wait: 500 })
 * })
 * ```
 */
export function debounceStrategy(
  options: DebounceStrategyOptions
): DebounceStrategy {
  const debouncer = new Debouncer(
    (callback: () => Transaction) => callback(),
    options
  )

  return {
    _type: `debounce`,
    options,
    execute: <T extends object = Record<string, unknown>>(
      fn: () => Transaction<T>
    ) => {
      debouncer.maybeExecute(fn as () => Transaction)
    },
    cleanup: () => {
      debouncer.cancel()
    },
  }
}

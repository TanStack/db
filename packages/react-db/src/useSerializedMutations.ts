import { useCallback, useEffect, useMemo } from "react"
import { createSerializedMutations } from "@tanstack/db"
import type { SerializedMutationsConfig, Transaction } from "@tanstack/db"

/**
 * React hook for managing serialized mutations with timing strategies.
 *
 * Provides optimistic mutations with pluggable strategies like debouncing,
 * queuing, or throttling. Each call to `mutate` creates mutations that are
 * auto-merged and persisted according to the strategy.
 *
 * @param config - Configuration including mutationFn and strategy
 * @returns A mutate function that executes mutations and returns Transaction objects
 *
 * @example
 * ```tsx
 * // Debounced auto-save
 * function AutoSaveForm() {
 *   const mutate = useSerializedMutations({
 *     mutationFn: async ({ transaction }) => {
 *       await api.save(transaction.mutations)
 *     },
 *     strategy: debounceStrategy({ wait: 500 })
 *   })
 *
 *   const handleChange = async (value: string) => {
 *     const tx = mutate(() => {
 *       formCollection.update(formId, draft => {
 *         draft.content = value
 *       })
 *     })
 *
 *     // Optional: await persistence or handle errors
 *     try {
 *       await tx.isPersisted.promise
 *       console.log('Saved!')
 *     } catch (error) {
 *       console.error('Save failed:', error)
 *     }
 *   }
 *
 *   return <textarea onChange={e => handleChange(e.target.value)} />
 * }
 * ```
 *
 * @example
 * ```tsx
 * // Throttled slider updates
 * function VolumeSlider() {
 *   const mutate = useSerializedMutations({
 *     mutationFn: async ({ transaction }) => {
 *       await api.updateVolume(transaction.mutations)
 *     },
 *     strategy: throttleStrategy({ wait: 200 })
 *   })
 *
 *   const handleVolumeChange = (volume: number) => {
 *     mutate(() => {
 *       settingsCollection.update('volume', draft => {
 *         draft.value = volume
 *       })
 *     })
 *   }
 *
 *   return <input type="range" onChange={e => handleVolumeChange(+e.target.value)} />
 * }
 * ```
 *
 * @example
 * ```tsx
 * // Debounce with leading/trailing for color picker (persist first + final only)
 * function ColorPicker() {
 *   const mutate = useSerializedMutations({
 *     mutationFn: async ({ transaction }) => {
 *       await api.updateTheme(transaction.mutations)
 *     },
 *     strategy: debounceStrategy({ wait: 0, leading: true, trailing: true })
 *   })
 *
 *   return (
 *     <input
 *       type="color"
 *       onChange={e => {
 *         mutate(() => {
 *           themeCollection.update('primary', draft => {
 *             draft.color = e.target.value
 *           })
 *         })
 *       }}
 *     />
 *   )
 * }
 * ```
 */
export function useSerializedMutations<
  T extends object = Record<string, unknown>,
>(
  config: SerializedMutationsConfig<T>
): (callback: () => void) => Transaction<T> {
  // Create serialized mutations instance with proper dependency tracking
  const { mutate, cleanup } = useMemo(() => {
    return createSerializedMutations<T>(config)
    // Include all config properties in dependencies
    // Strategy changes will recreate the instance
  }, [config.mutationFn, config.metadata, config.strategy, config.id])

  // Cleanup on unmount or when dependencies change
  useEffect(() => {
    return () => cleanup()
  }, [cleanup])

  // Return stable mutate callback
  const stableMutate = useCallback(mutate, [mutate])

  return stableMutate
}

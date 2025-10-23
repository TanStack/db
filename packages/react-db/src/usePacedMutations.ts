import { useCallback, useMemo, useRef } from "react"
import { createPacedMutations } from "@tanstack/db"
import type { PacedMutationsConfig, Transaction } from "@tanstack/db"

/**
 * React hook for managing paced mutations with timing strategies.
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
 *   const mutate = usePacedMutations({
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
 *   const mutate = usePacedMutations({
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
 *   const mutate = usePacedMutations({
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
export function usePacedMutations<T extends object = Record<string, unknown>>(
  config: PacedMutationsConfig<T>
): (callback: () => void) => Transaction<T> {
  // Keep a ref to the latest mutationFn so we can call it without recreating the instance
  const mutationFnRef = useRef(config.mutationFn)
  mutationFnRef.current = config.mutationFn

  // Create a stable wrapper around mutationFn that always calls the latest version
  const stableMutationFn = useCallback<typeof config.mutationFn>((params) => {
    return mutationFnRef.current(params)
  }, [])

  // Create paced mutations instance with proper dependency tracking
  // Serialize strategy for stable comparison since strategy objects are recreated on each render
  const { mutate } = useMemo(() => {
    return createPacedMutations<T>({
      ...config,
      mutationFn: stableMutationFn,
    })
  }, [
    stableMutationFn,
    config.metadata,
    // Serialize strategy to avoid recreating when object reference changes but values are same
    JSON.stringify({
      type: config.strategy._type,
      options: config.strategy.options,
    }),
  ])

  // Return stable mutate callback
  const stableMutate = useCallback(mutate, [mutate])

  return stableMutate
}

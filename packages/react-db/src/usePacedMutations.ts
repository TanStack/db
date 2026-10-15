import { useCallback, useInsertionEffect, useMemo, useRef } from 'react'
import { createPacedMutations } from '@tanstack/db'
import type { PacedMutationsConfig, Transaction } from '@tanstack/db'

/**
 * React hook for managing paced mutations with timing strategies.
 *
 * Provides optimistic mutations with pluggable strategies like debouncing,
 * queuing, or throttling. The optimistic updates are applied immediately via
 * `onMutate`, and the actual persistence is controlled by the strategy.
 * Callbacks follow the latest committed render, so a suspended render cannot
 * replace the callbacks used by active mutations.
 *
 * @param config - Configuration including onMutate, mutationFn and strategy
 * @returns A mutate function that accepts variables and returns Transaction objects
 *
 * @example
 * ```tsx
 * // Debounced auto-save
 * function AutoSaveForm({ formId }: { formId: string }) {
 *   const mutate = usePacedMutations<string>({
 *     onMutate: (value) => {
 *       // Apply optimistic update immediately
 *       formCollection.update(formId, draft => {
 *         draft.content = value
 *       })
 *     },
 *     mutationFn: async ({ transaction }) => {
 *       await api.save(transaction.mutations)
 *     },
 *     strategy: debounceStrategy({ wait: 500 })
 *   })
 *
 *   const handleChange = async (value: string) => {
 *     const tx = mutate(value)
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
 *   const mutate = usePacedMutations<number>({
 *     onMutate: (volume) => {
 *       settingsCollection.update('volume', draft => {
 *         draft.value = volume
 *       })
 *     },
 *     mutationFn: async ({ transaction }) => {
 *       await api.updateVolume(transaction.mutations)
 *     },
 *     strategy: throttleStrategy({ wait: 200 })
 *   })
 *
 *   return <input type="range" onChange={e => mutate(+e.target.value)} />
 * }
 * ```
 *
 * @example
 * ```tsx
 * // Debounce with leading/trailing for color picker (persist first + final only)
 * function ColorPicker() {
 *   const mutate = usePacedMutations<string>({
 *     onMutate: (color) => {
 *       themeCollection.update('primary', draft => {
 *         draft.color = color
 *       })
 *     },
 *     mutationFn: async ({ transaction }) => {
 *       await api.updateTheme(transaction.mutations)
 *     },
 *     strategy: debounceStrategy({ wait: 0, leading: true, trailing: true })
 *   })
 *
 *   return (
 *     <input
 *       type="color"
 *       onChange={e => mutate(e.target.value)}
 *     />
 *   )
 * }
 * ```
 */
export function usePacedMutations<
  TVariables = unknown,
  T extends object = Record<string, unknown>,
>(
  config: PacedMutationsConfig<TVariables, T>,
): (variables: TVariables) => Transaction<T> {
  // Publish callbacks only for committed renders, before descendant layout
  // effects can mutate. Updating during render leaks suspended callbacks.
  const onMutateRef = useRef(config.onMutate)
  const mutationFnRef = useRef(config.mutationFn)

  useInsertionEffect(() => {
    onMutateRef.current = config.onMutate
    mutationFnRef.current = config.mutationFn
  }, [config.onMutate, config.mutationFn])

  // Create stable wrappers that always call the latest version
  const stableOnMutate = useCallback<typeof config.onMutate>((variables) => {
    return onMutateRef.current(variables)
  }, [])

  const stableMutationFn = useCallback<typeof config.mutationFn>((params) => {
    return mutationFnRef.current(params)
  }, [])

  // Create paced mutations instance with proper dependency tracking
  // Serialize strategy for stable comparison since strategy objects are recreated on each render
  const mutate = useMemo(() => {
    return createPacedMutations<TVariables, T>({
      ...config,
      onMutate: stableOnMutate,
      mutationFn: stableMutationFn,
    })
  }, [
    stableOnMutate,
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

import { useCallback, useMemo, useRef } from 'octane'
import { createPacedMutations } from '@tanstack/db'
import { splitTrailingSlot, subSlot } from './slot'
import type { PacedMutationsConfig, Transaction } from '@tanstack/db'

/**
 * React hook for managing paced mutations with timing strategies.
 *
 * Provides optimistic mutations with pluggable strategies like debouncing,
 * queuing, or throttling. The optimistic updates are applied immediately via
 * `onMutate`, and the actual persistence is controlled by the strategy.
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
  ...rest: Array<unknown>
): (variables: TVariables) => Transaction<T> {
  const [, slot] = splitTrailingSlot(rest)

  // Keep refs to the latest callbacks so we can call them without recreating the instance
  const onMutateRef = useRef(config.onMutate, subSlot(slot, `on-mutate-ref`))
  onMutateRef.current = config.onMutate

  const mutationFnRef = useRef(
    config.mutationFn,
    subSlot(slot, `mutation-fn-ref`),
  )
  mutationFnRef.current = config.mutationFn

  // Create stable wrappers that always call the latest version
  const stableOnMutate = useCallback<typeof config.onMutate>(
    (variables) => {
      return onMutateRef.current(variables)
    },
    [],
    subSlot(slot, `on-mutate-cb`),
  )

  const stableMutationFn = useCallback<typeof config.mutationFn>(
    (params) => {
      return mutationFnRef.current(params)
    },
    [],
    subSlot(slot, `mutation-fn-cb`),
  )

  // Create paced mutations instance with proper dependency tracking
  // Serialize strategy for stable comparison since strategy objects are recreated on each render
  const mutate = useMemo(
    () => {
      return createPacedMutations<TVariables, T>({
        ...config,
        onMutate: stableOnMutate,
        mutationFn: stableMutationFn,
      })
    },
    [
      stableOnMutate,
      stableMutationFn,
      config.metadata,
      // Serialize strategy to avoid recreating when object reference changes but values are same
      JSON.stringify({
        type: config.strategy._type,
        options: config.strategy.options,
      }),
    ],
    subSlot(slot, `mutate-memo`),
  )

  // Return stable mutate callback
  const stableMutate = useCallback(mutate, [mutate], subSlot(slot, `mutate-cb`))

  return stableMutate
}

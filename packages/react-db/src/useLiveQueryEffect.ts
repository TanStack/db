import { useEffect, useRef } from 'react'
import { createEffect } from '@tanstack/db'
import type { Effect, EffectConfig } from '@tanstack/db'

/**
 * React hook for creating a reactive effect that fires handlers when rows
 * enter, exit, or update within a query result.
 *
 * The effect is created on mount and disposed on unmount. If `deps` change,
 * the previous effect is disposed and a new one is created.
 *
 * @example
 * ```tsx
 * function ChatComponent() {
 *   useLiveQueryEffect(
 *     {
 *       query: (q) => q.from({ msg: messages }).where(({ msg }) => eq(msg.role, 'user')),
 *       on: 'enter',
 *       skipInitial: true,
 *       handler: async (event) => {
 *         await generateResponse(event.value)
 *       },
 *     },
 *     []
 *   )
 *
 *   return <div>...</div>
 * }
 * ```
 */
export function useLiveQueryEffect<
  TRow extends object = Record<string, unknown>,
  TKey extends string | number = string | number,
>(
  config: EffectConfig<TRow, TKey>,
  deps: React.DependencyList = [],
): void {
  const effectRef = useRef<Effect | null>(null)

  useEffect(() => {
    effectRef.current = createEffect(config)
    return () => {
      // Fire-and-forget disposal; AbortSignal cancels in-flight work
      effectRef.current?.dispose()
      effectRef.current = null
    }
  }, deps)
}

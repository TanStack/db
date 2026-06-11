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
 *       skipInitial: true,
 *       onEnter: async (event) => {
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
>(config: EffectConfig<TRow, TKey>, deps: React.DependencyList = []): void {
  const configRef = useRef<EffectConfig<TRow, TKey>>(config)
  configRef.current = config

  useEffect(() => {
    const effect: Effect = createEffect<TRow, TKey>({
      id: config.id,
      query: config.query,
      skipInitial: config.skipInitial,
      onEnter: (event, ctx) => configRef.current.onEnter?.(event, ctx),
      onUpdate: (event, ctx) => configRef.current.onUpdate?.(event, ctx),
      onExit: (event, ctx) => configRef.current.onExit?.(event, ctx),
      onBatch: (events, ctx) => configRef.current.onBatch?.(events, ctx),
      onError: config.onError
        ? (error, event) => configRef.current.onError?.(error, event)
        : undefined,
      onSourceError: config.onSourceError
        ? (error) => configRef.current.onSourceError?.(error)
        : undefined,
    })

    return () => {
      // Fire-and-forget disposal; AbortSignal cancels in-flight work
      effect.dispose()
    }
  }, deps)
}

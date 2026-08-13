import { enableExternalSource } from 'solid-js'
import type { LiveQuerySnapshot } from '@tanstack/db'

type AnyObserver = {
  getSnapshot: () => LiveQuerySnapshot<any, any>
  subscribe: (listener: () => void) => () => void
}

type SnapshotOf<O> = O extends { getSnapshot: () => infer S } ? S : never

type ObserverEntry = {
  triggers: Set<() => void>
  unsubscribe: () => void
}

let installed = false

let activeTrigger: (() => void) | null = null

const observerEntries = new Map<AnyObserver, ObserverEntry>()

const triggerObservers = new Map<() => void, Set<AnyObserver>>()

function detachTrigger(observer: AnyObserver, trigger: () => void): void {
  const entry = observerEntries.get(observer)
  if (!entry) return
  entry.triggers.delete(trigger)
  if (entry.triggers.size === 0) {
    entry.unsubscribe()
    observerEntries.delete(observer)
  }
}

/**
 * Install the Solid v2 external-source bridge for TanStack DB observers.
 *
 * Call **once** at application startup, before any `useLiveQuery` hooks or
 * `createLiveQueryObserver` calls. After installation, {@link trackSnapshot}
 * reads inside any Solid compute (memo, effect, component body) automatically
 * subscribe to the observer and re-run when the snapshot changes — no manual
 * `subscribe`/`onCleanup` wiring required.
 *
 * Uses Solid v2's `enableExternalSource` to wrap every computation so the
 * bridge can track which observer each compute depends on.
 *
 * @example
 * ```ts
 * // App entry point (once):
 * import { enableSolidDBExternalSource } from '@tanstack/solid-db'
 * enableSolidDBExternalSource()
 *
 * // In any component or memo:
 * const snapshot = createMemo(() => {
 *   const observer = createLiveQueryObserver(collection, { mode: 'wholesale' })
 *   return trackSnapshot(observer)
 * })
 * ```
 */
export function enableSolidDBExternalSource(): void {
  if (installed) return
  installed = true

  enableExternalSource({
    factory: (compute, trigger) => {
      return {
        track: (prev: unknown) => {
          const prevDeps = triggerObservers.get(trigger)
          if (prevDeps) {
            for (const obs of prevDeps) {
              detachTrigger(obs, trigger)
            }
          }
          triggerObservers.set(trigger, new Set())

          const prevTrigger = activeTrigger
          activeTrigger = trigger
          try {
            return compute(prev)
          } finally {
            activeTrigger = prevTrigger
          }
        },
        dispose: () => {
          const deps = triggerObservers.get(trigger)
          if (deps) {
            for (const obs of deps) {
              detachTrigger(obs, trigger)
            }
            triggerObservers.delete(trigger)
          }
        },
      }
    },
    untrack: <T>(fn: () => T): T => {
      const prev = activeTrigger
      activeTrigger = null
      try {
        return fn()
      } finally {
        activeTrigger = prev
      }
    },
  })
}

/**
 * Read a LiveQueryObserver snapshot with automatic Solid dependency tracking.
 *
 * Requires {@link enableSolidDBExternalSource} to have been called first.
 * Inside a Solid compute (memo, effect, component), this registers the
 * observer as a dependency so the compute re-runs when the observer notifies.
 *
 * Outside a Solid tracking scope, this is equivalent to `observer.getSnapshot()`.
 */
export function trackSnapshot<O extends AnyObserver>(
  observer: O,
): SnapshotOf<O> {
  if (activeTrigger) {
    let entry = observerEntries.get(observer)
    if (!entry) {
      const triggers = new Set<() => void>()
      const unsubscribe = observer.subscribe(() => {
        for (const t of triggers) t()
      })
      entry = { triggers, unsubscribe }
      observerEntries.set(observer, entry)
    }
    entry.triggers.add(activeTrigger)
    triggerObservers.get(activeTrigger)?.add(observer)
  }
  return observer.getSnapshot() as SnapshotOf<O>
}

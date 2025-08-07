export type DevtoolsEventName =
  | "collectionRegistered"
  | "collectionUpdated"
  | "collectionUnregistered"
  | "transactionsUpdated"

export type DevtoolsEventPayloads = {
  collectionRegistered: { id: string }
  collectionUpdated: { id: string }
  collectionUnregistered: { id: string }
  transactionsUpdated: { collectionId: string }
}

export type DevtoolsEventListener<K extends DevtoolsEventName> = (
  payload: DevtoolsEventPayloads[K]
) => void

interface DevtoolsEventBus {
  on: <K extends DevtoolsEventName>(
    name: K,
    listener: DevtoolsEventListener<K>
  ) => void
  off: <K extends DevtoolsEventName>(
    name: K,
    listener: DevtoolsEventListener<K>
  ) => void
  emit: <K extends DevtoolsEventName>(
    name: K,
    payload: DevtoolsEventPayloads[K]
  ) => void
}

function ensureGlobalBus(): DevtoolsEventBus {
  const g = globalThis as any
  if (!g.__TANSTACK_DB_DEVTOOLS_EVENTS__) {
    const listeners = new Map<DevtoolsEventName, Set<Function>>()
    g.__TANSTACK_DB_DEVTOOLS_EVENTS__ = {
      on: (name: DevtoolsEventName, listener: Function) => {
        const set = listeners.get(name) ?? new Set()
        set.add(listener)
        listeners.set(name, set as Set<Function>)
      },
      off: (name: DevtoolsEventName, listener: Function) => {
        const set = listeners.get(name)
        if (set) {
          set.delete(listener)
        }
      },
      emit: (name: DevtoolsEventName, payload: unknown) => {
        const set = listeners.get(name)
        if (set) {
          for (const fn of set) {
            try {
              fn(payload)
            } catch {
              // ignore listener errors
            }
          }
        }
      },
    } satisfies DevtoolsEventBus
  }
  return g.__TANSTACK_DB_DEVTOOLS_EVENTS__ as DevtoolsEventBus
}

export function emitDevtoolsEvent<K extends DevtoolsEventName>(
  name: K,
  payload: DevtoolsEventPayloads[K]
): void {
  ensureGlobalBus().emit(name, payload)
}

export function onDevtoolsEvent<K extends DevtoolsEventName>(
  name: K,
  listener: DevtoolsEventListener<K>
): () => void {
  const bus = ensureGlobalBus()
  bus.on(name, listener as any)
  return () => bus.off(name, listener as any)
}
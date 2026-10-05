/** The local-restore boundary of one opted-in persisted Collection. */
export type PersistedReadinessSnapshot =
  | { status: `loading`; error?: never }
  | { status: `ready`; error?: never }
  | { status: `error`; error: unknown }

/** @internal Capability supplied by a persistence adapter, not by core sync. */
export interface PersistedReadinessSource {
  /** Time to prefer network before a completed persisted restore may render. */
  networkTimeoutMs: number
  /** Anchor the deadline to this Collection's current sync run. */
  getOrStartNetworkDeadline: () => number
  getSnapshot: () => PersistedReadinessSnapshot
  subscribe: (listener: () => void) => () => void
}

/** @internal Config capability shared with first-party persistence adapters. */
export const PERSISTED_READINESS = Symbol.for(`@tanstack/db.persistedReadiness`)

export function getPersistedReadinessSource(
  config: object,
): PersistedReadinessSource | undefined {
  return (config as { [PERSISTED_READINESS]?: PersistedReadinessSource })[
    PERSISTED_READINESS
  ]
}

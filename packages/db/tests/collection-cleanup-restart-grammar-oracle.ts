// The failing-dependents history grammar of the Collection cleanup oracle,
// moved unchanged from collection-cleanup-restart-oracle.test.ts so that the
// ordinary grammar test in collection-cleanup-restart.test.ts can import it.
// The oracle's "Cleanup with failing dependents" section describes it.

export type DependentEnd =
  | `resolve`
  | `throw`
  | `reject`
  | `held-resolve`
  | `held-reject`
  | `pooled-throw`
export type AdapterCleanup = `sync` | `held-resolve` | `held-reject`
export type DependentCleanupCell = {
  id: string
  ends: readonly [DependentEnd, DependentEnd]
  adapter: AdapterCleanup
  // Which side the driver releases first when both hold.
  adapterFirst: boolean
}

export const dependentEnds: ReadonlyArray<DependentEnd> = [
  `resolve`,
  `throw`,
  `reject`,
  `held-resolve`,
  `held-reject`,
  `pooled-throw`,
]
export const adapterCleanups: ReadonlyArray<AdapterCleanup> = [
  `sync`,
  `held-resolve`,
  `held-reject`,
]
export const holds = (behavior: string) => behavior.startsWith(`held`)
export const dependentCleanupCells: ReadonlyArray<DependentCleanupCell> =
  dependentEnds.flatMap((first) =>
    dependentEnds.flatMap((second) =>
      adapterCleanups.flatMap((adapter) =>
        (holds(adapter) && (holds(first) || holds(second))
          ? [false, true]
          : [false]
        ).map((adapterFirst) => ({
          id: `${first}+${second}:${adapter}${adapterFirst ? `:adapter-first` : ``}`,
          ends: [first, second] as const,
          adapter,
          adapterFirst,
        })),
      ),
    ),
  )

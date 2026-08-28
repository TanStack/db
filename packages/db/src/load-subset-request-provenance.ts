export type SyncRequestProvenance = Readonly<{
  hasOrdinarySource: boolean
  requestSignals: ReadonlySet<AbortSignal>
}>

const requestProvenance = new WeakMap<object, SyncRequestProvenance>()
const parentSignals = new WeakMap<AbortSignal, Set<AbortSignal>>()

/** Attach every source that produced the change's final row version. */
export function setSyncRequestProvenance(
  change: object,
  provenance: SyncRequestProvenance | undefined,
): void {
  if (provenance !== undefined) requestProvenance.set(change, provenance)
}

/** Preserve internal request provenance when a change is enriched for readers. */
export function copySyncRequestProvenance(
  source: object,
  target: object,
): void {
  setSyncRequestProvenance(target, requestProvenance.get(source))
}

/** Read the sources that produced the change's final row version. */
export function getSyncRequestProvenance(
  change: object,
): SyncRequestProvenance | undefined {
  return requestProvenance.get(change)
}

/** Record that shared physical work is owned by one logical request signal. */
export function attachLoadSubsetRequestSignal(
  physicalSignal: AbortSignal | undefined,
  logicalSignal: AbortSignal | undefined,
): void {
  if (
    physicalSignal === undefined ||
    logicalSignal === undefined ||
    physicalSignal === logicalSignal
  ) {
    return
  }
  let parents = parentSignals.get(physicalSignal)
  if (parents === undefined) {
    parents = new Set()
    parentSignals.set(physicalSignal, parents)
  }
  parents.add(logicalSignal)
}

/** Test exact signal identity through any nested shared-request wrappers. */
export function isLoadSubsetRequestSignalFor(
  physicalSignal: AbortSignal,
  logicalSignal: AbortSignal,
): boolean {
  const pending = [physicalSignal]
  const visited = new Set<AbortSignal>()
  while (pending.length > 0) {
    const signal = pending.pop()!
    if (signal === logicalSignal) return true
    if (visited.has(signal)) continue
    visited.add(signal)
    const parents = parentSignals.get(signal)
    if (parents !== undefined) pending.push(...parents)
  }
  return false
}

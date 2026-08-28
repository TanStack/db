const requestSignals = new WeakMap<object, AbortSignal>()
const parentSignals = new WeakMap<AbortSignal, Set<AbortSignal>>()

/** Attach the exact physical request whose commit produced an internal change. */
export function setSyncRequestSignal(
  change: object,
  signal: AbortSignal | undefined,
): void {
  if (signal !== undefined) requestSignals.set(change, signal)
}

/** Preserve internal request provenance when a change is enriched for readers. */
export function copySyncRequestSignal(source: object, target: object): void {
  setSyncRequestSignal(target, requestSignals.get(source))
}

/** Read the exact physical request whose commit produced an internal change. */
export function getSyncRequestSignal(change: object): AbortSignal | undefined {
  return requestSignals.get(change)
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

const requestSignals = new WeakMap<object, AbortSignal>()

/** Attach the exact request whose commit produced an internal change. */
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

/** Read the exact request whose commit produced an internal change. */
export function getSyncRequestSignal(change: object): AbortSignal | undefined {
  return requestSignals.get(change)
}

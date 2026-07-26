const subSlotCache = new Map<symbol, Map<string, symbol>>()

/**
 * Derive a stable sub-slot from a wrapper's compiler-injected slot so nested
 * Octane hooks inside a custom hook each get distinct call-site identity.
 */
export function subSlot(
  slot: symbol | undefined,
  tag: string,
): symbol | undefined {
  if (slot === undefined) return undefined
  let byTag = subSlotCache.get(slot)
  if (byTag === undefined) subSlotCache.set(slot, (byTag = new Map()))
  let sym = byTag.get(tag)
  if (sym === undefined) {
    sym = Symbol.for(`${slot.description ?? ``}:${tag}`)
    byTag.set(tag, sym)
  }
  return sym
}

/** Split a compiler-injected trailing slot symbol off hook runtime args. */
export function splitTrailingSlot<T extends Array<unknown>>(
  args: T,
): [Array<unknown>, symbol | undefined] {
  const tail = args[args.length - 1]
  const slot = typeof tail === `symbol` ? (tail) : undefined
  return [slot !== undefined ? args.slice(0, -1) : args, slot]
}

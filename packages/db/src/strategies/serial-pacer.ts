/**
 * Eligible transactions wait behind current persistence. A new callback for
 * the same transaction replaces its pending work; distinct transactions from
 * managers sharing one strategy retain their own callbacks. `wait` bounds
 * actual starts independently of a strategy's admission timer.
 */
export function createSerialPacer(wait: number) {
  const pending = new Map<object, () => Promise<unknown>>()
  const defaultOwner = {}
  let persisting = false
  let nextStartAt = Number.NEGATIVE_INFINITY
  let timeout: ReturnType<typeof setTimeout> | undefined

  function drain(): void {
    if (persisting || pending.size === 0) return
    const delay = nextStartAt - Date.now()
    if (delay > 0) {
      timeout ??= setTimeout(() => {
        timeout = undefined
        drain()
      }, delay)
      return
    }
    const [owner, callback] = pending.entries().next().value!
    pending.delete(owner)
    persisting = true
    nextStartAt = Date.now() + wait
    try {
      void callback().then(settled, settled)
    } catch (error) {
      persisting = false
      queueMicrotask(drain)
      throw error
    }
  }

  function settled(): void {
    persisting = false
    drain()
  }

  return {
    schedule(callback: () => Promise<unknown>, owner = defaultOwner): void {
      pending.set(owner, callback)
      drain()
    },
    hasPending(owner?: object): boolean {
      return owner === undefined ? pending.size > 0 : pending.has(owner)
    },
    cancel(owner?: object): void {
      if (owner === undefined) pending.clear()
      else pending.delete(owner)
      if (pending.size === 0) {
        if (timeout !== undefined) clearTimeout(timeout)
        timeout = undefined
      }
    },
  }
}

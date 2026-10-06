/**
 * A single eligible callback waits behind current persistence. Replacing that
 * callback coalesces pending work; it never queues another transaction. `wait`
 * bounds actual starts, independently of a strategy's admission timer.
 */
export function createSerialPacer(wait: number) {
  let pending: (() => Promise<unknown>) | undefined
  let persisting = false
  let nextStartAt = Number.NEGATIVE_INFINITY
  let timeout: ReturnType<typeof setTimeout> | undefined

  function drain(): void {
    if (persisting || !pending) return
    const delay = nextStartAt - Date.now()
    if (delay > 0) {
      timeout ??= setTimeout(() => {
        timeout = undefined
        drain()
      }, delay)
      return
    }
    const callback = pending
    pending = undefined
    persisting = true
    nextStartAt = Date.now() + wait
    void callback().then(settled, settled)
  }

  function settled(): void {
    persisting = false
    drain()
  }

  return {
    schedule(callback: () => Promise<unknown>): void {
      pending = callback
      drain()
    },
    hasPending(): boolean {
      return pending !== undefined
    },
    cancel(): void {
      pending = undefined
      if (timeout !== undefined) clearTimeout(timeout)
      timeout = undefined
    },
  }
}

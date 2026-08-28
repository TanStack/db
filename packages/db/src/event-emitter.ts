/**
 * Generic type-safe event emitter
 * @template TEvents - Record of event names to event payload types
 */
export class EventEmitter<TEvents extends Record<string, any>> {
  private listeners = new Map<
    keyof TEvents,
    Set<(event: TEvents[keyof TEvents]) => void>
  >()
  private onceWrappers = new Map<
    keyof TEvents,
    Map<
      (event: TEvents[keyof TEvents]) => void,
      Set<(event: TEvents[keyof TEvents]) => void>
    >
  >()

  /**
   * Subscribe to an event
   * @param event - Event name to listen for
   * @param callback - Function to call when event is emitted
   * @returns Unsubscribe function
   */
  on<T extends keyof TEvents>(
    event: T,
    callback: (event: TEvents[T]) => void,
  ): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event)!.add(callback as (event: any) => void)

    return () => {
      this.listeners.get(event)?.delete(callback as (event: any) => void)
    }
  }

  /**
   * Subscribe to an event once (automatically unsubscribes after first emission)
   * @param event - Event name to listen for
   * @param callback - Function to call when event is emitted
   * @returns Unsubscribe function
   */
  once<T extends keyof TEvents>(
    event: T,
    callback: (event: TEvents[T]) => void,
  ): () => void {
    const original = callback as (event: TEvents[keyof TEvents]) => void
    const wrapper = (eventPayload: TEvents[T]) => {
      unsubscribe()
      callback(eventPayload)
    }
    const registered = wrapper as (event: TEvents[keyof TEvents]) => void
    let wrappersByCallback = this.onceWrappers.get(event)
    if (!wrappersByCallback) {
      wrappersByCallback = new Map()
      this.onceWrappers.set(event, wrappersByCallback)
    }
    let wrappers = wrappersByCallback.get(original)
    if (!wrappers) {
      wrappers = new Set()
      wrappersByCallback.set(original, wrappers)
    }
    wrappers.add(registered)

    const removeListener = this.on(event, wrapper)
    const unsubscribe = () => {
      removeListener()
      const currentWrappersByCallback = this.onceWrappers.get(event)
      const currentWrappers = currentWrappersByCallback?.get(original)
      currentWrappers?.delete(registered)
      if (currentWrappers?.size === 0) {
        currentWrappersByCallback?.delete(original)
      }
      if (currentWrappersByCallback?.size === 0) {
        this.onceWrappers.delete(event)
      }
    }
    return unsubscribe
  }

  /**
   * Unsubscribe from an event
   * @param event - Event name to stop listening for
   * @param callback - Function to remove
   */
  off<T extends keyof TEvents>(
    event: T,
    callback: (event: TEvents[T]) => void,
  ): void {
    const original = callback as (event: TEvents[keyof TEvents]) => void
    const listeners = this.listeners.get(event)
    listeners?.delete(original)
    const wrappersByCallback = this.onceWrappers.get(event)
    const wrappers = wrappersByCallback?.get(original)
    if (!wrappers) return
    for (const wrapper of wrappers) listeners?.delete(wrapper)
    wrappersByCallback?.delete(original)
    if (wrappersByCallback?.size === 0) {
      this.onceWrappers.delete(event)
    }
  }

  /**
   * Wait for an event to be emitted
   * @param event - Event name to wait for
   * @param timeout - Optional timeout in milliseconds
   * @returns Promise that resolves with the event payload
   */
  waitFor<T extends keyof TEvents>(
    event: T,
    timeout?: number,
  ): Promise<TEvents[T]> {
    return new Promise((resolve, reject) => {
      let timeoutId: NodeJS.Timeout | undefined
      const unsubscribe = this.on(event, (eventPayload) => {
        if (timeoutId) {
          clearTimeout(timeoutId)
          timeoutId = undefined
        }
        resolve(eventPayload)
        unsubscribe()
      })
      if (timeout) {
        timeoutId = setTimeout(() => {
          timeoutId = undefined
          unsubscribe()
          reject(new Error(`Timeout waiting for event ${String(event)}`))
        }, timeout)
      }
    })
  }

  /**
   * Emit an event to all listeners
   * @param event - Event name to emit
   * @param eventPayload - Event payload
   * @internal For use by subclasses - subclasses should wrap this with a public emit if needed
   */
  protected emitInner<T extends keyof TEvents>(
    event: T,
    eventPayload: TEvents[T],
  ): void {
    this.listeners.get(event)?.forEach((listener) => {
      try {
        listener(eventPayload)
      } catch (error) {
        // Re-throw in a microtask to surface the error
        queueMicrotask(() => {
          throw error
        })
      }
    })
  }

  /**
   * Emit an event and return every listener failure to the caller.
   *
   * Teardown paths use this when listener failures must join a synchronous
   * cleanup result. Ordinary event delivery keeps its asynchronous surfacing
   * behavior through emitInner.
   */
  protected emitInnerCollectErrors<T extends keyof TEvents>(
    event: T,
    eventPayload: TEvents[T],
  ): ReadonlyArray<unknown> {
    const errors: Array<unknown> = []
    this.listeners.get(event)?.forEach((listener) => {
      try {
        listener(eventPayload)
      } catch (error) {
        errors.push(error)
      }
    })
    return errors
  }

  /**
   * Clear all listeners
   */
  protected clearListeners(): void {
    this.listeners.clear()
    this.onceWrappers.clear()
  }
}

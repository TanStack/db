type StreamControls = {
  subscribe: (...args: Array<unknown>) => (() => void) | undefined
  unsubscribeAll: () => void
}

// Each stream owns its callback release. Prototype inheritance keeps shared
// request and resume controls live without sharing callback ownership.
export function createMockStream<T extends StreamControls>(controls: T) {
  let unsubscribe: (() => void) | undefined
  let stopped = false
  return Object.assign(
    Object.create(controls) as Omit<T, keyof StreamControls>,
    {
      subscribe: (...args: Parameters<T[`subscribe`]>) => {
        const release = controls.subscribe(...args)
        if (stopped) release?.()
        else unsubscribe = release
        return release
      },
      unsubscribeAll: () => {
        controls.unsubscribeAll()
        if (stopped) return
        stopped = true
        unsubscribe?.()
      },
    },
  )
}

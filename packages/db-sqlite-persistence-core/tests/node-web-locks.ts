/**
 * In-process Web Locks for Node 22 receiving tests. Coordinators use exclusive
 * requests, optionally with AbortSignal. Grants run in a task, requests for one
 * name are FIFO, and the callback's settlement releases the lock. Aborting a
 * queued request removes it; aborting a granted request does not release it.
 *
 * This supplies only that host premise, independently of coordinator state.
 * It does not model cross-process locks. Native Chromium/OPFS and Electron
 * receiving witnesses remain responsible for their real host boundaries.
 */
export function createInProcessWebLocks(): Pick<LockManager, `request`> {
  type Request = { start: () => void }
  type Resource = { held: boolean; scheduled: boolean; pending: Array<Request> }
  const resources = new Map<string, Resource>()

  function grantNext(name: string, resource: Resource): void {
    if (resource.held || resource.scheduled) return
    if (resource.pending.length === 0) {
      resources.delete(name)
      return
    }
    resource.scheduled = true
    setTimeout(() => {
      resource.scheduled = false
      const next = resource.pending.shift()
      if (!next) {
        resources.delete(name)
        return
      }
      resource.held = true
      next.start()
    }, 0)
  }

  function request<T>(
    name: string,
    optionsOrCallback: LockOptions | LockGrantedCallback<T>,
    maybeCallback?: LockGrantedCallback<T>,
  ): Promise<T> {
    const options =
      typeof optionsOrCallback === `function` ? {} : optionsOrCallback
    const callback =
      typeof optionsOrCallback === `function`
        ? optionsOrCallback
        : maybeCallback!
    if (
      (options.mode && options.mode !== `exclusive`) ||
      options.ifAvailable ||
      options.steal
    ) {
      return Promise.reject(
        new DOMException(
          `Node test locks support only queued exclusive requests`,
          `NotSupportedError`,
        ),
      )
    }
    const { signal } = options
    if (signal?.aborted) return Promise.reject(signal.reason)

    return new Promise<T>((resolve, reject) => {
      let resource = resources.get(name)
      if (!resource) {
        resource = { held: false, scheduled: false, pending: [] }
        resources.set(name, resource)
      }
      const current = resource
      const cancel = () => {
        const index = current.pending.indexOf(entry)
        if (index < 0) return
        current.pending.splice(index, 1)
        reject(signal!.reason)
        grantNext(name, current)
      }
      const entry: Request = {
        start: () => {
          signal?.removeEventListener(`abort`, cancel)
          const release = () => {
            current.held = false
            grantNext(name, current)
          }
          Promise.resolve()
            .then(() => callback({ name, mode: `exclusive` }))
            .then(
              (value) => {
                release()
                resolve(value)
              },
              (error: unknown) => {
                release()
                reject(error)
              },
            )
        },
      }
      current.pending.push(entry)
      signal?.addEventListener(`abort`, cancel, { once: true })
      grantNext(name, current)
    })
  }

  return { request }
}

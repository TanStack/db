/**
 * A Deferred object represents a Promise that can be resolved or rejected
 * from outside the Promise constructor.
 */
export interface Deferred<T> {
  /** The Promise object being controlled */
  promise: Promise<T>

  /** Function to resolve the Promise with a value or another Promise */
  resolve: (value: T | PromiseLike<T>) => void

  /** Function to reject the Promise with an error */
  reject: (reason?: Error | unknown) => void

  /** Check if the Promise has been resolved or rejected */
  isPending: () => boolean
}

/**
 * Creates a Deferred object containing a Promise and methods to control it.
 *
 * @returns A Deferred object with promise, resolve, reject, and isPending methods
 */
export function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: Error | unknown) => void
  let isPending = true

  const promise = new Promise<T>((res, rej) => {
    resolve = (value) => {
      isPending = false
      res(value)
    }

    reject = (reason) => {
      isPending = false
      rej(reason)
    }
  })

  return {
    promise,
    resolve,
    reject,
    isPending: () => isPending,
  }
}

/** An aborted acquisition stops participating before its transport settles. */
export function resolveOnAbort<T>(
  transport: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T | undefined> {
  if (!signal) return transport
  return new Promise<T | undefined>((resolve, reject) => {
    const finish = (value?: T) => {
      signal.removeEventListener(`abort`, abort)
      resolve(value)
    }
    const abort = () => finish()
    if (signal.aborted) abort()
    else signal.addEventListener(`abort`, abort, { once: true })
    void transport.then(finish, (error: unknown) => {
      signal.removeEventListener(`abort`, abort)
      reject(error)
    })
  })
}

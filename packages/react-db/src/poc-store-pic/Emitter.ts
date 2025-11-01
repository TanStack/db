/**
 * Simple event emitter for managing subscriptions
 * Based on react-concurrent-store implementation
 */
export default class Emitter<T extends Array<unknown>> {
  _listeners: Array<(...value: T) => void> = []

  subscribe(cb: (...value: T) => void): () => void {
    const wrapped = (...value: T) => cb(...value)
    this._listeners.push(wrapped)
    return () => {
      this._listeners = this._listeners.filter((s) => s !== wrapped)
    }
  }

  notify(...value: T) {
    this._listeners.forEach((cb) => {
      cb(...value)
    })
  }
}

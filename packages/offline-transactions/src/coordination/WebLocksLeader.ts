import { BaseLeaderElection } from './LeaderElection'

export class WebLocksLeader extends BaseLeaderElection {
  private lockName: string
  private releaseLock: (() => void) | null = null
  // Set while this tab waits in the lock's queue, to leave it on release.
  private waiting: AbortController | undefined
  private pendingRequest: Promise<boolean> | null = null
  private requestGeneration = 0

  constructor(lockName = `offline-executor-leader`) {
    super()
    this.lockName = lockName
  }

  async requestLeadership(): Promise<boolean> {
    if (!this.isWebLocksSupported()) {
      return false
    }

    // Possession, not the notified state: a release clears the handle at
    // once, while its notification can still wait behind the gain's.
    if (this.releaseLock) {
      return true
    }

    if (this.waiting) {
      return false
    }

    // Requests share one attempt until a release voids it.
    if (!this.pendingRequest) {
      const attempt = this.acquireOrWait().finally(() => {
        if (this.pendingRequest === attempt) this.pendingRequest = null
      })
      this.pendingRequest = attempt
    }
    return this.pendingRequest
  }

  private async acquireOrWait(): Promise<boolean> {
    const generation = this.requestGeneration
    try {
      return await new Promise<boolean>((resolve, reject) => {
        navigator.locks
          .request(this.lockName, { ifAvailable: true }, (lock) => {
            // Released while this request was pending.
            if (generation !== this.requestGeneration) {
              resolve(false)
              return
            }

            if (!lock) {
              this.waitForLeadership()
              resolve(false)
              return
            }

            // Set state directly: the caller learns this result from the
            // returned promise, so it is not a leadership change.
            this.isLeaderState = true
            resolve(true)
            return this.holdLock()
          })
          .catch(reject)
      })
    } catch (error) {
      console.warn(`Web Locks leadership request failed:`, error)
      return false
    }
  }

  // Queues for the lock, which is granted when the current holder releases it
  // or its tab closes.
  private waitForLeadership(): void {
    const waiting = new AbortController()
    this.waiting = waiting
    navigator.locks
      .request(this.lockName, { signal: waiting.signal }, () => {
        // An abort has no effect once the lock is granted.
        if (this.waiting !== waiting) return
        this.waiting = undefined
        // Hold first, so a listener that releases on the gain lets go.
        const held = this.holdLock()
        this.notifyLeadershipChange(true)
        return held
      })
      .catch((error: unknown) => {
        if (waiting.signal.aborted) return
        this.waiting = undefined
        console.warn(`Web Locks leadership request failed:`, error)
      })
  }

  private holdLock(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.releaseLock = () => {
        this.notifyLeadershipChange(false)
        resolve()
      }
    })
  }

  releaseLeadership(): void {
    this.requestGeneration++
    this.pendingRequest = null
    if (this.waiting) {
      const waiting = this.waiting
      this.waiting = undefined
      waiting.abort()
    }
    const release = this.releaseLock
    this.releaseLock = null
    release?.()
  }

  private isWebLocksSupported(): boolean {
    return typeof navigator !== `undefined` && `locks` in navigator
  }

  static isSupported(): boolean {
    return typeof navigator !== `undefined` && `locks` in navigator
  }
}

import { BaseLeaderElection } from "./LeaderElection"

export class WebLocksLeader extends BaseLeaderElection {
  private lockName: string
  private releaseLock: (() => void) | null = null

  constructor(lockName = `offline-executor-leader`) {
    super()
    this.lockName = lockName
  }

  async requestLeadership(): Promise<boolean> {
    if (!this.isWebLocksSupported()) {
      return false
    }

    if (this.isLeaderState) {
      return true
    }

    try {
      let releaseLock: (() => void) | null = null

      const result = await navigator.locks.request(
        this.lockName,
        {
          mode: `exclusive`,
          ifAvailable: true,
        },
        async (lock) => {
          if (lock) {
            this.notifyLeadershipChange(true)
            return new Promise<boolean>((resolve) => {
              // Store the release function
              releaseLock = () => resolve(true)
              this.releaseLock = releaseLock
            })
          }
          return false
        }
      )

      return result
    } catch (error) {
      if (error instanceof Error && error.name === `AbortError`) {
        return false
      }
      console.warn(`Web Locks leadership request failed:`, error)
      return false
    }
  }

  releaseLeadership(): void {
    if (this.releaseLock) {
      this.releaseLock() // This will resolve the promise and release the lock
      this.releaseLock = null
    }
    this.notifyLeadershipChange(false)
  }

  private isWebLocksSupported(): boolean {
    return typeof navigator !== `undefined` && `locks` in navigator
  }

  static isSupported(): boolean {
    return typeof navigator !== `undefined` && `locks` in navigator
  }
}

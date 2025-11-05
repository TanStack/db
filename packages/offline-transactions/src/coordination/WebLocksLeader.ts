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
      // First try to acquire the lock with ifAvailable
      const available = await navigator.locks.request(
        this.lockName,
        {
          mode: `exclusive`,
          ifAvailable: true,
        },
        (lock) => {
          return lock !== null
        }
      )

      if (!available) {
        return false
      }

      // Lock is available, now acquire it for real and hold it
      navigator.locks.request(
        this.lockName,
        {
          mode: `exclusive`,
        },
        async (lock) => {
          if (lock) {
            this.notifyLeadershipChange(true)
            // Hold the lock until released
            return new Promise<void>((resolve) => {
              this.releaseLock = () => {
                this.notifyLeadershipChange(false)
                resolve()
              }
            })
          }
        }
      )

      return true
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
      this.releaseLock()
      this.releaseLock = null
    }
  }

  private isWebLocksSupported(): boolean {
    return typeof navigator !== `undefined` && `locks` in navigator
  }

  static isSupported(): boolean {
    return typeof navigator !== `undefined` && `locks` in navigator
  }
}

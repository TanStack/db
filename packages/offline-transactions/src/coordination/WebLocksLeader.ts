import { BaseLeaderElection } from "./LeaderElection"

export class WebLocksLeader extends BaseLeaderElection {
  private lockName: string
  private lockController: AbortController | null = null

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
      this.lockController = new AbortController()

      const result = await navigator.locks.request(
        this.lockName,
        {
          mode: `exclusive`,
          ifAvailable: true,
          signal: this.lockController.signal,
        },
        async (lock) => {
          if (lock) {
            this.notifyLeadershipChange(true)

            return new Promise<boolean>((resolve) => {
              this.lockController!.signal.addEventListener(`abort`, () => {
                this.notifyLeadershipChange(false)
                resolve(true)
              })
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
    if (this.lockController) {
      this.lockController.abort()
      this.lockController = null
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

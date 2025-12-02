import type { LeaderElection } from "../types"

export abstract class BaseLeaderElection implements LeaderElection {
  protected isLeaderState = false
  protected listeners: Set<(isLeader: boolean) => void> = new Set()

  abstract requestLeadership(): Promise<boolean>
  abstract releaseLeadership(): void

  isLeader(): boolean {
    return this.isLeaderState
  }

  onLeadershipChange(callback: (isLeader: boolean) => void): () => void {
    this.listeners.add(callback)

    return () => {
      this.listeners.delete(callback)
    }
  }

  protected notifyLeadershipChange(isLeader: boolean): void {
    if (this.isLeaderState !== isLeader) {
      this.isLeaderState = isLeader

      for (const listener of this.listeners) {
        try {
          listener(isLeader)
        } catch (error) {
          console.warn(`Leadership change listener error:`, error)
        }
      }
    }
  }
}

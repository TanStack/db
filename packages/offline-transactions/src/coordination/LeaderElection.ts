import type { LeaderElection } from '../types'

export abstract class BaseLeaderElection implements LeaderElection {
  protected isLeaderState = false
  protected listeners: Set<(isLeader: boolean) => void> = new Set()
  // Changes a listener causes wait until every listener heard the current one.
  private notifying = false
  private readonly queued: Array<boolean> = []

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
    this.queued.push(isLeader)
    if (this.notifying) return
    this.notifying = true
    try {
      for (
        let next = this.queued.shift();
        next !== undefined;
        next = this.queued.shift()
      ) {
        if (this.isLeaderState === next) continue
        this.isLeaderState = next
        for (const listener of this.listeners) {
          try {
            listener(next)
          } catch (error) {
            console.warn(`Leadership change listener error:`, error)
          }
        }
      }
    } finally {
      this.notifying = false
    }
  }
}

import { BaseLeaderElection } from "./LeaderElection"

interface LeaderMessage {
  type: `heartbeat` | `election` | `leadership-claim`
  tabId: string
  timestamp: number
}

export class BroadcastChannelLeader extends BaseLeaderElection {
  private channelName: string
  private tabId: string
  private channel: BroadcastChannel | null = null
  private heartbeatInterval: number | null = null
  private electionTimeout: number | null = null
  private lastLeaderHeartbeat = 0
  private readonly heartbeatIntervalMs = 5000
  private readonly electionTimeoutMs = 10000

  constructor(channelName = `offline-executor-leader`) {
    super()
    this.channelName = channelName
    this.tabId = crypto.randomUUID()
    this.setupChannel()
  }

  private setupChannel(): void {
    if (!this.isBroadcastChannelSupported()) {
      return
    }

    this.channel = new BroadcastChannel(this.channelName)
    this.channel.addEventListener(`message`, this.handleMessage)
  }

  private handleMessage = (event: MessageEvent<LeaderMessage>): void => {
    const { type, tabId, timestamp } = event.data

    if (tabId === this.tabId) {
      return
    }

    switch (type) {
      case `heartbeat`:
        if (this.isLeaderState && tabId < this.tabId) {
          this.releaseLeadership()
        } else if (!this.isLeaderState) {
          this.lastLeaderHeartbeat = timestamp
          this.cancelElection()
        }
        break

      case `election`:
        if (this.isLeaderState) {
          this.sendHeartbeat()
        } else if (tabId > this.tabId) {
          this.startElection()
        }
        break

      case `leadership-claim`:
        if (this.isLeaderState && tabId < this.tabId) {
          this.releaseLeadership()
        }
        break
    }
  }

  async requestLeadership(): Promise<boolean> {
    if (!this.isBroadcastChannelSupported()) {
      return false
    }

    if (this.isLeaderState) {
      return true
    }

    this.startElection()

    return new Promise((resolve) => {
      setTimeout(() => {
        resolve(this.isLeaderState)
      }, 1000)
    })
  }

  private startElection(): void {
    if (this.electionTimeout) {
      return
    }

    this.sendMessage({
      type: `election`,
      tabId: this.tabId,
      timestamp: Date.now(),
    })

    this.electionTimeout = window.setTimeout(() => {
      const timeSinceLastHeartbeat = Date.now() - this.lastLeaderHeartbeat

      if (timeSinceLastHeartbeat > this.electionTimeoutMs) {
        this.claimLeadership()
      }

      this.electionTimeout = null
    }, this.electionTimeoutMs)
  }

  private cancelElection(): void {
    if (this.electionTimeout) {
      clearTimeout(this.electionTimeout)
      this.electionTimeout = null
    }
  }

  private claimLeadership(): void {
    this.notifyLeadershipChange(true)
    this.sendMessage({
      type: `leadership-claim`,
      tabId: this.tabId,
      timestamp: Date.now(),
    })
    this.startHeartbeat()
  }

  private startHeartbeat(): void {
    if (this.heartbeatInterval) {
      return
    }

    this.sendHeartbeat()

    this.heartbeatInterval = window.setInterval(() => {
      this.sendHeartbeat()
    }, this.heartbeatIntervalMs)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }
  }

  private sendHeartbeat(): void {
    this.sendMessage({
      type: `heartbeat`,
      tabId: this.tabId,
      timestamp: Date.now(),
    })
  }

  private sendMessage(message: LeaderMessage): void {
    if (this.channel) {
      this.channel.postMessage(message)
    }
  }

  releaseLeadership(): void {
    this.stopHeartbeat()
    this.cancelElection()
    this.notifyLeadershipChange(false)
  }

  private isBroadcastChannelSupported(): boolean {
    return typeof BroadcastChannel !== `undefined`
  }

  static isSupported(): boolean {
    return typeof BroadcastChannel !== `undefined`
  }

  dispose(): void {
    this.releaseLeadership()

    if (this.channel) {
      this.channel.removeEventListener(`message`, this.handleMessage)
      this.channel.close()
      this.channel = null
    }
  }
}

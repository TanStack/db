import { Network } from '@capacitor/network'
import type { OnlineDetector } from '../types'

interface ListenerHandle {
  remove: () => Promise<void>
}

export class CapacitorOnlineDetector implements OnlineDetector {
  private listeners: Set<() => void> = new Set()
  private networkListenerHandle: ListenerHandle | null = null
  private isListening = false
  private wasConnected = true

  constructor() {
    this.startListening()
  }

  private startListening(): void {
    if (this.isListening) {
      return
    }

    this.isListening = true

    Network.addListener(`networkStatusChange`, (status) => {
      const isConnected = status.connected

      if (isConnected && !this.wasConnected) {
        this.notifyListeners()
      }

      this.wasConnected = isConnected
    }).then((handle) => {
      this.networkListenerHandle = handle
    })

    if (typeof document !== `undefined`) {
      document.addEventListener(`visibilitychange`, this.handleVisibilityChange)
    }
  }

  private handleVisibilityChange = (): void => {
    if (document.visibilityState === `visible`) {
      this.notifyListeners()
    }
  }

  private stopListening(): void {
    if (!this.isListening) {
      return
    }

    this.isListening = false

    if (this.networkListenerHandle) {
      this.networkListenerHandle.remove()
      this.networkListenerHandle = null
    }

    if (typeof document !== `undefined`) {
      document.removeEventListener(
        `visibilitychange`,
        this.handleVisibilityChange,
      )
    }
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener()
      } catch (error) {
        console.warn(`CapacitorOnlineDetector listener error:`, error)
      }
    }
  }

  subscribe(callback: () => void): () => void {
    this.listeners.add(callback)

    return () => {
      this.listeners.delete(callback)

      if (this.listeners.size === 0) {
        this.stopListening()
      }
    }
  }

  notifyOnline(): void {
    this.notifyListeners()
  }

  dispose(): void {
    this.stopListening()
    this.listeners.clear()
  }
}

import type { OnlineDetector } from '../types'

export class DefaultOnlineDetector implements OnlineDetector {
  private listeners: Set<() => void> = new Set()
  private isListening = false

  constructor() {
    this.startListening()
  }

  private startListening(): void {
    if (this.isListening) {
      return
    }

    this.isListening = true

    if (typeof window !== `undefined`) {
      window.addEventListener(`online`, this.handleOnline)
      document.addEventListener(`visibilitychange`, this.handleVisibilityChange)
    }
  }

  private stopListening(): void {
    if (!this.isListening) {
      return
    }

    this.isListening = false

    if (typeof window !== `undefined`) {
      window.removeEventListener(`online`, this.handleOnline)
      document.removeEventListener(
        `visibilitychange`,
        this.handleVisibilityChange,
      )
    }
  }

  private handleOnline = (): void => {
    this.notifyListeners()
  }

  private handleVisibilityChange = (): void => {
    if (document.visibilityState === `visible`) {
      this.notifyListeners()
    }
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener()
      } catch (error) {
        console.warn(`OnlineDetector listener error:`, error)
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
    if (!this.isOnline()) {
      console.info('notifyOnline called while offline, skipping notification')
      return
    }
    this.notifyListeners()
  }

  isOnline(): boolean {
    if (typeof navigator !== `undefined`) {
      return navigator.onLine
    }
    return true
  }

  dispose(): void {
    this.stopListening()
    this.listeners.clear()
  }
}

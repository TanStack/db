import { ReactNativeOnlineDetector } from '@tanstack/offline-transactions/react-native'
import {
  isSimulatedOffline,
  subscribeSimulatedOffline,
} from './simulatedOffline'
import type { OnlineDetector } from '@tanstack/offline-transactions/react-native'

class SimulatedOnlineDetector implements OnlineDetector {
  private readonly baseDetector = new ReactNativeOnlineDetector()

  subscribe(callback: () => void): () => void {
    const unsubscribeBase = this.baseDetector.subscribe(callback)
    const unsubscribeSimulated = subscribeSimulatedOffline(callback)
    return () => {
      unsubscribeBase()
      unsubscribeSimulated()
    }
  }

  isOnline(): boolean {
    return this.baseDetector.isOnline() && !isSimulatedOffline()
  }

  notifyOnline(): void {
    this.baseDetector.notifyOnline()
  }

  dispose(): void {
    this.baseDetector.dispose()
  }
}

export const simulatedOnlineDetector: OnlineDetector =
  new SimulatedOnlineDetector()

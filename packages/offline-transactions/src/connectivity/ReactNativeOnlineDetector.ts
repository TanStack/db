import NetInfo from '@react-native-community/netinfo'
import { AppState } from 'react-native'
import type { AppStateStatus, NativeEventSubscription } from 'react-native'
import type { OnlineDetector } from '../types'

/**
 * React Native online detector that uses RN APIs.
 * Listens for:
 * - Network connectivity changes via `@react-native-community/netinfo`
 * - App state changes (foreground/background) via `AppState`
 */
export class ReactNativeOnlineDetector implements OnlineDetector {
  private listeners: Set<() => void> = new Set()
  private netInfoUnsubscribe: (() => void) | null = null
  private appStateSubscription: NativeEventSubscription | null = null
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

    // Subscribe to network state changes
    this.netInfoUnsubscribe = NetInfo.addEventListener((state) => {
      const isConnected =
        state.isConnected === true && state.isInternetReachable !== false

      // Only notify when transitioning to online
      if (isConnected && !this.wasConnected) {
        this.notifyListeners()
      }

      this.wasConnected = isConnected
    })

    // Subscribe to app state changes (foreground/background)
    this.appStateSubscription = AppState.addEventListener(
      `change`,
      this.handleAppStateChange,
    )
  }

  private handleAppStateChange = (nextState: AppStateStatus): void => {
    // Notify when app becomes active (foreground)
    if (nextState === `active`) {
      this.notifyListeners()
    }
  }

  private stopListening(): void {
    if (!this.isListening) {
      return
    }

    this.isListening = false

    if (this.netInfoUnsubscribe) {
      this.netInfoUnsubscribe()
      this.netInfoUnsubscribe = null
    }

    if (this.appStateSubscription) {
      this.appStateSubscription.remove()
      this.appStateSubscription = null
    }
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener()
      } catch (error) {
        console.warn(`ReactNativeOnlineDetector listener error:`, error)
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

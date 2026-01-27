import { OfflineExecutor as BaseOfflineExecutor } from '../OfflineExecutor'
import { ReactNativeOnlineDetector } from '../connectivity/ReactNativeOnlineDetector'
import type { OfflineConfig } from '../types'

/**
 * OfflineExecutor configured for React Native environments.
 * Uses ReactNativeOnlineDetector by default instead of WebOnlineDetector.
 */
export class OfflineExecutor extends BaseOfflineExecutor {
  constructor(config: OfflineConfig) {
    super({
      ...config,
      onlineDetector: config.onlineDetector ?? new ReactNativeOnlineDetector(),
    })
  }
}

/**
 * Start an offline executor configured for React Native environments.
 * Uses ReactNativeOnlineDetector by default instead of WebOnlineDetector.
 */
export function startOfflineExecutor(config: OfflineConfig): OfflineExecutor {
  return new OfflineExecutor(config)
}

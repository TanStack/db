import { OfflineExecutor as BaseOfflineExecutor } from '../OfflineExecutor'
import { CapacitorOnlineDetector } from '../connectivity/CapacitorOnlineDetector'
import { CapacitorStorageAdapter } from '../storage/CapacitorStorageAdapter'
import type { OfflineConfig } from '../types'

export class OfflineExecutor extends BaseOfflineExecutor {
  constructor(config: OfflineConfig) {
    super({
      ...config,
      storage: config.storage ?? new CapacitorStorageAdapter(),
      onlineDetector: config.onlineDetector ?? new CapacitorOnlineDetector(),
    })
  }
}

export function startOfflineExecutor(config: OfflineConfig): OfflineExecutor {
  return new OfflineExecutor(config)
}

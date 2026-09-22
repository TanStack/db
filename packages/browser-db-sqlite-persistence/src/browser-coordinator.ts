import { BroadcastCollectionCoordinator } from '@tanstack/db-sqlite-persistence-core/broadcast-coordinator'
import type { BroadcastCollectionCoordinatorOptions } from '@tanstack/db-sqlite-persistence-core/broadcast-coordinator'

export type BrowserCollectionCoordinatorOptions = Omit<
  BroadcastCollectionCoordinatorOptions,
  `coordinatorName`
>

export class BrowserCollectionCoordinator extends BroadcastCollectionCoordinator {
  constructor(options: BrowserCollectionCoordinatorOptions) {
    super({
      ...options,
      coordinatorName: `BrowserCollectionCoordinator`,
    })
  }
}

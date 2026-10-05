import { BroadcastCollectionCoordinator } from '@tanstack/db-sqlite-persistence-core/broadcast-coordinator'
import type { BroadcastCollectionCoordinatorOptions } from '@tanstack/db-sqlite-persistence-core/broadcast-coordinator'

export type ElectronCollectionCoordinatorOptions = Omit<
  BroadcastCollectionCoordinatorOptions,
  `coordinatorName`
>

export class ElectronCollectionCoordinator extends BroadcastCollectionCoordinator {
  constructor(options: ElectronCollectionCoordinatorOptions) {
    super({
      ...options,
      coordinatorName: `ElectronCollectionCoordinator`,
    })
  }
}

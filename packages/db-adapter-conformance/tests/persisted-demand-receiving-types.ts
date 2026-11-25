/** Production factories record provider facts; the primary persistence model judges them. */
import type { Collection, SyncConfig } from '@tanstack/db'
import type { PersistedCollectionPersistence } from '../../db-sqlite-persistence-core/src'
import type { SourceEvent } from '../../db-sqlite-persistence-core/tests/persisted-demand-coverage-model-oracle'

export type DemandRow = {
  id: string
  group: string
  rank: number
  value: string
}

export type DemandReceivingInput = {
  id: string
  waitMs: number
  persistence: PersistedCollectionPersistence
  wrapSync: (
    sync: SyncConfig<DemandRow, string>,
  ) => SyncConfig<DemandRow, string>
  wrapPersistedSync: (
    sync: SyncConfig<DemandRow, string>,
  ) => SyncConfig<DemandRow, string>
  events: Array<SourceEvent>
}

export type DemandReceivingSource = {
  collection: Collection<DemandRow, string>
  /** Supply authored backend rows and answer later acquisitions from them too. */
  answer: (rows: ReadonlyArray<DemandRow>) => Promise<void>
  /** Stop answering later acquisitions after consuming the current reply. */
  hold?: () => Promise<void>
  /** Reject current and later acquisitions through the actual provider boundary. */
  reject: () => Promise<void>
  /** Actual SDK/HTTP/hook request count, independent of query readiness. */
  requests: () => number
  /** Drain provider consumption only; must not await Collection readiness or load success. */
  barrier: () => Promise<void>
  dispose: () => Promise<void>
}

export type DemandReceivingFactory = (
  input: DemandReceivingInput,
) => Promise<DemandReceivingSource>

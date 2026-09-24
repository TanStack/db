export { exposeElectronSQLitePersistence } from './main'
export type {
  ElectronIpcMainLike,
  ElectronSQLiteMainProcessOptions,
} from './main'
export { createElectronSQLitePersistence } from './renderer'
export type {
  ElectronIpcRendererLike,
  ElectronSQLitePersistenceOptions,
} from './renderer'
export { ElectronCollectionCoordinator } from './electron-coordinator'
export type { ElectronCollectionCoordinatorOptions } from './electron-coordinator'
export {
  DuplicateRemoteSubsetOwnerError,
  IndeterminateCommitError,
  PersistedCollectionDurabilityError,
  RemoteSubsetWireValueError,
  persistedCollectionOptions,
} from '@tanstack/db-sqlite-persistence-core'
export type {
  PersistedCollectionCoordinator,
  PersistedCollectionPersistence,
  IndeterminateCommitRequestType,
  RemoteSubsetOwner,
  RemoteSubsetWireExpression,
  RemoteSubsetWireValue,
  TransportedLoadSubsetOptions,
} from '@tanstack/db-sqlite-persistence-core'

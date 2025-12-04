export {
  electricCollectionOptions,
  type ElectricCollectionConfig,
  type ElectricCollectionUtils,
  type ElectricCollectionUtilsWithPersistence,
  type Txid,
  type AwaitTxIdFn,
  type ClearPersistenceFn,
  type GetPersistenceSizeFn,
} from "./electric"

export type { ElectricPersistenceConfig } from "./persistence/createPersistence"

export * from "./errors"

export type { StorageApi } from "./persistence/persistenceAdapter"

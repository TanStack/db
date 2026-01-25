export {
  createIndexedDB,
  type CreateIndexedDBOptions,
  type IndexedDBInstance,
  indexedDBCollectionOptions,
  type IndexedDBCollectionConfig,
  type IndexedDBCollectionUtils,
  type DatabaseInfo,
  DatabaseRequiredError,
  ObjectStoreNotFoundError,
  NameRequiredError,
  GetKeyRequiredError,
} from './indexeddb'

export {
  openDatabase,
  createObjectStore,
  executeTransaction,
  getAll,
  getAllKeys,
  getByKey,
  put,
  deleteByKey,
  clear,
  deleteDatabase,
} from './wrapper'

export {
  IndexedDBError,
  IndexedDBNotSupportedError,
  IndexedDBConnectionError,
  IndexedDBTransactionError,
  IndexedDBOperationError,
} from './errors'

import { createCapacitorSQLitePersistence } from '../src'
import { runCapacitorPersistedCollectionConformanceSuite } from './capacitor-persisted-collection-conformance-suite-oracle'

runCapacitorPersistedCollectionConformanceSuite(
  `capacitor persisted collection conformance`,
  (database) => createCapacitorSQLitePersistence({ database }),
)

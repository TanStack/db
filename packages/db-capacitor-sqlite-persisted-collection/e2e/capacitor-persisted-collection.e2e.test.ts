import { createCapacitorSQLitePersistence } from '../src'
import { runCapacitorPersistedCollectionConformanceSuite } from './capacitor-persisted-collection-conformance-suite'

runCapacitorPersistedCollectionConformanceSuite(
  `capacitor persisted collection conformance`,
  (database) => createCapacitorSQLitePersistence({ database }),
)

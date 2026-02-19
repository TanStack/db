import { createReactNativeSQLitePersistence } from '../src'
import { runMobilePersistedCollectionConformanceSuite } from './mobile-persisted-collection-conformance-suite'

runMobilePersistedCollectionConformanceSuite(
  `expo persisted collection conformance`,
  (database) => createReactNativeSQLitePersistence({ database }),
)

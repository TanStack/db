import { createReactNativeSQLitePersistence } from '../src'
import { runMobilePersistedCollectionConformanceSuite } from './mobile-persisted-collection-conformance-suite-oracle'

runMobilePersistedCollectionConformanceSuite(
  `expo persisted collection conformance`,
  (database) =>
    createReactNativeSQLitePersistence({
      database,
      arrayResultMode: `statement-results`,
    }),
)

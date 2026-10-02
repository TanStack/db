import { createReactNativeSQLitePersistence } from '../src'
import { runMobilePersistedCollectionConformanceSuite } from './mobile-persisted-collection-conformance-suite-oracle'

runMobilePersistedCollectionConformanceSuite(
  `react-native persisted collection conformance`,
  (database) =>
    createReactNativeSQLitePersistence({
      database,
      arrayResultMode: `statement-results`,
    }),
)

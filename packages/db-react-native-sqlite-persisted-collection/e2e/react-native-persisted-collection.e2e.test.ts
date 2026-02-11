import { createReactNativeSQLitePersistence } from '../src'
import { runMobilePersistedCollectionConformanceSuite } from './mobile-persisted-collection-conformance-suite'

runMobilePersistedCollectionConformanceSuite(
  `react-native persisted collection conformance`,
  (driver) => createReactNativeSQLitePersistence({ driver }),
)

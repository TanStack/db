import { it } from 'vitest'
import { createExpoSQLitePersistence } from '../src'
import { runMobilePersistedCollectionConformanceSuite } from './mobile-persisted-collection-conformance-suite'

const runtimePlatform = process.env.TANSTACK_DB_EXPO_RUNTIME_PLATFORM?.trim()

if (!runtimePlatform) {
  runMobilePersistedCollectionConformanceSuite(
    `expo persisted collection conformance`,
    (database) => createExpoSQLitePersistence({ database }),
  )
} else {
  it.skip(`runs the conformance suite in shimmed e2e mode only`, () => {})
}

import { afterAll, afterEach, beforeAll } from 'vitest'
import { runPersistedCollectionConformanceSuite } from '../../../db-persistence-core/tests/contracts/persisted-collection-conformance-contract'
import type { TauriPersistedCollectionHarnessConfig } from './tauri-persisted-collection-harness'

type RegisteredHarness = {
  config: TauriPersistedCollectionHarnessConfig
  teardown: () => Promise<void>
}

export function registerPersistedCollectionConformanceSuite(options: {
  suiteName: string
  createHarness: () => Promise<RegisteredHarness>
}): void {
  const { suiteName, createHarness } = options
  let config: TauriPersistedCollectionHarnessConfig | undefined
  let teardown = () => Promise.resolve()

  beforeAll(async () => {
    const harness = await createHarness()
    config = harness.config
    teardown = harness.teardown
  })

  afterEach(async () => {
    if (config?.afterEach) {
      await config.afterEach()
    }
  })

  afterAll(async () => {
    if (config) {
      await teardown()
    }
  })

  const getConfig = (): Promise<TauriPersistedCollectionHarnessConfig> => {
    if (!config) {
      throw new Error(`${suiteName} config is not initialized`)
    }

    return Promise.resolve(config)
  }

  runPersistedCollectionConformanceSuite(suiteName, getConfig)
}

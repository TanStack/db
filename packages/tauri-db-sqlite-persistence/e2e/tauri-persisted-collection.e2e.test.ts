import { expect, it } from 'vitest'
import { runTauriPersistedCollectionE2E } from './run-tauri-e2e'

it(`runs the persisted collection conformance suite in a real Tauri runtime`, async () => {
  const result = await runTauriPersistedCollectionE2E()

  expect(result.status).toBe(`passed`)
})

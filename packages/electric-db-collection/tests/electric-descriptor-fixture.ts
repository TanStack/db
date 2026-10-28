/**
 * The Electric collection options that every descriptor-isolation test builds.
 * It sits outside electric-descriptor-harness.ts, which the ShapeStream mock
 * loads, so that the mock does not import the Electric adapter it replaces.
 */
import { electricCollectionOptions } from '../src/electric'
import type { TestRow } from './electric-persistence-fixture'

export function descriptor(
  form: `original` | `once-spread`,
  startSync = true,
  syncMode: `eager` | `on-demand` | `progressive` = `eager`,
) {
  const options = electricCollectionOptions<TestRow>({
    shapeOptions: { url: `http://test-url`, params: { table: `test_table` } },
    getKey: (row) => row.id,
    startSync,
    syncMode,
  })
  // Spreading once consumes the options creator's utils getter. Reusing this
  // plain descriptor must be as safe as reading that getter for each instance.
  return form === `once-spread` ? { ...options } : options
}

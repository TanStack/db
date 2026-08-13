import { describe, expect, it } from 'vitest'
import { createMemo, createRoot, flush } from 'solid-js'
import {
  createCollection,
  createLiveQueryObserver,
} from '@tanstack/db'
import {
  enableSolidDBExternalSource,
  trackSnapshot,
} from '../src/external-source'
import { mockSyncCollectionOptions } from '../../db/tests/utils'

type Person = {
  id: string
  name: string
  age: number
}

describe('enableSolidDBExternalSource', () => {
  it('should be idempotent (calling twice is a no-op)', () => {
    enableSolidDBExternalSource()
    enableSolidDBExternalSource()
  })

  it('should auto-track observer snapshots in a Solid memo', () => {
    enableSolidDBExternalSource()

    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `external-source-test`,
        getKey: (p: Person) => p.id,
        initialData: [
          { id: `1`, name: `Alice`, age: 30 },
        ],
      }),
    )

    const observer = createLiveQueryObserver(collection, {
      mode: `wholesale`,
    })

    let memoRuns = 0

    const dispose = createRoot((dispose) => {
      const snapshot = createMemo(() => {
        memoRuns++
        return trackSnapshot(observer)
      })

      // Initial run: should read the snapshot
      expect(snapshot()).toBeDefined()
      expect(memoRuns).toBe(1)
      expect((snapshot().data as Array<Person>).length).toBe(1)

      // Mutate the collection
      collection.utils.begin()
      collection.utils.write({
        type: `insert`,
        value: { id: `2`, name: `Bob`, age: 25 },
      })
      collection.utils.commit()

      flush()

      // The memo should have re-run because trackSnapshot registered the observer
      expect(memoRuns).toBeGreaterThanOrEqual(2)
      expect((snapshot().data as Array<Person>).length).toBe(2)

      return dispose
    })

    dispose()
    observer.dispose()
  })
})

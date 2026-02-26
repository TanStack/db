/**
 * Targeted tests for Vue best-practice fixes in useLiveQuery.
 *
 * Each test validates a specific behavioral change from the Phase 0 alignment:
 *   0.1  shallowReactive Map — items are NOT deeply reactive
 *   0.2  shallowRef array    — data elements are NOT deeply reactive
 *   0.3  BaseQueryBuilder probe — disabled queries via null/undefined
 *   0.4  onScopeDispose     — cleanup runs on effectScope disposal
 *   0.5  gcTime              — hook-created collections have GC time set
 *   0.6  instanceof CollectionImpl — robust collection detection
 *   0.9  isEnabled           — new return field
 */

import { describe, expect, it } from 'vitest'
import {
  createCollection,
  createLiveQueryCollection,
  gt,
} from '@tanstack/db'
import {
  effectScope,
  isReactive,
  ref,
} from 'vue'
import { useLiveQuery } from '../src/useLiveQuery'
import { mockSyncCollectionOptions } from '../../db/tests/utils'
import { waitFor, waitForVueUpdate } from './test-utils'

type Person = {
  id: string
  name: string
  age: number
  email: string
  isActive: boolean
  team: string
}

const initialPersons: Array<Person> = [
  {
    id: `1`,
    name: `John Doe`,
    age: 30,
    email: `john.doe@example.com`,
    isActive: true,
    team: `team1`,
  },
  {
    id: `2`,
    name: `Jane Doe`,
    age: 25,
    email: `jane.doe@example.com`,
    isActive: true,
    team: `team2`,
  },
  {
    id: `3`,
    name: `John Smith`,
    age: 35,
    email: `john.smith@example.com`,
    isActive: true,
    team: `team1`,
  },
]

describe(`Vue best-practice fixes`, () => {
  // ── 0.1 shallowReactive Map ──────────────────────────────────────────
  describe(`shallowReactive state Map (fix 0.1)`, () => {
    it(`should store items that are NOT deeply reactive`, async () => {
      const collection = createCollection(
        mockSyncCollectionOptions<Person>({
          id: `shallow-map-test`,
          getKey: (person: Person) => person.id,
          initialData: initialPersons,
        }),
      )

      const { state } = useLiveQuery((q) =>
        q
          .from({ persons: collection })
          .where(({ persons }) => gt(persons.age, 30))
          .select(({ persons }) => ({
            id: persons.id,
            name: persons.name,
            age: persons.age,
          })),
      )

      await waitForVueUpdate()

      // The Map itself should be reactive (shallowReactive tracks set/delete/has)
      expect(state.value.size).toBe(1)

      // But the items stored inside should NOT be deeply reactive proxies
      // shallowReactive only tracks Map operations, not the stored values
      const item = state.value.get(`3`)
      expect(item).toBeDefined()
      expect(isReactive(item)).toBe(false)
    })
  })

  // ── 0.2 shallowRef data array ────────────────────────────────────────
  describe(`shallowRef data array (fix 0.2)`, () => {
    it(`should store array elements that are NOT deeply reactive`, async () => {
      const collection = createCollection(
        mockSyncCollectionOptions<Person>({
          id: `shallow-array-test`,
          getKey: (person: Person) => person.id,
          initialData: initialPersons,
        }),
      )

      const { data } = useLiveQuery((q) =>
        q
          .from({ persons: collection })
          .select(({ persons }) => ({
            id: persons.id,
            name: persons.name,
            age: persons.age,
          })),
      )

      await waitForVueUpdate()

      expect(data.value.length).toBe(3)

      // Array elements should NOT be deeply reactive
      for (const item of data.value) {
        expect(isReactive(item)).toBe(false)
      }
    })

    it(`should replace data array atomically on changes (not splice/push)`, async () => {
      const collection = createCollection(
        mockSyncCollectionOptions<Person>({
          id: `atomic-replace-test`,
          getKey: (person: Person) => person.id,
          initialData: initialPersons,
        }),
      )

      const { data } = useLiveQuery((q) =>
        q
          .from({ persons: collection })
          .select(({ persons }) => ({
            id: persons.id,
            name: persons.name,
          })),
      )

      await waitForVueUpdate()

      // Capture reference to current array
      const firstArray = data.value

      // Insert a new person
      collection.utils.begin()
      collection.utils.write({
        type: `insert`,
        value: {
          id: `4`,
          name: `New Person`,
          age: 40,
          email: `new@example.com`,
          isActive: true,
          team: `team1`,
        },
      })
      collection.utils.commit()

      await waitForVueUpdate()

      // After update, data.value should be a NEW array reference
      // (shallowRef replaces .value entirely, not mutating the existing array)
      expect(data.value).not.toBe(firstArray)
      expect(data.value.length).toBe(4)
    })
  })

  // ── 0.4 onScopeDispose cleanup ───────────────────────────────────────
  describe(`onScopeDispose cleanup (fix 0.4)`, () => {
    it(`should clean up subscription when effectScope is disposed`, async () => {
      const collection = createCollection(
        mockSyncCollectionOptions<Person>({
          id: `scope-dispose-test`,
          getKey: (person: Person) => person.id,
          initialData: initialPersons,
        }),
      )

      const scope = effectScope()
      let result: ReturnType<typeof useLiveQuery<any>> | undefined

      scope.run(() => {
        result = useLiveQuery((q) =>
          q
            .from({ persons: collection })
            .where(({ persons }) => gt(persons.age, 30))
            .select(({ persons }) => ({
              id: persons.id,
              name: persons.name,
            })),
        ) as any
      })

      await waitForVueUpdate()

      // Should have data while scope is active
      expect(result!.state.value.size).toBe(1)
      expect(result!.data.value).toHaveLength(1)

      // Dispose the scope — this should trigger onScopeDispose cleanup
      scope.stop()

      // Insert a new person after disposal
      collection.utils.begin()
      collection.utils.write({
        type: `insert`,
        value: {
          id: `4`,
          name: `Post-Disposal Person`,
          age: 40,
          email: `post@example.com`,
          isActive: true,
          team: `team1`,
        },
      })
      collection.utils.commit()

      await waitForVueUpdate()

      // After scope disposal, the subscription should be cleaned up
      // The state should NOT update with new data
      // (The reactive refs are still readable but no longer being updated)
      expect(result!.state.value.size).toBe(1) // Still 1, not 2
    })

    it(`should not warn when used outside an effectScope`, () => {
      const collection = createCollection(
        mockSyncCollectionOptions<Person>({
          id: `no-scope-warn-test`,
          getKey: (person: Person) => person.id,
          initialData: initialPersons,
        }),
      )

      // This should not throw or produce Vue warnings
      // getCurrentScope() returns undefined, so onScopeDispose is skipped
      const { state } = useLiveQuery((q) =>
        q
          .from({ persons: collection })
          .select(({ persons }) => ({
            id: persons.id,
            name: persons.name,
          })),
      )

      expect(state).toBeDefined()
    })
  })

  // ── 0.5 gcTime on hook-created collections ───────────────────────────
  describe(`gcTime for hook-created collections (fix 0.5)`, () => {
    it(`should set gcTime on collections created by query function`, async () => {
      const collection = createCollection(
        mockSyncCollectionOptions<Person>({
          id: `gctime-query-fn-test`,
          getKey: (person: Person) => person.id,
          initialData: initialPersons,
        }),
      )

      const { collection: returnedCollection } = useLiveQuery((q) =>
        q
          .from({ persons: collection })
          .select(({ persons }) => ({
            id: persons.id,
            name: persons.name,
          })),
      )

      await waitForVueUpdate()

      // The collection created internally should have gcTime set to 1 (immediate cleanup)
      expect(returnedCollection.value).toBeDefined()
      expect((returnedCollection.value as any).config.gcTime).toBe(1)
    })

    it(`should set gcTime on collections created by config object`, async () => {
      const collection = createCollection(
        mockSyncCollectionOptions<Person>({
          id: `gctime-config-test`,
          getKey: (person: Person) => person.id,
          initialData: initialPersons,
        }),
      )

      const { collection: returnedCollection } = useLiveQuery({
        query: (q) =>
          q
            .from({ persons: collection })
            .select(({ persons }) => ({
              id: persons.id,
              name: persons.name,
            })),
      })

      await waitForVueUpdate()

      expect(returnedCollection.value).toBeDefined()
      expect((returnedCollection.value as any).config.gcTime).toBe(1)
    })

    it(`should preserve user-specified gcTime in config objects`, async () => {
      const collection = createCollection(
        mockSyncCollectionOptions<Person>({
          id: `gctime-config-preserve-test`,
          getKey: (person: Person) => person.id,
          initialData: initialPersons,
        }),
      )

      const { collection: returnedCollection } = useLiveQuery({
        query: (q) =>
          q
            .from({ persons: collection })
            .select(({ persons }) => ({
              id: persons.id,
              name: persons.name,
            })),
        gcTime: 60000, // User specifies custom GC time
      })

      await waitForVueUpdate()

      // User-specified gcTime should take precedence over the default
      expect(returnedCollection.value).toBeDefined()
      expect((returnedCollection.value as any).config.gcTime).toBe(60000)
    })

    it(`should not override gcTime on pre-created collections`, async () => {
      const collection = createCollection(
        mockSyncCollectionOptions<Person>({
          id: `gctime-precreated-test`,
          getKey: (person: Person) => person.id,
          initialData: initialPersons,
        }),
      )

      const preCreated = createLiveQueryCollection({
        query: (q) =>
          q
            .from({ persons: collection })
            .select(({ persons }) => ({
              id: persons.id,
              name: persons.name,
            })),
        startSync: true,
        gcTime: 60000, // User-specified GC time
      })

      const { collection: returnedCollection } = useLiveQuery(preCreated)

      await waitForVueUpdate()

      // Pre-created collection should keep its original gcTime
      expect(returnedCollection.value).toBe(preCreated)
      expect((returnedCollection.value as any).config.gcTime).toBe(60000)
    })
  })

  // ── 0.6 instanceof CollectionImpl detection ──────────────────────────
  describe(`instanceof CollectionImpl detection (fix 0.6)`, () => {
    it(`should correctly detect pre-created live query collections`, async () => {
      const collection = createCollection(
        mockSyncCollectionOptions<Person>({
          id: `instanceof-detect-test`,
          getKey: (person: Person) => person.id,
          initialData: initialPersons,
        }),
      )

      const preCreated = createLiveQueryCollection({
        query: (q) =>
          q
            .from({ persons: collection })
            .where(({ persons }) => gt(persons.age, 30))
            .select(({ persons }) => ({
              id: persons.id,
              name: persons.name,
            })),
        startSync: true,
      })

      const { collection: returnedCollection, data } =
        useLiveQuery(preCreated)

      await waitForVueUpdate()

      // Should return the exact same instance (detected as collection, not re-wrapped)
      expect(returnedCollection.value).toBe(preCreated)
      expect(data.value).toHaveLength(1)
    })

    it(`should reject a plain object that duck-types as a collection`, () => {
      // A duck-typed object should NOT be treated as a collection.
      // With instanceof CollectionImpl, it's correctly rejected and
      // falls through to createLiveQueryCollection which fails on the
      // invalid config — this is the desired behavior.
      const fakeCollection = {
        subscribeChanges: () => ({ unsubscribe: () => {} }),
        entries: () => [].entries(),
        values: () => [].values(),
        status: `ready`,
        config: {},
        id: `fake`,
      }

      // instanceof CollectionImpl rejects this, so it's treated as a config
      // object — which is invalid and throws. This is correct: only real
      // CollectionImpl instances should be passed directly.
      expect(() => {
        useLiveQuery(fakeCollection as any)
      }).toThrow()
    })
  })

  // ── 0.9 isEnabled return field ────────────────────────────────────────
  describe(`isEnabled return field (fix 0.9)`, () => {
    it(`should be true for active queries`, async () => {
      const collection = createCollection(
        mockSyncCollectionOptions<Person>({
          id: `is-enabled-active-test`,
          getKey: (person: Person) => person.id,
          initialData: initialPersons,
        }),
      )

      const { isEnabled, status } = useLiveQuery((q) =>
        q
          .from({ persons: collection })
          .select(({ persons }) => ({
            id: persons.id,
            name: persons.name,
          })),
      )

      await waitForVueUpdate()

      expect(isEnabled.value).toBe(true)
      expect(status.value).not.toBe(`disabled`)
    })

    it(`should report isReady as true for disabled queries (nothing to wait for)`, () => {
      // Disabled queries are considered "ready" because there is no pending
      // data to wait for — matching the React adapter's behavior
      const { isEnabled, isReady, isLoading } = useLiveQuery(
         
        (_q) => {
          return undefined
        },
      )

      expect(isEnabled.value).toBe(false)
      expect(isReady.value).toBe(true)
      expect(isLoading.value).toBe(false)
    })

    it(`should be false for disabled queries (returning undefined)`, () => {
      const { isEnabled, status } = useLiveQuery(
         
        (_q) => {
          return undefined
        },
      )

      expect(isEnabled.value).toBe(false)
      expect(status.value).toBe(`disabled`)
    })

    it(`should be false for disabled queries (returning null)`, () => {
      const { isEnabled, status } = useLiveQuery(
         
        (_q) => {
          return null
        },
      )

      expect(isEnabled.value).toBe(false)
      expect(status.value).toBe(`disabled`)
    })

    it(`should toggle when query transitions between enabled and disabled`, async () => {
      const collection = createCollection(
        mockSyncCollectionOptions<Person>({
          id: `is-enabled-toggle-test`,
          getKey: (person: Person) => person.id,
          initialData: initialPersons,
        }),
      )

      const enabled = ref(true)
      const { isEnabled, data } = useLiveQuery(
        (q) => {
          if (!enabled.value) return undefined
          return q
            .from({ persons: collection })
            .select(({ persons }) => ({
              id: persons.id,
              name: persons.name,
            }))
        },
        [() => enabled.value],
      )

      await waitForVueUpdate()

      expect(isEnabled.value).toBe(true)
      expect(data.value.length).toBe(3)

      // Disable
      enabled.value = false
      await waitFor(() => {
        expect(isEnabled.value).toBe(false)
      })

      // Re-enable
      enabled.value = true
      await waitFor(() => {
        expect(isEnabled.value).toBe(true)
      })
      await waitFor(() => {
        expect(data.value.length).toBe(3)
      })
    })
  })

  // ── 0.3 BaseQueryBuilder probe (disabled query detection) ────────────
  describe(`BaseQueryBuilder probe for disabled queries (fix 0.3)`, () => {
    it(`should correctly detect disabled state without throwing sentinel errors`, async () => {
      const collection = createCollection(
        mockSyncCollectionOptions<Person>({
          id: `probe-no-sentinel-test`,
          getKey: (person: Person) => person.id,
          initialData: initialPersons,
        }),
      )

      const enabled = ref(false)

      // The old implementation would throw Error('__DISABLED_QUERY__') and catch it.
      // The new implementation probes with BaseQueryBuilder and checks for null/undefined.
      // Both should produce the same result, but the new way is cleaner.
      const result = useLiveQuery(
        (q) => {
          if (!enabled.value) return undefined
          return q
            .from({ persons: collection })
            .select(({ persons }) => ({
              id: persons.id,
              name: persons.name,
            }))
        },
        [() => enabled.value],
      )

      // Should be in disabled state
      expect(result.status.value).toBe(`disabled`)
      expect(result.collection.value).toBeNull()
      expect(result.data.value).toEqual([])

      // Enable → should work normally
      enabled.value = true
      await waitFor(() => {
        expect(result.status.value).not.toBe(`disabled`)
      })
      await waitFor(() => {
        expect(result.data.value.length).toBe(3)
      })
    })
  })
})

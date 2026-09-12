/** Reactive backend updates with complete owned rows and unchanged-peer frames. */
import { describe, expect, it, vi } from 'vitest'
import { createLiveQueryCollection, gt } from '@tanstack/db'
import { waitForQueryData } from '../utils/helpers'
import {
  assertUserRows,
  captureUserRows,
  userFixture,
  waitForOwnedUser,
  waitForUserRows,
  withOwnedUsers,
} from './mutations.suite'
import type { E2ETestConfig, User } from '../types'

export function createLiveUpdatesTestSuite(
  getConfig: () => Promise<E2ETestConfig>,
) {
  describe('Live Updates Suite', () => {
    describe('Reactive Updates', () => {
      it('should receive updates when backend data changes', async () => {
        const config = await getConfig()
        await withOwnedUsers(config, async (owned) => {
          const query = owned.track(
            createLiveQueryCollection((q) =>
              q
                .from({ user: config.collections.onDemand.users })
                .where(({ user }) => gt(user.age, 30)),
            ),
          )
          await query.preload()
          await waitForQueryData(query, { minSize: 1 })
          const peers = captureUserRows(query.values())
          const initialSize = query.size
          expect(initialSize).toBeGreaterThan(0)
          const row = userFixture('Live Update User', 45)
          const remove = await owned.insert(row)
          const observed = await waitForUserRows(query, [...peers, row])
          expect(query.size).toBe(initialSize + 1)
          const wrongKey = structuredClone(observed)
          wrongKey[0]!.id += '-wrong'
          expect(() => assertUserRows(wrongKey, [...peers, row])).toThrow()
          const wrongMetadata = structuredClone(observed)
          const metadataPeer = wrongMetadata.find(
            (value) => value.metadata !== null,
          )
          if (!metadataPeer || metadataPeer.metadata === null)
            throw new Error('Expected a captured peer with non-null metadata')
          Object.defineProperty(metadataPeer.metadata, 'unexpected', {
            value: undefined,
            enumerable: true,
          })
          expect(
            Object.prototype.hasOwnProperty.call(
              metadataPeer.metadata,
              'unexpected',
            ),
          ).toBe(true)
          expect(() => assertUserRows(wrongMetadata, [...peers, row])).toThrow()
          await remove()
          await waitForUserRows(query, peers)
          assertUserRows(observed, [...peers, row])
        })
      })

      it('should add new records that match query predicate', async () => {
        const config = await getConfig()
        await withOwnedUsers(config, async (owned) => {
          const query = owned.track(
            createLiveQueryCollection((q) =>
              q
                .from({ user: config.collections.onDemand.users })
                .where(({ user }) => gt(user.age, 30)),
            ),
          )
          await query.preload()
          await waitForQueryData(query, { minSize: 1 })
          const peers = captureUserRows(query.values())
          const initialSize = query.size
          expect(initialSize).toBeGreaterThan(0)
          const row = userFixture('Matching User', 35)
          const remove = await owned.insert(row)
          await waitForUserRows(query, [...peers, row])
          expect(query.size).toBe(initialSize + 1)
          await remove()
          await waitForUserRows(query, peers)
        })
      })

      it('should remove records that no longer match predicate', async () => {
        const config = await getConfig()
        await withOwnedUsers(config, async (owned) => {
          const query = owned.track(
            createLiveQueryCollection((q) =>
              q
                .from({ user: config.collections.onDemand.users })
                .where(({ user }) => gt(user.age, 30)),
            ),
          )
          await query.preload()
          await waitForQueryData(query, { minSize: 1 })
          const peers = captureUserRows(query.values())
          const row = userFixture('Live Exit User', 45)
          await owned.insert(row)
          await waitForUserRows(query, [...peers, row])
          const initialSize = query.size
          expect(initialSize).toBeGreaterThan(0)
          await config.mutations!.updateUser(row.id, { age: 25 })
          await waitForOwnedUser(config, { ...row, age: 25 })
          await waitForUserRows(query, peers)
          expect(query.size).toBe(initialSize - 1)
          expect(query.has(row.id)).toBe(false)
        })
      })
    })

    describe('Subscription Lifecycle', () => {
      it('should receive updates when subscribed', async () => {
        const config = await getConfig()
        await withOwnedUsers(config, async (owned) => {
          const query = owned.track(
            createLiveQueryCollection((q) =>
              q.from({ user: config.collections.onDemand.users }),
            ),
          )
          await query.preload()
          await waitForQueryData(query, { minSize: 1 })
          const peers = captureUserRows(query.values())
          let changeCount = 0
          const events: Array<{
            type: string
            key: string | number
            value: User
          }> = []
          const callbacks: Array<{
            events: typeof events
            rows: Array<User>
          }> = []
          const subscription = query.subscribeChanges((changes) => {
            changeCount++
            const batch: typeof events = []
            for (const change of changes) {
              batch.push({
                type: change.type,
                key: change.key,
                value: captureUserRows([change.value])[0]!,
              })
            }
            events.push(...batch)
            // Empty event callbacks are retained with their complete public rows.
            callbacks.push({
              events: batch,
              rows: captureUserRows(query.values()),
            })
          })
          owned.track({
            cleanup() {
              subscription.unsubscribe()
              return Promise.resolve()
            },
          })
          const row = userFixture(
            'Subscription Test User',
            28,
            'sub@example.com',
          )
          const remove = await owned.insert(row)
          await waitForUserRows(query, [...peers, row])
          await vi.waitFor(() => expect(changeCount).toBeGreaterThan(0), {
            timeout: 5000,
          })
          expect(changeCount).toBeGreaterThan(0)
          const expectOwnedInsert = (captured: typeof events) => {
            // Every admitted event uses this unprojected User query's key law,
            // including peer events that are not the owned insertion below.
            for (const event of captured) {
              expect(typeof event.key).toBe('string')
              expect(event.key).toBe(event.value.id)
            }
            const inserts = captured.filter(
              (event) => event.type === 'insert' && event.value.id === row.id,
            )
            expect(inserts.length).toBeGreaterThan(0)
            for (const event of inserts) {
              expect(event.key).toBe(row.id)
              expect(event.value).toStrictEqual(row)
            }
          }
          expectOwnedInsert(events)
          const wrongEvent = structuredClone(events)
          for (const event of wrongEvent) {
            if (event.value.id === row.id) event.value.age += 1
          }
          expect(() => expectOwnedInsert(wrongEvent)).toThrow()
          const wrongKey = structuredClone(events)
          for (const event of wrongKey) {
            if (event.value.id === row.id) event.key = row.id + '-wrong'
          }
          expect(() => expectOwnedInsert(wrongKey)).toThrow()
          const wrongFirstKey = structuredClone(events)
          wrongFirstKey[0]!.key = wrongFirstKey[0]!.value.id + '-wrong'
          expect(() => expectOwnedInsert(wrongFirstKey)).toThrow()
          expect(callbacks.length).toBeGreaterThan(0)
          let inserted = false
          for (const callback of callbacks) {
            inserted ||= callback.events.some(
              (event) => event.type === 'insert' && event.value.id === row.id,
            )
            // Empty callbacks before the owned insert can expose the old world.
            assertUserRows(callback.rows, inserted ? [...peers, row] : peers)
          }
          const archived = structuredClone(events)
          subscription.unsubscribe()
          await remove()
          await waitForUserRows(query, peers)
          expect(events).toStrictEqual(archived)
        })
      })
    })

    describe('Update Existing Records', () => {
      it('should update existing records in query results', async () => {
        const config = await getConfig()
        await withOwnedUsers(config, async (owned) => {
          const query = owned.track(
            createLiveQueryCollection((q) =>
              q.from({ user: config.collections.onDemand.users }),
            ),
          )
          await query.preload()
          await waitForQueryData(query, { minSize: 1 })
          const peers = captureUserRows(query.values())
          const row = userFixture('Existing Owned User', 38)
          await owned.insert(row)
          await waitForUserRows(query, [...peers, row])
          const originalAge = row.age
          await config.mutations!.updateUser(row.id, { age: originalAge + 10 })
          const updated = { ...row, age: originalAge + 10 }
          await waitForOwnedUser(config, updated)
          await waitForUserRows(query, [...peers, updated])
          expect(query.get(row.id)?.age).toBe(originalAge + 10)
        })
      })
    })
  })
}

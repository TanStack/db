/**
 * Reactive update and update-in-place cases whose expectations are written
 * out row by row. The notification history and unsubscribe laws that the
 * oracle suite declares are in live-updates-oracle.suite.ts, which runs this
 * suite too.
 */
import { describe, expect, it } from 'vitest'
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
import type { E2ETestConfig } from '../types'

export function createLiveUpdatesUnitTestSuite(
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
          row.metadata = { owned: true }
          const remove = await owned.insert(row)
          const observed = await waitForUserRows(query, [...peers, row])
          expect(query.size).toBe(initialSize + 1)
          const wrongKey = structuredClone(observed)
          wrongKey[0]!.id += '-wrong'
          expect(() => assertUserRows(wrongKey, [...peers, row])).toThrow()
          const wrongMetadata = structuredClone(observed)
          const metadataPeer = wrongMetadata.find(
            (value) => value.id === row.id,
          )
          if (!metadataPeer || metadataPeer.metadata === null)
            throw new Error('Expected the owned row with non-null metadata')
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

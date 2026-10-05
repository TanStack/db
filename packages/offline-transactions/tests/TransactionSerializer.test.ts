import { createCollection } from '@tanstack/db'
import { describe, expect, it } from 'vitest'
import { TransactionSerializer } from '../src/outbox/TransactionSerializer'
import type { PendingMutation } from '@tanstack/db'
import type { OfflineTransaction } from '../src/types'

const mockCollection = createCollection<Record<string, unknown>, string>({
  id: `test-collection`,
  getKey: (item) => {
    if (typeof item.id !== `string`) {
      throw new Error(`Expected serialized test records to have a string id`)
    }
    return item.id
  },
  startSync: true,
  sync: {
    sync: ({ markReady }) => markReady(),
  },
})

function createSerializer(): TransactionSerializer {
  return new TransactionSerializer({
    'test-collection': mockCollection,
  })
}

function createInsertMutation(
  modified: Record<string, unknown>,
): PendingMutation {
  return {
    globalKey: `key-1`,
    type: `insert`,
    modified,
    original: {},
    collection: mockCollection,
    mutationId: `mut-1`,
    key: `1`,
    changes: modified,
    metadata: undefined,
    syncMetadata: {},
    optimistic: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

function createTransaction(
  modified: Record<string, unknown>,
  createdAt = new Date(`2024-01-01T00:00:00.000Z`),
): OfflineTransaction {
  return {
    id: `tx-1`,
    createdAt,
    mutationFnName: `syncData`,
    mutations: [createInsertMutation(modified)],
    keys: [`key-1`],
    idempotencyKey: `idempotency-key-1`,
    retryCount: 0,
    nextAttemptAt: 0,
    version: 1,
  }
}

function expectDate(value: unknown): Date {
  expect(value).toBeInstanceOf(Date)
  if (!(value instanceof Date)) {
    throw new Error(`Expected value to be a Date`)
  }
  return value
}

function expectRecord(value: unknown): Record<string, unknown> {
  expect(value).toBeTypeOf(`object`)
  if (!isRecord(value)) {
    throw new Error(`Expected value to be a record`)
  }
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === `object` && value !== null && !Array.isArray(value)
}

describe(`TransactionSerializer`, () => {
  describe(`date handling`, () => {
    it(`should preserve plain ISO date strings without converting to Date objects`, () => {
      const serializer = createSerializer()

      // This is the bug: a plain string that looks like an ISO date
      // should NOT be converted to a Date object after round-trip
      const isoDateString = `2024-01-15T10:30:00.000Z`
      const transaction = createTransaction({
        id: `1`,
        eventId: isoDateString,
        description: `Some event`,
      })

      // Serialize and deserialize (simulating app restart)
      const serialized = serializer.serialize(transaction)
      const deserialized = serializer.deserialize(serialized)

      // The eventId should still be a string, not a Date object
      const eventId = deserialized.mutations[0]!.modified.eventId
      expect(typeof eventId).toBe(`string`)
      expect(eventId).toBe(isoDateString)
    })

    it(`should correctly restore actual Date objects using the marker system`, () => {
      const serializer = createSerializer()
      const actualDate = new Date(`2024-01-15T10:30:00.000Z`)
      const transaction = createTransaction({
        id: `1`,
        createdAt: actualDate,
        name: `Test`,
      })

      const serialized = serializer.serialize(transaction)
      const deserialized = serializer.deserialize(serialized)

      // The createdAt should be restored as a Date object
      const restoredDate = expectDate(
        deserialized.mutations[0]!.modified.createdAt,
      )
      expect(restoredDate.toISOString()).toBe(actualDate.toISOString())
    })

    it(`should handle mixed Date objects and ISO string values correctly`, () => {
      const serializer = createSerializer()
      const actualDate = new Date(`2024-06-15T14:00:00.000Z`)
      const isoStringValue = `2024-01-15T10:30:00.000Z`
      const transaction = createTransaction({
        id: `1`,
        timestamp: actualDate,
        scheduledFor: isoStringValue,
        notes: `Meeting scheduled`,
      })

      const serialized = serializer.serialize(transaction)
      const deserialized = serializer.deserialize(serialized)
      const modified = deserialized.mutations[0]!.modified

      // The actual Date should be restored as Date
      const restoredTimestamp = expectDate(modified.timestamp)
      expect(restoredTimestamp.toISOString()).toBe(actualDate.toISOString())

      // The string should remain a string
      expect(typeof modified.scheduledFor).toBe(`string`)
      expect(modified.scheduledFor).toBe(isoStringValue)
    })

    it(`should not corrupt nested ISO string values`, () => {
      const serializer = createSerializer()
      const transaction = createTransaction({
        id: `1`,
        metadata: {
          // Nested ISO strings should also be preserved
          lastSync: `2024-03-20T08:00:00.000Z`,
          importedFrom: `external-system`,
        },
      })

      const serialized = serializer.serialize(transaction)
      const deserialized = serializer.deserialize(serialized)
      const metadata = expectRecord(
        deserialized.mutations[0]!.modified.metadata,
      )

      expect(typeof metadata.lastSync).toBe(`string`)
      expect(metadata.lastSync).toBe(`2024-03-20T08:00:00.000Z`)
    })

    it(`should correctly restore top-level createdAt as Date`, () => {
      const serializer = createSerializer()
      const transactionDate = new Date(`2024-05-15T12:30:00.000Z`)
      const transaction = createTransaction({ id: `1` }, transactionDate)

      const serialized = serializer.serialize(transaction)
      const deserialized = serializer.deserialize(serialized)

      // Top-level createdAt should be a Date object
      expect(deserialized.createdAt).toBeInstanceOf(Date)
      expect(deserialized.createdAt.toISOString()).toBe(
        transactionDate.toISOString(),
      )
    })
  })
})

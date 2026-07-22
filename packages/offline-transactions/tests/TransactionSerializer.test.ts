import { describe, expect, it } from 'vitest'
import { Temporal } from 'temporal-polyfill'
import { TransactionSerializer } from '../src/outbox/TransactionSerializer'
import type { OfflineTransaction } from '../src/types'
import type { PendingMutation } from '@tanstack/db'

describe(`TransactionSerializer`, () => {
  const mockCollection = {
    id: `test-collection`,
    getKeyFromItem: (item: any) => item.id,
  }

  const createSerializer = () => {
    return new TransactionSerializer({
      'test-collection': mockCollection as any,
    }, Temporal)
  }

  const createTransaction = ({
    modified,
    original = null,
    changes = {},
    metadata,
  }: {
    modified: any
    original?: any
    changes?: any
    metadata?: Record<string, any>
  }): OfflineTransaction => {
    return {
      id: `tx-1`,
      createdAt: new Date(`2024-01-01T00:00:00.000Z`),
      mutationFnName: `syncData`,
      mutations: [
        {
          globalKey: `key-1`,
          type: `insert`,
          modified,
          original,
          collection: mockCollection,
          mutationId: `mut-1`,
          key: modified.id,
          changes,
          metadata: undefined,
          syncMetadata: {},
          optimistic: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as PendingMutation,
      ],
      keys: [`key-1`],
      idempotencyKey: `idempotency-key-1`,
      retryCount: 0,
      nextAttemptAt: 0,
      metadata,
      version: 1,
    }
  }

  describe(`date handling`, () => {
    it(`should preserve plain ISO date strings without converting to Date objects`, () => {
      const serializer = createSerializer()

      // This is the bug: a plain string that looks like an ISO date
      // should NOT be converted to a Date object after round-trip
      const isoDateString = `2024-01-15T10:30:00.000Z`

      const transaction: OfflineTransaction = {
        id: `tx-1`,
        createdAt: new Date(`2024-01-01T00:00:00.000Z`),
        status: `pending`,
        mutationFnName: `syncData`,
        mutations: [
          {
            globalKey: `key-1`,
            type: `insert`,
            // This field intentionally stores an ISO date as a STRING
            // (e.g., a DB value, or a user-provided string)
            modified: {
              id: `1`,
              eventId: isoDateString, // Should remain a string!
              description: `Some event`,
            },
            original: null,
            collection: mockCollection,
            mutationId: `mut-1`,
            key: `1`,
            changes: {},
            metadata: undefined,
            syncMetadata: {},
            optimistic: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          } as PendingMutation,
        ],
      }

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

      const transaction: OfflineTransaction = {
        id: `tx-1`,
        createdAt: new Date(`2024-01-01T00:00:00.000Z`),
        status: `pending`,
        mutationFnName: `syncData`,
        mutations: [
          {
            globalKey: `key-1`,
            type: `insert`,
            modified: {
              id: `1`,
              createdAt: actualDate, // This is an actual Date object
              name: `Test`,
            },
            original: null,
            collection: mockCollection,
            mutationId: `mut-1`,
            key: `1`,
            changes: {},
            metadata: undefined,
            syncMetadata: {},
            optimistic: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          } as PendingMutation,
        ],
      }

      const serialized = serializer.serialize(transaction)
      const deserialized = serializer.deserialize(serialized)

      // The createdAt should be restored as a Date object
      const restoredDate = deserialized.mutations[0]!.modified.createdAt
      expect(restoredDate).toBeInstanceOf(Date)
      expect(restoredDate.toISOString()).toBe(actualDate.toISOString())
    })

    it(`should handle mixed Date objects and ISO string values correctly`, () => {
      const serializer = createSerializer()

      const actualDate = new Date(`2024-06-15T14:00:00.000Z`)
      const isoStringValue = `2024-01-15T10:30:00.000Z` // Plain string, not a Date

      const transaction: OfflineTransaction = {
        id: `tx-1`,
        createdAt: new Date(`2024-01-01T00:00:00.000Z`),
        status: `pending`,
        mutationFnName: `syncData`,
        mutations: [
          {
            globalKey: `key-1`,
            type: `insert`,
            modified: {
              id: `1`,
              timestamp: actualDate, // Actual Date object
              scheduledFor: isoStringValue, // Plain string that looks like ISO date
              notes: `Meeting scheduled`,
            },
            original: null,
            collection: mockCollection,
            mutationId: `mut-1`,
            key: `1`,
            changes: {},
            metadata: undefined,
            syncMetadata: {},
            optimistic: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          } as PendingMutation,
        ],
      }

      const serialized = serializer.serialize(transaction)
      const deserialized = serializer.deserialize(serialized)

      const modified = deserialized.mutations[0]!.modified

      // The actual Date should be restored as Date
      expect(modified.timestamp).toBeInstanceOf(Date)
      expect(modified.timestamp.toISOString()).toBe(actualDate.toISOString())

      // The string should remain a string
      expect(typeof modified.scheduledFor).toBe(`string`)
      expect(modified.scheduledFor).toBe(isoStringValue)
    })

    it(`should not corrupt nested ISO string values`, () => {
      const serializer = createSerializer()

      const transaction: OfflineTransaction = {
        id: `tx-1`,
        createdAt: new Date(`2024-01-01T00:00:00.000Z`),
        status: `pending`,
        mutationFnName: `syncData`,
        mutations: [
          {
            globalKey: `key-1`,
            type: `insert`,
            modified: {
              id: `1`,
              metadata: {
                // Nested ISO strings should also be preserved
                lastSync: `2024-03-20T08:00:00.000Z`,
                importedFrom: `external-system`,
              },
            },
            original: null,
            collection: mockCollection,
            mutationId: `mut-1`,
            key: `1`,
            changes: {},
            metadata: undefined,
            syncMetadata: {},
            optimistic: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          } as PendingMutation,
        ],
      }

      const serialized = serializer.serialize(transaction)
      const deserialized = serializer.deserialize(serialized)

      const lastSync = deserialized.mutations[0]!.modified.metadata.lastSync
      expect(typeof lastSync).toBe(`string`)
      expect(lastSync).toBe(`2024-03-20T08:00:00.000Z`)
    })

    it(`should correctly restore top-level createdAt as Date`, () => {
      const serializer = createSerializer()

      const transactionDate = new Date(`2024-05-15T12:30:00.000Z`)

      const transaction: OfflineTransaction = {
        id: `tx-1`,
        createdAt: transactionDate,
        status: `pending`,
        mutationFnName: `syncData`,
        mutations: [
          {
            globalKey: `key-1`,
            type: `insert`,
            modified: { id: `1` },
            original: null,
            collection: mockCollection,
            mutationId: `mut-1`,
            key: `1`,
            changes: {},
            metadata: undefined,
            syncMetadata: {},
            optimistic: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          } as PendingMutation,
        ],
      }

      const serialized = serializer.serialize(transaction)
      const deserialized = serializer.deserialize(serialized)

      // Top-level createdAt should be a Date object
      expect(deserialized.createdAt).toBeInstanceOf(Date)
      expect(deserialized.createdAt.toISOString()).toBe(
        transactionDate.toISOString(),
      )
    })
  })

  describe(`Temporal handling`, () => {
    it(`should restore Temporal values in mutation data`, () => {
      const serializer = createSerializer()
      const temporalValues = {
        duration: Temporal.Duration.from({ hours: 1, minutes: 30 }),
        instant: Temporal.Instant.from(`2024-01-15T10:30:00Z`),
        plainDate: Temporal.PlainDate.from(`2024-01-15`),
        plainDateTime: Temporal.PlainDateTime.from(`2024-01-15T10:30:00`),
        plainMonthDay: Temporal.PlainMonthDay.from(`01-15`),
        plainTime: Temporal.PlainTime.from(`10:30:00`),
        plainYearMonth: Temporal.PlainYearMonth.from(`2024-01`),
        zonedDateTime: Temporal.ZonedDateTime.from(
          `2024-01-15T10:30:00+00:00[UTC]`,
        ),
      }

      const transaction = createTransaction({
        modified: {
          id: `1`,
          temporalValues,
        },
        original: {
          id: `1`,
          dueDate: temporalValues.plainDate,
        },
        changes: {
          temporalValues,
        },
      })

      const serialized = serializer.serialize(transaction)
      const deserialized = serializer.deserialize(serialized)

      const restoredValues = deserialized.mutations[0]!.modified.temporalValues
      for (const [key, originalValue] of Object.entries(temporalValues)) {
        const restoredValue = restoredValues[key]
        expect(restoredValue[Symbol.toStringTag]).toBe(
          originalValue[Symbol.toStringTag],
        )
        expect(restoredValue.toString()).toBe(originalValue.toString())
      }

      const restoredOriginal = deserialized.mutations[0]!.original.dueDate
      expect(restoredOriginal[Symbol.toStringTag]).toBe(`Temporal.PlainDate`)
      expect(restoredOriginal.toString()).toBe(
        temporalValues.plainDate.toString(),
      )

      const restoredChanges =
        deserialized.mutations[0]!.changes.temporalValues
      for (const [key, originalValue] of Object.entries(temporalValues)) {
        const restoredValue = restoredChanges[key]
        expect(restoredValue[Symbol.toStringTag]).toBe(
          originalValue[Symbol.toStringTag],
        )
        expect(restoredValue.toString()).toBe(originalValue.toString())
      }
    })

    it(`should restore Temporal values in transaction metadata`, () => {
      const serializer = createSerializer()
      const submittedAt = Temporal.Instant.from(`2024-01-15T10:30:00Z`)
      const scheduledFor = Temporal.PlainDate.from(`2024-02-01`)

      const transaction = createTransaction({
        modified: { id: `1`, name: `Test` },
        metadata: {
          submittedAt,
          nested: {
            scheduledFor,
          },
        },
      })

      const serialized = serializer.serialize(transaction)
      const deserialized = serializer.deserialize(serialized)

      expect(deserialized.metadata!.submittedAt[Symbol.toStringTag]).toBe(
        `Temporal.Instant`,
      )
      expect(deserialized.metadata!.submittedAt.toString()).toBe(
        submittedAt.toString(),
      )
      expect(
        deserialized.metadata!.nested.scheduledFor[Symbol.toStringTag],
      ).toBe(`Temporal.PlainDate`)
      expect(deserialized.metadata!.nested.scheduledFor.toString()).toBe(
        scheduledFor.toString(),
      )
    })
  })
})

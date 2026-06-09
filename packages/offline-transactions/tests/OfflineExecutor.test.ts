import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalStorageAdapter, startOfflineExecutor } from '../src/index'
import { MissingTemporalConstructorError } from '../src/outbox/TransactionSerializer'
import type { OfflineConfig } from '../src/types'

describe(`OfflineExecutor`, () => {
  let mockCollection: any
  let mockMutationFn: any
  let config: OfflineConfig

  beforeEach(() => {
    mockCollection = {
      id: `test-collection`,
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    }

    mockMutationFn = vi.fn().mockResolvedValue(undefined)

    config = {
      collections: {
        'test-collection': mockCollection,
      },
      mutationFns: {
        syncData: mockMutationFn,
      },
      storage: new LocalStorageAdapter(),
    }
  })

  it(`should create an offline executor`, () => {
    const executor = startOfflineExecutor(config)

    expect(executor).toBeDefined()
    expect(executor.isOfflineEnabled).toBeDefined()
  })

  it(`should create offline transactions`, () => {
    const executor = startOfflineExecutor(config)

    const transaction = executor.createOfflineTransaction({
      mutationFnName: `syncData`,
    })

    expect(transaction).toBeDefined()
    expect(transaction.id).toBeDefined()
  })

  it(`should create offline actions`, () => {
    const executor = startOfflineExecutor(config)

    const action = executor.createOfflineAction({
      mutationFnName: `syncData`,
      onMutate: (data: any) => {
        mockCollection.insert(data)
      },
    })

    expect(action).toBeDefined()
    expect(typeof action).toBe(`function`)
  })

  it(`should return empty outbox initially`, async () => {
    const executor = startOfflineExecutor(config)

    const transactions = await executor.peekOutbox()

    expect(transactions).toEqual([])
  })

  it(`should dispose cleanly`, () => {
    const executor = startOfflineExecutor(config)

    expect(() => executor.dispose()).not.toThrow()
  })

  it(`should fail initialization when replay requires unavailable Temporal constructors`, async () => {
    const globalWithTemporal = globalThis as { Temporal?: unknown }
    const originalTemporal = globalWithTemporal.Temporal
    delete globalWithTemporal.Temporal

    const serializedTransaction = JSON.stringify({
      id: `tx-temporal`,
      mutationFnName: `syncData`,
      mutations: [
        {
          globalKey: `key-1`,
          type: `insert`,
          modified: {
            __type: `Temporal`,
            type: `Temporal.PlainDate`,
            value: `2024-01-15`,
          },
          original: null,
          changes: {},
          collectionId: `test-collection`,
        },
      ],
      keys: [`key-1`],
      idempotencyKey: `idempotency-key-1`,
      createdAt: `2024-01-01T00:00:00.000Z`,
      retryCount: 0,
      nextAttemptAt: 0,
      version: 1,
    })

    try {
      const executor = startOfflineExecutor({
        ...config,
        storage: {
          get: async (key) =>
            key === `tx:tx-temporal` ? serializedTransaction : null,
          set: async () => {},
          delete: async () => {},
          keys: async () => [`tx:tx-temporal`],
          clear: async () => {},
        },
        leaderElection: {
          requestLeadership: async () => true,
          releaseLeadership: () => {},
          isLeader: () => true,
          onLeadershipChange: () => () => {},
        },
      })

      await expect(executor.waitForInit()).rejects.toBeInstanceOf(
        MissingTemporalConstructorError,
      )
      executor.dispose()
    } finally {
      if (originalTemporal !== undefined) {
        globalWithTemporal.Temporal = originalTemporal
      }
    }
  })
})

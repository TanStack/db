import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalStorageAdapter, startOfflineExecutor } from '../src/index'
import { MissingTemporalConstructorError } from '../src/outbox/TransactionSerializer'
import { FakeStorageAdapter } from './harness'
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

  it(`rejects startup when persisted native scalars cannot be restored`, async () => {
    const storage = new FakeStorageAdapter()
    await storage.set(
      `tx:native-scalar`,
      JSON.stringify({
        valueEncoding: 3,
        id: `native-scalar`,
        mutationFnName: `syncData`,
        mutations: [
          {
            globalKey: `test-collection:one`,
            type: `insert`,
            modified: {
              id: `one`,
              due: {
                __type: `Temporal`,
                type: `Temporal.PlainDate`,
                value: `2026-09-16`,
              },
            },
            original: {},
            changes: {},
            collectionId: `test-collection`,
          },
        ],
        keys: [`test-collection:one`],
        idempotencyKey: `once`,
        createdAt: new Date(0).toISOString(),
        retryCount: 0,
        nextAttemptAt: 0,
        version: 1,
      }),
    )
    const temporalGlobal = globalThis as {
      Temporal?: Record<string, unknown>
    }
    const previousTemporal = temporalGlobal.Temporal
    temporalGlobal.Temporal = {}
    const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
    const executor = startOfflineExecutor({
      ...config,
      storage,
      leaderElection: {
        requestLeadership: async () => true,
        releaseLeadership: () => {},
        isLeader: () => true,
        onLeadershipChange: () => () => {},
      },
    })

    try {
      await expect(executor.waitForInit()).rejects.toBeInstanceOf(
        MissingTemporalConstructorError,
      )
      expect(storage.snapshot()).toHaveProperty(`tx:native-scalar`)
    } finally {
      executor.dispose()
      warning.mockRestore()
      if (previousTemporal === undefined) delete temporalGlobal.Temporal
      else temporalGlobal.Temporal = previousTemporal
    }
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalStorageAdapter, startOfflineExecutor } from '../src/index'
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

  it(`keeps constructor-started initialization failures observable`, async () => {
    const storageError = new Error(`storage unavailable`)
    class Storage extends FakeStorageAdapter {
      override async keys(): Promise<Array<string>> {
        throw storageError
      }
    }
    const unhandled: Array<unknown> = []
    const onUnhandled = (error: unknown) => unhandled.push(error)
    process.on(`unhandledRejection`, onUnhandled)
    const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
    const executor = startOfflineExecutor({
      ...config,
      storage: new Storage(),
      leaderElection: {
        requestLeadership: async () => true,
        releaseLeadership: () => {},
        isLeader: () => true,
        onLeadershipChange: () => () => {},
      },
    })

    try {
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(unhandled).toEqual([])
      await expect(executor.waitForInit()).rejects.toBe(storageError)
    } finally {
      executor.dispose()
      warning.mockRestore()
      process.off(`unhandledRejection`, onUnhandled)
    }
  })

  it(`identifies unreadable rows for targeted removal before restart`, async () => {
    const storage = new FakeStorageAdapter()
    const record = (id: string, metadata: Record<string, unknown>) =>
      JSON.stringify({
        valueEncoding: 3,
        id,
        mutationFnName: `syncData`,
        mutations: [],
        keys: [],
        idempotencyKey: `${id}/once`,
        createdAt: new Date(0).toISOString(),
        retryCount: 0,
        nextAttemptAt: 0,
        metadata,
        version: 1,
      })
    await storage.set(
      `tx:native-scalar`,
      record(`native-scalar`, {
        due: {
          __type: `Temporal`,
          type: `Temporal.PlainDate`,
          value: `2026-09-16`,
        },
      }),
    )
    await storage.set(`tx:readable`, record(`readable`, { note: `safe` }))
    const temporalGlobal = globalThis as {
      Temporal?: Record<string, unknown>
    }
    const previousTemporal = temporalGlobal.Temporal
    temporalGlobal.Temporal = {}
    const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
    const unhandled: Array<unknown> = []
    const onUnhandled = (error: unknown) => unhandled.push(error)
    process.on(`unhandledRejection`, onUnhandled)
    const calls: Array<{ id: string; metadata: unknown }> = []
    let firstExecutor: ReturnType<typeof startOfflineExecutor> | undefined
    let secondExecutor: ReturnType<typeof startOfflineExecutor> | undefined
    const leaderElection = {
      requestLeadership: async () => true,
      releaseLeadership: () => {},
      isLeader: () => true,
      onLeadershipChange: () => () => {},
    }

    try {
      mockMutationFn.mockImplementation(
        ({ transaction }: { transaction: { id: string; metadata: unknown } }) =>
          calls.push({ id: transaction.id, metadata: transaction.metadata }),
      )
      firstExecutor = startOfflineExecutor({
        ...config,
        storage,
        leaderElection,
      })
      await expect(firstExecutor.waitForInit()).rejects.toThrow(
        /transaction native-scalar/,
      )
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(calls).toEqual([])
      expect(storage.snapshot()).toHaveProperty(`tx:native-scalar`)
      expect(storage.snapshot()).toHaveProperty(`tx:readable`)
      expect(unhandled).toEqual([])

      await firstExecutor.removeFromOutbox(`native-scalar`)
      firstExecutor.dispose()
      const recoveredReplay = new Promise<void>((resolve) => {
        mockMutationFn.mockImplementation(
          ({
            transaction,
          }: {
            transaction: { id: string; metadata: unknown }
          }) => {
            calls.push({ id: transaction.id, metadata: transaction.metadata })
            if (transaction.id === `readable`) resolve()
          },
        )
      })
      secondExecutor = startOfflineExecutor({
        ...config,
        storage,
        leaderElection,
      })
      await expect(secondExecutor.waitForInit()).resolves.toBeUndefined()
      await recoveredReplay
      expect(calls).toEqual([
        {
          id: `readable`,
          metadata: { note: `safe` },
        },
      ])
      expect(storage.snapshot()).toEqual({})
      expect(warning).toHaveBeenCalledWith(
        `Failed to initialize offline executor:`,
        expect.objectContaining({
          message: expect.stringMatching(/transaction native-scalar/),
        }),
      )
    } finally {
      firstExecutor?.dispose()
      secondExecutor?.dispose()
      process.off(`unhandledRejection`, onUnhandled)
      warning.mockRestore()
      if (previousTemporal === undefined) delete temporalGlobal.Temporal
      else temporalGlobal.Temporal = previousTemporal
    }
  })
})

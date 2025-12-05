import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalStorageAdapter, startOfflineExecutor } from '../src/index'
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
})

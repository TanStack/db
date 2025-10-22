import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createCollection } from "@tanstack/db"
import {
  IndexedDBAdapter,
  LocalStorageAdapter,
  startOfflineExecutor,
} from "../src/index"
import type { OfflineConfig, StorageDiagnostic } from "../src/types"

const waitUntil = async (
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 5000,
  intervalMs = 20
) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  throw new Error(`Timed out waiting for condition`)
}

describe(`storage failure handling`, () => {
  let mockCollection: any
  let mockMutationFn: any
  let baseConfig: OfflineConfig

  beforeEach(() => {
    mockCollection = createCollection({
      id: `test-collection`,
      getKey: (item: any) => item.id,
      sync: {
        sync: () => {},
      },
    })

    mockMutationFn = vi.fn().mockResolvedValue(undefined)

    baseConfig = {
      collections: {
        "test-collection": mockCollection,
      },
      mutationFns: {
        syncData: mockMutationFn,
      },
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it(`falls back to localStorage when IndexedDB fails with SecurityError`, async () => {
    // Mock IndexedDB to fail with SecurityError
    const securityError = new Error(`IndexedDB blocked`)
    securityError.name = `SecurityError`

    vi.spyOn(IndexedDBAdapter, `probe`).mockResolvedValue({
      available: false,
      error: securityError,
    })

    // Mock localStorage to succeed
    vi.spyOn(LocalStorageAdapter, `probe`).mockReturnValue({
      available: true,
    })

    const executor = startOfflineExecutor(baseConfig)

    // Wait for initialization to complete
    await waitUntil(
      () => executor.storageDiagnostic.message !== `Initializing storage...`
    )

    // Should be in offline mode using localStorage
    expect(executor.mode).toBe(`offline`)
    expect(executor.storageDiagnostic.code).toBe(`INDEXEDDB_UNAVAILABLE`)
    expect(executor.storageDiagnostic.message).toContain(
      `localStorage fallback`
    )
    expect(executor.storageDiagnostic.error).toBe(securityError)

    executor.dispose()
  })

  it(`goes online-only when both storage types fail with SecurityError`, async () => {
    const idbSecurityError = new Error(`IndexedDB blocked`)
    idbSecurityError.name = `SecurityError`

    const lsSecurityError = new Error(`localStorage blocked`)
    lsSecurityError.name = `SecurityError`

    vi.spyOn(IndexedDBAdapter, `probe`).mockResolvedValue({
      available: false,
      error: idbSecurityError,
    })

    vi.spyOn(LocalStorageAdapter, `probe`).mockReturnValue({
      available: false,
      error: lsSecurityError,
    })

    let capturedDiagnostic: StorageDiagnostic | undefined

    const config: OfflineConfig = {
      ...baseConfig,
      onStorageFailure: (diagnostic) => {
        capturedDiagnostic = diagnostic
      },
    }

    const executor = startOfflineExecutor(config)

    await waitUntil(
      () => executor.storageDiagnostic.message !== `Initializing storage...`
    )

    // Should be in online-only mode
    expect(executor.mode).toBe(`online-only`)
    expect(executor.storageDiagnostic.code).toBe(`STORAGE_BLOCKED`)
    expect(executor.storageDiagnostic.message).toContain(`private mode`)
    expect(executor.isOfflineEnabled).toBe(false)

    // onStorageFailure callback should have been called
    expect(capturedDiagnostic).toBeDefined()
    expect(capturedDiagnostic?.code).toBe(`STORAGE_BLOCKED`)

    executor.dispose()
  })

  it(`goes online-only when storage quota is exceeded`, async () => {
    const idbQuotaError = new Error(`Quota exceeded`)
    idbQuotaError.name = `QuotaExceededError`

    const lsQuotaError = new Error(`Quota exceeded`)
    lsQuotaError.name = `QuotaExceededError`

    vi.spyOn(IndexedDBAdapter, `probe`).mockResolvedValue({
      available: false,
      error: idbQuotaError,
    })

    vi.spyOn(LocalStorageAdapter, `probe`).mockReturnValue({
      available: false,
      error: lsQuotaError,
    })

    let capturedDiagnostic: StorageDiagnostic | undefined

    const config: OfflineConfig = {
      ...baseConfig,
      onStorageFailure: (diagnostic) => {
        capturedDiagnostic = diagnostic
      },
    }

    const executor = startOfflineExecutor(config)

    await waitUntil(
      () => executor.storageDiagnostic.message !== `Initializing storage...`
    )

    // Should be in online-only mode with QUOTA_EXCEEDED
    expect(executor.mode).toBe(`online-only`)
    expect(executor.storageDiagnostic.code).toBe(`QUOTA_EXCEEDED`)
    expect(executor.storageDiagnostic.message).toContain(`quota exceeded`)

    // onStorageFailure callback should have been called
    expect(capturedDiagnostic).toBeDefined()
    expect(capturedDiagnostic?.code).toBe(`QUOTA_EXCEEDED`)

    executor.dispose()
  })

  it(`goes online-only with unknown error for other storage failures`, async () => {
    const idbUnknownError = new Error(`Something went wrong`)
    idbUnknownError.name = `InvalidStateError`

    const lsUnknownError = new Error(`Something else went wrong`)

    vi.spyOn(IndexedDBAdapter, `probe`).mockResolvedValue({
      available: false,
      error: idbUnknownError,
    })

    vi.spyOn(LocalStorageAdapter, `probe`).mockReturnValue({
      available: false,
      error: lsUnknownError,
    })

    const executor = startOfflineExecutor(baseConfig)

    await waitUntil(
      () => executor.storageDiagnostic.message !== `Initializing storage...`
    )

    // Should be in online-only mode with UNKNOWN_ERROR
    expect(executor.mode).toBe(`online-only`)
    expect(executor.storageDiagnostic.code).toBe(`UNKNOWN_ERROR`)
    expect(executor.storageDiagnostic.message).toContain(`unknown error`)

    executor.dispose()
  })

  it(`bypasses probe when custom storage adapter is provided`, async () => {
    const probeSpy = vi.spyOn(IndexedDBAdapter, `probe`)
    const lsProbeSpy = vi.spyOn(LocalStorageAdapter, `probe`)

    // Create a custom storage adapter
    const customStorage = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      keys: vi.fn().mockResolvedValue([]),
      clear: vi.fn().mockResolvedValue(undefined),
    }

    const config: OfflineConfig = {
      ...baseConfig,
      storage: customStorage,
    }

    const executor = startOfflineExecutor(config)

    await waitUntil(
      () => executor.storageDiagnostic.message !== `Initializing storage...`
    )

    // Should be in offline mode
    expect(executor.mode).toBe(`offline`)
    expect(executor.storageDiagnostic.code).toBe(`STORAGE_AVAILABLE`)
    expect(executor.storageDiagnostic.message).toContain(`custom storage`)

    // Probe methods should NOT have been called
    expect(probeSpy).not.toHaveBeenCalled()
    expect(lsProbeSpy).not.toHaveBeenCalled()

    executor.dispose()
  })

  it(`executes transactions online-only when storage fails`, async () => {
    // Force both storage types to fail
    const error = new Error(`Storage blocked`)
    error.name = `SecurityError`

    vi.spyOn(IndexedDBAdapter, `probe`).mockResolvedValue({
      available: false,
      error,
    })

    vi.spyOn(LocalStorageAdapter, `probe`).mockReturnValue({
      available: false,
      error,
    })

    let mutationCalled = false
    const mutationFn = vi.fn().mockImplementation(() => {
      mutationCalled = true
      return Promise.resolve({ ok: true })
    })

    const config: OfflineConfig = {
      ...baseConfig,
      mutationFns: {
        syncData: mutationFn,
      },
    }

    const executor = startOfflineExecutor(config)

    await waitUntil(() => executor.mode === `online-only`)

    // Create and execute a transaction
    const tx = executor.createOfflineTransaction({
      mutationFnName: `syncData`,
      autoCommit: false,
    })

    tx.mutate(() => {
      mockCollection.insert({ id: `test-1`, value: `test` })
    })

    await tx.commit()

    // Transaction should have executed immediately
    expect(mutationCalled).toBe(true)
    expect(mutationFn).toHaveBeenCalledOnce()

    // Should NOT be in outbox (no storage available)
    const outbox = await executor.peekOutbox()
    expect(outbox).toEqual([])

    executor.dispose()
  })

  it(`allows transactions to succeed even without outbox persistence`, async () => {
    // Simulate storage failure
    const error = new Error(`Storage unavailable`)
    error.name = `SecurityError`

    vi.spyOn(IndexedDBAdapter, `probe`).mockResolvedValue({
      available: false,
      error,
    })

    vi.spyOn(LocalStorageAdapter, `probe`).mockReturnValue({
      available: false,
      error,
    })

    const results: Array<string> = []

    const mutationFn = vi.fn().mockImplementation(() => {
      results.push(`mutation-executed`)
      return Promise.resolve({ ok: true })
    })

    const config: OfflineConfig = {
      ...baseConfig,
      mutationFns: {
        syncData: mutationFn,
      },
    }

    const executor = startOfflineExecutor(config)

    await waitUntil(() => executor.mode === `online-only`)

    // Create multiple transactions
    const tx1 = executor.createOfflineTransaction({
      mutationFnName: `syncData`,
      autoCommit: false,
    })
    tx1.mutate(() => {
      mockCollection.insert({ id: `test-1`, value: `first` })
    })

    const tx2 = executor.createOfflineTransaction({
      mutationFnName: `syncData`,
      autoCommit: false,
    })
    tx2.mutate(() => {
      mockCollection.insert({ id: `test-2`, value: `second` })
    })

    // Both should execute and complete
    await tx1.commit()
    await tx2.commit()

    expect(results).toHaveLength(2)
    expect(mutationFn).toHaveBeenCalledTimes(2)

    executor.dispose()
  })

  it(`handles mixed failure scenarios - IndexedDB generic error, localStorage SecurityError`, async () => {
    const idbError = new Error(`Database corrupted`)
    idbError.name = `DatabaseError`

    const lsError = new Error(`localStorage blocked`)
    lsError.name = `SecurityError`

    vi.spyOn(IndexedDBAdapter, `probe`).mockResolvedValue({
      available: false,
      error: idbError,
    })

    vi.spyOn(LocalStorageAdapter, `probe`).mockReturnValue({
      available: false,
      error: lsError,
    })

    const executor = startOfflineExecutor(baseConfig)

    await waitUntil(
      () => executor.storageDiagnostic.message !== `Initializing storage...`
    )

    // Should detect SecurityError and use STORAGE_BLOCKED
    expect(executor.mode).toBe(`online-only`)
    expect(executor.storageDiagnostic.code).toBe(`STORAGE_BLOCKED`)

    executor.dispose()
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Preferences } from '@capacitor/preferences'
import { CapacitorStorageAdapter } from '../src/storage/CapacitorStorageAdapter'

const store = new Map<string, string>()

vi.mock(`@capacitor/preferences`, () => ({
  Preferences: {
    get: vi.fn(({ key }: { key: string }) =>
      Promise.resolve({ value: store.get(key) ?? null }),
    ),
    set: vi.fn(({ key, value }: { key: string; value: string }) => {
      store.set(key, value)
      return Promise.resolve()
    }),
    remove: vi.fn(({ key }: { key: string }) => {
      store.delete(key)
      return Promise.resolve()
    }),
    keys: vi.fn(() => Promise.resolve({ keys: [...store.keys()] })),
    clear: vi.fn(() => {
      store.clear()
      return Promise.resolve()
    }),
  },
}))

describe(`CapacitorStorageAdapter`, () => {
  beforeEach(() => {
    store.clear()
    vi.clearAllMocks()
  })

  describe(`basic CRUD operations`, () => {
    it(`should store and retrieve a value`, async () => {
      const adapter = new CapacitorStorageAdapter()

      await adapter.set(`key1`, `value1`)
      const result = await adapter.get(`key1`)

      expect(result).toBe(`value1`)
    })

    it(`should return null for non-existent keys`, async () => {
      const adapter = new CapacitorStorageAdapter()

      const result = await adapter.get(`missing`)

      expect(result).toBeNull()
    })

    it(`should delete a value`, async () => {
      const adapter = new CapacitorStorageAdapter()

      await adapter.set(`key1`, `value1`)
      await adapter.delete(`key1`)
      const result = await adapter.get(`key1`)

      expect(result).toBeNull()
    })

    it(`should overwrite existing values`, async () => {
      const adapter = new CapacitorStorageAdapter()

      await adapter.set(`key1`, `original`)
      await adapter.set(`key1`, `updated`)
      const result = await adapter.get(`key1`)

      expect(result).toBe(`updated`)
    })
  })

  describe(`prefix handling`, () => {
    it(`should use default prefix for storage keys`, async () => {
      const adapter = new CapacitorStorageAdapter()

      await adapter.set(`key1`, `value1`)

      expect(Preferences.set).toHaveBeenCalledWith({
        key: `offline-tx:key1`,
        value: `value1`,
      })
    })

    it(`should use custom prefix when provided`, async () => {
      const adapter = new CapacitorStorageAdapter(`custom:`)

      await adapter.set(`key1`, `value1`)

      expect(Preferences.set).toHaveBeenCalledWith({
        key: `custom:key1`,
        value: `value1`,
      })
    })

    it(`should pass prefixed key to get`, async () => {
      const adapter = new CapacitorStorageAdapter()

      await adapter.get(`key1`)

      expect(Preferences.get).toHaveBeenCalledWith({
        key: `offline-tx:key1`,
      })
    })

    it(`should pass prefixed key to remove`, async () => {
      const adapter = new CapacitorStorageAdapter()

      await adapter.set(`key1`, `value1`)
      await adapter.delete(`key1`)

      expect(Preferences.remove).toHaveBeenCalledWith({
        key: `offline-tx:key1`,
      })
    })
  })

  describe(`keys`, () => {
    it(`should return only keys matching the prefix`, async () => {
      const adapter = new CapacitorStorageAdapter()

      await adapter.set(`key1`, `value1`)
      await adapter.set(`key2`, `value2`)
      store.set(`other-prefix:key3`, `value3`)

      const keys = await adapter.keys()

      expect(keys).toEqual(expect.arrayContaining([`key1`, `key2`]))
      expect(keys).not.toContain(`other-prefix:key3`)
      expect(keys).toHaveLength(2)
    })

    it(`should return empty array when no keys match`, async () => {
      store.set(`other:key`, `value`)

      const adapter = new CapacitorStorageAdapter()
      const keys = await adapter.keys()

      expect(keys).toEqual([])
    })

    it(`should strip prefix from returned keys`, async () => {
      const adapter = new CapacitorStorageAdapter()

      await adapter.set(`my-key`, `value`)
      const keys = await adapter.keys()

      expect(keys).toEqual([`my-key`])
    })
  })

  describe(`clear`, () => {
    it(`should remove only prefixed keys`, async () => {
      const adapter = new CapacitorStorageAdapter()

      await adapter.set(`key1`, `value1`)
      await adapter.set(`key2`, `value2`)
      store.set(`unrelated:key`, `should-survive`)

      await adapter.clear()

      expect(store.has(`offline-tx:key1`)).toBe(false)
      expect(store.has(`offline-tx:key2`)).toBe(false)
      expect(store.get(`unrelated:key`)).toBe(`should-survive`)
    })

    it(`should handle clearing when no keys exist`, async () => {
      const adapter = new CapacitorStorageAdapter()

      await expect(adapter.clear()).resolves.toBeUndefined()
    })
  })

  describe(`probe`, () => {
    it(`should return available true when Preferences works`, async () => {
      const result = await CapacitorStorageAdapter.probe()

      expect(result).toEqual({ available: true })
    })

    it(`should return available false when set fails`, async () => {
      vi.mocked(Preferences.set).mockRejectedValueOnce(
        new Error(`Preferences unavailable`),
      )

      const result = await CapacitorStorageAdapter.probe()

      expect(result.available).toBe(false)
      expect(result.error).toBeInstanceOf(Error)
      expect(result.error!.message).toBe(`Preferences unavailable`)
    })

    it(`should return available false when read verification fails`, async () => {
      vi.mocked(Preferences.get).mockResolvedValueOnce({ value: `wrong` })

      const result = await CapacitorStorageAdapter.probe()

      expect(result.available).toBe(false)
      expect(result.error!.message).toContain(`verification failed`)
    })

    it(`should clean up the probe key after testing`, async () => {
      await CapacitorStorageAdapter.probe()

      expect(Preferences.remove).toHaveBeenCalledWith({
        key: `__offline-tx-probe__`,
      })
    })

    it(`should wrap non-Error exceptions`, async () => {
      vi.mocked(Preferences.set).mockRejectedValueOnce(`string error`)

      const result = await CapacitorStorageAdapter.probe()

      expect(result.available).toBe(false)
      expect(result.error).toBeInstanceOf(Error)
      expect(result.error!.message).toBe(`string error`)
    })
  })

  describe(`error handling`, () => {
    it(`should return null on get failure`, async () => {
      const consoleWarnSpy = vi.spyOn(console, `warn`).mockImplementation(() => {})
      vi.mocked(Preferences.get).mockRejectedValueOnce(new Error(`read error`))

      const adapter = new CapacitorStorageAdapter()
      const result = await adapter.get(`key1`)

      expect(result).toBeNull()
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        `Capacitor Preferences get failed:`,
        expect.any(Error),
      )

      consoleWarnSpy.mockRestore()
    })

    it(`should propagate set failures`, async () => {
      vi.mocked(Preferences.set).mockRejectedValueOnce(new Error(`write error`))

      const adapter = new CapacitorStorageAdapter()

      await expect(adapter.set(`key1`, `value1`)).rejects.toThrow(`write error`)
    })

    it(`should swallow delete failures silently`, async () => {
      const consoleWarnSpy = vi.spyOn(console, `warn`).mockImplementation(() => {})
      vi.mocked(Preferences.remove).mockRejectedValueOnce(new Error(`delete error`))

      const adapter = new CapacitorStorageAdapter()

      await expect(adapter.delete(`key1`)).resolves.toBeUndefined()
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        `Capacitor Preferences delete failed:`,
        expect.any(Error),
      )

      consoleWarnSpy.mockRestore()
    })

    it(`should return empty array on keys failure`, async () => {
      const consoleWarnSpy = vi.spyOn(console, `warn`).mockImplementation(() => {})
      vi.mocked(Preferences.keys).mockRejectedValueOnce(new Error(`keys error`))

      const adapter = new CapacitorStorageAdapter()
      const keys = await adapter.keys()

      expect(keys).toEqual([])
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        `Capacitor Preferences keys failed:`,
        expect.any(Error),
      )

      consoleWarnSpy.mockRestore()
    })

    it(`should swallow clear failures when keys fails`, async () => {
      const consoleWarnSpy = vi.spyOn(console, `warn`).mockImplementation(() => {})
      vi.mocked(Preferences.keys).mockRejectedValueOnce(new Error(`keys error`))

      const adapter = new CapacitorStorageAdapter()

      await expect(adapter.clear()).resolves.toBeUndefined()
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        `Capacitor Preferences keys failed:`,
        expect.any(Error),
      )

      consoleWarnSpy.mockRestore()
    })

    it(`should swallow clear failures when remove fails`, async () => {
      const consoleWarnSpy = vi.spyOn(console, `warn`).mockImplementation(() => {})
      const adapter = new CapacitorStorageAdapter()

      await adapter.set(`key1`, `value1`)
      vi.mocked(Preferences.remove).mockRejectedValueOnce(new Error(`remove error`))

      await expect(adapter.clear()).resolves.toBeUndefined()
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        `Capacitor Preferences clear failed:`,
        expect.any(Error),
      )

      consoleWarnSpy.mockRestore()
    })
  })

  describe(`isolation between adapters`, () => {
    it(`should isolate data between adapters with different prefixes`, async () => {
      const adapter1 = new CapacitorStorageAdapter(`app1:`)
      const adapter2 = new CapacitorStorageAdapter(`app2:`)

      await adapter1.set(`shared-key`, `value-from-app1`)
      await adapter2.set(`shared-key`, `value-from-app2`)

      expect(await adapter1.get(`shared-key`)).toBe(`value-from-app1`)
      expect(await adapter2.get(`shared-key`)).toBe(`value-from-app2`)
    })

    it(`should only clear keys with its own prefix`, async () => {
      const adapter1 = new CapacitorStorageAdapter(`app1:`)
      const adapter2 = new CapacitorStorageAdapter(`app2:`)

      await adapter1.set(`key`, `value1`)
      await adapter2.set(`key`, `value2`)

      await adapter1.clear()

      expect(await adapter1.get(`key`)).toBeNull()
      expect(await adapter2.get(`key`)).toBe(`value2`)
    })
  })
})

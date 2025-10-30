import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient } from '@tanstack/query-core'
import { createCollection, queryCollectionOptions } from '@tanstack/query-db-collection'
import { useCollection } from '../src/useCollection'
import type { QueryCollectionConfig } from '@tanstack/query-db-collection'

interface TestItem {
  id: string
  name: string
  value: number
}

describe('useCollection', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          gcTime: Infinity,
        },
      },
    })
  })

  describe('Pre-created collections', () => {
    it('should work with a pre-created collection', async () => {
      const items: TestItem[] = [
        { id: '1', name: 'Item 1', value: 10 },
        { id: '2', name: 'Item 2', value: 20 },
      ]

      const queryFn = vi.fn().mockResolvedValue(items)
      const queryKey = ['test', 'items']

      const collection = createCollection(
        queryCollectionOptions({
          id: 'test-collection',
          queryClient,
          queryKey,
          queryFn,
          getKey: (item: TestItem) => item.id,
          startSync: true,
        })
      )

      const { result } = renderHook(() => useCollection(collection))

      await waitFor(() => {
        expect(result.current.isReady).toBe(true)
      })

      expect(result.current.data).toHaveLength(2)
      expect(result.current.data[0]).toEqual({ id: '1', name: 'Item 1', value: 10 })
      expect(result.current.state.size).toBe(2)
      expect(result.current.collection).toBe(collection)
    })
  })

  describe('QueryCollectionConfig', () => {
    it('should create collection from QueryCollectionConfig', async () => {
      const items: TestItem[] = [
        { id: '1', name: 'Item 1', value: 10 },
        { id: '2', name: 'Item 2', value: 20 },
      ]

      const queryFn = vi.fn().mockResolvedValue(items)
      const queryKey = ['test', 'config']

      const config: QueryCollectionConfig<TestItem> = {
        id: 'test-config-collection',
        queryClient,
        queryKey,
        queryFn,
        getKey: (item: TestItem) => item.id,
      }

      const { result } = renderHook(() => useCollection(config))

      await waitFor(() => {
        expect(result.current.isReady).toBe(true)
      })

      expect(result.current.data).toHaveLength(2)
      expect(result.current.isEnabled).toBe(true)
      expect(queryFn).toHaveBeenCalled()
    })

    it('should handle queryFn closure updates correctly', async () => {
      // This is the core test for the bug fix
      let sourceData = [{ id: '1', name: 'Initial', value: 1 }]

      const queryKey = ['test', 'closure']
      let renderCount = 0

      const { result, rerender } = renderHook(
        ({ data }: { data: TestItem[] }) => {
          renderCount++
          return useCollection(
            {
              id: 'closure-test',
              queryClient,
              queryKey,
              queryFn: async () => {
                // Closure captures 'data' from props
                return data
              },
              getKey: (item: TestItem) => item.id,
            },
            [data] // Deps trigger refetch
          )
        },
        { initialProps: { data: sourceData } }
      )

      await waitFor(() => {
        expect(result.current.isReady).toBe(true)
      })

      expect(result.current.data).toHaveLength(1)
      expect(result.current.data[0].name).toBe('Initial')

      // Update source data and rerender
      sourceData = [
        { id: '1', name: 'Updated', value: 1 },
        { id: '2', name: 'New Item', value: 2 },
      ]

      await act(async () => {
        rerender({ data: sourceData })
      })

      // Wait for refetch to complete
      await waitFor(
        () => {
          expect(result.current.data).toHaveLength(2)
        },
        { timeout: 3000 }
      )

      // Verify the queryFn saw the updated data
      expect(result.current.data[0].name).toBe('Updated')
      expect(result.current.data[1].name).toBe('New Item')
    })

    it('should handle multiple source queries combining (real-world scenario)', async () => {
      // Simulate useQueries results
      type QueryResult = {
        data?: TestItem[]
        isSuccess: boolean
        dataUpdatedAt: number
      }

      let queryResults: QueryResult[] = [
        { data: undefined, isSuccess: false, dataUpdatedAt: 0 },
        { data: undefined, isSuccess: false, dataUpdatedAt: 0 },
      ]

      const queryKey = ['test', 'multiple-sources']

      const { result, rerender } = renderHook(
        ({ results }: { results: QueryResult[] }) => {
          return useCollection(
            {
              id: 'multi-source-test',
              queryClient,
              queryKey,
              queryFn: async () => {
                // Combine data from all source queries
                return results.flatMap((r) => r.data ?? [])
              },
              getKey: (item: TestItem) => item.id,
            },
            [results] // Track results as dependency
          )
        },
        { initialProps: { results: queryResults } }
      )

      await waitFor(() => {
        expect(result.current.isReady).toBe(true)
      })

      // Initially empty (queries pending)
      expect(result.current.data).toHaveLength(0)

      // Simulate first query completing
      queryResults = [
        {
          data: [
            { id: '1', name: 'From Account 1', value: 10 },
            { id: '2', name: 'From Account 1', value: 20 },
          ],
          isSuccess: true,
          dataUpdatedAt: Date.now(),
        },
        { data: undefined, isSuccess: false, dataUpdatedAt: 0 },
      ]

      await act(async () => {
        rerender({ results: queryResults })
      })

      await waitFor(() => {
        expect(result.current.data).toHaveLength(2)
      })

      expect(result.current.data[0].name).toBe('From Account 1')

      // Simulate second query completing
      queryResults = [
        {
          data: [
            { id: '1', name: 'From Account 1', value: 10 },
            { id: '2', name: 'From Account 1', value: 20 },
          ],
          isSuccess: true,
          dataUpdatedAt: Date.now(),
        },
        {
          data: [
            { id: '3', name: 'From Account 2', value: 30 },
            { id: '4', name: 'From Account 2', value: 40 },
          ],
          isSuccess: true,
          dataUpdatedAt: Date.now(),
        },
      ]

      await act(async () => {
        rerender({ results: queryResults })
      })

      await waitFor(() => {
        expect(result.current.data).toHaveLength(4)
      })

      // Verify both accounts' data is present
      expect(result.current.data).toEqual([
        { id: '1', name: 'From Account 1', value: 10 },
        { id: '2', name: 'From Account 1', value: 20 },
        { id: '3', name: 'From Account 2', value: 30 },
        { id: '4', name: 'From Account 2', value: 40 },
      ])
    })
  })

  describe('Disabled collections', () => {
    it('should handle null config', () => {
      const { result } = renderHook(() => useCollection(null))

      expect(result.current.status).toBe('disabled')
      expect(result.current.isEnabled).toBe(false)
      expect(result.current.data).toBeUndefined()
      expect(result.current.collection).toBeUndefined()
    })

    it('should handle undefined config', () => {
      const { result } = renderHook(() => useCollection(undefined))

      expect(result.current.status).toBe('disabled')
      expect(result.current.isEnabled).toBe(false)
      expect(result.current.data).toBeUndefined()
    })

    it('should transition from disabled to enabled', async () => {
      const items: TestItem[] = [{ id: '1', name: 'Item 1', value: 10 }]
      const queryFn = vi.fn().mockResolvedValue(items)
      const queryKey = ['test', 'transition']

      const { result, rerender } = renderHook(
        ({ enabled }: { enabled: boolean }) => {
          const config = enabled
            ? {
                id: 'transition-test',
                queryClient,
                queryKey,
                queryFn,
                getKey: (item: TestItem) => item.id,
              }
            : null

          return useCollection(config)
        },
        { initialProps: { enabled: false } }
      )

      expect(result.current.status).toBe('disabled')

      await act(async () => {
        rerender({ enabled: true })
      })

      await waitFor(() => {
        expect(result.current.isReady).toBe(true)
      })

      expect(result.current.data).toHaveLength(1)
      expect(result.current.isEnabled).toBe(true)
    })
  })

  describe('Status helpers', () => {
    it('should provide correct status helpers', async () => {
      const items: TestItem[] = [{ id: '1', name: 'Item 1', value: 10 }]
      const queryFn = vi.fn().mockResolvedValue(items)
      const queryKey = ['test', 'status']

      const { result } = renderHook(() =>
        useCollection({
          id: 'status-test',
          queryClient,
          queryKey,
          queryFn,
          getKey: (item: TestItem) => item.id,
        })
      )

      // Initially loading
      expect(result.current.isLoading || result.current.isIdle).toBe(true)
      expect(result.current.isReady).toBe(false)

      await waitFor(() => {
        expect(result.current.isReady).toBe(true)
      })

      expect(result.current.isLoading).toBe(false)
      expect(result.current.isError).toBe(false)
      expect(result.current.isCleanedUp).toBe(false)
    })
  })

  describe('Utils exposure', () => {
    it('should expose refetch utility for query collections', async () => {
      const items: TestItem[] = [{ id: '1', name: 'Item 1', value: 10 }]
      const queryFn = vi.fn().mockResolvedValue(items)
      const queryKey = ['test', 'utils']

      const { result } = renderHook(() =>
        useCollection({
          id: 'utils-test',
          queryClient,
          queryKey,
          queryFn,
          getKey: (item: TestItem) => item.id,
        })
      )

      await waitFor(() => {
        expect(result.current.isReady).toBe(true)
      })

      expect(result.current.utils).toBeDefined()
      expect(typeof result.current.utils.refetch).toBe('function')
    })
  })

  describe('Dependency tracking', () => {
    it('should not recreate collection when deps are stable', async () => {
      const items: TestItem[] = [{ id: '1', name: 'Item 1', value: 10 }]
      const queryFn = vi.fn().mockResolvedValue(items)
      const queryKey = ['test', 'stable']

      const { result, rerender } = renderHook(
        ({ dep }: { dep: number }) => {
          return useCollection(
            {
              id: 'stable-test',
              queryClient,
              queryKey,
              queryFn,
              getKey: (item: TestItem) => item.id,
            },
            [dep]
          )
        },
        { initialProps: { dep: 1 } }
      )

      await waitFor(() => {
        expect(result.current.isReady).toBe(true)
      })

      const firstCollection = result.current.collection

      // Rerender with same dep
      rerender({ dep: 1 })

      // Collection should be the same instance
      expect(result.current.collection).toBe(firstCollection)
    })

    it('should refetch when deps change', async () => {
      let counter = 0
      const queryFn = vi.fn().mockImplementation(async () => {
        counter++
        return [{ id: '1', name: `Item ${counter}`, value: counter }]
      })
      const queryKey = ['test', 'deps-change']

      const { result, rerender } = renderHook(
        ({ dep }: { dep: number }) => {
          return useCollection(
            {
              id: 'deps-change-test',
              queryClient,
              queryKey,
              queryFn,
              getKey: (item: TestItem) => item.id,
            },
            [dep]
          )
        },
        { initialProps: { dep: 1 } }
      )

      await waitFor(() => {
        expect(result.current.isReady).toBe(true)
      })

      expect(result.current.data[0].name).toBe('Item 1')

      // Change dep - should trigger refetch
      await act(async () => {
        rerender({ dep: 2 })
      })

      await waitFor(() => {
        expect(result.current.data[0].name).toBe('Item 2')
      })

      expect(queryFn).toHaveBeenCalledTimes(2)
    })
  })

  describe('Subscription lifecycle', () => {
    it('should subscribe and unsubscribe correctly', async () => {
      const items: TestItem[] = [{ id: '1', name: 'Item 1', value: 10 }]
      const queryFn = vi.fn().mockResolvedValue(items)
      const queryKey = ['test', 'subscription']

      const { result, unmount } = renderHook(() =>
        useCollection({
          id: 'subscription-test',
          queryClient,
          queryKey,
          queryFn,
          getKey: (item: TestItem) => item.id,
        })
      )

      await waitFor(() => {
        expect(result.current.isReady).toBe(true)
      })

      // Unmount should not throw
      expect(() => unmount()).not.toThrow()
    })
  })
})

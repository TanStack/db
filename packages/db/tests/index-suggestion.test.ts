/**
 * Ordinary diagnostic examples for bounded orderBy index warnings: the cyclic
 * locale options, custom comparator reuse, local-index comparator warnings,
 * on-demand prefixes, and virtual order fields. The diagnostic law is owned by
 * index-suggestion-oracle.test.ts, which runs the candidate grammar.
 */
import { describe, expect, test, vi } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { BasicIndex } from '../src/indexes/basic-index.js'
import { createLiveQueryCollection } from '../src/query/live-query-collection.js'
import { mockSyncCollectionOptions, withOracleCleanup } from './utils.js'

describe(`bounded orderBy index diagnostics`, () => {
  test.each([false, true])(
    `does not inspect cyclic locale options when field index presence is %s`,
    async (hasFieldIndex) => {
      const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
      const localeOptions: Record<string, unknown> = {}
      localeOptions.self = localeOptions
      const source = createCollection(
        mockSyncCollectionOptions<{ id: number; name: string }>({
          id: `cyclic-index-diagnostic-${hasFieldIndex}`,
          getKey: (row) => row.id,
          initialData: [{ id: 1, name: `Alice` }],
          autoIndex: `off`,
        }),
      )
      let query: ReturnType<typeof createLiveQueryCollection> | undefined
      await withOracleCleanup(async () => {
        await source.stateWhenReady()
        if (hasFieldIndex) {
          source.createIndex((row) => row.name, { indexType: BasicIndex })
        }

        expect(() => {
          query = createLiveQueryCollection((q) =>
            q
              .from({ row: source })
              .orderBy(({ row }) => row.name, {
                direction: `asc`,
                nulls: `last`,
                stringSort: `locale`,
                localeOptions,
              })
              .limit(1),
          )
        }).not.toThrow()
        await query!.preload()
        expect(query!.toArray.map((row) => row.name)).toEqual([`Alice`])
      }, [
        () => warning.mockRestore(),
        () => query?.cleanup(),
        () => source.cleanup(),
      ])
    },
  )

  test(`explains that a custom index must reuse the comparator reference`, async () => {
    const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
    const compare = (a: string, b: string) => a.length - b.length
    const source = createCollection(
      mockSyncCollectionOptions<{ id: number; name: string }>({
        id: `custom-compare-index-diagnostic`,
        getKey: (row) => row.id,
        initialData: [{ id: 1, name: `Alice` }],
        autoIndex: `off`,
      }),
    )
    let query: ReturnType<typeof createLiveQueryCollection> | undefined
    await withOracleCleanup(async () => {
      await source.stateWhenReady()
      source.createIndex((row) => row.name, { indexType: BasicIndex })
      query = createLiveQueryCollection((q) =>
        q
          .from({ row: source })
          .orderBy(({ row }) => row.name, {
            stringSort: `custom`,
            compare,
          })
          .limit(1),
      )

      await query.preload()
      const message = warning.mock.calls
        .flat()
        .find(
          (value): value is string =>
            typeof value === `string` && value.includes(`orderBy with limit`),
        )
      expect(message).toContain(`same compare function reference`)
      expect(message).not.toContain(`"compare":"[function]"`)
      expect(message).toContain(`full source`)
      expect(message).not.toContain(`create a BasicIndex`)
    }, [
      () => warning.mockRestore(),
      () => query?.cleanup(),
      () => source.cleanup(),
    ])
  })

  test(`warns about custom ordering with a matching local index`, async () => {
    const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
    const compare = (a: string, b: string) => a.length - b.length
    const requests: Array<{ orderBy?: unknown; limit?: number }> = []
    const source = createCollection<{ id: number; name: string }>({
      id: `custom-compare-matching-index-diagnostic`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      startSync: true,
      autoIndex: `off`,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          write({ type: `insert`, value: { id: 1, name: `Alice` } })
          commit()
          markReady()
          return {
            loadSubset: (options) => {
              requests.push(options)
              return true
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    let query: ReturnType<typeof createLiveQueryCollection> | undefined
    await withOracleCleanup(async () => {
      source.createIndex((row) => row.name, {
        indexType: BasicIndex,
        options: {
          compareOptions: {
            direction: `asc`,
            nulls: `first`,
            stringSort: `custom`,
            compare,
          },
        },
      })
      query = createLiveQueryCollection((q) =>
        q
          .from({ row: source })
          .orderBy(({ row }) => row.name, {
            stringSort: `custom`,
            compare,
          })
          .limit(1),
      )
      await query.preload()
      expect(requests).toHaveLength(1)
      expect(requests[0]).toMatchObject({
        orderBy: undefined,
        limit: undefined,
      })
      expect(warning.mock.calls.flat().join(` `)).toContain(`full source`)
    }, [
      () => warning.mockRestore(),
      () => query?.cleanup(),
      () => source.cleanup(),
    ])
  })

  test(`describes an unindexed on-demand prefix without claiming a full load`, async () => {
    const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
    const requests: Array<{ orderBy?: unknown; limit?: number }> = []
    const source = createCollection<{ id: number; name: string }>({
      id: `unindexed-prefix-diagnostic`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      startSync: true,
      autoIndex: `off`,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          write({ type: `insert`, value: { id: 1, name: `Alice` } })
          commit()
          markReady()
          return {
            loadSubset: (options) => {
              requests.push(options)
              return true
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    let query: ReturnType<typeof createLiveQueryCollection> | undefined
    await withOracleCleanup(async () => {
      query = createLiveQueryCollection((q) =>
        q
          .from({ row: source })
          .orderBy(({ row }) => row.name)
          .limit(1),
      )
      await query.preload()
      expect(
        requests.some(({ orderBy, limit }) => orderBy && limit === 1),
      ).toBe(true)
      expect(warning.mock.calls.flat().join(` `)).not.toContain(
        `loading all data`,
      )
    }, [
      () => warning.mockRestore(),
      () => query?.cleanup(),
      () => source.cleanup(),
    ])
  })

  test(`identifies an unindexable virtual order field`, async () => {
    const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
    const source = createCollection(
      mockSyncCollectionOptions<{ id: number }>({
        id: `virtual-order-diagnostic`,
        getKey: (row) => row.id,
        initialData: [{ id: 1 }],
        autoIndex: `off`,
      }),
    )
    let query: ReturnType<typeof createLiveQueryCollection> | undefined
    await withOracleCleanup(async () => {
      query = createLiveQueryCollection((q) =>
        q
          .from({ row: source })
          .orderBy(({ row }) => row.$synced)
          .limit(1),
      )
      await query.preload()
      const message = warning.mock.calls.flat().join(` `)
      expect(message).toContain(`virtual`)
      expect(message).not.toContain(`createIndex`)
    }, [
      () => warning.mockRestore(),
      () => query?.cleanup(),
      () => source.cleanup(),
    ])
  })
})

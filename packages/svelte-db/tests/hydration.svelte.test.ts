import { describe, expect, it, vi } from 'vitest'
import { flushSync } from 'svelte'
import { DbClient, Query, collectionOptions } from '@tanstack/db'
import { useLiveQuery } from '../src/useLiveQuery.svelte.js'
import { expectedSsrSnapshot } from '../../db/tests/ssr-snapshot-admission-oracle'
import { createPeopleDescriptor, peopleQuery } from './ssr-test-utils.js'

describe(`Svelte hydration`, () => {
  it(`keeps the hydrated result until the browser source is authoritative`, async () => {
    const { descriptor, resolveBrowserLoad } = createPeopleDescriptor()
    const serverClient = new DbClient({ runtime: `server` })
    await serverClient.preloadLiveQuery(peopleQuery(descriptor))
    const dehydrated = serverClient.dehydrate({
      shouldDehydrateCollection: () => false,
      shouldDehydrateLiveQuery: () => true,
    })

    const browserClient = new DbClient({ runtime: `browser` })
    browserClient.hydrate(dehydrated)
    const createQuery = () =>
      useLiveQuery({
        ...peopleQuery(descriptor),
        client: browserClient,
      })
    let query!: ReturnType<typeof createQuery>
    const dispose = $effect.root(() => {
      query = createQuery()
    })

    flushSync()
    expect(query.data).toEqual([
      expect.objectContaining({ id: `server`, name: `Server snapshot` }),
    ])

    resolveBrowserLoad()
    await vi.waitFor(() => {
      flushSync()
      expect(query.data).toEqual([
        expect.objectContaining({ id: `browser`, name: `Browser source` }),
      ])
    })
    dispose()
  })

  // An empty queryKey counts as none, so with a dependency list it must match
  // the hydrated query exactly as an omitted key does. The server preload has
  // no dependency list, so a query with one does not match it. The control
  // case without a dependency list shows this harness does hydrate, so the two
  // dependency-list cases agree on a real miss, not on a broken harness.
  it(`hydrates an empty queryKey with a dependency list as it hydrates no key`, async () => {
    const firstRows = async (
      queryKey: Array<unknown> | undefined,
      deps: Array<() => unknown> | undefined,
    ) => {
      const { descriptor } = createPeopleDescriptor()
      const serverClient = new DbClient({ runtime: `server` })
      await serverClient.preloadLiveQuery(peopleQuery(descriptor))
      const browserClient = new DbClient({ runtime: `browser` })
      browserClient.hydrate(
        serverClient.dehydrate({
          shouldDehydrateCollection: () => false,
          shouldDehydrateLiveQuery: () => true,
        }),
      )
      let query!: ReturnType<typeof useLiveQuery>
      const dispose = $effect.root(() => {
        const config = {
          ...peopleQuery(descriptor),
          client: browserClient,
          queryKey,
        } as any
        query = deps ? useLiveQuery(config, deps) : useLiveQuery(config)
      })
      flushSync()
      const rows = query.data
      dispose()
      return rows
    }
    const serverRows = [
      expect.objectContaining({ id: `server`, name: `Server snapshot` }),
    ]
    // Control: the same query and harness hydrate the server rows.
    expect(await firstRows(undefined, undefined)).toEqual(serverRows)
    expect(await firstRows([], undefined)).toEqual(serverRows)

    const dependency = [() => `dependency`]
    const omittedKey = await firstRows(undefined, dependency)
    expect(await firstRows([], dependency)).toEqual(omittedKey)
  })
})

// Normal browser initialization must not use the stricter SSR admission rule.
// Source-only hydration is provisional until the browser's own sync is ready.
describe(`Svelte SSR receiving controls`, () => {
  for (const preparation of [`warm-browser`, `normalized`] as const) {
    for (const count of [0, 1]) {
      it(`${preparation} with ${count} rows remains legal`, async () => {
        const rows = Array.from({ length: count }, (_, index) => ({
          id: String(index),
          name: `seed ${index}`,
        }))
        const expected = expectedSsrSnapshot({
          preparation: `source`,
          sourceState: `ready`,
          rows,
        })
        const client = new DbClient()
        const descriptor = collectionOptions(`svelte-ssr-receiving`, () => ({
          id: `svelte-ssr-receiving`,
          getKey: (row: { id: string; name: string }) => row.id,
          sync: {
            sync: ({ begin, write, commit, markReady }) => {
              if (preparation === `warm-browser`) {
                begin()
                for (const row of rows) write({ type: `insert`, value: row })
                commit()
              }
              markReady()
            },
          },
        }))
        if (preparation === `warm-browser`)
          await client.preloadLiveQuery({
            query: new Query()
              .from({ row: descriptor })
              .select(({ row }) => ({ id: row.id })),
          })
        else
          client.hydrate({
            collections: [
              {
                collectionId: descriptor.id,
                rows: rows.map((value) => ({ key: value.id, value })),
              },
            ],
          })
        const createQuery = () =>
          useLiveQuery({
            query: (q) =>
              q
                .from({ row: descriptor })
                .select(({ row }) => ({ id: row.id, name: row.name })),
            client,
          })
        let query!: ReturnType<typeof createQuery>
        let dispose: (() => void) | undefined
        let initializationError: unknown
        try {
          try {
            dispose = $effect.root(() => {
              query = createQuery()
            })
          } catch (error) {
            initializationError = error
          }
          expect(
            initializationError,
            `valid browser initialization does not throw`,
          ).toBeUndefined()
          expect(query.status).toBe(
            preparation === `warm-browser` ? `ready` : `loading`,
          )
          expect(query.data).toEqual(
            expected.rows.map((row) => expect.objectContaining(row)),
          )
          flushSync()
          await vi.waitFor(() => {
            flushSync()
            expect(query.status).toBe(`ready`)
          })
        } finally {
          dispose?.()
          await client.cleanup()
        }
      })
    }
  }
})

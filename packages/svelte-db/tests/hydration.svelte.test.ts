import { describe, expect, it, vi } from 'vitest'
import { flushSync } from 'svelte'
import { DbClient } from '@tanstack/db'
import { useLiveQuery } from '../src/useLiveQuery.svelte.js'
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

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
})

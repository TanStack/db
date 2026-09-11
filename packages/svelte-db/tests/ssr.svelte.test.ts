// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { render } from 'svelte/server'
import { DbClient } from '@tanstack/db'
import SsrDbApp from './SsrDbApp.svelte'
import {
  createPeopleDescriptor,
  peopleQuery,
  serverPerson,
} from './ssr-test-utils.js'

describe(`Svelte SSR`, () => {
  it(`renders a hydrated live-query result without hydrating source rows`, async () => {
    const { descriptor } = createPeopleDescriptor()
    const serverClient = new DbClient({ runtime: `server` })
    await serverClient.preloadLiveQuery(peopleQuery(descriptor))
    const dehydrated = serverClient.dehydrate({
      shouldDehydrateCollection: () => false,
      shouldDehydrateLiveQuery: () => true,
    })
    expect(dehydrated.collections).toEqual([])

    const browserClient = new DbClient({ runtime: `browser` })
    browserClient.hydrate(dehydrated)
    const { body } = render(SsrDbApp, {
      props: { client: browserClient, descriptor },
    })

    expect(body).toContain(`Server snapshot`)
    expect(body).toContain(`data-status="ready"`)
    expect(body).not.toContain(serverPerson.sourcePayload)
  })
})

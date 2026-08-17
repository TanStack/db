import { collectionOptions } from '@tanstack/db'
import type { InitialQueryBuilder } from '@tanstack/db'

export type Person = {
  id: string
  name: string
  sourcePayload: string
}

export const serverPerson: Person = {
  id: `server`,
  name: `Server snapshot`,
  sourcePayload: `SOURCE_ONLY_SERVER_PAYLOAD`,
}

export const browserPerson: Person = {
  id: `browser`,
  name: `Browser source`,
  sourcePayload: `SOURCE_ONLY_BROWSER_PAYLOAD`,
}

export function createPeopleDescriptor() {
  let resolveBrowserLoad: (() => void) | undefined
  const descriptor = collectionOptions(`svelte-ssr-people`, (client) => {
    const runtime = client.requireDependency<`server` | `browser`>(`runtime`)

    return {
      id: `svelte-ssr-people`,
      getKey: (person: Person) => person.id,
      syncMode: `on-demand` as const,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          markReady()
          return {
            loadSubset: async () => {
              if (runtime === `browser`) {
                await new Promise<void>((resolve) => {
                  resolveBrowserLoad = resolve
                })
              }
              begin({ immediate: true })
              write({
                type: `insert`,
                value: runtime === `server` ? serverPerson : browserPerson,
              })
              commit()
            },
          }
        },
      },
    }
  })

  return {
    descriptor,
    resolveBrowserLoad: () => resolveBrowserLoad?.(),
  }
}

export const peopleQuery = (
  descriptor: ReturnType<typeof createPeopleDescriptor>[`descriptor`],
) => ({
  query: (q: InitialQueryBuilder) =>
    q.from({ people: descriptor }).select(({ people }) => ({
      id: people.id,
      name: people.name,
    })),
})

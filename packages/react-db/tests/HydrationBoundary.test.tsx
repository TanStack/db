import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DbClient, collectionOptions } from '@tanstack/db'
import { DbProvider, useDbClient } from '../src/DbProvider'
import { HydrationBoundary } from '../src/HydrationBoundary'

type Person = {
  id: string
  name: string
}

const people = collectionOptions(`hydration-boundary-people`, () => ({
  id: `hydration-boundary-people`,
  getKey: (person: Person) => person.id,
  sync: {
    sync: ({ markReady }) => markReady(),
  },
}))

const state = {
  collections: [
    {
      collectionId: people.id,
      rows: [{ key: `1`, value: { id: `1`, name: `Hydrated` } }],
    },
  ],
}

function PersonName() {
  const client = useDbClient()
  return <span>{client.collection(people).get(`1`)?.name}</span>
}

function App({ client }: { client: DbClient }) {
  return (
    <DbProvider client={client}>
      <HydrationBoundary state={state}>
        <PersonName />
      </HydrationBoundary>
    </DbProvider>
  )
}

describe(`HydrationBoundary`, () => {
  it(`hydrates before children render and follows the provider client`, () => {
    const firstClient = new DbClient()
    const firstHydrate = vi.spyOn(firstClient, `hydrate`)
    const view = render(<App client={firstClient} />)

    expect(screen.getByText(`Hydrated`)).toBeInTheDocument()
    expect(firstHydrate).toHaveBeenCalledTimes(1)

    view.rerender(<App client={firstClient} />)
    expect(firstHydrate).toHaveBeenCalledTimes(1)

    const secondClient = new DbClient()
    const secondHydrate = vi.spyOn(secondClient, `hydrate`)
    view.rerender(<App client={secondClient} />)

    expect(screen.getByText(`Hydrated`)).toBeInTheDocument()
    expect(secondHydrate).toHaveBeenCalledTimes(1)
  })
})

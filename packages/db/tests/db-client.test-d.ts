import { describe, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import { DbClient, collectionOptions } from '../src'
import type { DehydratedCollectionChunk, DehydratedDbState } from '../src'

type Todo = {
  id: string
  title: string
}

describe(`DbClient type assertions`, () => {
  it(`types explicit dependencies`, () => {
    const queryClient = {
      invalidateQueries: () => Promise.resolve(),
    }
    const client = new DbClient({ queryClient })

    expectTypeOf(
      client.getDependency<typeof queryClient>(`queryClient`),
    ).toEqualTypeOf<typeof queryClient | undefined>()
    expectTypeOf(
      client.requireDependency<typeof queryClient>(`queryClient`),
    ).toEqualTypeOf<typeof queryClient>()
  })

  it(`infers collections from client-aware descriptor factories`, () => {
    const descriptor = collectionOptions(`todos`, (client) => {
      expectTypeOf(client).toEqualTypeOf<DbClient>()

      return {
        id: `todos`,
        getKey: (todo: Todo) => todo.id,
        sync: {
          sync: () => {},
        },
      }
    })
    const client = new DbClient()
    const collection = client.collection(descriptor, {
      initialData: [{ id: `1`, title: `Ship SSR` }],
    })

    expectTypeOf(collection.get(`1`)).toMatchTypeOf<Todo | undefined>()
    collection.insert({ id: `2`, title: `Keep inference` })
  })

  it(`types holistic and incremental hydration payloads`, () => {
    const client = new DbClient()
    const state: DehydratedDbState = {
      collections: [
        {
          collectionId: `todos`,
          rows: [
            {
              key: `1`,
              value: { id: `1`, title: `Ship SSR` },
            },
          ],
        },
      ],
    }
    const chunk: DehydratedCollectionChunk<Todo, string> = state
      .collections[0] as DehydratedCollectionChunk<Todo, string>

    client.hydrate(state)
    client.applyCollectionChunk(chunk)

    expectTypeOf(client.dehydrate()).toEqualTypeOf<DehydratedDbState>()
  })

  it(`preserves schema input and output through descriptor factories`, () => {
    const schema = z.object({
      id: z.string(),
      createdAt: z.string().transform((value) => new Date(value)),
    })
    const descriptor = collectionOptions(`schema-items`, () => ({
      id: `schema-items`,
      schema,
      getKey: (item: z.output<typeof schema>) => item.id,
      sync: {
        sync: () => {},
      },
    }))
    const collection = new DbClient().collection(descriptor, {
      initialData: [{ id: `1`, createdAt: `2026-01-01T00:00:00.000Z` }],
    })

    expectTypeOf(collection.get(`1`)?.createdAt).toEqualTypeOf<
      Date | undefined
    >()
  })
})

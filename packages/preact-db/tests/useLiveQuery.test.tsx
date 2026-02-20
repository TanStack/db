import { render } from 'preact'
import { act } from 'preact/test-utils'
import { createCollection, gt } from '@tanstack/db'
import { describe, expect, it, vi } from 'vitest'
import { useLiveQuery } from '../src/useLiveQuery'
import { mockSyncCollectionOptions } from '../../db/tests/utils'

type Person = {
  id: string
  name: string
  age: number
}

const initialPersons: Array<Person> = [
  { id: `1`, name: `John Doe`, age: 30 },
  { id: `2`, name: `Jane Doe`, age: 25 },
  { id: `3`, name: `John Smith`, age: 35 },
]

describe(`useLiveQuery`, () => {
  it(`tracks live query updates and dependency changes`, async () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons-preact`,
        getKey: (person: Person) => person.id,
        initialData: initialPersons,
      }),
    )

    const root = document.createElement(`div`)
    document.body.append(root)

    function TestComponent(props: { minAge: number }) {
      const result = useLiveQuery(
        (q) =>
          q
            .from({ persons: collection })
            .where(({ persons }) => gt(persons.age, props.minAge))
            .select(({ persons }) => persons),
        [props.minAge],
      )

      const count = Array.isArray(result.data) ? result.data.length : 0
      return <div>{`${result.status}:${count}`}</div>
    }

    act(() => {
      render(<TestComponent minAge={30} />, root)
    })

    await vi.waitFor(() => {
      expect(root.textContent).toBe(`ready:1`)
    })

    act(() => {
      collection.insert({ id: `4`, name: `Zoe`, age: 40 })
    })

    await vi.waitFor(() => {
      expect(root.textContent).toBe(`ready:2`)
    })

    act(() => {
      render(<TestComponent minAge={20} />, root)
    })

    await vi.waitFor(() => {
      expect(root.textContent).toBe(`ready:4`)
    })

    act(() => {
      render(null, root)
    })
  })
})

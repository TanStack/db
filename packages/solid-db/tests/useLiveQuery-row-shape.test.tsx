import { createCollection } from '@tanstack/db'
import { createRenderEffect, createRoot } from 'solid-js'
import { expect, it } from 'vitest'
import { waitFor } from '@solidjs/testing-library'
import { useLiveQuery } from '../src/useLiveQuery'
import { mockSyncCollectionOptions } from '../../db/tests/utils'
import { ScenarioLifetime } from '../../db/tests/conformance/scenario-lifetime'

type Row = {
  id: string
  config: { optional?: undefined }
  optional?: undefined
}

// The shared oracle checks complete values. This receiving check observes
// Solid's enumeration and membership subscriptions when only row shape changes.
it.each([`root`, `nested`] as const)(
  `notifies %s row shape subscriptions when an undefined field enters and leaves`,
  async (location) => {
    const resources = new ScenarioLifetime()
    await resources.run(async () => {
      const collection = createCollection(
        mockSyncCollectionOptions<Row>({
          id: `solid-row-shape-${location}`,
          getKey: (row) => row.id,
          initialData: [{ id: `a`, config: {} }],
          rowUpdateMode: `full`,
        }),
      )
      try {
        const query = createRoot((dispose) => {
          resources.defer(dispose)
          return useLiveQuery(() => collection)
        })
        await waitFor(() => expect(query()).toHaveLength(1))
        const row = query()[0]!
        const container = location === `root` ? row : row.config
        const enumerated: Array<boolean> = []
        const memberships: Array<boolean> = []
        createRoot((dispose) => {
          resources.defer(dispose)
          createRenderEffect(() => {
            enumerated.push(Object.keys(container).includes(`optional`))
          })
          createRenderEffect(() => {
            memberships.push(`optional` in container)
          })
        })
        let publications = 0
        const subscription = collection.subscribeChanges(
          (changes) => {
            publications += changes.length
          },
          { includeInitialState: false },
        )
        resources.defer(() => subscription.unsubscribe())
        const write = (next: Row) => {
          collection.utils.begin()
          collection.utils.write({ type: `update`, value: next })
          collection.utils.commit()
        }
        const next: Row = { id: `a`, config: {} }
        if (location === `root`) next.optional = undefined
        else next.config.optional = undefined
        write(next)
        // Core emits even when only own-key presence changes. The hook gets
        // that source fact; neither subscriber reads a changed scalar value.
        expect(publications).toBe(1)
        await waitFor(() => {
          expect(enumerated).toEqual([false, true])
          expect(memberships).toEqual([false, true])
        })
        expect(Object.hasOwn(container, `optional`)).toBe(true)
        expect(container.optional).toBeUndefined()

        write({ id: `a`, config: {} })
        expect(publications).toBe(2)
        await waitFor(() => {
          expect(enumerated).toEqual([false, true, false])
          expect(memberships).toEqual([false, true, false])
        })
        expect(Object.hasOwn(container, `optional`)).toBe(false)
        expect(query()[0]).toBe(row)
      } finally {
        resources.defer(() => collection.cleanup())
      }
    })
  },
)

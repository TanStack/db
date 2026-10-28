import { createCollection } from '../src/index'
import { localOnlyCollectionOptions } from '../src/local-only'

// Shared order collection for the local-only direct-write tests.
export type Row = { id: number; value: string }

export type Handlers = Partial<
  Record<`onInsert` | `onUpdate` | `onDelete`, () => Promise<void>>
>

export function createOrders(handlers: Handlers = {}) {
  return createCollection(
    localOnlyCollectionOptions<Row, number>({
      id: `local-only-direct-${Math.random()}`,
      getKey: (row) => row.id,
      initialData: [{ id: 1, value: `a` }],
      ...handlers,
    }),
  )
}

export type Orders = ReturnType<typeof createOrders>

export const confirmEverything: Handlers = {
  onInsert: () => Promise.resolve(),
  onUpdate: () => Promise.resolve(),
  onDelete: () => Promise.resolve(),
}

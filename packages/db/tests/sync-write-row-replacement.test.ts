import { expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import type { SyncConfig } from '../src/types.js'

type Row = { id: number; a?: number; b?: number }

// A partial update merges over the row before it. Only an internal marker,
// which the persisted wrapper sets on an insert it judged itself, makes a
// sync write name the whole row; a public message field cannot.
it(`merges a public partial update whatever fields the message carries`, async () => {
  let sync!: Parameters<SyncConfig<Row, number>[`sync`]>[0]
  const collection = createCollection<Row, number>({
    id: `public-update-merges`,
    getKey: (row) => row.id,
    startSync: true,
    sync: {
      sync: (actions) => {
        sync = actions
        actions.begin()
        actions.write({ type: `insert`, value: { id: 1, a: 1, b: 1 } })
        actions.commit()
        actions.markReady()
      },
    },
  })
  await collection.preload()
  sync.begin()
  sync.write({
    type: `update`,
    value: { id: 1, a: 2 },
    originalSyncType: `insert`,
  } as Parameters<typeof sync.write>[0])
  sync.commit()
  expect(collection.get(1)).toMatchObject({ id: 1, a: 2, b: 1 })
})

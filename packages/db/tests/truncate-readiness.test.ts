// Ordinary tests for truncate readiness after an initial sync error. They
// compare production with written values. The replacement-readiness law and
// its model are owned by truncate-readiness-oracle.test.ts.
import { expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import type { SyncConfig } from '../src/types.js'

type Row = { id: number; value: string }
type Sync = Parameters<SyncConfig<Row, number>['sync']>[0]
const intents: Array<undefined | boolean> = [undefined, true, false]

// After the initial error, the run's markReady() does nothing (maintainer
// decision), so a replacement that promises readiness still applies its rows
// and leaves the attempt in error.
it.each(intents)(
  'keeps the initial error under a ready-promising replacement: markReady %s',
  async (markReady) => {
    let sync!: Sync
    const c = createCollection<Row, number>({
      getKey: (row) => row.id,
      startSync: true,
      gcTime: Infinity,
      sync: {
        sync: (params) => {
          sync = params
        },
      },
    })
    try {
      sync.fail(new Error('initial sync failed'))
      sync.begin()
      sync.truncate(markReady === undefined ? undefined : { markReady })
      sync.write({ type: 'insert', value: { id: 1, value: 'late' } })
      expect(() => sync.commit()).not.toThrow()
      expect(c.status).toBe('error')
      expect([...c.keys()]).toEqual([1])
    } finally {
      await c.cleanup()
    }
  },
)

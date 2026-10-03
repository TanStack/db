import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { SyncRowReusedWithoutPreviousValueError } from '../src/errors.js'
import { createLiveQueryCollection, eq } from '../src/query/index.js'
import type { SyncConfig } from '../src/types.js'

/**
 * A sync update tells the Collection a row's new value. Core keeps the
 * object a source writes as the row's stored value, so a source that
 * changes that object in place and writes it again has already overwritten
 * the previous value core would publish. Live queries then see an update
 * whose old and new values are the same object, and a row that left a
 * filter stays in it. A source that reuses its row object must say what the
 * row was through `previousValue`. In development, core rejects the write
 * that omits it; production keeps the cheaper unchecked path.
 */
type Row = { id: string; group: string }

function setup() {
  let sync!: Parameters<SyncConfig<Row, string>[`sync`]>[0]
  const row: Row = { id: `r`, group: `a` }
  const collection = createCollection<Row, string>({
    id: `sync-reused-row`,
    getKey: (item) => item.id,
    startSync: true,
    sync: {
      rowUpdateMode: `full`,
      sync: (actions) => {
        sync = actions
        actions.begin()
        actions.write({ type: `insert`, value: row })
        actions.commit()
        actions.markReady()
      },
    },
  })
  const groupA = createLiveQueryCollection({
    query: (q) => q.from({ r: collection }).where(({ r }) => eq(r.group, `a`)),
    startSync: true,
  })
  return { sync: () => sync, row, collection, groupA }
}

describe(`sync writes of a reused row object`, () => {
  afterEach(() => vi.unstubAllEnvs())

  it(`rejects an in-place update without previousValue in development`, async () => {
    vi.stubEnv(`NODE_ENV`, `development`)
    const { sync, row, collection, groupA } = setup()
    await groupA.preload()
    row.group = `b`
    sync().begin()
    expect(() => sync().write({ type: `update`, value: row })).toThrow(
      SyncRowReusedWithoutPreviousValueError,
    )
    await collection.cleanup()
  })

  it(`accepts an in-place update that names its previous value`, async () => {
    vi.stubEnv(`NODE_ENV`, `development`)
    const { sync, row, collection, groupA } = setup()
    await groupA.preload()
    expect([...groupA.keys()]).toEqual([`r`])
    const previousValue = { ...row }
    row.group = `b`
    sync().begin()
    sync().write({ type: `update`, value: row, previousValue })
    sync().commit()
    expect([...groupA.keys()]).toEqual([])
    await collection.cleanup()
  })

  it(`accepts an unchanged rewrite after a declared in-place update`, async () => {
    vi.stubEnv(`NODE_ENV`, `development`)
    const { sync, row, collection, groupA } = setup()
    await groupA.preload()
    const previousValue = { ...row }
    row.group = `b`
    sync().begin()
    sync().write({ type: `update`, value: row, previousValue })
    sync().commit()
    // The live-query Collection rewrites an unchanged row the same way.
    sync().begin()
    expect(() => sync().write({ type: `update`, value: row })).not.toThrow()
    sync().commit()
    await collection.cleanup()
  })

  it(`accepts an update with a new object`, async () => {
    vi.stubEnv(`NODE_ENV`, `development`)
    const { sync, collection, groupA } = setup()
    await groupA.preload()
    sync().begin()
    sync().write({ type: `update`, value: { id: `r`, group: `b` } })
    sync().commit()
    expect([...groupA.keys()]).toEqual([])
    await collection.cleanup()
  })

  it(`does not check in production`, async () => {
    vi.stubEnv(`NODE_ENV`, `production`)
    const { sync, row, collection, groupA } = setup()
    await groupA.preload()
    row.group = `b`
    sync().begin()
    expect(() => sync().write({ type: `update`, value: row })).not.toThrow()
    sync().commit()
    await collection.cleanup()
  })
})

import { describe, expect, test } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { createLiveQueryCollection } from '../../src/query/index.js'
import { createOptimisticAction } from '../../src/optimistic-action.js'

type Item = {
  id: string
  value: string
}

type SyncControls = {
  begin: () => void
  write: (message: {
    type: `insert` | `update` | `delete`
    value: Item
  }) => void
  commit: () => void
  markReady: () => void
}

let collectionCounter = 0

function setup() {
  let syncBegin: SyncControls[`begin`] | undefined
  let syncWrite: SyncControls[`write`] | undefined
  let syncCommit: SyncControls[`commit`] | undefined
  let syncMarkReady: SyncControls[`markReady`] | undefined

  const source = createCollection<Item>({
    id: `optimistic-sync-source-${++collectionCounter}`,
    getKey: (item) => item.id,
    startSync: true,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        syncBegin = begin
        syncWrite = write
        syncCommit = commit
        syncMarkReady = markReady
      },
      allowSyncWhilePersisting: true,
    },
  })

  const derived = createLiveQueryCollection({
    startSync: true,
    query: (q) => q.from({ item: source }),
    getKey: (item: Item) => item.id,
  })

  if (!syncBegin || !syncWrite || !syncCommit || !syncMarkReady) {
    throw new Error(`Sync controls not initialized`)
  }

  return {
    source,
    derived,
    sync: {
      begin: syncBegin,
      write: syncWrite,
      commit: syncCommit,
      markReady: syncMarkReady,
    },
  }
}

function createPendingOptimisticAction(
  source: ReturnType<typeof setup>[`source`],
) {
  let resolveMutation: (() => void) | undefined
  let startResolve: (() => void) | undefined
  const started = new Promise<void>((resolve) => {
    startResolve = resolve
  })

  const action = createOptimisticAction<Item>({
    onMutate: (item) => {
      source.insert(item)
    },
    mutationFn: async () => {
      return new Promise<void>((resolve) => {
        resolveMutation = resolve
        startResolve?.()
      })
    },
  })

  return {
    action,
    started,
    resolve: () => resolveMutation?.(),
  }
}

describe(`sync while optimistic transaction is persisting (opt-in)`, () => {
  test(`shows non-conflicting synced rows immediately`, async () => {
    const { source, derived, sync } = setup()
    const { action, started, resolve } = createPendingOptimisticAction(source)

    action({ id: `optimistic-1`, value: `optimistic` })
    await started

    sync.begin()
    sync.write({ type: `insert`, value: { id: `synced-1`, value: `synced` } })
    sync.commit()

    expect(derived.has(`optimistic-1`)).toBe(true)
    expect(derived.has(`synced-1`)).toBe(true)
    expect(derived.size).toBe(2)

    resolve()
  })

  test(`keeps optimistic row visible on conflicting sync`, async () => {
    const { source, derived, sync } = setup()
    const { action, started, resolve } = createPendingOptimisticAction(source)

    action({ id: `item-1`, value: `optimistic` })
    await started

    expect(derived.get(`item-1`)?.value).toBe(`optimistic`)

    sync.begin()
    sync.write({ type: `insert`, value: { id: `item-1`, value: `synced` } })
    sync.commit()

    expect(derived.size).toBe(1)
    expect(derived.get(`item-1`)?.value).toBe(`optimistic`)

    resolve()
  })
})

import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { createTransaction } from '../src/transactions'
import { BasicIndex } from '../src/indexes/basic-index'
import { BTreeIndex } from '../src/indexes/btree-index'
import { eq } from '../src/query/builder/functions'
import { PropRef } from '../src/query/ir'
import type { BaseIndex, IndexConstructor } from '../src/indexes/base-index'
import type { ChangeMessageOrDeleteKeyMessage } from '../src/types'

interface Project {
  id: string
  name: string
  current_stage_id: string
  updated_at: string
}

const row = (
  id: string,
  stage: string,
  t: string = `2023-01-01T00:00:00Z`,
): Project => ({
  id,
  name: `Project-${id}`,
  current_stage_id: stage,
  updated_at: t,
})

describe.each([
  [`BasicIndex`, BasicIndex],
  [`BTreeIndex`, BTreeIndex],
] as Array<[string, IndexConstructor<string>]>)(
  `%s: a key lives in at most one bucket at a time`,
  (_name, IndexType) => {
    it(`update moves the key out of its actual bucket, regardless of the oldItem passed`, () => {
      const index = new IndexType(1, new PropRef([`current_stage_id`]))
      index.add(`P`, row(`P`, `A`))
      expect(index.equalityLookup(`A`)).toEqual(new Set([`P`]))

      // The oldItem disagrees with the value the index recorded for P.
      index.update(`P`, row(`P`, `B`), row(`P`, `C`))

      expect(index.equalityLookup(`A`)).toEqual(new Set())
      expect(index.equalityLookup(`B`)).toEqual(new Set())
      expect(index.equalityLookup(`C`)).toEqual(new Set([`P`]))
    })

    it(`add called twice without an intervening remove keeps the key in the latest bucket only`, () => {
      const index = new IndexType(1, new PropRef([`current_stage_id`]))
      index.add(`P`, row(`P`, `A`))
      index.add(`P`, row(`P`, `B`))

      expect(index.equalityLookup(`A`)).toEqual(new Set())
      expect(index.equalityLookup(`B`)).toEqual(new Set([`P`]))
    })

    it(`an optimistic→synced update on the indexed column ends with the row in the new bucket`, async () => {
      let resolveMutation: () => void
      let begin!: () => void
      let write!: (m: ChangeMessageOrDeleteKeyMessage<Project, string>) => void
      let commit!: () => void
      let markReady!: () => void

      const collection = createCollection<Project, string>({
        id: `projects`,
        getKey: (item) => item.id,
        autoIndex: `eager`,
        defaultIndexType: IndexType,
        startSync: true,
        sync: {
          sync: (ctx) => {
            begin = ctx.begin
            write = ctx.write
            commit = ctx.commit
            markReady = ctx.markReady
            begin()
            write({ type: `insert`, value: row(`P`, `A`) })
            commit()
            markReady()
          },
        },
      })
      await collection.stateWhenReady()

      collection.subscribeChanges(() => {}, {
        whereExpression: eq(new PropRef([`current_stage_id`]), `A`),
        includeInitialState: true,
      })
      const idx = Array.from(
        collection.indexes.values(),
      )[0] as BaseIndex<string>

      // Offline-style optimistic mutation (non-direct ambient transaction).
      const tx = createTransaction({
        autoCommit: false,
        mutationFn: async () => {
          await new Promise<void>((resolve) => {
            resolveMutation = resolve
          })
        },
      })
      tx.mutate(() => {
        collection.update(`P`, (draft) => {
          draft.current_stage_id = `B`
        })
      })

      const commitPromise = tx.commit()

      begin()
      write({
        type: `update`,
        value: row(`P`, `B`, `2023-01-02T00:00:00Z`),
      })
      commit()

      resolveMutation!()
      await commitPromise
      await Promise.resolve()
      await Promise.resolve()

      expect(collection.get(`P`)?.current_stage_id).toBe(`B`)
      expect(idx.equalityLookup(`A`)).toEqual(new Set())
      expect(idx.equalityLookup(`B`)).toEqual(new Set([`P`]))
    })
  },
)

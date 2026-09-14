import {
  BasicIndex,
  createCollection,
  createLiveQueryCollection,
  createTransaction,
  eq,
  localOnlyCollectionOptions,
} from '@tanstack/db'
type Row = {
  id: number
  text: string
  completed: boolean
  scope: string
  parentId: number | null
}
export async function joinModel(parents: Array<Row>, children: Array<Row>) {
  const parent = createCollection(
    localOnlyCollectionOptions({
      getKey: (row: Row) => row.id,
      initialData: parents,
    }),
  )
  const child = createCollection(
    localOnlyCollectionOptions({
      getKey: (row: Row) => row.id,
      initialData: children,
    }),
  )
  const scopedParent = createLiveQueryCollection((q) =>
    q.from({ parent }).where(({ parent }) => eq(parent.scope, 'alice')),
  )
  child.createIndex((row) => row.parentId, { indexType: BasicIndex })
  scopedParent.createIndex((row) => row.id, { indexType: BasicIndex })
  const views = (['inner', 'left'] as const).map((kind) =>
    createLiveQueryCollection({
      getKey: (row) => row.id,
      query: (q) => {
        const base = q.from({ child })
        const joined = base.join(
          { parent: scopedParent },
          ({ child, parent }) => eq(child.parentId, parent.id),
          kind,
        )
        return joined
          .where(({ child }) => eq(child.scope, 'alice'))
          .orderBy(({ child }) => child.id)
          .select(({ child, parent }) => ({
            id: child.id,
            text: child.text,
            completed: child.completed,
            parentId: child.parentId,
            parentText: parent.text,
            parentCompleted: parent.completed,
          }))
      },
    }),
  )
  await Promise.all(views.map((v) => v.preload()))
  const snapshot = () =>
    views.map((view) =>
      Array.from(view.values(), (row) => ({
        id: row.id,
        text: row.text,
        completed: row.completed,
        parentId: row.parentId,
        parentText: row.parentText ?? null,
        parentCompleted: row.parentCompleted ?? null,
      })),
    )
  return {
    snapshot,
    // This is an experiment with complete base inputs, not the Endpoints API.
    change(side: 'parent' | 'child', kind: 'put' | 'delete', row: Row) {
      const collection = side === 'parent' ? parent : child
      const tx = createTransaction({
        autoCommit: false,
        mutationFn: async ({ transaction }) =>
          collection.utils.acceptMutations(transaction),
      })
      void tx.isPersisted.promise.catch(() => {}) // Deliberate rollback is observed below.
      tx.mutate(() => {
        if (kind === 'delete') {
          if (collection.has(row.id)) collection.delete(row.id)
        } else if (collection.has(row.id))
          collection.update(row.id, (draft) => Object.assign(draft, row))
        else collection.insert(row)
      })
      return {
        rows: snapshot(),
        rollback: () => tx.rollback(),
        commit: async () => {
          await tx.commit()
          await tx.isPersisted.promise
        },
      }
    },
    close: async () => {
      await Promise.all(views.map((v) => v.cleanup()))
      await scopedParent.cleanup()
      await child.cleanup()
      await parent.cleanup()
    },
  }
}

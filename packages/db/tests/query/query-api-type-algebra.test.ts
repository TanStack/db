import { expect, test } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { createLiveQueryCollection, eq } from '../../src/query/index.js'
import { mockSyncCollectionOptions } from '../utils.js'

test(`an unmatched whole-object projection publishes undefined`, () => {
  const rows = createCollection(
    mockSyncCollectionOptions({
      id: `query-api-type-algebra-rows`,
      getKey: (row: { id: string; departmentId: string }) => row.id,
      initialData: [{ id: `row-1`, departmentId: `missing` }],
    }),
  )
  const departments = createCollection(
    mockSyncCollectionOptions({
      id: `query-api-type-algebra-departments`,
      getKey: (row: { id: string; name: string }) => row.id,
      initialData: [{ id: `present`, name: `Present` }],
    }),
  )

  const query = createLiveQueryCollection({
    startSync: true,
    query: (q) =>
      q
        .from({ row: rows })
        .leftJoin({ department: departments }, ({ row, department }) =>
          eq(row.departmentId, department.id),
        )
        .select(({ department }) => ({ department })),
  })

  expect(query.toArray).toHaveLength(1)
  expect(query.toArray[0]!.department).toBeUndefined()
})

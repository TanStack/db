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

test(`branch unions publish unmatched whole-object projections as undefined`, async () => {
  type Person = { id: string }

  const rowsA = createCollection(
    mockSyncCollectionOptions({
      id: `query-api-type-algebra-rows-a`,
      getKey: (row: Person) => row.id,
      initialData: [{ id: `row-1` }],
    }),
  )
  const rowsB = createCollection(
    mockSyncCollectionOptions({
      id: `query-api-type-algebra-rows-b`,
      getKey: (row: Person) => row.id,
      initialData: [{ id: `row-2` }],
    }),
  )
  const othersA = createCollection(
    mockSyncCollectionOptions({
      id: `query-api-type-algebra-others-a`,
      getKey: (row: Person) => row.id,
      initialData: [{ id: `row-1` }],
    }),
  )
  const othersB = createCollection(
    mockSyncCollectionOptions({
      id: `query-api-type-algebra-others-b`,
      getKey: (row: Person) => row.id,
      initialData: [{ id: `other-2` }],
    }),
  )

  const query = createLiveQueryCollection((q) => {
    const branchA = q
      .from({ rowA: rowsA })
      .leftJoin({ otherA: othersA }, ({ rowA, otherA }) =>
        eq(rowA.id, otherA.id),
      )
      .select(({ otherA }) => ({ other: otherA }))
    const branchB = q
      .from({ rowB: rowsB })
      .leftJoin({ otherB: othersB }, ({ rowB, otherB }) =>
        eq(rowB.id, otherB.id),
      )
      .select(({ otherB }) => ({ other: otherB }))

    return q.unionAll(branchA, branchB).select(({ other }) => ({ other }))
  })

  await query.preload()

  expect(query.toArray).toHaveLength(2)
  expect(query.toArray[0]!.other).toMatchObject({ id: `row-1` })
  expect(query.toArray[1]!.other).toBeUndefined()
})

test(`plain branch unions publish nullable-only values as null`, async () => {
  type NullableRow = { id: string; value: number | null }
  const rowsA = createCollection(
    mockSyncCollectionOptions<NullableRow>({
      id: `query-api-type-algebra-nullable-rows-a`,
      getKey: (row) => row.id,
      initialData: [{ id: `null-row`, value: null }],
    }),
  )
  const rowsB = createCollection(
    mockSyncCollectionOptions<NullableRow>({
      id: `query-api-type-algebra-nullable-rows-b`,
      getKey: (row) => row.id,
      initialData: [{ id: `number-row`, value: 1 }],
    }),
  )
  const query = createLiveQueryCollection((q) => {
    const branchA = q.from({ rowsA }).select(({ rowsA: row }) => ({
      id: row.id,
      value: row.value,
    }))
    const branchB = q.from({ rowsB }).select(({ rowsB: row }) => ({
      id: row.id,
      value: row.value,
    }))
    return q.unionAll(branchA, branchB).select(({ id, value }) => ({
      id,
      value,
    }))
  })

  await query.preload()

  expect(query.toArray.find((row) => row.id === `null-row`)?.value).toBeNull()
})

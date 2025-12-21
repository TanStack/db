import { describe, expectTypeOf, test } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { createLiveQueryCollection } from '../../src/query/index.js'
import { refField } from '../../src/query/builder/functions.js'
import { mockSyncCollectionOptions } from '../utils.js'
import type { Ref, RefLeaf } from '../../src/query/builder/types.js'

/**
 * Test for dynamic indexing in select() callbacks
 *
 * This tests the ability to use generic/dynamic keys to index Ref types,
 * which is needed for generic hooks that select fields dynamically.
 *
 * Issue: When using `row.data[columnName]` where columnName is a generic type,
 * TypeScript throws: "Type 'C' cannot be used to index type 'RefLeaf<...> | Ref<...>'"
 *
 * Related: https://gist.github.com/nestarz/f57b738e62edb4e875b4f57399431be2
 */

type User = {
  id: number
  name: string
  email: string
  age: number
  isActive: boolean
}

function createUsers() {
  return createCollection(
    mockSyncCollectionOptions<User>({
      id: `dynamic-indexing-users`,
      getKey: (u) => u.id,
      initialData: [],
    }),
  )
}

describe(`dynamic indexing in select`, () => {
  // Test that Ref types support dynamic indexing with generic keys
  test(`Ref type supports indexing with generic key`, () => {
    type UserRef = Ref<User>

    // Test with literal keys - this should always work
    type NameRef = UserRef[`name`]
    expectTypeOf<NameRef>().toMatchTypeOf<RefLeaf<string>>()

    // Test with union of keys - this is what a generic constraint extends
    type UserKey = keyof User
    type DynamicRef = UserRef[UserKey]
    // This should be a union of all possible RefLeaf/Ref types for User properties
    expectTypeOf<DynamicRef>().toMatchTypeOf<
      RefLeaf<string> | RefLeaf<number> | RefLeaf<boolean>
    >()
  })

  test(`dynamic field selection with generic column name`, () => {
    const users = createUsers()

    // Simulate a generic function that selects a dynamic field
    function selectDynamicField<K extends keyof User>(columnName: K) {
      return createLiveQueryCollection((q) =>
        q.from({ u: users }).select(({ u }) => ({
          id: u.id,
          // This should work: using a generic key to index the ref
          value: u[columnName],
        })),
      )
    }

    // Test with specific column
    const _col = selectDynamicField(`name`)
    type Result = (typeof _col.toArray)[number]

    // The result extracts the underlying type (string | number | boolean)
    // since ResultTypeFromSelect extracts types from RefLeaf
    expectTypeOf<Result>().toMatchTypeOf<{
      id: number
      value: string | number | boolean
    }>()
  })

  test(`refField helper works for simple generic patterns`, () => {
    // The refField helper provides type-safe dynamic field access
    // for cases with a single level of generic type parameters

    function getDynamicField<T extends Record<string, unknown>, K extends keyof T>(
      ref: Ref<T>,
      key: K,
    ) {
      // refField provides type-safe access
      return refField(ref, key)
    }

    // Test the helper with a concrete type
    const userRef = {} as Ref<User>
    const nameField = getDynamicField(userRef, `name`)

    // The result is properly typed as Ref or RefLeaf of the field type
    expectTypeOf(nameField).toMatchTypeOf<Ref<string> | RefLeaf<string>>()
  })

  test(`dynamic field selection preserves type for specific column`, () => {
    const users = createUsers()

    // When column is known at call site, the type should narrow
    const _nameCol = createLiveQueryCollection((q) =>
      q.from({ u: users }).select(({ u }) => ({
        id: u.id,
        name: u[`name` as const],
      })),
    )

    type NameResult = (typeof _nameCol.toArray)[number]
    expectTypeOf<NameResult>().toEqualTypeOf<{
      id: number
      name: string
    }>()
  })

  test(`bracket notation with literal string key`, () => {
    const users = createUsers()

    const _col = createLiveQueryCollection((q) =>
      q.from({ u: users }).select(({ u }) => ({
        id: u.id,
        // Using bracket notation with literal string should work
        name: u[`name`],
        email: u[`email`],
      })),
    )

    type Result = (typeof _col.toArray)[number]
    expectTypeOf<Result>().toEqualTypeOf<{
      id: number
      name: string
      email: string
    }>()
  })

  test(`nested property access with bracket notation`, () => {
    type NestedUser = {
      id: number
      profile: {
        bio: string
        score: number
      }
    }

    const nestedUsers = createCollection(
      mockSyncCollectionOptions<NestedUser>({
        id: `nested-dynamic-indexing-users`,
        getKey: (u) => u.id,
        initialData: [],
      }),
    )

    const _col = createLiveQueryCollection((q) =>
      q.from({ u: nestedUsers }).select(({ u }) => ({
        id: u.id,
        // Nested access with bracket notation
        profile: u[`profile`],
        bio: u.profile[`bio`],
      })),
    )

    type Result = (typeof _col.toArray)[number]
    expectTypeOf<Result>().toEqualTypeOf<{
      id: number
      profile: { bio: string; score: number }
      bio: string
    }>()
  })

  test(`generic hook pattern for dynamic field query`, () => {
    // This is the real-world use case from the bug report
    type DatabaseSchema = {
      users: User
      products: { id: number; name: string; price: number }
    }

    type TableNames<S> = keyof S
    type ColumnNames<S, K extends keyof S> = keyof S[K]

    function useDynamicFieldQuery<
      S extends DatabaseSchema,
      K extends TableNames<S>,
      C extends ColumnNames<S, K>,
    >(tableName: K, columnName: C): S[K][C] {
      // This simulates accessing a collection and selecting a dynamic field
      // The type should work correctly with the generic constraint
      const mockRef = {} as Ref<S[K]>

      // This should not error - dynamic indexing with generic key
      const value = mockRef[columnName]

      // The value should be RefLeaf<S[K][C]> or Ref<S[K][C]>
      return value as S[K][C]
    }

    // Test usage
    const name = useDynamicFieldQuery<DatabaseSchema, `users`, `name`>(
      `users`,
      `name`,
    )
    expectTypeOf(name).toEqualTypeOf<string>()

    const age = useDynamicFieldQuery<DatabaseSchema, `users`, `age`>(
      `users`,
      `age`,
    )
    expectTypeOf(age).toEqualTypeOf<number>()
  })

  test(`RowWrapper pattern with nested data property`, () => {
    // This matches the exact pattern from the bug report
    // RowWrapper<RowData<S, K>> where data is a nested object

    type RowData = {
      name: string
      age: number
      email: string
    }

    type RowWrapper = {
      key: string
      data: RowData
    }

    const rows = createCollection(
      mockSyncCollectionOptions<RowWrapper>({
        id: `row-wrapper-test`,
        getKey: (r) => r.key,
        initialData: [],
      }),
    )

    // Test with generic column selection on nested data
    function selectDataField<C extends keyof RowData>(columnName: C) {
      return createLiveQueryCollection((q) =>
        q.from({ row: rows }).select(({ row }) => ({
          key: row.key,
          // This is the exact pattern from the bug report
          value: row.data[columnName],
        })),
      )
    }

    const _col = selectDataField(`name`)
    type Result = (typeof _col.toArray)[number]

    expectTypeOf<Result>().toMatchTypeOf<{
      key: string
      value: string | number
    }>()
  })

  test(`RowWrapper pattern with optional data property`, () => {
    // Test with optional data property using optional chaining

    type RowData = {
      name: string
      age: number
    }

    type RowWrapper = {
      key: string
      data?: RowData // Optional data property
    }

    const rows = createCollection(
      mockSyncCollectionOptions<RowWrapper>({
        id: `row-wrapper-optional-test`,
        getKey: (r) => r.key,
        initialData: [],
      }),
    )

    // Test with generic column selection on optional nested data
    function selectDataField<C extends keyof RowData>(columnName: C) {
      return createLiveQueryCollection((q) =>
        q.from({ row: rows }).select(({ row }) => ({
          key: row.key,
          // Using optional chaining on optional data property
          value: row.data?.[columnName],
        })),
      )
    }

    const _col = selectDataField(`name`)
    type Result = (typeof _col.toArray)[number]

    // Value should be the union of possible types, plus undefined from optional chaining
    expectTypeOf<Result>().toMatchTypeOf<{
      key: string
      value: string | number | undefined
    }>()
  })

  test(`deeply generic pattern requires type assertion`, () => {
    // This test documents the TypeScript limitation for deeply generic patterns
    // as reported at: https://gist.github.com/nestarz/f57b738e62edb4e875b4f57399431be2
    //
    // LIMITATION: When using deeply nested generics like RowData<S, K> where both
    // S and K are type parameters, TypeScript can't resolve the conditional types
    // in Ref<T>. The resulting deferred union types can't be indexed with generic keys.
    //
    // This is a TypeScript limitation, not a bug in the library. For such patterns,
    // use a type assertion: (row.data as any)[columnName]
    //
    // Note: The refField() helper works for simpler generic cases (single level of
    // generics), but not for deeply nested generic type parameters.

    // The user's schema pattern
    type DatabaseSchema = {
      users: { id: number; name: string; email: string }
      products: { id: number; title: string; price: number }
    }

    type TableNames<S> = keyof S
    type RowData<S, K extends keyof S> = S[K]
    type ColumnNames<S, K extends keyof S> = keyof RowData<S, K>

    // Generic RowWrapper type
    type RowWrapper<T> = {
      key: string
      data: T
    }

    // The generic hook function pattern - requires type assertion
    function useDynamicFieldQuery<
      S extends DatabaseSchema,
      K extends TableNames<S>,
      C extends ColumnNames<S, K>,
    >(
      tableName: K,
      columnName: C,
    ): void {
      // Simulate accessing the collection type
      type CollectionType = RowWrapper<RowData<S, K>>

      const mockCollection = createCollection(
        mockSyncCollectionOptions<CollectionType>({
          id: `generic-pattern-${String(tableName)}`,
          getKey: (r) => r.key,
          initialData: [],
        }),
      )

      // For deeply nested generics, use type assertion
      createLiveQueryCollection((q) =>
        q.from({ row: mockCollection }).select(({ row }) => ({
          key: row.key,
          // Type assertion required for deeply nested generic patterns
          value: (row.data as any)[columnName],
        })),
      )
    }

    // These work correctly
    useDynamicFieldQuery<DatabaseSchema, `users`, `name`>(`users`, `name`)
    useDynamicFieldQuery<DatabaseSchema, `products`, `price`>(`products`, `price`)
  })

  test(`directly testing Ref indexing with generic key constraints`, () => {
    // This tests the underlying Ref type directly with generic constraints
    type TestSchema = {
      a: { x: number; y: string }
      b: { p: boolean; q: Date }
    }

    function testRefIndexing<
      K extends keyof TestSchema,
      C extends keyof TestSchema[K],
    >(_tableKey: K, columnKey: C) {
      type TableType = TestSchema[K]
      const ref = {} as Ref<TableType>

      // This should work - indexing Ref with a generic key that extends keyof TableType
      const value = ref[columnKey]

      // The value should be typed correctly
      return value
    }

    // Verify that the function can be called with different key combinations
    const numValue = testRefIndexing(`a`, `x`)
    const strValue = testRefIndexing(`a`, `y`)
    const boolValue = testRefIndexing(`b`, `p`)

    // The types should be RefLeaf or Ref of the expected types
    expectTypeOf(numValue).toMatchTypeOf<
      RefLeaf<number> | RefLeaf<string> | RefLeaf<boolean> | RefLeaf<Date>
    >()
    expectTypeOf(strValue).toMatchTypeOf<
      RefLeaf<number> | RefLeaf<string> | RefLeaf<boolean> | RefLeaf<Date>
    >()
    expectTypeOf(boolValue).toMatchTypeOf<
      RefLeaf<number> | RefLeaf<string> | RefLeaf<boolean> | RefLeaf<Date>
    >()
  })
})

import { describe, expectTypeOf, it } from "vitest"
import { z } from "zod"
import { electricCollectionOptions } from "../src/electric"
import type { ElectricCollectionConfig } from "../src/electric"
import type { MutationFnParams, ResolveType } from "@tanstack/db"
import type { Row } from "@electric-sql/client"

describe(`Electric collection type resolution tests`, () => {
  // Define test types
  type ExplicitType = { id: string; explicit: boolean }
  type FallbackType = { id: string; fallback: boolean }

  // Define a schema
  const testSchema = z.object({
    id: z.string(),
    schema: z.boolean(),
  })

  type SchemaType = z.infer<typeof testSchema>

  it(`should prioritize explicit type in ElectricCollectionConfig`, () => {
    const options = electricCollectionOptions<ExplicitType>({
      shapeOptions: {
        url: `foo`,
        params: { table: `test_table` },
      },
      getKey: (item) => item.id,
    })

    type ExpectedType = ResolveType<ExplicitType, never, Row<unknown>>
    // The getKey function should have the resolved type
    expectTypeOf(options.getKey).parameters.toEqualTypeOf<[ExplicitType]>()
    expectTypeOf<ExpectedType>().toEqualTypeOf<ExplicitType>()
  })

  it(`should use schema type when explicit type is not provided`, () => {
    const options = electricCollectionOptions({
      shapeOptions: {
        url: `foo`,
        params: { table: `test_table` },
      },
      schema: testSchema,
      getKey: (item) => item.id,
    })

    type ExpectedType = ResolveType<unknown, typeof testSchema, Row<unknown>>
    // The getKey function should have the resolved type
    expectTypeOf(options.getKey).parameters.toEqualTypeOf<[SchemaType]>()
    expectTypeOf<ExpectedType>().toEqualTypeOf<SchemaType>()
  })

  it(`should use fallback type when neither explicit nor schema type is provided`, () => {
    const config: ElectricCollectionConfig<unknown, never, FallbackType> = {
      shapeOptions: {
        url: `foo`,
        params: { table: `test_table` },
      },
      getKey: (item) => item.id,
    }

    const options = electricCollectionOptions<unknown, never, FallbackType>(
      config
    )

    type ExpectedType = ResolveType<unknown, never, FallbackType>
    // The getKey function should have the resolved type
    expectTypeOf(options.getKey).parameters.toEqualTypeOf<[FallbackType]>()
    expectTypeOf<ExpectedType>().toEqualTypeOf<FallbackType>()
  })

  it(`should correctly resolve type with all three types provided`, () => {
    const options = electricCollectionOptions<
      ExplicitType,
      typeof testSchema,
      FallbackType
    >({
      shapeOptions: {
        url: `test_shape`,
        params: { table: `test_table` },
      },
      schema: testSchema,
      getKey: (item) => item.id,
    })

    type ExpectedType = ResolveType<
      ExplicitType,
      typeof testSchema,
      FallbackType
    >
    // The getKey function should have the resolved type
    expectTypeOf(options.getKey).parameters.toEqualTypeOf<[ExplicitType]>()
    expectTypeOf<ExpectedType>().toEqualTypeOf<ExplicitType>()
  })

  it(`should properly type the onInsert, onUpdate, and onDelete handlers`, () => {
    const options = electricCollectionOptions<ExplicitType>({
      shapeOptions: {
        url: `test_shape`,
        params: { table: `test_table` },
      },
      getKey: (item) => item.id,
      onInsert: (params) => {
        // Verify that the mutation value has the correct type
        expectTypeOf(
          params.transaction.mutations[0].modified
        ).toEqualTypeOf<ExplicitType>()
        return Promise.resolve({ txid: `test` })
      },
      onUpdate: (params) => {
        // Verify that the mutation value has the correct type
        expectTypeOf(
          params.transaction.mutations[0].modified
        ).toEqualTypeOf<ExplicitType>()
        return Promise.resolve({ txid: `test` })
      },
      onDelete: (params) => {
        // Verify that the mutation value has the correct type
        expectTypeOf(params.transaction.mutations[0].original).toEqualTypeOf<
          ExplicitType | {}
        >()
        return Promise.resolve({ txid: `test` })
      },
    })

    // Verify that the handlers are properly typed
    if (options.onInsert) {
      expectTypeOf(options.onInsert).parameters.toEqualTypeOf<
        [MutationFnParams<ExplicitType>]
      >()
    }

    if (options.onUpdate) {
      expectTypeOf(options.onUpdate).parameters.toEqualTypeOf<
        [MutationFnParams<ExplicitType>]
      >()
    }

    if (options.onDelete) {
      expectTypeOf(options.onDelete).parameters.toEqualTypeOf<
        [MutationFnParams<ExplicitType>]
      >()
    }
  })
})

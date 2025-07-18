import { describe, expectTypeOf, it } from "vitest"
import { z } from "zod"
import { materializeCollectionOptions } from "../src/materialize"
import type { LSN, MaterializeCollectionConfig } from "../src/materialize"
import type {
  DeleteMutationFnParams,
  InsertMutationFnParams,
  UpdateMutationFnParams,
} from "@tanstack/db"

describe(`Materialize collection type tests`, () => {
  // Define test types
  type ExplicitType = { id: string; title: string; completed: boolean }

  // Define a schema
  const testSchema = z.object({
    id: z.string(),
    name: z.string(),
    active: z.boolean(),
  })

  type SchemaType = z.infer<typeof testSchema>

  it(`should correctly type MaterializeCollectionConfig with explicit type`, () => {
    const config: MaterializeCollectionConfig<ExplicitType> = {
      websocketUrl: `ws://localhost:3000/api/todos-ws`,
      getKey: (item) => item.id,
      onInsert: async (params) => {
        // Verify that the mutation value has the correct type
        await Promise.resolve()
        expectTypeOf(
          params.transaction.mutations[0].modified
        ).toEqualTypeOf<ExplicitType>()

        return {
          beforeLSN: `1000` as LSN,
          afterLSN: `1005` as LSN,
        }
      },
    }

    expectTypeOf(config.getKey).parameters.toEqualTypeOf<[ExplicitType]>()
  })

  it(`should correctly type the options returned by materializeCollectionOptions`, () => {
    const options = materializeCollectionOptions<ExplicitType>({
      websocketUrl: `ws://localhost:3000/api/todos-ws`,
      getKey: (item) => item.id,
    })

    // The getKey function should have the correct type
    expectTypeOf(options.getKey).parameters.toEqualTypeOf<[ExplicitType]>()
  })

  it(`should properly type the onInsert handler`, () => {
    const options = materializeCollectionOptions<ExplicitType>({
      websocketUrl: `ws://localhost:3000/api/todos-ws`,
      getKey: (item) => item.id,
      onInsert: (params) => {
        // Verify that the mutation value has the correct type
        expectTypeOf(
          params.transaction.mutations[0].modified
        ).toEqualTypeOf<ExplicitType>()

        // Verify collection type
        expectTypeOf(params.collection).toMatchTypeOf<{
          utils: {
            getCurrentLSN: () => LSN | null
            awaitSync: (
              beforeLSN: LSN,
              afterLSN: LSN,
              timeout?: number
            ) => Promise<boolean>
          }
        }>()

        return Promise.resolve({
          beforeLSN: `1000` as LSN,
          afterLSN: `1005` as LSN,
        })
      },
    })

    // Verify that the handler is properly typed
    if (options.onInsert) {
      expectTypeOf(options.onInsert).parameters.toEqualTypeOf<
        [InsertMutationFnParams<ExplicitType, string | number>]
      >()

      expectTypeOf(options.onInsert).returns.toEqualTypeOf<
        Promise<{ beforeLSN: LSN; afterLSN: LSN }>
      >()
    }
  })

  it(`should properly type the onUpdate handler`, () => {
    const options = materializeCollectionOptions<ExplicitType>({
      websocketUrl: `ws://localhost:3000/api/todos-ws`,
      getKey: (item) => item.id,
      onUpdate: (params) => {
        // Verify that the mutation original and modified have the correct types
        expectTypeOf(
          params.transaction.mutations[0].original
        ).toEqualTypeOf<ExplicitType>()
        expectTypeOf(
          params.transaction.mutations[0].modified
        ).toEqualTypeOf<ExplicitType>()

        return Promise.resolve({
          beforeLSN: `2000` as LSN,
          afterLSN: `2005` as LSN,
        })
      },
    })

    // Verify that the handler is properly typed
    if (options.onUpdate) {
      expectTypeOf(options.onUpdate).parameters.toEqualTypeOf<
        [UpdateMutationFnParams<ExplicitType, string | number>]
      >()

      expectTypeOf(options.onUpdate).returns.toEqualTypeOf<
        Promise<{ beforeLSN: LSN; afterLSN: LSN }>
      >()
    }
  })

  it(`should properly type the onDelete handler`, () => {
    const options = materializeCollectionOptions<ExplicitType>({
      websocketUrl: `ws://localhost:3000/api/todos-ws`,
      getKey: (item) => item.id,
      onDelete: (params) => {
        // Verify that the mutation original has the correct type
        expectTypeOf(
          params.transaction.mutations[0].original
        ).toEqualTypeOf<ExplicitType>()

        return Promise.resolve({
          beforeLSN: `3000` as LSN,
          afterLSN: `3005` as LSN,
        })
      },
    })

    // Verify that the handler is properly typed
    if (options.onDelete) {
      expectTypeOf(options.onDelete).parameters.toEqualTypeOf<
        [DeleteMutationFnParams<ExplicitType, string | number>]
      >()

      expectTypeOf(options.onDelete).returns.toEqualTypeOf<
        Promise<{ beforeLSN: LSN; afterLSN: LSN }>
      >()
    }
  })

  it(`should properly type the utilities`, () => {
    const options = materializeCollectionOptions<ExplicitType>({
      websocketUrl: `ws://localhost:3000/api/todos-ws`,
      getKey: (item) => item.id,
    })

    // Verify utility function types
    expectTypeOf(options.utils.disconnect).toEqualTypeOf<() => void>()
    expectTypeOf(options.utils.refresh).toEqualTypeOf<() => Promise<void>>()
    expectTypeOf(options.utils.isConnected).toEqualTypeOf<() => boolean>()
    expectTypeOf(options.utils.getCurrentLSN).toEqualTypeOf<() => LSN | null>()
    expectTypeOf(options.utils.awaitSync).toEqualTypeOf<
      (beforeLSN: LSN, afterLSN: LSN, timeout?: number) => Promise<boolean>
    >()
  })

  it(`should handle schema-based type inference`, () => {
    const options = materializeCollectionOptions({
      websocketUrl: `ws://localhost:3000/api/items-ws`,
      schema: testSchema,
      getKey: (item) => item.id,
      onInsert: (params) => {
        // Should infer type from schema
        expectTypeOf(
          params.transaction.mutations[0].modified
        ).toEqualTypeOf<SchemaType>()

        return Promise.resolve({
          beforeLSN: `1000` as LSN,
          afterLSN: `1005` as LSN,
        })
      },
    })

    // The getKey function should work with schema-inferred type
    expectTypeOf(options.getKey).parameters.toEqualTypeOf<[SchemaType]>()
  })

  it(`should handle optional configuration properties`, () => {
    // Minimal config should work
    const minimalConfig: MaterializeCollectionConfig<ExplicitType> = {
      websocketUrl: `ws://localhost:3000/api/todos-ws`,
      getKey: (item) => item.id,
    }

    expectTypeOf(minimalConfig).toMatchTypeOf<
      MaterializeCollectionConfig<ExplicitType>
    >()

    // Full config should also work
    const fullConfig: MaterializeCollectionConfig<ExplicitType> = {
      id: `test-collection`,
      websocketUrl: `ws://localhost:3000/api/todos-ws`,
      schema: testSchema,
      getKey: (item) => item.id,
      sync: undefined, // Optional
      // eslint-disable-next-line
      onInsert: async () => ({ beforeLSN: `1000`, afterLSN: `1005` }),
      // eslint-disable-next-line
      onUpdate: async () => ({ beforeLSN: `2000`, afterLSN: `2005` }),
      // eslint-disable-next-line
      onDelete: async () => ({ beforeLSN: `3000`, afterLSN: `3005` }),
    }

    expectTypeOf(fullConfig).toMatchTypeOf<
      MaterializeCollectionConfig<ExplicitType>
    >()
  })

  it(`should properly constrain LSN types`, () => {
    // LSN should be a string
    expectTypeOf<LSN>().toEqualTypeOf<string>()

    // Handler return types should require LSN strings
    // eslint-disable-next-line
    const handler = async (): Promise<{ beforeLSN: LSN; afterLSN: LSN }> => {
      return {
        beforeLSN: `1000`, // Should accept string
        afterLSN: `1005`, // Should accept string
      }
    }

    expectTypeOf(handler).returns.toEqualTypeOf<
      Promise<{ beforeLSN: LSN; afterLSN: LSN }>
    >()
  })
})

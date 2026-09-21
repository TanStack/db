import { describe, expectTypeOf, it } from 'vitest'
import { Schema, Table, column } from '@powersync/node'
import { z } from 'zod'
import { createCollection } from '@tanstack/db'
import { powerSyncCollectionOptions } from '../src'
import type {
  ChangeMessageOrDeleteKeyMessage,
  WithVirtualProps,
} from '@tanstack/db'
import type { PowerSyncDatabase } from '@powersync/node'
import type { ConfigWithArbitraryCollectionTypes } from '../src'

const database = {} as PowerSyncDatabase
const appSchema = new Schema({
  rows: new Table({
    created_at: column.text,
    score: column.integer,
    label: column.text,
    note: column.text,
    enabled: column.integer,
  }),
})

const sqliteTransformSchema = z.object({
  id: z.string().brand<`PowerSyncRowId`>(),
  created_at: z
    .string()
    .nullable()
    .default(null)
    .transform((value) =>
      value ? new Date(value) : new Date(`1970-01-01T00:00:00.000Z`),
    ),
  score: z
    .number()
    .nullable()
    .default(0)
    .transform((value) => value ?? 0)
    .brand<`Score`>(),
  label: z
    .string()
    .nullable()
    .default(`untitled`)
    .transform((value) => value ?? `untitled`),
  note: z.string().nullable().default(null),
  enabled: z
    .number()
    .nullable()
    .default(0)
    .transform((value) => Boolean(value)),
})

const applicationSchema = z.object({
  id: z.string().brand<`PowerSyncRowId`>(),
  created_at: z.date(),
  score: z.number().brand<`Score`>(),
  label: z.string(),
  note: z.string().nullable(),
  enabled: z.boolean(),
})

const applicationDeserializer = z.object({
  id: z.string().brand<`PowerSyncRowId`>(),
  created_at: z
    .string()
    .nullable()
    .transform((value) => new Date(value!)),
  score: z
    .number()
    .nullable()
    .transform(
      (value) => (value ?? 0) as z.output<typeof applicationSchema>[`score`],
    ),
  label: z
    .string()
    .nullable()
    .transform((value) => value ?? `untitled`),
  note: z.string().nullable(),
  enabled: z
    .number()
    .nullable()
    .transform((value) => Boolean(value)),
})

type SqliteInput = z.input<typeof sqliteTransformSchema>
type SqliteOutput = z.output<typeof sqliteTransformSchema>
type ApplicationInput = z.input<typeof applicationSchema>
type ApplicationOutput = z.output<typeof applicationSchema>
type ItemOf<T> = T extends Array<infer U> ? U : T

const sqliteInput = {
  id: `row-1`,
  created_at: `2026-09-18T12:00:00.000Z`,
  score: 42,
  note: null,
  enabled: 1,
} satisfies SqliteInput

const applicationInput = {
  id: `row-1`,
  created_at: new Date(`2026-09-18T12:00:00.000Z`),
  score: 42,
  label: `untitled`,
  note: null,
  enabled: true,
} satisfies ApplicationInput

const synchronizedOutput = {
  id: `row-1` as ApplicationOutput[`id`],
  created_at: new Date(`2026-09-18T12:00:00.000Z`),
  score: 42 as ApplicationOutput[`score`],
  label: `untitled`,
  note: null,
  enabled: true,
} satisfies ApplicationOutput

/**
 * Adapter mapping for the shared schema input/output law:
 * PowerSync has two supported production type paths. A transforming Collection
 * schema maps SQLite-shaped input to Collection output. With an application
 * schema, `deserializationSchema` maps SQLite rows to that schema's exact
 * output. In both paths, public mutations accept the Collection schema input;
 * compare, serializer, Collection rows, and sync change messages use output.
 *
 * The assertions observe both paths after TypeScript resolves the public
 * options and Collection types. Hostile controls reject SQLite values at an
 * application mutation boundary, application values at a SQLite mutation
 * boundary, input rows at the sync boundary, and a deserializer with the wrong
 * output. This partial oracle does not execute database reads, parsing,
 * serialization, or deserialization-error handling.
 */
describe(`PowerSync schema transform conformance`, () => {
  it(`transforms SQLite-shaped mutation and sync rows to exact output`, () => {
    const options = powerSyncCollectionOptions({
      database,
      table: appSchema.props.rows,
      schema: sqliteTransformSchema,
      onDeserializationError: () => {},
      serializer: {
        created_at: (value) => value.toISOString(),
        score: (value) => value,
        enabled: (value) => (value ? 1 : 0),
      },
      compare: (left, right) => {
        expectTypeOf(left).toEqualTypeOf<SqliteOutput>()
        expectTypeOf(right).toEqualTypeOf<SqliteOutput>()
        expectTypeOf(left.id).toEqualTypeOf<SqliteOutput[`id`]>()
        expectTypeOf(left.created_at).toEqualTypeOf<Date>()
        expectTypeOf(left.score).toEqualTypeOf<ApplicationOutput[`score`]>()
        expectTypeOf(left.label).toEqualTypeOf<string>()
        expectTypeOf(left.note).toEqualTypeOf<string | null>()
        expectTypeOf(left.enabled).toEqualTypeOf<boolean>()
        return left.score - right.score
      },
    })
    const collection = createCollection(options)

    expectTypeOf(collection.toArray).toEqualTypeOf<
      Array<WithVirtualProps<SqliteOutput, string>>
    >()

    type Insert = ItemOf<Parameters<typeof collection.insert>[0]>
    expectTypeOf<Insert>().toEqualTypeOf<SqliteInput>()
    collection.update(`row-1`, (draft) => {
      expectTypeOf(draft).toEqualTypeOf<SqliteInput>()
    })

    const assertMutationInput = () => {
      collection.insert(sqliteInput)
      // @ts-expect-error SQLite-shaped mutations do not accept booleans
      collection.insert({ ...sqliteInput, enabled: true })
    }
    expectTypeOf(assertMutationInput).toBeFunction()
  })

  it(`respects the explicit SQLite deserialization boundary`, () => {
    const options = powerSyncCollectionOptions({
      database,
      table: appSchema.props.rows,
      schema: applicationSchema,
      deserializationSchema: applicationDeserializer,
      onDeserializationError: () => {},
      serializer: {
        created_at: (value) => {
          expectTypeOf(value).toEqualTypeOf<Date>()
          return value.toISOString()
        },
        score: (value) => {
          expectTypeOf(value).toEqualTypeOf<ApplicationOutput[`score`]>()
          return value
        },
        enabled: (value) => {
          expectTypeOf(value).toEqualTypeOf<boolean>()
          return value ? 1 : 0
        },
      },
      compare: (left, right) => {
        expectTypeOf(left).toEqualTypeOf<ApplicationOutput>()
        expectTypeOf(right).toEqualTypeOf<ApplicationOutput>()
        return left.score - right.score
      },
    })
    const collection = createCollection(options)

    expectTypeOf(collection.toArray).toEqualTypeOf<
      Array<WithVirtualProps<ApplicationOutput, string>>
    >()

    type Insert = ItemOf<Parameters<typeof collection.insert>[0]>
    expectTypeOf<Insert>().toEqualTypeOf<ApplicationInput>()
    collection.update(`row-1`, (draft) => {
      expectTypeOf(draft).toEqualTypeOf<ApplicationInput>()
    })

    type SyncParams = Parameters<(typeof options)[`sync`][`sync`]>[0]
    type SyncMessage = Parameters<SyncParams[`write`]>[0]
    expectTypeOf<SyncMessage>().toEqualTypeOf<
      ChangeMessageOrDeleteKeyMessage<ApplicationOutput, string>
    >()

    const assertSyncBoundary = (write: SyncParams[`write`]) => {
      write({ type: `insert`, value: synchronizedOutput })
      // @ts-expect-error SQLite/mutation input is not synchronized output
      write({ type: `insert`, value: sqliteInput })
    }
    expectTypeOf(assertSyncBoundary).toBeFunction()

    const assertMutationInput = () => {
      collection.insert(applicationInput)
      // @ts-expect-error application mutations use booleans, not SQLite integers
      collection.insert({ ...applicationInput, enabled: 1 })
    }
    expectTypeOf(assertMutationInput).toBeFunction()
  })

  it(`rejects a deserializer whose output is not collection output`, () => {
    const wrongDeserializer = z.object({
      id: z.string(),
      created_at: z.string().nullable(),
      score: z.number().nullable(),
      label: z.string().nullable(),
      note: z.string().nullable(),
      enabled: z.number().nullable(),
    })

    type DeserializationSchema = ConfigWithArbitraryCollectionTypes<
      (typeof appSchema.props)[`rows`],
      typeof applicationSchema
    >[`deserializationSchema`]
    const acceptDeserializer = (_schema: DeserializationSchema) => {}

    // @ts-expect-error deserialization must produce collection output
    acceptDeserializer(wrongDeserializer)
  })
})

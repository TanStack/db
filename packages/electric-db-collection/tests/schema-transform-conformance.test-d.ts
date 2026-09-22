import { describe, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import { createCollection } from '@tanstack/db'
import { electricCollectionOptions } from '../src/electric'
import type {
  ChangeMessageOrDeleteKeyMessage,
  WithVirtualProps,
} from '@tanstack/db'

const rowSchema = z.object({
  id: z.string().brand<`ElectricRowId`>(),
  createdAt: z
    .union([z.string(), z.date()])
    .transform((value) =>
      typeof value === `string` ? new Date(value) : value,
    ),
  score: z
    .union([z.string(), z.number()])
    .transform((value) => (typeof value === `string` ? Number(value) : value)),
  label: z.string().default(`untitled`),
  note: z.string().nullish(),
})

type RowInput = z.input<typeof rowSchema>
type RowOutput = z.output<typeof rowSchema>
type RowId = RowOutput[`id`]
type ItemOf<T> = T extends Array<infer U> ? U : T

const rawInput = {
  id: `row-1`,
  createdAt: `2026-09-18T12:00:00.000Z`,
  score: `42`,
  note: null,
} satisfies RowInput

const synchronizedOutput = {
  id: `row-1` as RowId,
  createdAt: new Date(`2026-09-18T12:00:00.000Z`),
  score: 42,
  label: `untitled`,
  note: null,
} satisfies RowOutput

/**
 * Adapter mapping for the shared schema input/output law:
 * `electricCollectionOptions` carries Electric shape rows into sync change
 * messages as schema output. `getKey`, `compare`, Collection rows, and handler
 * mutations observe that output. Public insert and update entry points accept
 * schema input. Electric deliberately keeps its public Collection key domain
 * at `string | number`; it does not infer the schema's branded ID type.
 *
 * The assertions observe those production type paths after overload
 * resolution. Hostile controls reject an untransformed shape row at the sync
 * boundary and an invalid value at the mutation boundary. This partial oracle
 * does not execute Shape parsing, network I/O, or mutation-handler timing.
 */
describe(`Electric schema transform conformance`, () => {
  it(`keeps the shape and mutation sides distinct`, () => {
    const options = electricCollectionOptions({
      shapeOptions: { url: `https://example.com/v1/shape` },
      schema: rowSchema,
      getKey: (row) => {
        expectTypeOf(row).toEqualTypeOf<RowOutput>()
        expectTypeOf(row.id).toEqualTypeOf<RowId>()
        expectTypeOf(row.createdAt).toEqualTypeOf<Date>()
        expectTypeOf(row.score).toEqualTypeOf<number>()
        expectTypeOf(row.label).toEqualTypeOf<string>()
        expectTypeOf(row.note).toEqualTypeOf<string | null | undefined>()
        return row.id
      },
      compare: (left, right) => left.score - right.score,
      onInsert: ({ transaction }) => {
        expectTypeOf(
          transaction.mutations[0].modified,
        ).toEqualTypeOf<RowOutput>()
        return Promise.resolve()
      },
    })
    const collection = createCollection(options)

    expectTypeOf(options.getKey).parameters.toEqualTypeOf<[RowOutput]>()
    expectTypeOf(options.getKey).returns.toEqualTypeOf<string | number>()
    expectTypeOf(collection.toArray).toEqualTypeOf<
      Array<WithVirtualProps<RowOutput, string | number>>
    >()

    type Insert = ItemOf<Parameters<typeof collection.insert>[0]>
    expectTypeOf<Insert>().toEqualTypeOf<RowInput>()
    collection.update(`row-1`, (draft) => {
      expectTypeOf(draft).toEqualTypeOf<RowInput>()
    })

    type SyncParams = Parameters<(typeof options)[`sync`][`sync`]>[0]
    type SyncMessage = Parameters<SyncParams[`write`]>[0]
    expectTypeOf<SyncMessage>().toEqualTypeOf<
      ChangeMessageOrDeleteKeyMessage<RowOutput, string | number>
    >()

    const assertShapeBoundary = (write: SyncParams[`write`]) => {
      const wrongDate = {
        ...synchronizedOutput,
        createdAt: rawInput.createdAt,
      }

      write({ type: `insert`, value: synchronizedOutput })
      // @ts-expect-error one untransformed field cannot cross the sync boundary
      write({ type: `insert`, value: wrongDate })
      // @ts-expect-error an untransformed shape row is not collection output
      write({ type: `insert`, value: rawInput })
    }
    expectTypeOf(assertShapeBoundary).toBeFunction()

    const assertMutationInput = () => {
      collection.insert(rawInput)
      // @ts-expect-error mutation input does not accept unrelated numeric shapes
      collection.insert({ ...rawInput, score: false })
    }
    expectTypeOf(assertMutationInput).toBeFunction()
  })
})

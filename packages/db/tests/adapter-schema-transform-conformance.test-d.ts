import { describe, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import { createCollection } from '../src/index'
import { localOnlyCollectionOptions } from '../src/local-only'
import { localStorageCollectionOptions } from '../src/local-storage'
import type { ChangeMessageOrDeleteKeyMessage } from '../src/types'
import type { OutputWithVirtual } from './utils'

const rowSchema = z.object({
  id: z.string().brand<`AdapterRowId`>(),
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

type ItemOf<T> = T extends Array<infer U> ? U : T

/**
 * Contract card:
 * - Schema output is the stored/read/synchronized row and the input to getKey.
 * - Schema input is accepted by insert and exposed as the update draft.
 * - The matrix crosses transformed Date/number fields, a branded key, a
 *   defaulted field, and a nullish field.
 * - The input-only synchronized-row controls are deliberate hostile mutants.
 */
describe(`local adapter schema transform conformance`, () => {
  it(`keeps local-only synchronized rows on the output side`, () => {
    const options = localOnlyCollectionOptions({
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
      initialData: [synchronizedOutput],
    })
    const collection = createCollection(options)

    expectTypeOf(options.getKey).parameters.toEqualTypeOf<[RowOutput]>()
    expectTypeOf(options.getKey).returns.toEqualTypeOf<RowId>()
    expectTypeOf(collection.toArray).toEqualTypeOf<
      Array<OutputWithVirtual<RowOutput, RowId>>
    >()

    type Insert = ItemOf<Parameters<typeof collection.insert>[0]>
    expectTypeOf<Insert>().toEqualTypeOf<RowInput>()
    collection.update(`row-1` as RowId, (draft) => {
      expectTypeOf(draft).toEqualTypeOf<RowInput>()
    })

    type SyncParams = Parameters<(typeof options)[`sync`][`sync`]>[0]
    type SyncMessage = Parameters<SyncParams[`write`]>[0]
    expectTypeOf<SyncMessage>().toEqualTypeOf<
      ChangeMessageOrDeleteKeyMessage<RowOutput, RowId>
    >()

    const assertBoundary = (write: SyncParams[`write`]) => {
      write({ type: `insert`, value: synchronizedOutput })
      // @ts-expect-error input-only rows have not crossed the schema boundary
      write({ type: `insert`, value: rawInput })
    }
    expectTypeOf(assertBoundary).toBeFunction()

    const assertMutationInput = () => {
      collection.insert(rawInput)
      // @ts-expect-error transformed fields reject unrelated values
      collection.insert({ ...rawInput, score: false })
    }
    expectTypeOf(assertMutationInput).toBeFunction()
  })

  it(`keeps local-storage synchronized rows on the output side`, () => {
    const options = localStorageCollectionOptions({
      storageKey: `adapter-schema-transform-conformance`,
      schema: rowSchema,
      getKey: (row) => {
        expectTypeOf(row).toEqualTypeOf<RowOutput>()
        return row.id
      },
      compare: (left, right) => {
        expectTypeOf(left).toEqualTypeOf<RowOutput>()
        expectTypeOf(right).toEqualTypeOf<RowOutput>()
        return left.score - right.score
      },
    })
    const collection = createCollection(options)

    expectTypeOf(options.getKey).parameters.toEqualTypeOf<[RowOutput]>()
    expectTypeOf(options.getKey).returns.toEqualTypeOf<RowId>()
    expectTypeOf(collection.toArray).toEqualTypeOf<
      Array<OutputWithVirtual<RowOutput, RowId>>
    >()

    type Insert = ItemOf<Parameters<typeof collection.insert>[0]>
    expectTypeOf<Insert>().toEqualTypeOf<RowInput>()
    collection.update(`row-1` as RowId, (draft) => {
      expectTypeOf(draft).toEqualTypeOf<RowInput>()
    })

    type SyncParams = Parameters<(typeof options)[`sync`][`sync`]>[0]
    type SyncMessage = Parameters<SyncParams[`write`]>[0]
    expectTypeOf<SyncMessage>().toEqualTypeOf<
      ChangeMessageOrDeleteKeyMessage<RowOutput, RowId>
    >()

    const assertBoundary = (write: SyncParams[`write`]) => {
      write({ type: `insert`, value: synchronizedOutput })
      // @ts-expect-error storage parsing must produce schema output rows
      write({ type: `insert`, value: rawInput })
    }
    expectTypeOf(assertBoundary).toBeFunction()

    type LocalStorageOutput = ItemOf<typeof collection.toArray>
    const assertOutput = (row: LocalStorageOutput) => {
      row.createdAt.getTime()
      row.score.toFixed()
      expectTypeOf(row.label).toEqualTypeOf<string>()
      // @ts-expect-error output dates do not expose string methods
      row.createdAt.toUpperCase()
    }
    expectTypeOf(assertOutput).toBeFunction()
  })
})

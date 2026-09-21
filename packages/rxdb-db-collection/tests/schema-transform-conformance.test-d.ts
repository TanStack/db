import { describe, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import { createCollection } from '@tanstack/db'
import { rxdbCollectionOptions } from '../src/rxdb'
import type {
  ChangeMessageOrDeleteKeyMessage,
  WithVirtualProps,
} from '@tanstack/db'
import type { RxCollection } from 'rxdb/plugins/core'

const rowSchema = z.object({
  id: z.string().brand<`RxDBRowId`>(),
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
 * `rxdbCollectionOptions` requires the RxDB document type to equal schema
 * output because RxDB supplies sync rows. `getKey`, `compare`, Collection rows,
 * and sync change messages observe that output. Public insert and update entry
 * points accept schema input.
 *
 * The assertions observe those production type paths after option and
 * Collection inference. Hostile controls reject an input row at the sync
 * boundary and an input-shaped `RxCollection`. This partial oracle does not
 * execute RxDB subscriptions, provider I/O, or schema parsing.
 */
describe(`RxDB schema transform conformance`, () => {
  it(`requires output-shaped RxDB documents`, () => {
    const rxCollection = {} as RxCollection<
      RowOutput,
      unknown,
      unknown,
      unknown
    >
    const options = rxdbCollectionOptions({
      rxCollection,
      schema: rowSchema,
      compare: (left, right) => {
        expectTypeOf(left).toEqualTypeOf<RowOutput>()
        expectTypeOf(right).toEqualTypeOf<RowOutput>()
        return left.score - right.score
      },
    })
    const collection = createCollection(options)

    expectTypeOf(options.getKey).parameters.toEqualTypeOf<[RowOutput]>()
    expectTypeOf(collection.toArray).toEqualTypeOf<
      Array<WithVirtualProps<RowOutput, string>>
    >()

    type Insert = ItemOf<Parameters<typeof collection.insert>[0]>
    expectTypeOf<Insert>().toEqualTypeOf<RowInput>()
    collection.update(`row-1`, (draft) => {
      expectTypeOf(draft).toEqualTypeOf<RowInput>()
    })

    type SyncParams = Parameters<(typeof options)[`sync`][`sync`]>[0]
    type SyncMessage = Parameters<SyncParams[`write`]>[0]
    expectTypeOf<SyncMessage>().toEqualTypeOf<
      ChangeMessageOrDeleteKeyMessage<RowOutput, string>
    >()

    const assertRxDBBoundary = (write: SyncParams[`write`]) => {
      write({ type: `insert`, value: synchronizedOutput })
      // @ts-expect-error RxDB sync must not publish schema input rows
      write({ type: `insert`, value: rawInput })
    }
    expectTypeOf(assertRxDBBoundary).toBeFunction()
  })

  it(`rejects an input-shaped RxDB collection`, () => {
    const inputCollection = {} as RxCollection<
      RowInput,
      unknown,
      unknown,
      unknown
    >

    rxdbCollectionOptions({
      rxCollection: inputCollection,
      // @ts-expect-error provider documents must match schema output
      schema: rowSchema,
    })
  })
})

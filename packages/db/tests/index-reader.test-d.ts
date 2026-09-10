import { expectTypeOf, test } from 'vitest'
import type {
  IndexReader,
  ReverseIndex,
  findIndexForField,
} from '../src/index.js'

test(`resolved indexes expose a named read interface`, () => {
  expectTypeOf<ReturnType<typeof findIndexForField>>().toEqualTypeOf<
    IndexReader | undefined
  >()
  expectTypeOf<ReverseIndex<number>>().toMatchTypeOf<IndexReader<number>>()
})

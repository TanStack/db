import { assertType, describe, expectTypeOf, it } from "vitest"
import type { CollectionImpl } from "../src/collection"
import type { OperationConfig } from "../src/types"

describe(`Collection.update type tests`, () => {
  type TypeTestItem = { id: string; value: number; optional?: boolean }

  const updateMethod: CollectionImpl<TypeTestItem>[`update`] = (() => {}) as any // Dummy assignment for type checking

  it(`should correctly type drafts for multi-item update with callback (Overload 1)`, () => {
    updateMethod([`id1`, `id2`], (drafts) => {
      expectTypeOf(drafts).toEqualTypeOf<Array<TypeTestItem>>()
      // @ts-expect-error - This line should error because drafts is an array, not a single item.
      assertType<TypeTestItem>(drafts)
    })
  })

  it(`should correctly type drafts for multi-item update with config and callback (Overload 2)`, () => {
    const config: OperationConfig = { metadata: { test: true } }
    updateMethod([`id1`, `id2`], config, (drafts) => {
      expectTypeOf(drafts).toEqualTypeOf<Array<TypeTestItem>>()
      // @ts-expect-error - This line should error.
      assertType<TypeTestItem>(drafts)
    })
  })

  it(`should correctly type draft for single-item update with callback (Overload 3)`, () => {
    updateMethod(`id1`, (draft) => {
      expectTypeOf(draft).toEqualTypeOf<TypeTestItem>()
      // @ts-expect-error - This line should error because draft is a single item, not an array.
      assertType<Array<TypeTestItem>>(draft)
    })
  })

  it(`should correctly type draft for single-item update with config and callback (Overload 4)`, () => {
    const config: OperationConfig = { metadata: { test: true } }
    updateMethod(`id1`, config, (draft) => {
      expectTypeOf(draft).toEqualTypeOf<TypeTestItem>()
      // @ts-expect-error - This line should error.
      assertType<Array<TypeTestItem>>(draft)
    })
  })
})

import { describe, expectTypeOf, it } from "vitest"
import { D2 } from "../../src/d2.js"
import { keyBy, rekey, unkey } from "../../src/operators/keying.js"
import type { Keyed } from "../../src/operators/keying.js"
import type { IStreamBuilder } from "../../src/types.js"

interface TestItem {
  id: number
  name: string
  value: number
}

describe(`keying operator types`, () => {
  it(`should correctly type keyBy`, () => {
    const d2 = new D2()
    const input = d2.newInput<TestItem>()

    const keyed = input.pipe(keyBy((item) => item.id))
    expectTypeOf(keyed).toEqualTypeOf<IStreamBuilder<Keyed<number, TestItem>>>()
  })

  it(`should correctly type unkey`, () => {
    const d2 = new D2()
    const input = d2.newInput<Keyed<number, TestItem>>()

    const unkeyed = input.pipe(unkey())
    expectTypeOf(unkeyed).toEqualTypeOf<IStreamBuilder<TestItem>>()
  })

  it(`should correctly type rekey`, () => {
    const d2 = new D2()
    const input = d2.newInput<Keyed<number, TestItem>>()

    const rekeyed = input.pipe(rekey((item) => item.name))
    expectTypeOf(rekeyed).toEqualTypeOf<
      IStreamBuilder<Keyed<string, TestItem>>
    >()
  })

  it(`should maintain type safety through chaining`, () => {
    const d2 = new D2()
    const input = d2.newInput<TestItem>()

    const result = input
      .pipe(keyBy((item) => item.id))
      .pipe(rekey((item) => item.name))
      .pipe(unkey())

    expectTypeOf(result).toEqualTypeOf<IStreamBuilder<TestItem>>()
  })
})

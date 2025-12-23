import { describe, expect, it } from 'vitest'
import { createDeferred } from '../src/deferred'
import type { Deferred } from '../src/deferred'

describe(`Deferred`, () => {
  it(`should create a deferred object with the correct shape`, () => {
    const deferred = createDeferred<number>()
    expect(deferred).toHaveProperty(`promise`)
    expect(deferred).toHaveProperty(`resolve`)
    expect(deferred).toHaveProperty(`reject`)
    expect(deferred).toHaveProperty(`isPending`)
    expect(typeof deferred.resolve).toBe(`function`)
    expect(typeof deferred.reject).toBe(`function`)
    expect(typeof deferred.isPending).toBe(`function`)
  })

  it(`should resolve with the correct value`, async () => {
    const deferred = createDeferred<number>()
    deferred.resolve(42)
    const result = await deferred.promise
    expect(result).toBe(42)
  })

  it(`should reject with the correct error`, async () => {
    const deferred = createDeferred<number>()
    const error = new Error(`test error`)
    deferred.reject(error)
    await expect(deferred.promise).rejects.toThrow(error)
  })

  it(`should track pending state correctly`, () => {
    const deferred = createDeferred<number>()
    expect(deferred.isPending()).toBe(true)
    deferred.resolve(42)
    expect(deferred.isPending()).toBe(false)
  })

  it(`should track pending state after rejection`, async () => {
    const deferred = createDeferred<number>()
    expect(deferred.isPending()).toBe(true)

    const error = new Error(`test error`)
    deferred.reject(error)
    await expect(deferred.promise).rejects.toThrow(error)
    expect(deferred.isPending()).toBe(false)
  })

  it(`should work with different types`, async () => {
    // String type
    const stringDeferred = createDeferred<string>()
    stringDeferred.resolve(`hello`)
    expect(await stringDeferred.promise).toBe(`hello`)

    // Object type
    interface TestObject {
      foo: string
      bar: number
    }
    const objectDeferred = createDeferred<TestObject>()
    const testObj = { foo: `test`, bar: 123 }
    objectDeferred.resolve(testObj)
    expect(await objectDeferred.promise).toEqual(testObj)

    // Array type
    const arrayDeferred = createDeferred<Array<number>>()
    arrayDeferred.resolve([1, 2, 3])
    expect(await arrayDeferred.promise).toEqual([1, 2, 3])

    // Union type
    const unionDeferred = createDeferred<string | number>()
    unionDeferred.resolve(42)
    expect(await unionDeferred.promise).toBe(42)
  })

  it(`should handle promise chaining`, async () => {
    const deferred = createDeferred<number>()
    const chainedPromise = deferred.promise
      .then((x) => x * 2)
      .then((x) => x.toString())

    deferred.resolve(21)
    const result = await chainedPromise
    expect(result).toBe(`42`)
  })

  it(`should handle async resolution`, async () => {
    const deferred = createDeferred<number>()
    const asyncValue = Promise.resolve(42)
    deferred.resolve(asyncValue)
    const result = await deferred.promise
    expect(result).toBe(42)
  })

  // Type tests - these will fail at compile time if types are wrong
  it(`type tests`, () => {
    const numberDeferred: Deferred<number> = createDeferred<number>()
    numberDeferred.resolve(42) // Should compile
    // @ts-expect-error - wrong type
    numberDeferred.resolve(`42`) // Should not compile

    const stringDeferred: Deferred<string> = createDeferred<string>()
    stringDeferred.resolve(`hello`) // Should compile
    // @ts-expect-error - wrong type
    stringDeferred.resolve(42) // Should not compile

    const promiseDeferred: Deferred<Promise<number>> =
      createDeferred<Promise<number>>()
    promiseDeferred.resolve(Promise.resolve(42)) // Should compile
    // @ts-expect-error - wrong type
    promiseDeferred.resolve(42) // Should not compile
  })
})

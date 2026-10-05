import { describe, expect, it } from 'vitest'
import { NonRetriableError } from '../src/errors'

describe(`Errors`, () => {
  it(`should create a NonRetriableError with the correct name and message`, () => {
    const errorMessage = `This is a non-retriable error`
    const error = new NonRetriableError(errorMessage)

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe(`NonRetriableError`)
    expect(error.message).toBe(errorMessage)
  })

  it(`should be catchable as an Error`, () => {
    const errorMessage = `This is a non-retriable error`

    try {
      throw new NonRetriableError(errorMessage)
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect(error).toBeInstanceOf(NonRetriableError)
      expect((error as Error).message).toBe(errorMessage)
    }
  })
})

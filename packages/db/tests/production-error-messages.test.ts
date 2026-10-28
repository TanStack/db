/**
 * Ordinary coverage pin for production error messages: every exported error
 * class has sample inputs. The production-message law is owned by
 * production-error-messages-oracle.test.ts.
 */
import { describe, expect, it } from 'vitest'
import { errorSampleArguments } from './error-sample-arguments'
import { exportedErrorClasses } from './production-error-messages-fixture'

describe(`production error messages`, () => {
  it(`has sample inputs for every exported error class`, () => {
    const missing = exportedErrorClasses
      .map(([name]) => name)
      .filter((name) => !(name in errorSampleArguments))
    expect(missing).toEqual([])
  })
})

import { describe, expect, it } from 'vitest'
import { expectAdmissionHistory } from './contracts/driver-admission-laws'

describe(`driver admission history checker`, () => {
  it.each([
    [
      [1, 2, 3],
      [1, 2, 3],
    ],
    [[3], [3]],
  ])(`accepts a complete admitted history %j`, (actual, expected) => {
    expectAdmissionHistory(
      actual.map((value) => ({ value })),
      expected,
    )
  })

  it.each([
    [
      [1, 3, 2],
      [1, 2, 3],
    ],
    [[], [3]],
    [[1, 3], [3]],
    [[3, 3], [3]],
  ])(
    `rejects an interleaved, missing, or extra write %j`,
    (actual, expected) => {
      expect(() =>
        expectAdmissionHistory(
          actual.map((value) => ({ value })),
          expected,
        ),
      ).toThrow()
    },
  )
})

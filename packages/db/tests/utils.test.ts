import { describe, expect, it } from "vitest"
import { getLockedObjects } from "../src/utils"

describe(`Utils`, () => {
  it(`should return an empty Set from getLockedObjects`, () => {
    const lockedObjects = getLockedObjects()

    expect(lockedObjects).toBeInstanceOf(Set)
    expect(lockedObjects.size).toBe(0)
  })
})

/** Whole-test expected failure cannot distinguish a known bug from a new one. */
export function scenarioRegistry(knownGaps: ReadonlyArray<string> = []) {
  if (knownGaps.length) {
    throw new Error(
      `Conformance gaps require an approved exact failure signature, not a whole-test waiver`,
    )
  }
  const keys = new Set<string>()
  return {
    register(key: string) {
      if (keys.has(key))
        throw new Error(`Duplicate conformance scenario: ${key}`)
      keys.add(key)
    },
    get size() {
      return keys.size
    },
  }
}

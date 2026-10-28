// Guards that the optimistic relationship oracle's driver applies before it
// starts or confirms an optimistic change. The oracle that uses them is
// includes-optimistic-oracle.property.test.ts; its ordinary harness tests are in
// includes-optimistic.test.ts.

export function assertCanStartOptimisticChange(
  pending: ReadonlyMap<string, { level: number }>,
  level: number,
  handle?: string,
): void {
  if (handle !== undefined && pending.has(handle)) {
    throw new Error(`Duplicate optimistic handle ${handle}`)
  }
  const sameLevel = [...pending.entries()].find(
    ([, change]) => change.level === level,
  )
  if (sameLevel) {
    throw new Error(
      `Level ${level} already has pending optimistic handle ${sameLevel[0]}`,
    )
  }
}

export function assertMatchingConfirmation(
  pending: { id: number },
  authoritative: { id: number },
): void {
  if (authoritative.id !== pending.id) {
    throw new Error(
      `Confirmation row ${authoritative.id} does not match pending row ${pending.id}`,
    )
  }
}

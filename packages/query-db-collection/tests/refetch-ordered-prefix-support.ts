// Helpers shared by the refetch-ordered-prefix oracle and its ordinary unit
// tests in refetch-ordered-prefix.test.ts. Neither owns a law here.

export async function settle(): Promise<void> {
  for (let turn = 0; turn < 20; turn++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

export function sameOrderedIds(
  actual: ReadonlyArray<number>,
  expected: ReadonlyArray<number>,
): boolean {
  return (
    actual.length === expected.length &&
    expected.every((id, index) => actual[index] === id)
  )
}

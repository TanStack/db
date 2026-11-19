/** A syntactically valid shrink path can finish without invoking a property. */
export function requireExecutedHistory(
  property: string,
  result: { numRuns: number },
) {
  if (result.numRuns === 0)
    throw new Error(`oracle replay executed no history: ${property}`)
}

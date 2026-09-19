/**
 * Delta-debug one legal history while preserving the exact reported violation.
 * The evaluator owns legality, production execution and checkpoint capture.
 */
export async function shrinkHistory(history, evaluate) {
  const original = structuredClone(history)
  const initial = await evaluate(structuredClone(original))
  if (!initial?.violated || !initial.signature)
    throw new Error('Original history does not reproduce a named violation')

  let reduced = structuredClone(original)
  let width = Math.max(1, Math.floor(reduced.length / 2))
  while (width >= 1 && reduced.length) {
    let changed = false
    for (let start = 0; start < reduced.length; start += width) {
      const candidate = [
        ...reduced.slice(0, start),
        ...reduced.slice(start + width),
      ]
      const result = await evaluate(structuredClone(candidate))
      if (
        result?.violated &&
        result.signature === initial.signature &&
        result.reached === true
      ) {
        reduced = candidate
        changed = true
        break
      }
    }
    if (!changed) width = Math.floor(width / 2)
  }

  const replay = await evaluate(structuredClone(reduced))
  if (
    !replay?.violated ||
    replay.signature !== initial.signature ||
    replay.reached !== true
  )
    throw new Error('Reduced history did not replay the original violation')
  return { original, reduced, violation: initial, replay }
}

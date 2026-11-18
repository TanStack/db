/** Exact equality for these oracles' plain records, arrays and scalar inputs. */
export function sameElectricOracleValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (
    a === null ||
    b === null ||
    typeof a !== `object` ||
    typeof b !== `object` ||
    Array.isArray(a) !== Array.isArray(b)
  )
    return false
  const left = Reflect.ownKeys(a),
    right = Reflect.ownKeys(b)
  return (
    Object.getPrototypeOf(a) === Object.getPrototypeOf(b) &&
    left.length === right.length &&
    left.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(b, key) &&
        sameElectricOracleValue(Reflect.get(a, key), Reflect.get(b, key)),
    )
  )
}

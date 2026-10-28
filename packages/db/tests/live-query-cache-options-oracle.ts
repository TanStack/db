/**
 * A reusable DbClient result cannot substitute different local row behavior.
 * Maintainer decision: independent callers under one query identity must use
 * the same getKey/schema references, or distinct queryKeys. This differs from
 * mounted framework bindings, which retain their first options until identity
 * changes. Portable hydration supplies no local option claim; the first local
 * consumer establishes one. No function identity crosses the transport.
 *
 * This model compares caller declarations, never hashes or Collection internals.
 * Its drivers cross pending/settled reuse and preload/observer/React admission.
 * It judges rejection at admission, before a conflicting result is returned.
 */
import { expect } from 'vitest'

export const cacheOptionHistories = [`getKey`, `schema`, `both`].flatMap(
  (option) =>
    [false, true].flatMap((different) =>
      [false, true].flatMap((distinctKey) =>
        [false, true].map((keyed) => ({
          option,
          different,
          distinctKey,
          keyed,
        })),
      ),
    ),
)

export function conflictingCacheOptions(
  different: boolean,
  distinctKey: boolean,
): boolean {
  return different && !distinctKey
}

export function checkCacheOptionAdmission(
  action: () => unknown,
  different: boolean,
  distinctKey: boolean,
): void {
  if (conflictingCacheOptions(different, distinctKey))
    expect(action, `conflicting cached row options`).toThrow(/getKey|schema/)
  else expect(action, `compatible cached row options`).not.toThrow()
}

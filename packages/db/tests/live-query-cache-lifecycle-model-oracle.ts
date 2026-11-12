// The claim-lifecycle model and checks of the live-query cache-lifecycle
// oracle. live-query-cache-lifecycle-oracle.test.ts drives production against
// them, and live-query-cache-lifecycle-calibration.test.ts calibrates the
// checks with deliberately wrong answers. This module registers no tests and
// has no side effects.
import { expect } from 'vitest'
import { oracleAssertion } from './oracle-assertion-adapter'
import { conflictingCacheOptions } from './live-query-cache-options-oracle'
import type { CacheOptionHistory } from './live-query-cache-options-oracle'

export type Phase = `active` | `replaced` | `failed` | `consumed`
// A portable result has no local claim. Admission claims it, transport updates
// do not end reuse, and terminal failure or live consumption ends reuse.
export function claimSurvives(phase: Phase): boolean {
  return phase === `active` || phase === `replaced`
}
export function checkLifecycleAdmission(
  action: () => unknown,
  history: CacheOptionHistory,
  phase: Phase,
) {
  if (claimSurvives(phase) && conflictingCacheOptions(history))
    oracleAssertion(`checkLifecycleAdmission:61`, () =>
      expect(action, `active local claim survives ${phase}`).toThrow(
        /getKey|schema/,
      ),
    )
  else
    oracleAssertion(`checkLifecycleAdmission:64`, () =>
      expect(action, `retired or compatible claim at ${phase}`).not.toThrow(),
    )
}
// Raw transport is checked before JSON can silently erase a leaked function.
export function checkPortableCacheState(
  value: unknown,
  seen = new Set<unknown>(),
): void {
  oracleAssertion(`checkPortableCacheState:71`, () =>
    expect(
      typeof value,
      `portable hydration has no function reference`,
    ).not.toBe(`function`),
  )
  if (!value || typeof value !== `object` || seen.has(value)) return
  seen.add(value)
  for (const child of Object.values(value)) checkPortableCacheState(child, seen)
}
export const phases: ReadonlyArray<Phase> = [
  `active`,
  `replaced`,
  `failed`,
  `consumed`,
]

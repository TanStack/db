// The typed key domain and the window selection model of the top-K support
// window oracle. The law, grammars, production drivers, and checks are in
// topk-support-window-oracle.test.ts; topk-support-window-calibration.test.ts
// feeds the model's answers to the signed-output checker. This module
// registers no tests and has no side effects.

export const keys = [1, `1`, 2, `2`, `a`] as const
export const orderedKeys = [`1`, `2`, `a`, 1, 2] as const
export type Key = (typeof keys)[number]
export type Window = { offset: number; limit: number }

// Selection is a predicate on each installed row's rank. It never enumerates
// absent ranks or adds offset and width, so large bounds cannot corrupt the
// reference through floating-point addition. Authored offset and width remain
// independent: a later partial move must retain the other exact bound.
export function selectedWindowKeys(
  present: ReadonlyArray<Key>,
  window: Window,
) {
  return present.filter(
    (_, rank) => rank >= window.offset && rank - window.offset < window.limit,
  )
}

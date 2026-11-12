import { expect, it } from 'vitest'
import { oracleReplayRequested } from './oracle-config.js'
import {
  checkGcObservation,
  createGcModel,
  stepGcModel,
} from './collection-gc-retention-oracle.js'
import type { GcAction } from './collection-gc-retention-oracle.js'

// What this file owns: nothing in production. It is a checker calibration for
// the shared GC retention check in collection-gc-retention-oracle.ts, which
// defines the check and the model. These ordinary tests moved here from
// collection-gc-retention-oracle.test.ts: they step the model and feed the
// check hand-built observations, so they run no production. Each case feeds
// that check a plausible wrong observation, and the check must reject it. The companion's production
// owners are the GC lifecycle and cleanup queue, judged by the property files.
//
// Cleanup clears public rows even while a manual transaction remains pending
// or its handler persists. The retention fixture has no durable source rows.
// Feed the shared comparison a plausible broken cleanup result: status and
// transaction phases agree, but a discarded optimistic row remains visible.
// The generated production histories exercise this same comparison at every cut.
it.skipIf(oracleReplayRequested()).each([
  {
    name: `automatic cleanup with a pending draft`,
    actions: [
      { kind: `insert`, commit: false },
      { kind: `advance`, elapsedMs: 100 },
      { kind: `idle`, hasTime: true, didTimeout: false },
    ],
  },
  {
    name: `explicit cleanup with a pending draft`,
    actions: [{ kind: `insert`, commit: false }, { kind: `cleanup` }],
  },
  {
    name: `explicit cleanup with a persisting handler`,
    actions: [{ kind: `insert`, commit: true }, { kind: `cleanup` }],
  },
] satisfies Array<{ name: string; actions: Array<GcAction> }>)(
  `rejects leftover optimistic rows after $name`,
  ({ actions }) => {
    const model = createGcModel(100)
    for (const action of actions) stepGcModel(model, action)
    expect(model.retired).toBe(true)
    const observation = {
      retired: true,
      visibleKeys: [],
      transactionStates: [...model.transactions],
    }
    expect(() =>
      checkGcObservation(model, observation, `cleaned rows`),
    ).not.toThrow()
    expect(() =>
      checkGcObservation(
        model,
        { ...observation, visibleKeys: [1] },
        `cleanup row calibration`,
      ),
    ).toThrow(`cleanup left visible rows: 1`)
  },
)

// With no source confirmation, settling the handler removes its optimistic
// insert. Positive membership alone accepts an obsolete completed/failed row.
it.skipIf(oracleReplayRequested()).each([`complete`, `fail`] as const)(
  `rejects a stale row after handler outcome %s`,
  (outcome) => {
    const model = createGcModel(100)
    stepGcModel(model, { kind: `insert`, commit: true })
    stepGcModel(model, { kind: `settle`, slot: 0, outcome })
    const observation = {
      retired: false,
      visibleKeys: [],
      transactionStates: [...model.transactions],
    }
    expect(() =>
      checkGcObservation(model, observation, `settled rows`),
    ).not.toThrow()
    expect(() =>
      checkGcObservation(
        model,
        { ...observation, visibleKeys: [1] },
        `settled row calibration`,
      ),
    ).toThrow(`visible keys expected [], got [1]`)
    // A real provider can independently establish the same key as a source
    // row. That premise permits it after settlement, until cleanup clears it.
    expect(() =>
      checkGcObservation(
        model,
        { ...observation, visibleKeys: [1] },
        `known source row`,
        [1],
      ),
    ).not.toThrow()
  },
)

it.skipIf(oracleReplayRequested())(
  `rejects missing, duplicate, and extra keys while transactions persist`,
  () => {
    const model = createGcModel(100)
    stepGcModel(model, { kind: `insert`, commit: true })
    stepGcModel(model, { kind: `insert`, commit: true })
    const observation = {
      retired: false,
      visibleKeys: [2, 1],
      transactionStates: [...model.transactions],
    }
    expect(() =>
      checkGcObservation(model, observation, `active rows`),
    ).not.toThrow()
    for (const visibleKeys of [[1], [1, 1], [1, 2, 3]])
      expect(() =>
        checkGcObservation(
          model,
          { ...observation, visibleKeys },
          `key calibration`,
        ),
      ).toThrow(`visible keys expected [1,2]`)
  },
)

// Moved from collection-gc-mutation-oracle.property.test.ts: a calibration of
// the shared check's supplied-projection argument, with no production path.
// An independently supplied projection is still an exact membership obligation.
// It cannot waive missing, stale or extra keys, even when default insert-slot
// keys would differ from the update/delete driver's expected public rows.
it.skipIf(oracleReplayRequested())(
  `rejects corruption of a supplied mutation projection`,
  () => {
    const model = createGcModel(100)
    stepGcModel(model, { kind: `mutate`, commit: true })
    const observation = {
      retired: false,
      visibleKeys: [7],
      transactionStates: [`persisting`],
    }
    expect(() =>
      checkGcObservation(model, observation, `valid projection`, [], [7]),
    ).not.toThrow()
    for (const visibleKeys of [[], [1], [7, 8], [7, 7]])
      expect(() =>
        checkGcObservation(
          model,
          { ...observation, visibleKeys },
          `corrupt projection`,
          [],
          [7],
        ),
      ).toThrow(`visible keys expected [7]`)
    stepGcModel(model, { kind: `cleanup` })
    expect(() =>
      checkGcObservation(
        model,
        { ...observation, retired: true },
        `cleanup projection`,
        [],
        [7],
      ),
    ).toThrow(`cleanup left visible rows`)
  },
)

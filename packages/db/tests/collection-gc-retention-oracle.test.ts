import { expect, it } from 'vitest'
import { oracleReplayRequested } from './oracle-config.js'
import {
  checkGcObservation,
  createGcModel,
  stepGcModel,
} from './collection-gc-retention-oracle.js'
import type { GcAction } from './collection-gc-retention-oracle.js'

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

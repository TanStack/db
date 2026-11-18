/** Recorder calibration: projection preserves the shared raw judgment. */
import { describe, expect, it } from 'vitest'
import {
  observeEagerReload,
  projectEagerReloadObservation,
} from './eager-reload-driver'
import {
  eagerReloadHistories,
  eagerReloadModel,
  eagerReloadViolations,
} from './eager-reload-oracle'
import type {
  EagerReloadHistory,
  EagerReloadObservation,
} from './eager-reload-oracle'
import type { EagerReloadAdapter } from './eager-reload-driver'
import type { StartupRow } from './persisted-startup-oracle'

function observation(
  history: EagerReloadHistory,
  released: boolean,
): EagerReloadObservation {
  const expected = eagerReloadModel(history)
  return {
    before: expected.initial,
    beforeStatus: history.start === `fresh` ? `loading` : `ready`,
    settledBeforeSource: false,
    submittedRows: expected.source.length,
    submittedCommits: 1,
    acceptedCommits: 1,
    atFulfillment: expected.source,
    mutationReleasedBeforeFulfillment: released,
    mutationSettledBeforeFulfillment: !history.mutation,
    final: expected.source,
  }
}

describe(`eager reload observation projection`, () => {
  it(`compares a complete empty provider result when the source omits readiness and commits`, async () => {
    let completed = false
    let cleaned = false
    let disposed = false
    const adapter: EagerReloadAdapter = {
      open: (_initial, id) => Promise.resolve({
        options: {
          id,
          getKey: (row) => row.id,
          sync: {
            sync: () => () => {
              cleaned = true
            },
          },
        },
        replace: () => Promise.resolve(),
        propagate: () => {
          // This is a provider fact. Neither tested Collection readiness nor
          // a commit exists in this deliberately incomplete adapter.
          completed = true
          return Promise.resolve()
        },
        dispose: () => {
          disposed = true
          return Promise.resolve()
        },
      }),
    }
    const history: EagerReloadHistory = {
      start: `fresh`,
      previous: 0,
      next: 0,
      mutation: false,
    }
    const raw = await observeEagerReload(adapter, history, `empty-missing-ready`)
    expect(completed).toBe(true)
    expect(raw.settledAfterSource).toBe(false)
    expect(eagerReloadViolations(history, raw)).toContain(
      `load pending after complete source application`,
    )
    expect(eagerReloadViolations(history, raw)).toContain(
      `complete source submission not reached`,
    )
    expect(cleaned).toBe(true)
    expect(disposed).toBe(true)
  })
  it(`waits for actual provider completion instead of imposing a readiness task limit`, async () => {
    let completed = false
    let cleaned = false
    const history: EagerReloadHistory = {
      start: `fresh`,
      previous: 0,
      next: 1,
      mutation: false,
    }
    const adapter: EagerReloadAdapter = {
      open: (_initial, id) => {
        let completion = Promise.resolve()
        return Promise.resolve({
          options: {
            id,
            getKey: (row) => row.id,
            sync: {
              sync: ({ begin, write, commit, markReady }) => {
                begin({ snapshot: true })
                for (const value of eagerReloadModel(history).source)
                  write({ type: `insert`, value })
                commit()
                completion = (async () => {
                  for (let turn = 0; turn < 12; turn++)
                    await new Promise<void>((resolve) => setTimeout(resolve, 0))
                  completed = true
                  markReady()
                })()
                return () => {
                  cleaned = true
                }
              },
            },
          },
          replace: () => Promise.resolve(),
          propagate: () => completion,
          dispose: () => completion,
        })
      },
    }
    const raw = await observeEagerReload(adapter, history, `delayed-ready`)
    expect(completed).toBe(true)
    expect(raw.settledAfterSource).toBe(true)
    expect(eagerReloadViolations(history, raw)).toEqual([])
    expect(cleaned).toBe(true)
  })
  it(`records missing readiness after real application and still releases the source`, async () => {
    let cleaned = false
    const adapter: EagerReloadAdapter = {
      open: (_initial, id) => {
        let rows: Array<StartupRow> = []
        return Promise.resolve({
          options: {
            id,
            getKey: (row) => row.id,
            sync: {
              sync: ({ begin, write, commit }) => {
                begin({ snapshot: true })
                for (const value of rows) write({ type: `insert`, value })
                commit()
                return () => {
                  cleaned = true
                }
              },
            },
          },
          replace: (next) => {
            rows = next
            return Promise.resolve()
          },
          // This controlled source synchronously submits its complete result.
          propagate: () => Promise.resolve(),
          dispose: () => Promise.resolve(),
        })
      },
    }
    const history: EagerReloadHistory = {
      start: `fresh`,
      previous: 0,
      next: 1,
      mutation: false,
    }
    const raw = await observeEagerReload(adapter, history, `missing-ready`)
    expect(raw.settledAfterSource).toBe(false)
    expect(raw.final).toEqual(eagerReloadModel(history).source)
    expect(eagerReloadViolations(history, raw)).toContain(
      `load pending after complete source application`,
    )
    expect(cleaned).toBe(true)
  })
  it(`accepts empty ready delivery without fabricating a commit and still requires source evidence`, () => {
    const history: EagerReloadHistory = {
      start: `reload`,
      previous: 0,
      next: 0,
      mutation: false,
    }
    const raw = {
      ...observation(history, false),
      submittedCommits: 0,
      acceptedCommits: 0,
      sourceReadyCalls: 1,
    }
    expect(eagerReloadViolations(history, raw)).toEqual([])
    expect(
      eagerReloadViolations(history, { ...raw, sourceReadyCalls: 0 }),
    ).toContain(`complete source submission not reached`)
    expect(eagerReloadViolations({ ...history, next: 2 }, raw)).toContain(
      `complete source submission not reached`,
    )
  })
  it(`preserves the product mismatch and each later cleanup failure`, async () => {
    let sourceCleanups = 0
    let disposals = 0
    const adapter: EagerReloadAdapter = {
      open: (_initial, id) => {
        let rows: Array<StartupRow> = []
        return Promise.resolve({
          options: {
            id,
            getKey: (row) => row.id,
            sync: {
              sync: ({ begin, write, commit, markReady }) => {
                begin({ snapshot: true })
                for (const value of [...rows, { id: `wrong`, value: -1 }])
                  write({ type: `insert`, value })
                commit()
                markReady()
                return () => {
                  sourceCleanups++
                  throw new Error(`source cleanup diagnostic`)
                }
              },
            },
          },
          replace: (next) => {
            rows = next
            return Promise.resolve()
          },
          // This controlled source synchronously submits its complete result.
          propagate: () => Promise.resolve(),
          dispose: () => {
            disposals++
            return Promise.reject(new Error(`SDK cleanup diagnostic`))
          },
        })
      },
    }
    const history: EagerReloadHistory = {
      start: `fresh`,
      previous: 0,
      next: 2,
      mutation: false,
    }
    const raw = await observeEagerReload(adapter, history, `cleanup-fidelity`)
    const failures = eagerReloadViolations(history, raw)
    expect(failures).toContain(`fulfillment source rows`)
    expect(failures).toContain(`final rows`)
    expect(raw.cleanupErrors).toEqual([
      expect.stringContaining(`source cleanup diagnostic`),
      `Error: SDK cleanup diagnostic`,
    ])
    expect(failures).toEqual([`fulfillment source rows`, `final rows`])
    expect(sourceCleanups).toBe(1)
    expect(disposals).toBe(1)
  })
  // This includes the exact no-row/no-mutation history from the CLI capture.
  // A bad before-source row remains a bad row under either meaningless flag.
  for (const history of eagerReloadHistories.filter((h) => !h.mutation)) {
    it(`preserves judgments for absent mutation in ${JSON.stringify(history)}`, () => {
      for (const wrongRows of [false, true]) {
        const projected = [false, true].map((released) => {
          const raw = observation(history, released)
          if (wrongRows)
            raw.before = [...raw.before, { id: `unexpected`, value: -1 }]
          const original = structuredClone(raw)
          const actual = projectEagerReloadObservation(history, raw)
          expect(eagerReloadViolations(history, actual)).toEqual(
            eagerReloadViolations(history, raw),
          )
          expect(eagerReloadViolations(history, actual)).toEqual(
            wrongRows ? [`before-source rows`] : [],
          )
          expect(raw).toEqual(original)
          expect(actual.mutationReleasedBeforeFulfillment).toBe(false)
          expect({
            ...actual,
            mutationReleasedBeforeFulfillment:
              raw.mutationReleasedBeforeFulfillment,
          }).toEqual(raw)
          return actual
        })
        expect(projected[0]).toEqual(projected[1])
      }
    })
  }
  for (const history of eagerReloadHistories.filter((h) => h.mutation)) {
    it(`retains the mutation timing distinction in ${JSON.stringify(history)}`, () => {
      for (const released of [false, true]) {
        const raw = observation(history, released)
        raw.mutationSettledBeforeFulfillment = false
        const actual = projectEagerReloadObservation(history, raw)
        expect(actual).toBe(raw)
        expect(actual.mutationReleasedBeforeFulfillment).toBe(released)
        expect(eagerReloadViolations(history, actual)).toEqual(
          released ? [] : [`pending optimistic overlay disappeared`],
        )
      }
    })
  }
})

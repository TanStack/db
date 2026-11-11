/** Recorder calibration: projection preserves the shared raw judgment. */
import { describe, expect, it } from 'vitest'
import { projectEagerReloadObservation } from './eager-reload-driver'
import {
  eagerReloadHistories,
  eagerReloadModel,
  eagerReloadViolations,
} from './eager-reload-oracle'
import type {
  EagerReloadHistory,
  EagerReloadObservation,
} from './eager-reload-oracle'

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

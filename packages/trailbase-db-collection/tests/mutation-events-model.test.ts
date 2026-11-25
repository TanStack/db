import { expect, it } from 'vitest'
import {
  mutationEventModel,
  mutationEventRows,
  mutationEventViolations,
} from './mutation-events-sdk-oracle'
import type { MutationEventHistory } from './mutation-events-sdk-oracle'

// Positive checker controls preserve implementation freedom: a source known
// to have stopped may reject before HTTP or after consuming its response.
it.each([false, true])(
  'permits truthful terminal rejection with response consumption %s',
  (responseConsumed) => {
    const history: MutationEventHistory = {
      operation: `update`,
      mode: `eager`,
      first: `response`,
      previousEvent: true,
      clockMode: `fixed`,
      peer: true,
      coordinate: 7,
      streamEnd: `before-request`,
    }
    const rows = mutationEventRows(history, `initial`)
    const cuts = [
      `entered`,
      `first-obligation`,
      `response-without-confirmation`,
      `confirmation-deadline`,
    ] as const
    expect(
      mutationEventViolations(
        mutationEventModel(history),
        cuts.map((name) => ({
          name,
          rows,
          state: `failed`,
          settlement: `rejected`,
          handlerSettlement: `rejected`,
          responseConsumed: name === `entered` ? false : responseConsumed,
          sourceAccepted: false,
        })),
      ),
    ).toEqual([])
  },
)

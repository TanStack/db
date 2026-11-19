/**
 * Receiving campaigns retain the shared Map/phase model and each original
 * public checkpoint. Five randomized builders enforce minimum-five reach.
 * Their local obligation ledger also checks fresh generated constructions:
 * the pinned framework only associates its seed-derived objects with enters.
 */
import { eagerLiveSourceHistoryArb, reachStatesFor } from '../src'
import {
  eagerLiveSourceVerdict,
  observeEagerLiveSourceHistory,
} from './eager-live-source-framework-oracle'
import type {
  EagerLiveSourceDriver,
  EagerLiveSourceHistory,
  EagerLiveSourceReachState,
} from '../src'
import type { Observation } from '../../db/tests/oracle-property'

export function eagerLiveSourceCampaign(
  driver: EagerLiveSourceDriver,
  construct: (
    generated: EagerLiveSourceHistory,
    salt: number,
  ) => EagerLiveSourceHistory,
  additionalStates: ReadonlyArray<EagerLiveSourceReachState> = [],
) {
  const states = [...reachStatesFor(driver), ...additionalStates]
  const required = new WeakMap<
    EagerLiveSourceHistory,
    { salt: number; states: ReadonlyArray<string> }
  >()
  const constructed = Array.from({ length: 5 }, (_, salt) => ({
    name: `all eager states, randomized construction ${salt + 1}`,
    enters: states,
    build: (generated: EagerLiveSourceHistory) => {
      const history = construct(generated, salt)
      required.set(history, { salt, states })
      return history
    },
  }))
  const drive =
    (corruption?: `values` | `delivery-errors`) =>
    async (
      history: EagerLiveSourceHistory,
      observe: (checkpoint: string, value: unknown) => void,
    ) => {
      const result = await observeEagerLiveSourceHistory(
        driver,
        history,
        corruption,
        additionalStates,
      )
      for (const state of result.reached) observe(`reach`, state)
      observe(`completed`, result)
    }
  return {
    arbitrary: eagerLiveSourceHistoryArb(driver),
    states,
    constructed,
    model: (history: EagerLiveSourceHistory) => ({
      required: required.get(history)?.states ?? [],
    }),
    driver: drive(),
    deliveryErrorIdentityDriver: drive(`delivery-errors`),
    check: (
      _history: EagerLiveSourceHistory,
      trace: ReadonlyArray<Observation>,
      expected: { required: ReadonlyArray<string> },
    ) => eagerLiveSourceVerdict(trace, expected.required),
    calibrations: [
      {
        name: `shared value judgment rejects wrong public values`,
        law: `FID-1 (values)`,
        driver: drive(`values`),
      },
      ...constructed.flatMap((_builder, salt) =>
        states.map((state) => ({
          name: `construction ${salt + 1} omits ${state}`,
          law: `constructed builder reach`,
          corrupt: (
            trace: ReadonlyArray<Observation>,
            history: EagerLiveSourceHistory,
          ) =>
            required.get(history)?.salt === salt
              ? trace.filter(
                  (entry) =>
                    !(entry.checkpoint === `reach` && entry.value === state),
                )
              : undefined,
        })),
      ),
    ],
  }
}

/** TrailBase retains every shared law and checkpoint with framework campaigns. */
import { oracleProperty } from '../../db/tests/oracle-property'
import {
  eagerLiveSourceHistoryArb,
  reachStatesFor,
} from '../../db-adapter-conformance/src'
import {
  constructTrailBaseEagerHistory,
  trailBaseEagerVerdict,
} from './eager-live-source-framework-oracle'
import type {
  EagerLiveSourceDriver,
  EagerLiveSourceHistory,
} from '../../db-adapter-conformance/src'
import type { EagerHistoryResult } from './eager-live-source-framework-oracle'
import type { Observation } from '../../db/tests/oracle-property'

type Receive = (
  history: EagerLiveSourceHistory,
  corruptValues?: boolean,
) => Promise<EagerHistoryResult>
export function registerTrailBaseEager(
  campaign: { property: string; defaultRuns: number },
  driver: EagerLiveSourceDriver,
  receive: Receive,
) {
  const states = reachStatesFor(driver)
  const required = new WeakMap<
    EagerLiveSourceHistory,
    { salt: number; states: ReadonlyArray<string> }
  >()
  const constructed = Array.from({ length: 5 }, (_, salt) => ({
    name: `all eager states, randomized construction ${salt + 1}`,
    enters: states,
    build: (generated: EagerLiveSourceHistory) => {
      const history = constructTrailBaseEagerHistory(generated, salt)
      required.set(history, { salt, states })
      return history
    },
  }))
  const drive =
    (corruptValues = false) =>
    async (
      history: EagerLiveSourceHistory,
      observe: (checkpoint: string, value: unknown) => void,
    ) => {
      const result = await receive(history, corruptValues)
      for (const state of result.reached) observe(`reach`, state)
      observe(`completed`, result)
    }
  oracleProperty({
    id: campaign.property,
    law: {
      statement: `The eager source's initial gate, complete rows and field values, per-change publications, failure identity, post-ready health, restart and exactly-once resource release follow the shared eager live-source laws.`,
      authority: `db-adapter-conformance/src/eager-live-source-oracle.ts, adapter law set READY-2/3/4, HEALTH-1/5, PUB-1/2/3, FID-1/4, LIFE-2/5/10; TrailBase tests/ORACLE.md.`,
      limits: `Controlled RecordApi, already decoded events, native ReadableStream; seven JSON value kinds, twelve grammar steps, eager mode and per-change commits. No deployed service, SDK fetch/SSE, mutation acknowledgement, on-demand loading or reload claim.`,
    },
    histories: {
      arbitrary: eagerLiveSourceHistoryArb(driver),
      states,
      runs: campaign.defaultRuns,
      fixedSeeds: [2118],
      constructed,
    },
    // The integrated shared checker runs its independent Map/phase model at
    // every original checkpoint. This outer model adds only builder premises;
    // no expected product result is inferred from production observations.
    model: (history) => ({ required: required.get(history)?.states ?? [] }),
    driver: drive(),
    check: (_history, trace, expected) =>
      trailBaseEagerVerdict(trace, expected.required),
    calibrations: [
      {
        name: `shared value judgment rejects wrong public values`,
        law: `FID-1 (values)`,
        driver: drive(true),
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
    timeout: 120_000,
  })
}

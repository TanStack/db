/**
 * Preact receives the shared mutation-schema law through its real live hook.
 * Its commit-time render probe and native act supply the host observation cut;
 * the recorder also captures rows before the update call returns. The complete
 * finite grammar retains every schema/key/identity case and twelve reach cuts.
 * This is a controlled Collection witness, without provider/SSR claims.
 */
import { act } from 'preact/test-utils'
import { useLiveQuery } from '../src/useLiveQuery'
import { declareOracle, oracleProperty } from '../../db/tests/oracle-config'
import {
  boundSchemaGrammar,
  boundSchemaHistories,
} from '../../db/tests/live-query-bound-options-oracle'
import {
  checkBoundSchemaReceiver,
  modelBoundSchemaReceiver,
} from '../../db/tests/bound-schema-receiver-oracle'
import { recordBoundSchemaHistory } from '../../db/tests/live-query-bound-options-support'
import { renderHook, settle } from './render-probe'
import type { BoundSchemaNativeHost } from '../../db/tests/live-query-bound-options-support'
import type { BoundSchemaReceiverHistory } from '../../db/tests/bound-schema-receiver-oracle'

// Source values were fixed inside the old driver. Naming them as history inputs
// keeps expected rows model-owned without changing any receiving schedule.
const histories: ReadonlyArray<BoundSchemaReceiverHistory> =
  boundSchemaHistories.map((history) => ({
    ...history,
    sourceRows: [
      { id: `one`, label: `  source alpha  `, rank: 1 },
      { id: `peer`, label: `  source beta  `, rank: 2 },
    ],
    retainedSourceLabel: `  later source retained  `,
    reboundSourceLabel: `  later source rebound  `,
  }))

const host: BoundSchemaNativeHost = {
  mount: (input) => {
    const mounted = renderHook(
      (props: { revision: number; proposed: boolean }) =>
        useLiveQuery(input(props)),
      { initialProps: { revision: 0, proposed: false } },
    )
    return {
      current: () => mounted.result.current,
      rerender: mounted.rerender,
      flush: async (action) => {
        act(() => {
          action?.()
        })
        await settle()
      },
      unmount: mounted.unmount,
    }
  },
}

oracleProperty({
  id: `preact.bound-schema-options`,
  law: {
    statement: `Preact bindings retain mutation schemas until query identity changes; held updates expose transformed rows and handler payloads, settlement restores authored source rows, and sync publications remain raw.`,
    authority: `packages/db/tests/live-query-bound-options-oracle.ts; schema guide TInput/TOutput contract, optimistic-history contract and maintainer inline-option decision.`,
    limits: `72 finite synchronous-schema/key/identity cases with settled updates before replacement; controlled sources, no typed-schema, SSR, provider or concurrent-render claim.`,
  },
  owns: [`src/useLiveQuery.ts#useLiveQuery`],
  histories,
  label: boundSchemaGrammar,
  model: modelBoundSchemaReceiver,
  driver: (history, observe) =>
    recordBoundSchemaHistory(history, host, observe),
  check: checkBoundSchemaReceiver,
  calibrations: [
    // A later driver error cannot replace a law violation already recorded.
    {
      name: `wrong retained binding before driver failure`,
      law: `bound schema binding`,
      driver: (history, observe) =>
        recordBoundSchemaHistory(history, host, (checkpoint, value) => {
          if (checkpoint === `retained binding`) {
            observe(checkpoint, { ...(value as object), collection: false })
            throw new Error(`later retained update failure`)
          }
          observe(checkpoint, value)
        }),
    },
    {
      name: `missing handler hold before driver failure`,
      law: `bound schema hold`,
      driver: (history, observe) =>
        recordBoundSchemaHistory(history, host, (checkpoint, value) => {
          if (checkpoint === `handler hold`) {
            observe(checkpoint, false)
            throw new Error(`later held update failure`)
          }
          observe(checkpoint, value)
        }),
    },
    {
      name: `missing replacement followup`,
      law: `bound schema history`,
      corrupt: (trace) =>
        trace.filter(
          ({ checkpoint }) => checkpoint !== `rebound-followup-held`,
        ),
    },
    {
      name: `early handler settlement`,
      law: `bound schema hold`,
      corrupt: (trace) =>
        trace.map((entry) =>
          entry.checkpoint === `initial-held`
            ? {
                ...entry,
                value: { ...(entry.value as object), settled: true },
              }
            : entry,
        ),
    },
    {
      name: `retained binding replaced`,
      law: `bound schema binding`,
      corrupt: (trace) =>
        trace.map((entry) =>
          entry.checkpoint === `retained binding`
            ? {
                ...entry,
                value: { ...(entry.value as object), collection: false },
              }
            : entry,
        ),
    },
    {
      name: `duplicate public cut`,
      law: `bound schema history`,
      corrupt: (trace) => [
        ...trace,
        trace.find(({ checkpoint }) => checkpoint === `initial-source-raw`)!,
      ],
    },
  ],
})

declareOracle({
  grammar: [histories],
  model: [modelBoundSchemaReceiver],
  check: [checkBoundSchemaReceiver],
})

/**
 * React ordinary and ready-source Suspense hooks receive the shared mutation
 * schema law. Native act establishes committed hook data; the shared recorder
 * also captures Collection entries before update returns. Each finite case
 * preserves all twelve raw-source/held/settled/followup cuts and reference
 * relations. Controlled Collections supply no provider, SSR or concurrent-render
 * claim; the existing72 strict checker-calibration histories remain below.
 */
import { act, renderHook } from '@testing-library/react'
import { expect, test } from 'vitest'
import { useLiveQuery } from '../src/useLiveQuery'
import { useLiveSuspenseQuery } from '../src/useLiveSuspenseQuery'
import {
  declareOracle,
  oracleProperty,
  oracleRoute,
} from '../../db/tests/oracle-config'
import {
  boundSchemaGrammar,
  boundSchemaHistories,
  boundSchemaModes,
  checkBoundSchemaMutation,
  checkBoundSchemaRows,
  checkBoundSchemaValues,
  modelBoundSchemaBinding,
  modelBoundSchemaLabel,
  modelBoundSchemaMutation,
  modelBoundSchemaRows,
} from '../../db/tests/live-query-bound-options-oracle'
import {
  checkBoundSchemaReceiver,
  modelBoundSchemaReceiver,
} from '../../db/tests/bound-schema-receiver-oracle'
import { recordBoundSchemaHistory } from '../../db/tests/live-query-bound-options-support'
import type { ExtractContext } from '@tanstack/db'
import type { BoundSchemaNativeHost } from '../../db/tests/live-query-bound-options-support'
import type { BoundSchemaObservation } from '../../db/tests/live-query-bound-options-oracle'
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

for (const hook of [`live`, `suspense`] as const) {
  const host: BoundSchemaNativeHost = {
    mount: (input) => {
      type QueryContext = ExtractContext<
        ReturnType<ReturnType<typeof input>[`query`]>
      >
      const mounted = renderHook(
        (props: { revision: number; proposed: boolean }) =>
          hook === `live`
            ? useLiveQuery<QueryContext>(input(props))
            : useLiveSuspenseQuery<QueryContext>(input(props)),
        { initialProps: { revision: 0, proposed: false } },
      )
      return {
        current: () => mounted.result.current,
        rerender: mounted.rerender,
        flush: async (action) => {
          await act(() => {
            action?.()
          })
        },
        unmount: mounted.unmount,
      }
    },
  }
  oracleProperty({
    id:
      hook === `live`
        ? `react.bound-schema-options.live`
        : `react.bound-schema-options.suspense`,
    law: {
      statement: `React bindings retain mutation schemas until query identity changes; held updates expose transformed rows and handler payloads, settlement restores authored source rows, and sync publications remain raw.`,
      authority: `packages/db/tests/live-query-bound-options-oracle.ts; schema guide TInput/TOutput contract, optimistic-history contract and maintainer inline-option decision.`,
      limits: `72 finite synchronous-schema/key/identity cases per ordinary or ready-source Suspense hook, with settled updates before replacement; controlled sources, no typed-schema, initial-suspension, SSR, provider or concurrent-render claim.`,
    },
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
}

// These controls send deliberately wrong public observations to the same
// judgment used by every native receiver. An earlier wrong immediate result
// cannot be hidden by correct later host data. Unordered rows may be reordered,
// but occurrences, ordinary fields, keys and handler payloads remain exact.
function observationFromModel(
  expected: ReturnType<typeof modelBoundSchemaMutation>,
): BoundSchemaObservation {
  const rows = () =>
    expected.rows.map(({ key, value }) => ({ key, value: { ...value } }))
  return {
    immediate: rows(),
    collection: rows(),
    state: rows(),
    data: expected.rows.map(({ value }) => ({ ...value })),
    mutations: expected.mutations.map((mutation) => ({
      ...mutation,
      original: { ...mutation.original },
      modified: { ...mutation.modified },
      changes: { ...mutation.changes },
    })),
  }
}
test.each(boundSchemaHistories)(
  `schema judgment rejects wrong binding and mutation observations %j`,
  (history) => {
    oracleRoute(`calibration`)
    const base = [
      { id: `one`, label: `  untouched first  `, rank: 1 },
      { id: `peer`, label: `  untouched peer  `, rank: 2 },
    ]
    for (const phase of [`initial`, `retained`, `rebound`] as const) {
      const expected = modelBoundSchemaMutation(history, phase, base)
      const binding = modelBoundSchemaBinding(history, phase)
      const faults: Array<{
        label: string
        observation: BoundSchemaObservation
      }> = []
      for (const schema of boundSchemaModes) {
        if (schema === binding.schema) continue
        const wrong = modelBoundSchemaMutation(
          { ...history, firstSchema: schema, nextSchema: schema },
          phase,
          base,
        )
        faults.push({
          label: `wrong schema ${schema}`,
          observation: observationFromModel(wrong),
        })
      }
      const immediate = observationFromModel(expected)
      immediate.immediate = immediate.immediate.map((row, index) =>
        index === 0
          ? { ...row, value: { ...row.value, label: `wrong immediate` } }
          : row,
      )
      faults.push({
        label: `earlier mismatch with correct later state`,
        observation: immediate,
      })
      for (const field of [`immediate`, `collection`, `state`] as const) {
        const undefinedField = observationFromModel(expected)
        undefinedField[field] = undefinedField[field].map((row) => ({
          ...row,
          value: { ...row.value, unexpected: undefined },
        }))
        faults.push({
          label: `extra undefined field in ${field}`,
          observation: undefinedField,
        })
      }
      const undefinedData = observationFromModel(expected)
      undefinedData.data = undefinedData.data.map((row) => ({
        ...row,
        unexpected: undefined,
      }))
      faults.push({
        label: `extra undefined field in host data`,
        observation: undefinedData,
      })
      const undefinedMutation = observationFromModel(expected)
      undefinedMutation.mutations = undefinedMutation.mutations.map(
        (mutation) => ({
          ...mutation,
          changes: { ...mutation.changes, unexpected: undefined },
        }),
      )
      faults.push({
        label: `extra undefined field in handler`,
        observation: undefinedMutation,
      })
      const collection = observationFromModel(expected)
      collection.collection = collection.collection.slice(0, 1)
      faults.push({ label: `missing Collection peer`, observation: collection })
      const state = observationFromModel(expected)
      state.state = [...state.state, state.state[1]!]
      faults.push({ label: `duplicate state row`, observation: state })
      const data = observationFromModel(expected)
      data.data = data.data.map((row, index) =>
        index === 1 ? { ...row, extra: `unexpected` } : row,
      )
      faults.push({ label: `extra host data field`, observation: data })
      const key = observationFromModel(expected)
      key.state = key.state.map((row) => ({
        ...row,
        key: `wrong-${String(row.key)}`,
      }))
      faults.push({ label: `wrong public keys`, observation: key })
      const missing = observationFromModel(expected)
      missing.mutations = []
      faults.push({ label: `missing handler mutation`, observation: missing })
      const duplicate = observationFromModel(expected)
      duplicate.mutations = [...duplicate.mutations, duplicate.mutations[0]!]
      faults.push({
        label: `duplicate handler mutation`,
        observation: duplicate,
      })
      const original = observationFromModel(expected)
      original.mutations = original.mutations.map((mutation) => ({
        ...mutation,
        original: { ...mutation.original, label: mutation.modified.label },
      }))
      faults.push({
        label: `original replaced with modified`,
        observation: original,
      })
      if (binding.schema !== `absent`) {
        const raw = observationFromModel(expected)
        const label = modelBoundSchemaLabel(`absent`, history.input)
        raw.mutations = raw.mutations.map((mutation) => ({
          ...mutation,
          modified: { ...mutation.modified, label },
          changes: { ...mutation.changes, label },
        }))
        faults.push({
          label: `raw handler payload with transformed public rows`,
          observation: raw,
        })
      }
      for (const fault of faults)
        expect(
          () =>
            checkBoundSchemaMutation(fault.observation, expected, fault.label),
          fault.label,
        ).toThrow(fault.label)
      const reordered = observationFromModel(expected)
      for (const field of [`immediate`, `collection`, `state`] as const)
        reordered[field] = [...reordered[field]].reverse()
      reordered.data = [...reordered.data].reverse()
      checkBoundSchemaMutation(reordered, expected, `allowed unordered rows`)

      const source = modelBoundSchemaRows(base, binding.key)
      const transformed = source.map((row) => ({
        ...row,
        value: {
          ...row.value,
          label: modelBoundSchemaLabel(`trim`, history.input),
        },
      }))
      expect(() =>
        checkBoundSchemaRows(transformed, source, `sync rows stay raw`),
      ).toThrow(`sync rows stay raw`)
      expect(() =>
        checkBoundSchemaValues(
          transformed.map(({ value }) => value),
          source.map(({ value }) => value),
          `sync host data stays raw`,
        ),
      ).toThrow(`sync host data stays raw`)
      checkBoundSchemaRows([...source].reverse(), source, `raw unordered rows`)
      checkBoundSchemaValues(
        source.map(({ value }) => value).reverse(),
        source.map(({ value }) => value),
        `raw unordered host data`,
      )
    }
  },
)
declareOracle({
  owns: [
    `src/useLiveQuery.ts#useLiveQuery`,
    `src/useLiveSuspenseQuery.ts#useLiveSuspenseQuery`,
  ],
  grammar: [histories, boundSchemaHistories],
  model: [modelBoundSchemaReceiver],
  check: [
    checkBoundSchemaReceiver,
    checkBoundSchemaMutation,
    checkBoundSchemaRows,
    checkBoundSchemaValues,
  ],
})

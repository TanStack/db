/**
 * React's two config hooks receive the shared mutation-schema binding law.
 * Native act establishes committed hook data; the common driver also captures
 * the Collection immediately when update returns. Schema source passthrough,
 * retained mutations and identity replacement use the same independent model.
 * Controlled Collections supply no provider, SSR, or concurrent-render claim.
 */
import { act, renderHook } from '@testing-library/react'
import { afterAll, expect, test } from 'vitest'
import { useLiveQuery } from '../src/useLiveQuery'
import { useLiveSuspenseQuery } from '../src/useLiveSuspenseQuery'
import { declareOracle } from '../../db/tests/oracle-declaration'
import { createOracleReach } from '../../db/tests/oracle-reach'
import {
  boundSchemaHistories,
  boundSchemaModes,
  boundSchemaReachStates,
  checkBoundSchemaMutation,
  checkBoundSchemaRows,
  checkBoundSchemaValues,
  modelBoundSchemaBinding,
  modelBoundSchemaLabel,
  modelBoundSchemaMutation,
  modelBoundSchemaRows,
} from '../../db/tests/live-query-bound-options-oracle'
import { runBoundSchemaHistory } from '../../db/tests/live-query-bound-options-support'
import type { BoundSchemaNativeHost } from '../../db/tests/live-query-bound-options-support'
import type { BoundSchemaObservation } from '../../db/tests/live-query-bound-options-oracle'

for (const hook of [`live`, `suspense`] as const) {
  const reach = createOracleReach(
    `React ${hook} schema binding`,
    boundSchemaReachStates,
  )
  let ran = false
  afterAll(() => {
    if (!ran) return
    reach.assertReached()
    if (process.env.TANSTACK_DB_ORACLE_STATISTICS === `1`)
      console.info(
        `React ${hook} schema binding reach`,
        Object.fromEntries(reach.counts()),
      )
  })
  test.each(boundSchemaHistories)(
    `React ${hook} binds mutation schemas %j`,
    async (history) => {
      ran = true
      const host: BoundSchemaNativeHost = {
        mount: (input) => {
          const mounted = renderHook(
            (props: { revision: number; proposed: boolean }) =>
              hook === `live`
                ? useLiveQuery(input(props))
                : useLiveSuspenseQuery(input(props)),
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
      await runBoundSchemaHistory(history, host, reach)
    },
  )
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
  grammar: [boundSchemaHistories],
  check: [
    checkBoundSchemaMutation,
    checkBoundSchemaRows,
    checkBoundSchemaValues,
  ],
})

/**
 * Preact receives the shared inline-option binding law through its real hook.
 * The finite grammar varies each configured option and query/key identity.
 * Three ordinary rerenders, a source publication and identity replacement are
 * observed at Preact commit after its native act flush. A render budget catches
 * repeated reconstruction. Preact has no DbClient input; cache admission is
 * therefore not its public receiving boundary.
 */
import { createCollection, gt } from '@tanstack/db'
import { act } from 'preact/test-utils'
import { useLiveQuery } from '../src/useLiveQuery'
import {
  mockSyncCollectionOptions,
  withOracleCleanup,
} from '../../db/tests/utils'
import {
  boundOptionHistories,
  captureBoundOptions,
  checkBoundOptions,
} from '../../db/tests/live-query-bound-options-oracle'
import {
  declareOracle,
  differs,
  oracleProperty,
  pass,
  violation,
} from '../../db/tests/oracle-config'
import { renderHook, settle } from './render-probe'
import type { Observation, Verdict } from '../../db/tests/oracle-config'
import type { InitialQueryBuilder } from '@tanstack/db'

type Row = { id: string; label: string; rank: number }
// This is the same bounded six-case grammar as the former test.each receiver.
// Source values are authored history inputs so the model derives published
// rows from the action, without reading the hook or its configuration.
const histories = boundOptionHistories.map((binding) => ({
  ...binding,
  initialRow: { id: `one`, label: `before`, rank: 1 },
  updatedRow: { id: `one`, label: `after`, rank: 1 },
}))
type History = (typeof histories)[number]
const cuts = [
  `rerender 0`,
  `rerender 1`,
  `rerender 2`,
  `source-update`,
  `identity-change`,
] as const
const states = [
  `rerender`,
  `source-update`,
  `identity-change`,
  `getKey`,
  `schema`,
  `both`,
  `query`,
  `queryKey`,
] as const

// These booleans preserve only the three reference relations checked by the
// shared oracle. Function identities and mutable Collection objects never enter
// the recorded trace. The selected-row projection matches the old receiver.
function captureBinding(
  initial: ReturnType<typeof captureBoundOptions>,
  current: Parameters<typeof checkBoundOptions>[1],
) {
  return {
    collectionRetained: current === initial.collection,
    getKeyRetained: current.config.getKey === initial.getKey,
    schemaRetained: current.config.schema === initial.schema,
  }
}
type Binding = ReturnType<typeof captureBinding> & {
  rows?: Array<{ id: string; label: string }>
  keys?: Array<unknown>
}

async function driveBoundOptions(
  history: History,
  observe: (checkpoint: string, value: unknown) => void,
) {
  const { option, identity } = history
  const source = createCollection(
    mockSyncCollectionOptions<Row>({
      id: `preact-bound-options`,
      getKey: (row) => row.id,
      initialData: [{ ...history.initialRow }],
    }),
  )
  const collections = new Set<{ cleanup: () => Promise<void> }>()
  let renders = 0
  let unmount: (() => void) | undefined
  await withOracleCleanup(async () => {
    const hook = renderHook(
      ({ revision }: { revision: number }) => {
        if (++renders > 30)
          throw new Error(`inline options rebuilt on every render`)
        const config = {
          query: (q: InitialQueryBuilder) =>
            q
              .from({ row: source })
              .where(({ row }) =>
                gt(row.rank, identity === `query` ? -revision : 0),
              ),
          ...(identity === `queryKey` ? { queryKey: [revision] } : {}),
          ...(option !== `schema`
            ? { getKey: (row: Row) => `bound-${revision}-${row.id}` }
            : {}),
        }
        if (option !== `getKey`)
          Object.assign(config, {
            schema: {
              '~standard': {
                version: 1,
                vendor: `bound-options`,
                validate: (value: unknown) => ({ value }),
              },
            },
          })
        const result = useLiveQuery(config)
        collections.add(result.collection)
        return result
      },
      { initialProps: { revision: 0 } },
    )
    unmount = hook.unmount
    await settle()
    const initial = captureBoundOptions(hook.result.current.collection)
    for (let turn = 0; turn < 3; turn++) {
      hook.rerender({ revision: 0 })
      await settle()
      observe(
        `rerender ${turn}`,
        captureBinding(initial, hook.result.current.collection),
      )
      observe(`reach`, `rerender`)
    }
    act(() => {
      source.utils.begin()
      source.utils.write({ type: `update`, value: { ...history.updatedRow } })
      source.utils.commit()
    })
    await settle()
    observe(`source-update`, {
      ...captureBinding(initial, hook.result.current.collection),
      rows: hook.result.current.data.map((row: Row) => ({
        id: row.id,
        label: row.label,
      })),
    })
    observe(`reach`, `source-update`)
    hook.rerender({ revision: 1 })
    await settle()
    observe(`identity-change`, {
      ...captureBinding(initial, hook.result.current.collection),
      keys: [...hook.result.current.state.keys()],
    })
    for (const state of [`identity-change`, option, identity])
      observe(`reach`, state)
  }, [
    () => unmount?.(),
    () =>
      withOracleCleanup(() => {}, [
        ...[...collections].map((collection) => () => collection.cleanup()),
        () => source.cleanup({ dependents: true }),
      ]),
  ])
}

function modelBoundOptions(history: History) {
  return {
    rows: [{ id: history.updatedRow.id, label: history.updatedRow.label }],
    keys: [
      history.option === `schema`
        ? history.updatedRow.id
        : `bound-1-${history.updatedRow.id}`,
    ],
    reach: [
      `rerender`,
      `source-update`,
      `identity-change`,
      history.option,
      history.identity,
    ],
  }
}

// Identity sentinels enact exactly the shared reference judgment. Required cuts
// and state names replace the old global reach counters: every bounded case must
// perform all three rerenders, source publication and identity replacement.
function checkBoundOptionHistory(
  history: History,
  trace: ReadonlyArray<Observation>,
  expected: ReturnType<typeof modelBoundOptions>,
): Verdict {
  for (const cut of cuts) {
    const entry = trace.find(({ checkpoint }) => checkpoint === cut)
    if (!entry)
      return violation(`history`, `missing ${cut}`, `bound option history`)
    const actual = entry.value as Binding
    const getKey = {}
    const schema = {}
    const collection = { config: { getKey, schema } }
    const current = actual.collectionRetained
      ? collection
      : { config: { getKey, schema } }
    current.config = {
      getKey: actual.getKeyRetained ? getKey : {},
      schema: actual.schemaRetained ? schema : {},
    }
    try {
      checkBoundOptions(
        { collection, getKey, schema },
        current,
        cut === `identity-change`,
        history.option,
      )
    } catch (error) {
      return violation(cut, String(error), `bound options`)
    }
    if (cut === `source-update`) {
      const wrong = differs(
        cut,
        `source update rows`,
        actual.rows,
        expected.rows,
      )
      if (wrong) return wrong
    }
    if (cut === `identity-change`) {
      const wrong = differs(cut, `replacement keys`, actual.keys, expected.keys)
      if (wrong) return wrong
    }
  }
  const reached = new Set(
    trace
      .filter(({ checkpoint }) => checkpoint === `reach`)
      .map(({ value }) => String(value)),
  )
  for (const state of expected.reach)
    if (!reached.has(state))
      return violation(`history`, `missing ${state}`, `bound option reach`)
  if (
    [...reached].some(
      (state) => !(states as ReadonlyArray<string>).includes(state),
    )
  )
    return violation(`history`, `unknown state`, `bound option reach`)
  return pass
}

oracleProperty({
  id: `preact.bound-options`,
  law: {
    statement: `Identity-comparing Preact bindings retain inline options until query identity changes; source publications remain live and replacements bind new keys.`,
    authority: `packages/db/tests/live-query-bound-options-oracle.ts; maintainer inline-option decision and shared framework query-identity contract.`,
    limits: `Six bounded option/identity cases, three normal rerenders, one scalar-row source update and one identity change; no DbClient admission boundary.`,
    owner: `packages/db/tests/live-query-bound-options-oracle.ts`,
  },
  histories,
  label: ({ option, identity }) => `${option}/${identity}`,
  model: modelBoundOptions,
  driver: driveBoundOptions,
  check: checkBoundOptionHistory,
  calibrations: boundOptionHistories.map((binding) => ({
    name: `in-place replacement ${binding.option}/${binding.identity}`,
    law: `bound options`,
    corrupt: (trace, history) =>
      history.option !== binding.option || history.identity !== binding.identity
        ? undefined
        : trace.map((entry) =>
            entry.checkpoint !== `rerender 0`
              ? entry
              : {
                  ...entry,
                  value: {
                    ...(entry.value as Binding),
                    ...(history.option !== `schema`
                      ? { getKeyRetained: false }
                      : {}),
                    ...(history.option !== `getKey`
                      ? { schemaRetained: false }
                      : {}),
                  },
                },
          ),
  })),
})

declareOracle({
  owns: [`src/useLiveQuery.ts#useLiveQuery`],
  check: [checkBoundOptionHistory],
  grammar: [histories],
  model: [modelBoundOptions],
})

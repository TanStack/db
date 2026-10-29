/**
 * Native receiving mechanics for the shared bound-options oracle. This module
 * controls real Collections and held mutation handlers; it computes no expected
 * schema result. Hosts supply mount, commit flushing and teardown only.
 */
import { expect } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { gt } from '../src/query/index.js'
import { createDeferred } from '../src/deferred.js'
import { mockSyncCollectionOptions, withOracleCleanup } from './utils.js'
import {
  boundSchemaLane,
  captureBoundOptions,
  checkBoundSchemaMutation,
  checkBoundSchemaRows,
  checkBoundSchemaValues,
  modelBoundSchemaBinding,
  modelBoundSchemaKey,
  modelBoundSchemaMutation,
  modelBoundSchemaRows,
} from './live-query-bound-options-oracle.js'
import type {
  BoundSchemaHistory,
  BoundSchemaMutation,
  BoundSchemaPhase,
  BoundSchemaRow,
  BoundSchemaRows,
} from './live-query-bound-options-oracle.js'
import type { Collection } from '../src/collection/index.js'
import type { InitialQueryBuilder } from '../src/query/index.js'
import type { UpdateMutationFn } from '../src/types.js'
import type { createOracleReach } from './oracle-reach.js'

type RenderInput = { revision: number; proposed: boolean }
type SchemaCollection = Pick<
  Collection<BoundSchemaRow, string | number>,
  `entries` | `update` | `cleanup`
> & { config: { getKey: unknown; schema?: unknown } }
export type BoundSchemaResult = {
  collection: SchemaCollection
  state: ReadonlyMap<string | number, BoundSchemaRow>
  data: ReadonlyArray<BoundSchemaRow>
}
type NativeBinding = {
  current: () => BoundSchemaResult
  rerender: (input: RenderInput) => void
  flush: (action?: () => void) => Promise<void>
  unmount: () => void
}

// The runtime fixture deliberately uses ordinary String operations. The model
// derives its output from authored grammar parts instead of calling this code.
function fixtureSchema(mode: `trim` | `uppercase`) {
  return {
    '~standard': {
      version: 1 as const,
      vendor: `bound-schema-options`,
      validate(value: unknown) {
        if (
          typeof value !== `object` ||
          value === null ||
          !(`label` in value) ||
          typeof value.label !== `string`
        )
          return { issues: [{ message: `A label is required` }] }
        return {
          value: {
            ...value,
            label:
              mode === `trim` ? value.label.trim() : value.label.toUpperCase(),
          },
        }
      },
    },
  }
}
function makeConfig(
  source: ReturnType<typeof createSource>,
  onUpdate: UpdateMutationFn<BoundSchemaRow>,
  history: BoundSchemaHistory,
  { revision, proposed }: RenderInput,
) {
  const keyPrefix = proposed && history.changeKey ? `bound-` : ``
  const config = {
    query: (q: InitialQueryBuilder) =>
      q
        .from({ row: source })
        .where(({ row }) =>
          gt(row.rank, history.identity === `query` ? -revision : 0),
        ),
    ...(history.identity === `queryKey` ? { queryKey: [revision] } : {}),
    getKey: (row: BoundSchemaRow) => `${keyPrefix}${row.id}`,
    onUpdate,
  }
  const schema = proposed ? history.nextSchema : history.firstSchema
  // LiveQueryCollectionConfig currently types schema as never. This is the
  // documented JavaScript configuration boundary, with no typing claim.
  if (schema !== `absent`)
    Object.assign(config, { schema: fixtureSchema(schema) })
  return config
}
export type BoundSchemaNativeHost = {
  mount: (
    input: (props: RenderInput) => ReturnType<typeof makeConfig>,
  ) => NativeBinding
}
function createSource(rows: ReadonlyArray<BoundSchemaRow>) {
  return createCollection(
    mockSyncCollectionOptions<BoundSchemaRow>({
      id: `bound-schema-source`,
      getKey: (row) => row.id,
      initialData: rows.map((row) => ({ ...row })),
    }),
  )
}
function captureRow(row: object): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).filter(
      ([name]) =>
        ![`$key`, `$origin`, `$collectionId`, `$hasPendingWrites`].includes(
          name,
        ),
    ),
  )
}
function captureEntries(
  rows: Iterable<readonly [unknown, object]>,
): BoundSchemaRows {
  return [...rows].map(([key, row]) => ({ key, value: captureRow(row) }))
}

/**
 * Each held update is observed at its immediate Collection return cut and at
 * the host's native committed-data cut. The handler receives a fresh gate for
 * each probe; no mutation spans identity replacement. Raw source updates are
 * independent controls, since schemas must never parse graph sync output.
 */
export async function runBoundSchemaHistory(
  history: BoundSchemaHistory,
  host: BoundSchemaNativeHost,
  reach: ReturnType<typeof createOracleReach<string>>,
): Promise<void> {
  reach.beginHistory()
  const lane = boundSchemaLane(history)
  const mark = (cut: string) => reach.reach(`${lane}/${cut}`)
  let base: Array<BoundSchemaRow> = [
    { id: `one`, label: `  source alpha  `, rank: 1 },
    { id: `peer`, label: `  source beta  `, rank: 2 },
  ]
  const source = createSource(base)
  const collections = new Set<SchemaCollection>()
  let binding: NativeBinding | undefined
  let gate: ReturnType<typeof createDeferred<void>> | undefined
  let pending: ReturnType<SchemaCollection[`update`]> | undefined
  let mutations: Array<BoundSchemaMutation> = []
  let renders = 0
  const onUpdate: UpdateMutationFn<BoundSchemaRow> = async ({
    transaction,
  }) => {
    expect(gate, `the authored handler hold exists`).toBeDefined()
    mutations.push(
      ...transaction.mutations.map((mutation) => ({
        key: mutation.key,
        original: captureRow(mutation.original),
        modified: captureRow(mutation.modified),
        changes: captureRow(mutation.changes),
      })),
    )
    await gate!.promise
  }
  await withOracleCleanup(async () => {
    binding = host.mount((props) => {
      if (++renders > 90)
        throw new Error(`inline schema rebuilt on every render`)
      return makeConfig(source, onUpdate, history, props)
    })
    await binding.flush()
    const initial = captureBoundOptions(binding.current().collection)
    collections.add(binding.current().collection)
    const observeBase = (phase: BoundSchemaPhase, cut: string) => {
      const current = binding!.current()
      const expected = modelBoundSchemaRows(
        base,
        modelBoundSchemaBinding(history, phase).key,
      )
      checkBoundSchemaRows(
        captureEntries(current.collection.entries()),
        expected,
        `${cut}/Collection`,
      )
      checkBoundSchemaRows(
        captureEntries(current.state),
        expected,
        `${cut}/host state`,
      )
      checkBoundSchemaValues(
        current.data.map(captureRow),
        expected.map(({ value }) => value),
        `${cut}/host data`,
      )
    }
    const probe = async (
      phase: BoundSchemaPhase,
      cut: BoundSchemaPhase | `rebound-followup` = phase,
    ) => {
      const current = binding!.current()
      collections.add(current.collection)
      gate = createDeferred<void>()
      mutations = []
      let immediate: BoundSchemaRows = []
      let settled = false
      const key = modelBoundSchemaKey(
        base[0]!.id,
        modelBoundSchemaBinding(history, phase).key,
      )
      await binding!.flush(() => {
        pending = current.collection.update(key, (draft) => {
          draft.label = `${history.input.padding}${history.input.word}${history.input.padding}`
        })
        // Capture in the same call stack, before the host gets an await.
        immediate = captureEntries(current.collection.entries())
        void pending.when(`settled`).then(
          () => {
            settled = true
          },
          () => {
            settled = true
          },
        )
      })
      expect(settled, `${cut}/handler remains held`).toBe(false)
      const committed = binding!.current()
      checkBoundSchemaMutation(
        {
          immediate,
          collection: captureEntries(committed.collection.entries()),
          state: captureEntries(committed.state),
          data: committed.data.map(captureRow),
          mutations,
        },
        modelBoundSchemaMutation(history, phase, base),
        cut,
      )
      mark(`${cut}-held`)
      await binding!.flush(() => gate!.resolve())
      await pending!.when(`settled`)
      pending = undefined
      await binding!.flush()
      observeBase(phase, `${cut}/settled`)
      mark(`${cut}-settled`)
    }
    observeBase(`initial`, `initial raw source`)
    mark(`initial-source-raw`)
    await probe(`initial`)
    binding.rerender({ revision: 0, proposed: true })
    await binding.flush()
    expect(binding.current().collection, `same query keeps Collection`).toBe(
      initial.collection,
    )
    expect(
      binding.current().collection.config.getKey,
      `same query keeps key`,
    ).toBe(initial.getKey)
    expect(
      binding.current().collection.config.schema,
      `same query keeps schema including absence`,
    ).toBe(initial.schema)
    await probe(`retained`)
    const publish = async (phase: BoundSchemaPhase) => {
      base = base.map((row) =>
        row.id === `one` ? { ...row, label: `  later source ${phase}  ` } : row,
      )
      await binding!.flush(() => {
        source.utils.begin()
        source.utils.write({ type: `update`, value: { ...base[0]! } })
        source.utils.commit()
      })
      observeBase(phase, `${phase}/raw sync control`)
      mark(
        phase === `retained`
          ? `retained-source-raw`
          : `rebound-followup-source-raw`,
      )
    }
    await publish(`retained`)
    binding.rerender({ revision: 1, proposed: true })
    await binding.flush()
    collections.add(binding.current().collection)
    expect(
      binding.current().collection,
      `new identity replaces Collection`,
    ).not.toBe(initial.collection)
    observeBase(`rebound`, `replacement raw source`)
    mark(`rebound-source-raw`)
    await probe(`rebound`)
    await publish(`rebound`)
    // Another use after the later source publication checks the binding's next
    // mutation rather than ending at successful replacement/readiness.
    await probe(`rebound`, `rebound-followup`)
  }, [
    () => (binding ? binding.flush(() => gate?.resolve()) : gate?.resolve()),
    () => pending?.when(`settled`),
    () => binding?.unmount(),
    () =>
      withOracleCleanup(
        () => {},
        [...collections].map((collection) => () => collection.cleanup()),
      ),
    () => source.cleanup({ dependents: true }),
  ])
}

/**
 * Native receiving mechanics for the shared bound-options oracle. This module
 * controls real Collections and held mutation handlers; it computes no expected
 * schema result. Hosts supply mount, commit flushing and teardown only.
 */
import { createCollection } from '../src/collection/index.js'
import { gt } from '../src/query/index.js'
import { createDeferred } from '../src/deferred.js'
import { mockSyncCollectionOptions, withOracleCleanup } from './utils.js'
import {
  boundSchemaGrammar,
  captureBoundOptions,
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

type SchemaUpdateHandler = (params: {
  // The recorder consumes these mutation fields, not the invariant full
  // Transaction and Collection types. Published row metadata remains allowed;
  // captureRow records every ordinary field before the shared comparison.
  transaction: {
    mutations: ReadonlyArray<{
      key: string | number
      original: object
      modified: object
      changes: object
    }>
  }
}) => Promise<void>

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
  onUpdate: SchemaUpdateHandler,
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
 * Record the native schedule for oracleProperty receiving drivers. Each held
 * update is observed at its immediate Collection return cut and at the host's
 * native committed-data cut; the handler receives a fresh gate for each probe.
 * This recorder retains public facts only; the shared model judges them afterward.
 * Source inputs are copied before they cross the production boundary.
 */
export async function recordBoundSchemaHistory(
  history: BoundSchemaHistory & {
    sourceRows: ReadonlyArray<BoundSchemaRow>
    retainedSourceLabel: string
    reboundSourceLabel: string
  },
  host: BoundSchemaNativeHost,
  observe: (checkpoint: string, value: unknown) => void,
): Promise<void> {
  const grammar = boundSchemaGrammar(history)
  const source = createSource(history.sourceRows)
  const collections = new Set<SchemaCollection>()
  let binding: NativeBinding | undefined
  let gate: ReturnType<typeof createDeferred<void>> | undefined
  let pending: ReturnType<SchemaCollection[`update`]> | undefined
  let mutations: Array<BoundSchemaMutation> = []
  let renders = 0
  const onUpdate: SchemaUpdateHandler = async ({ transaction }) => {
    observe(`handler hold`, gate !== undefined)
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
  const record = (cut: string, value: unknown) => {
    observe(cut, value)
    observe(`reach`, `${grammar}/${cut}`)
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
    const snapshot = () => {
      const current = binding!.current()
      return {
        collection: captureEntries(current.collection.entries()),
        state: captureEntries(current.state),
        data: current.data.map(captureRow),
      }
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
      // This key is the authored update input, not an expected observation.
      const key = `${phase === `rebound` && history.changeKey ? `bound-` : ``}${history.sourceRows[0]!.id}`
      await binding!.flush(() => {
        pending = current.collection.update(key, (draft) => {
          draft.label = `${history.input.padding}${history.input.word}${history.input.padding}`
        })
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
      record(`${cut}-held`, {
        ...snapshot(),
        immediate,
        mutations,
        settled,
      })
      await binding!.flush(() => gate!.resolve())
      await pending!.when(`settled`)
      pending = undefined
      await binding!.flush()
      record(`${cut}-settled`, snapshot())
    }
    record(`initial-source-raw`, snapshot())
    await probe(`initial`)
    binding.rerender({ revision: 0, proposed: true })
    await binding.flush()
    observe(`retained binding`, {
      collection: binding.current().collection === initial.collection,
      getKey: binding.current().collection.config.getKey === initial.getKey,
      schema: binding.current().collection.config.schema === initial.schema,
    })
    await probe(`retained`)
    const publish = async (phase: `retained` | `rebound`) => {
      const value = {
        ...history.sourceRows[0]!,
        label:
          phase === `retained`
            ? history.retainedSourceLabel
            : history.reboundSourceLabel,
      }
      await binding!.flush(() => {
        source.utils.begin()
        source.utils.write({ type: `update`, value })
        source.utils.commit()
      })
      record(
        phase === `retained`
          ? `retained-source-raw`
          : `rebound-followup-source-raw`,
        snapshot(),
      )
    }
    await publish(`retained`)
    binding.rerender({ revision: 1, proposed: true })
    await binding.flush()
    collections.add(binding.current().collection)
    observe(`rebound binding`, {
      collection: binding.current().collection === initial.collection,
    })
    record(`rebound-source-raw`, snapshot())
    await probe(`rebound`)
    await publish(`rebound`)
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

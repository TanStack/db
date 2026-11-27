// Measures a sync source that applies one source state to several Collections,
// such as one server checkpoint: each Collection's sync transaction committed on
// its own, or all of them inside one withPublicationContext call. Run it through
// the production runner after building db and db-ivm:
//
//   pnpm --filter @tanstack/db-ivm --filter @tanstack/db build
//   node --expose-gc scripts/bench/production.mjs scripts/bench/multi-collection-sync.ts \
//     --repetitions=7 --warmup=2
//
// One fact Collection joins every dimension Collection, with inner or left
// joins, on Collections that index the joined columns automatically (as
// incremental-update.ts's `auto` mode) or not at all. A case applies a
// checkpoint with every row (startup), then one that
// updates 1% of every Collection's rows. The source commits the fact Collection
// first or last: which one a source does decides how much an intermediate join
// costs. Both modes run on the same bundle, on fresh fixtures built from the
// same seed, in an order that alternates per repetition. Each repetition
// asserts that both modes end with the same live-query rows.
import assert from 'node:assert/strict'
import {
  BTreeIndex,
  createCollection,
  createLiveQueryCollection,
  eq,
  withPublicationContext,
} from '../../packages/db/src/index.js'
import type {
  ChangeMessageOrDeleteKeyMessage,
  SyncConfig,
} from '../../packages/db/src/index.js'

type Row = { id: number; value: number } & Record<`fk${number}`, number>
type SyncOperations = Parameters<SyncConfig<Row, number>[`sync`]>[0]
type Mode = `one commit at a time` | `withPublicationContext`
type Join = `inner` | `left`
type FactOrder = `fact first` | `fact last`
type IndexMode = `auto` | `off`
type Case = {
  collections: number
  factRows: number
  join: Join
  factOrder: FactOrder
  indexMode: IndexMode
}
type Checkpoint = Array<Array<ChangeMessageOrDeleteKeyMessage<Row, number>>>
type Result = {
  startupMs: number
  startupBatches: number
  updateMs: number
  updateBatches: number
  rows: string
}

const argument = (name: string, fallback: number) => {
  const match = process.argv.find((value) => value.startsWith(`--${name}=`))
  return match === undefined ? fallback : Number(match.split(`=`)[1])
}
const repetitions = argument(`repetitions`, 7)
const warmup = argument(`warmup`, 2)
const modes: Array<Mode> = [`one commit at a time`, `withPublicationContext`]
const FACT_ROWS = 10_000
const cases: Array<Case> = ([`auto`, `off`] as const).flatMap((indexMode) =>
  [2, 4, 8].flatMap((collections) =>
    ([`inner`, `left`] as const).flatMap((join) =>
      ([`fact first`, `fact last`] as const).map((factOrder) => ({
        collections,
        factRows: FACT_ROWS,
        join,
        factOrder,
        indexMode,
      })),
    ),
  ),
)
const DIMENSION_ROWS_PER_FACT_ROW = 0.1
const UPDATED_SHARE = 0.01

// Deterministic, so every mode and repetition gets the same rows
function random(seed: number) {
  let state = seed
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648
    return state / 2_147_483_648
  }
}

function createFixture({ collections, factRows, join, indexMode }: Case) {
  const dimensionRows = Math.max(
    1,
    Math.round(factRows * DIMENSION_ROWS_PER_FACT_ROW),
  )
  const syncs: Array<SyncOperations> = []
  const sources = Array.from({ length: collections }, (_, index) =>
    createCollection<Row, number>({
      id: `source-${index}-${Math.random()}`,
      getKey: (row) => row.id,
      autoIndex: indexMode === `auto` ? `eager` : `off`,
      defaultIndexType: BTreeIndex,
      startSync: true,
      sync: {
        sync: (operations) => {
          syncs[index] = operations
          operations.markReady()
        },
      },
    }),
  )
  const [fact, ...dimensions] = sources
  const live = createLiveQueryCollection({
    startSync: true,
    query: (q) => {
      let query: any = q.from({ fact: fact! })
      dimensions.forEach((dimension, index) => {
        query = query.join(
          { [`d${index}`]: dimension },
          (refs: any) => eq(refs.fact[`fk${index}`], refs[`d${index}`].id),
          join,
        )
      })
      return query.select((refs: any) => ({
        id: refs.fact.id,
        value: refs.fact.value,
        ...Object.fromEntries(
          dimensions.map((_, index) => [`d${index}`, refs[`d${index}`].value]),
        ),
      }))
    },
  })

  const next = random(collections * 1_000_003 + factRows)
  const factRow = (id: number): Row => {
    const row: Row = { id, value: Math.floor(next() * 1000) }
    for (let index = 0; index < dimensions.length; index++)
      row[`fk${index}`] = Math.floor(next() * dimensionRows)
    return row
  }
  const startup: Checkpoint = sources.map((_, index) =>
    Array.from(
      { length: index === 0 ? factRows : dimensionRows },
      (__, id) => ({
        type: `insert` as const,
        value:
          index === 0 ? factRow(id) : { id, value: Math.floor(next() * 1000) },
      }),
    ),
  )
  const update: Checkpoint = startup.map((changes) =>
    changes
      .filter(() => next() < UPDATED_SHARE)
      .map(({ value }) => ({
        type: `update` as const,
        value: { ...value, value: value.value + 1 },
      })),
  )
  return { syncs, sources, live, startup, update }
}

function apply(
  syncs: Array<SyncOperations>,
  checkpoint: Checkpoint,
  factOrder: FactOrder,
  mode: Mode,
) {
  const indexes = checkpoint.map((_, index) => index)
  if (factOrder === `fact last`) indexes.push(indexes.shift()!)
  const commitAll = () => {
    for (const index of indexes) {
      const sync = syncs[index]!
      sync.begin()
      for (const change of checkpoint[index]!) sync.write(change)
      sync.commit()
    }
  }
  if (mode === `withPublicationContext`) withPublicationContext(commitAll)
  else commitAll()
}

const collectGarbage = () => (globalThis as { gc?: () => void }).gc?.()

async function measure(benchmarkCase: Case, mode: Mode): Promise<Result> {
  const fixture = createFixture(benchmarkCase)
  await fixture.live.preload()
  let batches = 0
  const subscription = fixture.live.subscribeChanges(() => batches++)

  collectGarbage()
  let start = performance.now()
  apply(fixture.syncs, fixture.startup, benchmarkCase.factOrder, mode)
  const startupMs = performance.now() - start
  const startupBatches = batches
  if (benchmarkCase.join === `left`)
    assert.equal(fixture.live.size, benchmarkCase.factRows)

  batches = 0
  collectGarbage()
  start = performance.now()
  apply(fixture.syncs, fixture.update, benchmarkCase.factOrder, mode)
  const updateMs = performance.now() - start
  const updateBatches = batches

  const rows = JSON.stringify(
    fixture.live.toArray
      // Virtual props name each fixture's own live query
      .map((row) =>
        Object.fromEntries(
          Object.entries(row).filter(([key]) => !key.startsWith(`$`)),
        ),
      )
      .sort((a, b) => (a.id as number) - (b.id as number)),
  )
  subscription.unsubscribe()
  await fixture.live.cleanup()
  await Promise.all(fixture.sources.map((source) => source.cleanup()))
  return { startupMs, startupBatches, updateMs, updateBatches, rows }
}

const median = (values: Array<number>) => {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2
}

console.log(
  `node ${process.version}, ${FACT_ROWS} fact rows, ${repetitions} repetitions after ${warmup} warmups, medians`,
)
const table: Array<Record<string, string | number>> = []
for (const benchmarkCase of cases) {
  const samples = new Map(modes.map((mode) => [mode, [] as Array<Result>]))
  for (let repetition = 0; repetition < warmup + repetitions; repetition++) {
    const order = repetition % 2 === 0 ? modes : [...modes].reverse()
    const results = new Map<Mode, Result>()
    for (const mode of order)
      results.set(mode, await measure(benchmarkCase, mode))
    assert.equal(
      results.get(modes[0])!.rows,
      results.get(modes[1])!.rows,
      `Both modes must end with the same live-query rows`,
    )
    if (repetition >= warmup)
      for (const [mode, result] of results) samples.get(mode)!.push(result)
  }
  const [separate, together] = modes.map((mode) => samples.get(mode)!)
  const startup = modes.map((mode) =>
    median(samples.get(mode)!.map((result) => result.startupMs)),
  )
  const update = modes.map((mode) =>
    median(samples.get(mode)!.map((result) => result.updateMs)),
  )
  table.push({
    collections: benchmarkCase.collections,
    join: benchmarkCase.join,
    order: benchmarkCase.factOrder,
    index: benchmarkCase.indexMode,
    'startup ms': `${startup[0]!.toFixed(0)} → ${startup[1]!.toFixed(0)}`,
    'startup ×': +(startup[0]! / startup[1]!).toFixed(2),
    'update ms': `${update[0]!.toFixed(1)} → ${update[1]!.toFixed(1)}`,
    'update ×': +(update[0]! / update[1]!).toFixed(2),
    batches: `${median(separate!.map((r) => r.startupBatches))}+${median(separate!.map((r) => r.updateBatches))} → ${median(together!.map((r) => r.startupBatches))}+${median(together!.map((r) => r.updateBatches))}`,
  })
}
console.table(table)

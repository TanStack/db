/** Controlled compiler/ordered-loader receiver for the ordered-work owner.
 * One real on-demand Collection supplies a finite provider prefix. Two roots
 * consume the exact authored QueryIR on one D2 graph, with shared or separate
 * caches. Captures retain signed multiplicities; the owner supplies row truth.
 * This is a core compiler/loader cut, not a public Collection window promise.
 */
import { D2, MultiSet, output } from '@tanstack/db-ivm'
import { createCollection } from '../../src/collection/index.js'
import { BTreeIndex } from '../../src/indexes/btree-index.js'
import { Query, compileQuery, eq } from '../../src/query/index.js'
import { getQueryIR } from '../../src/query/builder/index.js'
import { QueryRef, UnionAll } from '../../src/query/ir.js'
import { OrderedSourceLoader } from '../../src/query/live/ordered-source-loader.js'
import { withOracleCleanup } from '../utils.js'
import type { CollectionSubscription } from '../../src/collection/subscription.js'
import type { OrderByOptimizationInfo } from '../../src/query/compiler/order-by.js'
import type {
  QueryCache,
  WindowOptions,
} from '../../src/query/compiler/types.js'
import type { QueryIR } from '../../src/query/ir.js'
import type {
  LoadSubsetOptions,
  LoadSubsetRequestResult,
  SyncConfig,
} from '../../src/types.js'

type Row = { id: number; rank: number }
export type OrderedCompilerCacheHistory = {
  order: `authored-first` | `callback-first`
  cache: `shared` | `separate`
  path: `query-ref` | `joined-source` | `union-branch`
  shape: `structured` | `functional`
  direction: `asc` | `desc`
  initial: { limit: number; offset: number }
  moved: { limit: number; offset: number }
}
type Request = LoadSubsetOptions & {
  onLoadSubsetResult?: (
    result: LoadSubsetRequestResult,
    options: LoadSubsetOptions,
    release: () => void,
  ) => void
}
export async function receiveOrderedCompilerCacheHistory(
  history: OrderedCompilerCacheHistory,
  rows: ReadonlyArray<Row>,
  check: (
    cut: `initial` | `moved` | `returned`,
    actual: { authored: Array<number>; callback: Array<number> },
  ) => void,
) {
  // The provider order is part of this controlled adapter's premise. This
  // sorts provider data, not the expected answer; the owner computes that.
  const provider = [...rows].sort((a, b) =>
    history.direction === `asc` ? a.rank - b.rank : b.rank - a.rank,
  )
  let sync!: Parameters<SyncConfig<Row, number>[`sync`]>[0]
  const source = createCollection({
    id: `ordered-compiler-cache`,
    getKey: (row: Row) => row.id,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    syncMode: `on-demand`,
    startSync: true,
    sync: {
      sync: (params) => {
        sync = params
        sync.begin()
        sync.write({ type: `insert`, value: { ...provider[0]! } })
        sync.commit()
        sync.markReady()
        return { loadSubset: () => true }
      },
    },
  })
  let loader: OrderedSourceLoader | undefined
  await withOracleCleanup(async () => {
    const base = new Query()
      .from({ chosen: source })
      .orderBy(({ chosen }) => chosen.rank, history.direction)
      .offset(history.initial.offset)
      .limit(history.initial.limit)
    const selected = getQueryIR(
      history.shape === `structured`
        ? base.select(({ chosen }) => ({
            id: chosen.id,
            rank: chosen.rank,
            $key: `spoof`,
          }))
        : base.fn.select(({ chosen }) => ({
            id: chosen.id,
            rank: chosen.rank,
            $key: `spoof`,
          })),
    )
    const joined = getQueryIR(
      new Query()
        .from({ peer: source })
        .leftJoin(
          { nested: new Query().from({ chosen: source }) },
          ({ peer, nested }) => eq(peer.id, nested.id),
        ),
    )
    joined.join![0]!.from = new QueryRef(
      selected,
      `nested`,
      joined.join![0]!.from.bindingId,
    )
    const consumed: QueryIR =
      history.path === `joined-source`
        ? { ...joined, fnSelect: ({ nested }) => nested }
        : history.path === `union-branch`
          ? { from: new UnionAll([selected]), fnSelect: (row) => row }
          : {
              from: new QueryRef(selected, `nested`),
              fnSelect: ({ nested }) => nested,
            }
    const graph = new D2()
    const input = graph.newInput<[number, Row]>()
    const cache: QueryCache = new WeakMap()
    const plans: Record<string, OrderByOptimizationInfo> = {}
    let move!: (options: WindowOptions) => void
    const compile = (query: QueryIR) =>
      compileQuery(
        query,
        { chosen: input, peer: input },
        { [source.id]: source },
        {},
        {},
        new Set(),
        plans,
        query === selected
          ? (fn) => {
              move = fn
            }
          : () => {},
        history.cache === `shared` ? cache : new WeakMap(),
      )
    const [authored, callback] =
      history.order === `authored-first`
        ? [compile(selected), compile(consumed)]
        : (() => {
            const other = compile(consumed)
            return [compile(selected), other]
          })()
    const authoredBag = new Map<number, number>()
    const callbackBag = new Map<number, number>()
    for (const [compiled, bag] of [
      [authored, authoredBag],
      [callback, callbackBag],
    ] as const)
      compiled.pipeline.pipe(
        output((message) => {
          for (const [[, [value]], weight] of message.getInner()) {
            if (value === undefined) continue // legal unmatched LEFT-join side
            const id = (value as Row).id
            bag.set(id, (bag.get(id) ?? 0) + weight)
          }
        }),
      )
    graph.finalize()
    input.sendData(
      new MultiSet(source.toArray.map((row) => [[row.id, row as Row], 1])),
    )
    graph.run()
    let revision = 0
    const request = (options: Request, boundary: boolean) => {
      if (!boundary) {
        const page = provider.slice(
          options.offset ?? 0,
          (options.offset ?? 0) + (options.limit ?? provider.length),
        )
        const fresh = page.filter((row) => !source.has(row.id))
        if (fresh.length) {
          sync.begin()
          for (const row of fresh)
            sync.write({ type: `insert`, value: { ...row } })
          sync.commit()
          revision++
          input.sendData(
            new MultiSet(
              fresh.map((row) => [[row.id, source.get(row.id)! as Row], 1]),
            ),
          )
          graph.run()
        }
      }
      options.onLoadSubsetResult?.(true, options, () => {})
    }
    const subscription = {
      setOrderByIndex: () => {},
      readOrderedSnapshot: (options: LoadSubsetOptions) =>
        source.toArray
          .sort((a, b) =>
            history.direction === `asc` ? a.rank - b.rank : b.rank - a.rank,
          )
          .slice(0, options.limit ?? source.size)
          .map((value) => ({ key: value.id, value })),
      requestLimitedSnapshot: (options: Request) => request(options, false),
      // All ranks are unique. A tie request adds no row beyond the installed
      // boundary; it still settles its real loader continuation.
      requestSnapshot: (options: Request) => request(options, true),
    }
    const info = Object.values(plans)[0]!
    loader = new OrderedSourceLoader(
      info,
      subscription as unknown as CollectionSubscription,
      `chosen`,
      () => {},
      () => false,
      () => revision,
    )
    const snapshot = () => {
      const expand = (bag: Map<number, number>) =>
        [...bag].flatMap(([id, count]) => {
          if (!Number.isSafeInteger(count) || count < 0)
            throw new Error(`invalid ordered multiplicity ${id}:${count}`)
          return Array.from({ length: count }, () => id)
        })
      return { authored: expand(authoredBag), callback: expand(callbackBag) }
    }
    loader.start()
    await loader.loadMore(0)
    graph.run()
    check(`initial`, snapshot())
    move(history.moved)
    graph.run()
    await loader.loadMore(1)
    graph.run()
    check(`moved`, snapshot())
    move(history.initial)
    graph.run()
    await loader.loadMore(2)
    graph.run()
    check(`returned`, snapshot())
  }, [() => loader?.dispose(), () => source.cleanup()])
}

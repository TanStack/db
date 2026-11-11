// The model, production driver and refinement check of the ordered-prefix
// refetch oracle in refetch-ordered-prefix-oracle.test.ts, which states the
// contract, and of its known-defect witnesses in
// refetch-ordered-prefix-known-defects.test.ts. This module registers no
// tests.
import {
  BTreeIndex,
  createCollection,
  createLiveQueryCollection,
  eq,
  getLoadSubsetDemandKey,
  isUndefined,
  not,
} from '@tanstack/db'
import { QueryClient } from '@tanstack/query-core'
import { rejectAt } from '../../db/tests/query/ordered-comparison-oracle.js'
import { evaluateReferenceExpression } from '../../db/tests/reference-expression-oracle'
import { queryCollectionOptions } from '../src/query'
import { sameOrderedIds, settle } from './refetch-ordered-prefix-support'
import type { LoadSubsetOptions, SyncConfig } from '@tanstack/db'

export type Item = { id: number; rank: number; label: string }
export type Marker = { id: number; itemId: number }

// ## Model
//
// The window is a pure function of the backend rows, the local markers, and
// the query's order and window. A LEFT-joined marker filters rows after the
// provider's order and limit, so the loader must page past a filtered row.
// The model sorts the current backend rows with an independent comparator.
// It shares no production cursor, comparator, or ordering code.
export type Scenario = {
  // `ignore` honors neither cursor nor offset. It breaks the request
  // contract and is used only to check that refetch fails fast.
  encoding: `cursor` | `offset` | `ignore`
  // A function Query key derives each key from the request data.
  functionKey: boolean
  // One order term uses unique ranks. Two terms allow rank ties, which the
  // loader resolves with separate tie requests.
  terms: 1 | 2
  // The leading order term: a number, or a mixed-case string under the
  // default locale collation, whose order differs from code-unit order.
  orderKey: `rank` | `label`
  // The most rows the provider returns for one request, if it caps pages.
  pageCap: number | undefined
  limit: number
  offset: number
}

export function compareRows(a: Item, b: Item, scenario: Scenario): number {
  const leading =
    scenario.orderKey === `rank`
      ? b.rank - a.rank
      : b.label.localeCompare(a.label)
  return leading || (scenario.terms === 2 ? a.id - b.id : 0)
}

export function expectedWindow(
  backend: ReadonlyMap<number, Item>,
  markers: ReadonlySet<number>,
  scenario: Scenario,
): Array<number> {
  return [...backend.values()]
    .filter((row) => markers.has(row.id))
    .sort((a, b) => compareRows(a, b, scenario))
    .slice(scenario.offset, scenario.offset + scenario.limit)
    .map((row) => row.id)
}

// The loader treats every row through its boundary as loaded, and its
// boundary is at or after the window's last row. So every backend row from
// the start of the order through that row must be in the source Collection,
// with its current values. A window shorter than its limit read the whole
// source, so then every backend row must be. The window law alone sees a
// missing row only once a marker makes it a window row; this law sees it
// while it is still latent.
export function expectedCoverage(
  backend: ReadonlyMap<number, Item>,
  markers: ReadonlySet<number>,
  scenario: Scenario,
): Array<Item> {
  const rows = [...backend.values()].sort((a, b) => compareRows(a, b, scenario))
  const window = expectedWindow(backend, markers, scenario)
  if (window.length < scenario.limit) return rows
  const end = backend.get(window.at(-1)!)!
  return rows.filter((row) => compareRows(row, end, scenario) <= 0)
}

// The commands of a history and a case; the oracle's history grammar
// generates them.
export type Command =
  | { type: `upsert`; id: number; rank: number }
  | { type: `label`; id: number; label: string }
  | { type: `delete`; id: number }
  | { type: `flip`; id: number }
  | { type: `observe`; id: number }
  | { type: `invalidate` }
  | { type: `refetch` }
  | { type: `hold`; kind: `update` | `delete`; id: number }
  | { type: `release` }

export type Case = {
  scenario: Scenario
  initial: Array<{ id: number; rank: number; marked: boolean }>
  history: Array<Command>
}

// ## Production driver
//
// A real QueryClient backs an on-demand Query Collection with an eager B-tree
// index. Its query function serves each request from the current backend:
// `where` (including tie requests), then the encoding's continuation, then
// order and limit. A `cursor` provider applies `cursor.whereFrom` and ignores
// `offset` when a cursor is present. An `offset` provider ignores the cursor
// and skips `offset` rows. The marker Collection is a local eager source.
export type Run = {
  windowIds: () => Array<number>
  backend: Map<number, Item>
  markers: Set<number>
  apply: (command: Command) => Promise<void>
  requests: Array<LoadSubsetOptions>
  // Calls at the public adapter boundary, before Query metadata normalization.
  acquisitions: Array<LoadSubsetOptions>
  // Rows returned by the provider so far.
  servedRows: () => number
  // Requests whose Query key does not match their request data.
  keyMismatches: () => number
  setEncoding: (encoding: Scenario[`encoding`]) => void
  // Fail every provider request after the next `count` requests, until
  // cleared. A failed request rejects its Query function.
  failAfter: (count: number | undefined) => void
  // The Query cache entries this Collection owns: one per tracked request.
  cachedQueries: () => number
  // Queries an observer still holds. A refetch re-runs only these; a released
  // Query stays cached until its gcTime.
  activeQueries: () => number
  // Reports that served pages may have shifted (`loadedSubsets:invalidated`
  // events on the source Collection) so far.
  reports: () => number
  // Ordered reanswers with changed key membership or an earlier end, so far.
  // A report needs one of these; unrelated value edits do not qualify.
  changedReanswers: () => number
  // Reanswers with the same keys whose last row moves earlier in the order.
  sameKeyEarlierEnds: () => number
  // Same-key earlier ends on the deleted held boundary with an omitted gap.
  deleteHeldGaps: () => number
  // Request offsets at which the public report reached the core receiver.
  reportRequestOffsets: () => ReadonlyArray<number>
  // Make the next change application fail once: a change subscriber throws
  // while the refetched rows commit.
  failNextApplication: () => void
  // Start an optimistic update of a loaded row whose handler waits until the
  // returned release is called. While it persists, the Collection holds
  // every sync transaction back.
  holdUpdate: (id: number) => () => Promise<void>
  // Whether a hold is running. No window is owed until its release.
  holding: () => boolean
  // The source Collection's rows, which the coverage law checks.
  loadedRows: () => ReadonlyMap<number, Item>
  refetch: (opts?: { throwOnError?: boolean }) => Promise<unknown>
  cleanup: () => Promise<Array<unknown>>
}

let collectionSequence = 0

export async function startRun(testCase: Case): Promise<Run> {
  const { scenario } = testCase
  const id = `refetch-ordered-prefix-${collectionSequence++}`
  // Letters alternate case, so locale and code-unit orders differ.
  const letters = [`a`, `B`, `c`, `D`, `e`, `F`]
  const toItem = (row: { id: number; rank: number }): Item => ({
    id: row.id,
    rank: scenario.terms === 1 ? row.rank * 100 + row.id : row.rank,
    label:
      (letters[row.rank] ?? `z`) + (scenario.terms === 1 ? String(row.id) : ``),
  })
  const backend = new Map(testCase.initial.map((row) => [row.id, toItem(row)]))
  const markers = new Set(
    testCase.initial.filter((row) => row.marked).map((row) => row.id),
  )
  const requests: Array<LoadSubsetOptions> = []
  let encoding = scenario.encoding
  let servedRows = 0
  let keyMismatches = 0
  const keyFor = (options: LoadSubsetOptions) => {
    const demandKey = getLoadSubsetDemandKey(options)
    return demandKey === undefined ? [id] : [id, demandKey]
  }
  let failFrom: number | undefined
  const answers = new Map<string, Array<Item>>()
  let changedReanswers = 0
  let sameKeyEarlierEnds = 0
  let deleteHeldGaps = 0
  let heldRow: { kind: `update` | `delete`; id: number } | undefined
  const serve = (options: LoadSubsetOptions): Array<Item> => {
    const page = answer(options)
    if (options.orderBy) {
      const request = JSON.stringify([
        getLoadSubsetDemandKey(options),
        options.offset,
      ])
      const previous = answers.get(request)
      if (previous !== undefined) {
        const keys = (rows: Array<Item>) =>
          rows
            .map((row) => row.id)
            .sort()
            .join(`,`)
        const changedKeys = keys(previous) !== keys(page)
        const oldEnd = previous.at(-1)
        const newEnd = page.at(-1)
        const earlierEnd =
          oldEnd !== undefined &&
          (newEnd === undefined || compareRows(newEnd, oldEnd, scenario) < 0)
        // Report relevance is independent of payload equality: an order-equal
        // label edit cannot lose prefix coverage. A moved end can, even when
        // key membership is unchanged. Complete values remain in the separate
        // source-coverage comparison.
        if (changedKeys || earlierEnd) changedReanswers++
        if (!changedKeys && earlierEnd && newEnd !== undefined) {
          sameKeyEarlierEnds++
          if (
            heldRow?.kind === `delete` &&
            heldRow.id === oldEnd.id &&
            [...backend.values()].some(
              (row) =>
                compareRows(row, newEnd, scenario) > 0 &&
                compareRows(row, oldEnd, scenario) < 0 &&
                !previous.some((before) => before.id === row.id) &&
                !page.some((after) => after.id === row.id),
            )
          ) {
            deleteHeldGaps++
          }
        }
      }
      answers.set(request, page)
    }
    return page
  }
  const answer = (options: LoadSubsetOptions): Array<Item> => {
    requests.push(options)
    if (failFrom !== undefined && requests.length > failFrom) {
      throw new Error(`provider unavailable`)
    }
    const usesCursor = encoding === `cursor` && options.cursor
    const predicates = [
      options.where,
      usesCursor ? options.cursor!.whereFrom : undefined,
    ].filter((where) => where !== undefined)
    let page = [...backend.values()].filter((row) =>
      predicates.every(
        (where) => evaluateReferenceExpression(where, row) === true,
      ),
    )
    if (options.orderBy) {
      page.sort((a, b) => compareRows(a, b, scenario))
      if (!usesCursor && encoding !== `ignore`) {
        page = page.slice(options.offset ?? 0)
      }
      if (options.limit !== undefined) page = page.slice(0, options.limit)
      if (scenario.pageCap !== undefined) page = page.slice(0, scenario.pageCap)
    }
    servedRows += page.length
    return page.map((row) => ({ ...row }))
  }

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { gcTime: Infinity, retry: false, staleTime: Infinity },
    },
  })
  const config = queryCollectionOptions<Item>({
    id,
    queryClient,
    queryKey: scenario.functionKey ? keyFor : [id],
    syncMode: `on-demand`,
    queryFn: (context) => {
      const options = context.meta!.loadSubsetOptions!
      if (
        scenario.functionKey &&
        JSON.stringify(context.queryKey) !== JSON.stringify(keyFor(options))
      ) {
        keyMismatches++
      }
      return Promise.resolve(serve(options))
    },
    getKey: (row) => row.id,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    // A held optimistic write stays persisting until released; the
    // backend does not change.
    onUpdate: async () => {
      await heldWrite
    },
    onDelete: async () => {
      await heldWrite
    },
  })
  const acquisitions: Array<LoadSubsetOptions> = []
  const sync = config.sync.sync
  config.sync = {
    ...config.sync,
    sync: (operations) => {
      const handlers = sync(operations)
      if (
        handlers === undefined ||
        typeof handlers === `function` ||
        handlers.loadSubset === undefined
      )
        return handlers
      const load = handlers.loadSubset
      return {
        ...handlers,
        loadSubset: (options) => {
          acquisitions.push(options)
          return load(options)
        },
      }
    },
  }
  const items = createCollection(config)
  let heldWrite: Promise<void> = Promise.resolve()
  // The running hold's release, if any.
  let releaseHold: (() => Promise<void>) | undefined
  const heldPreloads: Array<Promise<void>> = []
  const hold = (kind: `update` | `delete`, rowId: number) => {
    let release!: () => void
    heldWrite = new Promise((resolve) => {
      release = resolve
    })
    const transaction =
      kind === `update`
        ? items.update(rowId, (draft) => {
            draft.label += `!`
          })
        : items.delete(rowId)
    return async () => {
      release()
      await transaction.when(`settled`)
      await settle()
    }
  }

  let reports = 0
  const reportRequestOffsets: Array<number> = []
  items.on(`loadedSubsets:invalidated`, () => {
    reports++
    reportRequestOffsets.push(acquisitions.length)
  })
  let failApplication = false
  items.subscribeChanges(() => {
    if (!failApplication) return
    failApplication = false
    throw new Error(`change subscriber failed`)
  })

  let markerSync!: Parameters<SyncConfig<Marker, number>[`sync`]>[0]
  const markerCollection = createCollection<Marker, number>({
    id: `${id}-markers`,
    getKey: (marker) => marker.id,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: (operations) => {
        markerSync = operations
        operations.begin()
        for (const itemId of markers) {
          operations.write({ type: `insert`, value: { id: itemId, itemId } })
        }
        operations.commit()
        operations.markReady()
      },
    },
  })

  const window = createLiveQueryCollection((q) => {
    const ordered = q
      .from({ item: items })
      .leftJoin({ marker: markerCollection }, ({ item, marker }) =>
        eq(item.id, marker.itemId),
      )
      .where(({ marker }) => not(isUndefined(marker.itemId)))
      .orderBy(
        ({ item }) => (scenario.orderKey === `rank` ? item.rank : item.label),
        `desc`,
      )
    return (
      scenario.terms === 2
        ? ordered.orderBy(({ item }) => item.id, `asc`)
        : ordered
    )
      .offset(scenario.offset)
      .limit(scenario.limit)
      .select(({ item }) => ({ id: item.id }))
  })

  const observers: Array<{ cleanup: () => Promise<void> }> = []
  const apply = async (command: Command): Promise<void> => {
    switch (command.type) {
      case `upsert`:
        backend.set(command.id, toItem(command))
        return
      case `label`: {
        const row = backend.get(command.id)
        if (row !== undefined)
          backend.set(command.id, { ...row, label: command.label })
        return
      }
      case `delete`:
        backend.delete(command.id)
        return
      case `flip`: {
        const marked = markers.has(command.id)
        if (marked) markers.delete(command.id)
        else markers.add(command.id)
        markerSync.begin()
        markerSync.write({
          type: marked ? `delete` : `insert`,
          value: { id: command.id, itemId: command.id },
        })
        const receipt = markerSync.commit()
        if (receipt !== true) await receipt
        await settle()
        return
      }
      case `observe`: {
        const observer = createLiveQueryCollection((q) =>
          q
            .from({ item: items })
            .where(({ item }) => eq(item.id, command.id))
            .select(({ item }) => ({ id: item.id })),
        )
        observers.push(observer)
        // A preload waits until its rows are visible, so under a hold it
        // settles only after the release.
        const preload = observer.preload()
        if (releaseHold === undefined) await preload
        else heldPreloads.push(preload)
        await settle()
        return
      }
      case `invalidate`:
        await queryClient.invalidateQueries({ queryKey: [id] })
        await settle()
        return
      case `refetch`:
        await items.utils.refetch()
        await settle()
        return
      // A row that is not loaded cannot take an optimistic write, so the
      // hold is a no-op then.
      case `hold`:
        if (releaseHold === undefined && items.has(command.id)) {
          heldRow = { kind: command.kind, id: command.id }
          releaseHold = hold(command.kind, command.id)
          await settle()
        }
        return
      case `release`: {
        const release = releaseHold
        releaseHold = undefined
        heldRow = undefined
        await release?.()
        await Promise.all(heldPreloads.splice(0))
        await settle()
        return
      }
    }
  }

  await window.preload()
  await settle()
  return {
    windowIds: () => window.toArray.map((row) => row.id),
    backend,
    markers,
    apply,
    requests,
    acquisitions,
    servedRows: () => servedRows,
    keyMismatches: () => keyMismatches,
    setEncoding: (next) => {
      encoding = next
    },
    failAfter: (count) => {
      failFrom = count === undefined ? undefined : requests.length + count
    },
    cachedQueries: () =>
      queryClient.getQueryCache().findAll({ queryKey: [id] }).length,
    activeQueries: () =>
      queryClient.getQueryCache().findAll({ queryKey: [id], type: `active` })
        .length,
    reports: () => reports,
    changedReanswers: () => changedReanswers,
    sameKeyEarlierEnds: () => sameKeyEarlierEnds,
    deleteHeldGaps: () => deleteHeldGaps,
    reportRequestOffsets: () => reportRequestOffsets,
    failNextApplication: () => {
      failApplication = true
    },
    holdUpdate: (rowId) => hold(`update`, rowId),
    holding: () => releaseHold !== undefined,
    loadedRows: () =>
      new Map(
        items.toArray.map(({ id: rowId, rank, label }) => [
          rowId,
          { id: rowId, rank, label },
        ]),
      ),
    refetch: (opts) => items.utils.refetch(opts),
    cleanup: async () => {
      const failures: Array<unknown> = []
      // A failed history can stop inside a hold. Release it, so its
      // transaction does not outlive this run.
      try {
        await apply({ type: `release` })
      } catch (error) {
        failures.push(error)
      }
      for (const collection of [
        ...observers,
        window,
        items,
        markerCollection,
      ]) {
        try {
          await collection.cleanup()
        } catch (error) {
          failures.push(error)
        }
      }
      queryClient.clear()
      return failures
    },
  }
}

// ## Refinement check
//
// The checkpoints are preload, every invalidation, and every refetch. There the
// public window's
// ordered ids must equal the model's ids. The comparison keeps order, duplicates, and missing
// rows. A failure names its checkpoint, so a loader defect at preload is not
// mistaken for a refetch defect.
//
// The run also records the premise of the gap: a refetch or invalidation of a
// lagging provider after a continuation page was served. The campaigns must
// reach it, and must reach such a refetch while a hold is running.
export type Observation = {
  reachedSameKeyEarlierEndDuringHold: boolean
  reachedDeleteHeldGapReportAndRepair: boolean
  reachedLaggingRefetchAfterContinuation: boolean
  // A refetch of a lagging provider while an optimistic write held sync rows
  // back.
  reachedLaggingRefetchDuringHold: boolean
  // Such a refetch that also reported, so a loader may have judged the skip
  // while the refetched rows were held back.
  reachedReportDuringHold: boolean
  // A refetch that reported while the window was full: the loader then
  // judges whether its own first page still proves the window, and repairs
  // when a moved end leaves it unproven.
  reachedReportOverFullWindow: boolean
  // Reports over the whole run.
  reports: number
}

// A step's reports, checked against the report laws in the contract.
export function checkReports(
  command: Command,
  reports: number,
  changedReanswers: number,
  checkpoint: string,
): void {
  if (reports > 1) {
    rejectAt(
      `refetch-ordered-prefix-oracle.test.ts:988`,
      new Error(
        `a ${command.type} at ${checkpoint} reported ${reports} times; expected at most 1`,
      ),
    )
  }
  if (reports > 0 && changedReanswers === 0) {
    rejectAt(
      `refetch-ordered-prefix-oracle.test.ts:993`,
      new Error(
        `a ${command.type} at ${checkpoint} reported, but no ordered request changed keys or moved its end earlier`,
      ),
    )
  }
}

export async function checkCase(testCase: Case): Promise<Observation> {
  const run = await startRun(testCase)
  let reachedSameKeyEarlierEndDuringHold = false
  let reachedDeleteHeldGapReportAndRepair = false
  let reachedLaggingRefetchAfterContinuation = false
  let reachedLaggingRefetchDuringHold = false
  let reachedReportDuringHold = false
  let reachedReportOverFullWindow = false
  let primary: unknown
  const check = (checkpoint: string) => {
    const expected = expectedWindow(run.backend, run.markers, testCase.scenario)
    const actual = run.windowIds()
    if (!sameOrderedIds(actual, expected)) {
      rejectAt(
        `refetch-ordered-prefix-oracle.test.ts:1012`,
        new Error(
          `window ${checkpoint} was ${JSON.stringify(actual)}; expected ${JSON.stringify(expected)}`,
        ),
      )
    }
    const loaded = run.loadedRows()
    const uncovered = expectedCoverage(
      run.backend,
      run.markers,
      testCase.scenario,
    ).filter(
      (row) => JSON.stringify(loaded.get(row.id)) !== JSON.stringify(row),
    )
    if (uncovered.length > 0) {
      rejectAt(
        `refetch-ordered-prefix-oracle.test.ts:1025`,
        new Error(
          `coverage ${checkpoint}: rows ${JSON.stringify(uncovered)} sort at or before the window's end but are ${JSON.stringify(uncovered.map((row) => loaded.get(row.id) ?? null))} in the source Collection`,
        ),
      )
    }
  }
  // A full-source request names no predicate, order, limit, or cursor. A
  // refetch may re-run one that already existed, but must not start the first.
  const isFullSource = (options: LoadSubsetOptions) =>
    options.where === undefined &&
    options.orderBy === undefined &&
    options.limit === undefined &&
    options.cursor === undefined
  const checkNoNewFullSource = (from: number, checkpoint: string) => {
    if (run.requests.slice(0, from).some(isFullSource)) return
    if (run.requests.slice(from).some(isFullSource)) {
      rejectAt(
        `refetch-ordered-prefix-oracle.test.ts:1040`,
        new Error(`a ${checkpoint} started a full-source request`),
      )
    }
  }
  try {
    check(`after preload`)
    let providerCurrent = true
    const history: Array<Command> = [...testCase.history, { type: `refetch` }]
    for (const [step, command] of history.entries()) {
      if (
        (command.type === `refetch` || command.type === `invalidate`) &&
        !providerCurrent &&
        run.requests.some((options) => options.cursor !== undefined)
      ) {
        reachedLaggingRefetchAfterContinuation = true
      }
      if (command.type === `refetch` && !providerCurrent && run.holding()) {
        reachedLaggingRefetchDuringHold = true
      }
      const requestsBefore = run.requests.length
      const reportsBefore = run.reports()
      const reanswersBefore = run.changedReanswers()
      const sameKeyEndsBefore = run.sameKeyEarlierEnds()
      const gapsBefore = run.deleteHeldGaps()
      await run.apply(command)
      if (
        run.deleteHeldGaps() > gapsBefore &&
        run.reports() > reportsBefore &&
        run
          .reportRequestOffsets()
          .slice(reportsBefore)
          .some((from) =>
            run.acquisitions
              .slice(from)
              .some((request) => request.refetch === true),
          )
      ) {
        reachedDeleteHeldGapReportAndRepair = true
      }
      if (run.holding() && run.sameKeyEarlierEnds() > sameKeyEndsBefore) {
        reachedSameKeyEarlierEndDuringHold = true
      }
      if (
        command.type === `refetch` &&
        run.holding() &&
        run.reports() > reportsBefore
      ) {
        reachedReportDuringHold = true
      }
      if (
        command.type === `refetch` &&
        run.reports() > reportsBefore &&
        run.windowIds().length === testCase.scenario.limit
      ) {
        reachedReportOverFullWindow = true
      }
      checkReports(
        command,
        run.reports() - reportsBefore,
        run.changedReanswers() - reanswersBefore,
        `step ${step}`,
      )
      if (command.type === `refetch` || command.type === `invalidate`) {
        checkNoNewFullSource(requestsBefore, `${command.type} at step ${step}`)
      }
      if (
        command.type === `upsert` ||
        command.type === `delete` ||
        command.type === `label`
      ) {
        providerCurrent = false
      } else if (command.type === `release`) {
        if (providerCurrent) check(`after release at step ${step}`)
      } else if (command.type === `refetch` || command.type === `invalidate`) {
        providerCurrent = true
        if (!run.holding()) check(`after ${command.type} at step ${step}`)
      }
    }
    // Repeat the refetch twice with the backend unchanged. The second read
    // must serve no more rows than the first.
    // A first-page request is ordered and limited, with no cursor.
    const firstPageRequests = (from: number) =>
      run.requests
        .slice(from)
        .filter(
          (options) =>
            options.orderBy !== undefined &&
            options.limit !== undefined &&
            options.cursor === undefined,
        ).length
    const servedBy = async (command: Command) => {
      const before = run.servedRows()
      const requestsBefore = run.requests.length
      const reportsBefore = run.reports()
      await run.apply(command)
      const reports = run.reports() - reportsBefore
      if (reports > 0) {
        rejectAt(
          `refetch-ordered-prefix-oracle.test.ts:1136`,
          new Error(
            `a ${command.type} of an unchanged backend reported ${reports} times`,
          ),
        )
      }
      // The backend is unchanged, so the loader starts no repair and every
      // first-page request comes from the refetch itself.
      const firstPages = firstPageRequests(requestsBefore)
      if (firstPages > 1) {
        rejectAt(
          `refetch-ordered-prefix-oracle.test.ts:1144`,
          new Error(
            `a ${command.type} of an unchanged backend started ${firstPages} first-page requests; expected at most 1`,
          ),
        )
      }
      return run.servedRows() - before
    }
    // The first repeat may still settle loader work that the history
    // started, so only later repeats check the first-page law.
    const before = run.servedRows()
    await run.apply({ type: `refetch` })
    const first = run.servedRows() - before
    const second = await servedBy({ type: `refetch` })
    if (second > first) {
      rejectAt(
        `refetch-ordered-prefix-oracle.test.ts:1157`,
        new Error(
          `a repeated refetch served ${second} rows after ${first} with an unchanged backend`,
        ),
      )
    }
    check(`after repeated refetches`)
    // An invalidation refetches every page at once. It reads the same served
    // prefixes as an explicit refetch, so it serves no more rows.
    const invalidated = await servedBy({ type: `invalidate` })
    if (invalidated > second) {
      rejectAt(
        `refetch-ordered-prefix-oracle.test.ts:1166`,
        new Error(
          `an invalidation served ${invalidated} rows; an explicit refetch of the same state served ${second}`,
        ),
      )
    }
    check(`after an invalidation of an unchanged backend`)
    if (run.keyMismatches() > 0) {
      rejectAt(
        `refetch-ordered-prefix-oracle.test.ts:1172`,
        new Error(
          `${run.keyMismatches()} requests carried a Query key that did not match their request data`,
        ),
      )
    }
  } catch (error) {
    primary = error
  }
  const cleanupFailures = await run.cleanup()
  if (primary !== undefined && cleanupFailures.length > 0) {
    throw new AggregateError(
      [primary, ...cleanupFailures],
      `refetch prefix law and cleanup failed`,
      { cause: primary },
    )
  }
  if (primary !== undefined) throw primary
  if (cleanupFailures.length > 0) {
    throw new AggregateError(cleanupFailures, `refetch prefix cleanup failed`)
  }
  return {
    reachedSameKeyEarlierEndDuringHold,
    reachedDeleteHeldGapReportAndRepair,
    reachedLaggingRefetchAfterContinuation,
    reachedLaggingRefetchDuringHold,
    reachedReportDuringHold,
    reachedReportOverFullWindow,
    reports: run.reports(),
  }
}

// A history that never settles is a progress failure, not a slow pass. The
// deadline turns it into a counterexample that fast-check can shrink. It is
// generous because a long history runs many settle loops on a loaded machine.
export async function withDeadline<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`history did not settle within 30 s`)),
          30_000,
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

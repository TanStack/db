import { fc } from '@fast-check/vitest'
import { beforeAll, describe, expect, vi } from 'vitest'
import {
  forwardAssertionJudgment,
  oracleAssertion,
  recordAssertionJudgment,
  recordedAssertionJudgment,
  rejectAt,
} from '../oracle-assertion-adapter.js'
import { oracleProperty, oracleRuns } from '../oracle-config.js'
import { createCollection } from '../../src/collection/index.js'
import { BTreeIndex } from '../../src/indexes/btree-index.js'
import {
  Query,
  createLiveQueryCollection,
  eq,
  groupKeys,
  inArray,
  include,
  materialize,
  toArray,
} from '../../src/query/index.js'
import { evaluateReferenceExpression } from '../reference-expression-oracle.js'
import { requiredIncludesObservations } from './includes-state-observations.js'
import { registerIncludesProperty } from './includes-registration-oracle.js'
import { createControlledCollection } from './includes-oracle-helpers.js'
import {
  cleanupAfterOracle,
  noPrimaryFailure,
} from './includes-functional-projection-support.js'
import {
  countSourceWork,
  createSourceCollection,
  expectSourceWorkBound,
  expectedResult,
  noFillers,
  observeWork,
  runCleanups,
} from './includes-work-counter-support.js'
import {
  WINDOW_RUNS,
  expectPayloadValue,
  payloadExamples,
  windowCase,
} from './includes-work-counter-model-oracle.js'
import type {
  ChildForm,
  WindowCase,
  WindowChild,
  WindowGrandchild,
  WindowParent,
} from './includes-work-counter-model-oracle.js'
import type { Collection } from '../../src/collection/index.js'
import type { LoadSubsetOptions } from '../../src/types.js'
import type { Context, QueryBuilder } from '../../src/query/index.js'
import type {
  SourceWork,
  WorkObservation,
} from './includes-work-counter-support.js'

/**
 * # Does unrelated source size increase correlated include work?
 *
 * Correct rows are not enough for a pushed-down include. An implementation can
 * return the right tree after scanning or delivering every unrelated source
 * row. This oracle protects a bounded work law for indexed correlations:
 *
 * 1. The query returns the complete expected nested result.
 * 2. Adding unmatched link rows does not increase source delivery or reads.
 * 3. Adding indexed join targets does not increase source delivery or reads.
 * 4. Without the target join, unrelated rows at every level still add no work.
 *
 * The reference is relational. It compares each scaled fixture with the same
 * query on a minimal baseline. Exact baseline counts prove that the intended
 * source path ran. The scaled relation, not elapsed time, states the work law.
 * Counters observe both delivered changes and Collection reads so filtering
 * cannot hide a scan through those read methods.
 *
 * The input grammar varies an integer filler count from 1 through 24. Zero is
 * the ablated baseline; negative and fractional counts are invalid fixture
 * sizes. Joined queries vary unrelated links and join targets separately.
 * The join-free query grows every source together. Counts 1, 2, and 3 cover the
 * smallest valid boundary, 24 covers the upper bound, and fixed and random
 * campaigns sample the range.
 *
 * The boundary conditions matter. Collections preload before they receive
 * B-tree indexes. Filler rows never match a selected route. This suite checks
 * source delivery and Collection reads at the preload checkpoint; it does not
 * promise a general runtime bound, count internal index traversal, or cover
 * providers that ignore local indexes.
 */

let nextCollectionId = 0
const joinedBaselineWork: SourceWork = {
  terms: { delivered: 3, examined: 3 },
  meanings: { delivered: 1, examined: 1 },
  groups: { delivered: 1, examined: 1 },
  links: { delivered: 2, examined: 2 },
}

const joinFreeBaselineWork: SourceWork = {
  terms: { delivered: 1, examined: 1 },
  meanings: { delivered: 1, examined: 1 },
  groups: { delivered: 1, examined: 1 },
  links: { delivered: 2, examined: 2 },
}

let joinedBaselineObservation: WorkObservation
let joinFreeBaselineObservation: WorkObservation

async function expectCorrelatedJoinWorkBound(
  fillerCount: number,
): Promise<void> {
  const baseline = joinedBaselineObservation
  const scaled = await observeWork({
    filler: {
      terms: 0,
      meanings: 0,
      groups: 0,
      links: fillerCount,
    },
    joinTargets: true,
  })
  oracleAssertion('includes work-counter-oracle comparison 112', () =>
    expect(baseline.result).toEqual(expectedResult({ joinTargets: true })),
  )
  oracleAssertion('includes work-counter-oracle comparison 113', () =>
    expect(scaled.result).toEqual(baseline.result),
  )
  oracleAssertion('includes work-counter-oracle comparison 114', () =>
    expect(baseline.sourceWork).toEqual(joinedBaselineWork),
  )

  oracleAssertion('includes work-counter-oracle comparison 116', () =>
    expectSourceWorkBound(scaled.sourceWork, baseline.sourceWork),
  )
}

async function expectJoinTargetWorkBound(fillerCount: number): Promise<void> {
  const baseline = joinedBaselineObservation
  const scaled = await observeWork({
    filler: {
      terms: fillerCount,
      meanings: 0,
      groups: 0,
      links: 0,
    },
    joinTargets: true,
  })

  oracleAssertion('includes work-counter-oracle comparison 131', () =>
    expect(baseline.result).toEqual(expectedResult({ joinTargets: true })),
  )
  oracleAssertion('includes work-counter-oracle comparison 132', () =>
    expect(scaled.result).toEqual(baseline.result),
  )
  oracleAssertion('includes work-counter-oracle comparison 133', () =>
    expect(baseline.sourceWork).toEqual(joinedBaselineWork),
  )
  oracleAssertion('includes work-counter-oracle comparison 134', () =>
    expectSourceWorkBound(scaled.sourceWork, baseline.sourceWork),
  )
}

async function expectJoinFreeWorkBound(fillerCount: number): Promise<void> {
  const baseline = joinFreeBaselineObservation
  const scaled = await observeWork({
    filler: {
      terms: fillerCount,
      meanings: fillerCount,
      groups: fillerCount,
      links: fillerCount,
    },
    joinTargets: false,
  })

  oracleAssertion('includes work-counter-oracle comparison 149', () =>
    expect(baseline.result).toEqual(expectedResult({ joinTargets: false })),
  )
  oracleAssertion('includes work-counter-oracle comparison 150', () =>
    expect(scaled.result).toEqual(baseline.result),
  )
  oracleAssertion('includes work-counter-oracle comparison 151', () =>
    expect(baseline.sourceWork).toEqual(joinFreeBaselineWork),
  )
  oracleAssertion('includes work-counter-oracle comparison 152', () =>
    expectSourceWorkBound(scaled.sourceWork, baseline.sourceWork),
  )
}

function campaigns(fixedSeed: number, property: string, runs = 6) {
  return [{ name: `fixed and random`, options: { runs, property, fixedSeed } }]
}

const correlatedLinksLaw = `A join preserves correlated source pushdown: unrelated joined-link fillers do not increase source work beyond the baseline bound.`
const joinTargetsLaw = `Indexed join-target growth keeps correlated source work flat.`
const joinFreeLaw = `Join-free correlated includes keep source work flat as unrelated fillers grow.`

describe(`includes deterministic work-counter oracle`, () => {
  beforeAll(async () => {
    const [joinedBaseline, joinFreeBaseline] = await Promise.all([
      observeWork({ filler: noFillers, joinTargets: true }),
      observeWork({ filler: noFillers, joinTargets: false }),
    ])
    joinedBaselineObservation = joinedBaseline
    joinFreeBaselineObservation = joinFreeBaseline
  })

  oracleProperty({
    id: `includes-work.correlated-links-fixed`,
    law: {
      statement: correlatedLinksLaw,
      authority: `Law 12 (work) and the physical planning and work contract in packages/db/src/query/live/ARCHITECTURE.md, stated at the start of this owner.`,
      limits: `The small filler boundary counts 1 to 3 and the joined-link range endpoint 24.`,
    },
    owns: [
      `src/collection/index.ts#createCollection`,
      `src/indexes/btree-index.ts`,
      `src/local-only.ts#localOnlyCollectionOptions`,
      `src/query/live-query-collection.ts#createLiveQueryCollection`,
    ],
    histories: [
      ...[1, 2, 3].map((fillers) => ({
        name: `checks the work bound at the small filler boundary (${fillers})`,
        fillers,
      })),
      { name: `checks the joined-link filler range endpoint`, fillers: 24 },
    ],
    label: ({ name }) => name,
    resolve: (history) => ({ ...history }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(correlatedLinksLaw, plan, observe, () =>
        expectCorrelatedJoinWorkBound(plan.fillers),
      ),
    check: forwardAssertionJudgment,
  })

  oracleProperty({
    id: `includes-work.join-targets-fixed`,
    law: {
      statement: joinTargetsLaw,
      authority: `Law 12 (work) and the physical planning and work contract in packages/db/src/query/live/ARCHITECTURE.md, stated at the start of this owner.`,
      limits: `The join-target filler range endpoints 1 and 24.`,
    },
    owns: [
      `src/collection/index.ts#createCollection`,
      `src/indexes/btree-index.ts`,
      `src/local-only.ts#localOnlyCollectionOptions`,
      `src/query/live-query-collection.ts#createLiveQueryCollection`,
    ],
    histories: [1, 24],
    label: (fillers) => `checks join-target growth at filler count ${fillers}`,
    resolve: (fillers) => ({ fillers }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(joinTargetsLaw, plan, observe, () =>
        expectJoinTargetWorkBound(plan.fillers),
      ),
    check: forwardAssertionJudgment,
  })

  oracleProperty({
    id: `includes-work.join-free-fixed`,
    law: {
      statement: joinFreeLaw,
      authority: `Law 12 (work) and the physical planning and work contract in packages/db/src/query/live/ARCHITECTURE.md, stated at the start of this owner.`,
      limits: `The join-free filler range endpoints 1 and 24.`,
    },
    owns: [
      `src/collection/index.ts#createCollection`,
      `src/indexes/btree-index.ts`,
      `src/local-only.ts#localOnlyCollectionOptions`,
      `src/query/live-query-collection.ts#createLiveQueryCollection`,
    ],
    histories: [1, 24],
    label: (fillers) => `checks join-free growth at filler count ${fillers}`,
    resolve: (fillers) => ({ fillers }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(joinFreeLaw, plan, observe, () =>
        expectJoinFreeWorkBound(plan.fillers),
      ),
    check: forwardAssertionJudgment,
  })

  for (const campaign of campaigns(1709, `includes-work.correlated-links`)) {
    registerIncludesProperty(
      [fc.integer({ min: 1, max: 24 })],
      {
        ...campaign.options,
        owns: [
          `src/collection/index.ts#createCollection`,
          `src/indexes/btree-index.ts`,
          `src/local-only.ts#localOnlyCollectionOptions`,
          `src/query/live-query-collection.ts#createLiveQueryCollection`,
        ],
      },
      `a join preserves correlated source pushdown (${campaign.name})`,
      (...args: Parameters<typeof expectCorrelatedJoinWorkBound>) => {
        return expectCorrelatedJoinWorkBound(...args)
      },
    )
  }

  for (const campaign of campaigns(170_900, `includes-work.join-targets`)) {
    registerIncludesProperty(
      [fc.integer({ min: 1, max: 24 })],
      {
        ...campaign.options,
        owns: [
          `src/collection/index.ts#createCollection`,
          `src/indexes/btree-index.ts`,
          `src/local-only.ts#localOnlyCollectionOptions`,
          `src/query/live-query-collection.ts#createLiveQueryCollection`,
        ],
      },
      `indexed join-target growth keeps source work flat (${campaign.name})`,
      (...args: Parameters<typeof expectJoinTargetWorkBound>) => {
        return expectJoinTargetWorkBound(...args)
      },
    )
  }

  for (const campaign of campaigns(17_090, `includes-work.join-free`)) {
    registerIncludesProperty(
      [fc.integer({ min: 1, max: 24 })],
      {
        ...campaign.options,
        owns: [
          `src/collection/index.ts#createCollection`,
          `src/indexes/btree-index.ts`,
          `src/local-only.ts#localOnlyCollectionOptions`,
          `src/query/live-query-collection.ts#createLiveQueryCollection`,
        ],
      },
      `join-free correlated includes keep source work flat (${campaign.name})`,
      (...args: Parameters<typeof expectJoinFreeWorkBound>) => {
        return expectJoinFreeWorkBound(...args)
      },
    )
  }
})

/**
 * # Does a parent window bound include work?
 *
 * An ordered parent query shows only the rows in its window. Law 12 of the
 * live-query architecture (Work) says irrelevant rows must not activate
 * unrelated routes. A parent row the window drops is irrelevant to the public
 * snapshot, so the route relation must not activate its bucket, and the
 * include must create no demand for its children. That holds with `distinct`,
 * which reads every parent row before the window, and after `setWindow`
 * narrows a parent that has only an `orderBy`, whether before or after the
 * live query starts. Only the parent's window answers `setWindow`; an include
 * child's own `orderBy` or `limit` must not take it over.
 *
 * A static parent filter (`eq` or `inArray` on the correlation field) may
 * create child demand before the query runs only when no top-K can drop the
 * rows it names: no enclosing query is windowed or a `findOne`, and either the
 * query is neither windowed nor a `findOne`, or it is a `findOne` that shows
 * one row for one named correlation value, with no `offset`, and offset 0 at
 * start if a window was requested before start. Any other window or `findOne`
 * can drop them, including a window `setWindow` requests later, so the static
 * demand must wait for the rows it shows. A `findOne` keeps its compiled limit
 * (1, or 0 for `.limit(0).findOne()`): `setWindow` throws
 * `SetWindowFindOneLimitError` for any other limit. A window is an ordered
 * view, so only an ordered `findOne` has a movable window; an unordered one
 * accepts only its compiled limit at offset 0.
 *
 * ## Model
 *
 * Parents have a rank and a group; children and their include correlate by
 * group, so parents of one group share one active bucket, and every child has
 * one grandchild. The model sorts the shown units by rank and takes the
 * window. A unit is a model-only abstraction: a parent row, or, with
 * `distinct`, one distinct (rank, group) pair, because the selected values
 * then omit the parent id and parents with equal rank and group collapse into
 * one public row. Ranks can tie, so the comparison accepts any member of the
 * tie group at the window edge: the rank sequence must match, every shown row
 * must be a unit with that rank, and no unit may appear twice. The parent is a
 * page (`offset` and `limit`), a `findOne` with or without an `offset`, or an
 * `orderBy` alone, whose window starts unbounded unless `setWindow` requests
 * one before start. Each shown row must carry its group's children in the
 * include form under test:
 *
 * - `materialize` and `collection` (a child Collection): every child;
 * - `ordered`: every child by `n`, descending, with the child's own `orderBy`;
 * - `limited`: the first two of those, with the child's own `limit`;
 * - `findOne`: the first of those, or none;
 * - `nested`: every child with its materialized grandchildren;
 * - `limited-nested`: the first two children with their grandchildren.
 *
 * ## Work
 *
 * The child source Collection is local or on demand. For an on-demand child,
 * the test's `loadSubset` handler stands in for both the sync adapter and the
 * provider: it serves each acquisition attempt from the model's rows by the
 * request data's predicate, keeps a ledger of sent rows, and forwards a later
 * change message only for a sent row or a row a served predicate matches.
 * Work is a model observation: the child rows the local source Collection
 * delivers to the query, or the rows the on-demand handler's acquisitions
 * serve, plus the grandchild rows the local grandchild source delivers.
 * Preload may load only the children of the shown rows' groups and the
 * grandchildren of the shown children. A step may newly load only the groups
 * of rows that entered the window and were not shown before it, the
 * grandchildren of children that entered an include, and the rows the step
 * itself writes, which a local subscription receives whether or not their
 * group is loaded. An on-demand child arrives only through an acquisition, so
 * that path shows routing even for rows the step writes. A query that routes
 * the row after the window, every row in an edge tie group, rows before the
 * window, rows `setWindow` dropped, or rows a static filter names fails.
 *
 * ## Recorded limit: transient top-K rows (#2151)
 *
 * While an index-backed parent top-K refills its window within one graph run,
 * after a held row moves out, a tie group at the window edge loads, or the
 * window moves forward, it can briefly hold a row outside the window it shows
 * once that acquisition completes, and that row's children load. The public
 * snapshot stays correct. A refill checkpoint is a model observation that
 * combines two production facts the harness cannot see directly, an ordered
 * acquisition and whether it completed within the graph run: the parent
 * Collection delivers more change batches to the query than the initial load
 * at preload, or than the step's own parent write. The generated campaigns
 * skip only the work bound at refill checkpoints and still check the rows.
 * Fixed regressions cover every known trace and allow exactly the one extra child row
 * each shows, and fixed forward moves allow none. Each generated campaign
 * counts the forward moves its own runs check strictly and requires some.
 *
 * ## Histories
 *
 * Histories insert parents (fresh, or copying an existing rank and group),
 * delete parents, move a parent's rank past every other rank, insert and
 * delete children, and move the parent window with `setWindow`, optionally
 * after a window requested before start. A static child filter on the
 * grandchild correlation field (the child id) may keep only some children.
 * Indexes exist before the live query starts, and every step completes before
 * it is checked.
 */
type WindowUnit = { key: string; rank: number; group: string }
type ShownRow = { key: string; rank: number; group: string; kids: unknown }
type ObservedKid = { id: string; grand?: Iterable<{ id: string }> }

/** The rows the window may show: parents, or distinct (rank, group) pairs. */
function windowUnits(
  parents: Iterable<WindowParent>,
  distinct: boolean,
): Array<WindowUnit> {
  const units = new Map<string, WindowUnit>()
  for (const parent of parents) {
    const key = distinct ? `${parent.rank}|${parent.group}` : parent.id
    units.set(key, { key, rank: parent.rank, group: parent.group })
  }
  return [...units.values()]
}

/** A group's include value in the given form, from the model's rows. */
function modelKids(
  group: string,
  form: ChildForm,
  allChildren: ReadonlyMap<string, WindowChild>,
  grandchildren: ReadonlyMap<string, WindowGrandchild>,
  kept: ReadonlySet<string> | undefined,
): unknown {
  const children = new Map(
    [...allChildren].filter(([id]) => !kept || kept.has(id)),
  )
  const grandOf = (childId: string) =>
    [...grandchildren.values()]
      .filter((grandchild) => grandchild.childId === childId)
      .map((grandchild) => grandchild.id)
      .sort()
  const rows = [...children.values()].filter((child) => child.group === group)
  const byN = rows.sort((left, right) => right.n - left.n)
  if (form === `materialize` || form === `collection`) {
    return rows.map((child) => child.id).sort()
  }
  if (form === `nested`) {
    return rows
      .map((child) => ({ id: child.id, grand: grandOf(child.id) }))
      .sort((left, right) => left.id.localeCompare(right.id))
  }
  if (form === `limited-nested`) {
    return byN
      .slice(0, 2)
      .map((child) => ({ id: child.id, grand: grandOf(child.id) }))
  }
  if (form === `findOne`) return byN[0]?.id ?? null
  const ordered = byN.map((child) => child.id)
  return form === `limited` ? ordered.slice(0, 2) : ordered
}

/** The include value a shown row carries, in the model's representation. */
function observeKids(kids: unknown, form: ChildForm): unknown {
  if (form === `findOne`)
    return (kids as { id: string } | undefined)?.id ?? null
  const rows = [
    ...(form === `collection`
      ? (kids as { toArray: Array<ObservedKid> }).toArray
      : (kids as Iterable<ObservedKid>)),
  ]
  if (form === `nested` || form === `limited-nested`) {
    const withGrand = rows.map((row) => ({
      id: row.id,
      grand: [...(row.grand ?? [])].map((grandchild) => grandchild.id).sort(),
    }))
    return form === `nested`
      ? withGrand.sort((left, right) => left.id.localeCompare(right.id))
      : withGrand
  }
  const ids = rows.map((row) => row.id)
  return form === `materialize` || form === `collection` ? ids.sort() : ids
}

/**
 * An on-demand child source. Its provider serves each load from the model's
 * rows by the request's predicate, keeps a ledger of sent rows, and forwards
 * a later change only for a sent row or a row a served predicate matches.
 * `work` counts the rows its loads serve, not forwarded changes.
 */
function createOnDemandChildren(initial: Array<WindowChild>) {
  const truth = new Map(initial.map((child) => [child.id, child]))
  const sent = new Set<string>()
  const wheres: Array<LoadSubsetOptions[`where`]> = []
  let work = 0
  let controls:
    | {
        begin: () => void
        write: (message: {
          type: `insert` | `delete`
          value: WindowChild
        }) => void
        commit: () => unknown
      }
    | undefined
  const matches = (where: LoadSubsetOptions[`where`], row: WindowChild) =>
    where === undefined ||
    evaluateReferenceExpression(
      where as Parameters<typeof evaluateReferenceExpression>[0],
      row,
    ) === true
  const collection = createCollection<WindowChild, string>({
    id: `window-children-on-demand-${nextCollectionId++}`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    startSync: true,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        controls = { begin, write, commit }
        markReady()
        return {
          loadSubset: (options) => {
            wheres.push(options.where)
            const page = [...truth.values()].filter(
              (row) => !sent.has(row.id) && matches(options.where, row),
            )
            work += page.length
            if (page.length === 0) return true
            begin()
            for (const row of page) {
              sent.add(row.id)
              write({ type: `insert`, value: { ...row } })
            }
            commit()
            return true
          },
          unloadSubset: () => {},
        }
      },
    },
  })
  return {
    collection,
    work: () => work,
    change: (type: `insert` | `delete`, row: WindowChild) => {
      if (type === `insert`) truth.set(row.id, row)
      else truth.delete(row.id)
      const forward =
        type === `delete`
          ? sent.delete(row.id)
          : wheres.some((where) => matches(where, row))
      if (!forward) return
      if (type === `insert`) sent.add(row.id)
      controls!.begin()
      controls!.write({ type, value: row })
      controls!.commit()
    },
  }
}

/**
 * Runs one case and returns how many forward window moves its work bound
 * checked strictly, the reach a generated campaign must show.
 */
async function checkWindowedIncludeWork(testCase: WindowCase): Promise<number> {
  let strictForwardMoves = 0
  const parents = new Map<string, WindowParent>()
  const children = new Map<string, WindowChild>()
  const grandchildren = new Map<string, WindowGrandchild>()
  let nextRank = 0
  let nextChild = 0
  let nextGroup = testCase.groups
  const addChildren = (group: string, count: number) => {
    const added: Array<WindowChild> = []
    for (let index = 0; index < count; index++) {
      const child = { id: `child-${nextChild}`, group, n: nextChild++ }
      children.set(child.id, child)
      added.push(child)
      const grandchild = { id: `grand-${child.id}`, childId: child.id }
      grandchildren.set(grandchild.id, grandchild)
    }
    return added
  }
  for (let group = 0; group < testCase.groups; group++) {
    addChildren(`group-${group}`, testCase.childrenPerGroup)
  }
  for (let index = 0; index < testCase.parents; index++) {
    const parent = {
      id: `parent-${index}`,
      rank: (nextRank += 2),
      group: `group-${index % testCase.groups}`,
    }
    parents.set(parent.id, parent)
  }
  for (const [index, copy] of testCase.copies.entries()) {
    const source = [...parents.values()][copy.pick % parents.size]!
    const group = copy.group ? source.group : `group-${nextGroup++}`
    if (!copy.group) addChildren(group, testCase.childrenPerGroup)
    const parent = { id: `parent-copy-${index}`, rank: source.rank, group }
    parents.set(parent.id, parent)
  }
  const initialChildIds = [...children.keys()]
  const keptChildren = testCase.childFilter
    ? new Set(
        testCase.childFilter.map(
          (index) => initialChildIds[index % initialChildIds.length]!,
        ),
      )
    : undefined
  const filterGroups =
    testCase.parentFilter &&
    testCase.parentFilter.map((index) => `group-${index % testCase.groups}`)
  const keptParents = () =>
    [...parents.values()].filter(
      (parent) => !filterGroups || filterGroups.includes(parent.group),
    )

  const parentSource = createSourceCollection(`window-parents`, [
    ...parents.values(),
  ])
  const onDemand =
    testCase.childSource === `on-demand`
      ? createOnDemandChildren([...children.values()])
      : undefined
  const childSource = (onDemand?.collection ??
    createSourceCollection(`window-children`, [
      ...children.values(),
    ])) as unknown as Collection<WindowChild>
  const grandchildSource = createSourceCollection(`window-grandchildren`, [
    ...grandchildren.values(),
  ])
  let cleanupLive: (() => Promise<void>) | undefined
  let primary: { error: unknown } | undefined
  try {
    await Promise.all(
      [parentSource, grandchildSource, ...(onDemand ? [] : [childSource])].map(
        (source) => source.preload(),
      ),
    )
    parentSource.createIndex((row) => row.rank, { indexType: BTreeIndex })
    childSource.createIndex((row) => row.group, { indexType: BTreeIndex })
    grandchildSource.createIndex((row) => row.childId, {
      indexType: BTreeIndex,
    })
    const localChildWork = onDemand ? undefined : countSourceWork(childSource)
    const childWork = () => onDemand?.work() ?? localChildWork!().delivered
    const grandWork = countSourceWork(grandchildSource)
    // Change batches the parent Collection delivers to the query. More than
    // the step's own parent write (or, at preload, the initial load) means
    // the ordered loader acquired more rows: a refill or a tie load.
    let parentBatches = 0
    const subscribeParents = parentSource.subscribeChanges.bind(parentSource)
    parentSource.subscribeChanges = (callback, options) =>
      subscribeParents((changes) => {
        if (changes.length > 0) parentBatches++
        callback(changes)
      }, options)
    // A checkpoint's work bound, or none where the generated campaign
    // cannot bound a transient top-K row; a replay allows its overshoot.
    const workBound = (bound: number, loads: number) =>
      loads === 0
        ? bound
        : testCase.overshoot === undefined
          ? Number.POSITIVE_INFINITY
          : bound + testCase.overshoot
    const changeChild = async (type: `insert` | `delete`, row: WindowChild) => {
      if (onDemand) {
        onDemand.change(type, row)
        return
      }
      await (
        type === `insert` ? childSource.insert(row) : childSource.delete(row.id)
      ).when(`settled`)
    }

    const live = createLiveQueryCollection((q) => {
      const grandOf = (childId: unknown) =>
        materialize(
          q
            .from({ grandchild: grandchildSource })
            .where(({ grandchild }) => eq(grandchild.childId, childId))
            .select(({ grandchild }) => ({ id: grandchild.id })),
        )
      const kidsOf = (group: unknown) => {
        const inGroup = q
          .from({ child: childSource })
          .where(({ child }) => eq(child.group, group))
        const groupChildren = keptChildren
          ? inGroup.where(({ child }) =>
              keptChildren.size === 1
                ? eq(child.id, [...keptChildren][0])
                : inArray(child.id, [...keptChildren]),
            )
          : inGroup
        const byN = groupChildren.orderBy(({ child }) => child.n, `desc`)
        switch (testCase.childForm) {
          case `materialize`:
            return materialize(
              groupChildren.select(({ child }) => ({ id: child.id })),
            )
          case `collection`:
            return include(
              groupChildren.select(({ child }) => ({ id: child.id })),
            )
          case `nested`:
            return materialize(
              groupChildren.select(({ child }) => ({
                id: child.id,
                grand: grandOf(child.id),
              })),
            )
          case `limited-nested`:
            return toArray(
              byN.limit(2).select(({ child }) => ({
                id: child.id,
                grand: grandOf(child.id),
              })),
            )
          case `findOne`:
            return materialize(
              byN.select(({ child }) => ({ id: child.id })).findOne(),
            )
          case `limited`:
            return toArray(
              byN.limit(2).select(({ child }) => ({ id: child.id })),
            )
          case `ordered`:
            return toArray(byN.select(({ child }) => ({ id: child.id })))
        }
      }
      const parentRows = q.from({ parent: parentSource })
      const filtered = !filterGroups
        ? parentRows
        : parentRows.where(({ parent }) =>
            filterGroups.length === 1
              ? eq(parent.group, filterGroups[0])
              : inArray(parent.group, filterGroups),
          )
      const ordered = filtered.orderBy(
        ({ parent }) => parent.rank,
        testCase.direction,
      )
      const windowed =
        testCase.parentForm === `orderOnly`
          ? ordered
          : testCase.parentForm === `findOne`
            ? testCase.findOneOffset === false
              ? ordered
              : ordered.offset(testCase.offset)
            : ordered.offset(testCase.offset).limit(testCase.limit)
      const selected = testCase.distinct
        ? windowed
            .select(({ parent }) => ({
              rank: parent.rank,
              group: parent.group,
              kids: kidsOf(parent.group),
            }))
            .distinct()
        : windowed.select(({ parent }) => ({
            id: parent.id,
            rank: parent.rank,
            group: parent.group,
            kids: kidsOf(parent.group),
          }))
      return testCase.parentForm === `findOne`
        ? (selected.findOne() as unknown as typeof selected)
        : selected
    })
    cleanupLive = () => live.cleanup()

    let shown =
      testCase.parentForm === `orderOnly`
        ? { offset: 0, limit: Number.POSITIVE_INFINITY }
        : testCase.parentForm === `findOne`
          ? {
              offset: testCase.findOneOffset === false ? 0 : testCase.offset,
              limit: 1,
            }
          : { offset: testCase.offset, limit: testCase.limit }
    // A findOne's window keeps its compiled limit, 1, and setWindow may move
    // only its offset. A window requested before the live query starts
    // replaces the compiled one before its first load.
    const windowFor = (window: { offset: number; limit: number }) =>
      testCase.parentForm === `findOne` ? { offset: window.offset } : window
    const startWindow = testCase.startWindow
    const startSettled = startWindow
      ? live.utils.setWindow(windowFor(startWindow))
      : true
    if (startWindow) shown = { ...shown, ...windowFor(startWindow) }
    const sign = testCase.direction === `asc` ? 1 : -1
    const sortedUnits = () =>
      windowUnits(keptParents(), testCase.distinct).sort(
        (left, right) => sign * (left.rank - right.rank),
      )
    const shownRows = (): Array<ShownRow> =>
      (
        live.toArray as unknown as Array<{
          id?: string
          rank: number
          group: string
          kids: unknown
        }>
      ).map((row) => ({
        key: testCase.distinct ? `${row.rank}|${row.group}` : row.id!,
        rank: row.rank,
        group: row.group,
        kids: observeKids(row.kids, testCase.childForm),
      }))
    const expectWindow = (label: string): Array<ShownRow> => {
      const units = sortedUnits()
      const actual = shownRows()
      oracleAssertion('includes work-counter-oracle comparison 854', () =>
        expect(
          actual.map((row) => row.rank),
          `${label}: ranks`,
        ).toEqual(
          units
            .slice(shown.offset, shown.offset + shown.limit)
            .map((unit) => unit.rank),
        ),
      )
      const byKey = new Map(units.map((unit) => [unit.key, unit]))
      for (const row of actual) {
        const unit = byKey.get(row.key)
        oracleAssertion('includes work-counter-oracle comparison 865', () =>
          expect(unit, `${label}: ${row.key} is a unit`).toBeDefined(),
        )
        oracleAssertion('includes work-counter-oracle comparison 866', () =>
          expect([row.rank, row.group], `${label}: ${row.key}`).toEqual([
            unit!.rank,
            unit!.group,
          ]),
        )
        oracleAssertion('includes work-counter-oracle comparison 870', () =>
          expect(row.kids, `${label}: ${row.key} include`).toEqual(
            modelKids(
              row.group,
              testCase.childForm,
              children,
              grandchildren,
              keptChildren,
            ),
          ),
        )
      }
      oracleAssertion('includes work-counter-oracle comparison 880', () =>
        expect(
          new Set(actual.map((row) => row.key)).size,
          `${label}: distinct rows`,
        ).toBe(actual.length),
      )
      return actual
    }
    const childrenOf = (rows: Iterable<ShownRow>) => {
      const groups = new Set([...rows].map((row) => row.group))
      return [...children.values()].filter((child) => groups.has(child.group))
        .length
    }
    // Children whose grandchildren an include shows, by id.
    const shownKids = (rows: Iterable<ShownRow>) =>
      new Set(
        [...rows].flatMap((row) =>
          testCase.childForm === `nested` ||
          testCase.childForm === `limited-nested`
            ? (row.kids as Array<{ id: string }>).map((kid) => kid.id)
            : [],
        ),
      )
    const grandchildrenOf = (kids: ReadonlySet<string>) =>
      [...grandchildren.values()].filter((grandchild) =>
        kids.has(grandchild.childId),
      ).length

    await live.preload()
    if (startSettled !== true) await startSettled
    await new Promise((resolve) => setTimeout(resolve, 0))
    let before = expectWindow(`rows after preload`)
    oracleAssertion('includes work-counter-oracle comparison 910', () =>
      expect(live.utils.getWindow(), `window after preload`).toEqual(shown),
    )
    const preloadLoads = Math.max(0, parentBatches - 1)
    oracleAssertion('includes work-counter-oracle comparison 912', () =>
      expect(childWork(), `child rows loaded by preload`).toBeLessThanOrEqual(
        workBound(childrenOf(before), preloadLoads),
      ),
    )
    oracleAssertion('includes work-counter-oracle comparison 915', () =>
      expect(
        grandWork().delivered,
        `grandchild rows loaded by preload`,
      ).toBeLessThanOrEqual(
        workBound(grandchildrenOf(shownKids(before)), preloadLoads),
      ),
    )

    let windowBefore: { offset: number; limit: number } | undefined
    for (const [step, command] of testCase.history.entries()) {
      windowBefore = undefined
      const childBefore = childWork()
      const grandBefore = grandWork().delivered
      const batchesBefore = parentBatches
      const ids = [...parents.keys()]
      const childIds = [...children.keys()]
      if (command.type === `insert-parent`) {
        const source =
          command.copy === null || ids.length === 0
            ? undefined
            : parents.get(ids[command.copy % ids.length]!)!
        const group = source?.group ?? `group-${nextGroup++}`
        if (!source) {
          const added = addChildren(group, testCase.childrenPerGroup)
          for (const child of added) await changeChild(`insert`, child)
          await grandchildSource
            .insert(
              added.map((child) => grandchildren.get(`grand-${child.id}`)!),
            )
            .when(`settled`)
        }
        const parent = {
          id: `parent-new-${step}`,
          rank: source?.rank ?? (nextRank += 2) - 1,
          group,
        }
        parents.set(parent.id, parent)
        await parentSource.insert(parent).when(`settled`)
      } else if (command.type === `delete-parent`) {
        if (ids.length === 0) continue
        const id = ids[command.pick % ids.length]!
        parents.delete(id)
        await parentSource.delete(id).when(`settled`)
      } else if (command.type === `rank`) {
        if (ids.length === 0) continue
        const id = ids[command.pick % ids.length]!
        // Move the parent past every other rank, so it crosses the window.
        const ranks = [...parents.values()].map((parent) => parent.rank)
        const rank = command.up
          ? Math.max(...ranks) + 1
          : Math.min(...ranks) - 1
        parents.set(id, { ...parents.get(id)!, rank })
        await parentSource
          .update(id, (draft) => {
            draft.rank = rank
          })
          .when(`settled`)
      } else if (command.type === `insert-child`) {
        const groups = [...new Set([...parents.values()].map((p) => p.group))]
        if (groups.length === 0) continue
        const child = {
          id: `child-${nextChild}`,
          group: groups[command.pick % groups.length]!,
          n: nextChild++,
        }
        children.set(child.id, child)
        await changeChild(`insert`, child)
      } else if (command.type === `delete-child`) {
        if (childIds.length === 0) continue
        const child = children.get(childIds[command.pick % childIds.length]!)!
        children.delete(child.id)
        await changeChild(`delete`, child)
      } else {
        windowBefore = shown
        const requested = windowFor({
          offset: command.offset,
          limit: command.limit,
        })
        shown = { ...shown, ...requested }
        const settled = live.utils.setWindow(requested)
        if (settled !== true) await settled
      }
      await new Promise((resolve) => setTimeout(resolve, 0))
      const after = expectWindow(`rows after step ${step}`)
      oracleAssertion('includes work-counter-oracle comparison 998', () =>
        expect(live.utils.getWindow(), `window after step ${step}`).toEqual(
          shown,
        ),
      )
      const beforeKeys = new Set(before.map((row) => row.key))
      const shownGroups = new Set(before.map((row) => row.group))
      // A step may newly load only the groups of rows that entered the
      // window and were not shown before it.
      const loadable = new Set(
        after
          .filter((row) => !beforeKeys.has(row.key))
          .map((row) => row.group)
          .filter((group) => !shownGroups.has(group)),
      )
      const kidsBefore = shownKids(before)
      const kidsEntered = new Set(
        [...shownKids(after)].filter((kid) => !kidsBefore.has(kid)),
      )
      const parentWrite =
        command.type === `insert-parent` ||
        command.type === `delete-parent` ||
        command.type === `rank`
          ? 1
          : 0
      const stepLoads = Math.max(0, parentBatches - batchesBefore - parentWrite)
      if (
        command.type === `move` &&
        command.offset > (windowBefore?.offset ?? 0) &&
        (stepLoads === 0 || testCase.overshoot === 0)
      ) {
        strictForwardMoves++
      }
      // Child rows the step writes reach a local subscription whether or not
      // their group is loaded, so each counts once: a fresh parent's group,
      // or one inserted or deleted child.
      // The grandchild source is always local; a fresh group writes one
      // grandchild per child.
      const freshGroup =
        command.type === `insert-parent` && command.copy === null
          ? testCase.childrenPerGroup
          : 0
      const written = onDemand
        ? 0
        : command.type === `insert-child` || command.type === `delete-child`
          ? 1
          : freshGroup
      oracleAssertion('includes work-counter-oracle comparison 1041', () =>
        expect(
          childWork() - childBefore,
          `child rows loaded by step ${step}`,
        ).toBeLessThanOrEqual(
          workBound(
            [...children.values()].filter((child) => loadable.has(child.group))
              .length + written,
            stepLoads,
          ),
        ),
      )
      oracleAssertion('includes work-counter-oracle comparison 1051', () =>
        expect(
          grandWork().delivered - grandBefore,
          `grandchild rows loaded by step ${step}`,
        ).toBeLessThanOrEqual(
          workBound(grandchildrenOf(kidsEntered) + freshGroup, stepLoads),
        ),
      )
      before = after
    }
    return strictForwardMoves
  } catch (error) {
    primary = { error }
    throw error
  } finally {
    await runCleanups(
      [
        async () => cleanupLive?.(),
        async () => parentSource.cleanup(),
        async () => childSource.cleanup(),
        async () => grandchildSource.cleanup(),
      ],
      primary,
    )
  }
}

// The parts this file declares. The windowed check runs each history through
// the window model and compares the shown rows with it. The three metamorphic
// checks compare each scaled fixture with its minimal baseline run. The grammar
// is the windowed history generator, which the reconstruction test samples.
/** A fixed history: its strict forward-move tally is not reach evidence. */
async function expectWindowedIncludeWork(testCase: WindowCase): Promise<void> {
  await checkWindowedIncludeWork(testCase)
}

const fixedWindowCase: WindowCase = {
  parents: 8,
  groups: 8,
  copies: [],
  childrenPerGroup: 2,
  childForm: `materialize`,
  childSource: `local`,
  parentForm: `page`,
  parentFilter: null,
  direction: `asc`,
  distinct: false,
  offset: 0,
  limit: 2,
  history: [],
}

// The fixed parent-window histories, each replayed through the shared window
// check. Their strict forward-move tally is not reach evidence.
const windowFixedHistories: Array<{ name: string; testCase: WindowCase }> = [
  ...[false, true].map((distinct) => ({
    name: `loads children only for a late page's parents (distinct=${distinct})`,
    testCase: {
      ...fixedWindowCase,
      parents: 40,
      groups: 40,
      childrenPerGroup: 3,
      direction: `desc`,
      distinct,
      offset: 20,
      history: [{ type: `move`, offset: 10, limit: 3 }],
    },
  })),
  ...([`ordered`, `limited`, `limited-nested`] as const).map((childForm) => ({
    name: `moves the parent window, not the ${childForm} child's`,
    testCase: {
      ...fixedWindowCase,
      childForm,
      history: [{ type: `move`, offset: 3, limit: 2 }],
    },
  })),
  {
    name: `collapses parents whose selected values match under distinct`,
    testCase: {
      ...fixedWindowCase,
      copies: [
        { pick: 1, group: true },
        { pick: 2, group: false },
      ],
      distinct: true,
      limit: 3,
      history: [{ type: `insert-parent`, copy: 3 }],
    },
  },
  {
    name: `creates no static child demand from a static parent filter`,
    testCase: {
      ...fixedWindowCase,
      childSource: `on-demand`,
      parentFilter: [0, 1, 2, 3, 4],
      offset: 3,
      limit: 1,
    },
  },
  // On demand, a group's children arrive only through a load, so a fresh
  // parent past the narrowed window must not load them.
  {
    name: `stops routing rows that setWindow drops from an orderBy-only parent`,
    testCase: {
      ...fixedWindowCase,
      childrenPerGroup: 3,
      childSource: `on-demand`,
      parentForm: `orderOnly`,
      history: [
        { type: `move`, offset: 0, limit: 2 },
        { type: `insert-parent`, copy: null },
      ],
    },
  },
  {
    name: `loads one page of children for a findOne parent`,
    testCase: {
      ...fixedWindowCase,
      childForm: `findOne`,
      parentForm: `findOne`,
      offset: 5,
    },
  },
  // A window requested before start can drop rows a static filter names,
  // so static child demand must not load their children.
  {
    name: `creates no static child demand under a window requested before start`,
    testCase: {
      ...fixedWindowCase,
      childForm: `ordered`,
      childSource: `on-demand`,
      parentForm: `orderOnly`,
      parentFilter: [0, 1, 2, 3, 4, 5],
      startWindow: { offset: 0, limit: 1 },
    },
  },
  // A child's static filter names a child whose parent the window drops, so
  // its grandchild demand must wait for the window too.
  {
    name: `creates no static grandchild demand below a windowed parent`,
    testCase: {
      ...fixedWindowCase,
      parents: 10,
      groups: 10,
      childrenPerGroup: 1,
      childForm: `nested`,
      limit: 1,
      childFilter: [5],
    },
  },
  // A window requested before start that moves a findOne past its one named
  // correlation value drops that row, so its children must not load; one at
  // offset 0 drops nothing, so its static demand still starts at once.
  {
    name: `creates no static child demand for a findOne moved past its named value before start`,
    testCase: {
      ...fixedWindowCase,
      parents: 21,
      groups: 11,
      childrenPerGroup: 1,
      parentForm: `findOne`,
      findOneOffset: false,
      parentFilter: [10],
      startWindow: { offset: 1, limit: 1 },
    },
  },
  // Forward moves load more parent rows, so the generated campaigns cannot
  // check them strictly; these do, with no overshoot allowed.
  ...(
    [
      [`local`, false],
      [`local`, true],
      [`on-demand`, false],
      [`on-demand`, true],
    ] as const
  ).map(([childSource, distinct]) => ({
    name: `moves the window forward strictly (${childSource} children, distinct=${distinct})`,
    testCase: {
      ...fixedWindowCase,
      parents: 40,
      groups: 40,
      childrenPerGroup: 2,
      childSource,
      distinct,
      history: [
        { type: `move`, offset: 20, limit: 2 },
        { type: `move`, offset: 30, limit: 2 },
      ],
      overshoot: 0,
    },
  })),
]

const orderedWindowLaw = `A parent window bounds child loading: only the rows the window shows activate routes and create child demand.`

describe(`includes work under an ordered parent window`, () => {
  // Replays of transient top-K rows (#2151). Each shows the correct
  // rows and loads one child row beyond the bound, at a checkpoint where the
  // parent's ordered acquisition had not completed: a held row moved past every
  // other rank, a tie loaded at the window edge during preload, and a window
  // move while the loader refills. A larger overshoot fails.
  const transient: Array<[string, WindowCase]> = [
    [
      `a desc held row moved to the lowest rank`,
      {
        ...fixedWindowCase,
        parents: 24,
        groups: 12,
        childrenPerGroup: 1,
        direction: `desc`,
        offset: 1,
        limit: 1,
        history: [{ type: `rank`, pick: 1_257_390_839, up: false }],
      },
    ],
    [
      `an asc held row moved to the highest rank`,
      {
        ...fixedWindowCase,
        parents: 36,
        groups: 18,
        childrenPerGroup: 1,
        offset: 1,
        limit: 1,
        history: [{ type: `rank`, pick: 0, up: true }],
      },
    ],
    [
      `a tie at the window edge during preload (late page)`,
      {
        ...fixedWindowCase,
        parents: 38,
        groups: 19,
        copies: [{ pick: 735_689_178, group: false }],
        childrenPerGroup: 1,
        direction: `desc`,
        offset: 17,
        limit: 1,
      },
    ],
    [
      `ties at the window edge during preload (two rows)`,
      {
        ...fixedWindowCase,
        parents: 33,
        groups: 17,
        copies: [
          { pick: 0, group: false },
          { pick: 0, group: false },
          { pick: 0, group: false },
          { pick: 1_163_054_548, group: false },
        ],
        childrenPerGroup: 1,
        direction: `desc`,
        offset: 3,
        limit: 2,
      },
    ],
    [
      `ties at the window edge during preload (first row)`,
      {
        ...fixedWindowCase,
        parents: 11,
        groups: 6,
        copies: [
          { pick: 0, group: false },
          { pick: 0, group: false },
          { pick: 1_080_707_742, group: false },
        ],
        childrenPerGroup: 1,
        direction: `desc`,
        offset: 0,
        limit: 1,
      },
    ],
    [
      `a window move while the loader refills`,
      {
        ...fixedWindowCase,
        parents: 33,
        groups: 17,
        childrenPerGroup: 1,
        offset: 1,
        limit: 2,
        history: [
          { type: `rank`, pick: 29_374_524, up: false },
          { type: `insert-parent`, copy: 5 },
          { type: `move`, offset: 4, limit: 1 },
        ],
      },
    ],
  ]

  oracleProperty({
    id: `includes-work.ordered-window-fixed`,
    law: {
      statement: orderedWindowLaw,
      authority: `Law 12 (work) and the physical planning and work contract in packages/db/src/query/live/ARCHITECTURE.md, stated at the start of this owner.`,
      limits: `The named fixed parent-window histories, including strict forward moves that the generated campaign cannot check strictly.`,
    },
    owns: [
      `src/collection/index.ts#createCollection`,
      `src/indexes/btree-index.ts`,
      `src/local-only.ts#localOnlyCollectionOptions`,
      `src/query/live-query-collection.ts#createLiveQueryCollection`,
    ],
    histories: windowFixedHistories,
    label: ({ name }) => name,
    resolve: (history) => ({ ...history }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(orderedWindowLaw, plan, observe, () =>
        expectWindowedIncludeWork(plan.testCase),
      ),
    check: forwardAssertionJudgment,
  })

  oracleProperty({
    id: `includes-work.transient-top-k`,
    law: {
      statement: orderedWindowLaw,
      authority: `Law 12 (work) and the physical planning and work contract in packages/db/src/query/live/ARCHITECTURE.md, stated at the start of this owner.`,
      limits: `The six replays of transient top-K rows (a recorded limit, #2151), each allowed one extra loaded child row, and their zero-overshoot calibrations.`,
    },
    owns: [
      `src/collection/index.ts#createCollection`,
      `src/indexes/btree-index.ts`,
      `src/local-only.ts#localOnlyCollectionOptions`,
      `src/query/live-query-collection.ts#createLiveQueryCollection`,
    ],
    histories: transient.map(([name, testCase]) => ({ name, testCase })),
    label: ({ name }) => `bounds a transient top-K row: ${name}`,
    resolve: (history) => ({ ...history }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(orderedWindowLaw, plan, observe, () =>
        expectWindowedIncludeWork({ ...plan.testCase, overshoot: 1 }),
      ),
    check: forwardAssertionJudgment,
    calibrations: transient.map(([name]) => ({
      name: `reaches a transient top-K row: ${name}`,
      law: orderedWindowLaw,
      // The former calibration body: the same replay fails when no overshoot is
      // allowed, so it reaches a transient row and the loader-activity
      // observation sees it. It applies to its own replay only; on another
      // replay it reports no rejection, so the framework tries the next one.
      // Exactly the old matcher: only a rejection whose message names the
      // loaded child rows counts; any other failure is rethrown without the
      // shared check's marking and fails this calibration.
      driver: (plan, observe) =>
        recordAssertionJudgment(orderedWindowLaw, plan, observe, async () => {
          if (plan.name !== name) return
          try {
            await checkWindowedIncludeWork({ ...plan.testCase, overshoot: 0 })
          } catch (error) {
            if (
              error instanceof Error &&
              /child rows loaded by/.test(error.message)
            )
              rejectAt(`transient top-K ${name}`, error)
            throw new Error(
              `the zero-overshoot replay failed outside the expected rejection: ${String(error)}`,
            )
          }
        }),
    })),
  })

  for (const campaign of campaigns(
    2137,
    `includes-work.ordered-window`,
    WINDOW_RUNS,
  )) {
    // Reach witness: the campaign's own runs must check some forward
    // window moves strictly. A failing run throws before the tally is read,
    // so shrinking never counts.
    ;(() => {
      let strictForwardMoves = 0
      registerIncludesProperty(
        [windowCase],
        {
          ...campaign.options,
          owns: [
            `src/collection/index.ts#createCollection`,
            `src/indexes/btree-index.ts`,
            `src/local-only.ts#localOnlyCollectionOptions`,
            `src/query/live-query-collection.ts#createLiveQueryCollection`,
          ],
          beforeCampaign: () => {
            strictForwardMoves = 0
          },
          afterCampaign: () => {
            oracleAssertion(
              'includes work-counter-oracle comparison 1453',
              () =>
                expect(
                  strictForwardMoves,
                  `strictly checked forward moves`,
                ).toBeGreaterThan(0),
            )
          },
        },
        `a parent window bounds child loading (${campaign.name})`,
        async (testCase) => {
          strictForwardMoves += await checkWindowedIncludeWork(testCase)
        },
        oracleRuns(WINDOW_RUNS) * 100,
      )
    })()
  }
})

/**
 * # Can an ordinary projection carry a large source payload without scanning it?
 *
 * Maintainer request (2026-11-05, issue 2355): restore nested-row performance
 * and the boundary-only metadata decision: ordinary source payload containers
 * stay opaque to compiler metadata discovery, including correlated queries.
 * Result finalization and callback sanitation therefore owe zero descriptor
 * scans of those containers. This is a work budget, not a latency guarantee.
 * The neighboring route-context and virtual-row-input owners retain the laws
 * for private routes, authored values and published metadata attribution.
 *
 * The grammar crosses source, join, QueryRef and union boundaries with explicit,
 * implicit and functional selections, and zero through forty document blocks.
 * Every history checks initial hydration and two full synced replacements. A
 * model reconstructs the expected document from block count and tick, without
 * retaining the document passed to production. A shared checker compares that
 * value and the separate promise that the source document keeps its identity.
 * Descriptor observations count only source payloads, excluding authored output
 * wrappers. They do not measure hashing, user callbacks or adapter work.
 */
const payloadBoundaries = [
  `source`,
  `join`,
  `query-ref`,
  `union`,
  `implicit`,
  `functional`,
  `predicate`,
  `query-ref-where`,
  `query-ref-having`,
  `correlated-inline`,
  `correlated-callback`,
  `correlated-implicit`,
  `correlated-collection`,
  `correlated-group`,
] as const

async function expectPayloadWork(blockCount: number): Promise<void> {
  const reach = requiredIncludesObservations(
    `projection-payload`,
    payloadBoundaries,
  )
  const failures: Array<unknown> = []
  for (const boundary of payloadBoundaries) {
    reach.beginHistory()
    const payloads = new WeakSet<object>()
    const makeDocument = (tick: number) => {
      const blocks = Array.from({ length: blockCount }, (_, id) => {
        const attrs = { indent: id % 3, tick }
        const block = { id, text: `block ${id} at ${tick}`, attrs }
        payloads.add(attrs)
        payloads.add(block)
        return block
      })
      const document = { blocks, tick }
      payloads.add(blocks)
      payloads.add(document)
      return document
    }
    let document = makeDocument(0)
    const source = createControlledCollection(`payload-source`, [
      { id: 1, document },
    ])
    const joined = createControlledCollection(`payload-peer`, [{ id: 1 }])
    const live = createLiveQueryCollection((q) => {
      const rows = q.from({ row: source.collection })
      const childValue = <TContext extends Context>(
        query: QueryBuilder<TContext>,
      ) =>
        boundary === `correlated-collection` ? include(query) : toArray(query)
      switch (boundary) {
        case `source`:
          return rows.select(({ row }) => ({
            id: row.id,
            document: row.document,
          }))
        case `join`:
          return rows
            .join({ peer: joined.collection }, ({ row, peer }) =>
              eq(row.id, peer.id),
            )
            .select(({ row }) => ({ id: row.id, document: row.document }))
        case `query-ref`:
          return q
            .from({
              projected: rows.select(({ row }) => ({
                id: row.id,
                document: row.document,
              })),
            })
            .select(({ projected }) => ({
              id: projected.id,
              document: projected.document,
            }))
        case `union`:
          return q.unionAll(
            rows.select(({ row }) => ({ id: row.id, document: row.document })),
            q
              .from({ other: source.collection })
              .where(({ other }) => eq(other.id, 0))
              .select(({ other }) => ({
                id: other.id,
                document: other.document,
              })),
          )
        case `implicit`:
          return rows
        case `functional`:
          return rows.fn.select(({ row }) => ({
            id: row.id,
            document: row.document,
          }))
        case `query-ref-where`:
        case `query-ref-having`: {
          const projected = rows.select(({ row }) => ({
            id: row.id,
            document: row.document,
            $collectionId: `application`,
          }))
          const outer = q.from({ item: projected })
          const filtered =
            boundary === `query-ref-where`
              ? outer.fn.where(({ item }) => item.id === 1)
              : outer.fn.having(({ item }) => item.id === 1)
          return filtered.select(({ item }) => ({
            id: item.id,
            document: item.document,
          }))
        }
        case `correlated-inline`:
        case `correlated-callback`:
        case `correlated-implicit`:
        case `correlated-collection`:
        case `correlated-group`:
          return q.from({ parent: joined.collection }).select(({ parent }) => {
            const children = new Query()
              .from({ child: source.collection })
              .where(({ child }) => eq(child.id, parent.id))
            const selected =
              boundary === `correlated-group`
                ? childValue(
                    children
                      .groupBy(
                        groupKeys(({ child }) => [child.id, child.document]),
                      )
                      .fn.having(() => true)
                      .select(({ child }) => ({
                        id: child.id,
                        document: child.document,
                      })),
                  )
                : boundary === `correlated-implicit`
                  ? childValue(children)
                  : boundary === `correlated-callback`
                    ? childValue(
                        new Query()
                          .from({
                            item: new Query()
                              .from({ raw: source.collection })
                              .select(({ raw }) => ({
                                id: raw.id,
                                document: raw.document,
                                $collectionId: `application`,
                              })),
                          })
                          .where(({ item }) => eq(item.id, parent.id))
                          .fn.select(({ item }) => ({
                            id: item.id,
                            document: item.document,
                          })),
                      )
                    : childValue(
                        children.select(({ child }) => ({
                          id: child.id,
                          document: child.document,
                        })),
                      )
            return {
              id: parent.id,
              kids: selected,
            }
          })
        case `predicate`:
          return rows.fn
            .where(({ row }) => row.id === 1)
            .fn.having(({ row }) => row.id === 1)
            .select(({ row }) => ({ id: row.id, document: row.document }))
      }
    })
    let scans = 0
    const getDescriptor = Object.getOwnPropertyDescriptor
    const singularSpy = vi
      .spyOn(Object, `getOwnPropertyDescriptor`)
      .mockImplementation((value, key) => {
        if (typeof value === `object` && value !== null && payloads.has(value))
          scans++
        return getDescriptor(value, key)
      })
    const getDescriptors = Object.getOwnPropertyDescriptors
    const spy = vi
      .spyOn(Object, `getOwnPropertyDescriptors`)
      .mockImplementation((value) => {
        if (typeof value === `object` && value !== null && payloads.has(value))
          scans++
        return getDescriptors(value)
      })
    let primaryFailure: unknown = noPrimaryFailure
    try {
      await live.preload()
      for (const tick of [0, 1, 2]) {
        if (tick > 0) {
          document = makeDocument(tick)
          source.write(`update`, { id: 1, document })
        }
        // The document has no compiler-owned state. Whole-value equality and
        // reference identity remain meaningful at the public Collection cut.
        const observed = (
          boundary.startsWith(`correlated`)
            ? live.toArray.flatMap((row) => {
                const kids = (
                  row as unknown as {
                    kids:
                      | Array<{ id: number; document: unknown }>
                      | { toArray: Array<{ id: number; document: unknown }> }
                  }
                ).kids
                return Array.isArray(kids) ? kids : kids.toArray
              })
            : live.toArray
        ) as ReadonlyArray<{ id: number; document: unknown }>
        if (tick === 0 && observed.length === 1) reach.reach(boundary)
        expectPayloadValue(observed, document, blockCount, tick)
        oracleAssertion('includes work-counter-oracle comparison 1733', () =>
          expect(
            scans,
            `${boundary}: source payload descriptor scans at tick ${tick}`,
          ).toBe(0),
        )
      }
    } catch (error) {
      primaryFailure = error
      failures.push(error)
    } finally {
      spy.mockRestore()
      singularSpy.mockRestore()
      await cleanupAfterOracle(primaryFailure, [
        () => live.cleanup(),
        () => source.collection.cleanup(),
        () => joined.collection.cleanup(),
      ])
    }
  }
  reach.assertReached()
  if (failures.length)
    throw new AggregateError(
      failures,
      `payload work: ${failures.map(String).join(`; `)}`,
    )
}

const payloadProperty = `includes-work.projection-payload`

registerIncludesProperty(
  [fc.integer({ min: 0, max: 40 })],
  {
    property: payloadProperty,
    runs: 8,
    fixedSeed: 2355,
    examples: payloadExamples,
    owns: [
      `src/collection/index.ts#createCollection`,
      `src/indexes/btree-index.ts`,
      `src/local-only.ts#localOnlyCollectionOptions`,
      `src/query/live-query-collection.ts#createLiveQueryCollection`,
    ],
  },
  `nested source payloads need no metadata descriptor scans (fixed and random)`,
  (blockCount) => {
    // The options are built when the file loads, so each run registers its
    // campaign's route.
    return expectPayloadWork(blockCount)
  },
)

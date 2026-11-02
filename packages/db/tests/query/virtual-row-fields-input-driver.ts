/**
 * Production receiver for the callback-input oracle. Callbacks copy their facts
 * immediately, including missing versus own undefined. At an action, D2 may
 * invoke a callback for old-row retractions as well as new-row contributions;
 * the check permits those two independently authored states. Startup LEFT joins
 * may expose an absent joined side. Established output cuts require both rows.
 * No callback count, ordering, or fully matched startup snapshot is promised.
 */
import { inspect, isDeepStrictEqual } from 'node:util'
import { D2, MultiSet, output } from '@tanstack/db-ivm'
import { createCollection } from '../../src/collection/index.js'
import {
  Query,
  compileQuery,
  createLiveQueryCollection,
  eq,
  include,
  materialize,
  toArray,
} from '../../src/query/index.js'
import { createEffect } from '../../src/query/effect.js'
import { getQueryIR } from '../../src/query/builder/index.js'
import { PropRef, QueryRef, UnionAll } from '../../src/query/ir.js'
import {
  flushPromises,
  mockSyncCollectionOptions,
  withOracleCleanup,
} from '../utils.js'
import { virtualFieldNames } from './virtual-row-fields-support.js'
import {
  authoredMetadataCollision,
  expectedMetadataInput,
  expectedMetadataRecord,
  metadataInputViolations,
  metadataOutputViolations,
} from './virtual-row-fields-input-oracle.js'
import type { Collection } from '../../src/collection/index.js'
import type { QueryBuilder } from '../../src/query/builder/index.js'
import type { RefLeaf } from '../../src/query/builder/types.js'
import type { QueryCache } from '../../src/query/compiler/types.js'
import type { QueryIR } from '../../src/query/ir.js'
import type {
  MetadataCallbackKind,
  MetadataCallbackPath,
  MetadataCompilerCachePath,
  MetadataInputDescription,
  MetadataInputRow,
  MetadataInputSnapshot,
  MetadataSourceFact,
} from './virtual-row-fields-input-oracle.js'

type Output = { id: string | number; observed: MetadataInputSnapshot }
type OutputContext = {
  schema: {}
  baseSchema: {}
  fromSourceName: string
  result: Output
  hasResult: true
}
type ProjectionContext = {
  schema: {}
  baseSchema: {}
  fromSourceName: string
  result: MetadataInputRow
  hasResult: true
}
export type CallbackInputCut =
  | `initial`
  | `held`
  | `settled`
  | `remote-next-use`
  | `exit`
  | `reentry`
  | `disposed`
export type CallbackInputReport = {
  violations: Array<{
    cut: CallbackInputCut
    kind: string
    actual: unknown
    expected: unknown
  }>
  callbackCounts: Record<CallbackInputCut, number>
}

// Throw only after every cut. Keeping the full report on the primary failure
// lets withOracleCleanup preserve it if resource release also fails.
class MetadataCallbackOracleFailure extends Error {
  constructor(readonly report: CallbackInputReport) {
    super(
      `Callback-input law: ${inspect(report.violations[0], { depth: null })}`,
    )
    this.name = `MetadataCallbackOracleFailure`
  }
}

function copyData(value: unknown): unknown {
  if (Array.isArray(value)) {
    const copy = value.map(copyData)
    // Array.map retains indices and holes but omits named own fields. Keep
    // those fields too, so capture cannot erase a wrong inline array shape.
    for (const key of Object.getOwnPropertyNames(value)) {
      if (Object.hasOwn(copy, key)) continue
      Object.defineProperty(copy, key, {
        value: copyData(Reflect.get(value, key)),
        enumerable: true,
        configurable: true,
        writable: true,
      })
    }
    return copy
  }
  if (value && typeof value === `object`)
    return Object.fromEntries(
      Object.getOwnPropertyNames(value).map((key) => [
        key,
        copyData((value as Record<string, unknown>)[key]),
      ]),
    )
  return value
}
// This recorder reads the actual public callback value. Its expected counterpart
// is authored from source facts and projection syntax in the oracle module.
// Top-level reserved fields are read through their public properties; nested
// inline records retain exact selected own-field shape through copyData.
export function captureMetadataInput(value: unknown): MetadataInputSnapshot {
  const record =
    value !== null && typeof value === `object`
      ? (value as Record<string, unknown>)
      : undefined
  return {
    present: record !== undefined,
    ordinary: Object.fromEntries(
      Object.getOwnPropertyNames(record ?? {})
        .filter((key) => !virtualFieldNames.some((field) => field === key))
        .map((key) => [key, copyData(record![key])]),
    ),
    fields: Object.fromEntries(
      virtualFieldNames.map((field) => [
        field,
        {
          present: record !== undefined && field in record,
          own: record !== undefined && Object.hasOwn(record, field),
          value: copyData(record?.[field]),
        },
      ]),
    ),
  }
}

function projectInput(
  collection: Collection<MetadataInputRow>,
  alias: string,
  description: MetadataInputDescription,
  parentGroup?: RefLeaf<string>,
) {
  const all = new Query().from({ [alias]: collection })
  const base =
    parentGroup === undefined
      ? all
      : all.where((refs) => eq(refs[alias]!.parentId, parentGroup))
  const overrides = authoredMetadataCollision(description)
  const shape = description.shape
  const selected =
    shape === `functional-direct`
      ? base.fn.select((refs) => refs[alias]!)
      : shape === `functional-spread`
        ? base.fn.select((refs) => ({ ...refs[alias]!, ...overrides }))
        : shape === `functional-projection`
          ? base.fn.select((refs) => ({
              id: refs[alias]!.id,
              label: refs[alias]!.label,
              optional: undefined,
              ...overrides,
            }))
          : shape === `structured-spread`
            ? base.select((refs) => ({ ...refs[alias]!, ...overrides }))
            : base.select((refs) => ({
                id: refs[alias]!.id,
                label: refs[alias]!.label,
                hasPendingWrites: refs[alias]!.$hasPendingWrites,
                ...overrides,
              }))
  // Context erasure changes only TS's union of authoring forms. The production
  // query and exact runtime fields remain checked, without casting observations.
  return selected as unknown as QueryBuilder<ProjectionContext>
}
function freshRows(): Array<MetadataInputRow> {
  return [
    { id: 1, parentId: `group`, label: `number-before`, optional: undefined },
    { id: `1`, parentId: `group`, label: `string-before`, optional: undefined },
  ]
}
function source(name: string, rows: ReadonlyArray<MetadataInputRow>) {
  return createCollection(
    mockSyncCollectionOptions<MetadataInputRow>({
      id: name,
      getKey: (row) => row.id,
      initialData: rows.map((row) => ({ ...row })),
    }),
  )
}
function outputRows(rows: ReadonlyArray<object>): Array<Output> {
  return rows.map(
    (row) =>
      Object.fromEntries(
        Object.entries(row).filter(
          ([key]) => !virtualFieldNames.some((field) => field === key),
        ),
      ) as Output,
  )
}
function rowsFromSnapshots(
  snapshots: ReadonlyArray<MetadataInputSnapshot>,
): Array<object> {
  return snapshots.map((snapshot) => ({
    ...snapshot.ordinary,
    ...Object.fromEntries(
      Object.entries(snapshot.fields)
        .filter(([, field]) => field.present)
        .map(([name, field]) => [name, field.value]),
    ),
  }))
}

/** Every history uses actual source writes and a real held mutation handler.
 * Comparisons accumulate so a known initial RED cannot hide later reach. */
export async function runMetadataCallbackHistory(
  description: MetadataInputDescription,
  path: MetadataCallbackPath | `direct-source`,
  reached: (cut: CallbackInputCut) => void,
  receiver: `root` | `inline-child` | `inline-child-direct` | `effect` = `root`,
  callbackKind: MetadataCallbackKind = `select`,
): Promise<CallbackInputReport> {
  const initial = freshRows()
  const union = path.startsWith(`union`)
  const first = source(`callback-first`, union ? [initial[0]!] : initial)
  const second = source(`callback-second`, [initial[1]!])
  const peers = source(`callback-peer`, initial)
  const containingParents = source(`callback-containing-parent`, initial)
  let facts: Array<MetadataSourceFact> = initial.map((row, index) => ({
    row: { ...row },
    sourceId: union && index === 1 ? second.id : first.id,
    pending: false,
  }))
  let cut: CallbackInputCut = `initial`
  let allowed = facts.map((fact) => expectedMetadataInput(fact, description))
  let enteredCallback = `select`
  const captures: Array<{
    cut: CallbackInputCut
    callback: string
    input: MetadataInputSnapshot
  }> = []
  const project = (row: unknown, id: string | number) => {
    const observed = captureMetadataInput(row)
    // A flat union HAVING callback also receives the compiler's selected-value
    // context. It is not an ordinary field of the source value being judged.
    // Capture reserved fields before removing that known context from ordinary
    // fields; spreading first could hide inherited or nonenumerable metadata.
    if (union && enteredCallback === `having`)
      delete observed.ordinary.$selected
    captures.push({ cut, callback: enteredCallback, input: observed })
    return { id, observed }
  }
  const makeSelectQuery = (parentId?: RefLeaf<string | number>) => {
    const input = projectInput(first, `chosen`, description)
    if (path === `direct-source`) {
      const direct = new Query().from({ direct: first })
      return (
        parentId === undefined
          ? direct
          : direct.where(({ direct: row }) => eq(row.id, parentId))
      ).fn.select(({ direct: row }) => project(row, row.id))
    }
    if (union) {
      const other = projectInput(second, `other`, description)
      const combined =
        path === `union-last`
          ? new Query().unionAll(other, input)
          : new Query().unionAll(input, other)
      if (path === `union-query-ref`) {
        const outer = new Query().from({ nested: combined })
        return (
          parentId === undefined
            ? outer
            : outer.where(({ nested }) => eq(nested.id, parentId))
        ).fn.select(({ nested }) => project(nested, nested.id))
      }
      return (
        parentId === undefined
          ? combined
          : combined.where((row) => eq(row.id, parentId))
      ).fn.select((row) => project(row, row.id))
    }
    if (path === `joined-source`) {
      const joined = new Query()
        .from({ peer: peers })
        .leftJoin({ nested: input }, ({ peer, nested }) =>
          eq(peer.id, nested.id),
        )
      return (
        parentId === undefined
          ? joined
          : joined.where(({ peer }) => eq(peer.id, parentId))
      ).fn.select(({ peer, nested }) => project(nested, peer.id))
    }
    if (path === `joined-from`) {
      const joined = new Query()
        .from({ nested: input })
        .leftJoin({ peer: peers }, ({ nested, peer }) => eq(nested.id, peer.id))
      return (
        parentId === undefined
          ? joined
          : joined.where(({ nested }) => eq(nested.id, parentId))
      ).fn.select(({ nested }) => project(nested, nested.id))
    }
    const once = new Query().from({ nested: input })
    if (path === `nested-query-ref`) {
      const outer = new Query().from({ outer: once })
      return (
        parentId === undefined
          ? outer
          : outer.where(({ outer: row }) => eq(row.id, parentId))
      ).fn.select(({ outer: row }) => project(row, row.id))
    }
    return (
      parentId === undefined
        ? once
        : once.where(({ nested }) => eq(nested.id, parentId))
    ).fn.select(({ nested }) => project(nested, nested.id))
  }
  const selects = callbackKind === `select` || callbackKind.endsWith(`-select`)
  const makeQuery = (parentId?: RefLeaf<string | number>) => {
    const authored = makeSelectQuery(parentId)
    if (callbackKind === `select`) return authored
    const ir = getQueryIR(authored)
    const recordSelection = ir.fnSelect!
    const predicateKind = callbackKind.startsWith(`where`) ? `where` : `having`
    const predicate = (row: Parameters<typeof recordSelection>[0]) => {
      enteredCallback = predicateKind
      try {
        const derived = recordSelection(row) as Output
        // A real predicate derives membership from the observed reserved field.
        // It uses no expected answer or production provenance classification.
        return derived.observed.fields.$key?.value !== `spoof-$key`
      } finally {
        enteredCallback = `select`
      }
    }
    if (predicateKind === `where`)
      ir.fnWhere = [...(ir.fnWhere ?? []), predicate]
    else ir.fnHaving = [...(ir.fnHaving ?? []), predicate]
    if (!selects) {
      delete ir.fnSelect
      if (!union) {
        const alias =
          path === `direct-source`
            ? `direct`
            : path === `nested-query-ref`
              ? `outer`
              : `nested`
        ir.select = {
          id: new PropRef([path === `joined-source` ? `peer` : alias, `id`]),
          value: new PropRef([alias]),
        }
      }
    }
    // The builder receives its authored IR back; this changes callback syntax,
    // not the receiver's production path or expected source facts.
    return authored
  }
  const observeRows = (rows: ReadonlyArray<object>): Array<Output> =>
    selects
      ? outputRows(rows)
      : rows.map((row) => {
          const record = row as Record<string, unknown>
          const observed = captureMetadataInput(union ? row : record.value)
          return {
            id: record.id as string | number,
            observed: receiver.startsWith(`inline-child`)
              ? observed
              : expectedMetadataRecord(
                  observed.present ? observed.ordinary : undefined,
                ),
          }
        })
  const expectedOutput = (fact: MetadataSourceFact) =>
    selects
      ? expectedMetadataInput(fact, description)
      : receiver.startsWith(`inline-child`)
        ? expectedMetadataInput(fact, description, true)
        : expectedMetadataRecord(
            expectedMetadataInput(fact, description, true).ordinary,
          )
  const query =
    receiver === `root` || receiver === `effect`
      ? makeQuery()
      : new Query()
          .from({ parent: containingParents })
          .select(({ parent }) => ({
            id: parent.id,
            // The direct receiver avoids an extra QueryRef that could sanitize
            // the entire child recursively and conceal a missed union boundary.
            children:
              receiver === `inline-child-direct`
                ? toArray(
                    makeQuery(
                      parent.id,
                    ) as unknown as QueryBuilder<OutputContext>,
                  )
                : toArray(
                    new Query()
                      .from({
                        result:
                          makeQuery() as unknown as QueryBuilder<OutputContext>,
                      })
                      .where(({ result }) => eq(result.id, parent.id)),
                  ),
          }))
  // A real Effect receives the same model and callback grammar through both
  // public channels. Its ledgers retain each value/previousValue before another
  // action. No implicit Effect-root metadata policy is inferred here.
  const effectRows = new Map<string | number, Output>()
  const namedRows = new Map<string | number, Output>()
  const effectErrors: Array<unknown> = []
  const effectEvents: Array<{
    type: string
    key: string | number
    value: unknown
    previousValue?: unknown
  }> = []
  const namedEvents: typeof effectEvents = []
  const receive = (
    rows: typeof effectRows,
    events: typeof effectEvents,
    event: {
      type: string
      key: string | number
      value: unknown
      previousValue?: unknown
    },
  ) => {
    const captured = copyData(event) as (typeof effectEvents)[number]
    events.push(captured)
    const previous = rows.get(event.key)
    if (
      event.type === `update` &&
      !isDeepStrictEqual(previous, event.previousValue)
    )
      effectErrors.push({
        kind: `Effect previousValue differs from prior delivered value`,
        previous,
        event: captured,
      })
    if (event.type === `enter` && previous !== undefined)
      effectErrors.push({
        kind: `Effect enters an active occurrence`,
        event: captured,
      })
    if (event.type !== `enter` && previous === undefined)
      effectErrors.push({
        kind: `Effect changes an absent occurrence`,
        event: captured,
      })
    if (event.type === `exit`) rows.delete(event.key)
    else rows.set(event.key, copyData(event.value) as Output)
  }
  const effect =
    receiver === `effect`
      ? createEffect({
          query: () => query as unknown as QueryBuilder<OutputContext>,
          onBatch: (events) => {
            for (const event of events) receive(effectRows, effectEvents, event)
          },
          onEnter: (event) => receive(namedRows, namedEvents, event),
          onUpdate: (event) => receive(namedRows, namedEvents, event),
          onExit: (event) => receive(namedRows, namedEvents, event),
          onError: (error) => {
            effectErrors.push(error)
          },
          onSourceError: (error) => {
            effectErrors.push(error)
          },
        })
      : undefined
  const live = effect
    ? undefined
    : createLiveQueryCollection({
        query: () => query as unknown as QueryBuilder<OutputContext>,
        getKey: (row: Output) => row.id,
      })
  const report: CallbackInputReport = {
    violations: [],
    callbackCounts: {
      initial: 0,
      held: 0,
      settled: 0,
      'remote-next-use': 0,
      exit: 0,
      reentry: 0,
      disposed: 0,
    },
  }
  let checkedEffectEvents = 0
  const check = async () => {
    if (effect) await flushPromises()
    const premise =
      (live?.isReady() ?? (!effect?.disposed && first.isReady())) &&
      first.get(1)?.$hasPendingWrites === (cut === `held`)
    if (!premise)
      report.violations.push({
        cut,
        kind: `readiness or held-source premise missing`,
        actual: {
          ready: live?.isReady() ?? (!effect?.disposed && first.isReady()),
          pending: first.get(1)?.$hasPendingWrites,
        },
        expected: { ready: true, pending: cut === `held` },
      })
    const current = captures.filter((capture) => capture.cut === cut)
    report.callbackCounts[cut] = current.length
    const requiredCallback = callbackKind.startsWith(`where`)
      ? `where`
      : callbackKind.startsWith(`having`)
        ? `having`
        : `select`
    const callbacksEntered =
      current.some((capture) => capture.callback === requiredCallback) &&
      (!selects || current.some((capture) => capture.callback === `select`))
    if (!callbacksEntered)
      report.violations.push({
        cut,
        kind: `callback not entered`,
        actual: current,
        expected: `one or more`,
      })
    for (const capture of current) {
      const permitted =
        path === `joined-source`
          ? [...allowed, expectedMetadataRecord(undefined)]
          : allowed
      for (const kind of metadataInputViolations(capture.input, permitted))
        report.violations.push({
          cut,
          kind,
          actual: capture.input,
          expected: permitted,
        })
    }
    const expected = facts.map((fact) => ({
      id: fact.row.id,
      observed: expectedOutput(fact),
    }))
    // The unmatched LEFT-join peer remains a result after its source exits.
    // The model's absent snapshot is judged at callbacks and output separately.
    if (path === `joined-source` && cut === `exit`)
      expected.push({ id: `1`, observed: expectedMetadataRecord(undefined) })
    const raw =
      receiver === `effect`
        ? [...effectRows.values()]
        : receiver === `root`
          ? live!.toArray
          : live!.toArray.flatMap(
              (row) => (row as unknown as { children: Array<Output> }).children,
            )
    if (effect) {
      // Check each delivered value, not only the final active rows. Retraction
      // evaluation can legally use before/after facts; it cannot deliver a
      // snapshot outside those independently authored source states.
      const permitted = allowed.flatMap((observed) => [
        {
          id: observed.ordinary.id,
          observed: selects
            ? observed
            : expectedMetadataRecord(
                observed.present ? observed.ordinary : undefined,
              ),
        },
      ])
      if (path === `joined-source`)
        for (const row of initial)
          permitted.push({
            id: row.id,
            observed: expectedMetadataRecord(undefined),
          })
      for (const event of effectEvents.slice(checkedEffectEvents)) {
        for (const value of [
          event.value,
          ...(event.type === `update` ? [event.previousValue] : []),
        ]) {
          const actual = observeRows([value as object])
          if (
            !permitted.some(
              (row) =>
                metadataOutputViolations(actual, [row as Output]).length === 0,
            )
          )
            report.violations.push({
              cut,
              kind: `Effect delivered value outside authored states`,
              actual,
              expected: permitted,
            })
        }
      }
      checkedEffectEvents = effectEvents.length
    }
    if (effect) {
      if (effectErrors.length || !isDeepStrictEqual(effectEvents, namedEvents))
        report.violations.push({
          cut,
          kind: `Effect callback channels or event continuity`,
          actual: { effectErrors, effectEvents, namedEvents },
          expected: `matching complete channels and continuous values`,
        })
      for (const kind of metadataOutputViolations(
        observeRows([...namedRows.values()]),
        expected,
      ))
        report.violations.push({
          cut,
          kind: `named Effect: ${kind}`,
          actual: [...namedRows.values()],
          expected,
        })
    }
    const actual = observeRows(raw)
    for (const kind of metadataOutputViolations(actual, expected))
      report.violations.push({ cut, kind, actual, expected })
    // Reach records the actual callback path and established source/output
    // boundary even when the law comparison is RED. It is not a passing count.
    if (premise && callbacksEntered) reached(cut)
  }
  let finish = async () => {}
  await withOracleCleanup(async () => {
    if (live) await live.preload()
    await check()
    cut = `held`
    const before = facts.map((fact) => expectedMetadataInput(fact, description))
    facts = facts.map((fact) =>
      fact.row.id === 1
        ? {
            ...fact,
            row: { ...fact.row, label: `number-pending` },
            pending: true,
          }
        : fact,
    )
    allowed = [
      ...before,
      ...facts.map((fact) => expectedMetadataInput(fact, description)),
    ]
    const transaction = first.update(1, (row) => {
      row.label = `number-pending`
    })
    finish = async () => {
      first.utils.resolveSync()
      await transaction.when(`settled`)
      finish = async () => {}
    }
    await check()
    cut = `settled`
    const pending = facts.map((fact) =>
      expectedMetadataInput(fact, description),
    )
    facts = facts.map((fact) =>
      fact.row.id === 1
        ? { ...fact, row: { ...initial[0]! }, pending: false }
        : fact,
    )
    allowed = [
      ...pending,
      ...facts.map((fact) => expectedMetadataInput(fact, description)),
    ]
    await finish()
    await check()
    cut = `remote-next-use`
    const settled = facts.map((fact) =>
      expectedMetadataInput(fact, description),
    )
    facts = facts.map((fact) =>
      fact.row.id === `1`
        ? { ...fact, row: { ...fact.row, label: `string-remote` } }
        : fact,
    )
    allowed = [
      ...settled,
      ...facts.map((fact) => expectedMetadataInput(fact, description)),
    ]
    const receivingSource = union ? second : first
    receivingSource.utils.begin()
    receivingSource.utils.write({ type: `update`, value: { ...facts[1]!.row } })
    receivingSource.utils.commit()
    await check()
    if (effect) {
      // Source exit/reentry exercises onExit and a fresh active interval. The
      // same before/after authored facts judge both channels at each cut.
      cut = `exit`
      const departing = facts[1]!
      allowed = facts.map((fact) => expectedMetadataInput(fact, description))
      facts = [facts[0]!]
      const receiving = union ? second : first
      // Use the actual branch owning the string key; no model source is moved.
      receiving.utils.begin()
      receiving.utils.write({ type: `delete`, value: { ...departing.row } })
      receiving.utils.commit()
      await check()
      cut = `reentry`
      facts = [
        ...facts,
        { ...departing, row: { ...departing.row, label: `string-reentry` } },
      ]
      allowed = facts.map((fact) => expectedMetadataInput(fact, description))
      receiving.utils.begin()
      receiving.utils.write({ type: `insert`, value: { ...facts[1]!.row } })
      receiving.utils.commit()
      await check()
      cut = `disposed`
      await effect.dispose()
      const beforeDisposal = {
        captures: captures.length,
        batch: effectEvents.length,
        named: namedEvents.length,
      }
      receiving.utils.begin()
      receiving.utils.write({
        type: `update`,
        value: { ...facts[1]!.row, label: `after-disposal` },
      })
      receiving.utils.commit()
      await flushPromises()
      const afterDisposal = {
        captures: captures.length,
        batch: effectEvents.length,
        named: namedEvents.length,
      }
      if (!effect.disposed || !isDeepStrictEqual(beforeDisposal, afterDisposal))
        report.violations.push({
          cut,
          kind: `Effect delivery after disposal`,
          actual: afterDisposal,
          expected: beforeDisposal,
        })
      else reached(cut)
    }
    if (report.violations.length)
      throw new MetadataCallbackOracleFailure(report)
  }, [
    () => finish(),
    () => effect?.dispose(),
    () => live?.cleanup(),
    () => containingParents.cleanup(),
    () => peers.cleanup(),
    () => second.cleanup(),
    () => first.cleanup(),
  ])
  return report
}

/** The inline receiver exercises the real materializer with authored child
 * values. The same source/input judgment predicts them; no second metadata
 * model is hidden in a receiving test. Compiled Collections reject at admission. */
export async function runInlineMetadataCallbackHistory(
  description: MetadataInputDescription,
  form: `array` | `materialized` | `collection`,
  reached: (cut: CallbackInputCut | `rejected`) => void,
  path: `direct` | `query-ref` = `direct`,
): Promise<CallbackInputReport> {
  const initial = freshRows()
  const children = source(`callback-inline-child`, initial)
  const parentRows: Array<MetadataInputRow> =
    path === `direct`
      ? [
          {
            id: `parent`,
            parentId: `group`,
            label: `parent`,
            optional: undefined,
          },
        ]
      : initial.map((row) => ({ ...row }))
  const parents = source(`callback-inline-parent`, parentRows)
  let facts = initial.map((row) => ({
    row: { ...row },
    sourceId: children.id,
    pending: false,
  }))
  let cut: CallbackInputCut = `initial`
  // A QueryRef in a child without a functional callback preserves the inline
  // selected shape too. One parent per typed key gives its outer correlation
  // a named source field without requiring a projected parentId.
  const expected = () =>
    parentRows.map((parent) =>
      expectedMetadataRecord({
        id: parent.id,
        children: rowsFromSnapshots(
          facts
            .filter((fact) => path === `direct` || fact.row.id === parent.id)
            .map((fact) => expectedMetadataInput(fact, description, true)),
        ),
      }),
    )
  let allowed = expected()
  // The controlled source publishes its initial child batch atomically. A
  // startup callback can precede that batch or consume its complete rows.
  allowed.push(
    ...parentRows.map((parent) =>
      expectedMetadataRecord({ id: parent.id, children: [] }),
    ),
  )
  const calls: Array<{ cut: CallbackInputCut; input: MetadataInputSnapshot }> =
    []
  const build = () =>
    createLiveQueryCollection({
      query: (q) => {
        const included = q.from({ parent: parents }).select(({ parent }) => {
          const selected =
            path === `direct`
              ? projectInput(
                  children,
                  `child`,
                  description,
                  parent.parentId,
                ).orderBy(({ $selected }) => $selected.label)
              : new Query()
                  .from({
                    nested: projectInput(children, `child`, description),
                  })
                  .where(({ nested }) => eq(nested.id, parent.id))
                  .orderBy(({ nested }) => nested.label)
          return {
            id: parent.id,
            children:
              form === `collection`
                ? include(
                    selected as unknown as QueryBuilder<ProjectionContext>,
                  )
                : form === `array`
                  ? toArray(
                      selected as unknown as QueryBuilder<ProjectionContext>,
                    )
                  : materialize(
                      selected as unknown as QueryBuilder<ProjectionContext>,
                    ),
          }
        })
        return q.from({ nested: included }).fn.select(({ nested }) => {
          const observed = captureMetadataInput(nested)
          calls.push({ cut, input: observed })
          return { id: nested.id, observed }
        })
      },
      getKey: (row: Output) => row.id,
    })
  const report: CallbackInputReport = {
    violations: [],
    callbackCounts: {
      initial: 0,
      held: 0,
      settled: 0,
      'remote-next-use': 0,
      exit: 0,
      reentry: 0,
      disposed: 0,
    },
  }
  if (form === `collection`) {
    let unexpected: ReturnType<typeof build> | undefined
    await withOracleCleanup(() => {
      let error: unknown
      try {
        unexpected = build()
      } catch (caught) {
        error = caught
      }
      if (
        !(error instanceof Error) ||
        !error.message.includes(
          `fn.select() cannot consume Collection-valued includes`,
        ) ||
        calls.length > 0
      )
        report.violations.push({
          cut,
          kind: `compiled Collection input admitted or callback entered`,
          actual: { error, calls },
          expected: `rejection before callback`,
        })
      else reached(`rejected`)
      if (report.violations.length)
        throw new MetadataCallbackOracleFailure(report)
    }, [
      () => unexpected?.cleanup(),
      () => parents.cleanup(),
      () => children.cleanup(),
    ])
    return report
  }
  const live = build()
  const check = () => {
    const premise =
      live.isReady() && children.get(1)?.$hasPendingWrites === (cut === `held`)
    if (!premise)
      report.violations.push({
        cut,
        kind: `inline readiness or held-source premise missing`,
        actual: {
          ready: live.isReady(),
          pending: children.get(1)?.$hasPendingWrites,
        },
        expected: { ready: true, pending: cut === `held` },
      })
    const current = calls.filter((call) => call.cut === cut)
    report.callbackCounts[cut] = current.length
    if (!current.length)
      report.violations.push({
        cut,
        kind: `inline callback not entered`,
        actual: current,
        expected: `one or more`,
      })
    for (const call of current)
      for (const kind of metadataInputViolations(call.input, allowed))
        report.violations.push({
          cut,
          kind,
          actual: call.input,
          expected: allowed,
        })
    const actual = outputRows(live.toArray)
    const next = expected().map((observed, index) => ({
      id: parentRows[index]!.id,
      observed,
    }))
    for (const kind of metadataOutputViolations(actual, next))
      report.violations.push({ cut, kind, actual, expected: next })
    if (premise && current.length && live.toArray.length === parentRows.length)
      reached(cut)
  }
  let finish = async () => {}
  await withOracleCleanup(async () => {
    await live.preload()
    check()
    cut = `held`
    const before = expected()
    facts = facts.map((fact) =>
      fact.row.id === 1
        ? {
            ...fact,
            row: { ...fact.row, label: `number-pending` },
            pending: true,
          }
        : fact,
    )
    allowed = [...before, ...expected()]
    const transaction = children.update(1, (row) => {
      row.label = `number-pending`
    })
    finish = async () => {
      children.utils.resolveSync()
      await transaction.when(`settled`)
      finish = async () => {}
    }
    check()
    cut = `settled`
    const pending = expected()
    facts = facts.map((fact) =>
      fact.row.id === 1
        ? { ...fact, row: { ...initial[0]! }, pending: false }
        : fact,
    )
    allowed = [...pending, ...expected()]
    await finish()
    check()
    cut = `remote-next-use`
    const settled = expected()
    facts = facts.map((fact) =>
      fact.row.id === `1`
        ? { ...fact, row: { ...fact.row, label: `string-remote` } }
        : fact,
    )
    allowed = [...settled, ...expected()]
    children.utils.begin()
    children.utils.write({ type: `update`, value: { ...facts[1]!.row } })
    children.utils.commit()
    check()
    if (report.violations.length)
      throw new MetadataCallbackOracleFailure(report)
  }, [
    () => finish(),
    () => live.cleanup(),
    () => parents.cleanup(),
    () => children.cleanup(),
  ])
  return report
}

/** The low-level compiler receives the exact same selected QueryIR twice on
 * one D2 graph. Unlike builder placement, this public entry point need not
 * clone that query. Each history crosses compilation order and cache sharing.
 *
 * Only the initial graph-drain cut is claimed here. Public source Collection
 * rows supply genuine metadata; independent authored facts predict callback
 * input and derived output. Raw selected output is compared across shared and
 * separate caches; no implicit metadata law is assigned to an Effect root. */
export async function runMetadataCompilerCacheHistory(
  description: MetadataInputDescription,
  order: `authored-first` | `callback-first`,
  cache: `shared` | `separate`,
  path: MetadataCompilerCachePath,
  reached: (
    observation: `callback` | `derived-output` | `authored-output`,
  ) => void,
): Promise<CallbackInputReport> {
  const initial = freshRows()
  const first = source(`callback-compiler-cache`, initial)
  const facts: Array<MetadataSourceFact> = initial.map((row) => ({
    row: { ...row },
    sourceId: first.id,
    pending: false,
  }))
  const report: CallbackInputReport = {
    violations: [],
    callbackCounts: {
      initial: 0,
      held: 0,
      settled: 0,
      'remote-next-use': 0,
      exit: 0,
      reentry: 0,
      disposed: 0,
    },
  }
  await withOracleCleanup(async () => {
    await first.preload()
    const execute = (sharing: `shared` | `separate`) => {
      const selected = getQueryIR(projectInput(first, `chosen`, description))
      const captures: Array<MetadataInputSnapshot> = []
      const capture = (value: unknown, id?: string | number) => {
        const observed = captureMetadataInput(value)
        captures.push(observed)
        return { id: id ?? (value as MetadataInputRow).id, observed }
      }
      const joined = getQueryIR(
        new Query()
          .from({ peer: first })
          .leftJoin(
            { nested: projectInput(first, `chosen`, description) },
            ({ peer, nested }) => eq(peer.id, nested.id),
          ),
      )
      // Install the exact shared IR after authoring the legal join expression.
      // Query builders normally clone placements, which concealed the cache bug.
      joined.join![0]!.from = new QueryRef(
        selected,
        `nested`,
        joined.join![0]!.from.bindingId,
      )
      const consumed: QueryIR =
        path === `joined-source`
          ? {
              ...joined,
              fnSelect: ({ nested, peer }) =>
                capture(nested, (peer as MetadataInputRow).id),
            }
          : path === `union-branch`
            ? {
                from: new UnionAll([selected]),
                fnSelect: (value) => capture(value),
              }
            : {
                from: new QueryRef(selected, `nested`),
                fnSelect: ({ nested }) => capture(nested),
              }
      const graph = new D2()
      const input = graph.newInput<[string | number, MetadataInputRow]>()
      const sharedCache: QueryCache = new WeakMap()
      const readCache = sharedCache.get.bind(sharedCache)
      let exactQueryReads = 0
      sharedCache.get = (query) => {
        if (query === selected) exactQueryReads++
        return readCache(query)
      }
      const compile = (query: QueryIR) =>
        compileQuery(
          query,
          { chosen: input, peer: input },
          { [first.id]: first },
          {},
          {},
          new Set(),
          {},
          () => {},
          sharing === `shared` ? sharedCache : new WeakMap(),
        )
      const [authored, callback] =
        order === `authored-first`
          ? [compile(selected), compile(consumed)]
          : (() => {
              const compiledCallback = compile(consumed)
              return [compile(selected), compiledCallback]
            })()
      const authoredDeltas: Array<{ row: Output; weight: number }> = []
      const derivedDeltas: Array<{ row: Output; weight: number }> = []
      authored.pipeline.pipe(
        output((message) => {
          for (const [[, [value]], weight] of message.getInner())
            authoredDeltas.push({
              row: {
                id: (value as MetadataInputRow).id,
                observed: captureMetadataInput(value),
              },
              weight,
            })
        }),
      )
      callback.pipeline.pipe(
        output((message) => {
          for (const [[, [value]], weight] of message.getInner()) {
            const row = value as Output
            derivedDeltas.push({
              row: {
                id: row.id,
                // Copy the selected ordinary capture at output delivery too.
                observed: copyData(row.observed) as MetadataInputSnapshot,
              },
              weight,
            })
          }
        }),
      )
      graph.finalize()
      input.sendData(
        new MultiSet(first.toArray.map((row) => [[row.id, row], 1])),
      )
      graph.run()

      return { captures, authoredDeltas, derivedDeltas, exactQueryReads }
    }
    const { captures, authoredDeltas, derivedDeltas, exactQueryReads } =
      execute(cache)
    const reference = execute(`separate`)
    if (
      process.env.TANSTACK_DB_ORACLE_STATISTICS === `1` &&
      description.shape === `structured-projection` &&
      description.collision === `none` &&
      cache === `shared`
    )
      console.info(`compiler exact raw-query reads`, {
        path,
        order,
        reads: exactQueryReads,
      })

    // Independent signed-bag bookkeeping preserves duplicate contributions and
    // retractions. It does not replace the source/projection judgment.
    const accumulate = (
      deltas: ReadonlyArray<{ row: Output; weight: number }>,
    ) => {
      const counts: Array<{ row: Output; weight: number }> = []
      for (const delta of deltas) {
        const existing = counts.find((entry) =>
          isDeepStrictEqual(entry.row, delta.row),
        )
        if (existing) existing.weight += delta.weight
        else counts.push({ ...delta })
      }
      const rows: Array<Output> = []
      for (const entry of counts) {
        if (!Number.isSafeInteger(entry.weight) || entry.weight < 0) {
          report.violations.push({
            cut: `initial`,
            kind: `invalid compiled output multiplicity`,
            actual: entry,
            expected: `a nonnegative integer at graph drain`,
          })
          continue
        }
        for (let occurrence = 0; occurrence < entry.weight; occurrence++)
          rows.push(entry.row)
      }
      return rows
    }
    const actualAuthored = accumulate(authoredDeltas)
    const actualDerived = accumulate(derivedDeltas)
    const expectedInput = facts.map((fact) =>
      expectedMetadataInput(fact, description),
    )
    const expectedDerived = facts.map((fact, index) => ({
      id: fact.row.id,
      observed: expectedInput[index]!,
    }))
    // Cache transparency is a relation, not an Effect-root attribution rule.
    // Separate compilation supplies the other execution, never the O12 truth.
    // The independent source/projection model still judges callback inputs and
    // complete ordinary derived outputs in both executions below.
    const expectedAuthored = accumulate(reference.authoredDeltas)
    const referenceDerived = accumulate(reference.derivedDeltas)
    for (const capture of reference.captures)
      for (const kind of metadataInputViolations(
        capture,
        path === `joined-source`
          ? [...expectedInput, expectedMetadataRecord(undefined)]
          : expectedInput,
      ))
        report.violations.push({
          cut: `initial`,
          kind: `reference: ${kind}`,
          actual: capture,
          expected: expectedInput,
        })
    for (const kind of metadataOutputViolations(
      referenceDerived,
      expectedDerived,
    ))
      report.violations.push({
        cut: `initial`,
        kind: `reference: ${kind}`,
        actual: referenceDerived,
        expected: expectedDerived,
      })
    report.callbackCounts.initial = captures.length
    if (!captures.length)
      report.violations.push({
        cut: `initial`,
        kind: `compiler callback not entered`,
        actual: captures,
        expected: `one or more`,
      })
    for (const capture of captures)
      for (const kind of metadataInputViolations(
        capture,
        path === `joined-source`
          ? [...expectedInput, expectedMetadataRecord(undefined)]
          : expectedInput,
      ))
        report.violations.push({
          cut: `initial`,
          kind,
          actual: capture,
          expected: expectedInput,
        })
    for (const [name, actual, expected] of [
      [`derived`, actualDerived, expectedDerived],
      [`authored`, actualAuthored, expectedAuthored],
    ] as const)
      for (const kind of metadataOutputViolations(actual, expected))
        report.violations.push({
          cut: `initial`,
          kind: `${name}: ${kind}`,
          actual,
          expected,
        })
    // Reach records executed comparisons, including RED comparisons, after the
    // real source and both compiled roots reach the named graph-drain cut.
    if (first.isReady() && captures.length) reached(`callback`)
    if (first.isReady() && actualDerived.length === facts.length)
      reached(`derived-output`)
    if (first.isReady() && actualAuthored.length === facts.length)
      reached(`authored-output`)
    if (report.violations.length)
      throw new MetadataCallbackOracleFailure(report)
  }, [() => first.cleanup()])
  return report
}

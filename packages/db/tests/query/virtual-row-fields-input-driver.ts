/**
 * Production receiver for the callback-input oracle. Callbacks copy their facts
 * immediately, including missing versus own undefined. At an action, D2 may
 * invoke a callback for old-row retractions as well as new-row contributions;
 * the check permits those two independently authored states. Startup LEFT joins
 * may expose an absent joined side. Established output cuts require both rows.
 * No callback count, ordering, or fully matched startup snapshot is promised.
 */
import { inspect } from 'node:util'
import { createCollection } from '../../src/collection/index.js'
import {
  Query,
  createLiveQueryCollection,
  eq,
  include,
  materialize,
  toArray,
} from '../../src/query/index.js'
import { mockSyncCollectionOptions, withOracleCleanup } from '../utils.js'
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
import type {
  MetadataCallbackPath,
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
  `initial` | `held` | `settled` | `remote-next-use`
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
  receiver: `root` | `inline-child` | `inline-child-direct` = `root`,
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
  const captures: Array<{
    cut: CallbackInputCut
    input: MetadataInputSnapshot
  }> = []
  const project = (row: unknown, id: string | number) => {
    const observed = captureMetadataInput(row)
    captures.push({ cut, input: observed })
    return { id, observed }
  }
  const makeQuery = (parentId?: RefLeaf<string | number>) => {
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
  const query =
    receiver === `root`
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
  const live = createLiveQueryCollection({
    query: () => query as unknown as QueryBuilder<OutputContext>,
    getKey: (row: Output) => row.id,
  })
  const report: CallbackInputReport = {
    violations: [],
    callbackCounts: { initial: 0, held: 0, settled: 0, 'remote-next-use': 0 },
  }
  const check = () => {
    const premise =
      live.isReady() && first.get(1)?.$hasPendingWrites === (cut === `held`)
    if (!premise)
      report.violations.push({
        cut,
        kind: `readiness or held-source premise missing`,
        actual: {
          ready: live.isReady(),
          pending: first.get(1)?.$hasPendingWrites,
        },
        expected: { ready: true, pending: cut === `held` },
      })
    const current = captures.filter((capture) => capture.cut === cut)
    report.callbackCounts[cut] = current.length
    if (current.length === 0)
      report.violations.push({
        cut,
        kind: `callback not entered`,
        actual: current,
        expected: `one or more`,
      })
    for (const capture of current) {
      const permitted =
        cut === `initial` && path === `joined-source`
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
      observed: expectedMetadataInput(fact, description),
    }))
    const raw =
      receiver === `root`
        ? live.toArray
        : live.toArray.flatMap(
            (row) => (row as unknown as { children: Array<Output> }).children,
          )
    const actual = outputRows(raw)
    for (const kind of metadataOutputViolations(actual, expected))
      report.violations.push({ cut, kind, actual, expected })
    // Reach records the actual callback path and established source/output
    // boundary even when the law comparison is RED. It is not a passing count.
    if (premise && current.length > 0 && raw.length === facts.length)
      reached(cut)
  }
  let finish = async () => {}
  await withOracleCleanup(async () => {
    await live.preload()
    check()
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
    check()
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
    check()
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
    check()
    if (report.violations.length)
      throw new MetadataCallbackOracleFailure(report)
  }, [
    () => finish(),
    () => live.cleanup(),
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
    callbackCounts: { initial: 0, held: 0, settled: 0, 'remote-next-use': 0 },
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

import { expect } from 'vitest'
import { createControlledCollection as createOracleControlledCollection } from './includes-oracle-helpers.js'
import type { BasicExpression } from '../../src/query/ir.js'
import type { ControlledCollection } from './includes-oracle-helpers.js'

/**
 * Shared observers, normalizers, and cleanup for the cross-formulation oracle
 * (includes-cross-formulation-oracle.property.test.ts), which owns the
 * equivalence law. The capture functions copy production observations raw,
 * so an unexpected field, symbol, or placeholder fails before normalization.
 * The cold reference-request fixture is the provider stand-in for the
 * reference-sensitive loading tests. This module compares nothing against a
 * model, so none of its exports is a declared part.
 */

export type ParentRow = {
  id: number
  group: number
  position: number
}

export type ChildRow = {
  id: number
  parentGroup: number
  score: number | null
  position: number
}

export type NormalizedParent = ParentRow & {
  children: Array<ChildRow>
}

export type FlatRow = {
  parentId: number
  parentGroup: number
  parentPosition: number
  child: ChildRow | undefined
}

// Opaque reference routes form a second value domain. Equal object shapes do
// not make two reference-sensitive correlation keys equal.
export type ReferenceKey = { code: number }

export type ReferenceParent = {
  id: number
  group: ReferenceKey
}

export type ReferenceChild = {
  id: number
  parentGroup: ReferenceKey
}

export type ReferenceRequest =
  | { readonly type: `ref`; readonly path: ReadonlyArray<string> }
  | { readonly type: `val`; readonly value: unknown }
  | {
      readonly type: `func`
      readonly name: string
      readonly args: ReadonlyArray<ReferenceRequest>
    }

// Copy request structure, but preserve opaque key identities. This finite
// provider accepts only unbounded parentGroup eq/in predicates and conjunctions.
export function captureReferenceRequest(
  expression: BasicExpression,
): ReferenceRequest {
  switch (expression.type) {
    case `ref`:
      return Object.freeze({
        type: `ref`,
        path: Object.freeze([...expression.path]),
      })
    case `val`: {
      const value: unknown = expression.value
      return Object.freeze({
        type: `val`,
        value: Array.isArray(value) ? Object.freeze([...value]) : value,
      })
    }
    case `func`:
      return Object.freeze({
        type: `func`,
        name: expression.name,
        args: Object.freeze(expression.args.map(captureReferenceRequest)),
      })
  }
}

export function referenceRequestPredicate(
  request: ReferenceRequest | undefined,
): (row: ReferenceChild) => boolean {
  if (!request) return () => true
  if (request.type === `func`) {
    if (request.name === `and` && request.args.length > 0) {
      const predicates = request.args.map(referenceRequestPredicate)
      return (row) => predicates.every((predicate) => predicate(row))
    }
    let [reference, constant] = request.args
    if (request.name === `eq` && reference?.type === `val`) {
      ;[reference, constant] = [constant, reference]
    }
    if (
      request.args.length === 2 &&
      reference?.type === `ref` &&
      reference.path.length === 1 &&
      reference.path[0] === `parentGroup` &&
      constant?.type === `val`
    ) {
      const value = constant.value
      if (request.name === `eq`) return (row) => row.parentGroup === value
      if (request.name === `in` && Array.isArray(value))
        return (row) => value.some((key: unknown) => row.parentGroup === key)
    }
  }
  throw new Error(`Unsupported cold reference fixture predicate`)
}

// Public VirtualRowProps and docs/guides/live-queries.md name only these keys.
// Their values and presence are a separate metadata law. They are not part of
// this projection.
const virtualKeys = new Set<string>([
  `$hasPendingWrites`,
  `$synced`,
  `$origin`,
  `$key`,
  `$collectionId`,
])

export function assertSelectedKeys(
  value: object,
  keys: ReadonlyArray<string>,
  context: string,
): void {
  expect(value, context).not.toBeNull()
  const actual = Reflect.ownKeys(value).filter(
    (key) => typeof key !== `string` || !virtualKeys.has(key),
  )
  expect(new Set(actual), context).toEqual(new Set(keys))
}

export function assertArrayKeys(
  value: ReadonlyArray<unknown>,
  context: string,
): void {
  expect(new Set(Reflect.ownKeys(value)), context).toEqual(
    new Set([
      `length`,
      ...Array.from({ length: value.length }, (_, index) => String(index)),
    ]),
  )
}

export async function withCleanup(
  work: () => Promise<void>,
  cleanups: ReadonlyArray<() => Promise<void>>,
): Promise<void> {
  let primary: { error: unknown } | undefined
  try {
    await work()
  } catch (error) {
    primary = { error }
  }
  const results = await Promise.allSettled(
    cleanups.map(async (cleanup) => {
      await cleanup()
    }),
  )
  const errors = results.flatMap((result) =>
    result.status === `rejected` ? [result.reason as unknown] : [],
  )
  if (errors.length > 0) {
    if (primary)
      throw new AggregateError(
        [primary.error, ...errors],
        `Oracle and cleanup failed`,
        { cause: primary.error },
      )
    if (errors.length === 1) throw errors[0]
    throw new AggregateError(errors, `Oracle cleanup failed`)
  }
  if (primary) throw primary.error
}

export function captureCounts(
  rows: Array<{ count: number }>,
): Array<{ count: number }> {
  assertArrayKeys(rows, `group counts`)
  return rows.map((row) => {
    assertSelectedKeys(row, [`count`], `group count`)
    return { count: row.count }
  })
}

export function captureGroupedRows(
  observed: Array<{ id: number; summaries: Array<{ count: number }> }>,
): Array<{ id: number; summaries: Array<{ count: number }> }> {
  assertArrayKeys(observed, `grouped roots`)
  return observed.map((row) => {
    assertSelectedKeys(row, [`id`, `summaries`], `grouped parent ${row.id}`)
    return { id: row.id, summaries: captureCounts(row.summaries) }
  })
}

export function captureReferenceRows(
  rows: Array<{ id: number; children: Array<number> }>,
): Array<{ id: number; children: Array<number> }> {
  assertArrayKeys(rows, `reference roots`)
  return rows.map((row) => {
    assertSelectedKeys(row, [`id`, `children`], `reference parent ${row.id}`)
    assertArrayKeys(row.children, `reference children ${row.id}`)
    return { id: row.id, children: [...row.children] }
  })
}

export function assertGroupedRouteCounts(
  observed: Array<{ id: number; summaries: Array<{ count: number }> }>,
  counts: ReadonlyArray<number>,
): void {
  expect(captureGroupedRows(observed), `group-route checkpoint`).toEqual(
    counts.map((childCount, index) => ({
      id: index + 1,
      summaries: childCount === 0 ? [] : [{ count: childCount }],
    })),
  )
}

export function createControlledCollection<T extends { id: number }>(
  name: string,
  initialData: ReadonlyArray<T>,
): ControlledCollection<T> {
  return createOracleControlledCollection(name, initialData, {
    autoIndex: `eager`,
    rowUpdateMode: `full`,
  })
}

export function compareParents(left: ParentRow, right: ParentRow): number {
  return left.position - right.position || left.id - right.id
}

export function compareChildren(left: ChildRow, right: ChildRow): number {
  return left.position - right.position || left.id - right.id
}

export function normalizeChild(child: ChildRow, context = `child`): ChildRow {
  assertSelectedKeys(child, [`id`, `parentGroup`, `score`, `position`], context)
  return {
    id: child.id,
    parentGroup: child.parentGroup,
    score: child.score,
    position: child.position,
  }
}

export function captureOrderedNested(
  rows: ReadonlyArray<NormalizedParent>,
  context = `nested`,
): Array<NormalizedParent> {
  assertArrayKeys(rows, `${context} roots`)
  return rows.map((parent) => {
    assertSelectedKeys(
      parent,
      [`id`, `group`, `position`, `children`],
      `${context} parent ${parent.id}`,
    )
    assertArrayKeys(parent.children, `${context} children ${parent.id}`)
    return {
      id: parent.id,
      group: parent.group,
      position: parent.position,
      children: parent.children.map((child) =>
        normalizeChild(
          child,
          `${context} parent ${parent.id} child ${child.id}`,
        ),
      ),
    }
  })
}

// Canonicalize only model rows and formulations with no common result order.
// Ordered production observations use `captureOrderedNested` directly.
export function normalizeNested(
  rows: ReadonlyArray<NormalizedParent>,
): Array<NormalizedParent> {
  return captureOrderedNested(rows)
    .map((parent) => ({
      ...parent,
      children: parent.children.sort(compareChildren),
    }))
    .sort(compareParents)
}

export function normalizeFlat(
  rows: ReadonlyArray<FlatRow>,
  context = `flat`,
): Array<NormalizedParent> {
  assertArrayKeys(rows, `${context} rows`)
  const parents = new Map<number, NormalizedParent>()
  const placeholders = new Set<number>()
  for (const row of rows) {
    assertSelectedKeys(
      row,
      [`parentId`, `parentGroup`, `parentPosition`, `child`],
      context,
    )
    const parent = parents.get(row.parentId) ?? {
      id: row.parentId,
      group: row.parentGroup,
      position: row.parentPosition,
      children: [],
    }
    expect(
      [row.parentGroup, row.parentPosition],
      `${context} parent ${row.parentId}`,
    ).toEqual([parent.group, parent.position])
    expect(
      placeholders.has(row.parentId),
      `${context} duplicate or mixed placeholder ${row.parentId}`,
    ).toBe(false)
    if (row.child === undefined) {
      expect(
        parent.children,
        `${context} mixed placeholder ${row.parentId}`,
      ).toEqual([])
      placeholders.add(row.parentId)
    } else {
      parent.children.push(normalizeChild(row.child, `${context} child`))
    }
    parents.set(row.parentId, parent)
  }
  return normalizeNested([...parents.values()])
}

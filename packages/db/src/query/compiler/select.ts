import { map } from '@tanstack/db-ivm'
import {
  ConditionalSelect,
  PropRef,
  Value as ValClass,
  isExpressionLike,
} from '../ir.js'
import { UnsafeAliasPathError } from '../../errors.js'
import { compileExpression, isCaseWhenConditionTrue } from './evaluators.js'
import type { BasicExpression, Select, SelectValueExpression } from '../ir.js'
import type {
  KeyedStream,
  NamespacedAndKeyedStream,
  NamespacedRow,
} from '../../types.js'

/**
 * Type for operations array used in select processing
 */
type SelectOp =
  | {
      kind: `merge`
      targetPath: Array<string>
      source: (row: NamespacedRow) => any
    }
  | { kind: `field`; alias: string; compiled: (row: NamespacedRow) => any }
  | { kind: `object`; targetPath: Array<string> }

/**
 * Unwraps any Value expressions
 */
function unwrapVal(input: any): any {
  if (input instanceof ValClass) return input.value
  return input
}

const UNSAFE_ALIAS_SEGMENTS = new Set([`__proto__`, `prototype`, `constructor`])

function assertSafeAliasSegments(segments: ReadonlyArray<string>): void {
  for (const seg of segments) {
    if (UNSAFE_ALIAS_SEGMENTS.has(seg)) {
      throw new UnsafeAliasPathError(seg)
    }
  }
}

// A source spread copies enumerable own data, including user symbols. Defining
// fields avoids invoking inherited setters for ordinary source property names.
function mergeSourceFields(target: object, source: object): void {
  for (const key of Reflect.ownKeys(source)) {
    if (!Object.prototype.propertyIsEnumerable.call(source, key)) continue
    defineSelectField(target, key, unwrapVal(Reflect.get(source, key)))
  }
}

// Only containers created by this evaluation may be modified. A spread or ref
// can borrow a source object, so copy each borrowed destination at most once.
function ownedDestination(
  result: object,
  path: ReadonlyArray<string>,
  owned: WeakSet<object>,
): object {
  let cursor = result
  for (const segment of path) {
    const next = Object.hasOwn(cursor, segment)
      ? Reflect.get(cursor, segment)
      : undefined
    if (next != null && typeof next === `object` && owned.has(next)) {
      cursor = next
      continue
    }
    const destination = Array.isArray(next)
      ? new Array<unknown>(next.length)
      : {}
    if (Array.isArray(next)) {
      Object.setPrototypeOf(destination, Object.getPrototypeOf(next))
    }
    if (next != null && typeof next === `object`) {
      mergeSourceFields(destination, next)
    }
    owned.add(destination)
    defineSelectField(cursor, segment, destination)
    cursor = destination
  }
  return cursor
}

function defineSelectField(
  target: object,
  key: PropertyKey,
  value: unknown,
): void {
  // Owned fields are normalized data. Preserve intrinsic array-length attributes
  // when replacing its value; only newly created fields need ordinary defaults.
  Object.defineProperty(
    target,
    key,
    Object.hasOwn(target, key)
      ? { value }
      : { value, enumerable: true, configurable: true, writable: true },
  )
}

/**
 * Processes a merge operation by merging source values into the target path
 */
function processMerge(
  op: Extract<SelectOp, { kind: `merge` }>,
  namespacedRow: NamespacedRow,
  selectResults: Record<string, any>,
  owned: WeakSet<object>,
): void {
  assertSafeAliasSegments(op.targetPath)
  const value = op.source(namespacedRow)
  if (value && typeof value === `object`) {
    mergeSourceFields(
      ownedDestination(selectResults, op.targetPath, owned),
      value,
    )
  }
}

/**
 * Processes a non-merge operation by setting the field value at the specified alias path
 */
function processNonMergeOp(
  op: Extract<SelectOp, { kind: `field` }>,
  namespacedRow: NamespacedRow,
  selectResults: Record<string, any>,
  owned: WeakSet<object>,
): void {
  // Support nested alias paths like "meta.author.name"
  const path = op.alias.split(`.`)
  assertSafeAliasSegments(path)
  const target = ownedDestination(selectResults, path.slice(0, -1), owned)
  defineSelectField(
    target,
    path[path.length - 1]!,
    unwrapVal(op.compiled(namespacedRow)),
  )
}

function evaluateSelectObject(
  namespacedRow: NamespacedRow,
  ops: Array<SelectOp>,
): Record<string, unknown> {
  const selectResults: Record<string, unknown> = {}
  const owned = new WeakSet<object>([selectResults])
  for (const op of ops) {
    if (op.kind === `merge`) {
      processMerge(op, namespacedRow, selectResults, owned)
    } else if (op.kind === `field`) {
      processNonMergeOp(op, namespacedRow, selectResults, owned)
    } else {
      assertSafeAliasSegments(op.targetPath)
      const target = ownedDestination(
        selectResults,
        op.targetPath.slice(0, -1),
        owned,
      )
      const destination = {}
      owned.add(destination)
      defineSelectField(
        target,
        op.targetPath[op.targetPath.length - 1]!,
        destination,
      )
    }
  }
  return selectResults
}

/**
 * Processes a single row to generate select results
 */
function processRow(
  [key, namespacedRow]: [unknown, NamespacedRow],
  ops: Array<SelectOp>,
): [unknown, typeof namespacedRow & { $selected: any }] {
  const selectResults = evaluateSelectObject(namespacedRow, ops)

  // Return the namespaced row with $selected added
  return [
    key,
    {
      ...namespacedRow,
      $selected: selectResults,
    },
  ] as [unknown, typeof namespacedRow & { $selected: typeof selectResults }]
}

/**
 * Processes the SELECT clause and places results in $selected
 * while preserving the original namespaced row for ORDER BY access
 */
export function processSelect(
  pipeline: NamespacedAndKeyedStream,
  select: Select,
  _allInputs: Record<string, KeyedStream>,
): NamespacedAndKeyedStream {
  if (!isNestedSelectObject(select)) {
    const compiled = compileSelectValue(select as SelectValueExpression)
    return pipeline.pipe(
      map(([key, namespacedRow]) => [
        key,
        { ...namespacedRow, $selected: compiled(namespacedRow) },
      ]),
    ) as NamespacedAndKeyedStream
  }

  // Build ordered operations to preserve authoring order (spreads and fields)
  const ops: Array<SelectOp> = []

  addFromObject([], select, ops)

  return pipeline.pipe(map((row) => processRow(row, ops)))
}

function compileSelectObject(
  obj: Record<string, any>,
): (row: NamespacedRow) => any {
  const ops: Array<SelectOp> = []
  addFromObject([], obj, ops)

  return (row) => evaluateSelectObject(row, ops)
}

function compileSelectValue(
  value: SelectValueExpression | null | undefined,
): (row: NamespacedRow) => any {
  if (value == null) {
    return () => value
  }

  if (isConditionalSelectValue(value)) {
    return compileConditionalSelect(value)
  }

  if (value instanceof ValClass) {
    return () => value.value
  }

  if (value.type === `includesSubquery`) {
    return () => null
  }

  if (isNestedSelectObject(value)) {
    return compileSelectObject(value)
  }

  if (!isExpressionLike(value)) {
    return () => value
  }

  return compileExpression(value as BasicExpression)
}

function compileConditionalSelect(
  conditional: ConditionalSelect,
): (row: NamespacedRow) => any {
  const branches = conditional.branches.map((branch) => ({
    condition: compileExpression(branch.condition),
    value: compileSelectValue(branch.value),
  }))
  const defaultFn =
    conditional.defaultValue === undefined
      ? undefined
      : compileSelectValue(conditional.defaultValue)

  return (row) => {
    for (const branch of branches) {
      if (isCaseWhenConditionTrue(branch.condition(row))) {
        return branch.value(row)
      }
    }

    return defaultFn !== undefined ? defaultFn(row) : null
  }
}

/**
 * Helper function to check if an object is a nested select object
 *
 * .select({
 *   id: users.id,
 *   profile: { // <-- this is a nested select object
 *     name: users.name,
 *     email: users.email
 *   }
 * })
 */
function isNestedSelectObject(obj: any): boolean {
  return obj && typeof obj === `object` && !isExpressionLike(obj)
}

/**
 * Helper function to process select objects and build operations array
 */
function addFromObject(
  prefixPath: Array<string>,
  obj: any,
  ops: Array<SelectOp>,
) {
  for (const [key, value] of Object.entries(obj)) {
    if (!key.startsWith(`__SPREAD_SENTINEL__`)) {
      assertSafeAliasSegments(key.split(`.`))
    }
    if (key.startsWith(`__SPREAD_SENTINEL__`)) {
      const rest = key.slice(`__SPREAD_SENTINEL__`.length)
      const splitIndex = rest.lastIndexOf(`__`)
      const pathStr = splitIndex >= 0 ? rest.slice(0, splitIndex) : rest
      const isRefExpr =
        value &&
        typeof value === `object` &&
        `type` in (value as any) &&
        (value as any).type === `ref`
      if (pathStr.includes(`.`) || isRefExpr) {
        // Merge into the current destination (prefixPath) from the referenced source path
        const targetPath = [...prefixPath]
        const path = pathStr.split(`.`)
        const expr = isRefExpr
          ? (value as BasicExpression)
          : (new PropRef(path, path[0]) as BasicExpression)
        const compiled = compileExpression(expr)
        ops.push({ kind: `merge`, targetPath, source: compiled })
      } else {
        // Table-level: pathStr is the alias; merge from namespaced row at the current prefix
        const tableAlias = pathStr
        const targetPath = [...prefixPath]
        ops.push({
          kind: `merge`,
          targetPath,
          source: (row) => (row as any)[tableAlias],
        })
      }
      continue
    }

    const expression = value as any
    if (isConditionalSelectValue(expression)) {
      ops.push({
        kind: `field`,
        alias: [...prefixPath, key].join(`.`),
        compiled: compileConditionalSelect(expression),
      })
      continue
    }

    if (expression && expression.type === `includesSubquery`) {
      // Placeholder — field will be set to a child Collection by the output layer
      ops.push({
        kind: `field`,
        alias: [...prefixPath, key].join(`.`),
        compiled: () => null,
      })
      continue
    }
    if (isNestedSelectObject(expression)) {
      // An authored object replaces any value supplied by an earlier spread.
      const targetPath = [...prefixPath, ...key.split(`.`)]
      ops.push({ kind: `object`, targetPath })
      addFromObject(targetPath, expression, ops)
      continue
    }

    if (expression === undefined || !isExpressionLike(expression)) {
      ops.push({
        kind: `field`,
        alias: [...prefixPath, key].join(`.`),
        compiled: () => expression,
      })
      continue
    }
    // If the expression is a Value wrapper, embed the literal to avoid re-compilation mishaps
    if (expression instanceof ValClass) {
      const val = expression.value
      ops.push({
        kind: `field`,
        alias: [...prefixPath, key].join(`.`),
        compiled: () => val,
      })
    } else {
      ops.push({
        kind: `field`,
        alias: [...prefixPath, key].join(`.`),
        compiled: compileExpression(expression as BasicExpression),
      })
    }
  }
}

function isConditionalSelectValue(value: unknown): value is ConditionalSelect {
  return (
    value instanceof ConditionalSelect ||
    (value != null &&
      typeof value === `object` &&
      (value as { type?: unknown }).type === `conditionalSelect` &&
      Array.isArray((value as { branches?: unknown }).branches))
  )
}

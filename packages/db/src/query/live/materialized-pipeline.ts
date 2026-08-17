import {
  distinct,
  filter,
  join,
  map,
  reduce,
  serializeValue,
} from '@tanstack/db-ivm'
import { FN_SELECT_STATE, INCLUDES_ROUTING } from '../compiler/index.js'
import { VIRTUAL_PROP_NAMES } from '../../virtual-props.js'
import { deepEquals } from '../../utils.js'
import type {
  CompilationResult,
  IncludesCompilationResult,
} from '../compiler/index.js'
import type { IncludesMaterialization } from '../ir.js'
import type { IStreamBuilder } from '@tanstack/db-ivm'
import type { ResultStream } from '../../types.js'

type ResultTuple = [
  value: Record<PropertyKey, any>,
  order: string | undefined,
  correlationKey?: unknown,
  parentContext?: Record<string, any> | null,
  routing?: IncludesRouting,
  publicKey?: unknown,
]

type IncludesRouting = Record<string, IncludeRoute>

type IncludeRoute = {
  active: boolean
  correlationKey: unknown
  parentContext: Record<string, any> | null
}

type FnSelectState = {
  sourceRow: Record<PropertyKey, any>
  fnSelect: (row: any) => unknown
}

type CanonicalResult = {
  publicKey: unknown
  tuple: ResultTuple
}

export type BucketRow = {
  publicKey: unknown
  value: Record<PropertyKey, any>
  order: string | undefined
}

export type BucketFacadeCompilation = {
  edgeId: string
  rows: IStreamBuilder<[string, BucketRow]>
  activeBuckets: IStreamBuilder<[string, true]>
  hasOrderBy: boolean
}

export const BUCKET_FACADE_REF = Symbol(`bucketFacadeRef`)

export type BucketFacadeRef = {
  [BUCKET_FACADE_REF]: {
    edgeId: string
    bucketKey: string
  }
}

export type MaterializedCompilation = {
  pipeline: ResultStream
  facades: Array<BucketFacadeCompilation>
}

type RelationScope = `root` | `child`

type BuiltRelations = WeakMap<
  CompilationResult,
  Partial<Record<RelationScope, MaterializedCompilation>>
>

let nextBucketFacadeEdgeId = 0

/**
 * Compiles inline includes into the same D2 graph as their parent relation.
 * Collection-valued includes become inert bucket references. The public facade
 * adapter resolves those references after the graph reaches quiescence.
 */
export function materializeCompilation(
  compilation: CompilationResult,
  getRootKey?: (row: any) => unknown,
): MaterializedCompilation {
  const built: BuiltRelations = new WeakMap()
  const materialized = materializeRelation(
    compilation,
    getRootKey,
    built,
    `root`,
  )
  return {
    ...materialized,
    facades: dedupeFacades(materialized.facades),
  }
}

function materializeRelation(
  compilation: CompilationResult,
  getKey: ((row: any) => unknown) | undefined,
  built: BuiltRelations,
  scope: RelationScope,
): MaterializedCompilation {
  const cached = built.get(compilation)?.[scope]
  if (cached) return cached

  let pipeline = canonicalizeByPublicKey(
    exposeRouting(compilation.pipeline),
    getKey,
    scope,
  )
  const facades: Array<BucketFacadeCompilation> = []

  for (const include of compilation.includes ?? []) {
    const child = materializeRelation(
      include.childCompilationResult,
      undefined,
      built,
      `child`,
    )
    facades.push(...child.facades)

    const bucketRows = createBucketRows(child.pipeline)
    if (include.materialization === `collection`) {
      const edgeId = `bucket-facade-${++nextBucketFacadeEdgeId}`
      const activeBuckets = createActiveBuckets(pipeline, include)
      facades.push({
        edgeId,
        rows: bucketRows,
        activeBuckets,
        hasOrderBy: include.hasOrderBy,
      })
      pipeline = attachCollectionInclude(pipeline, include, edgeId, scope)
    } else {
      pipeline = attachInlineInclude(pipeline, bucketRows, include, scope)
    }
  }

  const result = { pipeline, facades }
  built.set(compilation, { ...built.get(compilation), [scope]: result })
  return result
}

function dedupeFacades(
  facades: Array<BucketFacadeCompilation>,
): Array<BucketFacadeCompilation> {
  return [...new Map(facades.map((facade) => [facade.edgeId, facade])).values()]
}

function exposeRouting(pipeline: ResultStream): ResultStream {
  return pipeline.pipe(
    map(([key, rawTuple]) => {
      const tuple = rawTuple as ResultTuple
      return [
        key,
        [
          tuple[0],
          tuple[1],
          tuple[2],
          tuple[3],
          tuple[0][INCLUDES_ROUTING],
          tuple[4],
        ],
      ]
    }),
  ) as unknown as ResultStream
}

function canonicalizeByPublicKey(
  pipeline: ResultStream,
  getKey: ((row: any) => unknown) | undefined,
  scope: RelationScope,
): ResultStream {
  return pipeline.pipe(
    map(([internalKey, rawTuple]) => {
      const tuple = rawTuple as ResultTuple
      const publicKey = getKey ? getKey(tuple[0]) : (tuple[5] ?? internalKey)
      const relationKey =
        scope === `root`
          ? serializeValue([`root`, publicKey])
          : serializeValue([routeKey(tuple[2], tuple[3]), publicKey])
      return [relationKey, { publicKey, tuple }] as [string, CanonicalResult]
    }),
    reduce((values: Array<[CanonicalResult, number]>) => {
      const totalMultiplicity = values.reduce(
        (total, [, multiplicity]) => total + multiplicity,
        0,
      )
      if (totalMultiplicity === 0) return []
      if (totalMultiplicity < 0) {
        throw new Error(`Canonical query row has negative multiplicity`)
      }

      const visible = values.find(([, multiplicity]) => multiplicity > 0)?.[0]
      if (!visible) {
        throw new Error(`Canonical query row has no positive contributor`)
      }

      for (const [candidate, multiplicity] of values) {
        if (multiplicity <= 0) continue
        assertCongruentContributors(visible, candidate)
      }

      return [[visible, 1]]
    }),
    map(([relationKey, { publicKey, tuple }]) => [
      scope === `root` ? publicKey : relationKey,
      tuple,
    ]),
  ) as ResultStream
}

function assertCongruentContributors(
  left: CanonicalResult,
  right: CanonicalResult,
): void {
  const [leftValue, leftOrder, leftCorrelation, leftContext, leftRouting] =
    left.tuple
  const [rightValue, rightOrder, rightCorrelation, rightContext, rightRouting] =
    right.tuple

  if (
    leftOrder !== rightOrder ||
    !deepEquals(leftValue, rightValue) ||
    !deepEquals(leftCorrelation, rightCorrelation) ||
    !deepEquals(leftContext, rightContext) ||
    !deepEquals(leftRouting, rightRouting)
  ) {
    throw new Error(
      `Query contributors for public key ${serializeValue(left.publicKey)} are not congruent`,
    )
  }
}

function attachInlineInclude(
  parentPipeline: ResultStream,
  bucketRows: IStreamBuilder<[string, BucketRow]>,
  include: IncludesCompilationResult,
  scope: RelationScope,
): ResultStream {
  const bucketValues = bucketRows.pipe(
    reduce((values: Array<[BucketRow, number]>) => {
      const rows: Array<BucketRow> = []
      for (const [row, multiplicity] of values) {
        if (multiplicity < 0) {
          throw new Error(
            `Materialization bucket row has negative multiplicity`,
          )
        }
        for (let index = 0; index < multiplicity; index++) rows.push(row)
      }
      if (rows.length === 0) return []

      rows.sort(compareBucketRows)
      return [[materializeRows(rows, include), 1]]
    }),
  )
  const routedParents = parentPipeline.pipe(
    map(([parentKey, rawTuple]) => {
      const tuple = rawTuple as ResultTuple
      const routing = getIncludeRoute(tuple, include.fieldName)
      return [
        routing?.active !== true
          ? `inactive:${serializeValue(parentKey)}`
          : routeKey(routing.correlationKey, routing.parentContext),
        { parentKey, tuple },
      ] as [string, { parentKey: unknown; tuple: ResultTuple }]
    }),
    join(bucketValues, `left`),
    map(([_bucketKey, [parent, bucketValue]]) => {
      const [value, order, correlationKey, parentContext, routing, publicKey] =
        parent!.tuple
      const edgeRouting = routing?.[include.fieldName]
      if (edgeRouting?.active !== true) {
        return [
          parent!.parentKey,
          [value, order, correlationKey, parentContext, routing, publicKey],
        ]
      }
      const materialized =
        bucketValue ?? emptyMaterializedValue(include.materialization)
      return [
        parent!.parentKey,
        [
          setMaterializedInclude(value, include.resultPath, materialized),
          order,
          correlationKey,
          parentContext,
          routing,
          publicKey,
        ],
      ]
    }),
  )
  // A route move can make the join emit matched and empty-bucket deltas for
  // the same parent key in one graph turn. Reduce those deltas back to the one
  // canonical parent row before the next include or the public output sees it.
  return canonicalizeByPublicKey(
    routedParents as ResultStream,
    undefined,
    scope,
  )
}

function createBucketRows(
  childPipeline: ResultStream,
): IStreamBuilder<[string, BucketRow]> {
  return childPipeline.pipe(
    map(([internalKey, rawTuple]) => {
      const [value, order, correlationKey, parentContext, , publicKey] =
        rawTuple as ResultTuple
      return [
        routeKey(correlationKey, parentContext),
        { publicKey: publicKey ?? internalKey, value, order },
      ] as [string, BucketRow]
    }),
  )
}

function attachCollectionInclude(
  parentPipeline: ResultStream,
  include: IncludesCompilationResult,
  edgeId: string,
  scope: RelationScope,
): ResultStream {
  const routedParents = parentPipeline.pipe(
    map(([parentKey, rawTuple]) => {
      const tuple = rawTuple as ResultTuple
      const routing = getIncludeRoute(tuple, include.fieldName)
      if (routing?.active !== true) return [parentKey, tuple]
      const facade = createBucketFacadeRef(
        edgeId,
        routeKey(routing.correlationKey, routing.parentContext),
      )
      return [
        parentKey,
        [
          setMaterializedInclude(tuple[0], include.resultPath, facade),
          tuple[1],
          tuple[2],
          tuple[3],
          tuple[4],
          tuple[5],
        ],
      ]
    }),
  )
  return canonicalizeByPublicKey(
    routedParents as ResultStream,
    undefined,
    scope,
  )
}

function createActiveBuckets(
  parentPipeline: ResultStream,
  include: IncludesCompilationResult,
): IStreamBuilder<[string, true]> {
  return parentPipeline.pipe(
    map(([parentKey, rawTuple]) => {
      const tuple = rawTuple as ResultTuple
      const routing = getIncludeRoute(tuple, include.fieldName)
      const bucketKey =
        routing?.active === true
          ? routeKey(routing.correlationKey, routing.parentContext)
          : undefined
      return [parentKey, bucketKey] as [unknown, string | undefined]
    }),
    filter(([, bucketKey]) => bucketKey !== undefined),
    distinct(([, bucketKey]) => bucketKey),
    map(([, bucketKey]) => [bucketKey!, true] as [string, true]),
  )
}

function createBucketFacadeRef(
  edgeId: string,
  bucketKey: string,
): BucketFacadeRef {
  return { [BUCKET_FACADE_REF]: { edgeId, bucketKey } }
}

function getIncludeRoute(
  tuple: ResultTuple,
  fieldName: string,
): IncludeRoute | undefined {
  return tuple[4]?.[fieldName]
}

function routeKey(
  correlationKey: unknown,
  parentContext: Record<string, any> | null | undefined,
): string {
  return serializeValue([correlationKey ?? null, parentContext ?? null])
}

function compareBucketRows(left: BucketRow, right: BucketRow): number {
  if (left.order !== right.order) {
    if (left.order === undefined) return 1
    if (right.order === undefined) return -1
    return left.order < right.order ? -1 : 1
  }

  const leftKey = serializeValue(left.publicKey)
  const rightKey = serializeValue(right.publicKey)
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
}

function materializeRows(
  rows: Array<BucketRow>,
  include: IncludesCompilationResult,
): unknown {
  const scalarField = include.scalarField
  const values = scalarField
    ? rows.map(({ value }) => value[scalarField])
    : rows.map(({ value }) => value)

  if (include.materialization === `array`) return values
  if (include.materialization === `singleton`) return values[0]
  return values.map((value) => String(value ?? ``)).join(``)
}

function emptyMaterializedValue(
  materialization: IncludesMaterialization,
): unknown {
  if (materialization === `array`) return []
  if (materialization === `concat`) return ``
  if (materialization === `singleton`) return undefined
  throw new Error(`Collection includes require a bucket facade`)
}

function setNestedValue(
  source: Record<PropertyKey, any>,
  path: Array<string>,
  value: unknown,
): Record<PropertyKey, any> {
  const root = { ...source }
  let target = root
  let current: Record<PropertyKey, any> | null | undefined = source

  for (let index = 0; index < path.length - 1; index++) {
    const part = path[index]!
    const currentChild: any = current?.[part]
    const next = Array.isArray(currentChild)
      ? [...currentChild]
      : { ...(currentChild ?? {}) }
    target[part] = next
    target = next
    current = currentChild
  }

  target[path[path.length - 1]!] = value
  return root
}

function setMaterializedInclude(
  value: Record<PropertyKey, any>,
  path: Array<string>,
  materialized: unknown,
): Record<PropertyKey, any> {
  const state = value[FN_SELECT_STATE] as FnSelectState | undefined
  if (!state) return setNestedValue(value, path, materialized)

  const sourceRow = setNestedValue(state.sourceRow, path, materialized)
  const selectedValue = state.fnSelect(sourceRow)
  if (!selectedValue || typeof selectedValue !== `object`) {
    throw new Error(`fn.select must return an object when it projects includes`)
  }

  const selected: Record<PropertyKey, any> = Array.isArray(selectedValue)
    ? [...selectedValue]
    : { ...selectedValue }
  for (const property of VIRTUAL_PROP_NAMES) {
    if (property in value && !(property in selected)) {
      selected[property] = value[property]
    }
  }
  selected[INCLUDES_ROUTING] = value[INCLUDES_ROUTING]
  Object.defineProperty(selected, FN_SELECT_STATE, {
    value: { sourceRow, fnSelect: state.fnSelect },
    enumerable: true,
    configurable: true,
  })
  return selected
}

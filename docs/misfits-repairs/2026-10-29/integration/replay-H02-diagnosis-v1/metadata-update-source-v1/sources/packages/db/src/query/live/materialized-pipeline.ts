import {
  compareKeys,
  distinct,
  filter,
  join,
  map,
  reduce,
  serializeValue,
} from '@tanstack/db-ivm'
import { codedMessage, devBuild } from '../../error-message.js'
import {
  canonicalizeByPublicKey,
  exposeRouting,
  routeKey,
} from './public-key-reduction.js'
import type { ValueIdentity } from '../equality-value-identity.js'
import type {
  CompilationResult,
  IncludesCompilationResult,
} from '../compiler/index.js'
import type { IncludesMaterialization } from '../ir.js'
import type { IStreamBuilder } from '@tanstack/db-ivm'
import type { ResultStream } from '../../types.js'
import type {
  IncludeRoute,
  RelationScope,
  ResultTuple,
} from './public-key-reduction.js'

// A bucket row leads with its public key. The D2 index tells apart values
// with a different leading string, number or bigint without hashing them, so
// a row of one bucket is hashed only against a row with the same key,
// including its own retraction. A key of any other type has the whole row
// hashed whenever it joins a bucket.
export type BucketRow = readonly [
  publicKey: unknown,
  value: Record<PropertyKey, any>,
  order: string | undefined,
]

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

export type MaterializedRootCompilation = {
  pipeline: ResultStream
  /**
   * Undefined when the compiled pipeline passes through unchanged. Its rows
   * then carry no facade references or private route state to resolve.
   */
  facades: Array<BucketFacadeCompilation> | undefined
}

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
): MaterializedRootCompilation {
  if (!compilation.includes?.length) {
    return { pipeline: compilation.pipeline, facades: undefined }
  }

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
    compilation.valueIdentity,
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

    const bucketRows = createBucketRows(
      child.pipeline,
      include.childCompilationResult.valueIdentity,
    )
    if (include.materialization === `collection`) {
      const edgeId = `bucket-facade-${++nextBucketFacadeEdgeId}`
      const activeBuckets = createActiveBuckets(
        pipeline,
        include,
        compilation.valueIdentity,
      )
      const activeBucketRows = activeBuckets.pipe(
        join(bucketRows),
        map(([bucketKey, [, row]]) => [bucketKey, row]),
      ) as IStreamBuilder<[string, BucketRow]>
      facades.push({
        edgeId,
        rows: activeBucketRows,
        activeBuckets,
        hasOrderBy: include.hasOrderBy,
      })
      pipeline = attachCollectionInclude(
        pipeline,
        include,
        edgeId,
        scope,
        compilation.valueIdentity,
      )
    } else {
      pipeline = attachInlineInclude(
        pipeline,
        bucketRows,
        include,
        scope,
        compilation.valueIdentity,
      )
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

function attachInlineInclude(
  parentPipeline: ResultStream,
  bucketRows: IStreamBuilder<[string, BucketRow]>,
  include: IncludesCompilationResult,
  scope: RelationScope,
  valueIdentity: ValueIdentity,
): ResultStream {
  const bucketValues = bucketRows.pipe(
    reduce((values: Array<[BucketRow, number]>) => {
      const rows: Array<BucketRow> = []
      for (const [row, multiplicity] of values) {
        if (multiplicity < 0) {
          throw new Error(
            devBuild() && process.env.NODE_ENV !== `production`
              ? `Materialization bucket row has negative multiplicity`
              : codedMessage(157),
          )
        }
        for (let index = 0; index < multiplicity; index++) rows.push(row)
      }
      if (rows.length === 0) return []

      rows.sort(compareBucketRows)
      return [[{ value: materializeRows(rows, include) }, 1]]
    }),
  )
  const routedParents = parentPipeline.pipe(
    map(([parentKey, rawTuple]) => {
      const tuple = rawTuple as ResultTuple
      const routing = getIncludeRoute(tuple, include.fieldName)
      return [
        routing?.active !== true
          ? `inactive:${serializeValue(parentKey)}`
          : routeKey(
              routing.correlationKey,
              routing.parentContext,
              valueIdentity,
            ),
        [parentKey, tuple],
      ] as [string, readonly [parentKey: unknown, tuple: ResultTuple]]
    }),
    join(bucketValues, `left`),
    map(([_bucketKey, [parent, bucketValue]]) => {
      const [parentKey, tuple] = parent!
      const [value, order, correlationKey, parentContext, routing, publicKey] =
        tuple
      const edgeRouting = routing?.[include.fieldName]
      if (edgeRouting?.active !== true) {
        return [
          parentKey,
          [value, order, correlationKey, parentContext, routing, publicKey],
        ]
      }
      const materialized =
        bucketValue === null
          ? emptyMaterializedValue(include.materialization)
          : bucketValue.value
      return [
        parentKey,
        [
          setNestedValue(value, include.resultPath, materialized),
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
    valueIdentity,
  )
}

function createBucketRows(
  childPipeline: ResultStream,
  valueIdentity: ValueIdentity,
): IStreamBuilder<[string, BucketRow]> {
  return childPipeline.pipe(
    map(([internalKey, rawTuple]) => {
      const [value, order, correlationKey, parentContext, , publicKey] =
        rawTuple as ResultTuple
      return [
        routeKey(correlationKey, parentContext, valueIdentity),
        [publicKey ?? internalKey, value, order],
      ] as [string, BucketRow]
    }),
  )
}

function attachCollectionInclude(
  parentPipeline: ResultStream,
  include: IncludesCompilationResult,
  edgeId: string,
  scope: RelationScope,
  valueIdentity: ValueIdentity,
): ResultStream {
  const routedParents = parentPipeline.pipe(
    map(([parentKey, rawTuple]) => {
      const tuple = rawTuple as ResultTuple
      const routing = getIncludeRoute(tuple, include.fieldName)
      if (routing?.active !== true) return [parentKey, tuple]
      const facade = createBucketFacadeRef(
        edgeId,
        routeKey(routing.correlationKey, routing.parentContext, valueIdentity),
      )
      return [
        parentKey,
        [
          setNestedValue(tuple[0], include.resultPath, facade),
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
    valueIdentity,
  )
}

function createActiveBuckets(
  parentPipeline: ResultStream,
  include: IncludesCompilationResult,
  valueIdentity: ValueIdentity,
): IStreamBuilder<[string, true]> {
  return parentPipeline.pipe(
    map(([parentKey, rawTuple]) => {
      const tuple = rawTuple as ResultTuple
      const routing = getIncludeRoute(tuple, include.fieldName)
      const bucketKey =
        routing?.active === true
          ? routeKey(
              routing.correlationKey,
              routing.parentContext,
              valueIdentity,
            )
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

function compareBucketRows(left: BucketRow, right: BucketRow): number {
  const [leftPublicKey, , leftOrder] = left
  const [rightPublicKey, , rightOrder] = right
  if (leftOrder !== rightOrder) {
    if (leftOrder === undefined) return 1
    if (rightOrder === undefined) return -1
    return leftOrder < rightOrder ? -1 : 1
  }

  if (
    (typeof leftPublicKey === `string` || typeof leftPublicKey === `number`) &&
    (typeof rightPublicKey === `string` || typeof rightPublicKey === `number`)
  ) {
    return compareKeys(leftPublicKey, rightPublicKey)
  }

  const leftKey = serializeValue(leftPublicKey)
  const rightKey = serializeValue(rightPublicKey)
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
}

function materializeRows(
  rows: Array<BucketRow>,
  include: IncludesCompilationResult,
): unknown {
  const scalarField = include.scalarField
  const values = scalarField
    ? rows.map(([, value]) => value[scalarField])
    : rows.map(([, value]) => value)

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
  throw new Error(
    devBuild() && process.env.NODE_ENV !== `production`
      ? `Collection includes require a bucket facade`
      : codedMessage(158),
  )
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

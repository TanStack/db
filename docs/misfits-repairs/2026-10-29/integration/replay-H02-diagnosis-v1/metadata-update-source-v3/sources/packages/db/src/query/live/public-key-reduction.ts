import { map, reduce, serializeValue } from '@tanstack/db-ivm'
import { deepEquals } from '../../utils.js'
import { getParentContextIdentity } from '../equality-value-identity.js'
import { INCLUDES_ROUTING } from '../compiler/route-metadata.js'
import { codedMessage, devBuild } from '../../error-message.js'
import type { ValueIdentity } from '../equality-value-identity.js'
import type { CompilationResult } from '../compiler/index.js'
import type { ResultStream } from '../../types.js'

// Public-key reduction. A joined query with a custom key needs only this
// part of materialization, so it ships in core without the include
// materializer.

export type ResultTuple = [
  value: Record<PropertyKey, any>,
  order: string | undefined,
  correlationKey?: unknown,
  parentContext?: Record<string, any> | null,
  routing?: IncludesRouting,
  publicKey?: unknown,
]

export type IncludesRouting = Record<string, IncludeRoute>

export type IncludeRoute = {
  active: boolean
  correlationKey: unknown
  parentContext: Record<string, any> | null
}

export type CanonicalResult = {
  publicKey: unknown
  tuple: ResultTuple
}

export type RelationScope = `root` | `child`

export function exposeRouting(pipeline: ResultStream): ResultStream {
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

export function canonicalizeByPublicKey(
  pipeline: ResultStream,
  getKey: ((row: any) => unknown) | undefined,
  scope: RelationScope,
  valueIdentity: ValueIdentity,
): ResultStream {
  return pipeline.pipe(
    map(([internalKey, rawTuple]) => {
      const tuple = rawTuple as ResultTuple
      const publicKey = getKey ? getKey(tuple[0]) : (tuple[5] ?? internalKey)
      const relationKey =
        scope === `root`
          ? serializeValue([`root`, publicKey])
          : serializeValue([
              routeKey(tuple[2], tuple[3], valueIdentity),
              publicKey,
            ])
      return [relationKey, { publicKey, tuple }] as [string, CanonicalResult]
    }),
    reduce((values: Array<[CanonicalResult, number]>) => {
      const totalMultiplicity = values.reduce(
        (total, [, multiplicity]) => total + multiplicity,
        0,
      )
      if (totalMultiplicity === 0) return []
      if (totalMultiplicity < 0) {
        throw new Error(
          devBuild() && process.env.NODE_ENV !== `production`
            ? `Canonical query row has negative multiplicity`
            : codedMessage(154),
        )
      }

      const visible = values.find(([, multiplicity]) => multiplicity > 0)?.[0]
      if (!visible) {
        throw new Error(
          devBuild() && process.env.NODE_ENV !== `production`
            ? `Canonical query row has no positive contributor`
            : codedMessage(155),
        )
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
      devBuild() && process.env.NODE_ENV !== `production`
        ? `Query contributors for public key ${serializeValue(left.publicKey)} are not congruent`
        : codedMessage(156, { publicKey: left.publicKey }),
    )
  }
}

export function routeKey(
  correlationKey: unknown,
  parentContext: Record<string, any> | null | undefined,
  valueIdentity: ValueIdentity,
): string {
  return serializeValue([
    valueIdentity.equality(correlationKey ?? null),
    getParentContextIdentity(parentContext ?? null),
  ])
}

/** Reduces a query without includes to one canonical row per public key. */
export function reducePublicKeys(
  compilation: CompilationResult,
  getKey: (row: any) => unknown,
): { pipeline: ResultStream; facades: undefined } {
  return {
    pipeline: canonicalizeByPublicKey(
      exposeRouting(compilation.pipeline),
      getKey,
      `root`,
      compilation.valueIdentity,
    ),
    facades: undefined,
  }
}

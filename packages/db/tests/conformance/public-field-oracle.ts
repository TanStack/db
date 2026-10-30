/**
 * Enumerable own source fields survive selection as data. Authority:
 * live-queries.md, "Include all user fields", and live/ARCHITECTURE.md's
 * public-boundary preservation. Accepted destinations such as `toString` name
 * ordinary output fields. Unsafe authored alias paths keep their restrictions.
 *
 * This is the public-field family of includes-context-transport-oracle.test.ts,
 * shared with real framework receivers. Scalar stages independently construct
 * source and selected rows. The grammar crosses source keys, root/nested
 * selection, and accepted nested destinations. It bounds values to strings and
 * own undefined, and does not judge arbitrary descriptors or notification-only
 * changes. A version field makes every stage a distinct source update.
 */
import { expect } from 'vitest'
import { declareOracle } from '../oracle-declaration'
import { createOracleReach } from '../oracle-reach'
import { expectRowSnapshot } from './row-snapshot-oracle'
import { ScenarioLifetime } from './scenario-lifetime'
import type {
  LiveQueryDriver,
  LiveQueryHandle,
  QueryBuild,
  SourceHandle,
} from './contract'

export const publicFieldSymbol = Symbol(`user field`)
export const publicFieldGrammar = {
  keys: [
    `__proto__`,
    `constructor`,
    `prototype`,
    `toString`,
    `ordinary`,
    publicFieldSymbol,
  ] as const,
  locations: [`root`, `nested`] as const,
  selections: [`spread`, `whole-row`, `functional`, `implicit`] as const,
  destinations: [`payload`, `toString`, `wrapper.toString`] as const,
}
export type PublicFieldCell = {
  family: `public-field`
  key: (typeof publicFieldGrammar.keys)[number]
  location: (typeof publicFieldGrammar.locations)[number]
  selection: (typeof publicFieldGrammar.selections)[number]
  destination: (typeof publicFieldGrammar.destinations)[number]
}
// Destination variation matters only when a nested spread creates that output
// container. The other formulations are neighboring direct-reference controls.
export const publicFieldCells = publicFieldGrammar.keys.flatMap((key) =>
  publicFieldGrammar.locations.flatMap((location) =>
    publicFieldGrammar.selections.flatMap((selection) =>
      (location === `nested` && selection === `spread`
        ? publicFieldGrammar.destinations
        : ([`payload`] as const)
      ).map((destination): PublicFieldCell => ({
        family: `public-field`,
        key,
        location,
        selection,
        destination,
      })),
    ),
  ),
)
export type PublicFieldRow = {
  id: number
  parentGroup: number
  version: number
  payload: Record<PropertyKey, string | undefined>
}
export const fieldStages = [0, 1, 2, 3, 4] as const
// Stage 0/3 omits the key; stage 2 owns undefined. Those are different facts.
function fields(cell: PublicFieldCell, version: number) {
  return version === 0 || version === 3
    ? {}
    : { [cell.key]: version === 2 ? undefined : `ordinary data ${version}` }
}
export function expectedPublicField(
  cell: PublicFieldCell,
  version: number,
): PublicFieldRow {
  return {
    id: 10,
    parentGroup: 1,
    version,
    payload: cell.location === `nested` ? fields(cell, version) : {},
    ...(cell.location === `root` ? fields(cell, version) : {}),
  }
}
// The expected output uses explicit shapes, independently of the compiler's
// dotted-path walker or the production builder's computed property name.
export function expectedSelectedPublicField(
  cell: PublicFieldCell,
  version: number,
) {
  if (cell.destination === `payload`) return expectedPublicField(cell, version)
  const base = { id: 10, parentGroup: 1, version }
  return cell.destination === `toString`
    ? { ...base, ...Object.fromEntries([[`toString`, fields(cell, version)]]) }
    : {
        ...base,
        wrapper: {
          ...Object.fromEntries([[`toString`, fields(cell, version)]]),
        },
      }
}

/**
 * Frameworks supply actual mount/flush/source operations from their own realm.
 * Only the new nested-destination cells need an additional receiving path here;
 * the snapshot owner already covers ordinary source-field preservation. After
 * each full source write, compare the complete selected row at the native host
 * cut. A mismatch on one cell must not suppress other cells or later stages.
 */
export async function runPublicFieldHistories(
  driver: LiveQueryDriver,
  input: `callback` | `config`,
) {
  const cases = publicFieldCells.filter(
    (cell) => cell.destination !== `payload`,
  )
  const reach = createOracleReach(
    `framework.${driver.name}.${input}.public-fields`,
    [input, `toString`, `wrapper.toString`, ...fieldStages.map(String)],
  )
  const failures: Array<Error> = []
  for (const cell of cases) {
    reach.beginHistory()
    const resources = new ScenarioLifetime()
    try {
      await resources.run(async () => {
        const sourceRow = (version: number) => ({
          ...expectedPublicField(cell, version),
          id: `a`,
        })
        const source = driver.makeSource([sourceRow(0)], undefined, {
          rowUpdateMode: `full`,
        })
        let handle: LiveQueryHandle | undefined
        try {
          const build: QueryBuild = (q) =>
            q
              .from({ row: source.collection })
              .select(({ row }: { row: PublicFieldRow }) => ({
                id: row.id,
                parentGroup: row.parentGroup,
                version: row.version,
                ...(cell.destination === `wrapper.toString`
                  ? { wrapper: { toString: { ...row.payload } } }
                  : { [cell.destination]: { ...row.payload } }),
              }))
          handle =
            input === `config` ? driver.mountConfig(build) : driver.mount(build)
          reach.reach(input)
          reach.reach(cell.destination)
          for (const version of fieldStages) {
            if (version > 0)
              await handle.apply(() => source.update(sourceRow(version)))
            await handle.flush()
            expectRowSnapshot(
              source.collection.get(`a`),
              sourceRow(version),
              `source admitted fields`,
            )
            reach.reach(String(version))
            try {
              const rows = handle.current().data as ReadonlyArray<unknown>
              expect(rows, `complete framework result`).toHaveLength(1)
              expectRowSnapshot(
                rows[0],
                { ...expectedSelectedPublicField(cell, version), id: `a` },
                `framework selected fields`,
              )
            } catch (cause) {
              failures.push(
                new Error(
                  `${input}/${String(cell.key)}/${cell.destination}/stage ${version}`,
                  { cause },
                ),
              )
            }
          }
        } finally {
          resources.defer(() => handle?.unmount())
          resources.defer(() => handle?.collection()?.cleanup())
          resources.defer(() => source.collection.cleanup())
        }
      })
    } catch (cause) {
      failures.push(
        new Error(`${input}/${String(cell.key)}/${cell.destination}`, {
          cause,
        }),
      )
    }
  }
  if (failures.length)
    throw new AggregateError(failures, `Selected source fields were lost`)
  reach.assertReached()
  expect(Object.fromEntries(reach.counts())).toEqual({
    [input]: 12,
    toString: 6,
    'wrapper.toString': 6,
    ...Object.fromEntries(fieldStages.map((stage) => [String(stage), 12])),
  })
  await runPublicFieldOverlapHistories({
    name: `framework.${driver.name}.${input}`,
    makeSource: driver.makeSource,
    mount(build) {
      const handle =
        input === `config` ? driver.mountConfig(build) : driver.mount(build)
      return { ...handle, read: () => handle.current().data }
    },
  })
}

/**
 * A nested object literal replaces the field supplied by an earlier spread.
 * A dotted alias instead changes its named path and preserves its siblings.
 * Neither projection may write through a borrowed source object. Authority:
 * live-queries.md's Select contract and ARCHITECTURE.md's pure composition law.
 * Writable nonconfigurable input data is still readable source data; output
 * fields need not inherit that descriptor. Descriptor identity is not judged.
 *
 * This finite overlap grammar adds one rule missing from the field-name matrix:
 * a destination already contains a source reference. Three paths distinguish a
 * normal field, an inherited-name shadow, and a deeper borrowed parent. Four
 * operations distinguish nested replacement from dotted writes, with a fresh
 * destination as a control. Core also runs a real functional formulation.
 * Source destinations share
 * one target, so a write through one path cannot hide in another selected path.
 * Array neighbors shorten a borrowed ordinary or subclass array to lengths
 * zero, one, and two. The intrinsic nonconfigurable length is writable; changing
 * an owned copy must preserve the source array and the subclass's methods.
 * Unsafe authored path segments remain outside this legal grammar.
 */
export const publicFieldOverlapGrammar = {
  destinations: [`payload`, `toString`, `wrapper.toString`] as const,
  operations: [
    `nested-spread`,
    `nested-field`,
    `dotted-field`,
    `fresh-nested`,
  ] as const,
  descriptors: [`configurable`, `nonconfigurable`] as const,
  arrayOperations: [`dotted-array-length`, `dotted-subclass-length`] as const,
}
export type PublicFieldOverlapCell = {
  family: `public-field-overlap`
  destination: (typeof publicFieldOverlapGrammar.destinations)[number]
  operation:
    | (typeof publicFieldOverlapGrammar.operations)[number]
    | (typeof publicFieldOverlapGrammar.arrayOperations)[number]
    | `functional`
  descriptor:
    (typeof publicFieldOverlapGrammar.descriptors)[number] | `intrinsic`
}
export const publicFieldOverlapCells = [
  ...publicFieldOverlapGrammar.destinations.flatMap((destination) =>
    publicFieldOverlapGrammar.operations.flatMap((operation) =>
      publicFieldOverlapGrammar.descriptors.map(
        (descriptor): PublicFieldOverlapCell => ({
          family: `public-field-overlap`,
          destination,
          operation,
          descriptor,
        }),
      ),
    ),
  ),
  ...publicFieldOverlapGrammar.destinations.flatMap((destination) =>
    publicFieldOverlapGrammar.arrayOperations.map(
      (operation): PublicFieldOverlapCell => ({
        family: `public-field-overlap`,
        destination,
        operation,
        descriptor: `intrinsic`,
      }),
    ),
  ),
]
// A functional callback is a legal Core formulation. Unkeyed React/Preact
// bindings intentionally reject it under contract.ts's query-identity law, so
// their callback/config receiving drivers use the legal fresh-expression control.
export const publicFieldOverlapFunctionalCells = publicFieldOverlapCells
  .filter((cell) => cell.operation === `nested-spread`)
  .map((cell): PublicFieldOverlapCell => ({ ...cell, operation: `functional` }))
export const overlapStages = [0, 1, 2] as const
type OverlapTarget = { value: string | number | undefined; sourceOnly: string }
class OverlapValues extends Array<number> {
  total(): number {
    return this.reduce((sum, value) => sum + value, 0)
  }
}
function isArrayLengthOverlap(cell: PublicFieldOverlapCell): boolean {
  return publicFieldOverlapGrammar.arrayOperations.some(
    (operation) => cell.operation === operation,
  )
}
function expectedOverlapArray(
  cell: PublicFieldOverlapCell,
  version: number,
  length: number,
): Array<number> {
  const values = [version * 10 + 1, version * 10 + 2, version * 10 + 3].slice(
    0,
    length,
  )
  if (cell.operation === `dotted-subclass-length`)
    Object.setPrototypeOf(values, OverlapValues.prototype)
  return values
}
export type PublicFieldOverlapRow = {
  id: string
  parentGroup: number
  version: number
  payload: OverlapTarget | Array<number>
  toString: OverlapTarget | Array<number>
  wrapper: { toString: OverlapTarget | Array<number>; sibling: string }
  replacement: { value: string | undefined }
}

// Expectations are explicit scalar shapes. They do not walk compiler alias
// paths or share the source's mutable containers. The descriptor is a premise,
// not part of the expected public representation.
export function expectedPublicFieldOverlapSource(
  version: number,
  cell?: PublicFieldOverlapCell,
): PublicFieldOverlapRow {
  const target = () =>
    cell && isArrayLengthOverlap(cell)
      ? expectedOverlapArray(cell, version, 3)
      : {
          value: `source ${version}`,
          sourceOnly: `retained ${version}`,
        }
  return {
    id: `a`,
    parentGroup: 1,
    version,
    payload: target(),
    toString: target(),
    wrapper: { toString: target(), sibling: `sibling ${version}` },
    replacement: { value: version === 1 ? undefined : `selected ${version}` },
  }
}
export function publicFieldOverlapSource(
  cell: PublicFieldOverlapCell,
  version: number,
): PublicFieldOverlapRow {
  const row = expectedPublicFieldOverlapSource(version, cell)
  const target = row.payload
  if (!Array.isArray(target))
    Object.defineProperty(target, `value`, {
      value: target.value,
      writable: true,
      enumerable: true,
      configurable: version === 0 || cell.descriptor === `configurable`,
    })
  return {
    ...row,
    toString: target,
    wrapper: { ...row.wrapper, toString: target },
  }
}
export function expectedSelectedPublicFieldOverlap(
  cell: PublicFieldOverlapCell,
  version: number,
) {
  const source = expectedPublicFieldOverlapSource(version, cell)
  if (isArrayLengthOverlap(cell)) {
    const selected = expectedOverlapArray(cell, version, version)
    if (cell.destination === `payload`) return { ...source, payload: selected }
    if (cell.destination === `toString`)
      return { ...source, toString: selected }
    return {
      ...source,
      wrapper: { ...source.wrapper, toString: selected },
    }
  }
  const selected =
    cell.operation === `dotted-field`
      ? { value: version, sourceOnly: `retained ${version}` }
      : {
          value:
            cell.operation === `nested-field`
              ? version
              : source.replacement.value,
        }
  if (cell.destination === `payload`) return { ...source, payload: selected }
  if (cell.destination === `toString`) return { ...source, toString: selected }
  return {
    ...source,
    wrapper:
      cell.operation === `dotted-field`
        ? { toString: selected, sibling: `sibling ${version}` }
        : { toString: selected },
  }
}

// The builder authors actual nested objects for replacement, and literal
// dotted aliases only for the separate path-update operation. Expectations above
// are not computed by this production-path construction.
function overlapProjection(
  row: PublicFieldOverlapRow,
  cell: PublicFieldOverlapCell,
) {
  if (isArrayLengthOverlap(cell))
    return { ...row, [`${cell.destination}.length`]: row.version }
  if (cell.operation === `dotted-field`)
    return { ...row, [`${cell.destination}.value`]: row.version }
  const value =
    cell.operation === `nested-field`
      ? { value: row.version }
      : { ...row.replacement }
  if (cell.operation === `fresh-nested`) {
    const base = {
      id: row.id,
      parentGroup: row.parentGroup,
      version: row.version,
      replacement: row.replacement,
    }
    if (cell.destination === `payload`)
      return {
        ...base,
        payload: value,
        toString: row.toString,
        wrapper: row.wrapper,
      }
    if (cell.destination === `toString`)
      return {
        ...base,
        payload: row.payload,
        toString: value,
        wrapper: row.wrapper,
      }
    return {
      ...base,
      payload: row.payload,
      toString: row.toString,
      wrapper: { toString: value },
    }
  }
  if (cell.destination === `payload`) return { ...row, payload: value }
  if (cell.destination === `toString`) return { ...row, toString: value }
  return { ...row, wrapper: { toString: value } }
}
export function buildPublicFieldOverlap(
  source: SourceHandle<PublicFieldOverlapRow>,
  cell: PublicFieldOverlapCell,
): QueryBuild {
  return (q) => {
    const base = q.from({ row: source.collection })
    const select = ({ row }: { row: PublicFieldOverlapRow }) =>
      overlapProjection(row, cell)
    return cell.operation === `functional`
      ? base.fn.select(select)
      : base.select(select)
  }
}

export type PublicFieldOverlapHost = {
  name: string
  makeSource: LiveQueryDriver[`makeSource`]
  mount: (build: QueryBuild) => Pick<
    LiveQueryHandle,
    `apply` | `flush` | `unmount` | `collection`
  > & {
    read: () => unknown
  }
}

/**
 * Every host supplies its own source/mount/flush operations. Capture a source
 * reference before mount and after each full write; compare current and retained
 * rows with independent scalar facts at each host cut. A query runtime failure
 * after admission, including a mount that throws before returning a handle, is
 * a recorded observation: the comparison requires readable complete rows. A
 * failed mount is retried after each source update so every scalar stage enters
 * the actual receiving path. It is not discarded as a provider failure.
 */
export async function runPublicFieldOverlapCell(
  host: PublicFieldOverlapHost,
  cell: PublicFieldOverlapCell,
) {
  const label = `${host.name}/${cell.destination}/${cell.operation}/${cell.descriptor}`
  const runtimeFailures: Array<{ stage: number; error: unknown }> = []
  const states = overlapStages.flatMap((stage) => [
    `${stage}:result`,
    `${stage}:source`,
    `${stage}:retained`,
    `${stage}:descriptor`,
  ])
  const reach = createOracleReach(label, states)
  reach.beginHistory()
  const failures: Array<Error> = []
  const check = (checkpoint: string, compare: () => void) => {
    reach.reach(checkpoint)
    try {
      compare()
    } catch (cause) {
      failures.push(new Error(`${label}/${checkpoint}`, { cause }))
    }
  }
  const resources = new ScenarioLifetime()
  await resources.run(async () => {
    const source = host.makeSource(
      [publicFieldOverlapSource(cell, 0)],
      undefined,
      { rowUpdateMode: `full` },
    )
    let handle: ReturnType<PublicFieldOverlapHost[`mount`]> | undefined
    try {
      await source.collection.preload()
      expectRowSnapshot(
        source.collection.get(`a`),
        expectedPublicFieldOverlapSource(0, cell),
        `${label}: admitted before mount`,
      )
      const retained = [{ actual: source.collection.get(`a`), version: 0 }]
      const admitted = source.collection.get(`a`) as PublicFieldOverlapRow
      expect(admitted.payload, `${label}: shared source target`).toBe(
        admitted.toString,
      )
      expect(admitted.payload, `${label}: deeper shared source target`).toBe(
        admitted.wrapper.toString,
      )
      for (const version of overlapStages) {
        const runtimeErrors: Array<unknown> = []
        if (version > 0) {
          try {
            const write = () => {
              source.update(publicFieldOverlapSource(cell, version))
            }
            if (handle) await handle.apply(write)
            else write()
          } catch (error) {
            runtimeErrors.push(error)
          }
          retained.push({ actual: source.collection.get(`a`), version })
        }
        if (!handle) {
          try {
            handle = host.mount(buildPublicFieldOverlap(source, cell))
          } catch (error) {
            runtimeErrors.push(error)
          }
        }
        try {
          await handle?.flush()
        } catch (error) {
          runtimeErrors.push(error)
        }
        let rows: unknown
        try {
          rows = handle?.read()
        } catch (error) {
          runtimeErrors.push(error)
        }
        runtimeFailures.push(
          ...runtimeErrors.map((error) => ({ stage: version, error })),
        )
        check(`${version}:result`, () => {
          expect(runtimeErrors, `${label}: query remains readable`).toEqual([])
          expect(Array.isArray(rows), `${label}: complete result array`).toBe(
            true,
          )
          expect(rows, `${label}: complete result`).toHaveLength(1)
          expectRowSnapshot(
            (rows as Array<unknown>)[0],
            expectedSelectedPublicFieldOverlap(cell, version),
            `${label}: selected row`,
          )
        })
        check(`${version}:source`, () =>
          expectRowSnapshot(
            source.collection.get(`a`),
            expectedPublicFieldOverlapSource(version, cell),
            `${label}: current source`,
          ),
        )
        check(`${version}:retained`, () => {
          for (const prior of retained)
            expectRowSnapshot(
              prior.actual,
              expectedPublicFieldOverlapSource(prior.version, cell),
              `${label}: retained source ${prior.version}`,
            )
        })
        check(`${version}:descriptor`, () => {
          const current = source.collection.get(`a`) as PublicFieldOverlapRow
          if (isArrayLengthOverlap(cell)) {
            expect(
              Array.isArray(current.payload),
              `${label}: admitted array`,
            ).toBe(true)
            expect(
              current.payload,
              `${label}: unchanged source length`,
            ).toHaveLength(3)
            expect(
              Object.getOwnPropertyDescriptor(current.payload, `length`),
              `${label}: admitted intrinsic length`,
            ).toEqual({
              value: 3,
              writable: true,
              enumerable: false,
              configurable: false,
            })
            return
          }
          expect(
            Object.getOwnPropertyDescriptor(current.payload, `value`),
            `${label}: admitted descriptor`,
          ).toMatchObject({
            writable: true,
            enumerable: true,
            configurable: version === 0 || cell.descriptor === `configurable`,
          })
        })
      }
    } finally {
      resources.defer(() => handle?.unmount())
      resources.defer(() => handle?.collection()?.cleanup())
      resources.defer(() => source.collection.cleanup())
    }
    reach.assertReached()
    if (process.env.TANSTACK_DB_ORACLE_STATISTICS === `1`)
      console.info(
        JSON.stringify({
          oracle: `public-field-overlap`,
          host: host.name,
          cell,
          reach: Object.fromEntries(reach.counts()),
          runtimeFailures: runtimeFailures.map(({ stage, error }) => ({
            stage,
            name: error instanceof Error ? error.name : typeof error,
            message: error instanceof Error ? error.message : String(error),
          })),
          failures: failures.map((failure) => ({
            checkpoint: failure.message,
            cause:
              failure.cause instanceof Error
                ? failure.cause.message
                : String(failure.cause),
          })),
        }),
      )
    if (failures.length)
      throw new AggregateError(
        failures,
        `${label}: projection changed borrowed data or failed`,
      )
  })
}
export async function runPublicFieldOverlapHistories(
  host: PublicFieldOverlapHost,
) {
  const failures: Array<Error> = []
  for (const cell of publicFieldOverlapCells) {
    try {
      await runPublicFieldOverlapCell(host, cell)
    } catch (cause) {
      failures.push(
        new Error(`${cell.destination}/${cell.operation}/${cell.descriptor}`, {
          cause,
        }),
      )
    }
  }
  if (failures.length)
    throw new AggregateError(failures, `${host.name}: overlapping projections`)
}

declareOracle({
  model: [
    expectedPublicField,
    expectedSelectedPublicField,
    expectedPublicFieldOverlapSource,
    expectedSelectedPublicFieldOverlap,
  ],
  grammar: [
    publicFieldCells,
    publicFieldOverlapCells,
    publicFieldOverlapFunctionalCells,
  ],
  check: [
    runPublicFieldHistories,
    runPublicFieldOverlapCell,
    runPublicFieldOverlapHistories,
  ],
})

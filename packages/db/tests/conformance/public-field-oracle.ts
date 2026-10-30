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
import type { LiveQueryDriver, LiveQueryHandle, QueryBuild } from './contract'

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
}

declareOracle({
  model: [expectedPublicField, expectedSelectedPublicField],
  grammar: [publicFieldCells],
  check: [runPublicFieldHistories],
})

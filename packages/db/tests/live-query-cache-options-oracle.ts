/**
 * A reusable DbClient result cannot substitute different local row behavior.
 * Authority: the maintainer's same-identity conflict decision. Each local
 * getKey/schema declaration must agree by reference, including its absence.
 * A distinct queryKey permits independent declarations. Mounted bindings instead
 * retain their first options until query identity changes; that receiving law
 * is owned by the source-ID reuse oracle. Hydration carries no function refs.
 *
 * The independent model compares declaration names, not production config,
 * hashes, records, or the helper that production uses to admit them. Six legal
 * reference pairs per option cover absent/custom in both directions, equal
 * refs, and changed refs. Crossing the two options prevents coupled changes
 * from hiding a guard that requires every option to differ. Identity controls
 * keep both derived and explicitly keyed callers. Reference renaming adds no
 * observation, so the first custom declaration is always named `first`.
 */
import { expect } from 'vitest'

export type CacheRow = { id: string; label: string }
type Declaration = `absent` | `first` | `other`
const declarations: ReadonlyArray<readonly [Declaration, Declaration]> = [
  [`absent`, `absent`],
  [`absent`, `first`],
  [`first`, `absent`],
  [`first`, `first`],
  [`first`, `other`],
  [`absent`, `other`],
]

export const cacheOptionHistories = declarations.flatMap((getKey) =>
  declarations.flatMap((schema) =>
    [false, true].flatMap((keyed) =>
      [false, true].map((distinctKey) => ({
        getKey,
        schema,
        keyed,
        distinctKey,
      })),
    ),
  ),
)
export type CacheOptionHistory = (typeof cacheOptionHistories)[number]

// Either incompatible declaration is enough to reject same-identity reuse.
export function conflictingCacheOptions(history: CacheOptionHistory): boolean {
  return (
    !history.distinctKey &&
    (history.getKey[0] !== history.getKey[1] ||
      history.schema[0] !== history.schema[1])
  )
}

/** Each driver supplies its own production query. Only reference fixtures are shared. */
export function cacheOptionDeclarations(history: CacheOptionHistory) {
  const firstKey = (row: CacheRow) => `first-${row.id}`
  const otherKey = (row: CacheRow) => `other-${row.id}`
  const firstSchema = {
    '~standard': {
      version: 1 as const,
      vendor: `cache-options`,
      validate: (value: unknown) => ({ value }),
    },
  }
  const keys = { absent: undefined, first: firstKey, other: otherKey }
  const schemas = {
    absent: undefined,
    first: firstSchema,
    other: { ...firstSchema },
  }
  return [0, 1].map((index) => ({
    getKey: keys[history.getKey[index]!],
    schema: schemas[history.schema[index]!],
    queryKey:
      index === 1 && history.distinctKey
        ? [`other-cache-options`]
        : history.keyed
          ? [`cache-options`]
          : undefined,
  }))
}

/** Admission is checked before returning a result, and again on rejected retries. */
export function checkCacheOptionAdmission(
  action: () => unknown,
  history: CacheOptionHistory,
): void {
  if (conflictingCacheOptions(history))
    expect(action, `conflicting cached row options`).toThrow(/getKey|schema/)
  else expect(action, `compatible cached row options`).not.toThrow()
}

export async function checkCacheOptionPromise(
  result: Promise<void>,
  history: CacheOptionHistory,
  { deliveryHeld = false }: { deliveryHeld?: boolean } = {},
): Promise<void> {
  if (deliveryHeld && conflictingCacheOptions(history)) {
    // Admission depends on declarations already supplied at call time. It
    // cannot wait for source data. One host task drains the current promise
    // jobs while the driver keeps delivery held; this is an admission cut,
    // not a provider timeout. A pending verdict must fail here so cleanup can
    // release the provider instead of hanging inside this comparison.
    let verdict: `pending` | `fulfilled` | `rejected` = `pending`
    void result.then(
      () => {
        verdict = `fulfilled`
      },
      () => {
        verdict = `rejected`
      },
    )
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(verdict, `conflict rejects before held source delivery`).toBe(
      `rejected`,
    )
  }
  if (conflictingCacheOptions(history))
    await expect(result, `conflicting observer preload`).rejects.toThrow(
      /getKey|schema/,
    )
  else await result
}

// These public snapshots must still describe the original declaration after
// rejection and the next source publication. Ordinary rows are authored input;
// their keys follow the explicit key fixture or the single-source default key.
export function checkCacheOptionRows(
  actual: ReadonlyArray<{ key: unknown; value: unknown }>,
  rows: ReadonlyArray<CacheRow>,
  key: Declaration,
): void {
  expect(
    actual.map(({ key: actualKey, value }) => {
      const row = value as CacheRow
      return { key: actualKey, value: { id: row.id, label: row.label } }
    }),
  ).toEqual(
    rows.map((row) => ({
      key: key === `absent` ? row.id : `${key}-${row.id}`,
      value: row,
    })),
  )
}

/** These distinctions must reach each receiving path independently. */
export const cacheOptionReachStates = [
  `getKey-only-conflict`,
  `schema-only-conflict`,
  `both-conflict`,
  `distinct-key`,
  `getKey-added`,
  `getKey-removed`,
  `schema-added`,
  `schema-removed`,
] as const
export function cacheOptionReach(
  history: CacheOptionHistory,
): Array<(typeof cacheOptionReachStates)[number]> {
  const states: Array<(typeof cacheOptionReachStates)[number]> = []
  const keyChanged = history.getKey[0] !== history.getKey[1]
  const schemaChanged = history.schema[0] !== history.schema[1]
  if (history.distinctKey) states.push(`distinct-key`)
  else {
    if (keyChanged && !schemaChanged) states.push(`getKey-only-conflict`)
    if (schemaChanged && !keyChanged) states.push(`schema-only-conflict`)
    if (schemaChanged && keyChanged) states.push(`both-conflict`)
    for (const option of [`getKey`, `schema`] as const) {
      if (history[option][0] === `absent` && history[option][1] !== `absent`)
        states.push(`${option}-added`)
      if (history[option][0] !== `absent` && history[option][1] === `absent`)
        states.push(`${option}-removed`)
    }
  }
  return states
}

// No callback may publish wrong keys or values and then hide them behind a
// correct final read. Duplicate equivalent notifications remain permitted.
export function checkCacheOptionPublications(
  publications: ReadonlyArray<ReadonlyArray<{ key: unknown; value: unknown }>>,
  rows: ReadonlyArray<CacheRow>,
  key: Declaration,
): void {
  expect(publications.length, `source update delivered`).toBeGreaterThan(0)
  for (const publication of publications)
    checkCacheOptionRows(publication, rows, key)
}

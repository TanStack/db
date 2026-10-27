/**
 * Shared harness for the correlated include route-context transport tests.
 * It creates controlled sources, runs a scenario with its cleanup, and compares
 * the public forms of a materialized row. It states no expected value; the
 * models and the grammar that check them are in
 * `includes-context-transport-oracle.test.ts`.
 */

import { expect } from 'vitest'
import { materialize, toArray } from '../../src/query/index.js'
import { createControlledCollection } from './includes-oracle-helpers.js'
import type { Context, QueryBuilder } from '../../src/query/builder/index.js'
import type { ControlledCollection } from './includes-oracle-helpers.js'

export type Cleanable = { cleanup: () => Promise<void> }

export type MaterializationForm = (typeof materializationForms)[number]

export type MaterializedForms<T> = {
  collection: { values: () => Iterable<T> }
  array: Iterable<T>
  materialized: Iterable<T>
}

export const materializationForms = [
  `collection`,
  `array`,
  `materialized`,
] as const
async function cleanup(
  live: Cleanable,
  sources: Array<{ collection: Cleanable }>,
): Promise<Array<Error>> {
  const failures: Array<Error> = []
  try {
    await live.cleanup()
  } catch (error) {
    failures.push(
      new Error(`live-query Collection cleanup failed`, { cause: error }),
    )
  }
  const sourceResults = await Promise.allSettled(
    sources.map(({ collection }) =>
      Promise.resolve().then(() => collection.cleanup()),
    ),
  )
  for (const [index, result] of sourceResults.entries()) {
    if (result.status === `rejected`) {
      failures.push(
        new Error(`source Collection ${index} cleanup failed`, {
          cause: result.reason,
        }),
      )
    }
  }
  return failures
}

export async function runWithCleanup(
  live: Cleanable,
  sources: Array<{ collection: Cleanable }>,
  run: () => Promise<void>,
): Promise<void> {
  const outcome = await Promise.resolve()
    .then(run)
    .then(
      () => ({ ok: true }) as const,
      (error: unknown) => ({ ok: false, error }) as const,
    )
  const cleanupFailures = await cleanup(live, sources)
  if (!outcome.ok) {
    if (cleanupFailures.length > 0) {
      throw new AggregateError(cleanupFailures, `Oracle cleanup also failed`, {
        cause: outcome.error,
      })
    }
    throw outcome.error
  }
  if (cleanupFailures.length > 0) {
    throw new AggregateError(cleanupFailures, `Oracle cleanup failed`)
  }
}

export function createGrammarCollection<T extends { id: number }>(
  name: string,
  rows: ReadonlyArray<T>,
): ControlledCollection<T> {
  return createControlledCollection(name, rows, { autoIndex: `eager` })
}

export function includeInEveryForm<TContext extends Context>(
  query: QueryBuilder<TContext>,
) {
  return {
    collection: query,
    array: toArray(query),
    materialized: materialize(query),
  }
}

// Read each public form through the same projection. This keeps normalization
// outside the production query while preserving exact row counts and values.
export function readEveryForm<T, U>(
  forms: MaterializedForms<T>,
  project: (rows: Iterable<T>) => U,
): Record<MaterializationForm, U> {
  return {
    collection: project(forms.collection.values()),
    array: project(forms.array),
    materialized: project(forms.materialized),
  }
}

export function expectEveryForm<T, U>(
  forms: MaterializedForms<T>,
  project: (rows: Iterable<T>) => U,
  expected: U,
): void {
  expect(readEveryForm(forms, project)).toEqual(
    Object.fromEntries(materializationForms.map((form) => [form, expected])),
  )
}

export function ids(rows: Iterable<{ id: number }>): Array<number> {
  return [...rows].map((row) => row.id)
}

// Public-surface cells deliberately retain callback values and opaque wrappers.
// A cleaner that only fixes the final array will still fail these observations.
export function expectNoPrivateSymbolsDeep(
  value: unknown,
  allowedSymbols: ReadonlySet<symbol>,
  seen = new WeakSet<object>(),
): void {
  if (value == null || typeof value !== `object` || seen.has(value)) return
  seen.add(value)

  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === `symbol`) {
      expect(
        allowedSymbols.has(key),
        `unexpected private symbol in public query output`,
      ).toBe(true)
    }
    expectNoPrivateSymbolsDeep(
      (value as Record<PropertyKey, unknown>)[key],
      allowedSymbols,
      seen,
    )
  }

  if (value instanceof Map) {
    for (const [key, entry] of value) {
      expectNoPrivateSymbolsDeep(key, allowedSymbols, seen)
      expectNoPrivateSymbolsDeep(entry, allowedSymbols, seen)
    }
  } else if (value instanceof Set) {
    for (const entry of value) {
      expectNoPrivateSymbolsDeep(entry, allowedSymbols, seen)
    }
  }
}

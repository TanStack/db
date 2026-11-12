/**
 * The SQL-alias law is independent of envelope decoding. An alias list supplies
 * the keys in order, and each key has its own asymmetric scalar value in each
 * row. The model never imports the production decoder. Object-key order is a
 * separate observation because exact row data alone does not retain it.
 */
import { fc } from '@fast-check/vitest'
import { differs, pass, violation } from '../../db/tests/oracle-property.js'
import {
  isRecord,
  statementResultAliasNames,
  writeResultFieldNames,
} from './op-sqlite-driver-support'
import type { Verdict } from '../../db/tests/oracle-property.js'

export type AliasRows = ReadonlyArray<Record<string, unknown>>
export type AliasRowsObservation = {
  rows: unknown
  keys: Array<Array<string>> | null
}
export const ROW_LAW = `exact-alias-rows`
export const QUERY_LAW = `query-execution`

export const writeResultAliasesArbitrary = fc.uniqueArray(
  fc.constantFrom(...writeResultFieldNames),
  { minLength: 1, maxLength: writeResultFieldNames.length },
)
export const statementResultAliasesArbitrary = fc.uniqueArray(
  fc.constantFrom(...statementResultAliasNames),
  { minLength: 1, maxLength: statementResultAliasNames.length },
)

export function aliasRowsObservation(rows: unknown): AliasRowsObservation {
  return {
    rows,
    keys: Array.isArray(rows)
      ? rows.map((row: unknown) => (isRecord(row) ? Object.keys(row) : []))
      : null,
  }
}

export function checkAliasRows(
  checkpoint: string,
  actual: unknown,
  expected: AliasRowsObservation,
): Verdict {
  return differs(checkpoint, ROW_LAW, actual, expected) ?? pass
}

function isLegalAliasSequence(
  aliases: ReadonlyArray<string>,
  allowedAliases: ReadonlyArray<string>,
): boolean {
  const allowed = new Set(allowedAliases)
  return (
    aliases.length >= 1 &&
    aliases.length <= allowedAliases.length &&
    new Set(aliases).size === aliases.length &&
    aliases.every((alias) => allowed.has(alias))
  )
}

// These are the old reconstruction, ablation, range, and exclusion controls.
// Every generated product history now runs them through this shared check;
// each original 50-history grammar budget remains in its 50-history campaign.
export function checkAliasGrammar<TAlias extends string>(
  aliases: ReadonlyArray<TAlias>,
  arbitrary: fc.Arbitrary<Array<TAlias>>,
  allowedAliases: ReadonlyArray<TAlias>,
): Verdict {
  const witnesses = [
    ...allowedAliases.map((alias) => [alias]),
    [...allowedAliases],
    [...allowedAliases].reverse(),
  ]
  for (const witness of witnesses) {
    if (
      !arbitrary.canShrinkWithoutContext(witness) ||
      !isLegalAliasSequence(witness, allowedAliases)
    ) {
      return violation(
        `grammar`,
        `a valid alias witness is not reconstructible`,
        `alias-grammar`,
        { actual: witness, expected: allowedAliases },
      )
    }
  }
  for (const invalid of [
    [],
    [allowedAliases[0]!, allowedAliases[0]!],
    [`not-an-op-sqlite-alias`],
  ]) {
    if (
      arbitrary.canShrinkWithoutContext(invalid) ||
      isLegalAliasSequence(invalid, allowedAliases)
    ) {
      return violation(
        `grammar`,
        `an invalid alias sequence was accepted`,
        `alias-grammar`,
        { actual: invalid, expected: allowedAliases },
      )
    }
  }
  return isLegalAliasSequence(aliases, allowedAliases)
    ? pass
    : violation(
        `grammar`,
        `a generated alias sequence is invalid`,
        `alias-grammar`,
      )
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll(`"`, `""`)}"`
}
function aliasValue(
  alias: string,
  rowIndex: number,
  columnIndex: number,
): string {
  return `${rowIndex === 0 ? `left` : `right`}:${columnIndex}:${alias}`
}
export function aliasQueryCase(aliases: ReadonlyArray<string>): {
  sql: string
  params: Array<unknown>
  expected: Array<Record<string, unknown>>
} {
  const rowValues = [0, 1].map((rowIndex) =>
    aliases.map((alias, columnIndex) =>
      aliasValue(alias, rowIndex, columnIndex),
    ),
  )
  const selectList = aliases
    .map((alias) => `? AS ${quoteIdentifier(alias)}`)
    .join(`, `)
  return {
    sql: `SELECT ${selectList} UNION ALL SELECT ${selectList}`,
    params: [...rowValues[0]!, ...rowValues[1]!],
    expected: rowValues.map((values) =>
      Object.fromEntries(aliases.map((alias, index) => [alias, values[index]])),
    ),
  }
}

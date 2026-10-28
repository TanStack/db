// Equality-partition checks for identity-output-shape. The law and its generated
// campaign are owned by identity-output-shape-oracle.test.ts.
import { serializeValue } from '@tanstack/db-ivm'
import { expect } from 'vitest'
import { compileExpression } from '../../src/query/compiler/evaluators.js'
import { getEqualityValueIdentity } from '../../src/query/equality-value-identity.js'
import { getLoadSubsetDemandKey } from '../../src/query/ir-stable-identity.js'
import { Func, PropRef, Value } from '../../src/query/ir.js'

export type EqualityPair = {
  label: string
  left: unknown
  right: unknown
  equal: boolean
}

function equalityKey(value: unknown): string {
  return serializeValue(getEqualityValueIdentity(value))
}

function equalityOperandKey(value: unknown): string {
  const where = new Func(`eq`, [
    new PropRef([`row`, `value`]),
    new Value(value),
  ])
  const key = getLoadSubsetDemandKey({ where })
  if (key === undefined) throw new Error(`equality predicate lost its key`)
  return key
}

export function assertEqualityPartition({
  label,
  left,
  right,
  equal,
}: EqualityPair) {
  expect(equalityKey(left) === equalityKey(right), `${label}: D2 key`).toBe(
    equal,
  )
  expect(
    equalityOperandKey(left) === equalityOperandKey(right),
    `${label}: IR operand key`,
  ).toBe(equal)
  const predicate = new Func(`eq`, [new Value(left), new Value(right)])
  expect(compileExpression(predicate)({}), `${label}: predicate result`).toBe(
    left == null || right == null ? null : equal,
  )
}

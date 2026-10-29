// Predicate builders shared by the WHERE publication oracle and its ordinary
// witness tests. The oracle that owns the law is
// where-predicate-publication-oracle.property.test.ts.
import { Func, PropRef, Value } from '../../src/query/ir.js'
import type { BasicExpression } from '../../src/query/ir.js'
import type { ChangeMessage } from '../../src/types.js'

export const MISSING = Symbol(`missing field`)

export type FieldValue =
  string | boolean | number | Date | null | typeof MISSING
export type Row = { id: string; v?: unknown }

export type Operand =
  | { kind: `field` }
  | { kind: `literal`; value: FieldValue }
  | { kind: `virtual`; name: `$hasPendingWrites` | `$origin` | `$key` }

export type Predicate =
  | { kind: `eq`; left: Operand; right: Operand }
  | { kind: `not`; arg: Predicate }
  | { kind: `and` | `or`; args: [Predicate, Predicate] }

export const fieldEq = (value: FieldValue): Predicate => ({
  kind: `eq`,
  left: { kind: `field` },
  right: { kind: `literal`, value },
})

function irOperand(operand: Operand): BasicExpression {
  switch (operand.kind) {
    case `field`:
      return new PropRef([`v`])
    case `literal`:
      return new Value(operand.value === MISSING ? undefined : operand.value)
    case `virtual`:
      return new PropRef([operand.name])
  }
}

export function irPredicate(predicate: Predicate): BasicExpression<boolean> {
  switch (predicate.kind) {
    case `eq`:
      return new Func(`eq`, [
        irOperand(predicate.left),
        irOperand(predicate.right),
      ])
    case `not`:
      return new Func(`not`, [irPredicate(predicate.arg)])
    case `and`:
    case `or`:
      return new Func(predicate.kind, predicate.args.map(irPredicate))
  }
}

// Rebuild a subscriber's visible key set from its callback batches.
export function recordVisibleKeys(visible: Set<string | number>) {
  return (changes: Array<ChangeMessage<Row>>) => {
    for (const change of changes) {
      if (change.type === `delete`) visible.delete(change.key)
      else visible.add(change.key)
    }
  }
}

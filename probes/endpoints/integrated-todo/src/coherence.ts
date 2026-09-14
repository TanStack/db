import {
  IR,
  compileSingleRowExpression,
  toBooleanPredicate,
} from '@tanstack/db'
import type { QueryParams } from './query-instance'

// A bounded, serializable description, not serialized QueryIR or executable SQL.
// Relation identities are compiler-assigned and scoped by the EndpointRuntime.
export type QueryModel = {
  relation: string
  order: ReadonlyArray<'createdAt' | 'id'>
  fields?: ReadonlyArray<string>
  membership:
    | { kind: 'all' }
    | { kind: 'completed'; value: boolean }
    | { kind: 'expression'; expression: RowPredicate }
}
export type RowPredicate =
  | { op: 'and' | 'or'; args: ReadonlyArray<RowPredicate> }
  | { op: 'isNull' | 'isNotNull'; column: string }
  | {
      op: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte'
      column: string
      value: string | number | boolean | { parameter: string }
    }

function predicateIR(predicate: RowPredicate): IR.BasicExpression {
  if ('args' in predicate)
    return new IR.Func(predicate.op, predicate.args.map(predicateIR))
  const column = new IR.PropRef([predicate.column])
  if ('value' in predicate && typeof predicate.value === 'object')
    throw Error('Query parameter was not instantiated')
  if (predicate.op === 'ne')
    return new IR.Func('not', [
      new IR.Func('eq', [column, new IR.Value(predicate.value)]),
    ])
  if (predicate.op === 'isNotNull')
    return new IR.Func('not', [new IR.Func('isNull', [column])])
  return new IR.Func(
    predicate.op,
    'value' in predicate ? [column, new IR.Value(predicate.value)] : [column],
  )
}
export function instantiateQueryModel(
  model: QueryModel,
  params: QueryParams,
): QueryModel {
  function instantiate(predicate: RowPredicate): RowPredicate {
    if ('args' in predicate)
      return { ...predicate, args: predicate.args.map(instantiate) }
    if ('value' in predicate && typeof predicate.value === 'object') {
      const parameter = predicate.value.parameter
      if (!Object.hasOwn(params, parameter))
        throw Error('Missing query parameter ' + parameter)
      return { ...predicate, value: params[parameter]! }
    }
    return predicate
  }
  return model.membership.kind === 'expression'
    ? {
        ...model,
        membership: {
          kind: 'expression',
          expression: instantiate(model.membership.expression),
        },
      }
    : model
}
export type EffectCoverage =
  | { kind: 'complete'; relations: ReadonlyArray<string> }
  | { kind: 'unknown'; reason: string }

export function mayAffect(query: QueryModel, effects: EffectCoverage): boolean {
  return (
    effects.kind === 'unknown' || effects.relations.includes(query.relation)
  )
}

export function compileMembership(
  query: QueryModel,
): (row: Record<string, unknown>) => boolean {
  const expression =
    query.membership.kind === 'all'
      ? new IR.Value(true)
      : query.membership.kind === 'expression'
        ? predicateIR(query.membership.expression)
        : new IR.Func('eq', [
            new IR.PropRef(['completed']),
            new IR.Value(query.membership.value),
          ])
  const evaluate = compileSingleRowExpression(expression)
  return (row) => toBooleanPredicate(evaluate(row))
}

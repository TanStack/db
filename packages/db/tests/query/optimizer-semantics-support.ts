// Shared fixtures and observation helpers for optimizer-semantics-oracle.test.ts
// and optimizer-semantics.test.ts. The laws they serve are owned by
// optimizer-semantics-oracle.test.ts.
import { Func, PropRef, Value } from '../../src/query/ir.js'
import type { CollectionImpl } from '../../src/collection/index.js'
import type { BasicExpression, From, Where } from '../../src/query/ir.js'

export type Row = { id: number; k: number; v: number }

export const rows: Array<Row> = [
  { id: 1, k: 1, v: 10 },
  { id: 2, k: 2, v: 20 },
]

export type ObservedTerm = { key: string; residual: boolean }

export function observedTerms(
  where: Array<Where> | undefined,
): Array<ObservedTerm> {
  const terms: Array<ObservedTerm> = []
  for (const clause of where ?? []) {
    const residual = `expression` in clause && clause.residual === true
    const expression = `expression` in clause ? clause.expression : clause
    const visit = (current: BasicExpression): void => {
      if (current instanceof Func && current.name === `and`) {
        current.args.forEach(visit)
        return
      }
      if (current instanceof Func && current.name === `or`) {
        const keys = current.args.map((arg) => {
          if (
            !(arg instanceof Func) ||
            arg.name !== `eq` ||
            !(arg.args[0] instanceof PropRef) ||
            !(arg.args[1] instanceof Value)
          ) {
            throw new Error(`Unexpected OR term in residual oracle`)
          }
          return `${arg.args[0].path.join(`.`)}=${JSON.stringify(arg.args[1].value)}`
        })
        terms.push({ key: `or(${keys.join(`,`)})`, residual })
        return
      }
      if (
        !(current instanceof Func) ||
        ![`eq`, `gt`, `isUndefined`].includes(current.name) ||
        !(current.args[0] instanceof PropRef)
      ) {
        throw new Error(`Unexpected optimizer predicate in residual oracle`)
      }
      const path = current.args[0].path.join(`.`)
      const compared = current.args[1]
      let key: string
      if (current.name === `isUndefined`) {
        key = `isUndefined(${path})`
      } else if (compared instanceof Value) {
        key =
          current.name === `gt`
            ? `gt(${path},${JSON.stringify(compared.value)})`
            : `${path}=${JSON.stringify(compared.value)}`
      } else if (current.name === `eq` && compared instanceof PropRef) {
        key = `${path}=${compared.path.join(`.`)}`
      } else {
        throw new Error(`Unexpected compared value in residual oracle`)
      }
      terms.push({ key, residual })
    }
    visit(expression)
  }
  return terms.sort(
    (a, b) =>
      a.key.localeCompare(b.key) || Number(a.residual) - Number(b.residual),
  )
}

export function sourceTerms(source: From): Array<ObservedTerm> {
  if (source.type === `collectionRef`) return []
  if (source.type !== `queryRef`) {
    throw new Error(`Unexpected optimizer source in residual oracle`)
  }
  return observedTerms(source.query.where)
}

export function predicate(
  alias: string,
  field: string,
  value: unknown,
): Func<boolean> {
  return new Func(`eq`, [new PropRef([alias, field]), new Value(value)])
}

export function inertCollection(id: string): CollectionImpl {
  // The optimizer uses Collection identity but does not read Collection methods.
  return { id } as unknown as CollectionImpl
}

export function expectedTerms(
  keys: Array<string>,
  residual: boolean,
): Array<ObservedTerm> {
  return keys
    .map((key) => ({ key, residual }))
    .sort((a, b) => a.key.localeCompare(b.key))
}

export type Team = { id: number; active: boolean }
export type Member = { id: number; teamId: number; userId: number }
export const teams: Array<Team> = [
  { id: 1, active: true },
  { id: 2, active: false },
  { id: 3, active: true },
]
export const members: Array<Member> = [
  { id: 10, teamId: 1, userId: 100 },
  { id: 11, teamId: 1, userId: 200 },
  { id: 12, teamId: 2, userId: 100 },
  { id: 13, teamId: 4, userId: 100 },
]

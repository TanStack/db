import { registerWrapper } from './wrapper-identity.js'
import type { CaseWhenValue } from './functions.js'
import type { QueryBuilder } from './index.js'

export class ToArrayWrapper<_T = unknown> {
  readonly __brand = `ToArrayWrapper` as const
  declare readonly _type: `toArray`
  declare readonly _result: _T
  constructor(public readonly query: QueryBuilder<any>) {
    registerWrapper(this, `toArray()`)
  }
}

export class ConcatToArrayWrapper<_T = unknown> {
  readonly __brand = `ConcatToArrayWrapper` as const
  declare readonly _type: `concatToArray`
  declare readonly _result: _T
  constructor(public readonly query: QueryBuilder<any>) {
    registerWrapper(this, `concat(toArray())`)
  }
}

export class CaseWhenWrapper<_T = any> {
  readonly __brand = `CaseWhenWrapper` as const
  declare readonly _type: `caseWhen`
  readonly _result?: _T
  constructor(public readonly args: Array<CaseWhenValue>) {
    registerWrapper(this, `caseWhen()`)
  }
}

export class MaterializeWrapper<
  _T = unknown,
  _IsSingle extends boolean = boolean,
> {
  readonly __brand = `MaterializeWrapper` as const
  declare readonly _type: `materialize`
  declare readonly _result: _T
  declare readonly _isSingle: _IsSingle
  constructor(public readonly query: QueryBuilder<any>) {
    registerWrapper(this, `materialize()`)
  }
}

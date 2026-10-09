import { codedMessage, devBuild } from '../../error-message.js'
import type {
  BaseQueryBuilder,
  InitialQueryBuilder,
  QueryBuilder,
} from './index.js'
import type { QueryIR } from '../ir.js'

// Keep IR access independent of Collection construction at runtime.
export function getQueryIR(
  builder: BaseQueryBuilder | QueryBuilder<any> | InitialQueryBuilder,
): QueryIR {
  const value: unknown = builder
  if (value === undefined || value === null) {
    const received = value === null ? `null` : `undefined`
    throw new Error(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `Query must resolve to a QueryBuilder; received ${received}.`
        : codedMessage(236, { received }),
    )
  }
  return (builder as unknown as BaseQueryBuilder)._getQuery()
}

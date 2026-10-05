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
  return (builder as unknown as BaseQueryBuilder)._getQuery()
}

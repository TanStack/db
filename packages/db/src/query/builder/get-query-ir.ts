import type { QueryIR } from '../ir.js'

type QueryBuilderWithIR = {
  _getQuery: () => QueryIR
}

/** Internal leaf accessor shared with query identity code. */
export function getQueryIR(builder: unknown): QueryIR {
  return (builder as QueryBuilderWithIR)._getQuery()
}

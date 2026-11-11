// The expression shape the PostgREST filter renderer understands. TanStack DB's
// `IR.BasicExpression` is structurally assignable to it, so `loadSubset` where
// clauses can be rendered without converting them first.
export type SerializedExpression =
  | { type: `ref`; path: Array<string> }
  | { type: `val`; value: unknown }
  | { type: `func`; name: string; args: Array<SerializedExpression> }
  | { type: `agg`; name: string; args: Array<SerializedExpression> }

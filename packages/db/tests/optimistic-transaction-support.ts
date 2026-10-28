// Row shapes shared by the optimistic transaction tests. The law and its oracle
// are in optimistic-transaction-oracle.property.test.ts.

export type Row = { id: number; value: number; note: string }

export type ReplacementRow = {
  id: number
  value: number | null | undefined
  note?: string | null
  added?: string
  nested?: { count: number }
}

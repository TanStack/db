import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { integer, pgTable } from 'drizzle-orm/pg-core'
import { postgresAdapter } from '../integrated-todo/src/postgres-adapter.server.ts'

const client = postgres({ max: 7 })
const reads: typeof client = postgresAdapter(client)
const db = drizzle(reads)
const table = pgTable('type_check', { id: integer().notNull() })

export async function checkTypes() {
  const rows = await reads.unsafe<{ id: number }[]>('SELECT 1 AS id')
  const id: number = rows[0]!.id
  // @ts-expect-error Generic result types must not widen to any.
  const invalid: string = rows[0]!.id
  const mapped = await db.select().from(table)
  const selected: number = mapped[0]!.id
  const transaction: ReturnType<typeof client.begin> = reads.begin(
    async (tx) => tx`SELECT 1`,
  )
  return { id, invalid, selected, transaction }
}

const custom = postgres({
  types: {
    point: {
      to: 600,
      from: [600],
      serialize: (point: { x: number; y: number }) => `(${point.x},${point.y})`,
      parse: () => ({ x: 1, y: 2 }),
    },
  },
})
const customReads: typeof custom = postgresAdapter(custom)
export const point = () => customReads.typed.point({ x: 1, y: 2 })
